// The crypto under remote control (axe-mac docs/remote-control-SECURITY.md): base64url, device keys and
// ids, and sealed boxes. The same file lives in axe-mac next/src/shared/remote-crypto.ts: keep the two
// identical. WebCrypto only, so it runs in Node 24 (Electron) and in phone browsers.

// Named from crypto.subtle itself, so this compiles with DOM types (the web) and without (Node).
type Subtle = typeof globalThis.crypto.subtle
type Key = Awaited<ReturnType<Subtle["importKey"]>>
type KeyPair = { privateKey: Key; publicKey: Key }
/** Bytes as WebCrypto takes them. */
export type Bytes = Parameters<Subtle["digest"]>[1]

export const te = new TextEncoder()
export const td = new TextDecoder()
export const subtle = () => globalThis.crypto.subtle
export const bs = (b: Uint8Array) => b as unknown as Bytes

// base64url without padding
export function b64u(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function fromB64u(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new PairingError("bad_encoding")
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export class PairingError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

export const sha256 = async (data: Uint8Array) => new Uint8Array(await subtle().digest("SHA-256", bs(data)))

/** Constant-time compare of two byte strings. */
export function same(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return d === 0
}

// ---------------------------------------------------------------------------------------------
// Keys

export type DeviceKeys = { sign: KeyPair; dh: KeyPair }
export type PublicKeys = { ed: string; x: string }

/** A device's two key pairs. Phones pass extractable false: the private halves can't be read out. */
export async function generateDeviceKeys(extractable: boolean): Promise<DeviceKeys> {
  const sign = (await subtle().generateKey({ name: "Ed25519" }, extractable, [
    "sign",
    "verify",
  ])) as unknown as KeyPair
  const dh = (await subtle().generateKey({ name: "X25519" }, extractable, [
    "deriveBits",
  ])) as unknown as KeyPair
  return { sign, dh }
}

export async function publicKeys(keys: DeviceKeys): Promise<PublicKeys> {
  const ed = new Uint8Array(await subtle().exportKey("raw", keys.sign.publicKey))
  const x = new Uint8Array(await subtle().exportKey("raw", keys.dh.publicKey))
  return { ed: b64u(ed), x: b64u(x) }
}

const KEY_LEN = 32
export const rawKey = (text: string) => {
  const b = fromB64u(text)
  if (b.length !== KEY_LEN) throw new PairingError("bad_key")
  return b
}

/** A device's id: the first 16 bytes of the SHA-256 of its Ed25519 public key, base64url (22 characters). */
export async function deviceId(ed: string): Promise<string> {
  return b64u((await sha256(rawKey(ed))).slice(0, 16))
}

export const isDeviceId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{22}$/.test(v)

/** Ties a QR to one Axe account without printing the account's id. */
export async function accountTag(userId: string, macId: string): Promise<string> {
  return b64u((await sha256(te.encode(`axe-rc v1 account\n${userId}\n${macId}`))).slice(0, 16))
}

export const importX = (raw: Uint8Array) => subtle().importKey("raw", bs(raw), { name: "X25519" }, true, [])
export const importEd = (raw: Uint8Array) =>
  subtle().importKey("raw", bs(raw), { name: "Ed25519" }, true, ["verify"])

export async function signText(key: Key, text: string) {
  return b64u(new Uint8Array(await subtle().sign({ name: "Ed25519" }, key, bs(te.encode(text)))))
}

export async function verifyText(ed: string, text: string, sig: string) {
  const raw = fromB64u(sig)
  if (raw.length !== 64) return false
  return subtle().verify({ name: "Ed25519" }, await importEd(rawKey(ed)), bs(raw), bs(te.encode(text)))
}

export async function hmac(secret: Uint8Array, text: string) {
  const key = await subtle().importKey("raw", bs(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await subtle().sign("HMAC", key, bs(te.encode(text))))
}

// ---------------------------------------------------------------------------------------------
// Sealed boxes: an ephemeral X25519 key, HKDF-SHA256, AES-256-GCM. Only the holder of the
// recipient's X25519 private key can open one. Layout: ephemeral public key (32) | nonce (12) | ciphertext.

async function boxKey(shared: ArrayBuffer, salt: Uint8Array, info: string) {
  const ikm = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"])
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(te.encode(info)) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

export async function seal(to: string, plaintext: Uint8Array, info: string, aad: string): Promise<string> {
  const recipient = rawKey(to)
  const eph = (await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"])) as unknown as KeyPair
  const ephRaw = new Uint8Array(await subtle().exportKey("raw", eph.publicKey))
  const shared = await subtle().deriveBits(
    { name: "X25519", public: await importX(recipient) },
    eph.privateKey,
    256,
  )
  const key = await boxKey(shared, concat(ephRaw, recipient), info)
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: bs(nonce), additionalData: bs(te.encode(aad)) },
    key,
    bs(plaintext),
  )
  return b64u(concat(ephRaw, nonce, new Uint8Array(ct)))
}

export async function open(
  mine: DeviceKeys,
  myX: string,
  sealed: string,
  info: string,
  aad: string,
): Promise<Uint8Array> {
  const box = fromB64u(sealed)
  if (box.length < 32 + 12 + 16) throw new PairingError("bad_box")
  const ephRaw = box.slice(0, 32)
  try {
    const shared = await subtle().deriveBits(
      { name: "X25519", public: await importX(ephRaw) },
      mine.dh.privateKey,
      256,
    )
    const key = await boxKey(shared, concat(ephRaw, rawKey(myX)), info)
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: bs(box.slice(32, 44)), additionalData: bs(te.encode(aad)) },
      key,
      bs(box.slice(44)),
    )
    return new Uint8Array(pt)
  } catch {
    throw new PairingError("bad_box")
  }
}
