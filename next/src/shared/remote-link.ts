// The sealed link between a paired phone and its Mac (remote control, step 3). The same file lives in
// axe-mac next/src/shared/remote-link.ts: keep the two identical. Threat model: axe-mac
// docs/remote-control-SECURITY.md, section 5.
//
// Every connection starts with a fresh handshake (the SIGMA pattern): each side sends a new X25519 key
// signed by its device Ed25519 key, the Mac checks the phone's key against its signed list, the phone
// checks the Mac's key against the one it pinned when pairing. HKDF over the shared secret and the
// transcript gives one AES-256-GCM key per direction. Frames are numbered; the receiver takes only the
// next number, so a replayed, reordered, cut or changed frame is dropped. The relay sees ids, numbers,
// chat ids and sizes, nothing else.

import { b64u, type DeviceKeys, fromB64u, sha256, signText, td, te, verifyText } from "./remote-crypto"

export const LINK_VERSION = 1
/** New keys after this many frames or this long, whichever comes first (the side that notices reconnects). */
export const REKEY_FRAMES = 2 ** 24
export const REKEY_MS = 60 * 60_000

const subtle = () => globalThis.crypto.subtle
type Key = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>
const bs = (b: Uint8Array) => b as unknown as Parameters<typeof globalThis.crypto.subtle.digest>[1]

export class LinkError extends Error {
  readonly code: "order" | "tampered" | "handshake" | "rekey"
  constructor(code: "order" | "tampered" | "handshake" | "rekey") {
    super(code)
    this.code = code
  }
}

/** Phone → Mac, first. */
export type Hello1 = { t: "hs1"; v: 1; mac: string; phone: string; eph: string; n: string; sig: string }
/** Mac → phone. */
export type Hello2 = { t: "hs2"; eph: string; n: string; sig: string }
/** A sealed frame: its number, the chat it belongs to ("" for none) and the ciphertext. */
export type Frame = { t: "f"; s: number; c: string; d: string }

const hs1Text = (h: Omit<Hello1, "t" | "v" | "sig">) =>
  ["axe-rc v1 hs1", h.mac, h.phone, h.eph, h.n].join("\n")
const transcript = (h1: Omit<Hello1, "t" | "v" | "sig">, h2: Omit<Hello2, "t" | "sig">) =>
  ["axe-rc v1 hs", h1.mac, h1.phone, h1.eph, h1.n, h2.eph, h2.n].join("\n")

async function ephemeral() {
  const pair = (await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"])) as unknown as {
    privateKey: Key
    publicKey: Key
  }
  return { pair, pub: b64u(new Uint8Array(await subtle().exportKey("raw", pair.publicKey))) }
}

const nonce16 = () => b64u(globalThis.crypto.getRandomValues(new Uint8Array(16)))

const rawKey32 = (text: string) => {
  const b = fromB64u(text)
  if (b.length !== 32) throw new LinkError("handshake")
  return b
}

export type Direction = "p2m" | "m2p"

/** One connection's keys and counters. `me` is the direction this side sends in. */
export class LinkSession {
  private sent = 0
  private expected = 0
  private readonly started = Date.now()
  constructor(
    readonly mac: string,
    readonly phone: string,
    readonly connId: string,
    private readonly me: Direction,
    private readonly sendKey: Key,
    private readonly receiveKey: Key,
  ) {}

  private aad(dir: Direction, s: number, c: string) {
    return bs(te.encode(["axe-rc v1 f", dir, this.mac, this.phone, this.connId, String(s), c].join("\n")))
  }

  private static iv(dir: Direction, s: number) {
    const iv = new Uint8Array(12)
    iv[0] = dir === "p2m" ? 1 : 2
    new DataView(iv.buffer).setBigUint64(4, BigInt(s))
    return bs(iv)
  }

  /** Time for new keys: reconnect, which handshakes again. */
  needsRekey(now = Date.now()) {
    return this.sent >= REKEY_FRAMES || this.expected >= REKEY_FRAMES || now - this.started >= REKEY_MS
  }

  async seal(message: unknown, chat = ""): Promise<Frame> {
    if (this.sent >= REKEY_FRAMES) throw new LinkError("rekey")
    const s = this.sent++
    const ct = await subtle().encrypt(
      { name: "AES-GCM", iv: LinkSession.iv(this.me, s), additionalData: this.aad(this.me, s, chat) },
      this.sendKey,
      bs(te.encode(JSON.stringify(message))),
    )
    return { t: "f", s, c: chat, d: b64u(new Uint8Array(ct)) }
  }

