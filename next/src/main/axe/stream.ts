import { fromTool, RICH_HINT_CLOSE, RICH_HINT_OPEN } from "@shared/rich"
import type { Attachment, ChatMessage, ContextUsage, Json, Part, ResearchApproval, ResearchData, ToolKind } from "@shared/types"

// The website's UI message stream ("data: {...}" lines), applied to a message the
// same way ImperiumAxe/AxeMessage.swift does on the Mac, mapped into the window's
// Part types.

/** Splits a server-sent-events body into JSON chunks. Keeps partial lines buffered. */
export class SSEReader {
  private buffer = ""

  push(text: string): Json[] {
    this.buffer += text
    const out: Json[] = []
    let i = this.buffer.indexOf("\n")
    while (i >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, "")
      this.buffer = this.buffer.slice(i + 1)
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim()
        if (payload && payload !== "[DONE]") {
          try {
            out.push(JSON.parse(payload) as Json)
          } catch {
            // A broken line is skipped, like the Mac does.
          }
        }
      }
      i = this.buffer.indexOf("\n")
    }
    return out
  }
}

const str = (v: Json | undefined): string | undefined => (typeof v === "string" ? v : undefined)
const obj = (v: Json | undefined): Record<string, Json> => (v && typeof v === "object" && !Array.isArray(v) ? v : {})

let seq = 0
export const newPartId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`

/** Earlier turns another answerer gave, sent ahead of a message so this one has the context.
 * Stripped again when the message comes back from the server. */
export const CONTEXT_OPEN = "<earlier-in-this-chat>"
export const CONTEXT_CLOSE = "</earlier-in-this-chat>"
/** What Axe remembers about you, sent ahead of the first message of a chat. Stripped the same way. */
export const MEMORY_OPEN = "<what-to-remember-about-me>"
export const MEMORY_CLOSE = "</what-to-remember-about-me>"
/** An agent's or skill's instructions ahead of a message (libraries/context.ts). */
export const LIBRARY_OPEN = "<axe-desktop-context>"
export const LIBRARY_CLOSE = "</axe-desktop-context>"

/**
 * A chat title the website made from a block the app sends ahead of your words (context, memory, a
 * agent's instructions, the old card hint) instead of from your words.
 */
export const leakedTitle = (title: string) =>
  /<\/?(axe-desktop-context|earlier-in-this-chat|what-to-remember-about-me|axe-desktop-cards)\b|```|^The user\b/i.test(title)

/** A title for the sidebar: never the tags of those blocks. */
export const cleanTitle = (title: string) =>
  title.replace(/^title:\s*/i, "").replace(/<\/?(axe-desktop-context|earlier-in-this-chat|what-to-remember-about-me|axe-desktop-cards)>/g, "").replace(/\s+/g, " ").trim() || "New chat"

/** A plain title from the first message, as the website makes when its title model fails. */
export function plainTitle(text: string) {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length <= 60 ? line || "New chat" : `${line.slice(0, 60).replace(/\s+\S*$/, "")}…`
}

export function stripContext(text: string): string {
  const hint = text.lastIndexOf(RICH_HINT_OPEN)
  if (hint >= 0 && text.trimEnd().endsWith(RICH_HINT_CLOSE)) text = text.slice(0, hint).replace(/\s+$/, "")
  for (;;) {
    const pair = text.startsWith(CONTEXT_OPEN)
      ? CONTEXT_CLOSE
      : text.startsWith(MEMORY_OPEN)
        ? MEMORY_CLOSE
        : text.startsWith(LIBRARY_OPEN)
          ? LIBRARY_CLOSE
          : undefined
    if (!pair) return text
    const end = text.indexOf(pair)
    if (end < 0) return text
    text = text.slice(end + pair.length).replace(/^\s+/, "")
  }
}

