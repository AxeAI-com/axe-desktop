import {
  type PhoneAnswerer,
  type PhoneAsk,
  type PhoneCatalog,
  type PhoneChat,
  type PhoneCommand,
  type PhoneEventBody,
  type PhoneMode,
  phoneRequestSchema,
  UPLOAD_MAX,
} from "@shared/remote-commands"
import type { AgentMode, Answerer, Attachment, ChatMessage, ModelCatalog, PermissionRequest, ReplyUpdate, SendRequest, ThreadSummary } from "@shared/types"

// A paired phone driving this computer's chats (remote control, step 4). Every command comes over the
// sealed link, is checked against the closed list in shared/remote-commands.ts, and runs through the
// same chat engine the window uses: same chats, same modes, same approvals. Chat events go back to every
// connected phone. Each thing a phone does lands in "What the phone did". No Electron here.

export type PhoneChatHost = {
  chat: {
    listThreads(): Promise<ThreadSummary[]>
    messages(threadId: string): Promise<ChatMessage[]>
    send(request: SendRequest): Promise<{ threadId: string }>
    stop(threadId: string): void
    setMode(threadId: string, mode: AgentMode): Promise<void>
    modeOf(threadId: string): AgentMode
    isRunning(threadId: string): boolean
    title(threadId: string): string | undefined
    /** Answers a request the agent waits on (an approval, a question, a plan). */
    answer(requestId: string, optionId: string): void
  }
  /** Saves a file a phone sent into this computer's attachments; the type comes from the name. */
  saveFile(name: string, bytes: Uint8Array): Attachment
  catalog(): Promise<ModelCatalog>
  phoneName(phone: string): Promise<string>
  sendTo(phone: string, message: Record<string, unknown>): Promise<boolean>
  broadcast(kind: string, body: unknown, chat?: string): void
  /** Adds a line to "What the phone did". `bypass`: the phone turned on Bypass; say so at once. */
  log(entry: { phone: string; name: string; text: string; bypass?: boolean }): void
  now(): number
}

/** Per phone: at most this many commands in 10 seconds. */
const RATE = 40
const REPLY_EVERY_MS = 120
const MESSAGES_MAX = 80

/** Files a phone may be sending at once, and how long one may take. */
const UPLOADS_AT_ONCE = 3
const UPLOAD_MS = 5 * 60_000

type Upload = { name: string; size: number; total: number; next: number; parts: Uint8Array[]; bytes: number; started: number }

/** A file name with no folders in it. */
const fileName = (name: string) => name.split(/[\\/]/).pop()?.replace(/^\.+/, "").trim().slice(0, 120) || "file"

const MODE_WORDS: Record<PhoneMode, string> = { ask: "Ask", acceptEdits: "Auto-accept edits", plan: "Plan", full: "Bypass" }

export class PhoneControl {
  private counts = new Map<string, { n: number; since: number }>()
  private pendingReply = new Map<string, { update: ReplyUpdate; timer: ReturnType<typeof setTimeout> | undefined; last: number }>()
  private chatsTimer: ReturnType<typeof setTimeout> | undefined
  /** What the agents wait on now, by request id. */
  private waiting = new Map<string, { chat: string; ask: PhoneAsk }>()
  /** Files arriving, and files ready to send, by "<phone>:<upload id>". */
  private uploads = new Map<string, Upload>()
  private files = new Map<string, Attachment>()

  constructor(private host: PhoneChatHost) {}

  /** A sealed message from a phone. Anything that isn't a valid command is dropped. */
  async handle(phone: string, message: Record<string, unknown>) {
    const parsed = phoneRequestSchema.safeParse(message)
    if (!parsed.success) return
    const { id, cmd } = parsed.data
    const now = this.host.now()
    const c = this.counts.get(phone)
    // File pieces are limited by size instead, so a photo isn't slowed down.
    if (cmd.type !== "upload") {
      if (!c || now - c.since > 10_000) this.counts.set(phone, { n: 1, since: now })
      else if (++c.n > RATE) return void this.host.sendTo(phone, { type: "res", id, ok: false, error: "Too fast. Wait a moment." })
    }
    try {
      const data = await this.run(phone, cmd)
      await this.host.sendTo(phone, { type: "res", id, ok: true, ...(data === undefined ? {} : { data }) })
    } catch (e) {
      await this.host.sendTo(phone, { type: "res", id, ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "That didn't work." })
    }
  }

