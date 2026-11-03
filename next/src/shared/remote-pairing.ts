import {
  accountTag,
  b64u,
  concat,
  type DeviceKeys,
  deviceId,
  fromB64u,
  hmac,
  isDeviceId,
  open,
  PairingError,
  type PublicKeys,
  publicKeys,
  rawKey,
  same,
  seal,
  sha256,
  signText,
  td,
  te,
  verifyText,
} from "./remote-crypto"

export * from "./remote-crypto"

// Pairing a phone with an Axe desktop app (remote control, step 2). The same file lives in axe-mac
// next/src/shared/remote-pairing.ts: keep the two identical (remote-pairing.test.ts checks both against
// the same fixed vectors). WebCrypto only, so it runs in Node 24 (Electron) and in phone browsers.
// Threat model: axe-mac docs/remote-control-SECURITY.md, sections 4 and 12.
//
// 1. The Mac shows a QR: its id, public keys, a one-time secret `s`, an expiry and an account tag.
//    `s` goes from the Mac's screen to the phone's camera and never through the server.
// 2. The phone seals a pairing request to the Mac's X25519 key: its own public keys and name, a MAC
//    keyed by `s` and a signature by its own Ed25519 key, over one transcript.
// 3. The Mac opens it, checks the MAC and the signature, burns `s` and asks you: Allow or Not me.
// 4. The Mac seals its answer to the phone's X25519 key, MAC'd with `s` and signed by the Mac.
// A server that swaps either key fails the MAC, since it never sees `s`.

export const PAIRING_VERSION = 1
/** How long a QR's secret works after it's shown. */
export const PAIRING_SECRET_MS = 120_000
/** Extra time for a scan already on its way when the QR changes. */
export const PAIRING_GRACE_MS = 20_000
/** How far a request's clock may be from the Mac's. */
const CLOCK_SKEW_MS = 5 * 60_000

// ---------------------------------------------------------------------------------------------
// The QR

export type PairingQR = {
  v: 1
  /** The Mac's id (deviceId of `ed`). */
  mac: string
  /** The Mac's name, shown on the phone while it waits. */
  name: string
  ed: string
  x: string
  /** The one-time secret, 32 bytes. */
  s: string
  /** Expiry, ms since 1970. */
  exp: number
  /** accountTag(userId, mac). */
  acct: string
}

