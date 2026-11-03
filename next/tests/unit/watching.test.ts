import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createEngine, type EngineDeps } from "../../src/main/watching/engine"
import { checkUptime, probeError } from "../../src/main/watching/checks/uptime"
import { backUpNotice, watchNotice } from "../../src/main/watching/notify"
import { createStore } from "../../src/main/watching/store"
import { expectedSay, firstMessage, foldedLine, nameFor, planSentence, rowLine, sentence } from "../../src/shared/watching/copy"
import { applyRun, backUp, FAILED_LIMIT, liveProblems, shouldNotify, UNREACHABLE } from "../../src/shared/watching/findings"
import { readReply } from "../../src/shared/watching/reply"
import { EVERY_MS, isDue, jitter, nextAt, nextMorning } from "../../src/shared/watching/schedule"
import { cleanTarget, findTarget } from "../../src/shared/watching/target"
import type { OpenFinding, PageFile, Run, WatchState, WatchView } from "../../src/shared/watching/types"
import { evaluateUptime, slowCause, slowLimit, uptimeLine, usualMs } from "../../src/shared/watching/uptime"

const T0 = new Date(2026, 9, 31, 14, 0, 0).getTime()
const blank = (): WatchState => ({ open: [], failedStreak: 0 })
const quiet = (at: number, metric = 900): Run => ({ at, ms: metric, status: "quiet", findings: [], metric })
const failed = (at: number): Run => ({ at, ms: 10000, status: "failed", findings: [], error: "No answer in 10 s" })
const slowRun = (at: number): Run => ({ at, ms: 4100, status: "problem", metric: 4100, findings: [{ key: "slow", level: "problem", headline: "x is slow", fix: "agent" }] })

describe("schedule", () => {
  const w = { id: "a", every: "5m" as const }
  it("runs a new watch now and the next one an interval (plus jitter) later", () => {
    expect(nextAt(w, undefined, T0)).toBe(T0)
    expect(nextAt(w, T0, T0)).toBe(T0 + EVERY_MS["5m"] + jitter("a", "5m"))
    expect(jitter("a", "5m")).toBeLessThan(EVERY_MS["5m"] * 0.1)
  })
  it("never runs a paused watch", () => {
    expect(nextAt({ ...w, paused: true }, T0, T0)).toBeNull()
    expect(isDue({ ...w, paused: true }, undefined, T0)).toBe(false)
  })
  it("after a long sleep, an overdue watch is due once, not once per missed slot", () => {
    const wake = T0 + 8 * 3600_000
    expect(isDue(w, T0, wake)).toBe(true)
    expect(isDue(w, wake, wake + 1000)).toBe(false)
  })
  it("every morning is 7:30 local, the next day once it has passed", () => {
    const at = new Date(nextMorning(T0))
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([1, 7, 30])
    const early = new Date(2026, 9, 31, 6, 0).getTime()
    expect(new Date(nextMorning(early)).getDate()).toBe(31)
  })
})

