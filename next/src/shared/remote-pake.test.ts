import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  checkQR,
  generateDeviceKeys,
  helloFor,
  makePairAnswer,
  makePairRequest,
  openPairAnswer,
  openPairRequest,
  publicKeys,
} from "./remote-pairing"
import {
  checkOffer,
  clickRespond,
  clickStart,
  codeRespond,
  codeStart,
  type MacOffer,
  newOffer,
  newPairCode,
  PakeError,
  pairingQRFrom,
  parseOffer,
  type Random,
  readPairCode,
} from "./remote-pake"

// Pairing by code or click (docs/decisions/0003-pair-by-code-or-click.md). The same file and vectors live
// in axe-mac next/src/shared: the vectors test proves both copies agree.

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url")

/** A fixed stream of "random" bytes, so a run can be replayed exactly. */
function fixed(seed: string): Random {
  let i = 0
  return (n) => {
    const out = new Uint8Array(n)
    for (let o = 0; o < n; o += 32) {
      const block = createHash("sha256").update(`${seed}:${i++}`).digest()
      out.set(block.subarray(0, Math.min(32, n - o)), o)
    }
    return out
  }
}

async function macSetup(userId = "user-1") {
  const keys = await generateDeviceKeys(true)
  const pub = await publicKeys(keys)
  return { keys, pub, offer: await newOffer({ keys: pub, name: "David's Mac", userId }) }
}

describe("codes", () => {
  it("are six digits and read back with spaces", () => {
    for (let i = 0; i < 50; i++) expect(newPairCode()).toMatch(/^\d{6}$/)
    expect(readPairCode("123 456")).toBe("123456")
    expect(readPairCode("123-456")).toBe("123456")
    expect(readPairCode("12345")).toBeUndefined()
    expect(readPairCode("12345a")).toBeUndefined()
  })
})

describe("pairing by code", () => {
  it("gives both sides the same secret, and the QR pairing runs on it", async () => {
    const mac = await macSetup()
    const code = "042917"
    const start = codeStart({ offer: mac.offer, code })
    const { reply, secret } = await codeRespond({ offer: mac.offer, code, hello: start.hello })
    const theirs = await start.finish(reply)
    expect(b64u(theirs)).toBe(b64u(secret))

    // The QR pairing on top, as the browser and the computer run it.
    const now = Date.now()
    const qr = pairingQRFrom(mac.offer, theirs, now + 120_000)
    expect(await checkQR(qr, "user-1", now)).toBeUndefined()
    const phone = await generateDeviceKeys(false)
    const req = await makePairRequest({ qr, keys: phone, name: "David's Mac", agent: "Chrome on Mac", now })
    const opened = await openPairRequest({
      sealed: req.sealed,
      keys: mac.keys,
      pub: mac.pub,
      secrets: [b64u(secret)],
      now,
    })
    const answer = await makePairAnswer({
      phone: opened.phone,
      secret: opened.secret,
      keys: mac.keys,
      pub: mac.pub,
      ok: true,
      now,
    })
    const hello = await helloFor({ keys: phone, name: "David's Mac", agent: "Chrome on Mac", at: now })
    expect(await openPairAnswer({ sealed: answer, qr, keys: phone, hello })).toBe(true)
  })

  it("a wrong code gives a different secret, so the pairing request fails", async () => {
    const mac = await macSetup()
    const start = codeStart({ offer: mac.offer, code: "111111" })
    const { reply, secret } = await codeRespond({ offer: mac.offer, code: "111112", hello: start.hello })
    expect(b64u(await start.finish(reply))).not.toBe(b64u(secret))
  })

  it("an offer swapped by the server gives a different secret", async () => {
    const mac = await macSetup()
    const other = await macSetup()
    const fake: MacOffer = { ...mac.offer, x: other.offer.x }
    const start = codeStart({ offer: fake, code: "222222" })
    const { reply, secret } = await codeRespond({ offer: mac.offer, code: "222222", hello: start.hello })
    expect(b64u(await start.finish(reply))).not.toBe(b64u(secret))
  })

  it("refuses the identity and malformed points", async () => {
    const mac = await macSetup()
    const zero = b64u(new Uint8Array(32))
    await expect(
      codeRespond({ offer: mac.offer, code: "333333", hello: { n: b64u(new Uint8Array(32)), y: zero } }),
    ).rejects.toBeInstanceOf(PakeError)
    await expect(
      codeRespond({
        offer: mac.offer,
        code: "333333",
        hello: { n: b64u(new Uint8Array(32)), y: b64u(new Uint8Array(32).fill(255)) },
      }),
    ).rejects.toBeInstanceOf(PakeError)
    const start = codeStart({ offer: mac.offer, code: "333333" })
    await expect(start.finish({ y: zero })).rejects.toBeInstanceOf(PakeError)
    expect(() => codeStart({ offer: mac.offer, code: "12" })).toThrow(PakeError)
  })
})

