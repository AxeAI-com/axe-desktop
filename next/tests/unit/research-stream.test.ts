import { describe, expect, it } from "vitest"

import type { ChatMessage, Json } from "@shared/types"

import { applyChunk, contextFrom, finishReply, researchData, storedMessage, stripContext } from "../../src/main/axe/stream"

// The website's research parts and usage metadata, mapped onto the window's message.

const run = (status: string): Json => ({
  status,
  queries: ["q"],
  steps: [
    { id: "plan-0", kind: "plan", verb: "Planned", target: "1 search", status: "complete", startedAt: 1, endedAt: 2 },
    { id: "search-1", kind: "search", verb: "Searching for", target: "q", status: "running", startedAt: 2 },
    { id: "odd", kind: "dance", verb: "?", status: "running", startedAt: 2 },
  ],
  sources: [{ n: 1, title: "A", url: "https://www.a.com/x", snippet: "", read: false }, { title: "no number", url: "https://b.com" }],
  startedAt: 1,
})

describe("research in the stream", () => {
  it("keeps one research part, replaced as it changes, and drops what it can't read", () => {
    const m: ChatMessage = { id: "m", role: "assistant", parts: [] }
    applyChunk(m, { type: "data-research", id: "research", data: run("running") })
    applyChunk(m, { type: "data-research", id: "research", data: { ...(run("running") as Record<string, Json>), queries: ["q", "r"] } })
    expect(m.parts).toHaveLength(1)
    const p = m.parts[0]!
    expect(p.type).toBe("research")
    if (p.type !== "research") return
    expect(p.data.queries).toEqual(["q", "r"])
    expect(p.data.steps.map((s) => s.kind)).toEqual(["plan", "search"])
    expect(p.data.sources).toEqual([{ n: 1, title: "A", url: "https://www.a.com/x", site: "a.com", snippet: "", read: false }])
  })

  it("ignores a research chunk without steps or sources", () => {
    expect(researchData({ status: "running" })).toBeUndefined()
  })

  it("reads the approval card and the usage on finish", () => {
    const m: ChatMessage = { id: "m", role: "assistant", parts: [] }
    applyChunk(m, { type: "data-researchApproval", id: "approval", data: { status: "pending", searches: 5, pages: 6, estimate: 4200, modelId: "sonnet-5.5" } })
    applyChunk(m, { type: "finish", messageMetadata: { modelId: "sonnet-5.5", usage: { inputTokens: 100, outputTokens: 20 } } })
    expect(m.parts[0]).toEqual({ type: "researchApproval", id: "approval", data: { status: "pending", searches: 5, pages: 6, estimate: 4200, modelId: "sonnet-5.5" } })
    expect(m.context).toEqual({ used: 120, modelId: "sonnet-5.5" })
  })

  it("a run cut short ends failed, never spinning", () => {
    const m: ChatMessage = { id: "m", role: "assistant", parts: [] }
    applyChunk(m, { type: "data-research", id: "research", data: run("running") })
    finishReply(m, 99)
    const p = m.parts[0]!
    expect(p.type === "research" && p.data).toMatchObject({ status: "failed", endedAt: 99 })
    expect(p.type === "research" && p.data.steps[1]).toMatchObject({ status: "failed", detail: "Stopped", endedAt: 99 })
  })

  it("reads stored research, approvals and usage from history", () => {
    const m = storedMessage({
      id: "a1",
      role: "assistant",
      parts: [{ type: "data-research", id: "research", data: run("complete") }, { type: "text", text: "# Report" }],
      metadata: { modelId: "auto", usage: { inputTokens: 5000, outputTokens: 800 } },
    })!
    expect(m.parts.map((p) => p.type)).toEqual(["research", "text"])
    expect(m.context).toEqual({ used: 5800, modelId: "auto" })
    expect(contextFrom({ usage: {} })).toBeUndefined()
  })
})

describe("what the server stores of a sent message", () => {
  it("strips memory and earlier-turn blocks, in either order", () => {
    const memory = "<what-to-remember-about-me>\n- Mia\n</what-to-remember-about-me>"
    const context = "<earlier-in-this-chat>\nUser: hi\n</earlier-in-this-chat>"
    expect(stripContext(`${memory}\n\n${context}\n\nThe question`)).toBe("The question")
    expect(stripContext(`${context}\n\n${memory}\n\nQ`)).toBe("Q")
    expect(stripContext("<what-to-remember-about-me> never closed")).toBe("<what-to-remember-about-me> never closed")
  })
})
