import { describe, expect, it } from "vitest"

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

import { Phones, type SavedPhones, UNUSED_PHONE_MS } from "../../src/main/remote/phones"

// Pairing on the computer's side (src/main/remote/phones.ts): docs/remote-control-SECURITY.md, section 4.

const USER = "user-1"

async function rig(opts: { allow?: boolean; enabled?: boolean } = {}) {
  const keys = await generateDeviceKeys(true)
  const pub = await publicKeys(keys)
  let now = 1_793_000_000_000
  let saved: SavedPhones = { phones: [] }
  const asked: { name: string; agent: string }[] = []
  const state = { enabled: opts.enabled ?? true, allow: opts.allow ?? true }
  const phones = new Phones({
    keys: async () => ({ keys, pub }),
    userId: () => USER,
    enabled: () => state.enabled,
    macName: () => "David's MacBook Pro",
    origin: () => "https://axeai.com",
    ask: async (p) => (asked.push(p), state.allow),
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
})
