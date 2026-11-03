import { describe, expect, it } from "vitest"

import { b64u, type DeviceKeys, deviceId, fromB64u, generateDeviceKeys, publicKeys } from "@shared/remote-crypto"
import { type Frame, LinkError, macAnswer, phoneFinish, phoneHello, REKEY_MS } from "@shared/remote-link"
import { backoff, type LinkEvent, MacLink, PhoneLink, type SocketLike } from "@shared/remote-link-client"

// The sealed link (axe-mac docs/remote-control-SECURITY.md, section 5). Same file in axe-mac.

async function devices() {
  const mac = await generateDeviceKeys(true)
  const phone = await generateDeviceKeys(false)
  const macPub = await publicKeys(mac)
  const phonePub = await publicKeys(phone)
  return {
    mac,
    phone,
    macPub,
    phonePub,
    macId: await deviceId(macPub.ed),
    phoneId: await deviceId(phonePub.ed),
  }
}

async function sessions() {
  const d = await devices()
  const start = await phoneHello({ keys: d.phone, mac: d.macId, phone: d.phoneId })
  const { answer, session: mac } = await macAnswer({
    hello: start.hello,
    keys: d.mac,
    mac: d.macId,
    phoneEd: d.phonePub.ed,
  })
  const phone = await phoneFinish({ hello: start.hello, priv: start.priv, answer, macEd: d.macPub.ed })
  return { ...d, phoneS: phone, macS: mac, start, answer }
}

const flip = (f: Frame, at = 3): Frame => {
  const b = fromB64u(f.d)
  b[at] = (b[at] ?? 0) ^ 1
  return { ...f, d: b64u(b) }
}

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "opened"
  } catch (e) {
    return e instanceof LinkError ? e.code : String(e)
  }
}

describe("the sealed link", () => {
  it("handshakes and carries messages both ways, numbered", async () => {
    const s = await sessions()
    expect(s.phoneS.connId).toBe(s.macS.connId)
    const f0 = await s.phoneS.seal({ type: "send", text: "Fix the checkout test" }, "chat-1")
    expect(f0).toMatchObject({ t: "f", s: 0, c: "chat-1" })
    expect(await s.macS.open(f0)).toEqual({ type: "send", text: "Fix the checkout test" })
    const back = await s.macS.seal({ type: "event", n: 1 })
    expect(await s.phoneS.open(back)).toEqual({ type: "event", n: 1 })
    expect((await s.phoneS.seal({ n: 2 })).s).toBe(1)
  })

  it("rejects a frame the server changed: ciphertext, chat id or number", async () => {
    const s = await sessions()
    const f = await s.phoneS.seal({ type: "stop" }, "chat-1")
    expect(await code(s.macS.open(flip(f)))).toBe("tampered")
    expect(await code(s.macS.open({ ...f, c: "chat-2" }))).toBe("tampered")
    expect(await code(s.macS.open({ ...f, s: 1 }))).toBe("order")
    // The genuine frame still opens: nothing was consumed by the bad ones.
    expect(await s.macS.open(f)).toEqual({ type: "stop" })
  })

  it("drops replayed and reordered frames", async () => {
    const s = await sessions()
    const a = await s.phoneS.seal({ n: 0 })
    const b = await s.phoneS.seal({ n: 1 })
    expect(await code(s.macS.open(b))).toBe("order")
    await s.macS.open(a)
    expect(await code(s.macS.open(a))).toBe("order")
    expect(await s.macS.open(b)).toEqual({ n: 1 })
  })

  it("a frame from another connection doesn't open", async () => {
    const one = await sessions()
    const start = await phoneHello({ keys: one.phone, mac: one.macId, phone: one.phoneId })
    const { session: mac2 } = await macAnswer({
      hello: start.hello,
      keys: one.mac,
      mac: one.macId,
      phoneEd: one.phonePub.ed,
    })
    const f = await one.phoneS.seal({ type: "stop" })
    expect(await code(mac2.open(f))).toBe("tampered")
  })

  it("the Mac says nothing to a phone that isn't on its list, or a hello it didn't sign", async () => {
    const d = await devices()
    const start = await phoneHello({ keys: d.phone, mac: d.macId, phone: d.phoneId })
    expect(await code(macAnswer({ hello: start.hello, keys: d.mac, mac: d.macId, phoneEd: undefined }))).toBe(
      "handshake",
    )
    const other = await publicKeys(await generateDeviceKeys(true))
    expect(await code(macAnswer({ hello: start.hello, keys: d.mac, mac: d.macId, phoneEd: other.ed }))).toBe(
      "handshake",
    )
    expect(
      await code(
        macAnswer({
          hello: { ...start.hello, eph: other.x },
          keys: d.mac,
          mac: d.macId,
          phoneEd: d.phonePub.ed,
        }),
      ),
    ).toBe("handshake")
    expect(
      await code(
        macAnswer({
          hello: start.hello,
          keys: d.mac,
          mac: "another-mac-id-00000000",
          phoneEd: d.phonePub.ed,
        }),
      ),
    ).toBe("handshake")
  })

  it("the phone refuses an answer not signed by the Mac it paired with", async () => {
    const d = await devices()
    const start = await phoneHello({ keys: d.phone, mac: d.macId, phone: d.phoneId })
    const server = await generateDeviceKeys(true)
    const { answer } = await macAnswer({
      hello: start.hello,
      keys: server,
      mac: d.macId,
      phoneEd: d.phonePub.ed,
    })
    expect(
      await code(phoneFinish({ hello: start.hello, priv: start.priv, answer, macEd: d.macPub.ed })),
    ).toBe("handshake")
  })

  it("asks for new keys after an hour", async () => {
    const s = await sessions()
    expect(s.phoneS.needsRekey()).toBe(false)
    expect(s.phoneS.needsRekey(Date.now() + REKEY_MS + 1)).toBe(true)
  })

  it("retries at once, then every second for a while, then backs off", () => {
    expect(backoff(0, () => 1)).toBe(250)
    expect(backoff(1)).toBe(500)
    expect(backoff(3)).toBe(1000)
    expect(backoff(29)).toBe(1000)
    expect(backoff(31)).toBe(4000)
    expect(backoff(40)).toBe(15_000)
  })
})

