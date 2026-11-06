import { randomInt } from "node:crypto"

import { isCode, KEEP_AWAKE_MODES, makeCode } from "@shared/power"
import type { KeepAwakeMode, PowerState, RemoteState } from "@shared/types"

import type { AxeClient } from "../axe/client"
import type { Approvals } from "./approvals"
import type { Phones } from "./phones"

// Remote control from axeai.com (RemoteLink.swift on the Mac, desktop/src/main/remote.ts on Windows and
// Linux): one outbound event stream, no open ports. It shares a short summary of what waits for you, and
// only ever does these things when asked: answer something waiting on you, change how it stays awake, or
// ask you to allow a browser. A browser gets in once you allow it here (7 days), or types this computer's
// 8-character code (24 hours); axeai.com enforces that. Nothing else (no free text, no shell) can come in
// this way. Routines are gone (Watching replaced them), so it shares an empty agent list once per
// connection, which clears this computer's old routines from axeai.com.

const CODE_LIFE = 24 * 3600_000

export type RemoteHost = {
  client(): AxeClient | undefined
  enabled(): boolean
  /** Questions waiting for your OK in any chat. */
  approvals: Approvals
  /** How many chats are working now. */
  doing(): number
  deviceName(): string
  platform: "mac" | "windows" | "linux"
  version: string
  wake: "scheduled" | "none"
  power: { report(): PowerState & { nextWakeAt: string | null }; setMode(m: KeepAwakeMode): void; keepAwakeUntil(d: Date | undefined): void }
  /** Asks you on this computer whether a browser may control it (80 seconds, then no). */
  askToAllow(browser: string): Promise<boolean>
  /** The saved code, so a restart keeps it. */
  load(): { code: string; created: number }
  save(saved: { code: string; created: number }): void
  emit(state: RemoteState): void
  /** Phones paired with this computer (phones.ts). Their pairing messages come over this same link. */
  phones?: Phones
  /** This computer's device id (from its key), told to axeai.com so a phone's pairing reaches it. */
  macId?(): Promise<string | undefined>
  /** Whether axeai.com's own commands (what waits, keep awake) may run. The link can be up for phones alone. */
  commandsEnabled?(): boolean
}

/** Named server-sent events ("event: command" / "data: {...}"). */
export class EventReader {
  private buffer = ""
  private event = "message"
  private data: string[] = []
  push(text: string): { event: string; data: string }[] {
    this.buffer += text
    const out: { event: string; data: string }[] = []
    let i = this.buffer.indexOf("\n")
    while (i >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, "")
      this.buffer = this.buffer.slice(i + 1)
      if (line === "") {
        if (this.data.length) out.push({ event: this.event, data: this.data.join("\n") })
        this.event = "message"
        this.data = []
      } else if (line.startsWith("event:")) this.event = line.slice(6).trim()
      else if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""))
      i = this.buffer.indexOf("\n")
    }
    return out
  }
}

type Command = { type?: string; id?: string; approve?: boolean; mode?: string; until?: string | null; browser?: string }

export class RemoteLink {
  private saved: { code: string; created: number }
  connected = false
  private lastCommand: string | undefined
  private loop: AbortController | undefined
  private lastShared = ""
  private agentsCleared = false
  private shareTimer: ReturnType<typeof setTimeout> | undefined
  /** Waits between reconnects (tests make it short). */
  backoff = { first: 2_000, max: 60_000 }

  constructor(private host: RemoteHost) {
    this.saved = host.load()
    host.approvals.onChange(() => this.share())
  }

  state(): RemoteState {
    const c = this.host.client()
    return {
      enabled: this.host.enabled(),
      connected: this.connected,
      code: this.saved.code,
      codeExpires: new Date(this.saved.created + CODE_LIFE).toISOString(),
      phoneURL: c ? c.url("chat?mac") : "https://axeai.com/chat?mac",
      ...(this.lastCommand ? { lastCommand: this.lastCommand } : {}),
    }
  }

  private publish() {
    this.host.emit(this.state())
  }

  private checkCode() {
    const age = Date.now() - this.saved.created
    if (!isCode(this.saved.code) || age >= CODE_LIFE || age < 0) this.newCode()
  }

  newCode(): RemoteState {
    this.saved = { code: makeCode((n) => randomInt(0, n)), created: Date.now() }
    this.host.save(this.saved)
    if (this.connected && this.shares()) void this.sendCode().catch(() => {})
    this.publish()
    return this.state()
  }