const NAME_MAX = 80
/** Names travel inside signed text: one line, no control characters. */
export const cleanName = (name: string) =>
  Array.from(name, (ch) => {
    const c = ch.codePointAt(0) ?? 0
    return c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 ? " " : ch
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX)

/** The QR's text: a link, so a phone's own camera opens it too. The part after # never reaches a server. */
export function qrLink(origin: string, qr: PairingQR): string {
  return `${origin.replace(/\/$/, "")}/connect#${b64u(te.encode(JSON.stringify(qr)))}`
}

/** Reads a scanned QR (the whole link or just what follows #). Undefined when it isn't one of ours. */
export function parseQR(text: string): PairingQR | undefined {
  try {
    const fragment = text.includes("#") ? text.slice(text.indexOf("#") + 1) : text
    if (fragment.length > 1024) return undefined
    const q = JSON.parse(td.decode(fromB64u(fragment.trim()))) as Partial<PairingQR>
    if (q.v !== PAIRING_VERSION || !isDeviceId(q.mac) || !isDeviceId(q.acct)) return undefined
    if (typeof q.name !== "string" || typeof q.exp !== "number" || !Number.isFinite(q.exp)) return undefined
    if (typeof q.ed !== "string" || typeof q.x !== "string" || typeof q.s !== "string") return undefined
    rawKey(q.ed)
    rawKey(q.x)
    if (fromB64u(q.s).length !== 32) return undefined
    return { v: 1, mac: q.mac, name: cleanName(q.name), ed: q.ed, x: q.x, s: q.s, exp: q.exp, acct: q.acct }
  } catch {
    return undefined
  }
}

/** A fresh QR for this Mac. */
export async function newQR(input: {
  keys: PublicKeys
  name: string
  userId: string
  now: number
}): Promise<PairingQR> {
  const mac = await deviceId(input.keys.ed)
  return {
    v: 1,
    mac,
    name: cleanName(input.name),
    ed: input.keys.ed,
    x: input.keys.x,
    s: b64u(globalThis.crypto.getRandomValues(new Uint8Array(32))),
    exp: input.now + PAIRING_SECRET_MS,
    acct: await accountTag(input.userId, mac),
  }
}

/** Why the phone shouldn't send anything for this QR, or undefined when it's fine. */
export async function checkQR(
  qr: PairingQR,
  userId: string,
  now: number,
): Promise<"expired" | "other_account" | "bad_qr" | undefined> {
  if ((await deviceId(qr.ed)) !== qr.mac) return "bad_qr"
  if ((await accountTag(userId, qr.mac)) !== qr.acct) return "other_account"
  if (now > qr.exp + PAIRING_GRACE_MS) return "expired"
  return undefined
}

// ---------------------------------------------------------------------------------------------
// The request (phone → Mac) and the answer (Mac → phone)

export type PhoneHello = {
  /** deviceId of `ed`. */
  phone: string
  ed: string
  x: string
  /** "David's iPhone" */
  name: string
  /** "Safari on iPhone" */
  agent: string
  /** The phone's clock, ms. */
  at: number
}

const REQUEST_INFO = "axe-rc v1 pair-request"
const ANSWER_INFO = "axe-rc v1 pair-answer"

/** One line per field, in a fixed order: what the MACs and signatures cover. */
function transcript(qr: Pick<PairingQR, "mac" | "ed" | "x">, phone: PhoneHello) {
  return [
    "axe-rc v1 pair",
    qr.mac,
    qr.ed,
    qr.x,
    phone.phone,
    phone.ed,
    phone.x,
    phone.name,
    phone.agent,
    String(phone.at),
  ].join("\n")
}

/** The phone's sealed request for this QR. */
export async function makePairRequest(input: {
  qr: PairingQR
  keys: DeviceKeys
  name: string
  agent: string
  now: number
}): Promise<{ mac: string; phone: string; sealed: string }> {
  const pub = await publicKeys(input.keys)
  const hello: PhoneHello = {
    phone: await deviceId(pub.ed),
    ed: pub.ed,
    x: pub.x,
    name: cleanName(input.name),
    agent: cleanName(input.agent),
    at: input.now,
  }
  const t = transcript(input.qr, hello)
  const body = {
    ...hello,
    mac: b64u(await hmac(fromB64u(input.qr.s), t)),
    sig: await signText(input.keys.sign.privateKey, t),
  }
  const sealed = await seal(
    input.qr.x,
    te.encode(JSON.stringify(body)),
    REQUEST_INFO,
    `${REQUEST_INFO}\n${input.qr.mac}`,
  )
  return { mac: input.qr.mac, phone: hello.phone, sealed }
}

/**
 * The Mac opens a request. `secrets` are the QR secrets still live on this Mac. Returns the phone and
 * the secret it proved it saw (burn it), or throws PairingError. Nothing here asks you anything.
 */
export async function openPairRequest(input: {
  sealed: string
  keys: DeviceKeys
  pub: PublicKeys
  secrets: string[]
  now: number
}): Promise<{ phone: PhoneHello; secret: string }> {
  const mac = await deviceId(input.pub.ed)
  const pt = await open(input.keys, input.pub.x, input.sealed, REQUEST_INFO, `${REQUEST_INFO}\n${mac}`)
  let body: Partial<PhoneHello & { mac: string; sig: string }>
  try {
    body = JSON.parse(td.decode(pt))
  } catch {
    throw new PairingError("bad_request")
  }
  const { phone, ed, x, name, agent, at, mac: tag, sig } = body
  if (typeof ed !== "string" || typeof x !== "string" || typeof tag !== "string" || typeof sig !== "string")
    throw new PairingError("bad_request")
  if (typeof name !== "string" || typeof agent !== "string" || typeof at !== "number" || !isDeviceId(phone))
    throw new PairingError("bad_request")
  if ((await deviceId(ed)) !== phone) throw new PairingError("bad_request")
  rawKey(x)
  if (Math.abs(input.now - at) > CLOCK_SKEW_MS) throw new PairingError("clock")
  const hello: PhoneHello = { phone, ed, x, name: cleanName(name), agent: cleanName(agent), at }
  if (hello.name !== name || hello.agent !== agent) throw new PairingError("bad_request")
  const t = transcript({ mac, ed: input.pub.ed, x: input.pub.x }, hello)
  const given = fromB64u(tag)
  let secret: string | undefined
  for (const s of input.secrets) if (same(await hmac(fromB64u(s), t), given)) secret = s
  if (!secret) throw new PairingError("wrong_secret")
  if (!(await verifyText(ed, t, sig))) throw new PairingError("bad_signature")
  return { phone: hello, secret }
}

export type PairAnswer = { ok: boolean; mac: string; phone: string; at: number }

const answerText = (qr: Pick<PairingQR, "mac" | "ed" | "x">, phone: PhoneHello, a: PairAnswer) =>
  ["axe-rc v1 paired", transcript(qr, phone), a.ok ? "allowed" : "declined", String(a.at)].join("\n")

/** The Mac's sealed answer: MAC'd with the same secret and signed by the Mac. */
export async function makePairAnswer(input: {
  phone: PhoneHello
  secret: string
  keys: DeviceKeys
  pub: PublicKeys
  ok: boolean
  now: number
}) {
  const mac = await deviceId(input.pub.ed)
  const answer: PairAnswer = { ok: input.ok, mac, phone: input.phone.phone, at: input.now }
  const t = answerText({ mac, ed: input.pub.ed, x: input.pub.x }, input.phone, answer)
  const body = {
    ...answer,
    tag: b64u(await hmac(fromB64u(input.secret), t)),
    sig: await signText(input.keys.sign.privateKey, t),
  }
  return seal(
    input.phone.x,
    te.encode(JSON.stringify(body)),
    ANSWER_INFO,
    `${ANSWER_INFO}\n${input.phone.phone}`,
  )
}

/** The phone opens the Mac's answer. True: allowed. False: you said Not me. Throws when it isn't genuine. */
export async function openPairAnswer(input: {
  sealed: string
  qr: PairingQR
  keys: DeviceKeys
  hello: PhoneHello
}): Promise<boolean> {
  const pt = await open(
    input.keys,
    input.hello.x,
    input.sealed,
    ANSWER_INFO,
    `${ANSWER_INFO}\n${input.hello.phone}`,
  )
  let body: Partial<PairAnswer & { tag: string; sig: string }>
  try {
    body = JSON.parse(td.decode(pt))
  } catch {
    throw new PairingError("bad_answer")
  }
  if (
    typeof body.ok !== "boolean" ||
    body.mac !== input.qr.mac ||
    body.phone !== input.hello.phone ||
    typeof body.at !== "number"
  )
    throw new PairingError("bad_answer")
  if (typeof body.tag !== "string" || typeof body.sig !== "string") throw new PairingError("bad_answer")
  const t = answerText(input.qr, input.hello, { ok: body.ok, mac: body.mac, phone: body.phone, at: body.at })
  if (!same(await hmac(fromB64u(input.qr.s), t), fromB64u(body.tag))) throw new PairingError("wrong_secret")
  if (!(await verifyText(input.qr.ed, t, body.sig))) throw new PairingError("bad_signature")
  return body.ok
}

/** The hello a phone sent, rebuilt from its keys and what it sent (the phone keeps it to open the answer). */
export async function helloFor(input: {
  keys: DeviceKeys
  name: string
  agent: string
  at: number
}): Promise<PhoneHello> {
  const pub = await publicKeys(input.keys)
  return {
    phone: await deviceId(pub.ed),
    ed: pub.ed,
    x: pub.x,
    name: cleanName(input.name),
    agent: cleanName(input.agent),
    at: input.at,
  }
}

// ---------------------------------------------------------------------------------------------
// The allowed phones list on the Mac: each entry signed by the Mac, so an entry nobody allowed here
// (written by anything else) is ignored.

export type AllowedPhone = {
  phone: string
  ed: string
  x: string
  name: string
  agent: string
  addedAt: number
}

const entryText = (mac: string, e: AllowedPhone) =>
  ["axe-rc v1 allowed", mac, e.phone, e.ed, e.x, e.name, e.agent, String(e.addedAt)].join("\n")

export async function signAllowed(keys: DeviceKeys, pub: PublicKeys, e: AllowedPhone): Promise<string> {
  return signText(keys.sign.privateKey, entryText(await deviceId(pub.ed), e))
}

export async function verifyAllowed(pub: PublicKeys, e: AllowedPhone, sig: string): Promise<boolean> {
  try {
    if ((await deviceId(e.ed)) !== e.phone) return false
    return await verifyText(pub.ed, entryText(await deviceId(pub.ed), e), sig)
  } catch {
    return false
  }
}
