// Both ends of the sealed link (remote control, step 3): PhoneLink in the phone's browser, MacLink in the
// desktop app. Same file in axe-mac next/src/shared/remote-link-client.ts: keep the two identical.
// Each opens one outbound WebSocket to the relay (axe-web apps/api/src/features/remote/relay.ts), proves
// itself with a one-use ticket sent as the first message (never in the URL), then handshakes end to end
// (remote-link.ts). Drops reconnect at once with jitter, then back off; a new connection handshakes
// again and the phone resumes from the last event it has, so a deploy is a short pause, not a gap.
//
// Relay messages (JSON text): {t:"auth",ticket} → {t:"ready",mac?:bool}; the phone sends Hello1 and
// frames as they are and gets {t:"mac",on}; the Mac gets {from,m} and {t:"peer",phone,on}, and sends
// {to,m} or {t:"kick",phone}.

import type { DeviceKeys } from "./remote-crypto"
import {
  type Frame,
  type Hello1,
  type Hello2,
  LinkError,
  type LinkSession,
  macAnswer,
  phoneFinish,
  phoneHello,
} from "./remote-link"

/** What a WebSocket needs to offer (the browser's, Node's global one, or a test double). */
export type SocketLike = {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code?: number }) => void) | null
  onerror: ((ev: unknown) => void) | null
}
export type SocketMaker = (url: string) => SocketLike

/** A Mac's event as the phone gets it. `epoch` changes when the Mac app restarts. */
export type LinkEvent = { type: "event"; epoch: string; id: number; kind: string; body: unknown }
export type PhoneLinkState = "connecting" | "online" | "mac-offline"

/** Two bad frames in one connection end it; the next one handshakes afresh. */
const MAX_BAD = 2
const parse = (data: unknown) => {
  try {
    return typeof data === "string" ? (JSON.parse(data) as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * Retries: at once (with jitter), then every second for about 30 seconds, so a phone is back within a
 * second of a deploy however long the swap takes; after that 2, 4, 8 and at most 15 seconds apart.
 */
export const backoff = (attempt: number, random = Math.random) =>
  attempt === 0
    ? random() * 250
    : attempt < 30
      ? Math.min(1000, 250 * 2 ** attempt)
      : Math.min(15_000, 2000 * 2 ** (attempt - 30))

/** Runs async steps one at a time, in order: frame numbers must go out and come in in sequence. */
class Queue {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(step: () => Promise<T>): Promise<T> {
    const next = this.tail.then(step, step)
    this.tail = next.catch(() => undefined)
    return next
  }
}

abstract class Reconnecting {
  protected ws: SocketLike | undefined
  protected stopped = true
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(protected readonly base: { url: string; ticket(): Promise<string>; socket: SocketMaker }) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    void this.connect()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close(1000, "stopped")
    this.ws = undefined
    this.closed()
  }

  /** The connection is up and working: the next drop retries at once again. */
  protected healthy() {
    this.attempt = 0
  }

  /** Ends this connection (bad frames, new keys due); the loop reconnects. */
  protected drop() {
    this.ws?.close(4000, "reconnect")
  }

  protected abstract opened(): void
  protected abstract message(m: Record<string, unknown>): void
  protected abstract closed(): void

  private async connect() {
    if (this.stopped) return
    let ticket: string
    try {
      ticket = await this.base.ticket()
    } catch {
      return this.retry()
    }
    if (this.stopped) return
    const ws = this.base.socket(this.base.url)
    this.ws = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "auth", ticket }))
      this.opened()
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      const m = parse(ev.data)
      if (m) this.message(m)
    }
    ws.onerror = () => {}
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = undefined
      this.closed()
      this.retry()
    }
  }

  private retry() {
    if (this.stopped) return
    const wait = backoff(this.attempt++)
    this.timer = setTimeout(() => void this.connect(), wait)
  }
}

export class PhoneLink extends Reconnecting {
  private session: LinkSession | undefined
  private pending: { hello: Hello1; priv: Parameters<typeof phoneFinish>[0]["priv"] } | undefined
  private bad = 0
  private out = new Queue()
  private inbox = new Queue()
  epoch: string | null = null
  lastId: number | null = null
  state: PhoneLinkState = "connecting"