  /** Opens the next frame, or throws: "order" for a wrong number, "tampered" when it doesn't open. */
  async open(frame: Frame): Promise<unknown> {
    if (
      frame.t !== "f" ||
      frame.s !== this.expected ||
      typeof frame.c !== "string" ||
      typeof frame.d !== "string"
    )
      throw new LinkError("order")
    const them: Direction = this.me === "p2m" ? "m2p" : "p2m"
    let pt: ArrayBuffer
    try {
      pt = await subtle().decrypt(
        {
          name: "AES-GCM",
          iv: LinkSession.iv(them, frame.s),
          additionalData: this.aad(them, frame.s, frame.c),
        },
        this.receiveKey,
        bs(fromB64u(frame.d)),
      )
    } catch {
      throw new LinkError("tampered")
    }
    this.expected++
    try {
      return JSON.parse(td.decode(pt))
    } catch {
      throw new LinkError("tampered")
    }
  }
}

async function sessionKeys(input: {
  priv: Key
  theirEph: string
  transcript: string
  me: Direction
  mac: string
  phone: string
}) {
  let shared: ArrayBuffer
  try {
    const theirs = await subtle().importKey("raw", bs(rawKey32(input.theirEph)), { name: "X25519" }, true, [])
    shared = await subtle().deriveBits({ name: "X25519", public: theirs }, input.priv, 256)
  } catch {
    throw new LinkError("handshake")
  }
  const salt = await sha256(te.encode(input.transcript))
  const ikm = await subtle().importKey("raw", shared, "HKDF", false, ["deriveBits"])
  const bits = new Uint8Array(
    await subtle().deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(te.encode("axe-rc v1 link")) },
      ikm,
      512,
    ),
  )
  const aes = (b: Uint8Array) =>
    subtle().importKey("raw", bs(b), { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
  const p2m = await aes(bits.slice(0, 32))
  const m2p = await aes(bits.slice(32, 64))
  const connId = b64u((await sha256(te.encode(`axe-rc v1 conn\n${input.transcript}`))).slice(0, 12))
  return input.me === "p2m"
    ? new LinkSession(input.mac, input.phone, connId, "p2m", p2m, m2p)
    : new LinkSession(input.mac, input.phone, connId, "m2p", m2p, p2m)
}

/** The phone starts: its hello, and what it needs to finish once the Mac answers. */
export async function phoneHello(input: { keys: DeviceKeys; mac: string; phone: string }) {
  const eph = await ephemeral()
  const body = { mac: input.mac, phone: input.phone, eph: eph.pub, n: nonce16() }
  const hello: Hello1 = {
    t: "hs1",
    v: 1,
    ...body,
    sig: await signText(input.keys.sign.privateKey, hs1Text(body)),
  }
  return { hello, priv: eph.pair.privateKey }
}

/**
 * The Mac answers a phone's hello. `phoneEd` is the key from its own signed list (undefined: not
 * allowed, and nothing is sent back). Throws LinkError("handshake") when the hello isn't genuine.
 */
export async function macAnswer(input: {
  hello: Hello1
  keys: DeviceKeys
  mac: string
  phoneEd: string | undefined
}) {
  const h = input.hello
  if (h?.t !== "hs1" || h.v !== LINK_VERSION || h.mac !== input.mac || !input.phoneEd)
    throw new LinkError("handshake")
  rawKey32(h.eph)
  if (fromB64u(h.n).length !== 16 || !(await verifyText(input.phoneEd, hs1Text(h), h.sig).catch(() => false)))
    throw new LinkError("handshake")
  const eph = await ephemeral()
  const body = { eph: eph.pub, n: nonce16() }
  const t = transcript(h, body)
  const answer: Hello2 = {
    t: "hs2",
    ...body,
    sig: await signText(input.keys.sign.privateKey, `axe-rc v1 hs2\n${t}`),
  }
  const session = await sessionKeys({
    priv: eph.pair.privateKey,
    theirEph: h.eph,
    transcript: t,
    me: "m2p",
    mac: h.mac,
    phone: h.phone,
  })
  return { answer, session }
}

/** The phone checks the Mac's answer against the key it pinned when pairing. */
export async function phoneFinish(input: { hello: Hello1; priv: Key; answer: Hello2; macEd: string }) {
  const a = input.answer
  if (a?.t !== "hs2" || typeof a.eph !== "string" || typeof a.n !== "string" || typeof a.sig !== "string")
    throw new LinkError("handshake")
  rawKey32(a.eph)
  const t = transcript(input.hello, a)
  if (!(await verifyText(input.macEd, `axe-rc v1 hs2\n${t}`, a.sig).catch(() => false)))
    throw new LinkError("handshake")
  return sessionKeys({
    priv: input.priv,
    theirEph: a.eph,
    transcript: t,
    me: "p2m",
    mac: input.hello.mac,
    phone: input.hello.phone,
  })
}
