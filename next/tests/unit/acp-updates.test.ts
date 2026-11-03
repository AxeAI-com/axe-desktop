import type { SessionUpdate } from "@agentclientprotocol/sdk"
import { describe, expect, it } from "vitest"

import type { ChatMessage } from "@shared/types"

import { inputText, ReplyBuilder, toolKind, toolState } from "../../src/main/agents/updates"

function build(updates: SessionUpdate[], stopReason = "end_turn") {
  const message: ChatMessage = { id: "m", role: "assistant", parts: [] }
  let t = 0
  const b = new ReplyBuilder(message, () => t)
  for (const u of updates) {
    b.apply(u)
    t += 2000
  }
  b.finish(stopReason)
  return message
}

describe("ACP updates to parts", () => {
  it("joins text chunks and turns thoughts into reasoning with seconds", () => {
    const m = build([
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Plan " } },
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "it" } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "there" } },
    ])
    expect(m.parts).toHaveLength(2)
    expect(m.parts[0]).toMatchObject({ type: "reasoning", text: "Plan it", done: true, seconds: 4 })
    expect(m.parts[1]).toMatchObject({ type: "text", text: "Hello there" })
  })

  it("shows Axe's own MCP tools like Do it steps, and a refused one as not allowed", () => {
    const m = build([
      { sessionUpdate: "tool_call", toolCallId: "a", title: "mcp__axe__browser_type", kind: "other", status: "pending" },
      { sessionUpdate: "tool_call_update", toolCallId: "a", rawInput: { element: 1, text: "Jack" }, status: "completed" },
      { sessionUpdate: "tool_call", toolCallId: "b", title: "mcp__axe__browser_click", status: "pending", rawInput: { element: 4 } },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "b",
        status: "failed",
        content: [{ type: "content", content: { type: "text", text: "The user said no to this step. Don't do it, and don't try it another way." } }],
      },
    ])
    expect(m.parts[0]).toMatchObject({ type: "tool", title: "Fill in “Jack”", state: "done" })
    expect(m.parts[1]).toMatchObject({ type: "tool", title: "Click on the page", state: "declined", output: "You said no." })
  })

  it("maps tool calls and their updates, with input, output and diffs", () => {
    const m = build([
      {
        sessionUpdate: "tool_call",
        toolCallId: "c1",
        title: "Edit app.ts",
        kind: "edit",
        status: "pending",
        locations: [{ path: "/w/app.ts", line: 3 }],
        content: [{ type: "diff", path: "/w/app.ts", oldText: "a", newText: "b" }],
      },
      { sessionUpdate: "tool_call", toolCallId: "c2", title: "Run tests", kind: "execute", status: "in_progress", rawInput: { command: ["pnpm", "test"] } },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c2",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "12 passed" } }],
      },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed" },
      { sessionUpdate: "tool_call_update", toolCallId: "c3", title: "Switch mode", kind: "switch_mode", rawOutput: { stdout: "ok" } },
    ])
    expect(m.parts[0]).toMatchObject({
      type: "tool",
      id: "c1",
      title: "Edit app.ts",
      kind: "edit",
      state: "failed",
      input: "/w/app.ts:3",
      diff: [{ path: "/w/app.ts", before: "a", after: "b" }],
    })
    expect(m.parts[1]).toMatchObject({ type: "tool", kind: "execute", state: "done", input: "pnpm test", output: "12 passed" })
    // A tool still running when the turn ends is settled; unknown kinds become "other".
    expect(m.parts[2]).toMatchObject({ type: "tool", kind: "other", state: "done", output: "ok" })
  })

  it("keeps one plan part and updates it", () => {
    const m = build([
      { sessionUpdate: "plan", entries: [{ content: "A", priority: "high", status: "in_progress" }, { content: "B", priority: "low", status: "pending" }] },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } },
      { sessionUpdate: "plan", entries: [{ content: "A", priority: "high", status: "completed" }, { content: "B", priority: "low", status: "in_progress" }] },
    ])
    const plans = m.parts.filter((p) => p.type === "plan")
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ entries: [{ text: "A", status: "done" }, { text: "B", status: "running" }] })
  })

  it("marks running tools failed when cancelled and notes cut-off turns", () => {
    const cancelled = build([{ sessionUpdate: "tool_call", toolCallId: "c", title: "Run", status: "in_progress" }], "cancelled")
    expect(cancelled.parts[0]).toMatchObject({ state: "failed" })
    const cut = build([{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } }], "max_tokens")
    expect(cut.parts[1]).toMatchObject({ type: "error" })
  })

  it("ignores updates the window doesn't show", () => {
    const message: ChatMessage = { id: "m", role: "assistant", parts: [] }
    const b = new ReplyBuilder(message)
    expect(b.apply({ sessionUpdate: "available_commands_update", availableCommands: [] })).toBe(false)
    expect(b.apply({ sessionUpdate: "agent_message_chunk", content: { type: "image", data: "", mimeType: "image/png" } })).toBe(false)
    expect(message.parts).toEqual([])
  })

  it("helpers", () => {
    expect(toolKind("fetch")).toBe("fetch")
    expect(toolKind(undefined)).toBe("other")
    expect(toolState("in_progress")).toBe("running")
    expect(inputText({ url: "https://x" })).toBe("https://x")
    expect(inputText(undefined, [{ path: "/a" }, { path: "/b" }])).toBe("/a\n/b")
  })
})

describe("unfence", () => {
  it("unwraps a single fenced block and leaves other text alone", async () => {
    const { unfence } = await import("../../src/main/agents/updates")
    expect(unfence("```console\ntotal 8\n```")).toBe("total 8")
    expect(unfence("plain\n```x```")).toBe("plain\n```x```")
  })
})
