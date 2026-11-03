import type { ChatMessage, Json, Part } from "@shared/types"

import { AxeError } from "../axe/client"
import { newPartId } from "../axe/stream"
import type { ConnectorTool } from "./connectors"

// An Axe model answering with your connectors: each model step comes from POST /api/agent/respond
// with the connector tools attached; the calls run here through the connector hub and go back as
// tool results, until the model answers in words. Each call shows in the reply as a step, like a CLI
// agent's. Tools that can change things ask first (once per tool per chat, or always).
// When package D's Do it loop (doit/loop.ts) lands, this can become a Toolbox for DoItRun.

export const MAX_STEPS = 12

/** One model step: the same shape as doit/loop.ts so the two can merge. */
export type Brain = (call: { system: string; messages: Json[]; tools: { name: string; description: string; inputSchema: Json }[]; signal: AbortSignal }) => AsyncIterable<Json>

export type ToolTurnHooks = {
  changed(): void
  call(tool: ConnectorTool, input: Record<string, Json | undefined>): Promise<{ text: string; isError: boolean }>
  /** "Allow this?" for a tool that may change things. Resolves "once", "chat" (don't ask again here) or "no". */
  ask(question: { title: string; detail?: string }): Promise<"once" | "chat" | "no">
  /** Tools already allowed in this chat. */
  allowed: Set<string>
}

/** `inputError`: the model's arguments couldn't be read; the call isn't run and this goes back as its result. */
type Call = { id: string; name: string; input: Record<string, Json | undefined>; inputError?: string }

/** Reading and finding never change anything; everything else asks first. */
export const readOnly = (tool: string) => /^(list|get|search|find|read|fetch|query|view|show|describe|lookup|retrieve)[_-]?/i.test(tool)

export const SYSTEM = `You can reach the user's connected apps through tools named "<App>__<action>".
Use them when the question is about what's in those apps; otherwise just answer.
Call tools instead of describing them, read their results, and answer in plain words.
Never say a tool did something unless its result here confirms it.`

export async function runToolTurn(options: {
  reply: ChatMessage
  brain: Brain
  tools: ConnectorTool[]
  system: string
  history: Json[]
  /** What the user asked; a list of parts when it carries photos. */
  text: string | Json[]
  signal: AbortSignal
  hooks: ToolTurnHooks
  waits?: number[]
}): Promise<Json[]> {
  const { reply, brain, tools, hooks, signal } = options
  const history = [...options.history, { role: "user", content: options.text }] as Json[]
  const offered = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as unknown as Json }))
  const waits = options.waits ?? [2, 5, 10]

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) throw new Error("Stopped.")
    const { text, calls } = await think()
    const assistant: Json[] = []
    if (text) assistant.push({ type: "text", text })
    for (const c of calls) assistant.push({ type: "tool-call", toolCallId: c.id, toolName: c.name, input: c.input as Json })
    if (assistant.length) history.push({ role: "assistant", content: assistant })
    if (!calls.length) return history
    const results: Json[] = []
    for (const c of calls) results.push({ type: "tool-result", toolCallId: c.id, toolName: c.name, output: { type: "text", value: (await perform(c)).slice(0, 8000) } })
    history.push({ role: "tool", content: results })
  }
  reply.parts.push({ type: "error", id: newPartId(), text: `Stopped after ${MAX_STEPS} steps. Ask again to keep going.` })
  return history

  async function think(): Promise<{ text: string; calls: Call[] }> {
    for (let attempt = 0; ; attempt++) {
      const added: Part[] = []
      let text = ""
      let textPart: Extract<Part, { type: "text" }> | undefined
      let thought: Extract<Part, { type: "reasoning" }> | undefined
      const calls: Call[] = []
      try {
        for await (const raw of brain({ system: options.system, messages: history, tools: offered, signal })) {
          const c = raw as Record<string, Json>
          if (c.type === "reasoning-delta" && typeof c.delta === "string") {
            if (!thought) {
              thought = { type: "reasoning", id: newPartId(), text: "", done: false }
              reply.parts.push(thought)
              added.push(thought)
            }
            thought.text += c.delta
            hooks.changed()
          } else if (c.type === "text-delta" && typeof c.delta === "string") {
            if (thought) thought.done = true
            text += c.delta
            if (!textPart) {
              textPart = { type: "text", id: newPartId(), text: "" }
              reply.parts.push(textPart)
              added.push(textPart)
            }
            textPart.text = text
            hooks.changed()
          } else if (c.type === "tool-input-available" && typeof c.toolCallId === "string" && typeof c.toolName === "string") {
            if (thought) thought.done = true
            const input = c.input && typeof c.input === "object" && !Array.isArray(c.input) ? (c.input as Call["input"]) : {}
            calls.push({ id: c.toolCallId, name: c.toolName, input, ...(typeof c.inputError === "string" ? { inputError: c.inputError } : {}) })
          } else if (c.type === "error") {
            throw new AxeError(200, "model_error", typeof c.errorText === "string" ? c.errorText : "The model stopped.")
          }
        }
        if (thought) thought.done = true
        return { text, calls }
      } catch (e) {
        if (signal.aborted) throw new Error("Stopped.")
        const busy = e instanceof AxeError && (e.status === 429 || e.status === 503 || /busy|failed to answer/i.test(e.message))
        if (!busy || attempt >= waits.length) {
          if (e instanceof AxeError && e.code === "tools_unsupported") throw new Error("This model can't use connectors. Pick another model, or switch the connectors off.")
          throw e
        }
        reply.parts = reply.parts.filter((p) => !added.includes(p))
        hooks.changed()
        await new Promise((r) => setTimeout(r, (waits[attempt] ?? 5) * 1000))
      }
    }
  }

  async function perform(c: Call): Promise<string> {
    if (c.inputError) return c.inputError
    const tool = tools.find((t) => t.name === c.name)
    const [app = "", action = c.name] = c.name.split("__")
    const words = action.replace(/[_-]+/g, " ")
    const part: Extract<Part, { type: "tool" }> = {
      type: "tool",
      id: newPartId(),
      title: `${app.replace(/_/g, " ")}: ${words.charAt(0).toUpperCase()}${words.slice(1)}`,
      kind: "other",
      state: "running",
      ...(Object.keys(c.input).length ? { input: JSON.stringify(c.input).slice(0, 300) } : {}),
    }
    reply.parts.push(part)
    hooks.changed()
    const end = (state: "done" | "failed", text: string, output?: string) => {
      part.state = state
      if (output) part.output = output.length > 2000 ? `${output.slice(0, 2000)}…` : output
      hooks.changed()
      return text
    }
    if (!tool) return end("failed", `There's no tool called ${c.name}.`)
    if (!readOnly(tool.tool) && !hooks.allowed.has(tool.name)) {
      const answer = await hooks.ask({ title: `Let ${app.replace(/_/g, " ")} ${words}?`, ...(part.input ? { detail: part.input } : {}) })
      if (answer === "no") return end("failed", "The user said no to this step. Don't do it, and don't try it another way.", "You said no.")
      if (answer === "chat") hooks.allowed.add(tool.name)
    }
    try {
      const r = await hooks.call(tool, c.input)
      return end(r.isError ? "failed" : "done", r.text, r.text)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      return end("failed", `Failed: ${m}`, m)
    }
  }
}
