import { describe, expect, it } from "vitest"

import type { OpenFinding, Run, StripTick, WatchView } from "@shared/watching/types"

import { coverLine, groupHost, grouped, healthOf, lineOf, loadCollapsed, metricsOf, needsLook, ringArcs, saveCollapsed, ticks } from "@/lib/dashboard"

const T = Date.UTC(2026, 10, 2, 12)
const run = (o: Partial<Run> = {}): Run => ({ at: T - 60_000, ms: 500, status: "quiet", findings: [], ...o })
const tick = (status: StripTick["status"], ms?: number): StripTick => ({ at: T, status, ...(ms ? { ms } : {}) })

function w(id: string, kind: WatchView["kind"], target: string, o: Partial<WatchView> = {}): WatchView {
  return { id, kind, target, name: id, every: "1h", notify: "now", createdAt: T - 86_400_000, open: [], failedStreak: 0, nextAt: null, strip: [], line: "Fine.", past: [], said: [], news: [], unread: false, fixes: [], latest: run(), ...o }
}
const problem = (key = "outdated:major"): OpenFinding => ({ key, level: "problem", headline: "4 packages are a major version behind", line: "4 packages a major version behind.", fix: "agent", openedAt: T - 3_600_000, lastSeenAt: T })

describe("watching dashboard", () => {
  it("counts healthy, warnings and down, leaving paused watches out", () => {
    const ws = [
      w("a", "health", "axeai.com/api/health"),
      w("b", "outdated", "~/next", { open: [problem()] }),
      w("c", "uptime", "axeai.com", { open: [problem("down")] }),
      w("d", "disk", "/", { failedStreak: 3 }),
      w("e", "dns", "axeai.com", { paused: true, open: [problem()] }),
    ]
    expect(healthOf(ws, T)).toEqual({ total: 4, healthy: 1, warnings: 1, down: 2 })
    expect(needsLook(ws[4]!, T)).toBe(false)
    // A snoozed problem doesn't need a look.
    expect(needsLook(w("f", "outdated", "~/next", { open: [{ ...problem(), snoozedUntil: T + 1000 }] }), T)).toBe(false)
  })

  it("draws the ring's arcs in proportion, a full circle when all are healthy", () => {
    const c = 2 * Math.PI * 30
    const [ok, warn] = ringArcs({ total: 10, healthy: 8, warnings: 2, down: 0 }, c)
    expect(ok!.len).toBeCloseTo(c * 0.8 - 5)
    expect(warn!.offset).toBeCloseTo(-(c * 0.8 + 2.5))
    expect(ringArcs({ total: 3, healthy: 3, warnings: 0, down: 0 }, c)).toEqual([{ tone: "ok", len: c, offset: 0 }])
    expect(ringArcs({ total: 0, healthy: 0, warnings: 0, down: 0 }, c)).toEqual([])
  })

  it("shows the last 24 runs, padded in front, with a run in progress last", () => {
    expect(ticks([tick("quiet"), tick("problem")])).toEqual([...Array(22).fill("empty"), "ok", "warn"])
    const many = Array.from({ length: 30 }, () => tick("quiet"))
    expect(ticks(many)).toHaveLength(24)
    expect(ticks(many, true).at(-1)).toBe("live")
    expect(ticks([tick("failed"), tick("news")]).slice(-2)).toEqual(["fail", "news"])
  })

  it("takes each metric card from a real watch, and leaves out the ones with none", () => {
    const health = w("h", "health", "axeai.com/api/health", { latest: run({ ms: 587, facts: [["ok", "true"]] }), strip: [tick("quiet", 560), tick("failed"), tick("quiet", 587)] })
    const expiry = w("x", "expiry", "axeai.com", { latest: run({ metric: 78, facts: [["Certificate", "Jan 18, 2027"]] }) })
    const disk = w("k", "disk", "/", { latest: run({ metric: 382, facts: [["Free", "382 GB"], ["Of", "994 GB"]] }) })
    const tests = w("t", "tests", "~/Work/axe-web", { latest: run({ status: "problem" }) })
    const m = metricsOf([health, expiry, disk, tests])
    expect(m.map((x) => x.kind)).toEqual(["response", "certificate", "disk", "tests"])
    expect(m[0]).toMatchObject({ ms: 587, series: [560, 587], foot: "axeai.com/api/health says ok" })
    expect(m[1]).toMatchObject({ days: 78, until: "Jan 18, 2027", foot: "axeai.com" })
    expect(m[2]).toMatchObject({ freeGb: 382, totalGb: 994 })
    expect(m[3]).toMatchObject({ passing: false, foot: "axe-web" })
    expect(metricsOf([disk]).map((x) => x.kind)).toEqual(["disk"])
    // Without a health check, uptime's load time stands in; a watch that failed its last run shows nothing.
    expect(metricsOf([w("u", "uptime", "axeai.com", { latest: run({ metric: 1200 }) })])[0]).toMatchObject({ kind: "response", ms: 1200 })
    expect(metricsOf([w("k2", "disk", "/", { latest: run({ status: "failed" }) })])).toEqual([])
  })

  it("groups by kind in the design's order, with a shared host for the heading", () => {
    const ws = [w("seo", "seo", "axeai.com"), w("disk", "disk", "/"), w("api", "health", "axeai.com/api/health"), w("cf", "status", "cloudflare"), w("dns", "dns", "www.axeai.com"), w("price", "price", "shop.com/x")]
    const g = grouped(ws)
    expect(g.map((x) => x.group)).toEqual(["site", "domain", "services", "mac", "other"])
    expect(g[0]!.watches.map((x) => x.id)).toEqual(["api", "seo"])
    expect(groupHost(g[0]!.watches)).toBe("axeai.com")
    expect(groupHost([w("a", "uptime", "a.com"), w("b", "uptime", "b.com")])).toBeUndefined()
    expect(coverLine(g.map((x) => x.group))).toBe("Your site, domain, services and this Mac.")
    expect(coverLine(["mac"])).toBe("This Mac.")
  })

  it("says what a row needs: the problem, a repo's count, snoozed, paused", () => {
    expect(lineOf(w("a", "outdated", "~/next", { open: [problem()] }), T)).toBe("4 packages a major version behind.")
    expect(lineOf(w("r", "repo", "mia/shop", { open: [problem("a"), problem("b")] }), T)).toBe("2 new security alerts.")
    expect(lineOf(w("s", "uptime", "x.com", { open: [{ ...problem("slow"), line: "Slow.", snoozedUntil: T + 1 }] }), T)).toBe("Slow. Snoozed.")
    expect(lineOf(w("p", "uptime", "x.com", { paused: true }), T)).toBe("Paused.")
  })

  it("remembers collapsed sections", () => {
    const m = new Map<string, string>()
    globalThis.localStorage ??= { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as Storage
    saveCollapsed(new Set(["group:site"]))
    expect([...loadCollapsed()]).toEqual(["group:site"])
    localStorage.setItem("axe.watching.collapsed", "not json")
    expect(loadCollapsed().size).toBe(0)
  })
})