  private async run(phone: string, cmd: PhoneCommand): Promise<unknown> {
    const name = () => this.host.phoneName(phone)
    const titleOf = (chat: string) => this.host.chat.title(chat) ?? "a chat"
    switch (cmd.type) {
      case "chats": {
        const [threads, catalog] = await Promise.all([this.host.chat.listThreads(), this.host.catalog()])
        return { chats: threads.map((t) => this.chatView(t)), catalog: phoneCatalog(catalog) }
      }
      case "read": {
        const messages = await this.host.chat.messages(cmd.chat)
        const waiting = [...this.waiting.values()].filter((w) => w.chat === cmd.chat).map((w) => w.ask)
        return { messages: messages.slice(-MESSAGES_MAX), mode: this.host.chat.modeOf(cmd.chat), running: this.host.chat.isRunning(cmd.chat), waiting }
      }
      case "send": {
        const threads = await this.host.chat.listThreads()
        const thread = cmd.chat ? threads.find((t) => t.id === cmd.chat) : undefined
        if (cmd.chat && !thread) throw new Error("That chat isn't on this computer anymore.")
        const answerer = await this.answerer(cmd.answerer, thread)
        // A new agent chat works where you last worked with it on this computer, never a folder the
        // phone names (threat model, section 6).
        const cwd = cmd.chat === null && answerer.kind === "agent" ? lastFolder(threads, answerer.agentId) : undefined
        if (cmd.chat === null && answerer.kind === "agent" && !cwd)
          throw new Error("Start a chat with this agent on your Mac first, so it knows which folder to work in.")
        const attachments = (cmd.attachments ?? []).map((u) => {
          const file = this.files.get(`${phone}:${u}`)
          if (!file) throw new Error("A file didn't finish sending. Attach it again.")
          return file
        })
        for (const u of cmd.attachments ?? []) this.files.delete(`${phone}:${u}`)
        const { threadId } = await this.host.chat.send({
          threadId: cmd.chat,
          text: cmd.text,
          answerer,
          // A phone's picks stay with its chat; what the Mac starts new chats with doesn't change.
          keepDefaults: true,
          ...(attachments.length ? { attachments } : {}),
          ...(cwd ? { cwd } : {}),
          ...(cmd.chat === null && cmd.mode ? { mode: cmd.mode } : {}),
        })
        const who = answerer.kind === "agent" ? (await this.host.catalog()).agents.find((a) => a.id === answerer.agentId)?.name : undefined
        if (cmd.chat === null) {
          const bypass = answerer.kind === "agent" && cmd.mode === "full"
          this.host.log({ phone, name: await name(), text: `Started ${titleOf(threadId)}${who ? ` with ${who}` : ""}${bypass ? " in Bypass" : ""}`, bypass })
        } else {
          const files = attachments.length ? ` with ${attachments.length === 1 ? "a file" : `${attachments.length} files`}` : ""
          this.host.log({ phone, name: await name(), text: `Sent a message${files} in ${titleOf(threadId)}` })
        }
        return { chat: threadId }
      }
      case "stop":
        this.host.chat.stop(cmd.chat)
        this.host.log({ phone, name: await name(), text: `Stopped ${titleOf(cmd.chat)}` })
        return undefined
      case "answer": {
        const w = this.waiting.get(cmd.request)
        const option = w?.chat === cmd.chat ? w.ask.options.find((o) => o.id === cmd.option) : undefined
        if (!w || !option) throw new Error("That question isn't waiting anymore.")
        this.waiting.delete(cmd.request)
        this.host.chat.answer(cmd.request, option.id)
        const what = w.ask.plan
          ? `Answered ${option.label} to the plan`
          : option.kind === "allow_always"
            ? `Always allowed ${w.ask.title}`
            : option.kind === "allow_once"
              ? `Allowed ${w.ask.title}`
              : `Said no to ${w.ask.title}`
        this.host.log({ phone, name: await name(), text: `${what} in ${titleOf(cmd.chat)}` })
        return undefined
      }
      case "upload":
        return this.piece(phone, cmd)
      case "mode":
        await this.host.chat.setMode(cmd.chat, cmd.mode)
        this.host.log({ phone, name: await name(), text: `Switched ${titleOf(cmd.chat)} to ${MODE_WORDS[cmd.mode]}`, bypass: cmd.mode === "full" })
        return undefined
    }
  }

  /** One piece of a file. The last one saves it and returns its upload id, ready for send. */
  private piece(phone: string, cmd: Extract<PhoneCommand, { type: "upload" }>) {
    const key = `${phone}:${cmd.upload}`
    const now = this.host.now()
    for (const [k, u] of this.uploads) if (now - u.started > UPLOAD_MS) this.uploads.delete(k)
    let u = this.uploads.get(key)
    if (!u) {
      if (cmd.index !== 0) throw new Error("A file arrived out of order. Attach it again.")
      if ([...this.uploads.keys()].filter((k) => k.startsWith(`${phone}:`)).length >= UPLOADS_AT_ONCE) throw new Error("Too many files at once.")
      u = { name: fileName(cmd.name), size: cmd.size, total: cmd.total, next: 0, parts: [], bytes: 0, started: now }
      this.uploads.set(key, u)
    }
    const data = Buffer.from(cmd.data, "base64")
    if (cmd.index !== u.next || cmd.total !== u.total || cmd.size !== u.size || u.bytes + data.byteLength > Math.min(u.size, UPLOAD_MAX)) {
      this.uploads.delete(key)
      throw new Error("A file arrived damaged. Attach it again.")
    }
    u.parts.push(data)
    u.bytes += data.byteLength
    u.next++
    if (u.next < u.total) return { received: u.next }
    this.uploads.delete(key)
    if (u.bytes !== u.size) throw new Error("A file arrived damaged. Attach it again.")
    const file = this.host.saveFile(u.name, Buffer.concat(u.parts))
    this.files.set(key, file)
    return { upload: cmd.upload, name: file.name, size: file.size }
  }

