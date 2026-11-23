import { describe, expect, it } from "vitest"

import { clickStart, codeStart, type MacOffer, PAIR_CODE_MS, pairingQRFrom } from "@shared/remote-pake"
import {
  type DeviceKeys,
  deviceId,
  generateDeviceKeys,
  helloFor,
  makePairRequest,
  openPairAnswer,
  PAIRING_GRACE_MS,
  PAIRING_SECRET_MS,
  parseQR,
  publicKeys,
} from "@shared/remote-pairing"

import { CODE_TRIES, CODE_TRIES_MS, groupDigits, Phones, type SavedPhones, UNUSED_PHONE_MS } from "../../src/main/remote/phones"

// Pairing on the computer's side (src/main/remote/phones.ts): docs/remote-control-SECURITY.md, section 4.

const USER = "user-1"

async function rig(opts: { allow?: boolean; enabled?: boolean } = {}) {
  const keys = await generateDeviceKeys(true)
  const pub = await publicKeys(keys)
  let now = 1_793_000_000_000
  let saved: SavedPhones = { phones: [] }
  const asked: { name: string; agent: string }[] = []
  const clickAsked: { browser: string; computer: string; check: string }[] = []
  const notices: string[] = []
  const calls = { turnOn: 0, posted: [] as { offer: MacOffer; expiresAt: string }[], dropped: 0 }
  const state = { enabled: opts.enabled ?? true, allow: opts.allow ?? true }
  const phones = new Phones({
    keys: async () => ({ keys, pub }),
    userId: () => USER,
    enabled: () => state.enabled,
    macName: () => "David's MacBook Pro",
    origin: () => "https://axeai.com",
    ask: async (p) => (asked.push(p), state.allow),
    askClick: async (c) => (clickAsked.push(c), state.allow),
    turnOn: () => {
      calls.turnOn++
      state.enabled = true
    },
    notice: (t) => void notices.push(t),
    postCode: async (offer, expiresAt) => void calls.posted.push({ offer, expiresAt }),
    dropCode: async () => void calls.dropped++,
    load: () => saved,
    save: (s) => (saved = structuredClone(s)),
    emit: () => {},
    now: () => now,
  })
  return {
    phones,
    keys,
    pub,
    asked,
    clickAsked,
    notices,
    calls,
    state,
    saved: () => saved,
    setSaved: (s: SavedPhones) => (saved = s),
    tick: (ms: number) => (now += ms),
    now: () => now,
  }
}

async function scan(link: string, phone: DeviceKeys, now: number) {
  const qr = parseQR(link)
  if (!qr) throw new Error("not a QR")
  const req = await makePairRequest({ qr, keys: phone, name: "David's iPhone", agent: "Safari on iPhone", now })
  return { qr, req, hello: await helloFor({ keys: phone, name: "David's iPhone", agent: "Safari on iPhone", at: now }) }
}

