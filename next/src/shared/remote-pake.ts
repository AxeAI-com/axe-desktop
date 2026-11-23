import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js"
import { bytesToNumberLE } from "@noble/curves/utils.js"

import {
  accountTag,
  b64u,
  bs,
  deviceId,
  fromB64u,
  isDeviceId,
  rawKey,
  same,
  sha256,
  subtle,
  te,
} from "./remote-crypto"
import { cleanName, type PairingQR } from "./remote-pairing"

// Pairing a browser with an Axe desktop app without a camera: a 6-digit code, or one click. The same
// file lives in axe-mac next/src/shared/remote-pake.ts: keep the two identical (remote-pake.test.ts
// checks both against remote-pake.vectors.json). Threat model: axe-web
// docs/decisions/0003-pair-by-code-or-click.md.
//
// Both ways end in what a QR gives the browser: the computer's public keys and a 32-byte secret that
// the server never learns. The browser then builds a PairingQR from them (pairingQRFrom) and the
// QR pairing in remote-pairing.ts runs unchanged, so /remote works the same after any of the three.
//
// Code (CPace on ristretto255): the computer shows 6 digits. The browser and the computer each send
// one point on a generator derived from the code and the computer's public offer; the shared point
// gives the secret. A server in the middle gets one online guess per code (the computer burns the
// code on the first try), and seeing both messages tells it nothing it can test the code against.
//
// Click (commit, then reveal, then compare): the browser commits to its point and nonce, the computer
// answers with its own, the browser opens its commitment. Both show the same 6-digit check number,
// and you press Allow on the computer only when it matches. A server in the middle has to fix its
// side before it sees the other's, so it matches with probability one in a million.

export const PAKE_VERSION = 1
/** A code works for 2 minutes after it's shown, once. */
export const PAIR_CODE_MS = 120_000
export const PAIR_CODE_DIGITS = 6

const Point = ristretto255.Point
type P = InstanceType<typeof Point>
const N = Point.Fn.ORDER

/** Random bytes; tests pass their own to check the fixed vectors. */
export type Random = (n: number) => Uint8Array
const cryptoRandom: Random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))

/** A scalar from 64 random bytes (no bias), never zero. */
function scalar(random: Random): bigint {
  for (;;) {
    const k = bytesToNumberLE(random(64)) % N
    if (k !== 0n) return k
  }
}

/** A point from the other side: canonical, and not the identity. */
function point(text: string): P {
  let p: P
  try {
    p = Point.fromBytes(fromB64u(text))
  } catch {
    throw new PakeError("bad_point")
  }
  if (p.is0()) throw new PakeError("bad_point")
  return p
}

export class PakeError extends Error {
  constructor(public code: "bad_point" | "bad_commit" | "bad_offer" | "bad_code") {
    super(code)
  }
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string) {
  const key = await subtle().importKey("raw", bs(ikm), "HKDF", false, ["deriveBits"])
  const bits = await subtle().deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(te.encode(info)) },
    key,
    256,
  )
  return new Uint8Array(bits)
}

/** Six digits from a CSPRNG, without modulo bias. */
export function newPairCode(random: Random = cryptoRandom): string {
  for (;;) {
    const b = random(4)
    const n = ((b[0] ?? 0) * 2 ** 24 + (b[1] ?? 0) * 2 ** 16 + (b[2] ?? 0) * 2 ** 8 + (b[3] ?? 0)) >>> 0
    if (n < 4_294_000_000) return String(n % 1_000_000).padStart(PAIR_CODE_DIGITS, "0")
  }
}

/** What someone typed, as the 6 digits, or undefined. Spaces and dashes are fine. */
export function readPairCode(typed: string): string | undefined {
  const digits = typed.replace(/[\s-]/g, "")
  return /^\d{6}$/.test(digits) ? digits : undefined
}

// ---------------------------------------------------------------------------------------------
// The computer's public offer: what a QR carries, minus the secret. It reaches the browser through
// the server, so nothing in it is trusted until the secret proves it (every byte is in the transcript).

