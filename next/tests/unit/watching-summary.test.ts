import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createEngine, type EngineDeps } from "../../src/main/watching/engine"
import { summaryNotice } from "../../src/main/watching/notify"
import { createStore } from "../../src/main/watching/store"
import { nothingSince, summaryCard, summaryDue, summaryItems, summaryNote } from "../../src/shared/watching/summary"
import type { Finding, News, OpenFinding, PastFinding, Run, WatchView } from "../../src/shared/watching/types"

// The morning summary: the design's copy (Notifications: morning summary, overnight, in the app).

const day = (h: number, m = 0, d = 1) => new Date(2026, 10, d, h, m).getTime()
const EIGHT = day(8)
const SINCE = day(8, 0, 0)

function watch(o: Partial<WatchView> & Pick<WatchView, "id" | "kind" | "name">): WatchView {
  return { target: o.name, every: "5m", notify: "now", createdAt: SINCE - 7 * 86_400_000, open: [], failedStreak: 0, nextAt: null, strip: [], line: "", past: [], said: [], news: [], unread: false, fixes: [], ...o }
}
const open = (f: Partial<Finding> & Pick<Finding, "key" | "headline">, at: number): OpenFinding => ({ level: "problem", fix: "none", ...f, openedAt: at, lastSeenAt: at })
const news = (headline: string, at: number): News => ({ key: `n:${at}`, level: "news", headline, fix: "none", at })

const site = (at = day(3, 12)) => watch({ id: "site", kind: "uptime", name: "lane-ceramics.com", open: [open({ key: "slow", headline: "lane-ceramics.com is slow" }, at)] })
const sec = () => watch({ id: "sec", kind: "security", name: "lane-ceramics.com security", target: "lane-ceramics.com", every: "morning", open: [open({ key: "dmarc:none", headline: "Anyone can send email as lane-ceramics.com" }, day(7, 30))] })
const page = (at = day(5, 5)) => watch({ id: "pg", kind: "page", name: "lane-ceramics.com/pricing", every: "1h", news: [news("The pricing page changed", at)], unread: true })
const price = (at = day(6)) => watch({ id: "pr", kind: "price", name: "Stoneware clay, 25 lb", target: "northclay.com/stoneware-25", every: "1h", news: [news("Down to $42", at)], unread: true })

