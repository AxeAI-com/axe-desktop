import type { SessionUpdate, ToolCallContent, ToolCallLocation, ToolCallStatus, Usage } from "@agentclientprotocol/sdk"

import type { ChatMessage, Part, ToolKind, ToolState } from "@shared/types"

import { describe, type Input } from "../doit/tools"

// ACP session updates (what Claude Code, Codex and friends report while they
// work) mapped onto the window's Parts. Mirrors ACPAgent.handleUpdate in Swift.

type Tool = Extract<Part, { type: "tool" }>
type Reasoning = Extract<Part, { type: "reasoning" }>

const KINDS = new Set<ToolKind>(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "other"])
export const toolKind = (k: string | null | undefined): ToolKind => (k && KINDS.has(k as ToolKind) ? (k as ToolKind) : "other")

export function toolState(s: ToolCallStatus | null | undefined): ToolState | undefined {
  switch (s) {
    case "pending":
    case "in_progress":
      return "running"
    case "completed":
      return "done"
    case "failed":
      return "failed"
    default:
      return undefined
  }
}

const MAX_OUTPUT = 4000
const clip = (s: string, n = MAX_OUTPUT) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** The interesting part of a tool's input: its command, path, URL or query. */
export function inputText(raw: unknown, locations?: ToolCallLocation[] | null): string | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    for (const key of ["command", "cmd", "file_path", "filePath", "path", "url", "pattern", "query", "description"]) {
      const v = r[key]
      if (typeof v === "string" && v) return clip(v, 1000)
      if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) return clip(v.join(" "), 1000)
    }
  } else if (typeof raw === "string" && raw) return clip(raw, 1000)
  const paths = (locations ?? []).map((l) => (l.line ? `${l.path}:${l.line}` : l.path)).filter(Boolean)
  return paths.length ? paths.join("\n") : undefined
}

/** Text the tool produced (content blocks), for the output preview. */
export function contentText(content: ToolCallContent[] | null | undefined): string | undefined {
  const texts: string[] = []
  for (const c of content ?? []) {
    if (c.type === "content") {
      const b = c.content
      if (b.type === "text") texts.push(b.text)
      else if (b.type === "resource" && "text" in b.resource) texts.push(b.resource.text)
      else if (b.type === "resource_link") texts.push(b.uri)
    }
  }
  return texts.length ? clip(unfence(texts.join("\n"))) : undefined
}

/** Claude Code wraps command output in a ```console block; the step view already shows it as code. */
export const unfence = (s: string) => s.match(/^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/)?.[1] ?? s

export function diffs(content: ToolCallContent[] | null | undefined): Tool["diff"] {
  const out: NonNullable<Tool["diff"]> = []
  for (const c of content ?? [])
    if (c.type === "diff") out.push({ path: c.path, ...(c.oldText != null ? { before: c.oldText } : {}), after: c.newText })
  return out.length ? out : undefined
}

function rawOutputText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw ? clip(raw) : undefined
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>
    for (const key of ["output", "stdout", "content", "result"]) if (typeof r[key] === "string" && r[key]) return clip(r[key] as string)
  }
  return undefined
}

