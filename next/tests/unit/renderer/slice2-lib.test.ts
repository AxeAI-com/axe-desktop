import { describe, expect, it } from "vitest"

import type { ChatMessage, ModelCatalog, ResearchData } from "@shared/types"

import { linkNumbered } from "@/lib/citations"
import { parseReport, progressFraction, progressRows, runSeconds, runSummary } from "@/lib/research"
import { AXE_STARTERS, filterSlash, inMenuOrder, pickedText, slashItems, slashQuery } from "@/lib/slash"
import { chatContext, credits, money, tokens } from "@/lib/usage"

const step = (id: string, kind: ResearchData["steps"][number]["kind"], status: "running" | "complete" | "failed", target?: string) => ({
  id,
  kind,
  verb: "",
  status,
  startedAt: 0,
  ...(target ? { target } : {}),
})

describe("research report", () => {
  it("splits title, summary and sections, also mid-stream", () => {
    const r = parseReport("# **Pricing**\n\nShort answer [1].\n\n## Per minute\n\nMost charge [2].\n\n## Day ra")
    expect(r.title).toBe("Pricing")
    expect(r.summary).toBe("Short answer [1].")
    expect(r.sections.map((s) => s.title)).toEqual(["Per minute", "Day ra"])
    expect(r.sections[0]!.body).toBe("Most charge [2].")
    expect(parseReport("<think>hmm").title).toBe("Research report")
  })

  it("turns numbered citations into numbered chips, leaving unknown numbers", () => {
    const sources = [{ n: 1, url: "https://a.com" }, { n: 3, url: "https://c.com" }]
    expect(linkNumbered("A [1]. B [1, 3]. C [2]. D [1](x)", sources)).toBe(
      'A  [1](https://a.com "cite:1"). B  [1](https://a.com "cite:1") [3](https://c.com "cite:3"). C [2]. D [1](x)',
    )
  })
})

describe("research progress", () => {
  const running: ResearchData = {
    status: "running",
    queries: ["a", "b"],
    startedAt: 1000,
    sources: [],
    steps: [step("p", "plan", "complete"), step("s1", "search", "complete", "a"), step("s2", "search", "running", "b"), step("r1", "read", "running", "a.com")],
  }

  it("shows the plan, each search, reads as one row, then writing", () => {
    expect(progressRows(running).map((r) => [r.label, r.state])).toEqual([
      ["Planned 2 searches", "done"],
      ["Searched for “a”", "done"],
      ["Searching for “b”", "running"],
      ["Reading 1 pages", "running"],
      ["Write the report with sources", "waiting"],
    ])
  })

  it("fills the bar as steps finish, full only when done", () => {
    const f = progressFraction(running)
    expect(f).toBeGreaterThan(0.3)
    expect(f).toBeLessThan(1)
    expect(progressFraction({ ...running, status: "complete" })).toBe(1)
  })

  it("sums up a finished run", () => {
    const done: ResearchData = { ...running, status: "complete", endedAt: 73_000, steps: [...running.steps.slice(0, 2), step("r1", "read", "complete"), step("r2", "read", "failed")] }
    expect(runSummary(done)).toBe("1 search, 1 page read")
    expect(runSeconds(done)).toBe(72)
  })
})

describe("usage", () => {
  const catalog = { axe: { defaultModelId: "auto", models: [{ id: "gpt", label: "GPT", provider: "", tier: "free", webSearch: true, vision: false, reasoning: false, contextWindow: 100_000 }] }, agents: [], local: [], servers: [] } as ModelCatalog
  it("sizes Auto by Auto's window, not the free model it picked", () => {
    const cat = { ...catalog, axe: { ...catalog.axe, models: [...catalog.axe.models, { ...catalog.axe.models[0]!, id: "auto", contextWindow: 24_000 }] } } as ModelCatalog
    const msgs: ChatMessage[] = [{ id: "a", role: "assistant", answerer: { kind: "axe", modelId: "auto" }, parts: [], context: { used: 6000, modelId: "gpt" } }]
    expect(chatContext(msgs, cat)).toEqual({ used: 6000, size: 24_000, fraction: 0.25 })
  })

  it("counts a research reply as its report, not every call of the run", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", parts: [], context: { used: 2000, modelId: "gpt" } },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "research", id: "r", data: { status: "complete", queries: [], steps: [], sources: [], startedAt: 0 } }, { type: "text", id: "t", text: "x".repeat(4000) }],
        context: { used: 40_000, modelId: "gpt" },
      },
    ]
    expect(chatContext(msgs, catalog)).toEqual({ used: 3000, size: 100_000, fraction: 0.03 })
  })

  it("reads the latest reply's context, sized by the agent or the model's window", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", parts: [], context: { used: 10, modelId: "gpt" } },
      { id: "2", role: "user", parts: [] },
      { id: "3", role: "assistant", parts: [], context: { used: 25_000, modelId: "gpt" } },
      { id: "4", role: "assistant", parts: [] },
    ]
    expect(chatContext(msgs, catalog)).toEqual({ used: 25_000, size: 100_000, fraction: 0.25 })
    expect(chatContext([{ id: "a", role: "assistant", parts: [], context: { used: 300_000, size: 200_000 } }], null)?.fraction).toBe(1)
    expect(chatContext([{ id: "a", role: "assistant", parts: [], context: { used: 50 } }], null)).toEqual({ used: 50, fraction: 0 })
    expect(chatContext([], catalog)).toBeNull()
  })

  it("formats tokens, money and credits", () => {
    expect([tokens(840), tokens(3420), tokens(12_400), tokens(200_000), tokens(1_000_000)]).toEqual(["840", "3.4K", "12K", "200K", "1M"])
    expect(money({ amount: 0.42, currency: "USD" })).toBe("$0.42")
    expect([credits(4200), credits(10)]).toEqual([4, 1])
  })
})

describe("the / menu", () => {
  it("opens only while typing the command", () => {
    expect(slashQuery("/")).toBe("")
    expect(slashQuery("/rev")).toBe("rev")
    expect(slashQuery("/review now")).toBeNull()
    expect(slashQuery("hi /x")).toBeNull()
  })

  it("puts names that start with the query first, then other matches", () => {
    const items = slashItems([{ name: "preview", description: "Look", source: "agent" }, { name: "review", description: "Check", source: "agent" }], false)
    expect(filterSlash(items, "rev").map((i) => i.name)).toEqual(["review", "preview"])
    expect(filterSlash(items, "cited").map((i) => i.name)).toEqual(["research"])
  })

  it("agent chats get no research starter; the agent's own name wins", () => {
    const items = slashItems([{ name: "plan", description: "Agent plan", source: "agent" }], true)
    expect(items.filter((i) => i.name === "plan")).toHaveLength(1)
    expect(items.some((i) => i.name === "research")).toBe(false)
  })

  it("groups in menu order and inserts the right text", () => {
    const order = inMenuOrder([AXE_STARTERS[0]!, { name: "s", description: "", source: "skill" }, { name: "a", description: "", source: "agent" }])
    expect(order.map((i) => i.source)).toEqual(["agent", "skill", "axe"])
    expect(pickedText({ name: "review", description: "", source: "agent" })).toBe("/review ")
    expect(pickedText(AXE_STARTERS[0]!)).toBe("Help me write ")
    expect(pickedText(AXE_STARTERS.find((s) => s.action)!)).toBe("")
  })
})