  constructor(
    private readonly o: {
      url: string
      ticket(): Promise<string>
      socket: SocketMaker
      keys: DeviceKeys
      phone: string
      mac: string
      macEd: string
      onEvent?(e: LinkEvent): void
      /** The Mac couldn't replay what was missed: load a fresh copy. */
      onReset?(epoch: string): void
      onMessage?(m: Record<string, unknown>, chat: string): void
      onState?(s: PhoneLinkState): void
    },
  ) {
    super(o)
  }

  private setState(s: PhoneLinkState) {
    if (s === this.state) return
    this.state = s
    this.o.onState?.(s)
  }

  protected opened() {
    this.setState("connecting")
  }

  protected closed() {
    this.session = undefined
    this.pending = undefined
    this.setState("connecting")
  }

  private async hello() {
    this.session = undefined
    this.bad = 0
    this.out = new Queue()
    this.inbox = new Queue()
    const start = await phoneHello({ keys: this.o.keys, mac: this.o.mac, phone: this.o.phone })
    this.pending = start
    this.ws?.send(JSON.stringify(start.hello))
  }

  protected message(m: Record<string, unknown>) {
    if (m.t === "ready" || m.t === "mac") {
      const on = m.t === "ready" ? m.mac === true : m.on === true
      if (on) void this.hello()
      else {
        this.session = undefined
        this.setState("mac-offline")
      }
    } else if (m.t === "hs2" && this.pending) {
      const pending = this.pending
      this.pending = undefined
      void phoneFinish({
        hello: pending.hello,
        priv: pending.priv,
        answer: m as unknown as Hello2,
        macEd: this.o.macEd,
      })
        .then((session) => {
          this.session = session
          this.healthy()
          this.setState("online")
          void this.send({ type: "resume", epoch: this.epoch, after: this.lastId })
        })
        .catch(() => this.drop())
    } else if (m.t === "f") {
      const session = this.session
      if (!session) return
      void this.inbox.run(async () => {
        if (this.session !== session) return
        try {
          this.take((await session.open(m as unknown as Frame)) as Record<string, unknown>, String(m.c ?? ""))
        } catch (e) {
          if (e instanceof LinkError && ++this.bad >= MAX_BAD) this.drop()
        }
      })
    }
  }

  private take(m: Record<string, unknown>, chat: string) {
    if (m.type === "event" && typeof m.epoch === "string" && typeof m.id === "number") {
      if (m.epoch === this.epoch && this.lastId !== null && m.id <= this.lastId) return
      this.epoch = m.epoch
      this.lastId = m.id
      this.o.onEvent?.(m as unknown as LinkEvent)
    } else if (m.type === "reset" && typeof m.epoch === "string") {
      this.epoch = m.epoch
      this.lastId = typeof m.last === "number" ? m.last : null
      this.o.onReset?.(m.epoch)
    } else this.o.onMessage?.(m, chat)
  }

  /** Sends a message to the Mac, sealed. False while not connected. */
  async send(message: Record<string, unknown>, chat = ""): Promise<boolean> {
    const session = this.session
    const ws = this.ws
    if (!session || !ws) return false
    if (session.needsRekey()) {
      this.drop()
      return false
    }
    return this.out.run(async () => {
      if (this.session !== session) return false
      ws.send(JSON.stringify(await session.seal(message, chat)))
      return true
    })
  }
}

/** `resumed`: live events wait until the phone said what it has, so a replay never lands after them. */
type MacPeer = { session: LinkSession; out: Queue; inbox: Queue; bad: number; resumed: boolean }

export class MacLink extends Reconnecting {
  private peers = new Map<string, MacPeer>()
  private buffer: LinkEvent[] = []
  private lastId = 0
  /** Changes every app run, so a phone knows ids started over. */
  readonly epoch = Math.random().toString(36).slice(2, 10)

  constructor(
    private readonly o: {
      url: string
      ticket(): Promise<string>
      socket: SocketMaker
      keys: DeviceKeys
      mac: string
      /** The phone's Ed25519 key from this Mac's signed list, or undefined when it isn't allowed. */
      phoneEd(phone: string): Promise<string | undefined>
      onMessage?(phone: string, m: Record<string, unknown>, chat: string): void
      /** A phone's sealed session is up and caught up (true), or ended (false). */
      onPeer?(phone: string, on: boolean): void
      bufferSize?: number
    },
  ) {
    super(o)
  }