/** The research record as the window's type; anything malformed is dropped. */
export function researchData(v: Json | undefined): ResearchData | undefined {
  const d = obj(v)
  if (!Array.isArray(d.steps) || !Array.isArray(d.sources)) return undefined
  const status = str(d.status)
  const num = (x: Json | undefined) => (typeof x === "number" ? x : undefined)
  return {
    status: status === "complete" || status === "failed" ? status : "running",
    queries: (Array.isArray(d.queries) ? d.queries : []).filter((q): q is string => typeof q === "string"),
    steps: d.steps.map(obj).flatMap((s) => {
      const kind = str(s.kind)
      if (kind !== "plan" && kind !== "search" && kind !== "read" && kind !== "write") return []
      const st = str(s.status)
      return [
        {
          id: str(s.id) ?? newPartId(),
          kind,
          verb: str(s.verb) ?? "",
          ...(str(s.target) ? { target: str(s.target) } : {}),
          ...(str(s.detail) ? { detail: str(s.detail) } : {}),
          status: st === "complete" || st === "failed" ? st : "running",
          startedAt: num(s.startedAt) ?? 0,
          ...(num(s.endedAt) !== undefined ? { endedAt: num(s.endedAt) } : {}),
        },
      ]
    }),
    sources: d.sources.map(obj).flatMap((s) => {
      const url = str(s.url)
      const n = num(s.n)
      if (!url || n === undefined) return []
      return [{ n, url, title: str(s.title) ?? url, site: str(s.site) ?? siteOf(url), snippet: str(s.snippet) ?? "", read: s.read === true }]
    }),
    startedAt: num(d.startedAt) ?? 0,
    ...(num(d.endedAt) !== undefined ? { endedAt: num(d.endedAt) } : {}),
  }
}

export function researchApproval(v: Json | undefined): ResearchApproval | undefined {
  const d = obj(v)
  const modelId = str(d.modelId)
  if (!modelId) return undefined
  const status = str(d.status)
  const num = (x: Json | undefined) => (typeof x === "number" ? x : 0)
  return { status: status === "cancelled" || status === "approved" ? status : "pending", searches: num(d.searches), pages: num(d.pages), estimate: num(d.estimate), modelId }
}

/** Context after a reply, from its metadata: the tokens it read plus what it wrote. */
export function contextFrom(metadata: Json | undefined): ContextUsage | undefined {
  const meta = obj(metadata)
  const u = obj(meta.usage)
  const input = typeof u.inputTokens === "number" ? u.inputTokens : undefined
  if (input === undefined) return undefined
  const output = typeof u.outputTokens === "number" ? u.outputTokens : 0
  const modelId = str(meta.modelId)
  return { used: input + output, ...(modelId ? { modelId } : {}) }
}

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Adds the card drawn from a website tool (show_map, draft_email), once. */
function addRich(parts: Part[], toolCallId: string, name: string, input: Json | undefined, output: Json | undefined) {
  const block = fromTool(name, input, output)
  const id = `rich-${toolCallId}`
  if (!block || parts.some((p) => p.id === id)) return
  parts.push({ type: "rich", id, block })
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

function shortText(v: Json | undefined, n = 600): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "string") return clip(v, n)
  try {
    return clip(JSON.stringify(v), n)
  } catch {
    return undefined
  }
}

/** A web search's results as sources (kept with their ids, which answers cite) and a readable list. */
export function searchResults(output: Json | undefined): { sources: { id: string; title: string; url: string }[]; list?: string } {
  const list = Array.isArray(obj(output).sources) ? (obj(output).sources as Json[]) : []
  const sources = list
    .map((s) => obj(s))
    .filter((s) => str(s.url))
    .map((s) => ({ id: str(s.id) ?? (str(s.url) as string), title: str(s.title) ?? (str(s.url) as string), url: str(s.url) as string, site: str(s.site) }))
  const lines = sources.map((s) => `${s.site ?? new URL(s.url).hostname.replace(/^www\./, "")}  ${s.title}`)
  return { sources: sources.map(({ id, title, url }) => ({ id, title, url })), ...(lines.length ? { list: lines.join("\n") } : {}) }
}

function addSources(parts: Part[], sources: { id: string; title: string; url: string }[]) {
  for (const s of sources)
    if (!parts.some((p) => p.type === "source" && (p.url === s.url || p.id === s.id))) parts.push({ type: "source", ...s })
}

