import type { ChatMessage, Json, Part } from "@shared/types"

import { AxeError } from "../axe/client"
import { newPartId } from "../axe/stream"
import { mustAsk } from "./guard"
import { describe, type Input, type Tool } from "./tools"

// "Do it": Axe plans, this computer acts. Each model step comes from /api/agent/respond; the tool
// calls run here and their results go back as tool messages (MacTask.swift on the Mac,
// desktop/src/main/agent/doit.ts in the old app). Every call shows in the chat as a step, the same
// Part a CLI agent's tool call becomes. Anything risky waits for your OK unless Full access is on.
// No Electron in here: unit tests drive it with a fake brain and a fake toolbox.

export const MAX_STEPS = 30

export type Brain = (call: { system: string; messages: Json[]; tools: Tool[]; signal: AbortSignal }) => AsyncIterable<Json>

export type ToolOutcome = {
  /** What the model reads back. */
  text: string
  /** A short look at the result for the step; defaults to nothing. */
  output?: string
  diff?: { path: string; before?: string; after: string }[]
}

/** A reason to ask before a call. `always`: ask even with Full access (a protected folder). `title`: a better step title, once the target is known. */
export type Check = { reason?: string; always?: boolean; title?: string }

export type Toolbox = {
  tools: Tool[]
  check(name: string, input: Input): Promise<Check>
  run(name: string, input: Input, ctx: { signal: AbortSignal; progress: (output: string) => void }): Promise<ToolOutcome>
}

export type Hooks = {
  /** The reply changed; send it to the window. */
  changed(): void
  /** Waits for the user's answer to "Allow this?". */
  ask(question: { title: string; detail?: string }): Promise<boolean>
  fullAccess(): boolean
  /** What this chat already allowed that would otherwise always ask (a protected folder). */
  allowed?: Set<string>
}

/** `inputError`: the model's arguments couldn't be read; the call isn't run and this goes back as its result. */
type Call = { id: string; name: string; input: Input; inputError?: string }
type ToolPart = Extract<Part, { type: "tool" }>

export const DECLINED = "The user said no to this step. Don't do it, and don't try it another way. Say what you would have done and stop."

export class DoItRun {
  /** Model messages so far: what the user asked, the model's turns and the tool results. */
  readonly history: Json[] = []
  private waits: number[]

  constructor(
    private readonly reply: ChatMessage,
    private readonly brain: Brain,
    private readonly toolbox: Toolbox,
    private readonly hooks: Hooks,
    private readonly system: string,
    private readonly signal: AbortSignal,
    options: { waits?: number[]; history?: Json[] } = {},
  ) {
    this.waits = options.waits ?? [2, 5, 10, 15]
    if (options.history) this.history.push(...options.history)
  }

  /** Runs until the model stops calling tools. Throws on errors the reply should show. A goal with photos is a list of parts. */
  async run(goal: string | Json[]): Promise<void> {
    this.history.push({ role: "user", content: goal })
    for (let step = 0; step < MAX_STEPS; step++) {
      this.stopIfAborted()
      const { text, calls } = await this.think()
      const assistant: Json[] = []
      if (text) assistant.push({ type: "text", text })
      for (const c of calls) assistant.push({ type: "tool-call", toolCallId: c.id, toolName: c.name, input: c.input as Json })
      if (assistant.length) this.history.push({ role: "assistant", content: assistant })
      if (!calls.length) {
        this.finishPlan()
        return
      }
      const results: Json[] = []
      for (const c of calls) {
        const out = await this.perform(c)
        results.push({ type: "tool-result", toolCallId: c.id, toolName: c.name, output: { type: "text", value: out.slice(0, 8000) } })
      }
      this.history.push({ role: "tool", content: results })
    }
    this.reply.parts.push({ type: "error", id: newPartId(), text: `Stopped after ${MAX_STEPS} steps. Ask again to keep going.` })
  }

  private stopIfAborted() {
    if (this.signal.aborted) throw new Stopped()
  }