  private async sendCode() {
    await this.host.client()?.json("api/remote/code", { method: "POST", json: { code: this.saved.code, expiresAt: new Date(this.saved.created + CODE_LIFE).toISOString() } })
  }

  /** Connects or disconnects to match the setting and the sign-in. */
  refresh() {
    const want = this.host.enabled() && !!this.host.client()
    if (want && !this.loop) {
      this.checkCode()
      this.loop = new AbortController()
      void this.keepConnected(this.loop.signal)
    } else if (!want && this.loop) {
      this.loop.abort()
      this.loop = undefined
      this.connected = false
    } else if (this.connected && this.shares()) {
      // Remote control turned on while phones kept the link up: share now, not at the next reconnect.
      this.checkCode()
      void this.sendCode().catch(() => {})
      this.lastShared = ""
      this.agentsCleared = false
      this.share(0)
      this.sendPower()
    }
    this.publish()
  }

  stop() {
    this.loop?.abort()
    this.loop = undefined
    this.connected = false
  }

  private async keepConnected(signal: AbortSignal) {
    let wait = this.backoff.first
    while (!signal.aborted) {
      try {
        await this.listen(signal)
        wait = this.backoff.first
      } catch {
        wait = Math.min(wait * 2, this.backoff.max)
      }
      if (this.connected) {
        this.connected = false
        this.publish()
      }
      if (signal.aborted) return
      await new Promise((r) => setTimeout(r, wait).unref?.())
    }
  }

