import { describe, expect, it } from "vitest"

import type { Part } from "@shared/types"

import { diffLines } from "@/lib/diff"
import { formatSeconds, isLiveGroup, liveLabel, replyText, segment, summarize, type StepPart } from "@/lib/steps"

const tool = (id: string, kind: Extract<Part, { type: "tool" }>["kind"], title: string, extra: Partial<Extract<Part, { type: "tool" }>> = {}): Part => ({
  type: "tool",
  id,
  title,
  kind,
  state: "done",
  ...extra,
})
const steps = (parts: Part[]) => parts as StepPart[]

describe("segment", () => {
  it("folds everything before the words into one group", () => {
    const parts: Part[] = [
      { type: "reasoning", id: "r", text: "hm", done: true, seconds: 2 },
      tool("s", "search", "Searched the web"),
      { type: "source", id: "src", title: "A", url: "https://a.example" },
      { type: "text", id: "x", text: "Hello" },
    ]
    const segs = segment(parts)
    expect(segs.map((s) => s.kind)).toEqual(["steps", "text"])
    expect(segs[0]!.kind === "steps" && segs[0]!.parts.map((p) => p.id)).toEqual(["r", "s", "src"])
  })

  it("starts a new group for steps between words, and keeps plans and errors apart", () => {
    const parts: Part[] = [
      tool("a", "read", "Read a.ts"),
      { type: "text", id: "x1", text: "First " },
      { type: "plan", id: "p", entries: [{ text: "Do it", status: "pending" }] },
      tool("b", "edit", "Edited a.ts"),
      tool("c", "execute", "Ran tests"),
      { type: "text", id: "x2", text: "Done." },
      { type: "error", id: "e", text: "Oops" },
    ]
    expect(segment(parts).map((s) => s.kind)).toEqual(["steps", "text", "plan", "steps", "text", "error"])
  })

  it("joins text that arrives in several parts and skips empty text", () => {
    const parts: Part[] = [
      { type: "text", id: "a", text: "Hel" },
      { type: "text", id: "b", text: "lo" },
      { type: "text", id: "c", text: "" },
    ]
    const segs = segment(parts)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ kind: "text", text: "Hello" })
  })
})

describe("summarize", () => {
  it("names a web search", () => {
    expect(summarize(steps([tool("s", "search", "Searched the web")]))).toBe("Searched the web")
    expect(summarize(steps([{ type: "source", id: "s", title: "A", url: "https://a.example" }]))).toBe("Searched the web")
  })

  it("counts files and commands in the order they happened", () => {
    const parts = steps([
      tool("1", "read", "Read a.ts"),
      tool("2", "read", "Read b.ts"),
      tool("3", "read", "Read c.ts"),
      tool("4", "execute", "Ran the tests"),
    ])
    expect(summarize(parts)).toBe("Read 3 files, ran 1 command")
  })

  it("names a local model's own steps: Ollama started, a file it couldn't get", () => {
    const parts = steps([tool("1", "execute", "Started Ollama"), tool("2", "edit", "Write notes.txt"), tool("3", "read", "Left out photo.png", { state: "failed" })])
    expect(summarize(parts)).toBe("Started Ollama, changed 1 file, left out 1 file")
  })

  it("only names thinking when nothing else happened", () => {
    expect(summarize(steps([{ type: "reasoning", id: "r", text: "", done: true, seconds: 4 }]))).toBe("Thought for 4s")
    expect(summarize(steps([{ type: "reasoning", id: "r", text: "", done: true }]))).toBe("Thought for a moment")
    expect(
      summarize(steps([{ type: "reasoning", id: "r", text: "", done: true, seconds: 4 }, tool("s", "search", "Searched the web")])),
    ).toBe("Searched the web")
  })

  it("counts changed files by path, not by edit", () => {
    const parts = steps([
      tool("1", "edit", "Edited a", { diff: [{ path: "a.ts", after: "x" }] }),
      tool("2", "edit", "Edited a again", { diff: [{ path: "a.ts", after: "y" }] }),
      tool("3", "edit", "Edited b", { diff: [{ path: "b.ts", after: "z" }] }),
    ])
    expect(summarize(parts)).toBe("Changed 2 files")
  })

  it("says when steps failed", () => {
    expect(summarize(steps([tool("1", "execute", "Ran it", { state: "failed" })]))).toBe("Ran 1 command, 1 step failed")
  })
})

describe("live state", () => {
  it("shows the newest running step, or Thinking", () => {
    expect(liveLabel(steps([tool("1", "read", "Read a"), tool("2", "search", "Searching the web", { state: "running" })]))).toBe("Searching the web")
    expect(liveLabel(steps([{ type: "reasoning", id: "r", text: "", done: false }]))).toBe("Thinking")
    expect(liveLabel([])).toBe("Thinking")
  })

  it("is live only while the reply is", () => {
    const running = steps([tool("1", "execute", "Running", { state: "running" })])
    const done = steps([tool("1", "read", "Read a")])
    expect(isLiveGroup(running, false, true)).toBe(false)
    expect(isLiveGroup(running, true, false)).toBe(true)
    expect(isLiveGroup(done, true, true)).toBe(true)
    expect(isLiveGroup(done, true, false)).toBe(false)
  })
})

describe("helpers", () => {
  it("formats seconds", () => {
    expect(formatSeconds(4.4)).toBe("4s")
    expect(formatSeconds(60)).toBe("1m")
    expect(formatSeconds(75)).toBe("1m 15s")
  })

  it("copies only the words of a reply", () => {
    expect(replyText([tool("1", "read", "Read"), { type: "text", id: "a", text: "Hi " }, { type: "text", id: "b", text: "there" }])).toBe("Hi there")
  })

  it("diffs lines", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { sign: " ", text: "a" },
      { sign: "-", text: "b" },
      { sign: "+", text: "B" },
      { sign: " ", text: "c" },
    ])
    expect(diffLines(undefined, "new")).toEqual([{ sign: "+", text: "new" }])
  })
})