  /** One model step, with retries while a free model is busy. */
  private async think(): Promise<{ text: string; calls: Call[] }> {
    for (let attempt = 0; ; attempt++) {
      const added: Part[] = []
      let text = ""
      let textPart: Extract<Part, { type: "text" }> | undefined
      let thought: Extract<Part, { type: "reasoning" }> | undefined
      let thoughtAt = 0
      const endThought = () => {
        if (thought && !thought.done) {
          thought.done = true
          // Under a second reads as plain "Thought", not "Thought for 0s".
          const seconds = Math.round((Date.now() - thoughtAt) / 1000)
          if (seconds > 0) thought.seconds = seconds
        }
      }
      const calls: Call[] = []
      try {
        for await (const raw of this.brain({ system: this.system, messages: this.history, tools: this.toolbox.tools, signal: this.signal })) {
          const c = raw as Record<string, Json>
          if (c.type === "reasoning-delta" && typeof c.delta === "string") {
            if (!thought) {
              thoughtAt = Date.now()
              thought = { type: "reasoning", id: newPartId(), text: "", done: false }
              this.reply.parts.push(thought)
              added.push(thought)
            }
            thought.text += c.delta
            this.hooks.changed()
          } else if (c.type === "text-delta" && typeof c.delta === "string") {
            endThought()
            text += c.delta
            if (!textPart) {
              textPart = { type: "text", id: newPartId(), text: "" }
              this.reply.parts.push(textPart)
              added.push(textPart)
            }
            textPart.text = text
            this.hooks.changed()
          } else if (c.type === "tool-input-available" && typeof c.toolCallId === "string" && typeof c.toolName === "string") {
            endThought()
            const input = c.input && typeof c.input === "object" && !Array.isArray(c.input) ? (c.input as Input) : {}
            calls.push({ id: c.toolCallId, name: c.toolName, input, ...(typeof c.inputError === "string" ? { inputError: c.inputError } : {}) })
          } else if (c.type === "error") {
            throw new AxeError(200, "model_error", typeof c.errorText === "string" ? c.errorText : "The model stopped.")
          }
        }
        endThought()
        // Words before a tool call read as a step note, not as the answer: keep them as they are.
        return { text, calls }
      } catch (e) {
        if (this.signal.aborted) throw new Stopped()
        const busy = e instanceof AxeError && (e.status === 429 || e.status === 503 || /busy|failed to answer/i.test(e.message))
        if (!busy || attempt >= this.waits.length) throw e
        this.reply.parts = this.reply.parts.filter((p) => !added.includes(p))
        this.hooks.changed()
        await sleep((this.waits[attempt] ?? 5) * 1000, this.signal)
      }
    }
  }

  private async perform(c: Call): Promise<string> {
    // Nothing runs on arguments that couldn't be read; the model is asked to send them again.
    if (c.inputError) return c.inputError
    if (c.name === "update_plan") return this.plan(c.input)
    const known = this.toolbox.tools.some((t) => t.name === c.name)
    const d = describe(c.name, c.input)
    const part: ToolPart = { type: "tool", id: newPartId(), title: d.title, kind: d.kind, state: "running", ...(d.input ? { input: d.input } : {}) }
    this.reply.parts.push(part)
    this.hooks.changed()
    const end = (state: ToolPart["state"], text: string, output?: string) => {
      part.state = state
      if (output !== undefined) part.output = output
      this.hooks.changed()
      return text
    }
    if (!known) return end("failed", `There's no tool called ${c.name}.`, `There's no tool called ${c.name}.`)

    let check: Check
    try {
      check = await this.toolbox.check(c.name, c.input)
    } catch (e) {
      return end("failed", `Failed: ${message(e)}`, message(e))
    }
    if (check.title && check.title !== part.title) {
      part.title = check.title
      this.hooks.changed()
    }
    const flagged = c.input.irreversible === true
    if (mustAsk(check, this.hooks.fullAccess(), flagged, this.hooks.allowed ?? new Set())) {
      const why = typeof c.input.why === "string" && c.input.why.trim() ? c.input.why.trim() : undefined
      const allowed = await this.hooks.ask({ title: check.reason ?? d.title, ...(why || d.input ? { detail: why ?? d.input } : {}) })
      this.stopIfAborted()
      if (!allowed) return end("declined", DECLINED, "You said no.")
      if (check.always) this.hooks.allowed?.add(check.reason ?? "")
    }
    try {
      const out = await this.toolbox.run(c.name, c.input, {
        signal: this.signal,
        progress: (output) => {
          part.output = tail(output)
          this.hooks.changed()
        },
      })
      if (out.diff) {
        // The diff names the file; the path above it would say it twice.
        part.diff = out.diff
        delete part.input
      }
      return end("done", out.text, out.output !== undefined ? tail(out.output) : part.output)
    } catch (e) {
      this.stopIfAborted()
      return end("failed", `Failed: ${message(e)}`, message(e))
    }
  }

  /** update_plan becomes the plan card, updated in place. */
  private plan(input: Input): string {
    const steps = Array.isArray(input.steps) ? input.steps.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 12) : []
    if (!steps.length) return "Send at least one step."
    const current = typeof input.current === "number" ? input.current : 0
    const entries = steps.map((text, i) => ({ text, status: (i < current ? "done" : i === current ? "running" : "pending") as "done" | "running" | "pending" }))
    const existing = this.reply.parts.find((p): p is Extract<Part, { type: "plan" }> => p.type === "plan")
    if (existing) existing.entries = entries
    else this.reply.parts.push({ type: "plan", id: newPartId(), entries })
    this.hooks.changed()
    return "Plan shown."
  }

  /** When the run ends, every plan item is done (the model often forgets the last update). */
  private finishPlan() {
    const plan = this.reply.parts.find((p): p is Extract<Part, { type: "plan" }> => p.type === "plan")
    if (!plan || plan.entries.every((e) => e.status === "done")) return
    plan.entries = plan.entries.map((e) => ({ ...e, status: "done" }))
    this.hooks.changed()
  }
}

export class Stopped extends Error {
  constructor() {
    super("Stopped.")
  }
}

const message = (e: unknown) => (e instanceof AxeError ? e.plain : e instanceof Error ? e.message : String(e))
const tail = (s: string, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s)

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new Stopped())
      },
      { once: true },
    )
  })
}