let seq = 0
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`

/** Builds one assistant message from a prompt turn's updates. */
export class ReplyBuilder {
  private thoughtStarted = new Map<string, number>()
  /** Axe's own MCP tools by call id (their input often arrives after the title). */
  private axeTools = new Map<string, string>()

  constructor(
    readonly message: ChatMessage,
    private readonly clock: () => number = Date.now,
  ) {}

  private get parts() {
    return this.message.parts
  }

  private last(): Part | undefined {
    return this.parts[this.parts.length - 1]
  }

  /** "Thought for 4s": closes thinking once the agent moves on. */
  private closeThought() {
    for (const p of this.parts) if (p.type === "reasoning" && !p.done) this.finishThought(p)
  }

  private finishThought(p: Reasoning) {
    p.done = true
    const started = this.thoughtStarted.get(p.id)
    if (started !== undefined) p.seconds = Math.max(1, Math.round((this.clock() - started) / 1000))
  }

  private tool(id: string): Tool | undefined {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]
      if (p?.type === "tool" && p.id === id) return p
    }
    return undefined
  }

  /** Applies one update. Returns false when it changed nothing the window shows. */
  apply(u: SessionUpdate): boolean {
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        if (u.content.type !== "text" || !u.content.text) return false
        this.closeThought()
        const last = this.last()
        if (last?.type === "text") last.text += u.content.text
        else this.parts.push({ type: "text", id: newId("t"), text: u.content.text })
        return true
      }
      case "agent_thought_chunk": {
        if (u.content.type !== "text" || !u.content.text) return false
        const last = this.last()
        if (last?.type === "reasoning" && !last.done) last.text += u.content.text
        else {
          const id = newId("r")
          this.thoughtStarted.set(id, this.clock())
          this.parts.push({ type: "reasoning", id, text: u.content.text, done: false })
        }
        return true
      }
      case "tool_call":
      case "tool_call_update": {
        this.closeThought()
        let p = this.tool(u.toolCallId)
        if (!p) {
          p = { type: "tool", id: u.toolCallId, title: "Working", kind: "other", state: "running" }
          this.parts.push(p)
        }
        const axeName = u.title ? /^mcp__axe__(\w+)/.exec(u.title)?.[1] : undefined
        if (axeName) this.axeTools.set(u.toolCallId, axeName)
        else if (u.title) p.title = u.title
        if (u.kind) p.kind = toolKind(u.kind)
        const state = toolState(u.status)
        if (state) p.state = state
        const output = contentText(u.content) ?? rawOutputText(u.rawOutput)
        if (output) p.output = output
        const axe = this.axeTools.get(u.toolCallId)
        if (axe) {
          // Axe's own MCP tools read like Do it steps: "mcp__axe__browser_open" becomes "Open localhost/form".
          if (u.rawInput !== undefined || axeName) {
            const d = describe(axe, (u.rawInput && typeof u.rawInput === "object" ? u.rawInput : {}) as Input)
            if (u.rawInput !== undefined || p.title === "Working") p.title = d.title
            if (!u.kind) p.kind = d.kind
            if (d.input) p.input = d.input
          }
          // A step you said no to in Axe's card isn't a failure.
          if (p.state === "failed" && /said no to this step/.test(p.output ?? "")) {
            p.state = "declined"
            p.output = "You said no."
          }
        } else {
          const input = inputText(u.rawInput, u.locations)
          if (input) p.input = input
        }
        const d = diffs(u.content)
        if (d) p.diff = d
        return true
      }
      case "plan": {
        this.setPlan(u.entries)
        return true
      }
      case "usage_update": {
        if (!(u.size > 0)) return false
        this.message.context = { used: u.used, size: u.size, ...(u.cost ? { cost: { amount: u.cost.amount, currency: u.cost.currency } } : {}) }
        return true
      }
      case "plan_update": {
        if (u.plan.type !== "items") return false
        this.setPlan(u.plan.entries)
        return true
      }
      default:
        return false
    }
  }

  /**
   * The agent asks to start a plan it made in Plan mode: the plan card shows it, waiting for
   * Start. Returns the card's id. A to-do list it already sent becomes that card.
   */
  proposePlan(plan: Pick<Extract<Part, { type: "plan" }>, "summary" | "entries" | "text">): string {
    this.closeThought()
    const existing = this.parts.find((p): p is Extract<Part, { type: "plan" }> => p.type === "plan")
    const part = existing ?? { type: "plan" as const, id: newId("plan"), entries: [] }
    if (plan.entries.length || !existing) part.entries = plan.entries
    if (plan.summary) part.summary = plan.summary
    if (plan.text) part.text = plan.text
    part.stage = "proposed"
    if (!existing) this.parts.push(part)
    return part.id
  }

  /** Start was pressed: the plan card becomes the to-do list it works through. */
  startPlan(partId: string) {
    const part = this.parts.find((p) => p.id === partId)
    if (part?.type === "plan") part.stage = "started"
    this.todoSinceStart = false
  }

  /** Did the agent send its own to-do list after Start? (Then that list ticks, not the plan's steps.) */
  private todoSinceStart = false

  private setPlan(entries: { content: string; status: string }[]) {
    const mapped = entries.map((e) => ({
      text: e.content,
      status: (e.status === "completed" ? "done" : e.status === "in_progress" ? "running" : "pending") as "pending" | "running" | "done",
    }))
    const existing = this.parts.find((p): p is Extract<Part, { type: "plan" }> => p.type === "plan")
    if (existing) existing.entries = mapped
    else this.parts.push({ type: "plan", id: newId("plan"), entries: mapped })
    this.todoSinceStart = true
  }

  /** The turn's token count, when the agent sends no usage_update (no window size then). */
  usage(u: Usage | null | undefined) {
    if (!u || this.message.context) return
    const used = u.inputTokens + (u.cachedReadTokens ?? 0) + u.outputTokens
    if (used > 0) this.message.context = { used }
  }

  /** The turn ended: close thinking, settle tools still marked running. */
  finish(stopReason?: string) {
    this.closeThought()
    // A started plan with no to-do list of the agent's own (a small job): done when the turn ends well.
    if (stopReason === "end_turn" && !this.todoSinceStart)
      for (const p of this.parts) if (p.type === "plan" && p.stage === "started") p.entries = p.entries.map((e) => ({ ...e, status: "done" }))
    for (const p of this.parts) if (p.type === "tool" && p.state === "running") p.state = stopReason === "cancelled" ? "failed" : "done"
    if (stopReason === "max_tokens" || stopReason === "max_turn_requests")
      this.parts.push({ type: "error", id: newId("e"), text: "The agent stopped before finishing. Ask it to continue." })
    if (stopReason === "refusal") this.parts.push({ type: "error", id: newId("e"), text: "The agent declined to continue." })
  }

  error(text: string) {
    this.closeThought()
    for (const p of this.parts) if (p.type === "tool" && p.state === "running") p.state = "failed"
    this.parts.push({ type: "error", id: newId("e"), text })
  }
}
