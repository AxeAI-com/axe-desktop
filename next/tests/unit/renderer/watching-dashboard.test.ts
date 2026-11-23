import { describe, expect, it } from "vitest"

import type { OpenFinding, Run, StripTick, WatchView } from "@shared/watching/types"

import { coverLine, fillRows, groupHost, grouped, hashAngle, healthOf, lineOf, loadOrder, needsLook, radarPlace, ringLegend, saveOrder, sortTiles, ticks, toneOf, type Cell } from "@/lib/dashboard"
import { logValue, nextCheck, shortName, subOf, headlineOf, whenOf } from "@/lib/live-copy"

const T = Date.UTC(2026, 10, 2, 12)
const run = (o: Partial<Run> = {}): Run => ({ at: T - 60_000, ms: 500, status: "quiet", findings: [], ...o })
const tick = (status: StripTick["status"], ms?: number): StripTick => ({ at: T, status, ...(ms ? { ms } : {}) })

function w(id: string, kind: WatchView["kind"], target: string, o: Partial<WatchView> = {}): WatchView {
  return { id, kind, target, name: id, every: "1h", notify: "now", createdAt: T - 86_400_000, open: [], failedStreak: 0, nextAt: null, strip: [], line: "Fine.", past: [], said: [], news: [], unread: false, fixes: [], latest: run(), ...o }
}
const problem = (key = "outdated:major"): OpenFinding => ({ key, level: "problem", headline: "4 packages are a major version behind", line: "4 packages a major version behind.", fix: "agent", openedAt: T - 3_600_000, lastSeenAt: T })

/** Lays the cells out as CSS grid's sparse auto-flow does and returns the grid, so a test can look for holes. */
function layout(cells: Cell[], cols: number): number[][] {
  const g: number[][] = []
  const row = (r: number) => (g[r] ??= Array<number>(cols).fill(-1))
  let r = 0
  let c = 0
  cells.forEach((it, i) => {
    for (;;) {
      if (c + it.w > cols) {
        r++
        c = 0
        continue
      }
      let ok = true
      for (let y = r; y < r + it.h; y++) for (let x = c; x < c + it.w; x++) if (row(y)[x] !== -1) ok = false
      if (ok) break
      c++
    }
    for (let y = r; y < r + it.h; y++) for (let x = c; x < c + it.w; x++) row(y)[x] = i
    c += it.w
  })
  return g
}
const holes = (g: number[][]) => g.flat().filter((x) => x === -1).length

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
    expect(ws.map((x) => toneOf(x, T))).toEqual(["ok", "warn", "bad", "bad", "paused"])
  })

  it("shows the last 24 runs, padded in front, with a run in progress last", () => {
    expect(ticks([tick("quiet"), tick("problem")])).toEqual([...Array(22).fill("empty"), "ok", "warn"])
    const many = Array.from({ length: 30 }, () => tick("quiet"))
    expect(ticks(many)).toHaveLength(24)
    expect(ticks(many, true).at(-1)).toBe("live")
    expect(ticks([tick("failed"), tick("news")]).slice(-2)).toEqual(["fail", "news"])
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
})

