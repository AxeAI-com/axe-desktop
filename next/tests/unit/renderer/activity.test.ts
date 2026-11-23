import { describe, expect, it } from "vitest"

import type { FixTurn, News, OpenFinding, PastFinding, StripTick } from "@shared/watching/types"

import { type ActivityInput, activity, dayLabel, duration } from "@/lib/activity"

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const NOW = at(8, 14, 30)
const base: ActivityInput = { kind: "uptime", name: "lane-ceramics.com", open: [], past: [], news: [], said: [], strip: [], fixes: [] }

const past = (key: string, from: number, to: number, extra: Partial<PastFinding> = {}): PastFinding => ({
  key,
  level: "problem",
  headline: `lane-ceramics.com is ${key}`,
  fix: "none",
  openedAt: from,
  lastSeenAt: to,
  closedAt: to + 10 * 60_000,
  how: "cleared",
  ...extra,
})
const open = (key: string, from: number, extra: Partial<OpenFinding> = {}): OpenFinding => ({ key, level: "problem", headline: `lane-ceramics.com is ${key}`, fix: "none", openedAt: from, lastSeenAt: from, ...extra })
const tick = (t: number, status: StripTick["status"]): StripTick => ({ at: t, status })
const fix = (t: Partial<FixTurn>): FixTurn => ({ at: at(8, 10), keys: ["slow"], headline: "lane-ceramics.com is slow", agent: "Claude Code", answerer: { kind: "agent", agentId: "claude" }, state: "working", ...t })

describe("duration", () => {
  it("reads in minutes, hours and days", () => {
    expect(duration(20_000)).toBe("under a minute")
    expect(duration(4 * 60_000)).toBe("4 min")
    expect(duration(120 * 60_000)).toBe("2 h")
    expect(duration(65 * 60_000)).toBe("1 h 5 min")
    expect(duration(3 * 24 * 3600_000)).toBe("3 days")
  })
})

describe("dayLabel", () => {
  it("says Today, Yesterday, then the date", () => {
    expect(dayLabel(at(8, 1), NOW)).toBe("Today")
    expect(dayLabel(at(7, 23), NOW)).toBe("Yesterday")
    expect(dayLabel(at(6, 9), NOW)).toBe("Nov 6")
    expect(dayLabel(new Date(2025, 10, 6).getTime(), NOW)).toBe("Nov 6, 2025")
  })
})