describe("findings", () => {
  it("opens a problem once, keeps it while seen, and resolves it when gone (uptime: one clean run)", () => {
    const a = applyRun(blank(), slowRun(T0), "x", 1)
    expect(a.opened.map((f) => f.key)).toEqual(["slow"])
    const b = applyRun(a.state, slowRun(T0 + 1), "x", 1)
    expect(b.opened).toEqual([])
    expect(b.state.open[0]?.openedAt).toBe(T0)
    const c = applyRun(b.state, quiet(T0 + 2), "x", 1)
    expect(c.resolved.map((f) => [f.key, f.how, f.closedAt])).toEqual([["slow", "cleared", T0 + 2]])
    expect(c.state.open).toEqual([])
    expect(c.state.past?.map((f) => f.key)).toEqual(["slow"])
    expect(applyRun(c.state, slowRun(T0 + 3), "x", 1).opened.length).toBe(1)
  })
  it("other kinds resolve after two clean runs", () => {
    const a = applyRun(blank(), slowRun(T0), "x")
    const b = applyRun(a.state, quiet(T0 + 1), "x")
    expect(b.resolved).toEqual([])
    expect(b.state.open[0]?.clean).toBe(1)
    expect(applyRun(b.state, quiet(T0 + 2), "x").resolved.length).toBe(1)
  })
  it("keeps the words a problem opened with", () => {
    const a = applyRun(blank(), { ...slowRun(T0), findings: [{ key: "slow", level: "problem", headline: "h", detail: "first", fix: "agent" }] }, "x", 1)
    const b = applyRun(a.state, { ...slowRun(T0 + 1), findings: [{ key: "slow", level: "problem", headline: "h", detail: "later", fix: "agent" }] }, "x", 1)
    expect(b.state.open[0]?.detail).toBe("first")
  })
  it("news opens and notifies but doesn't stay open", () => {
    const run: Run = { at: T0, ms: 1, status: "news", findings: [{ key: "text", level: "news", headline: "Changed", fix: "none" }] }
    const a = applyRun(blank(), run, "x")
    expect(a.opened.length).toBe(1)
    expect(a.state.open).toEqual([])
  })
  it("a failed run changes nothing until three in a row", () => {
    let s = applyRun(blank(), slowRun(T0), "x").state
    for (let i = 1; i < FAILED_LIMIT; i++) {
      const r = applyRun(s, failed(T0 + i), "x")
      expect(r.opened).toEqual([])
      expect(r.state.open.map((f) => f.key)).toEqual(["slow"])
      s = r.state
    }
    const third = applyRun(s, failed(T0 + 9), "lane-ceramics.com", 1)
    expect(third.opened[0]).toMatchObject({ key: UNREACHABLE, headline: "Couldn’t reach lane-ceramics.com" })
    expect(applyRun(third.state, failed(T0 + 10), "x").opened).toEqual([])
    expect(applyRun(third.state, quiet(T0 + 11), "x", 1).resolved.map((f) => f.key)).toEqual(["slow", UNREACHABLE])
  })
  it("keeps 'expected' and a snooze on a finding across runs", () => {
    const a = applyRun(blank(), slowRun(T0), "x").state
    const s = { ...a, open: a.open.map((f) => ({ ...f, expected: true, snoozedUntil: T0 + 99 })) }
    expect(applyRun(s, slowRun(T0 + 1), "x").state.open[0]).toMatchObject({ expected: true, snoozedUntil: T0 + 99 })
  })
  it("notifies only right-away watches that aren't paused, and never for expected or snoozed findings", () => {
    const f: OpenFinding[] = [{ key: "k", level: "problem", headline: "h", fix: "none", openedAt: T0, lastSeenAt: T0 }]
    expect(shouldNotify({ notify: "now" }, f, T0)).toBe(true)
    expect(shouldNotify({ notify: "summary" }, f, T0)).toBe(false)
    expect(shouldNotify({ notify: "now", paused: true }, f, T0)).toBe(false)
    expect(shouldNotify({ notify: "now" }, [{ ...f[0]!, expected: true }], T0)).toBe(false)
    expect(shouldNotify({ notify: "now" }, [{ ...f[0]!, snoozedUntil: T0 + 1 }], T0)).toBe(false)
    expect(shouldNotify({ notify: "now" }, [], T0)).toBe(false)
  })
  it("'back up' only for a problem that notified and cleared by itself", () => {
    const p = { key: "down", level: "problem" as const, headline: "h", fix: "none" as const, openedAt: T0, lastSeenAt: T0, closedAt: T0 + 14 * 60_000 }
    expect(backUp({ notify: "now" }, [{ ...p, how: "cleared", notified: true }]).length).toBe(1)
    expect(backUp({ notify: "now" }, [{ ...p, how: "cleared" }])).toEqual([])
    expect(backUp({ notify: "now" }, [{ ...p, how: "expected", notified: true }])).toEqual([])
    expect(backUp({ notify: "summary" }, [{ ...p, how: "cleared", notified: true }])).toEqual([])
  })
  it("the badge counts open problems that aren't snoozed, expected or paused", () => {
    const f = { key: "a", level: "problem" as const, headline: "h", fix: "none" as const, openedAt: T0, lastSeenAt: T0 }
    const open = [f, { ...f, key: "b", snoozedUntil: T0 + 1 }, { ...f, key: "c", expected: true }, { ...f, key: "d", level: "news" as const }]
    expect(liveProblems({ open }, T0).map((x) => x.key)).toEqual(["a"])
    expect(liveProblems({ open }, T0 + 2).map((x) => x.key)).toEqual(["a", "b"])
    expect(liveProblems({ open, paused: true }, T0)).toEqual([])
  })
})

