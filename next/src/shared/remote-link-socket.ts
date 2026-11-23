// The socket half of the sealed link's two ends (remote-link-client.ts): the WebSocket shape, the retry
// loop with its backoff, and the in-order queue. Same file in axe-mac next/src/shared/: keep the two identical.

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

export const parse = (data: unknown) => {
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
export class Queue {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(step: () => Promise<T>): Promise<T> {
    const next = this.tail.then(step, step)
    this.tail = next.catch(() => undefined)
    return next
  }
}

export abstract class Reconnecting {
  protected ws: SocketLike | undefined
  protected stopped = true
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Set while the relay told us not to come back by ourselves (see halts). */
  protected halted = false

  constructor(protected readonly base: { url: string; ticket(): Promise<string>; socket: SocketMaker }) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    void this.connect()
  }

  /** Connects again after a halt (the "Use here" button). Does nothing otherwise. */
  reconnect() {
    if (this.stopped || !this.halted) return
    this.halted = false
    this.attempt = 0
    void this.connect()
  }

  stop() {
    this.stopped = true
    this.halted = false
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

  /** Extra fields for the first message. */
  protected authExtra(): Record<string, unknown> {
    return {}
  }

  /** True for a close code that ends the loop; `halted` then says why (closed() runs first). */
  protected halts(_code: number | undefined): boolean {
    return false
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
      ws.send(JSON.stringify({ t: "auth", ticket, ...this.authExtra() }))
      this.opened()
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      const m = parse(ev.data)
      if (m) this.message(m)
    }
    ws.onerror = () => {}
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = undefined
      this.closed()
      if (this.halts(ev?.code)) {
        this.halted = true
        return
      }
      this.retry()
    }
  }

  private retry() {
    if (this.stopped) return
    const wait = backoff(this.attempt++)
    this.timer = setTimeout(() => void this.connect(), wait)
  }
}