// An in-memory relay that routes like the real one, and can tamper with frames or restart.
class Relay {
  mac: Sock | undefined
  phones = new Map<string, Sock>()
  tamper: ((m: Record<string, unknown>) => Record<string, unknown>) | undefined
  up = true
  socket = (url: string): SocketLike => new Sock(this, url.endsWith("/mac") ? "mac" : "phone")
  route(from: Sock, raw: string) {
    const m = JSON.parse(raw) as Record<string, unknown>
    if (m.t === "auth") {
      from.authed = true
      if (from.role === "mac") {
        this.mac = from
        from.deliver({ t: "ready" })
        for (const p of this.phones.values()) p.deliver({ t: "mac", on: true })
      } else {
        from.id = String(m.ticket)
        this.phones.set(from.id, from)
        from.deliver({ t: "ready", mac: Boolean(this.mac) })
      }
      return
    }
    if (from.role === "phone")
      this.mac?.deliver({ from: from.id, m: this.tamper && m.t === "f" ? this.tamper(m) : m })
    else if (m.t === "kick") this.phones.get(String(m.phone))?.close()
    else
      this.phones
        .get(String(m.to))
        ?.deliver(
          this.tamper && (m.m as Frame).t === "f"
            ? this.tamper(m.m as Record<string, unknown>)
            : (m.m as Record<string, unknown>),
        )
  }
  /** A deploy: every socket drops, the new process knows nobody. */
  restart() {
    const all = [this.mac, ...this.phones.values()]
    this.mac = undefined
    this.phones.clear()
    for (const s of all) s?.close()
  }
}

class Sock implements SocketLike {
  onopen: SocketLike["onopen"] = null
  onmessage: SocketLike["onmessage"] = null
  onclose: SocketLike["onclose"] = null
  onerror: SocketLike["onerror"] = null
  authed = false
  id = ""
  open = true
  constructor(
    private relay: Relay,
    readonly role: "mac" | "phone",
  ) {
    setTimeout(() => this.onopen?.({}), 1)
  }
  send(data: string) {
    if (this.open) setTimeout(() => this.open && this.relay.route(this, data), 0)
  }
  deliver(m: unknown) {
    if (this.open) setTimeout(() => this.open && this.onmessage?.({ data: JSON.stringify(m) }), 0)
  }
  close() {
    if (!this.open) return
    this.open = false
    if (this.role === "phone" && this.relay.phones.get(this.id) === this) this.relay.phones.delete(this.id)
    if (this.relay.mac === this) {
      this.relay.mac = undefined
      for (const p of this.relay.phones.values()) p.deliver({ t: "mac", on: false })
    } else if (this.relay.mac && this.role === "phone")
      this.relay.mac.deliver({ t: "peer", phone: this.id, on: false })
    setTimeout(() => this.onclose?.({ code: 1012 }), 0)
  }
}

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function linked(relay: Relay, opts: { onReset?: (epoch: string) => void } = {}) {
  const d = await devices()
  const got: LinkEvent[] = []
  const peers: string[] = []
  const mac = new MacLink({
    url: "wss://relay/mac",
    ticket: async () => "mac",
    socket: relay.socket,
    keys: d.mac as DeviceKeys,
    mac: d.macId,
    phoneEd: async (p) => (p === d.phoneId ? d.phonePub.ed : undefined),
    onPeer: (p, on) => peers.push(`${on ? "+" : "-"}${p}`),
  })
  const phone = new PhoneLink({
    url: "wss://relay/phone",
    ticket: async () => d.phoneId,
    socket: relay.socket,
    keys: d.phone,
    phone: d.phoneId,
    mac: d.macId,
    macEd: d.macPub.ed,
    onEvent: (e) => got.push(e),
    onReset: (e) => opts.onReset?.(e),
  })
  mac.start()
  phone.start()
  await until(() => phone.state === "online" && mac.phones().length === 1)
  return { d, mac, phone, got, peers }
}