/** Plain words for the server's tools. */
export function describeTool(name: string, input: Json | undefined): { title: string; kind: ToolKind; input?: string } {
  const i = obj(input)
  const query = str(i.query) ?? str(i.q)
  const url = str(i.url)
  switch (name) {
    case "web_search":
    case "search":
      return { title: "Searched the web", kind: "search", input: query }
    case "fetch":
    case "web_fetch":
    case "read_url":
    case "fetch_url":
      return { title: "Read a page", kind: "fetch", input: url }
    default: {
      const words = name.replace(/[_-]+/g, " ").trim()
      return { title: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool", kind: "other", input: query ?? url ?? shortText(input, 300) }
    }
  }
}

type Reply = ChatMessage & { _started?: Record<string, number>; _tools?: Record<string, string> }

/** Applies one stream chunk to the reply. Returns an error text when the chunk is an error. */
export function applyChunk(message: ChatMessage, chunk: Json, now = Date.now()): string | undefined {
  const m = message as Reply
  const c = obj(chunk)
  const parts = m.parts
  const at = (id: string | undefined) => (id ? findLast(parts, (p) => p.id === id) : -1)
  const started = (m._started ??= {})
  const toolNames = (m._tools ??= {})
  switch (str(c.type)) {
    case "start": {
      const id = str(c.messageId)
      if (id) m.id = id
      return
    }
    case "text-start":
      parts.push({ type: "text", id: str(c.id) ?? newPartId(), text: "" })
      return
    case "text-delta":
      appendDelta(m, str(c.id), str(c.delta) ?? "", false, now)
      return
    case "reasoning-start": {
      const id = str(c.id) ?? newPartId()
      started[id] = now
      parts.push({ type: "reasoning", id, text: "", done: false })
      return
    }
    case "reasoning-delta":
      appendDelta(m, str(c.id), str(c.delta) ?? "", true, now)
      return
    case "reasoning-end": {
      const p = parts[at(str(c.id))]
      if (p?.type === "reasoning") finishReasoning(p, started[p.id], now)
      return
    }
    case "tool-input-start":
    case "tool-input-available": {
      const id = str(c.toolCallId) ?? newPartId()
      const name = str(c.toolName) ?? toolNames[id] ?? "tool"
      toolNames[id] = name
      const d = describeTool(name, c.input)
      const i = at(id)
      const p = parts[i]
      if (p?.type === "tool") {
        if (d.input) p.input = d.input
      } else {
        parts.push({ type: "tool", id, title: d.title, kind: d.kind, state: "running", ...(d.input ? { input: d.input } : {}) })
      }
      if (str(c.type) === "tool-input-available") addRich(parts, id, name, c.input, undefined)
      return
    }
    case "tool-output-available": {
      const p = parts[at(str(c.toolCallId))]
      if (p?.type === "tool") {
        p.state = "done"
        const found = p.kind === "search" ? searchResults(c.output) : undefined
        const out = found?.list ?? shortText(c.output)
        if (out) p.output = out
        if (found) addSources(parts, found.sources)
        addRich(parts, p.id, toolNames[p.id] ?? "", undefined, c.output)
      }
      return
    }
    case "tool-output-error": {
      const p = parts[at(str(c.toolCallId))]
      if (p?.type === "tool") {
        p.state = "failed"
        p.output = str(c.errorText) ?? "Failed"
      }
      return
    }
    case "source-url": {
      const url = str(c.url)
      if (url && !parts.some((p) => p.type === "source" && p.url === url))
        parts.push({ type: "source", id: str(c.sourceId) ?? url, title: str(c.title) ?? url, url })
      return
    }
    case "data-research": {
      const data = researchData(c.data)
      if (data) upsert(parts, { type: "research", id: str(c.id) ?? "research", data })
      return
    }
    case "data-researchApproval": {
      const data = researchApproval(c.data)
      if (data) upsert(parts, { type: "researchApproval", id: str(c.id) ?? "approval", data })
      return
    }
    case "finish": {
      const context = contextFrom(c.messageMetadata)
      if (context) m.context = context
      return
    }
    case "error": {
      const text = str(c.errorText) ?? "The model stopped."
      parts.push({ type: "error", id: newPartId(), text })
      return text
    }
    default:
      return
  }
}

/** Ends the reply: closes thinking still open, drops bookkeeping. */
export function finishReply(message: ChatMessage, now = Date.now()) {
  const m = message as Reply
  for (const p of m.parts) if (p.type === "reasoning" && !p.done) finishReasoning(p, m._started?.[p.id], now)
  for (const p of m.parts) if (p.type === "tool" && p.state === "running") p.state = "done"
  // A run cut short (stopped, connection lost) ends as failed, never spinning.
  for (const p of m.parts)
    if (p.type === "research" && p.data.status === "running") {
      p.data.status = "failed"
      p.data.endedAt = now
      for (const s of p.data.steps) if (s.status === "running") Object.assign(s, { status: "failed", detail: "Stopped", endedAt: now })
    }
  delete m._started
  delete m._tools
}

/** A copy safe to send to the window (no bookkeeping fields). */
export function publicMessage(message: ChatMessage): ChatMessage {
  const { _started, _tools, ...rest } = message as Reply
  void _started
  void _tools
  return structuredClone(rest)
}

function finishReasoning(p: Extract<Part, { type: "reasoning" }>, startedAt: number | undefined, now: number) {
  p.done = true
  // "Thought for 4s".
  if (startedAt !== undefined) p.seconds = Math.max(1, Math.round((now - startedAt) / 1000))
}

function appendDelta(m: Reply, id: string | undefined, delta: string, reasoning: boolean, now: number) {
  const parts = m.parts
  const i = id ? findLast(parts, (p) => p.id === id) : -1
  const p = parts[i]
  if (p && (p.type === "text" || p.type === "reasoning")) {
    p.text += delta
    return
  }
  const pid = id ?? newPartId()
  if (reasoning) {
    ;(m._started ??= {})[pid] = now
    parts.push({ type: "reasoning", id: pid, text: delta, done: false })
  } else parts.push({ type: "text", id: pid, text: delta })
}

/** Data parts come again with the same id as they change: replace in place. */
function upsert(parts: Part[], part: Part) {
  const i = findLast(parts, (p) => p.type === part.type && p.id === part.id)
  if (i >= 0) parts[i] = part
  else parts.push(part)
}

function findLast<T>(a: T[], f: (t: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (f(a[i] as T)) return i
  return -1
}

/** A message stored on axeai.com, as the history endpoint returns it. */
export function storedMessage(m: Json): ChatMessage | undefined {
  const o = obj(m)
  const id = str(o.id)
  const role = str(o.role)
  if (!id || (role !== "user" && role !== "assistant")) return undefined
  const meta = obj(o.metadata)
  const parts: Part[] = []
  const attachments: Attachment[] = []
  for (const raw of Array.isArray(o.parts) ? o.parts : []) {
    const p = obj(raw)
    const type = str(p.type) ?? ""
    switch (type) {
      case "text": {
        const text = role === "user" ? stripContext(str(p.text) ?? "") : (str(p.text) ?? "")
        parts.push({ type: "text", id: newPartId(), text })
        break
      }
      case "reasoning":
        parts.push({ type: "reasoning", id: newPartId(), text: str(p.text) ?? "", done: true })
        break
      case "source-url":
        parts.push({ type: "source", id: str(p.sourceId) ?? newPartId(), title: str(p.title) ?? str(p.url) ?? "", url: str(p.url) ?? "" })
        break
      case "data-research": {
        const data = researchData(p.data)
        if (data) parts.push({ type: "research", id: str(p.id) ?? newPartId(), data })
        break
      }
      case "data-researchApproval": {
        const data = researchApproval(p.data)
        if (data) parts.push({ type: "researchApproval", id: str(p.id) ?? newPartId(), data })
        break
      }
      case "data-attachment": {
        const a = obj(p.data)
        if (str(a.name)) attachments.push({ path: "", name: str(a.name) ?? "", mime: str(a.mediaType) ?? "application/octet-stream", size: typeof a.size === "number" ? a.size : 0 })
        break
      }
      default:
        if (type.startsWith("tool-")) {
          const d = describeTool(type.slice(5), p.input)
          const failed = str(p.state) === "output-error"
          const found = !failed && d.kind === "search" ? searchResults(p.output) : undefined
          if (found) addSources(parts, found.sources)
          const output = failed ? str(p.errorText) : (found?.list ?? shortText(p.output))
          parts.push({
            type: "tool",
            id: str(p.toolCallId) ?? newPartId(),
            title: d.title,
            kind: d.kind,
            state: failed ? "failed" : "done",
            ...(d.input ? { input: d.input } : {}),
            ...(output ? { output } : {}),
          })
          if (!failed) addRich(parts, str(p.toolCallId) ?? newPartId(), type.slice(5), p.input, p.output)
        }
    }
  }
  const message: ChatMessage = { id, role, parts }
  const createdAt = str(o.createdAt) ?? str(meta.createdAt)
  if (createdAt) message.createdAt = createdAt
  const modelId = str(meta.modelId)
  if (role === "assistant" && modelId) message.answerer = { kind: "axe", modelId }
  if (attachments.length) message.attachments = attachments
  const context = role === "assistant" ? contextFrom(meta) : undefined
  if (context) message.context = context
  return message
}

export function messageText(m: ChatMessage): string {
  return m.parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
}
