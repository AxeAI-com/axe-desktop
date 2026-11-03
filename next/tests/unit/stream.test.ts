import { describe, expect, it } from "vitest"

import type { ChatMessage, Json } from "@shared/types"

import { applyChunk, finishReply, publicMessage, SSEReader, storedMessage, stripContext } from "../../src/main/axe/stream"

describe("SSEReader", () => {
  it("splits data lines across chunk boundaries and skips junk", () => {
    const r = new SSEReader()
    expect(r.push('data: {"type":"start"}\n\ndata: {"type":"te')).toEqual([{ type: "start" }])
    expect(r.push('xt-start","id":"a"}\r\n: ping\ndata: not json\ndata: [DONE]\n')).toEqual([{ type: "text-start", id: "a" }])
  })
})

describe("applyChunk", () => {
  const run = (chunks: Json[]) => {
    const m: ChatMessage = { id: "local", role: "assistant", parts: [] }
    let t = 1000
    let error: string | undefined
    for (const c of chunks) {
      error = applyChunk(m, c, t) ?? error
      t += 1500
    }
    finishReply(m, t)
    return { m: publicMessage(m), error }
  }

  it("maps text, reasoning with seconds, tools and sources", () => {
    const { m, error } = run([
      { type: "start", messageId: "srv-1" },
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "Let me " },
      { type: "reasoning-delta", id: "r1", delta: "look" },
      { type: "reasoning-end", id: "r1" },
      { type: "tool-input-start", toolCallId: "t1", toolName: "web_search" },
      { type: "tool-input-available", toolCallId: "t1", toolName: "web_search", input: { query: "weather in Hanoi" } },
      { type: "tool-output-available", toolCallId: "t1", output: [{ title: "Forecast" }] },
      { type: "source-url", sourceId: "s1", url: "https://example.com/a", title: "Example" },
      { type: "source-url", sourceId: "s2", url: "https://example.com/a", title: "Dup" },
      { type: "text-start", id: "x" },
      { type: "text-delta", id: "x", delta: "Sunny" },
      { type: "text-delta", id: "x", delta: " today." },
    ])
    expect(error).toBeUndefined()
    expect(m.id).toBe("srv-1")
    expect(m.parts.map((p) => p.type)).toEqual(["reasoning", "tool", "source", "text"])
    const [r, tool, src, text] = m.parts
    expect(r).toMatchObject({ type: "reasoning", text: "Let me look", done: true, seconds: 5 })
    expect(tool).toMatchObject({ type: "tool", title: "Searched the web", kind: "search", state: "done", input: "weather in Hanoi" })
    expect(tool?.type === "tool" && tool.output).toContain("Forecast")
    expect(src).toMatchObject({ type: "source", url: "https://example.com/a", title: "Example" })
    expect(text).toMatchObject({ type: "text", text: "Sunny today." })
    expect(JSON.stringify(m)).not.toContain("_started")
  })

  it("reports errors and failed tools, and closes open thinking at the end", () => {
    const { m, error } = run([
      { type: "reasoning-delta", delta: "hmm" },
      { type: "tool-input-start", toolCallId: "t", toolName: "read_url" },
      { type: "tool-output-error", toolCallId: "t", errorText: "Timed out" },
      { type: "error", errorText: "Out of credits" },
    ])
    expect(error).toBe("Out of credits")
    expect(m.parts[0]).toMatchObject({ type: "reasoning", done: true })
    expect(m.parts[1]).toMatchObject({ type: "tool", kind: "fetch", state: "failed", output: "Timed out" })
    expect(m.parts[2]).toMatchObject({ type: "error", text: "Out of credits" })
  })
})

describe("storedMessage", () => {
  it("reads server history with answerer, time and attachments, and strips sent context", () => {
    const user = storedMessage({
      id: "u1",
      role: "user",
      metadata: { createdAt: "2026-10-22T10:00:00.000Z" },
      parts: [
        { type: "text", text: "<earlier-in-this-chat>\nUser: hi\n</earlier-in-this-chat>\n\nWhat next?" },
        { type: "data-attachment", data: { id: "a", name: "plan.pdf", mediaType: "application/pdf", size: 10 } },
      ],
    })
    expect(user).toMatchObject({ id: "u1", role: "user", createdAt: "2026-10-22T10:00:00.000Z" })
    expect(user?.parts[0]).toMatchObject({ type: "text", text: "What next?" })
    expect(user?.attachments).toEqual([{ path: "", name: "plan.pdf", mime: "application/pdf", size: 10 }])
    const reply = storedMessage({
      id: "a1",
      role: "assistant",
      metadata: { modelId: "auto" },
      parts: [{ type: "reasoning", text: "x" }, { type: "tool-web_search", toolCallId: "t", state: "output-available", input: { query: "q" }, output: "r" }, { type: "text", text: "Hi" }],
    })
    expect(reply?.answerer).toEqual({ kind: "axe", modelId: "auto" })
    expect(reply?.parts.map((p) => p.type)).toEqual(["reasoning", "tool", "text"])
    expect(storedMessage({ id: "s", role: "system", parts: [] })).toBeUndefined()
    expect(stripContext("plain")).toBe("plain")
  })
})

describe("chat titles made from the app's hidden blocks", () => {
  it("spots them, cleans them for the sidebar, and names the chat from the message", async () => {
    const { leakedTitle, cleanTitle, plainTitle } = await import("../../src/main/axe/stream")
    expect(leakedTitle("<axe-desktop-context> The user is in a project")).toBe(true)
    expect(leakedTitle("Lisbon Tram Day Plan")).toBe(false)
    expect(cleanTitle("<axe-desktop-context> The user is in a project")).toBe("The user is in a project")
    expect(plainTitle("Plan a relaxed day in Lisbon with trams, with a heading and a table and a code block")).toBe("Plan a relaxed day in Lisbon with trams, with a heading and…")
  })
})