export type MacOffer = {
  v: 1
  /** deviceId of `ed`. */
  mac: string
  name: string
  ed: string
  x: string
  /** accountTag(userId, mac). */
  acct: string
}

export async function newOffer(input: {
  keys: { ed: string; x: string }
  name: string
  userId: string
}): Promise<MacOffer> {
  const mac = await deviceId(input.keys.ed)
  return {
    v: 1,
    mac,
    name: cleanName(input.name),
    ed: input.keys.ed,
    x: input.keys.x,
    acct: await accountTag(input.userId, mac),
  }
}

/** Reads an offer from the server. Undefined when it isn't well formed. */
export function parseOffer(o: unknown): MacOffer | undefined {
  try {
    const q = o as Partial<MacOffer>
    if (q.v !== PAKE_VERSION || !isDeviceId(q.mac) || !isDeviceId(q.acct)) return undefined
    if (typeof q.name !== "string" || typeof q.ed !== "string" || typeof q.x !== "string") return undefined
    rawKey(q.ed)
    rawKey(q.x)
    return { v: 1, mac: q.mac, name: cleanName(q.name), ed: q.ed, x: q.x, acct: q.acct }
  } catch {
    return undefined
  }
}

/** Why the browser shouldn't go on with this offer, or undefined when it's fine. */
export async function checkOffer(
  offer: MacOffer,
  userId: string,
): Promise<"bad_offer" | "other_account" | undefined> {
  if ((await deviceId(offer.ed)) !== offer.mac) return "bad_offer"
  if ((await accountTag(userId, offer.mac)) !== offer.acct) return "other_account"
  return undefined
}

const offerLines = (o: MacOffer) => [o.mac, o.ed, o.x, o.acct]

/** The QR the browser would have scanned: feed it to checkQR, makePairRequest and openPairAnswer. */
export function pairingQRFrom(offer: MacOffer, secret: Uint8Array, exp: number): PairingQR {
  return {
    v: 1,
    mac: offer.mac,
    name: offer.name,
    ed: offer.ed,
    x: offer.x,
    s: b64u(secret),
    exp,
    acct: offer.acct,
  }
}

// ---------------------------------------------------------------------------------------------
// Code: CPace (draft-irtf-cfrg-cpace) on ristretto255, with fixed roles: the browser starts.

const CODE_DST = "axe-rc v1 CPace ristretto255"
const CODE_INFO = "axe-rc v1 code secret"

const generator = (code: string, offer: MacOffer, nB: string) =>
  ristretto255_hasher.hashToCurve(te.encode(["axe-rc v1 code", code, ...offerLines(offer), nB].join("\n")), {
    DST: CODE_DST,
  })

const codeTranscript = (offer: MacOffer, nB: string, yB: string, yM: string) =>
  ["axe-rc v1 code transcript", ...offerLines(offer), nB, yB, yM].join("\n")

/** Browser → computer: one point for this code and offer. */
export type CodeHello = { n: string; y: string }
/** Computer → browser. */
export type CodeReply = { y: string }

export type CodeStart = { hello: CodeHello; finish: (reply: CodeReply) => Promise<Uint8Array> }

/** The browser starts with the code you typed. finish() gives the secret (wrong code: a different one). */
export function codeStart(input: { offer: MacOffer; code: string; random?: Random }): CodeStart {
  const random = input.random ?? cryptoRandom
  const code = readPairCode(input.code)
  if (!code) throw new PakeError("bad_code")
  const n = b64u(random(32))
  const y = scalar(random)
  const yB = b64u(generator(code, input.offer, n).multiply(y).toBytes())
  return {
    hello: { n, y: yB },
    finish: async (reply) => {
      const k = point(reply.y).multiply(y).toBytes()
      return hkdf(k, await sha256(te.encode(codeTranscript(input.offer, n, yB, reply.y))), CODE_INFO)
    },
  }
}