describe("pairing by click", () => {
  it("both sides show the same number and get the same secret", async () => {
    const mac = await macSetup()
    const b = await clickStart()
    const m = clickRespond({ offer: mac.offer, commit: b.commit })
    const browser = await b.reveal(m.half, mac.offer)
    const computer = await m.open(browser.reveal)
    expect(browser.check).toMatch(/^\d{6}$/)
    expect(browser.check).toBe(computer.check)
    expect(b64u(browser.secret)).toBe(b64u(computer.secret))
  })

  it("a reveal that doesn't open the commitment is refused", async () => {
    const mac = await macSetup()
    const b = await clickStart()
    const other = await clickStart()
    const m = clickRespond({ offer: mac.offer, commit: b.commit })
    const { reveal } = await other.reveal(m.half, mac.offer)
    await expect(m.open(reveal)).rejects.toBeInstanceOf(PakeError)
  })

  it("a server in the middle gets different numbers on the two screens", async () => {
    const mac = await macSetup()
    const evil = await macSetup()
    const b = await clickStart()
    // The server answers the browser as a fake computer, and talks to the real one as a fake browser.
    const fakeMac = clickRespond({ offer: evil.offer, commit: b.commit })
    const browser = await b.reveal(fakeMac.half, evil.offer)
    const fakeBrowser = await clickStart()
    const m = clickRespond({ offer: mac.offer, commit: fakeBrowser.commit })
    const sent = await fakeBrowser.reveal(m.half, mac.offer)
    const computer = await m.open(sent.reveal)
    expect(browser.check).not.toBe(computer.check)
  })
})

describe("offers", () => {
  it("parse, and check the account and id", async () => {
    const mac = await macSetup("user-1")
    expect(parseOffer(JSON.parse(JSON.stringify(mac.offer)))).toEqual(mac.offer)
    expect(parseOffer({ ...mac.offer, v: 2 })).toBeUndefined()
    expect(parseOffer({ ...mac.offer, ed: "nope" })).toBeUndefined()
    expect(await checkOffer(mac.offer, "user-1")).toBeUndefined()
    expect(await checkOffer(mac.offer, "user-2")).toBe("other_account")
    const other = await macSetup()
    expect(await checkOffer({ ...mac.offer, ed: other.offer.ed }, "user-1")).toBe("bad_offer")
  })
})

// ---------------------------------------------------------------------------------------------
// Fixed vectors: deterministic randomness, so the axe-mac copy must give byte-for-byte the same output.
// UPDATE_VECTORS=1 rewrites the file (only when the protocol changes on purpose, in both repos).

const VECTORS = new URL("./remote-pake.vectors.json", import.meta.url)

async function runVectors() {
  const offer: MacOffer = {
    v: 1,
    mac: "jZYVl8_hAIvMdHcT9FJi6g",
    name: "David's Mac",
    ed: "5jnHuvz0w1VU8O1iwWoofQ2EOxuT-EAUECU-N3g-Bbk",
    x: "6lMvGn6kKiAa0n7XHYbBuzK-JF-fDnYVIuchmMIaqHg",
    acct: "3mdgVXe6_9CDrgbiElkVlw",
  }
  const code = newPairCode(fixed("code"))
  const start = codeStart({ offer, code, random: fixed("browser") })
  const mac = await codeRespond({ offer, code, hello: start.hello, random: fixed("mac") })
  const codeSecret = b64u(await start.finish(mac.reply))
  const click = await clickStart(fixed("click-browser"))
  const m = clickRespond({ offer, commit: click.commit, random: fixed("click-mac") })
  const b = await click.reveal(m.half, offer)
  const opened = await m.open(b.reveal)
  return {
    offer,
    code: { code, hello: start.hello, reply: mac.reply, secret: codeSecret, macSecret: b64u(mac.secret) },
    click: {
      commit: click.commit,
      half: m.half,
      reveal: b.reveal,
      check: b.check,
      secret: b64u(b.secret),
      macCheck: opened.check,
      macSecret: b64u(opened.secret),
    },
  }
}

describe("fixed vectors (the same in axe-web and axe-mac)", () => {
  it("match", async () => {
    const got = await runVectors()
    expect(got.code.secret).toBe(got.code.macSecret)
    expect(got.click.check).toBe(got.click.macCheck)
    expect(got.click.secret).toBe(got.click.macSecret)
    if (process.env.UPDATE_VECTORS) writeFileSync(VECTORS, `${JSON.stringify(got, null, 2)}\n`)
    expect(got).toEqual(JSON.parse(readFileSync(VECTORS, "utf8")))
  })
})