describe("the link clients", () => {
  it("stream events to the phone in order", async () => {
    const relay = new Relay()
    const { mac, phone, got } = await linked(relay)
    for (let i = 0; i < 20; i++) mac.broadcast("tick", { i })
    await until(() => got.length === 20)
    expect(got.map((e) => e.id)).toEqual([...Array(20).keys()].map((i) => i + 1))
    phone.stop()
    mac.stop()
  })

  it("resume across a deploy: no gap, no duplicate, back within moments", async () => {
    const relay = new Relay()
    const { mac, phone, got } = await linked(relay)
    for (let i = 0; i < 5; i++) mac.broadcast("tick", { i })
    await until(() => got.length === 5)
    relay.restart()
    // Events made while the relay is down wait in the Mac's buffer.
    for (let i = 5; i < 10; i++) mac.broadcast("tick", { i })
    const t0 = Date.now()
    await until(() => phone.state === "online" && mac.phones().length === 1)
    for (let i = 10; i < 15; i++) mac.broadcast("tick", { i })
    await until(() => got.length === 15)
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(got.map((e) => e.id)).toEqual([...Array(15).keys()].map((i) => i + 1))
    phone.stop()
    mac.stop()
  })

  it("a frame the relay tampers with is dropped, the link heals, nothing is lost", async () => {
    const relay = new Relay()
    const { mac, phone, got } = await linked(relay)
    let n = 0
    relay.tamper = (m) => (++n === 3 ? flip(m as Frame) : m)
    for (let i = 0; i < 8; i++) mac.broadcast("tick", { i })
    await until(() => got.length === 8)
    expect(got.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    phone.stop()
    mac.stop()
  })

  it("a phone that isn't allowed never gets a session", async () => {
    const relay = new Relay()
    const d = await devices()
    const stranger = await generateDeviceKeys(false)
    const strangerId = await deviceId((await publicKeys(stranger)).ed)
    const mac = new MacLink({
      url: "x/mac",
      ticket: async () => "mac",
      socket: relay.socket,
      keys: d.mac,
      mac: d.macId,
      phoneEd: async () => undefined,
    })
    const phone = new PhoneLink({
      url: "x/phone",
      ticket: async () => strangerId,
      socket: relay.socket,
      keys: stranger,
      phone: strangerId,
      mac: d.macId,
      macEd: d.macPub.ed,
    })
    mac.start()
    phone.start()
    await new Promise((r) => setTimeout(r, 200))
    expect(phone.state).not.toBe("online")
    expect(mac.phones()).toEqual([])
    phone.stop()
    mac.stop()
  })

  it("Stop on the Mac ends the phone's session", async () => {
    const relay = new Relay()
    const { mac, phone, d, peers } = await linked(relay)
    mac.kick(d.phoneId)
    expect(peers).toEqual([`+${d.phoneId}`, `-${d.phoneId}`])
    phone.stop()
    mac.stop()
  })

  it("a Mac restart starts a new epoch, and the phone is told to load afresh", async () => {
    const relay = new Relay()
    let reset = ""
    const first = await linked(relay, {
      onReset: (e) => {
        reset = e
      },
    })
    first.mac.broadcast("tick", {})
    await until(() => first.got.length === 1 || reset !== "")
    first.mac.stop()
    const again = new MacLink({
      url: "x/mac",
      ticket: async () => "mac",
      socket: relay.socket,
      keys: first.d.mac,
      mac: first.d.macId,
      phoneEd: async () => first.d.phonePub.ed,
    })
    again.start()
    await until(() => reset === again.epoch)
    first.phone.stop()
    again.stop()
  })
})