describe("targets", () => {
  it("cleans what people paste", () => {
    expect(cleanTarget("uptime", "https://www.Lane-Ceramics.com/")).toBe("lane-ceramics.com")
    expect(cleanTarget("page", "lane-ceramics.com/pricing/")).toBe("lane-ceramics.com/pricing")
    expect(cleanTarget("security", "https://lane-ceramics.com/pricing")).toBe("lane-ceramics.com")
    expect(cleanTarget("repo", "https://github.com/mia/shop-web.git")).toBe("mia/shop-web")
    expect(cleanTarget("repo", "~/Code/shop-web")).toBe("~/Code/shop-web")
    expect(cleanTarget("uptime", "lane ceramics")).toBeNull()
    expect(cleanTarget("uptime", "")).toBeNull()
  })
  it("the fallback finds an address but never a kind", () => {
    expect(findTarget("tell me if lane-ceramics.com goes down")).toBe("lane-ceramics.com")
    expect(findTarget("keep an eye on things for me")).toBeNull()
  })
})

describe("uptime", () => {
  const history = Array.from({ length: 10 }, (_, i) => quiet(T0 - 1000 + i, 1200))
  const up = (ms: number, bytes = 18_000) => ({ probe: { ok: true as const, status: 200, statusText: "OK", ms: 80, bytes }, load: { ms, files: [] as PageFile[] } })
  it("usual is the 7-day median of quiet runs; slow is twice that and over 2 s", () => {
    expect(usualMs([], T0)).toBeNull()
    expect(usualMs(history, T0)).toBe(1200)
    expect(usualMs([quiet(T0 - 8 * 86_400_000, 9000), ...history], T0)).toBe(1200)
    expect(slowLimit(1200)).toBe(2400)
    expect(slowLimit(400)).toBe(2000)
    expect(slowLimit(1200, 3000)).toBe(3000)
    expect(slowLimit(null)).toBeNull()
  })
  it("'That's expected' moves the usual until there's enough history after it", () => {
    expect(usualMs(history, T0, { ms: 4100, at: T0 })).toBe(4100)
    const after = Array.from({ length: 6 }, (_, i) => quiet(T0 + i + 1, 3900))
    expect(usualMs([...history, ...after], T0 + 10, { ms: 4100, at: T0 })).toBe(3900)
  })
  it("needs two slow runs in a row, and says it the design's way", () => {
    const one = evaluateUptime("lane-ceramics.com", up(4100), history, {}, T0, 4100)
    expect(one.status).toBe("quiet")
    const two = evaluateUptime("lane-ceramics.com", up(4100), [...history, one], {}, T0, 4100)
    expect(two.status).toBe("problem")
    expect(two.findings[0]).toMatchObject({
      headline: "lane-ceramics.com is slow",
      detail: "The home page takes 4.1 s to load, up from about 1.2 s.",
      line: "Slow: the home page takes 4.1 s.",
      note: "Slow: the home page takes 4.1 s, up from 1.2 s.",
      ev: { usualMs: 1200, limitMs: 2400 },
    })
    expect(two.facts).toEqual([
      ["Status", "200 OK"],
      ["Loads in", "4.1 s"],
      ["Largest file", "the page, 18 KB"],
    ])
  })
  it("names the files that made it slow, and when they appeared", () => {
    const base = [{ name: "hero.jpg", url: "https://x/hero.jpg", bytes: 240 * 1024 }]
    const photos = Array.from({ length: 6 }, (_, i) => ({ name: `vase-${i}.png`, url: `https://x/vase-${i}.png`, bytes: 6 * 1024 * 1024, modified: new Date(2026, 9, 31, 14, 38).getTime() }))
    const h: Run[] = [{ ...quiet(T0 - 10), files: base }]
    const c = slowCause([...photos, ...base], h)
    expect(c?.text).toBe("Six photos added at 2:38 pm are 6 MB each.")
    expect(c?.label).toBe("6 photos added")
    expect(slowCause(base, h)).toBeNull()
    expect(slowCause([photos[0]!], h)?.text).toBe("A photo added at 2:38 pm is 6.0 MB.")
  })
  it("says down the design's way: status, no answer, no longer resolves", () => {
    const d = evaluateUptime("studio-booking.com", { probe: { ok: true, status: 502, statusText: "Bad Gateway", ms: 80 } }, [], {}, T0, 80).findings[0]
    expect(d).toMatchObject({ headline: "studio-booking.com is down", detail: "It returns 502 Bad Gateway. Checked twice, a minute apart.", line: "Down. It returns 502 Bad Gateway.", ev: { status: "502 Bad Gateway" } })
    expect(evaluateUptime("x.com", { probe: { ok: false, error: "noanswer", text: "" } }, [], {}, T0, 1).findings[0]?.detail).toBe("It doesn’t answer. Checked twice, a minute apart.")
    expect(evaluateUptime("x.com", { probe: { ok: false, error: "dns", text: "" } }, [], {}, T0, 1).findings[0]?.line).toBe("Down. x.com no longer resolves.")
    expect(evaluateUptime("x.com", { probe: { ok: true, status: 503, ms: 1 } }, [], {}, T0, 1).http).toBe("503 Service Unavailable")
  })
  it("writes the row line from the latest run", () => {
    expect(uptimeLine(quiet(T0, 900))).toBe("Up. Loads in 0.9 s.")
    expect(uptimeLine(undefined)).toBe("Not checked yet.")
  })
  it("retries once, a minute later, before calling it down", async () => {
    let calls = 0
    const waits: number[] = []
    const fetch = async () => {
      calls++
      if (calls === 1) throw new Error("fetch failed", { cause: new Error("ECONNREFUSED") })
      return new Response("ok", { status: 200 })
    }
    const run = await checkUptime("x.com", [], {}, { fetch, now: () => T0, sleep: async (ms) => void waits.push(ms) })
    expect(calls).toBe(2)
    expect(waits).toEqual([60_000])
    expect(run.status).toBe("quiet")
    expect(probeError(new DOMException("t", "TimeoutError")).error).toBe("noanswer")
    expect(probeError(new Error("x", { cause: new Error("getaddrinfo ENOTFOUND x.com") })).error).toBe("dns")
  })
  it("uses the full load's time and files when there is one, and reports its steps", async () => {
    const steps: string[] = []
    const run = await checkUptime(
      "x.com",
      [],
      {},
      { fetch: async () => new Response("ok"), now: () => T0, sleep: async () => {}, load: async () => ({ ms: 1500, files: [{ name: "a.png", url: "u", bytes: 300 * 1024 }] }) },
      (s) => steps.push(s.map((x) => x.state).join(",")),
    )
    expect(run.metric).toBe(1500)
    expect(run.facts?.[2]).toEqual(["Largest file", "a.png, 300 KB"])
    expect(steps).toEqual(["run,todo", "done,run", "done,done"])
  })
})

