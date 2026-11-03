import type { RequestPermissionRequest, SessionMode } from "@agentclientprotocol/sdk"

import type { AgentMode, Part } from "@shared/types"

// Permission modes for CLI agents, and what they mean on the wire.
//
// Plan maps to the agent's own plan mode (Claude Code's "plan"): the agent itself
// must not act. Ask, Accept edits and Full access keep the agent on its asking mode
// ("default") and this engine answers for you: that way every change the agent makes
// passes through here first, so its file is saved before it changes (Undo, Rewind).

export const MODES: AgentMode[] = ["ask", "acceptEdits", "plan", "full"]
export const isMode = (m: unknown): m is AgentMode => typeof m === "string" && (MODES as string[]).includes(m)

const ASKING = /^(default|ask|manual)$/i
const PLAN = /^plan$/i

/** The agent's own mode to be in for ours, when it has one. */
export function nativeMode(mode: AgentMode, available: SessionMode[]): string | undefined {
  const pick = (re: RegExp) => available.find((m) => re.test(m.id))?.id
  return mode === "plan" ? pick(PLAN) : pick(ASKING)
}

/** The agent switched its own mode (current_mode_update): ours follows. */
export function modeFromNative(id: string, current: AgentMode, beforePlan: AgentMode | undefined): AgentMode {
  if (PLAN.test(id)) return "plan"
  if (/^acceptEdits$/i.test(id) || /auto.?edit/i.test(id)) return "acceptEdits"
  if (/bypass|full|yolo/i.test(id)) return "full"
  // Back on its asking mode: ours keeps answering for you, unless it just left plan mode.
  return current === "plan" ? (beforePlan ?? "ask") : current
}

/** Where Start takes a plan: edits go ahead (or everything, if you had Full access before). */
export const modeAfterPlan = (beforePlan: AgentMode | undefined): AgentMode => (beforePlan === "full" ? "full" : "acceptEdits")

/** The plan text when the agent asks to leave plan mode (Claude Code's ExitPlanMode). */
export function planRequest(p: RequestPermissionRequest): string | undefined {
  const call = p.toolCall
  const raw = call.rawInput as Record<string, unknown> | undefined
  const plan = raw && typeof raw.plan === "string" ? raw.plan.trim() : ""
  if (call.kind === "switch_mode" || /^ready to code\??$/i.test(call.title ?? "") || plan) return plan || "Ready to start."
  return undefined
}

const FILE_KINDS = new Set(["edit", "delete", "move"])
const READ_KINDS = new Set(["read", "search", "think"])

type Option = RequestPermissionRequest["options"][number]

const firstAllow = (options: Option[]) => options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind === "allow_always")
const firstReject = (options: Option[]) => options.find((o) => o.kind === "reject_once") ?? options.find((o) => o.kind === "reject_always")

/** The plan question's answers: Start goes ahead and approves edits one by one (this engine approves them), Change keeps planning. */
export function planOptions(options: Option[]): { start?: Option; change?: Option } {
  const start = options.find((o) => o.optionId === "exit-plan-default") ?? firstAllow(options)
  return { start, change: firstReject(options) }
}

/**
 * What this engine answers for you in a mode, or undefined to ask you. `nativePlan`: the agent
 * has its own plan mode, so it won't try to act while planning.
 */
export function autoAnswer(mode: AgentMode, p: RequestPermissionRequest, nativePlan: boolean): string | undefined {
  if (planRequest(p)) return undefined
  const kind = p.toolCall.kind ?? "other"
  const options = p.options
  switch (mode) {
    case "full":
      return firstAllow(options)?.optionId
    case "acceptEdits":
      return FILE_KINDS.has(kind) || READ_KINDS.has(kind) || touchesFiles(p) ? firstAllow(options)?.optionId : undefined
    case "plan":
      // An agent without a plan mode of its own may still try to change things: say no for you.
      if (!nativePlan && !READ_KINDS.has(kind) && kind !== "fetch") return firstReject(options)?.optionId
      return undefined
    default:
      return undefined
  }
}

/** A request that changes files (an edit, or a tool call carrying a diff). */
export function touchesFiles(p: RequestPermissionRequest): boolean {
  return FILE_KINDS.has(p.toolCall.kind ?? "") || (p.toolCall.content ?? []).some((c) => c.type === "diff")
}

/** Files a tool call names: its locations, its diffs and the path in its input. */
export function toolPaths(call: { locations?: { path: string }[] | null; content?: { type: string; path?: string }[] | null; rawInput?: unknown }): string[] {
  const out = new Set<string>()
  for (const l of call.locations ?? []) if (l.path) out.add(l.path)
  for (const c of call.content ?? []) if (c.type === "diff" && c.path) out.add(c.path)
  const raw = call.rawInput
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    for (const key of ["file_path", "filePath", "path", "notebook_path"]) if (typeof r[key] === "string" && r[key]) out.add(r[key] as string)
  }
  return [...out]
}

/** Without a plan mode of its own, the agent is asked to plan in words. */
export const PLAN_ONLY_NOTE =
  "Plan first. Read what you need, then reply with a short numbered plan. Don't change any files or run commands that change anything until I say start."

/** Start, for an agent that planned in words (or a plan turn that ended without asking). */
export const GO_AHEAD = "Go ahead with the plan."

type PlanPart = Extract<Part, { type: "plan" }>

/**
 * A Markdown plan as the plan card shows it: the opening line, and the steps of its first list
 * (the longest one when there are several). Numbered or bulleted, nested lines stay with their step.
 */
export function parsePlan(markdown: string): Pick<PlanPart, "summary" | "entries" | "text"> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const lists: string[][] = []
  let current: string[] | null = null
  let summary = ""
  let fenced = false
  for (const line of lines) {
    // A code block (often the file as it will look) is never a step.
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      if (current) {
        lists.push(current)
        current = null
      }
      continue
    }
    if (fenced) continue
    const item = line.match(/^(?:\d+[.)]|[-*+])\s+(.*)$/)
    if (item) {
      current ??= []
      current.push(clean(item[1]!))
      continue
    }
    if (current && /^\s+\S/.test(line) && current.length) continue
    if (current && line.trim() === "") continue
    if (current) {
      lists.push(current)
      current = null
    }
    const t = line.trim()
    if (!summary && t && !t.startsWith("#") && !t.startsWith("```") && !/^[-*_]{3,}$/.test(t)) summary = clean(t)
  }
  if (current) lists.push(current)
  const best = lists.reduce<string[]>((a, b) => (b.length > a.length ? b : a), [])
  return {
    ...(summary ? { summary } : {}),
    entries: best.map((text) => ({ text, status: "pending" as const })),
    text: markdown.trim(),
  }
}

/** Plain words for a step: no bold markers or code ticks. */
const clean = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\[[ x]\]\s+/i, "")
    .trim()
