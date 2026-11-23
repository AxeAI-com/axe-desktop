import { liveProblems } from "@shared/watching/findings"
import { clock, day, sameDay } from "@/components/watching/Evidence"
import type { Kind, OpenFinding, RunStatus, StripTick, WatchView } from "@shared/watching/types"

// The Watching dashboard's numbers, all from the watches themselves: health, the groups by kind, the 24-tick
// strips, and the live dashboard's layout (tile order, the grid with no empty cell, the radar). No sample values.

/** Ticks a row's history strip shows. */
export const TICKS = 24
/** Failed runs in a row before a watch counts as down ("Couldn't reach"). */
const FAILED_DOWN = 3

export type Group = "site" | "domain" | "services" | "mac" | "web" | "other"
export const GROUP_LABEL: Record<Group, string> = { site: "Site", domain: "Domain", services: "Services", mac: "This Mac", web: "Web", other: "Other" }
/** Order on the page; also the words of the status line ("Your site, domain, services and this Mac."). */
export const GROUPS: Group[] = ["site", "domain", "services", "mac", "web", "other"]

const GROUP_OF: Record<Kind, Group> = {
  uptime: "site",
  health: "site",
  links: "site",
  feed: "site",
  seo: "site",
  page: "site",
  pagespeed: "site",
  global: "site",
  dns: "domain",
  expiry: "domain",
  security: "domain",
  email: "domain",
  status: "services",
  tests: "mac",
  outdated: "mac",
  disk: "mac",
  repo: "mac",
  processes: "mac",
  memory: "mac",
  battery: "mac",
  ports: "mac",
  docker: "mac",
  gitrepos: "mac",
  brew: "mac",
  macos: "mac",
  timemachine: "mac",
  hogs: "mac",
  network: "mac",
  wallets: "web",
  fees: "web",
  mentions: "web",
  downloads: "web",
  price: "other",
  custom: "other",
}
/** Within a group, watches go in this order of kind (the design's: API health, links, updates, SEO…). */
const ORDER = Object.keys(GROUP_OF) as Kind[]
export const groupOf = (k: Kind): Group => GROUP_OF[k]

/** "axeai.com/api/health" → "axeai.com"; folders and service lists have no host. */
export function hostOf(w: Pick<WatchView, "kind" | "target">): string | undefined {
  if (GROUP_OF[w.kind] === "mac" || GROUP_OF[w.kind] === "web" || w.kind === "status") return undefined
  return w.target.replace(/^https?:\/\//, "").split("/")[0]!.replace(/^www\./, "") || undefined
}

/** One shared host for a group's heading ("Site axeai.com"), or nothing when they differ. */
export function groupHost(ws: Pick<WatchView, "kind" | "target">[]): string | undefined {
  const hosts = new Set(ws.map(hostOf))
  const [only] = hosts
  return hosts.size === 1 ? only : undefined
}

export const problemsOf = (w: WatchView, now = Date.now()): OpenFinding[] => (w.paused ? [] : liveProblems(w, now))
export const isDown = (w: WatchView, now = Date.now()) =>
  !w.paused && (w.failedStreak >= FAILED_DOWN || problemsOf(w, now).some((f) => f.key === "down" || f.key.endsWith(":down") || f.key === "health:status"))
export const needsLook = (w: WatchView, now = Date.now()) => !w.paused && (problemsOf(w, now).length > 0 || w.failedStreak >= FAILED_DOWN)

/** The row's line: the problem, "2 new security alerts.", "… Snoozed.", "Paused since 3:20 pm.", else the latest fact. */
export function lineOf(w: WatchView, now = Date.now()): string {
  if (w.paused) return w.pausedAt ? `Paused since ${sameDay(w.pausedAt, now) ? clock(w.pausedAt) : day(w.pausedAt)}.` : "Paused."
  const p = problemsOf(w, now)
  if (w.kind === "repo" && p.length > 1) return `${p.length} new security alerts.`
  if (p[0]) return p[0].line ?? w.line
  const quiet = w.open.find((f) => f.level === "problem" && !!f.snoozedUntil && f.snoozedUntil > now)
  return quiet ? `${quiet.line ?? w.line} Snoozed.` : w.line
}

export type Health = { total: number; healthy: number; warnings: number; down: number }

/** Paused watches don't count either way. */
export function healthOf(ws: WatchView[], now = Date.now()): Health {
  const on = ws.filter((w) => !w.paused)
  const down = on.filter((w) => isDown(w, now)).length
  const look = on.filter((w) => needsLook(w, now)).length
  return { total: on.length, healthy: on.length - look, warnings: look - down, down }
}

export type TickTone = "ok" | "warn" | "news" | "fail" | "empty" | "live"

const TONE: Record<RunStatus, TickTone> = { quiet: "ok", news: "news", problem: "warn", failed: "fail" }

/** The last 24 runs, oldest first, padded in front with empty ticks; a run in progress is the last tick. */
export function ticks(strip: StripTick[], checking = false, n = TICKS): TickTone[] {
  const runs = strip.slice(checking ? -(n - 1) : -n).map((t) => TONE[t.status])
  const out: TickTone[] = [...runs, ...(checking ? (["live"] as const) : [])]
  return [...Array<TickTone>(Math.max(0, n - out.length)).fill("empty"), ...out]
}

/** A fact of the latest run: "Free" → "382 GB". */
export const factOf = (w: WatchView, label: string) => w.latest?.facts?.find(([k]) => k === label)?.[1]

/** Watches by group, in page order, each group's watches as the engine sorted them. */
export function grouped(ws: WatchView[]): { group: Group; watches: WatchView[] }[] {
  const rank = (k: Kind) => ORDER.indexOf(k)
  return GROUPS.map((group) => ({ group, watches: ws.filter((w) => GROUP_OF[w.kind] === group).sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name)) })).filter((g) => g.watches.length)
}