describe("replies", () => {
  const w = { kind: "uptime" as const, target: "lane-ceramics.com", every: "5m" as const, notify: "now" as const }
  it("reads the changes it knows, and nothing else", () => {
    expect(readReply(w, "check every hour")?.patch).toEqual({ every: "1h" })
    expect(readReply(w, "tell me above 3 s")).toEqual({ patch: { fixedMs: 3000 }, say: "Okay. I’ll tell you when it takes more than 3 s to load.", undo: true })
    expect(readReply(w, "only in the morning summary")?.patch).toEqual({ notify: "summary" })
    expect(readReply(w, "pause")?.patch).toEqual({ paused: true })
    expect(readReply({ ...w, kind: "page" }, "tell me above 3 s")).toBeNull()
    expect(readReply(w, "why is it slow?")).toBeNull()
    expect(readReply(w, "ignore the date at the bottom")).toBeNull()
  })
  it("a page watch can ignore part of the page, with a new schedule", () => {
    const pg = { kind: "page" as const, target: "lane-ceramics.com/pricing", every: "1h" as const, notify: "now" as const }
    expect(readReply(pg, "only check this once a day, and ignore the date at the bottom")).toEqual({
      patch: { every: "morning", ignore: ["date"] },
      say: "Done. I’ll check every morning at 7:30 and ignore the date line at the bottom.",
      undo: true,
    })
    expect(readReply({ ...pg, ignore: ["date"] }, "ignore lines about opening hours")).toEqual({
      patch: { ignore: ["date", "text:opening hours"] },
      say: "Done. I’ll ignore lines with “opening hours”.",
      undo: true,
    })
    expect(readReply(pg, "ignore /blog")?.patch).toEqual({ ignore: ["text:/blog"] })
  })
})