describe("the live dashboard", () => {
  const RADAR = (cols: number): Cell => ({ w: 2, h: cols === 4 ? 2 : 1 })

  it("fills the grid exactly: ten watches with two problems at four columns", () => {
    const cells = fillRows([RADAR(4), 2, 2, 1, 1, 1, 1, 1, 1, 1, 1], 4)
    expect(cells.map((c) => c.w)).toEqual([2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(cells[0]).toEqual({ w: 2, h: 2 })
    expect(holes(layout(cells, 4))).toBe(0)
  })

  it("widens the last tile when the last row ends short: nine healthy at four columns", () => {
    const cells = fillRows([RADAR(4), ...Array(9).fill(1)], 4)
    expect(cells.at(-1)).toEqual({ w: 4, h: 1 })
    expect(cells.slice(1, -1).every((c) => c.w === 1)).toBe(true)
    expect(holes(layout(cells, 4))).toBe(0)
  })

  it("one watch: the radar keeps to one row and the tile fills it", () => {
    expect(fillRows([RADAR(4), 1], 4)).toEqual([
      { w: 2, h: 1 },
      { w: 2, h: 1 },
    ])
    expect(fillRows([RADAR(2), 1], 2)).toEqual([
      { w: 2, h: 1 },
      { w: 2, h: 1 },
    ])
  })

  it("no problems: twelve tiles beside and under the radar", () => {
    const cells = fillRows([RADAR(4), ...Array(12).fill(1)], 4)
    expect(holes(layout(cells, 4))).toBe(0)
    expect(cells.map((c) => c.w)).toEqual([2, ...Array(12).fill(1)])
  })

  it("a two-column tile that doesn't fit gives the gap to the tile before it", () => {
    // By group: a healthy tile, then a problem, at two columns.
    const cells = fillRows([RADAR(2), 1, 2, 1], 2)
    expect(cells.map((c) => c.w)).toEqual([2, 2, 2, 2])
  })

  it("never leaves an empty cell for 1 to 12 watches, any problems, in any order, at 4 and 2 columns", () => {
    for (const cols of [4, 2])
      for (let n = 1; n <= 12; n++)
        for (let mask = 0; mask < 1 << Math.min(n, 8); mask++) {
          const spans = Array.from({ length: n }, (_, i) => ((mask >> (i % 8)) & 1 ? 2 : 1))
          const cells = fillRows([RADAR(cols), ...spans], cols)
          expect(holes(layout(cells, cols)), `${cols} cols, ${spans.join("")}`).toBe(0)
        }
  })

  it("orders problems, then running, then healthy, then paused; by group keeps the groups", () => {
    const ws = [
      w("disk", "disk", "/"),
      w("paused", "dns", "axeai.com", { paused: true }),
      w("links", "links", "axeai.com", { checking: true }),
      w("pk", "outdated", "~/next", { open: [problem()] }),
      w("api", "health", "axeai.com/api/health"),
      w("cf", "status", "cloudflare", { open: [problem("status:cloudflare:major")] }),
    ]
    expect(sortTiles(ws, "problems", T).map((x) => x.id)).toEqual(["cf", "pk", "links", "api", "disk", "paused"])
    expect(sortTiles(ws, "group", T).map((x) => x.id)).toEqual(["api", "links", "paused", "cf", "pk", "disk"])
  })

  it("remembers the order", () => {
    const m = new Map<string, string>()
    globalThis.localStorage ??= { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as Storage
    expect(loadOrder()).toBe("problems")
    saveOrder("group")
    expect(loadOrder()).toBe("group")
  })

  it("places dots on their group's ring, evenly, from a stable angle, labels outside unless they'd run off", () => {
    const ws = [
      { id: "a", kind: "health" as const, label: 60 },
      { id: "b", kind: "links" as const, label: 40 },
      { id: "c", kind: "dns" as const, label: 30 },
      { id: "d", kind: "disk" as const, label: 120 },
    ]
    const nodes = radarPlace(ws, 470, [92, 150, 208])
    expect(nodes.map((n) => [n.id, n.ring])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 1],
      ["d", 2],
    ])
    expect(nodes[0]!.angle).toBe(hashAngle("a"))
    expect((nodes[1]!.angle - nodes[0]!.angle + 360) % 360).toBeCloseTo(180)
    // The same ids land in the same places on every render.
    expect(radarPlace(ws, 470, [92, 150, 208])).toEqual(nodes)
    for (const n of nodes) {
      const r = [92, 150, 208][n.ring]!
      expect(Math.hypot(n.x - 235, n.y - 235)).toBeCloseTo(r)
    }
    // Labels stay on the drawing, and don't cover each other or the centre where the other side is free.
    const many = radarPlace(
      Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, kind: (["health", "dns", "disk"] as const)[i % 3]!, label: 80 })),
      470,
      [92, 150, 208],
    )
    const boxOf = (n: { x: number; y: number; side: string }) =>
      ({ right: [n.x + 18, n.y - 18, n.x + 98, n.y + 18], left: [n.x - 98, n.y - 18, n.x - 18, n.y + 18], above: [n.x - 40, n.y - 48, n.x + 40, n.y - 12], below: [n.x - 40, n.y + 12, n.x + 40, n.y + 48] })[n.side]!
    for (const n of many) {
      const [l, , r] = boxOf(n)
      expect(l).toBeGreaterThanOrEqual(-24)
      expect(r).toBeLessThanOrEqual(494)
    }
    const hit = (a: number[], b: number[]) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!
    const overlaps = (ns: typeof many) => ns.flatMap((a, i) => ns.slice(i + 1).filter((b) => hit(boxOf(a), boxOf(b)))).length
    // No more overlaps than putting every label outward (inward only where it would run off), and none on the centre.
    const outward = many.map((n) => {
      const right = n.x >= 235 ? n.x + 98 <= 494 : n.x - 98 < -24
      return { ...n, side: right ? ("right" as const) : ("left" as const) }
    })
    expect(overlaps(many)).toBeLessThanOrEqual(overlaps(outward))
    for (const n of many) expect(hit(boxOf(n), [175, 175, 295, 295])).toBe(false)
    expect(ringLegend([{ kind: "health" }, { kind: "dns" }, { kind: "status" }, { kind: "disk" }])).toEqual(["Inner: site", "Middle: domain and services", "Outer: this Mac"])
    expect(ringLegend([{ kind: "disk" }, { kind: "wallets" }])).toEqual(["Outer: this Mac and web"])
  })

  it("words a tile from the watch's own data", () => {
    const cf = w("cf", "status", "openrouter, groq, cloudflare", {
      name: "OpenRouter, Groq, Cloudflare",
      every: "15m",
      open: [problem("status:cloudflare:major")],
      latest: run({ rows: [{ label: "OpenRouter", value: "Not readable: no public status feed", ok: false }, { label: "Groq", value: "Running normally", ok: true }, { label: "Cloudflare", value: "Partial System Outage", ok: false }] }),
    })
    expect(shortName(cf)).toBe("Services")
    expect(subOf(cf)).toBe("3 status pages, every 15 min")
    expect(headlineOf(cf, T)).toBe("Cloudflare outage")
    expect(whenOf(cf, T)).toMatch(/^Since /)
    const disk = w("d", "disk", "/", { name: "This Mac’s disk", latest: run({ metric: 382, facts: [["Free", "382 GB"], ["Of", "994 GB"]] }) })
    expect([shortName(disk), subOf(disk), headlineOf(disk, T), logValue(disk, T)]).toEqual(["Disk", "This Mac, of 994 GB", "382 GB free", "382 GB free"])
    const api = w("h", "health", "axeai.com/api/health", { name: "axeai.com/api/health", every: "5m", latest: run({ at: T, ms: 575, facts: [["ok", "true"]] }) })
    expect([shortName(api), headlineOf(api, T), logValue(api, T), nextCheck(api)]).toEqual(["API health", "575 ms", "575 ms, ok", T + 300_000])
    expect(nextCheck(w("m", "tests", "~/x", { every: "morning" }))).toBeUndefined()
    // A renamed watch keeps its name.
    expect(shortName({ ...api, name: "Shop API" })).toBe("Shop API")
  })
})