/** "Your site, domain, services and this Mac." from the groups there are. */
export function coverLine(groups: Group[]): string {
  const words = groups.filter((g) => g !== "other").map((g) => (g === "mac" ? "this Mac" : GROUP_LABEL[g].toLowerCase()))
  if (!words.length) return ""
  if (words.length === 1 && words[0] === "this Mac") return "This Mac."
  const list = words.length < 2 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
  return `Your ${list}.`
}

/* The live dashboard (spec 0002): tile order, the grid, the radar */

/** A watch's status colour: a problem (warn), down (bad), a run in progress (run), paused, else ok. */
export type Tone = "ok" | "warn" | "bad" | "run" | "paused"

export function toneOf(w: WatchView, now = Date.now()): Tone {
  if (w.paused) return "paused"
  if (isDown(w, now)) return "bad"
  if (needsLook(w, now)) return "warn"
  return w.checking ? "run" : "ok"
}

export type Order = "problems" | "group"
const ORDER_KEY = "axe.watching.order"

export function loadOrder(): Order {
  try {
    return localStorage.getItem(ORDER_KEY) === "group" ? "group" : "problems"
  } catch {
    return "problems"
  }
}
export function saveOrder(o: Order) {
  try {
    localStorage.setItem(ORDER_KEY, o)
  } catch {}
}

const RANK: Record<Tone, number> = { bad: 0, warn: 0, run: 1, ok: 2, paused: 3 }

/**
 * The tiles' order. Problems first: problems, then running, then healthy, then paused, each in group order.
 * By group: group order, problems first within a group. Inside either, kinds keep the groups' order.
 */
export function sortTiles(ws: WatchView[], order: Order, now = Date.now()): WatchView[] {
  const g = (w: WatchView) => GROUPS.indexOf(GROUP_OF[w.kind])
  const k = (w: WatchView) => ORDER.indexOf(w.kind)
  const r = (w: WatchView) => RANK[toneOf(w, now)]
  const look = (w: WatchView) => (needsLook(w, now) ? 0 : 1)
  const by = order === "problems" ? (a: WatchView, b: WatchView) => r(a) - r(b) || g(a) - g(b) : (a: WatchView, b: WatchView) => g(a) - g(b) || look(a) - look(b)
  return [...ws].sort((a, b) => by(a, b) || k(a) - k(b) || a.name.localeCompare(b.name))
}

/** A grid item: columns wide, rows tall. */
export type Cell = { w: number; h: number }

/**
 * Places items the way CSS grid's sparse auto-flow does and widens tiles so no cell stays empty: a tile that
 * leaves a gap at the end of its row (because the next one doesn't fit) grows into it, and so does the last
 * tile of a row that ends short. An item taller than a row (the radar) shrinks when nothing sits beside its
 * lower rows. `spans` are column spans, or `{ w, h }` for an item that spans rows too. Returns each final cell.
 */
export function fillRows(spans: (number | Cell)[], cols: number): Cell[] {
  const cells: Cell[] = spans.map((s) => (typeof s === "number" ? { w: Math.min(s, cols), h: 1 } : { w: Math.min(s.w, cols), h: Math.max(1, s.h) }))
  const grid: number[][] = []
  const row = (r: number) => (grid[r] ??= Array<number>(cols).fill(-1))
  const at: { r: number; c: number }[] = []
  const fits = (r: number, c: number, it: Cell) => {
    for (let y = r; y < r + it.h; y++) for (let x = c; x < c + it.w; x++) if (row(y)[x] !== -1) return false
    return true
  }
  const own = (j: number, r: number, c: number, w: number, h: number) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) row(y)[x] = j
  }
  /** Row `r` has free cells from column `c` to its end: the one-row tile just before them takes them. */
  const close = (r: number, c: number) => {
    if (c <= 0 || c >= cols || row(r).slice(c).some((o) => o !== -1)) return
    const j = row(r)[c - 1]!
    if (j < 0 || cells[j]!.h !== 1 || at[j]!.r !== r) return
    own(j, r, c, cols - c, 1)
    cells[j]!.w += cols - c
  }
  let r = 0
  let c = 0
  cells.forEach((it, i) => {
    for (;;) {
      if (c + it.w > cols) {
        close(r, c)
        r++
        c = 0
      } else if (fits(r, c, it)) break
      else c++
    }
    at.push({ r, c })
    own(i, r, c, it.w, it.h)
    c += it.w
  })
  // A tall item is no taller than the rows that have something beside it.
  const last = Math.max(0, ...at.map((p, j) => (cells[j]!.h === 1 ? p.r : 0)))
  at.forEach((p, j) => {
    const it = cells[j]!
    if (it.h > 1 && p.r + it.h - 1 > last) {
      for (let y = last + 1; y < p.r + it.h; y++) for (let x = p.c; x < p.c + it.w; x++) row(y)[x] = -1
      it.h = Math.max(1, last - p.r + 1)
    }
  })
  for (let y = 0; y <= last; y++) {
    const end = row(y).findLastIndex((o) => o !== -1) + 1
    close(y, end)
  }
  return cells
}