describe("copy", () => {
  it("builds the bubble and the plan from templates", () => {
    expect(sentence("uptime", "lane-ceramics.com")).toBe("Tell me if lane-ceramics.com goes down or gets slow.")
    expect(planSentence("uptime", "lane-ceramics.com", "5m", "now")).toBe("I’ll load lane-ceramics.com every 5 minutes and tell you if it goes down or gets much slower than usual.")
  })

  it("names folders by their last segment", () => {
    expect(nameFor("repo", "~/Work/shop-web/")).toBe("shop-web")
    expect(nameFor("repo", "mia/shop-web")).toBe("shop-web")
    expect(nameFor("security", "lane-ceramics.com")).toBe("lane-ceramics.com security")
  })

  it("folds closed problems to one line and answers 'That's expected'", () => {
    const at = new Date(2026, 9, 31, 15, 5).getTime()
    expect(foldedLine({ key: "down", headline: "x is down", openedAt: at, closedAt: at + 14 * 60_000 }, "x", "cleared")).toBe("Down from 3:05 to 3:19 pm")
    expect(foldedLine({ key: "slow", headline: "x is slow", openedAt: at, value: 4100 }, "lane-ceramics.com", "expected")).toBe("3:05 pm. lane-ceramics.com was slow, 4.1 s.")
    expect(expectedSay("lane-ceramics.com", "slow", 4100)).toBe("Okay. I’ll treat about 4 s as usual for the home page now.")
    expect(expectedSay("x", "dmarc:none")).toBe("Okay. I won’t tell you about this one again.")
  })

  it("says fast loads plainly", () => {
    expect(firstMessage("uptime", "localhost:3000", { at: 0, ms: 0, status: "quiet", findings: [], metric: 40 }, "5m")).toBe(
      "localhost:3000 is up and loads in under 0.1 s. I’ll check every 5 minutes and stay quiet unless that changes.",
    )
  })

  it("writes the row line from the latest run", () => {
    const run = (r: Partial<Run>): Run => ({ at: 0, ms: 0, status: "quiet", findings: [], ...r })
    const p = (headline: string) => ({ key: headline, level: "problem" as const, headline, fix: "none" as const })
    expect(rowLine("page", undefined)).toBe("Not checked yet.")
    expect(rowLine("price", run({ status: "failed", error: "No answer in 10 s" }))).toBe("Couldn’t check. No answer in 10 s.")
    expect(rowLine("security", run({ status: "problem", findings: [p("Anyone can send email as a.com."), p("b"), p("c")] }))).toBe("Anyone can send email as a.com, and 2 more.")
    expect(rowLine("repo", run({ status: "problem", findings: [p("shop-web has a critical security alert")] }))).toBe("shop-web has a critical security alert.")
    const news = { key: "x", level: "news" as const, headline: "The pricing page changed", line: "New line: “Free shipping on orders over $50.”", fix: "none" as const, at: 0 }
    expect(rowLine("page", run({ status: "news", findings: [news] }), { unread: news })).toBe("New line: “Free shipping on orders over $50.”")
    expect(rowLine("page", run({}), { since: new Date(2026, 9, 24, 9).getTime() })).toBe("No changes since Oct 24.")
    expect(rowLine("price", run({ metric: 48, stock: "In stock", currency: "USD" }))).toBe("$48. In stock.")
    expect(rowLine("price", run({ metric: 86, stock: "Out of stock" }))).toBe("$86. Out of stock.")
    expect(rowLine("security", run({}))).toBe("No issues found.")
    expect(rowLine("repo", run({}))).toBe("No open alerts.")
    expect(rowLine("page", run({}))).toBe("No changes.")
  })
})