describe("phones on this computer", () => {
  it("pairs a phone once you press Allow", async () => {
    const r = await rig()
    const code = await r.phones.qr()
    expect(code?.link.startsWith("https://axeai.com/connect#")).toBe(true)
    const phone = await generateDeviceKeys(false)
    const { qr, req, hello } = await scan(code!.link, phone, r.now())

    const answer = await r.phones.request(req.sealed)
    expect(r.asked).toEqual([{ name: "David's iPhone", agent: "Safari on iPhone" }])
    expect(answer?.allowed).toEqual({ phone: req.phone, name: "David's iPhone" })
    expect(await openPairAnswer({ sealed: answer!.sealed, qr, keys: phone, hello })).toBe(true)

    const view = await r.phones.view()
    expect(view.phones.map((p) => p.name)).toEqual(["David's iPhone"])
    expect(view.macId).toBe(await deviceId(r.pub.ed))
    expect(await r.phones.phone(req.phone)).toBeTruthy()
  })

  it("Not me answers no and adds nothing", async () => {
    const r = await rig({ allow: false })
    const phone = await generateDeviceKeys(false)
    const { qr, req, hello } = await scan((await r.phones.qr())!.link, phone, r.now())
    const answer = await r.phones.request(req.sealed)
    expect(answer?.allowed).toBeUndefined()
    expect(await openPairAnswer({ sealed: answer!.sealed, qr, keys: phone, hello })).toBe(false)
    expect((await r.phones.view()).phones).toEqual([])
  })

  it("each code works once: a second phone with the same QR never reaches a dialog", async () => {
    const r = await rig()
    const link = (await r.phones.qr())!.link
    const first = await scan(link, await generateDeviceKeys(false), r.now())
    const second = await scan(link, await generateDeviceKeys(false), r.now())
    expect(await r.phones.request(first.req.sealed)).toBeTruthy()
    expect(await r.phones.request(second.req.sealed)).toBeUndefined()
    // A replay of the first request too.
    expect(await r.phones.request(first.req.sealed)).toBeUndefined()
    expect(r.asked).toHaveLength(1)
    // The next QR is a new one.
    expect((await r.phones.qr())!.link).not.toBe(link)
  })

  it("a QR stops working 2 minutes (plus 20 seconds) after it's shown", async () => {
    const r = await rig()
    const link = (await r.phones.qr())!.link
    const { req } = await scan(link, await generateDeviceKeys(false), r.now())
    r.tick(PAIRING_SECRET_MS + PAIRING_GRACE_MS + 1)
    expect(await r.phones.request(req.sealed)).toBeUndefined()
    expect(r.asked).toHaveLength(0)
  })

  it("the QR before stays good for a scan on its way", async () => {
    const r = await rig()
    const old = (await r.phones.qr())!.link
    const { req } = await scan(old, await generateDeviceKeys(false), r.now())
    r.tick(PAIRING_SECRET_MS + 5_000)
    expect((await r.phones.qr())!.link).not.toBe(old)
    expect(await r.phones.request(req.sealed)).toBeTruthy()
  })

  it("garbage and requests for another computer never reach a dialog", async () => {
    const r = await rig()
    await r.phones.qr()
    expect(await r.phones.request("AAAA")).toBeUndefined()
    const other = await rig()
    const { req } = await scan((await other.phones.qr())!.link, await generateDeviceKeys(false), r.now())
    expect(await r.phones.request(req.sealed)).toBeUndefined()
    expect(r.asked).toHaveLength(0)
  })

  it("no QR and no pairing while it's off", async () => {
    const r = await rig()
    const { req } = await scan((await r.phones.qr())!.link, await generateDeviceKeys(false), r.now())
    r.state.enabled = false
    expect(await r.phones.qr()).toBeUndefined()
    expect(await r.phones.request(req.sealed)).toBeUndefined()
  })

  it("ignores saved entries this computer didn't sign", async () => {
    const r = await rig()
    const { req } = await scan((await r.phones.qr())!.link, await generateDeviceKeys(false), r.now())
    await r.phones.request(req.sealed)
    const saved = r.saved()
    const fresh = await rig()
    // The same list, read by a computer with other keys (or edited by anything else): dropped.
    fresh.setSaved(structuredClone(saved))
    expect((await fresh.phones.view()).phones).toEqual([])
    const forged = structuredClone(saved)
    forged.phones[0]!.entry.name = "Jack's iPhone"
    const again = await rig()
    again.setSaved(forged)
    expect((await again.phones.view()).phones).toEqual([])
  })

  it("drops phones unused for 60 days, and keeps ones in use", async () => {
    const r = await rig()
    const a = await scan((await r.phones.qr())!.link, await generateDeviceKeys(false), r.now())
    await r.phones.request(a.req.sealed)
    const b = await scan((await r.phones.qr())!.link, await generateDeviceKeys(false), r.now())
    await r.phones.request(b.req.sealed)
    r.tick(UNUSED_PHONE_MS - 1000)
    await r.phones.touch(b.req.phone)
    r.tick(2000)
    r.phones.prune()
    expect((await r.phones.view()).phones.map((p) => p.id)).toEqual([b.req.phone])
  })

  it("follows removals made on axeai.com", async () => {
    const r = await rig()
    const a = await scan((await r.phones.qr())!.link, await generateDeviceKeys(false), r.now())
    await r.phones.request(a.req.sealed)
    expect(await r.phones.keepOnly([a.req.phone])).toEqual([])
    expect(await r.phones.keepOnly([])).toEqual([a.req.phone])
    expect((await r.phones.view()).phones).toEqual([])
  })

  it("two requests for one code at the same moment: only one reaches a dialog", async () => {
    const r = await rig()
    const link = (await r.phones.qr())!.link
    const a = await scan(link, await generateDeviceKeys(false), r.now())
    const b = await scan(link, await generateDeviceKeys(false), r.now())
    const [x, y] = await Promise.all([r.phones.request(a.req.sealed), r.phones.request(b.req.sealed)])
    expect([x, y].filter(Boolean)).toHaveLength(1)
    expect(r.asked).toHaveLength(1)
  })

  it("a code turned off while a request opens doesn't get through", async () => {
    const r = await rig()
    const { req } = await scan((await r.phones.qr())!.link, await generateDeviceKeys(false), r.now())
    const pending = r.phones.request(req.sealed)
    r.phones.forgetQR()
    expect(await pending).toBeUndefined()
    expect(r.asked).toHaveLength(0)
  })

  it("keeps the saved phones when the keys can't load this run", async () => {
    const r = await rig()
    const { req } = await scan((await r.phones.qr())!.link, await generateDeviceKeys(false), r.now())
    await r.phones.request(req.sealed)
    const saved = structuredClone(r.saved())
    let keysOk = false
    const writes: unknown[] = []
    const again = new Phones({
      keys: async () => (keysOk ? { keys: r.keys, pub: r.pub } : undefined),
      userId: () => "user-1",
      enabled: () => true,
      macName: () => "Mac",
      origin: () => "https://axeai.com",
      ask: async () => true,
      askClick: async () => true,
      turnOn: () => {},
      notice: () => {},
      postCode: async () => {},
      dropCode: async () => {},
      load: () => saved,
      save: (s) => void writes.push(s),
      emit: () => {},
      now: () => r.now(),
    })
    expect((await again.view()).phones).toEqual([])
    expect(writes).toEqual([])
    keysOk = true
    expect((await again.view()).phones.map((p) => p.name)).toEqual(["David's iPhone"])
  })
  // Pairing a browser by code or by click (docs/remote-control-SECURITY.md, section 17).
  const browser = async (r: Awaited<ReturnType<typeof rig>>, secret: Uint8Array, offer: MacOffer) => {
    const phone = await generateDeviceKeys(false)
    const qr = pairingQRFrom(offer, secret, r.now() + PAIR_CODE_MS)
    const req = await makePairRequest({ qr, keys: phone, name: "David's Mac", agent: "Chrome on Mac", now: r.now() })
    const hello = await helloFor({ keys: phone, name: "David's Mac", agent: "Chrome on Mac", at: r.now() })
    return { qr, req, hello, phone }
  }
  const tryCode = async (r: Awaited<ReturnType<typeof rig>>, typed: string) => {
    const offer = r.calls.posted.at(-1)!.offer
    const start = codeStart({ offer, code: typed })
    const reply = await r.phones.onPairCode(start.hello)
    return { offer, start, reply }
  }

  it("a code pairs a browser with no second question", async () => {
    const r = await rig()
    const shown = await r.phones.codeFor()
    if (!shown?.code) throw new Error("no code")
    expect(shown.code).toMatch(/^\d{6}$/)
    expect(r.calls.turnOn).toBeGreaterThan(0)
    // Axe AI hears about the offer and expiry, never the code.
    expect(JSON.stringify(r.calls.posted)).not.toContain(shown.code)
    expect(r.calls.posted[0]!.expiresAt).toBe(new Date(r.now() + PAIR_CODE_MS).toISOString())
    const { offer, start, reply } = await tryCode(r, shown.code)
    expect(reply).toBeTruthy()
    const secret = await start.finish(reply!)
    const b = await browser(r, secret, offer)
    const answer = await r.phones.request(b.req.sealed)
    expect(r.asked).toEqual([])
    expect(answer?.allowed).toEqual({ phone: b.req.phone, name: "David's Mac" })
    expect(await openPairAnswer({ sealed: answer!.sealed, qr: b.qr, keys: b.phone, hello: b.hello })).toBe(true)
    expect(r.notices).toEqual(["Chrome on Mac can now use this Mac"])
    expect((await r.phones.view()).phones.map((p) => p.name)).toEqual(["David's Mac"])
  })

  it("a wrong code burns it: the guess pairs nothing and the right code is gone too", async () => {
    const r = await rig()
    const shown = await r.phones.codeFor()
    const real = shown!.code as string
    const wrong = real === "000000" ? "000001" : "000000"
    const { offer, start, reply } = await tryCode(r, wrong)
    expect(r.calls.dropped).toBe(1)
    const b = await browser(r, await start.finish(reply!), offer)
    expect(await r.phones.request(b.req.sealed)).toBeUndefined()
    expect(r.asked).toEqual([])
    expect((await r.phones.view()).phones).toEqual([])
    // The same code, typed right a moment later, finds nothing (a new one is on screen).
    const again = codeStart({ offer, code: real })
    const next = await r.phones.codeFor()
    expect(next && next.code).not.toBe(real)
    r.calls.posted.length = 0
    r.phones.closeCode()
    expect(await r.phones.onPairCode(again.hello)).toBeNull()
  })

  it("no live code: answers null, and a code that ran out is dead", async () => {
    const r = await rig()
    const start = codeStart({ offer: (await r.phones.codeFor(), r.calls.posted[0]!.offer), code: "123456" })
    r.tick(PAIR_CODE_MS + 1)
    expect(await r.phones.onPairCode(start.hello)).toBeNull()
    const quiet = await rig()
    expect(await quiet.phones.onPairCode(start.hello)).toBeNull()
  })

  it("stops making codes after 5 wrong tries in 15 minutes, and a success starts the count again", async () => {
    const r = await rig()
    const wrongTry = async () => {
      const shown = await r.phones.codeFor()
      if (!shown?.code) return shown
      await tryCode(r, shown.code === "999999" ? "000000" : "999999")
      return shown
    }
    for (let n = 0; n < CODE_TRIES - 1; n++) await wrongTry()
    // A pairing in between clears the count.
    const ok = await r.phones.codeFor()
    const t = await tryCode(r, ok!.code as string)
    const b = await browser(r, await t.start.finish(t.reply!), t.offer)
    await r.phones.request(b.req.sealed)
    for (let n = 0; n < CODE_TRIES - 1; n++) await wrongTry()
    expect((await r.phones.codeFor())?.code).toBeTruthy()
    await wrongTry()
    const blocked = await r.phones.codeFor()
    expect(blocked).toEqual({ code: null, blockedUntil: expect.any(Number) })
    expect(await r.phones.onPairCode({ n: "x", y: "y" })).toBeNull()
    r.tick(CODE_TRIES_MS + 1)
    expect((await r.phones.codeFor())?.code).toMatch(/^\d{6}$/)
  })

  it("with pairing off, a click shows nothing", async () => {
    const r = await rig({ enabled: false })
    expect(await r.phones.onPairClick("step-1", "Chrome on Mac", (await clickStart()).commit)).toBeNull()
    expect(r.clickAsked).toEqual([])
  })

  it("a click: the check number is asked, and Allow pairs with no second question", async () => {
    const r = await rig()
    const start = await clickStart()
    const click = await r.phones.onPairClick("step-1", "Chrome on Mac", start.commit)
    expect(click).toBeTruthy()
    // Nothing is shown until the reveal arrives.
    expect(r.clickAsked).toEqual([])
    const opened = await start.reveal(click!.half, click!.offer)
    expect(await r.phones.onPairClickReveal("step-1", opened.reveal)).toBe(true)
    expect(r.clickAsked).toEqual([{ browser: "Chrome on Mac", computer: "David's MacBook Pro", check: groupDigits(opened.check) }])
    expect(r.calls.turnOn).toBe(1)
    const b = await browser(r, opened.secret, click!.offer)
    const answer = await r.phones.request(b.req.sealed)
    expect(r.asked).toEqual([])
    expect(answer?.allowed).toBeTruthy()
    // A reveal works once.
    expect(await r.phones.onPairClickReveal("step-1", opened.reveal)).toBe(false)
  })

  it("Not me on a click pairs nothing", async () => {
    const r = await rig({ allow: false })
    const start = await clickStart()
    const click = await r.phones.onPairClick("step-1", "Chrome on Mac", start.commit)
    const opened = await start.reveal(click!.half, click!.offer)
    expect(await r.phones.onPairClickReveal("step-1", opened.reveal)).toBe(false)
    const b = await browser(r, opened.secret, click!.offer)
    expect(await r.phones.request(b.req.sealed)).toBeUndefined()
  })

  it("a reveal that doesn't open the commitment shows nothing", async () => {
    const r = await rig()
    const start = await clickStart()
    const click = await r.phones.onPairClick("step-1", "Chrome on Mac", start.commit)
    const opened = await start.reveal(click!.half, click!.offer)
    const other = await clickStart()
    const bad = (await other.reveal(click!.half, click!.offer)).reveal
    expect(await r.phones.onPairClickReveal("step-1", { ...opened.reveal, n: bad.n })).toBe(false)
    expect(await r.phones.onPairClickReveal("nobody", opened.reveal)).toBe(false)
    expect(r.clickAsked).toEqual([])
    expect(r.calls.turnOn).toBe(0)
  })

  it("keeps at most 3 clicks waiting, and answers 5 per 15 minutes", async () => {
    const r = await rig()
    const commit = (await clickStart()).commit
    for (const id of ["a", "b", "c"]) expect(await r.phones.onPairClick(id, "Chrome", commit)).toBeTruthy()
    expect(await r.phones.onPairClick("d", "Chrome", commit)).toBeNull()
    r.tick(3 * 60_000 + 1)
    expect(await r.phones.onPairClick("e", "Chrome", commit)).toBeTruthy()
    expect(await r.phones.onPairClick("f", "Chrome", commit)).toBeTruthy()
    expect(await r.phones.onPairClick("g", "Chrome", commit)).toBeNull()
  })
})
