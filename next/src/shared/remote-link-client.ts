// Both ends of the sealed link (remote control, step 3): PhoneLink in the phone's browser, MacLink in the
// desktop app. Same file in axe-mac next/src/shared/remote-link-client.ts: keep the two identical.
// Each opens one outbound WebSocket to the relay (axe-web apps/api/src/features/remote/relay.ts), proves
// itself with a one-use ticket sent as the first message (never in the URL), then handshakes end to end
// (remote-link.ts). Drops reconnect at once with jitter, then back off; a new connection handshakes
// again and the phone resumes from the last event it has, so a deploy is a short pause, not a gap.
//
// Relay messages (JSON text): {t:"auth",ticket} → {t:"ready",mac?:bool}; the phone sends Hello1 and
// frames as they are and gets {t:"mac",on}; the Mac gets {from,c?,m} and {t:"peer",phone,c?,on}, and sends
// {to,c?,m} or {t:"kick",phone,c?}. `c` is the relay's id for one browser socket: two tabs of one browser
// are one phone but two sockets, each with its own sealed session. A Mac says it understands `c` with
// {t:"auth",ticket,conns:true}; without that (Axe Desktop 0.12.x) the relay keeps one socket per phone.
// A browser told 4002 (another tab took over) or 4001 (refused) does not reconnect by itself.

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
import { parse, Queue, Reconnecting, type SocketMaker } from "./remote-link-socket"

export { backoff, type SocketLike, type SocketMaker } from "./remote-link-socket"

/** A Mac's event as the phone gets it. `epoch` changes when the Mac app restarts. */
export type LinkEvent = { type: "event"; epoch: string; id: number; kind: string; body: unknown }
export type PhoneLinkState = "connecting" | "online" | "mac-offline" | "replaced" | "refused"

/** The relay's close codes a browser must not answer with an instant reconnect. */
export const CLOSE_REPLACED = 4002
export const CLOSE_REFUSED = 4001