describe("store and engine", () => {
  function setup(status = 200, ms = 900) {
    const dir = mkdtempSync(join(tmpdir(), "watching-"))
    const store = createStore(dir)
    let now = T0
    const notices: string[] = []
    const back: string[] = []
    let online = true
    let load = ms
    const deps: EngineDeps = {
      resolveTxt: async () => [],
      connect: async () => false,
      tls: async () => ({ days: null, version: null }),
      exec: async () => ({ stdout: "", code: 1 }),
      exists: () => false,
      fetch: async () => {
        now += 50
        return new Response("ok", { status })
      },
      load: async () => ({ ms: load, files: [] }),
      now: () => now,
      sleep: async () => {},
      online: () => online,
      notice: (_w, opened) => notices.push(...opened.map((f) => f.key)),
      cleared: (_w, resolved) => back.push(...resolved.map((f) => f.key)),
      changed: () => {},
    }
    const e = createEngine(store, deps)
    return { dir, store, e, notices, back, advance: (d: number) => (now += d), setOnline: (v: boolean) => (online = v), setStatus: (s: number) => (status = s), setLoad: (v: number) => (load = v) }
  }
  async function make(e: ReturnType<typeof setup>["e"], target: string) {
    const d = await e.draft({ kind: "uptime", target, force: true })
    if ("error" in d) throw new Error(d.error)
    const v = e.create(d)
    await e.settled()
    return e.get(v.id)!
  }

  it("drafts with a quick check, then the first run is timed after Start and kept as the first", async () => {
    const { e, dir } = setup()
    const d = await e.draft({ kind: "uptime", target: "https://www.lane-ceramics.com/" })
    if ("error" in d) throw new Error(d.error)
    expect(d.name).toBe("lane-ceramics.com")
    const started = e.create(d)
    expect(started.steps?.map((s) => s.label)).toEqual(["Loading lane-ceramics.com", "Timing the page"])
    await e.settled()
    const v = e.get(started.id)!
    expect(v.steps).toBeUndefined()
    expect(v.line).toBe("Up. Loads in 0.9 s.")
    expect(v.first?.metric).toBe(900)
    expect(v.strip.length).toBe(1)
    const again = createStore(dir)
    expect(again.list().map((w) => w.target)).toEqual(["lane-ceramics.com"])
    expect(again.runs(v.id).length).toBe(1)
  })

  it("validates: not an address, a site that isn't answering (and Watch it anyway)", async () => {
    const { e, setStatus } = setup()
    expect(await e.draft({ kind: "uptime", target: "lane ceramics" })).toEqual({ error: "That doesn’t look like a site address." })
    setStatus(502)
    expect(await e.draft({ kind: "uptime", target: "a-site.com" })).toEqual({
      error: "a-site.com isn’t answering right now.",
      button: { label: "Watch it anyway", kind: "uptime", target: "a-site.com", force: true },
    })
    expect("error" in (await e.draft({ kind: "uptime", target: "a-site.com", force: true }))).toBe(false)
  })

  it("the first run never notifies; later ones notify once; back up only after a notice", async () => {
    const { e, notices, back, advance, setStatus } = setup(502)
    const a = await make(e, "a-site.com")
    expect(a.open.map((f) => f.key)).toEqual(["down"])
    expect(notices).toEqual([])
    setStatus(200)
    const b = await make(e, "b-site.com")
    setStatus(502)
    advance(EVERY_MS["5m"] * 2)
    await e.tick()
    expect(notices).toEqual(["down"])
    advance(EVERY_MS["5m"] * 2)
    await e.tick()
    expect(notices).toEqual(["down"])
    setStatus(200)
    await e.runOne(b.id)
    await e.runOne(a.id)
    expect(back).toEqual(["down"])
    expect(e.get(b.id)?.past.map((f) => [f.key, f.how])).toEqual([["down", "cleared"]])
    expect(e.list().watches.map((w) => w.target)).toEqual(["a-site.com", "b-site.com"])
  })

  it("slow: two slow runs open it; That's expected raises the usual; Undo brings it back", async () => {
    const { e, notices, advance, setLoad } = setup()
    const v = await make(e, "a-site.com")
    for (let i = 0; i < 5; i++) {
      advance(EVERY_MS["5m"] * 2)
      await e.runOne(v.id)
    }
    setLoad(4100)
    await e.runOne(v.id)
    expect(e.get(v.id)?.open).toEqual([])
    await e.runOne(v.id)
    const slow = e.get(v.id)!.open[0]!
    expect(slow).toMatchObject({ key: "slow", notified: true, ev: { usualMs: 900, limitMs: 2000 } })
    expect(notices).toEqual(["slow"])
    const x = e.act(v.id, "slow", "expected")!
    expect(x.open).toEqual([])
    expect(x.usual?.ms).toBe(4100)
    expect(x.past.at(-1)?.how).toBe("expected")
    await e.runOne(v.id)
    expect(e.get(v.id)?.open).toEqual([])
    const u = e.act(v.id, "slow", "unexpected")!
    expect(u.open.map((f) => f.key)).toEqual(["slow"])
    expect(u.usual).toBeUndefined()
  })

  it("snoozing a finding keeps it open but takes it off the badge", async () => {
    const { e, advance, setStatus } = setup()
    const v = await make(e, "a-site.com")
    setStatus(502)
    advance(EVERY_MS["5m"] * 2)
    await e.runOne(v.id)
    const s = e.act(v.id, "down", "snooze1h")!
    expect(s.open[0]?.snoozedUntil).toBeGreaterThan(T0)
    expect(liveProblems(s, s.open[0]!.snoozedUntil! - 1)).toEqual([])
    expect(e.act(v.id, "down", "unsnooze")!.open[0]?.snoozedUntil).toBeUndefined()
  })

  it("replies change the watch and stay in the thread", async () => {
    const { e, store } = setup()
    const v = await make(e, "a-site.com")
    await e.reply(v.id, "tell me above 3 s")
    await e.reply(v.id, "why?")
    const r = e.get(v.id)!
    expect(r.fixedMs).toBe(3000)
    expect(r.said.map((x) => x.you)).toEqual(["tell me above 3 s", "why?"])
    store.reload()
    expect(store.state(v.id).said?.length).toBe(2)
  })

  it("does nothing offline, and nothing for paused watches", async () => {
    const { e, store, advance, setOnline } = setup()
    const v = await make(e, "a-site.com")
    advance(EVERY_MS["5m"] * 2)
    setOnline(false)
    await e.tick()
    expect(store.runs(v.id).length).toBe(1)
    setOnline(true)
    await e.update(v.id, { paused: true })
    await e.tick()
    expect(store.runs(v.id).length).toBe(1)
    expect(e.get(v.id)?.nextAt).toBeNull()
  })

  it("a new target clears open findings; delete removes history", async () => {
    const { e, store } = setup(502)
    const v = await make(e, "a-site.com")
    expect(e.get(v.id)?.open.length).toBe(1)
    expect(((await e.update(v.id, { target: "b-site.com" })) as WatchView | null)?.open).toEqual([])
    e.remove(v.id)
    expect(store.list()).toEqual([])
    expect(store.runs(v.id)).toEqual([])
  })
})