  private async listen(signal: AbortSignal) {
    const c = this.host.client()
    if (!c) throw new Error("Signed out")
    const hello = new URLSearchParams({ platform: this.host.platform, name: this.host.deviceName().slice(0, 80), version: this.host.version.slice(0, 32), wake: this.host.wake })
    const key = await this.host.macId?.().catch(() => undefined)
    if (key) hello.set("key", key)
    const res = await fetch(`${c.url("api/remote/connect")}?${hello}`, {
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${c.token}`, "X-Client": "Axe AI Desktop" },
      signal,
    })
    if (res.status !== 200 || !res.body) throw new Error("Remote control isn't available.")
    const reader = new EventReader()
    const decoder = new TextDecoder()
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      for (const { event, data } of reader.push(decoder.decode(bytes, { stream: true }))) {
        if (event === "ready") {
          this.connected = true
          this.lastShared = ""
          this.agentsCleared = false
          if (this.shares()) {
            this.checkCode()
            void this.sendCode().catch(() => {})
            this.share(0)
            this.sendPower()
          }
          this.publish()
          void this.syncPhones()
        } else if (event === "pair") {
          void this.pair(data)
        } else if (event === "phone-removed") {
          try {
            const { phone } = JSON.parse(data) as { phone?: string }
            if (typeof phone === "string") void this.host.phones?.remove(phone)
          } catch {}
        } else if (event === "command") {
          try {
            await this.handle(JSON.parse(data) as { id?: string; command?: Command })
          } catch {}
        }
      }
    }
  }

  /** A phone's sealed pairing request: phones.ts checks it and asks you; the sealed answer goes back. */
  async pair(data: string) {
    let id: string | undefined
    let sealed: string | undefined
    try {
      ;({ id, sealed } = JSON.parse(data) as { id?: string; sealed?: string })
    } catch {
      return
    }
    if (typeof id !== "string" || typeof sealed !== "string" || !this.host.phones) return
    const answer = await this.host.phones.request(sealed).catch(() => undefined)
    await this.host
      .client()
      ?.json("api/remote/mac/pair-answer", { method: "POST", json: { id, sealed: answer?.sealed ?? null, allowed: answer?.allowed ?? null } })
      .catch(() => {})
  }

  /** Phones removed on axeai.com while this computer was away drop off here too. */
  async syncPhones() {
    if (!this.host.phones) return
    const c = this.host.client()
    const key = await this.host.macId?.().catch(() => undefined)
    if (!c || !key) return
    try {
      const { phones } = await c.json<{ phones: { id: string }[] }>(`api/remote/mac/phones?key=${encodeURIComponent(key)}`)
      if (Array.isArray(phones)) await this.host.phones.keepOnly(phones.map((p) => p.id))
    } catch {}
  }

  /** Removes a phone here and on axeai.com. */
  async removePhone(id: string) {
    await this.host.phones?.remove(id)
    await this.host.client()?.json(`api/remote/mac/phones/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {})
  }

  /** axeai.com's own Remote control is on (not just phones): only then share data or take its commands. */
  private shares() {
    return !this.host.commandsEnabled || this.host.commandsEnabled()
  }

  /** Runs one command from axeai.com and posts the result back. */
  async handle(message: { id?: string; command?: Command }): Promise<{ ok: boolean; message: string } | undefined> {
    const { id, command } = message
    if (!id || !command) return
    if (!this.shares()) {
      await this.host.client()?.json("api/remote/results", { method: "POST", json: { id, ok: false, message: "Remote control is off on this computer." } }).catch(() => {})
      return { ok: false, message: "Remote control is off on this computer." }
    }
    let ok = false
    let text = "Axe can't do that remotely."
    try {
      if (command.type === "decide") {
        // This stream is not sealed end to end, so the server could send it on its own. Permission
        // answers come only from the Mac or a paired phone over the sealed link
        // (docs/remote-control-SECURITY.md: the server can't drive the Mac).
        text = "Answer this on your Mac or from your paired phone."
      } else if (command.type === "keep-awake") {
        if (command.mode) {
          const m = KEEP_AWAKE_MODES.find((x) => x.value === command.mode)
          if (!m) throw new Error("Unknown setting.")
          this.host.power.setMode(m.value)
        }
        if (command.until !== undefined) this.host.power.keepAwakeUntil(command.until ? new Date(command.until) : undefined)
        const r = this.host.power.report()
        ok = true
        text = r.awakeUntil
          ? `${this.host.deviceName()} stays awake until ${new Date(r.awakeUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
          : `${this.host.deviceName()}: ${KEEP_AWAKE_MODES.find((m) => m.value === r.keepAwake)?.label.toLowerCase()}.`
        this.sendPower()
      } else if (command.type === "approve-browser") {
        const browser = (command.browser ?? "A browser").slice(0, 80)
        ok = await this.host.askToAllow(browser)
        text = ok ? `Allowed ${browser}.` : `Not allowed on ${this.host.deviceName()}.`
      }
    } catch (e) {
      text = e instanceof Error ? e.message : String(e)
    }
    if (ok) {
      this.lastCommand = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${text}, from axeai.com`
      this.publish()
    }
    await this.host.client()?.json("api/remote/results", { method: "POST", json: { id, ok, message: text.slice(0, 300) } }).catch(() => {})
    return { ok, message: text }
  }

  /** What axeai.com shows for this computer: what waits for you and how many chats are working. */
  snapshot() {
    return {
      device: this.host.deviceName().slice(0, 80),
      needsYou: this.host.approvals
        .list()
        .slice(0, 50)
        .map((i) => ({ id: i.id.slice(0, 64), title: i.body.slice(0, 200), who: i.title.slice(0, 80), ...(i.request.detail ? { preview: i.request.detail.slice(0, 600) } : {}) })),
      agents: [],
      tasks: { todo: 0, doing: this.host.doing(), done: 0 },
    }
  }

  /** Re-shares the summary after a change, at most once a second. */
  share(delay = 1000) {
    if (!this.connected || !this.shares()) return
    if (this.shareTimer) clearTimeout(this.shareTimer)
    this.shareTimer = setTimeout(() => {
      const json = JSON.stringify(this.snapshot())
      void this.clearAgents()
      if (json === this.lastShared) return
      void this.host
        .client()
        ?.json("api/remote/state", { method: "POST", body: json, contentType: "application/json" })
        .then(() => {
          this.lastShared = json
        })
        .catch(() => {})
    }, delay)
  }

  /** Once per connection: no agents on this computer, so axeai.com drops the routines it listed. */
  private async clearAgents() {
    if (this.agentsCleared) return
    await this.host
      .client()
      ?.json("api/automations/device/agents", { method: "PUT", json: { agents: [] } })
      .then(() => {
        this.agentsCleared = true
      })
      .catch(() => {})
  }

  sendPower() {
    if (!this.connected || !this.shares()) return
    void this.host.client()?.json("api/remote/power", { method: "POST", json: this.host.power.report() }).catch(() => {})
  }
}