/** Two bad frames in one connection end it; the next one handshakes afresh. */
const MAX_BAD = 2

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
    if (this.state !== "replaced" && this.state !== "refused") this.setState("connecting")
  }

  protected override halts(code: number | undefined) {
    if (code !== CLOSE_REPLACED && code !== CLOSE_REFUSED) return false
    this.setState(code === CLOSE_REPLACED ? "replaced" : "refused")
    return true
  }

  override reconnect() {
    if (!this.halted) return
    this.state = "connecting"
    this.o.onState?.("connecting")
    super.reconnect()
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

/**
 * One sealed session. `phone` is the browser (or phone) key; `c` is the relay's id for this socket, set when
 * the relay knows connection ids (two tabs of one browser are two sessions of one phone).
 * `resumed`: live events wait until the phone said what it has, so a replay never lands after them.
 */
type MacPeer = {
  phone: string
  c: string | undefined
  session: LinkSession
  out: Queue
  inbox: Queue
  bad: number
  resumed: boolean
}

const peerKey = (phone: string, c: string | undefined) => (c ? `${phone}\u0000${c}` : phone)

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
      /** A phone's first sealed session is up and caught up (true), or its last one ended (false). */
      onPeer?(phone: string, on: boolean): void
      bufferSize?: number
    },
  ) {
    super(o)
  }

  protected override authExtra() {
    return { conns: true }
  }

  protected opened() {}

  protected closed() {
    for (const peer of [...this.peers.values()]) this.end(peer)
  }

  private of(phone: string) {
    return [...this.peers.values()].filter((p) => p.phone === phone)
  }

  private end(peer: MacPeer) {
    const key = peerKey(peer.phone, peer.c)
    if (this.peers.get(key) !== peer) return
    this.peers.delete(key)
    if (peer.resumed && !this.of(peer.phone).some((p) => p.resumed)) this.o.onPeer?.(peer.phone, false)
  }

  /** Phones with a sealed session that has caught up, right now. */
  phones() {
    return [...new Set([...this.peers.values()].filter((p) => p.resumed).map((p) => p.phone))]
  }

  /** Ends all of a phone's sessions now (Stop, Remove); it can come back only while it's still allowed. */
  kick(phone: string) {
    this.ws?.send(JSON.stringify({ t: "kick", phone }))
    for (const peer of this.of(phone)) this.end(peer)
  }

  /** Ends one session (bad frames). With an old relay (no connection ids) that is the whole phone. */
  private kickPeer(peer: MacPeer) {
    if (!peer.c) return this.kick(peer.phone)
    this.ws?.send(JSON.stringify({ t: "kick", phone: peer.phone, c: peer.c }))
    this.end(peer)
  }

  protected message(m: Record<string, unknown>) {
    const c = typeof m.c === "string" ? m.c : undefined
    if (m.t === "ready") this.healthy()
    else if (m.t === "peer" && typeof m.phone === "string" && m.on !== true) {
      const peer = this.peers.get(peerKey(m.phone, c))
      if (peer) this.end(peer)
    } else if (typeof m.from === "string" && m.m && typeof m.m === "object")
      void this.fromPhone(m.from, c, m.m as Record<string, unknown>)
  }

  private async fromPhone(phone: string, c: string | undefined, m: Record<string, unknown>) {
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
        const old = this.peers.get(peerKey(phone, c))
        const peer: MacPeer = {
          phone,
          c,
          session,
          out: new Queue(),
          inbox: new Queue(),
          bad: 0,
          resumed: false,
        }
        this.peers.set(peerKey(phone, c), peer)
        // A new handshake on the same socket replaces its session; the phone stays counted as connected.
        if (old?.resumed && !this.of(phone).some((p) => p.resumed)) this.o.onPeer?.(phone, false)
        this.ws?.send(JSON.stringify({ to: phone, ...(c ? { c } : {}), m: answer }))
      } catch {
        // Not allowed or not genuine: say nothing.
      }
    } else if (m.t === "f") {
      const peer = this.peers.get(peerKey(phone, c))
      if (!peer) return
      await peer.inbox.run(async () => {
        if (this.peers.get(peerKey(phone, c)) !== peer) return
        try {
          const message = (await peer.session.open(m as unknown as Frame)) as Record<string, unknown>
          if (message.type === "resume") this.resume(peer, message)
          else this.o.onMessage?.(phone, message, String(m.c ?? ""))
        } catch (e) {
          if (e instanceof LinkError && ++peer.bad >= MAX_BAD) this.kickPeer(peer)
        }
      })
    }
  }

  /** A phone (re)connected: replay what it missed, or tell it to load afresh. */
  // Everything is queued in one go (no await), so no live event can slip in between.
  private resume(peer: MacPeer, m: Record<string, unknown>) {
    const after = typeof m.after === "number" ? m.after : null
    const first = this.buffer[0]?.id
    if (
      m.epoch === this.epoch &&
      after !== null &&
      after <= this.lastId &&
      (after === this.lastId || (first !== undefined && first <= after + 1))
    ) {
      for (const e of this.buffer) if (e.id > after) void this.sealTo(peer, e)
    } else void this.sealTo(peer, { type: "reset", epoch: this.epoch, last: this.lastId })
    if (peer.resumed) return
    const known = this.of(peer.phone).some((p) => p.resumed)
    peer.resumed = true
    if (!known) this.o.onPeer?.(peer.phone, true)
  }

  private async sealTo(peer: MacPeer, message: Record<string, unknown>, chat = ""): Promise<boolean> {
    const ws = this.ws
    if (!ws || this.peers.get(peerKey(peer.phone, peer.c)) !== peer) return false
    if (peer.session.needsRekey()) {
      this.kickPeer(peer)
      return false
    }
    return peer.out.run(async () => {
      if (this.peers.get(peerKey(peer.phone, peer.c)) !== peer) return false
      ws.send(
        JSON.stringify({
          to: peer.phone,
          ...(peer.c ? { c: peer.c } : {}),
          m: await peer.session.seal(message, chat),
        }),
      )
      return true
    })
  }

  /** Sends to one phone, sealed, on each of its sessions (one per open tab). False when it has none. */
  async sendTo(phone: string, message: Record<string, unknown>, chat = ""): Promise<boolean> {
    const sent = await Promise.all(this.of(phone).map((p) => this.sealTo(p, message, chat)))
    return sent.some(Boolean)
  }

  /** An event for every phone; kept for a while so a phone that drops can catch up. */
  broadcast(kind: string, body: unknown, chat = ""): LinkEvent {
    const e: LinkEvent = { type: "event", epoch: this.epoch, id: ++this.lastId, kind, body }
    this.buffer.push(e)
    if (this.buffer.length > (this.o.bufferSize ?? 1000)) this.buffer.shift()
    for (const peer of this.peers.values()) if (peer.resumed) void this.sealTo(peer, e, chat)
    return e
  }
}