describe("local targets", () => {
  it("keeps a server on this Mac, over http", async () => {
    const { urlOf } = await import("../../src/shared/watching/target")
    expect(cleanTarget("uptime", "http://localhost:4321/")).toBe("localhost:4321")
    expect(cleanTarget("page", "localhost:4321/pricing")).toBe("localhost:4321/pricing")
    expect(cleanTarget("security", "localhost:4321")).toBeNull()
    expect(urlOf("localhost:4321/pricing")).toBe("http://localhost:4321/pricing")
  })
})

describe("notices", () => {
  it("titles with the watch's name, offers Fix and Snooze on a problem, and stays silent for news", () => {
    const w = { id: "w1", name: "lane-ceramics.com" }
    expect(watchNotice(w, [])).toBeNull()
    const slow: OpenFinding = { key: "slow", level: "problem", headline: "lane-ceramics.com is slow", note: "Slow: the home page takes 4.1 s, up from 1.2 s.", fix: "agent", openedAt: T0, lastSeenAt: T0 }
    expect(watchNotice(w, [slow], "Fix with Claude Code")).toEqual({
      threadId: "watch:w1",
      kind: "needs",
      title: "lane-ceramics.com",
      body: "Slow: the home page takes 4.1 s, up from 1.2 s.",
      findingId: "slow",
      silent: false,
      actions: [
        { id: "fix", text: "Fix with Claude Code" },
        { id: "snooze1h", text: "Snooze 1 hour" },
      ],
    })
    const down = { ...slow, key: "down", note: "Down. It returns 502 Bad Gateway.", fix: "none" as const }
    expect(watchNotice(w, [down], "Fix with Claude Code")?.actions).toEqual([{ id: "snooze1h", text: "Snooze 1 hour" }])
    const news = { ...slow, key: "page", level: "news" as const, note: "New line." }
    expect(watchNotice(w, [news])).toMatchObject({ silent: true, actions: [] })
  })
  it("says back up with how long it was down", () => {
    const f = { key: "down", level: "problem" as const, headline: "h", fix: "none" as const, openedAt: T0, lastSeenAt: T0, closedAt: T0 + 14 * 60_000, how: "cleared" as const }
    expect(backUpNotice({ id: "w1", name: "studio-booking.com" }, [f], quiet(T0))?.body).toBe("Back up after 14 min.")
  })
})