/** The computer answers with its own offer and the code on its screen. Burn the code before calling. */
export async function codeRespond(input: {
  offer: MacOffer
  code: string
  hello: CodeHello
  random?: Random
}): Promise<{ reply: CodeReply; secret: Uint8Array }> {
  const random = input.random ?? cryptoRandom
  if (typeof input.hello.n !== "string" || fromB64u(input.hello.n).length !== 32)
    throw new PakeError("bad_point")
  const theirs = point(input.hello.y)
  const y = scalar(random)
  const yM = b64u(generator(input.code, input.offer, input.hello.n).multiply(y).toBytes())
  const k = theirs.multiply(y).toBytes()
  const secret = await hkdf(
    k,
    await sha256(te.encode(codeTranscript(input.offer, input.hello.n, input.hello.y, yM))),
    CODE_INFO,
  )
  return { reply: { y: yM }, secret }
}

// ---------------------------------------------------------------------------------------------
// Click: an unauthenticated exchange with a commitment, checked by a 6-digit number you compare.

const CLICK_INFO = "axe-rc v1 click secret"

const commitOf = (y: string, n: string) => sha256(te.encode(["axe-rc v1 click commit", y, n].join("\n")))

const clickTranscript = (offer: MacOffer, commit: string, macHalf: ClickMacHalf, reveal: ClickReveal) =>
  ["axe-rc v1 click transcript", ...offerLines(offer), commit, macHalf.y, macHalf.n, reveal.y, reveal.n].join(
    "\n",
  )

/** 6 digits from the transcript, shown on both screens ("123 456"). */
async function checkNumber(t: string) {
  const h = await sha256(te.encode(`axe-rc v1 click check\n${t}`))
  let v = 0n
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(h[i] ?? 0)
  return String(v % 1_000_000n).padStart(6, "0")
}

/** The browser's commitment (sent first). */
export type ClickCommit = { c: string }
/** The computer's half, sent only after it has the commitment. */
export type ClickMacHalf = { y: string; n: string }
/** The browser opens its commitment. */
export type ClickReveal = { y: string; n: string }

export type ClickStart = {
  commit: ClickCommit
  /** With the computer's half and offer: what to send next, the number to show, and the secret. */
  reveal: (
    macHalf: ClickMacHalf,
    offer: MacOffer,
  ) => Promise<{ reveal: ClickReveal; check: string; secret: Uint8Array }>
}

export async function clickStart(random: Random = cryptoRandom): Promise<ClickStart> {
  const y = scalar(random)
  const yB = b64u(Point.BASE.multiply(y).toBytes())
  const n = b64u(random(32))
  const c = b64u(await commitOf(yB, n))
  return {
    commit: { c },
    reveal: async (macHalf, offer) => {
      const k = point(macHalf.y).multiply(y).toBytes()
      const reveal = { y: yB, n }
      const t = clickTranscript(offer, c, macHalf, reveal)
      return {
        reveal,
        check: await checkNumber(t),
        secret: await hkdf(k, await sha256(te.encode(t)), CLICK_INFO),
      }
    },
  }
}

export type ClickMac = {
  half: ClickMacHalf
  /** With the browser's reveal: the number to show and the secret. Throws when the reveal doesn't open the commitment. */
  open: (reveal: ClickReveal) => Promise<{ check: string; secret: Uint8Array }>
}

/** The computer, once it has the browser's commitment and nothing else. */
export function clickRespond(input: { offer: MacOffer; commit: ClickCommit; random?: Random }): ClickMac {
  const random = input.random ?? cryptoRandom
  if (typeof input.commit.c !== "string" || fromB64u(input.commit.c).length !== 32)
    throw new PakeError("bad_commit")
  const y = scalar(random)
  const half = { y: b64u(Point.BASE.multiply(y).toBytes()), n: b64u(random(32)) }
  return {
    half,
    open: async (reveal) => {
      if (typeof reveal.n !== "string" || fromB64u(reveal.n).length !== 32) throw new PakeError("bad_commit")
      if (!same(await commitOf(reveal.y, reveal.n), fromB64u(input.commit.c)))
        throw new PakeError("bad_commit")
      const k = point(reveal.y).multiply(y).toBytes()
      const t = clickTranscript(input.offer, input.commit.c, half, reveal)
      return { check: await checkNumber(t), secret: await hkdf(k, await sha256(te.encode(t)), CLICK_INFO) }
    },
  }
}