  /** Only models and agents this computer offers; a chat keeps its own kind of answerer. */
  private async answerer(asked: PhoneAnswerer | undefined, thread: ThreadSummary | undefined): Promise<Answerer> {
    const catalog = await this.host.catalog()
    if (thread?.source === "agent") {
      if (asked && (asked.kind !== "agent" || asked.agentId !== thread.agentId)) throw new Error("This chat stays with its agent.")
      return { kind: "agent", agentId: thread.agentId ?? "" }
    }
    if (thread?.source === "local") return { kind: "local", modelId: thread.localModel ?? "" }
    const pick = asked ?? { kind: "axe", modelId: catalog.axe.defaultModelId }
    if (thread && pick.kind !== "axe") throw new Error("Pick one of Axe's models for this chat.")
    if (pick.kind === "axe" && !catalog.axe.models.some((m) => m.id === pick.modelId)) throw new Error("That model isn't available.")
    if (pick.kind === "agent" && !catalog.agents.some((a) => a.id === pick.agentId && a.state === "ready")) throw new Error("That agent isn't ready on this computer.")
    return pick
  }

  private chatView(t: ThreadSummary): PhoneChat {
    return {
      id: t.id,
      title: t.title,
      source: t.source,
      ...(t.agentId ? { agentId: t.agentId } : {}),
      ...(t.source === "agent" ? { mode: this.host.chat.modeOf(t.id) } : {}),
      running: this.host.chat.isRunning(t.id),
      updatedAt: t.updatedAt,
    }
  }

  private send(body: PhoneEventBody, chat = "") {
    const { kind, ...rest } = body
    this.host.broadcast(kind, rest, chat)
  }

  /** The chat list changed: one update after a short quiet spell. */
  threadsChanged(threads: ThreadSummary[]) {
    if (this.chatsTimer) clearTimeout(this.chatsTimer)
    this.chatsTimer = setTimeout(() => this.send({ kind: "chats", chats: threads.map((t) => this.chatView(t)) }), 300)
  }

  /** A streaming reply: at most one update every 120 ms per chat, and always the last one. */
  reply(update: ReplyUpdate) {
    const chat = update.threadId
    const flush = () => {
      const p = this.pendingReply.get(chat)
      if (!p) return
      p.timer = undefined
      p.last = this.host.now()
      const u = p.update
      this.send({ kind: "reply", chat, message: u.message, done: u.done, ...(u.error ? { error: u.error } : {}) }, chat)
      if (u.done) this.pendingReply.delete(chat)
    }
    const p = this.pendingReply.get(chat) ?? { update, timer: undefined, last: 0 }
    p.update = update
    this.pendingReply.set(chat, p)
    if (update.done) {
      if (p.timer) clearTimeout(p.timer)
      return flush()
    }
    if (p.timer) return
    const wait = Math.max(0, REPLY_EVERY_MS - (this.host.now() - p.last))
    p.timer = setTimeout(flush, wait)
  }

  modeChanged(chat: string, mode: AgentMode) {
    this.send({ kind: "mode", chat, mode }, chat)
  }

  asked(request: PermissionRequest) {
    const ask: PhoneAsk = {
      id: request.id,
      title: request.title.slice(0, 300),
      ...(request.detail ? { detail: request.detail.slice(0, 4000) } : {}),
      options: request.options.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
      ...(request.plan ? { plan: true } : {}),
    }
    this.waiting.set(request.id, { chat: request.threadId, ask })
    this.send({ kind: "ask", chat: request.threadId, request: ask }, request.threadId)
  }

  answered(chat: string, id: string) {
    this.waiting.delete(id)
    this.send({ kind: "answered", chat, id }, chat)
  }
}

/** The folder of the newest agent chat, this agent's first; threads come newest first. */
export function lastFolder(threads: ThreadSummary[], agentId: string): string | undefined {
  const agentChats = threads.filter((t) => t.source === "agent" && t.cwd)
  return (agentChats.find((t) => t.agentId === agentId) ?? agentChats[0])?.cwd
}

export function phoneCatalog(c: ModelCatalog): PhoneCatalog {
  return {
    axe: c.axe.models.map((m) => ({ id: m.id, label: m.label })),
    defaultModelId: c.axe.defaultModelId,
    agents: c.agents.filter((a) => a.state === "ready").map((a) => ({ id: a.id, name: a.name })),
  }
}