describe("morning summary text", () => {
  it("problems and news, as the 8:00 notification says them", () => {
    const s = summaryItems([site(), sec(), page(day(9, 0, 0)), price()].filter((w) => w.id !== "pg"), SINCE, EIGHT)
    expect(summaryNote(s, SINCE, EIGHT)).toBe("2 problems: lane-ceramics.com is slow, and anyone can send email as lane-ceramics.com. Stoneware clay is down to $42.")
  })
  it("overnight: a problem at night, then the night's news", () => {
    const s = summaryItems([site(), page()], SINCE, EIGHT)
    expect(summaryNote(s, SINCE, EIGHT)).toBe("1 problem overnight: lane-ceramics.com is slow. The pricing page changed.")
  })
  it("news only", () => {
    const s = summaryItems([page(), price()], SINCE, EIGHT)
    expect(summaryNote(s, SINCE, EIGHT)).toBe("The pricing page changed, and Stoneware clay is down to $42.")
  })
  it("down and back up overnight", () => {
    const p: PastFinding = { ...open({ key: "down", headline: "lane-ceramics.com is down" }, day(3, 5)), closedAt: day(3, 19), how: "cleared" }
    const s = summaryItems([watch({ id: "site", kind: "uptime", name: "lane-ceramics.com", past: [p] })], SINCE, EIGHT)
    expect(summaryNote(s, SINCE, EIGHT)).toBe("lane-ceramics.com was down from 3:05 to 3:19 am, and is back up.")
  })
  it("a watch that couldn't run", () => {
    const latest: Run = { at: day(4), ms: 1, status: "failed", findings: [], error: "Claude Code isn’t signed in." }
    const s = summaryItems([watch({ id: "c", kind: "custom", name: "Saturday glaze workshop seats", latest })], SINCE, EIGHT)
    expect(summaryNote(s, SINCE, EIGHT)).toBe("Saturday glaze workshop seats couldn’t run: Claude Code isn’t signed in.")
  })
  it("at most two problems by name, then how many more", () => {
    const more = [1, 2, 3].map((i) => watch({ id: `x${i}`, kind: "uptime", name: `x${i}.com`, open: [open({ key: "down", headline: `x${i}.com is down` }, day(9, i, 0))] }))
    const s = summaryItems([site(), sec(), ...more], SINCE, EIGHT)
    expect(summaryNote(s, SINCE, EIGHT)).toMatch(/^5 problems: .+, .+ and 3 more\.$/)
  })
  it("nothing new: no summary at all", () => {
    const quiet = watch({ id: "q", kind: "uptime", name: "q.com" })
    const s = summaryItems([quiet, page(day(7, 0, 0))], SINCE, EIGHT)
    expect(summaryNote(s, SINCE, EIGHT)).toBeNull()
    expect(summaryCard(s, SINCE, EIGHT)).toBeNull()
  })
  it("leaves out paused watches, expected and snoozed problems, and news you've seen", () => {
    const s = summaryItems(
      [
        { ...site(), paused: true },
        watch({ id: "e", kind: "uptime", name: "e.com", open: [{ ...open({ key: "slow", headline: "e.com is slow" }, day(3)), expected: true }] }),
        watch({ id: "z", kind: "uptime", name: "z.com", open: [{ ...open({ key: "slow", headline: "z.com is slow" }, day(3)), snoozedUntil: day(10) }] }),
        { ...page(), unread: false },
      ],
      SINCE,
      EIGHT,
    )
    expect(summaryNote(s, SINCE, EIGHT)).toBeNull()
  })
  it("the card tells it in order: overnight, the morning check, then the rest", () => {
    const s = summaryItems([site(), sec(), page(), price()], SINCE, EIGHT)
    expect(summaryCard(s, SINCE, EIGHT)).toBe(
      "Overnight, lane-ceramics.com got slow at 3:12 am and the pricing page changed. At 7:30, the security check found one thing to fix. Stoneware clay is down to $42.",
    )
  })
  it("/summary with nothing to say", () => {
    expect(nothingSince(EIGHT, day(9, 30))).toBe("Nothing new since 8:00 am.")
  })
})

describe("when the summary shows", () => {
  it("at its time, once a day, only until noon, never when Off", () => {
    expect(summaryDue("8:00", day(7, 59), undefined)).toBe(false)
    expect(summaryDue("8:00", day(8), undefined)).toBe(true)
    expect(summaryDue("8:00", day(8, 1), day(8))).toBe(false)
    expect(summaryDue("8:00", day(8), day(8, 0, 0))).toBe(true)
    expect(summaryDue("8:00", day(12), undefined)).toBe(false)
    expect(summaryDue("7:00", day(7), undefined)).toBe(true)
    expect(summaryDue("off", day(8), undefined)).toBe(false)
  })
  it("the notification: Good morning, a sound only for problems, a click opens Watching", () => {
    expect(summaryNotice("The pricing page changed.", false)).toMatchObject({ title: "Good morning", silent: true, threadId: "watching:summary", actions: [] })
    expect(summaryNotice("1 problem: x.", true).silent).toBe(false)
  })
})

