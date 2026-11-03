import { describe, expect, it } from "vitest"

import { quickPlan, quickStarted } from "@shared/watching/copy"
import type { Run, WatchView } from "@shared/watching/types"

import { quickSlash, typedWatch } from "@/lib/quick"
import { filterSlash, inMenuOrder, pickedText, WATCHING_COMMANDS, watchCommandOf } from "@/lib/slash"
import { namedWatches, watchMarkdown } from "@/lib/watching"

// Watching's / commands in the composer, @ watches, and the quick bar's /watch.

const w = (id: string, name: string, o: Partial<WatchView> = {}): WatchView => ({
  id,
  kind: "uptime",
  target: name,
  name,
  every: "5m",
  notify: "now",
  createdAt: 0,
  open: [],
  failedStreak: 0,
  nextAt: null,
  strip: [],
  line: "Up. Loads in 0.9 s.",
  past: [],
  said: [],
  news: [],
  unread: false,
  fixes: [],
  ...o,
})

describe("the / menu on Watching", () => {
  it("lists the four commands, in the design's words, first", () => {
    expect(WATCHING_COMMANDS.map((c) => [`/${c.name}`, c.description])).toEqual([
      ["/check", "Check a watch now"],
      ["/pause", "Pause a watch"],
      ["/resume", "Start a paused watch again"],
      ["/summary", "Show the morning summary now"],
    ])
    const agent = { name: "review", description: "Review", source: "agent" as const }
    expect(inMenuOrder([agent, ...WATCHING_COMMANDS])[0]?.source).toBe("watching")
    expect(filterSlash(WATCHING_COMMANDS, "pa").map((c) => c.name)).toEqual(["pause", "resume"])
  })
  it("/check, /pause and /resume ask for a watch with @; /summary just runs", () => {
    expect(pickedText(WATCHING_COMMANDS[1]!)).toBe("/pause @")
    expect(pickedText(WATCHING_COMMANDS[3]!)).toBe("")
  })
  it("reads a command typed in full", () => {
    expect(watchCommandOf("/pause @shop-web")).toEqual({ cmd: "pause", rest: "@shop-web" })
    expect(watchCommandOf("/summary")).toEqual({ cmd: "summary", rest: "" })
    expect(watchCommandOf("/checkout")).toBeNull()
    expect(watchCommandOf("check @a")).toBeNull()
  })
})

describe("@ watches", () => {
  const all = [w("a", "lane-ceramics.com"), w("b", "lane-ceramics.com security", { kind: "security" }), w("c", "shop-web", { kind: "repo" })]
  it("finds each watch a message names, longest name first, in the order written", () => {
    expect(namedWatches("Pause @shop-web and @lane-ceramics.com security until Monday", all).map((x) => x.id)).toEqual(["c", "b"])
    expect(namedWatches("Check @lane-ceramics.com every minute", all).map((x) => x.id)).toEqual(["a"])
    expect(namedWatches("no names here", all)).toEqual([])
  })
  it("in a chat, attaches the watch's latest result and open problems", () => {
    const latest: Run = { at: Date.UTC(2026, 10, 1, 3, 12), ms: 4100, status: "problem", findings: [], facts: [["Loads in", "4.1 s"]] }
    const md = watchMarkdown(w("a", "lane-ceramics.com", { latest, open: [{ key: "slow", level: "problem", headline: "lane-ceramics.com is slow", detail: "The home page takes 4.1 s.", fix: "agent", openedAt: latest.at, lastSeenAt: latest.at }] }))
    expect(md).toContain("# lane-ceramics.com")
    expect(md).toContain("- Kind: Uptime and speed")
    expect(md).toContain("- Loads in: 4.1 s")
    expect(md).toContain("- lane-ceramics.com is slow, since")
    expect(md).toContain("The home page takes 4.1 s.")
  })
})

describe("the quick bar's /watch", () => {
  it("lists Watch first for /wa, and nothing for plain words", () => {
    expect(quickSlash("/wa")?.map((c) => [c.label, c.description])).toEqual([
      ["Watch", "Check something on a schedule"],
      ["Write", "Draft in your voice"],
    ])
    expect(quickSlash("/wr")?.[0]?.label).toBe("Write")
    expect(quickSlash("tell me if it goes down")).toBeNull()
  })
  it("reads /watch typed in full; a plain sentence is a normal question", () => {
    expect(typedWatch("/watch tell me if lane-ceramics.com goes down")).toBe("tell me if lane-ceramics.com goes down")
    expect(typedWatch("/watch")).toBe("")
    expect(typedWatch("tell me if lane-ceramics.com goes down")).toBeNull()
  })
  it("the compact plan and the started line, from the design", () => {
    const first: Run = { at: 0, ms: 900, status: "quiet", findings: [], metric: 900 }
    expect(quickPlan({ kind: "uptime", every: "5m", notify: "now", plan: "", first })).toBe("Up now, 0.9 s. I’ll check every 5 minutes and tell you right away if it goes down or gets much slower.")
    expect(quickStarted({ kind: "uptime", first })).toBe("Up, 0.9 s. You’ll hear only if something’s wrong.")
    expect(quickPlan({ kind: "page", every: "1h", notify: "now", plan: "I’ll read this page every hour.", first })).toBe("I’ll read this page every hour.")
  })
})