/** The radar's rings: inner Site, middle Domain and Services, outer This Mac, Web and Other. */
export const RING_OF: Record<Group, 0 | 1 | 2> = { site: 0, domain: 1, services: 1, mac: 2, web: 2, other: 2 }
const RING_GROUPS: Group[][] = [["site"], ["domain", "services"], ["mac", "web", "other"]]

/** "Inner ring Site", "Middle Domain and services", "Outer This Mac and web": only the rings that have watches. */
export function ringLegend(ws: Pick<WatchView, "kind">[]): string[] {
  const used = new Set(ws.map((w) => GROUP_OF[w.kind]))
  const word = ["Inner", "Middle", "Outer"]
  return RING_GROUPS.flatMap((gs, i) => {
    const names = gs.filter((g) => used.has(g)).map((g) => (g === "mac" ? "this Mac" : GROUP_LABEL[g].toLowerCase()))
    if (!names.length) return []
    return [`${word[i]}: ${names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}`]
  })
}

/** A stable angle for a watch, 0 to 359 degrees, from its id. */
export function hashAngle(id: string): number {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h % 360
}

export type LabelSide = "left" | "right" | "above" | "below"
export type RadarNode = { id: string; ring: 0 | 1 | 2; angle: number; x: number; y: number; side: LabelSide }

/**
 * Where each watch sits on the radar: its group's ring, spread evenly round it from a stable angle (the hash of
 * the ring's first watch), 0 degrees up and clockwise like the hand. A label (`label` px wide, `tall` px high) goes
 * on the outer side of its dot; if that runs more than `room` px off the drawing, or covers the centre or another
 * label, it tries the other side, then above and below the dot.
 */
export function radarPlace(ws: { id: string; kind: Kind; label: number; tall?: number }[], size: number, radii: readonly number[], room = 24): RadarNode[] {
  const mid = size / 2
  const rings: (typeof ws)[] = [[], [], []]
  for (const w of ws) rings[RING_OF[GROUP_OF[w.kind]]]!.push(w)
  type Box = [number, number, number, number]
  const core: Box = [mid - 60, mid - 60, mid + 60, mid + 60]
  const placed: Box[] = [core]
  const hits = (a: Box) => placed.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1])
  const box = (x: number, y: number, w: { label: number; tall?: number }, side: LabelSide): Box => {
    const h = w.tall ?? 36
    if (side === "above") return [x - w.label / 2, y - 12 - h, x + w.label / 2, y - 12]
    if (side === "below") return [x - w.label / 2, y + 12, x + w.label / 2, y + 12 + h]
    return side === "right" ? [x + 18, y - 18, x + 18 + w.label, y - 18 + h] : [x - 18 - w.label, y - 18, x - 18, y - 18 + h]
  }
  const inside = (b: Box) => b[0] >= -room && b[2] <= size + room
  const nodes = rings.flatMap((list, ring) => {
    const start = list[0] ? hashAngle(list[0].id) : 0
    return list.map((w, i) => {
      const angle = (start + (i * 360) / list.length) % 360
      const rad = (angle * Math.PI) / 180
      return { w, ring: ring as 0 | 1 | 2, angle, x: mid + radii[ring]! * Math.sin(rad), y: mid - radii[ring]! * Math.cos(rad) }
    })
  })
  // Outer rings first: their labels have the least room.
  return [...nodes]
    .sort((a, b) => b.ring - a.ring)
    .map(({ w, ring, angle, x, y }) => {
      const out: LabelSide = x >= mid ? "right" : "left"
      const order: LabelSide[] = [out, out === "right" ? "left" : "right", y < mid ? "above" : "below", y < mid ? "below" : "above"]
      const ok = order.filter((s) => inside(box(x, y, w, s)))
      // Where every place is taken, the one that covers the least, and never the centre if it can help it.
      const cover = (s: LabelSide) => {
        const a = box(x, y, w, s)
        return placed.reduce((n, b) => n + (b === core ? 1000 : 1) * Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), 0)
      }
      const side = ok.find((s) => !hits(box(x, y, w, s))) ?? [...ok].sort((a, b) => cover(a) - cover(b))[0] ?? out
      placed.push(box(x, y, w, side))
      return { id: w.id, ring, angle, x, y, side }
    })
    .sort((a, b) => nodes.findIndex((n) => n.w.id === a.id) - nodes.findIndex((n) => n.w.id === b.id))
}