describe("the engine's summary", () => {
  function setup(start: number) {
    const store = createStore(mkdtempSync(join(tmpdir(), "watching-sum-")))
    let now = start
    let online = true
    let status = 200
    const notes: [string, boolean][] = []
    const notices: string[] = []
    const lists: number[] = []
    const deps: EngineDeps = {
      resolveTxt: async () => [],
      connect: async () => false,
      tls: async () => ({ days: null, version: null }),
      exec: async () => ({ stdout: "", code: 1 }),
      exists: () => false,
      fetch: async () => {
        if (!online) throw new Error("offline")
        return new Response("ok", { status })
      },
      load: async () => ({ ms: 900, files: [] }),
      now: () => now,
      sleep: async () => {},
      online: () => online,
      notice: (_w, o) => notices.push(...o.map((f) => f.key)),
      changed: (l) => lists.push(l.summary ? 1 : 0),
      summaryAt: () => "8:00",
      summary: (body, problems) => notes.push([body, problems]),
    }
    const e = createEngine(store, deps)
    return { store, e, notes, notices, lists, set: (t: number) => (now = t), offline: (v: boolean) => (online = !v), down: () => (status = 502) }
  }

  it("at 8:00 with a problem from the night: one notification, the card until noon, nothing again that day", async () => {
    const t = setup(day(1, 0))
    const d = await t.e.draft({ kind: "uptime", target: "lane-ceramics.com", force: true })
    if ("error" in d) throw new Error(d.error)
    t.e.create(d)
    await t.e.settled()
    t.down()
    t.set(day(3, 5))
    await t.e.runOne(t.e.list().watches[0]!.id)
    expect(t.notices).toEqual(["down"])
    t.set(day(8))
    await t.e.tick()
    expect(t.notes).toHaveLength(1)
    expect(t.notes[0]![0]).toBe("1 problem overnight: lane-ceramics.com is down.")
    expect(t.notes[0]![1]).toBe(true)
    expect(t.e.list().summary?.text).toBe("Overnight, lane-ceramics.com went down at 3:05 am.")
    t.set(day(9))
    await t.e.tick()
    expect(t.notes).toHaveLength(1)
    t.set(day(12, 1))
    await t.e.tick()
    expect(t.e.list().summary).toBeUndefined()
    expect(t.lists.at(-1)).toBe(0)
  })

  it("nothing new at 8:00: no notification and no card", async () => {
    const t = setup(day(1, 0))
    t.set(day(8, 5))
    await t.e.tick()
    expect(t.notes).toEqual([])
    expect(t.e.list().summary).toBeUndefined()
    expect(t.store.summary().lastAt).toBe(day(8, 5))
  })

  it("/summary shows the card now without moving the next one; × closes it", () => {
    const t = setup(day(15, 0, 0))
    t.set(day(15))
    expect(t.e.summaryNow().summary?.text).toMatch(/^Nothing new since /)
    expect(t.store.summary().lastAt).toBeUndefined()
    expect(t.e.summaryClose().summary).toBeUndefined()
  })

  it("/summary after 8:00 tells this morning's summary again", async () => {
    const t = setup(day(1, 0))
    const d = await t.e.draft({ kind: "uptime", target: "lane-ceramics.com", force: true })
    if ("error" in d) throw new Error(d.error)
    t.e.create(d)
    await t.e.settled()
    t.down()
    t.set(day(3, 5))
    await t.e.runOne(t.e.list().watches[0]!.id)
    t.set(day(8))
    await t.e.tick()
    t.e.summaryClose()
    t.set(day(10))
    expect(t.e.summaryNow().summary?.text).toBe("Overnight, lane-ceramics.com went down at 3:05 am.")
    expect(t.store.summary().lastAt).toBe(day(8))
  })

  it("offline: nothing runs, and a run that fails because the Mac went offline isn't kept", async () => {
    const t = setup(day(1, 0))
    const d = await t.e.draft({ kind: "uptime", target: "lane-ceramics.com", force: true })
    if ("error" in d) throw new Error(d.error)
    const v = t.e.create(d)
    await t.e.settled()
    const runs = t.store.runs(v.id).length
    t.set(day(2))
    t.offline(true)
    await t.e.tick()
    expect(t.store.runs(v.id).length).toBe(runs)
    // Goes offline mid-run: the failure is dropped, so nothing counts toward "Couldn't reach".
    await t.e.runOne(v.id)
    expect(t.store.runs(v.id).length).toBe(runs)
    expect(t.e.get(v.id)?.failedStreak).toBe(0)
  })
})