  protected opened() {}

  protected closed() {
    for (const phone of [...this.peers.keys()]) this.end(phone)
  }

  private end(phone: string) {
    const peer = this.peers.get(phone)
    this.peers.delete(phone)
    if (peer?.resumed) this.o.onPeer?.(phone, false)
  }

  /** Phones with a sealed session that have caught up, right now. */
  phones() {
    return [...this.peers].filter(([, p]) => p.resumed).map(([phone]) => phone)
  }

  /** Ends a phone's session now (Stop, Remove); it can come back only while it's still allowed. */
  kick(phone: string) {
    this.ws?.send(JSON.stringify({ t: "kick", phone }))
    this.end(phone)
  }

  protected message(m: Record<string, unknown>) {
    if (m.t === "ready") this.healthy()
    else if (m.t === "peer" && typeof m.phone === "string" && m.on !== true) this.end(m.phone)
    else if (typeof m.from === "string" && m.m && typeof m.m === "object")
      void this.fromPhone(m.from, m.m as Record<string, unknown>)
  }

  private async fromPhone(phone: string, m: Record<string, unknown>) {
    if (m.t === "hs1") {
      const hello = m as unknown as Hello1
      if (hello.phone !== phone) return
      try {
        const { answer, session } = await macAnswer({
          hello,
          keys: this.o.keys,
          mac: this.o.mac,
          phoneEd: await this.o.phoneEd(phone),
        })
        this.peers.set(phone, { session, out: new Queue(), inbox: new Queue(), bad: 0, resumed: false })
        this.ws?.send(JSON.stringify({ to: phone, m: answer }))
      } catch {
        // Not allowed or not genuine: say nothing.
      }
    } else if (m.t === "f") {
      const peer = this.peers.get(phone)
      if (!peer) return
      await peer.inbox.run(async () => {
        if (this.peers.get(phone) !== peer) return
        try {
          const message = (await peer.session.open(m as unknown as Frame)) as Record<string, unknown>
          if (message.type === "resume") this.resume(phone, peer, message)
          else this.o.onMessage?.(phone, message, String(m.c ?? ""))
        } catch (e) {
          if (e instanceof LinkError && ++peer.bad >= MAX_BAD) this.kick(phone)
        }
      })
    }
  }

  /** A phone (re)connected: replay what it missed, or tell it to load afresh. */
  // Everything is queued in one go (no await), so no live event can slip in between.
  private resume(phone: string, peer: MacPeer, m: Record<string, unknown>) {
    const after = typeof m.after === "number" ? m.after : null
    const first = this.buffer[0]?.id
    if (
      m.epoch === this.epoch &&
      after !== null &&
      after <= this.lastId &&
      (after === this.lastId || (first !== undefined && first <= after + 1))
    ) {
      for (const e of this.buffer) if (e.id > after) void this.sendTo(phone, e)
    } else void this.sendTo(phone, { type: "reset", epoch: this.epoch, last: this.lastId })
    if (peer.resumed) return
    peer.resumed = true
    this.o.onPeer?.(phone, true)
  }

  /** Sends to one phone, sealed. False when it has no session. */
  async sendTo(phone: string, message: Record<string, unknown>, chat = ""): Promise<boolean> {
    const peer = this.peers.get(phone)
    const ws = this.ws
    if (!peer || !ws) return false
    if (peer.session.needsRekey()) {
      this.kick(phone)
      return false
    }
    return peer.out.run(async () => {
      if (this.peers.get(phone) !== peer) return false
      ws.send(JSON.stringify({ to: phone, m: await peer.session.seal(message, chat) }))
      return true
    })
  }

  /** An event for every phone; kept for a while so a phone that drops can catch up. */
  broadcast(kind: string, body: unknown, chat = ""): LinkEvent {
    const e: LinkEvent = { type: "event", epoch: this.epoch, id: ++this.lastId, kind, body }
    this.buffer.push(e)
    if (this.buffer.length > (this.o.bufferSize ?? 1000)) this.buffer.shift()
    for (const [phone, peer] of this.peers) if (peer.resumed) void this.sendTo(phone, e, chat)
    return e
  }
}