describe("activity", () => {
  it("is empty for a quiet check", () => {
    expect(activity(base, NOW)).toEqual([])
  })

  it("times a closed incident from the first clean run, not from when it closed", () => {
    const f = past("down", at(8, 9, 40), at(8, 9, 43))
    const g = activity({ ...base, past: [f], strip: [tick(at(8, 9, 40), "problem"), tick(at(8, 9, 43), "problem"), tick(at(8, 9, 44), "quiet"), tick(at(8, 9, 49), "quiet")] }, NOW)
    expect(g).toHaveLength(1)
    expect(g[0]!.label).toBe("Today")
    expect(g[0]!.entries[0]).toMatchObject({ kind: "incident", text: "Down for 4 min, 9:40 to 9:44 am", state: "resolved" })
  })

  it("falls back to when it closed without the runs, and drops the range across midnight", () => {
    const f = past("slow", at(7, 23, 50), at(8, 0, 2))
    const e = activity({ ...base, past: [f] }, NOW)[0]!.entries[0]!
    expect(e.text).toBe("Slow for 22 min")
    expect(e.state).toBe("resolved")
  })

  it("puts open incidents first, under Open, then the rest newest first by day", () => {
    const g = activity(
      {
        ...base,
        open: [open("slow", at(8, 13, 10))],
        past: [past("down", at(6, 9, 40), at(6, 9, 43)), past("slow", at(7, 8, 0), at(7, 8, 30), { how: "fixed" })],
        news: [{ key: "cert", level: "news", headline: "Certificate renewed.", fix: "none", at: at(8, 7) } as News],
      },
      NOW,
    )
    expect(g.map((x) => x.label)).toEqual(["Open", "Today", "Yesterday", "Nov 6"])
    expect(g[0]!.entries[0]).toMatchObject({ text: "Slow since 1:10 pm", state: "open" })
    expect(g[1]!.entries[0]).toMatchObject({ kind: "change", text: "Certificate renewed" })
    expect(g[2]!.entries[0]!.state).toBe("fixed")
  })

  it("names an open incident from another day by its date", () => {
    const e = activity({ ...base, open: [open("down", at(6, 9))] }, NOW)[0]!.entries[0]!
    expect(e.text).toBe("Down since Nov 6")
  })

  it("uses a security or repo finding's own words, past tense once it's gone", () => {
    const f = past("dmarc:none", at(7, 7, 30), at(8, 7, 30), { headline: "Anyone can send email as lane-ceramics.com", past: "Anyone could send email as lane-ceramics.com", how: "fixed" })
    const e = activity({ ...base, kind: "security", past: [f] }, NOW)[0]!.entries[0]!
    expect(e).toMatchObject({ text: "Anyone could send email as lane-ceramics.com", state: "fixed" })
  })

  it("leaves out changes you ignored, and gives a price change its noun", () => {
    const news = [
      { key: "p1", level: "news", headline: "Down to $42", fix: "none", at: at(8, 9) },
      { key: "p2", level: "news", headline: "Up to $45", fix: "none", at: at(8, 8), ignored: true },
    ] as News[]
    const g = activity({ ...base, kind: "price", news }, NOW)
    expect(g[0]!.entries.map((e) => e.text)).toEqual(["Price down to $42"])
  })

  it("writes one line per fix: started while it runs, then what it did", () => {
    const repoPast = ["a", "b", "c", "d"].map((n) =>
      past(`alert:${n}`, at(8, 7), at(8, 11), { how: "fixed", closedAt: at(8, 11), ev: { alert: { source: "package", name: n, problem: "Open redirect" } } }),
    )
    const done = fix({ at: at(8, 9), keys: repoPast.map((f) => f.key), state: "kept", result: "fixed", files: 2, threadId: "t1", endedAt: at(8, 10), checkedAt: at(8, 11) })
    const running = fix({ at: at(8, 12), state: "working", threadId: "t2" })
    const g = activity({ ...base, kind: "repo", name: "shop-web", past: repoPast, fixes: [done, running] }, NOW)
    const fixesOnly = g.flatMap((x) => x.entries).filter((e) => e.kind === "fix")
    expect(fixesOnly).toEqual([
      expect.objectContaining({ text: "Fix started", agent: "Claude Code", threadId: "t2", running: true }),
      expect.objectContaining({ text: "Claude Code fixed it: updated 4 packages", threadId: "t1", at: at(8, 11) }),
    ])
    // The four alerts that closed together are one line.
    expect(g.flatMap((x) => x.entries).filter((e) => e.kind === "incident").map((e) => e.text)).toEqual(["4 security alerts in shop-web"])
  })

  it("says less when a fix's numbers aren't known", () => {
    const lines = activity(
      {
        ...base,
        fixes: [
          fix({ at: at(8, 8), state: "kept", result: "fixed" }),
          fix({ at: at(8, 9), state: "kept", files: 3 }),
          fix({ at: at(8, 10), state: "kept", result: "still", files: 1 }),
          fix({ at: at(8, 11), state: "undone" }),
          fix({ at: at(8, 12), state: "asking" }),
        ],
      },
      NOW,
    )[0]!.entries.map((e) => e.text)
    expect(lines).toEqual(["Fix waiting for a folder", "Claude Code’s changes undone", "Claude Code’s fix didn’t clear it", "Claude Code changed 3 files", "Claude Code fixed it"])
  })

  it("lists what a reply changed, from the settings Undo puts back", () => {
    const said = [
      { at: at(8, 9), you: "check every morning and ignore the date", axe: "Done.", undo: { every: "5m" as const, ignore: [] } },
      { at: at(8, 10), you: "pause", axe: "Paused.", undo: { paused: false }, undone: true },
      { at: at(8, 11), you: "what is this?", axe: "It checks your site." },
    ]
    const e = activity({ ...base, said }, NOW)[0]!.entries
    expect(e.map((x) => x.text)).toEqual(["You changed how often it checks and what it ignores"])
  })
})
