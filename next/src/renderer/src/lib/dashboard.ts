import { liveProblems } from "@shared/watching/findings"
import { folderName } from "@shared/watching/more"
import { clock, day, sameDay } from "@/components/watching/Evidence"
import type { Kind, OpenFinding, RunStatus, StripTick, WatchView } from "@shared/watching/types"

// The Watching dashboard's numbers, all from the watches themselves: the health ring, the metric cards,
// the groups by kind and the 24-tick strips. No sample values; a card or group with no watch is left out.

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

/** The ring's arcs on a circle of circumference `c`, each with a gap of `gap` (round caps eat into it). */
export function ringArcs(h: Health, c: number, gap = 5): { tone: "ok" | "warn" | "bad"; len: number; offset: number }[] {
  if (!h.total) return []
  const parts = [
    { tone: "ok" as const, n: h.healthy },
    { tone: "warn" as const, n: h.warnings },
    { tone: "bad" as const, n: h.down },
  ].filter((p) => p.n > 0)
  const only = parts.length === 1
  let start = 0
  return parts.map((p) => {
    const span = (c * p.n) / h.total
    const arc = { tone: p.tone, len: only ? c : Math.max(0.01, span - gap), offset: only ? 0 : -(start + gap / 2) }
    start += span
    return arc
  })
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
const num = (s?: string) => (s ? Number(s.replace(/[^\d.]/g, "")) : NaN)

export type Metric =
  | { kind: "response"; w: WatchView; ms: number; series: number[]; ok: boolean; foot: string }
  | { kind: "certificate"; w: WatchView; days: number; until?: string; foot: string }
  | { kind: "disk"; w: WatchView; freeGb: number; totalGb?: number; foot: string }
  | { kind: "tests"; w: WatchView; passing: boolean; foot: string }

const first = (ws: WatchView[], k: Kind) => ws.find((w) => w.kind === k && !!w.latest && w.latest.status !== "failed")

/**
 * The four metric cards, each from a real watch, or left out: health's answer time (else uptime's load time),
 * certificate days left, disk free, and tests.
 */
export function metricsOf(ws: WatchView[]): Metric[] {
  const out: Metric[] = []
  const health = first(ws, "health")
  const up = first(ws, "uptime")
  if (health) {
    const said = factOf(health, "ok")
    out.push({
      kind: "response",
      w: health,
      ms: health.latest!.ms,
      series: health.strip.filter((t) => t.status !== "failed" && t.ms !== undefined).map((t) => t.ms!),
      ok: health.latest!.status === "quiet",
      foot: said === "true" ? `${health.target} says ok` : health.target,
    })
  } else if (up?.latest?.metric !== undefined)
    out.push({
      kind: "response",
      w: up,
      ms: up.latest.metric,
      series: up.strip.filter((t) => t.metric !== undefined).map((t) => t.metric!),
      ok: up.latest.status === "quiet",
      foot: `${up.target} home page`,
    })
  const exp = first(ws, "expiry")
  if (exp?.latest?.metric !== undefined) {
    const until = factOf(exp, "Certificate")
    out.push({ kind: "certificate", w: exp, days: exp.latest.metric, until, foot: hostOf(exp) ?? exp.target })
  }
  const disk = first(ws, "disk")
  if (disk?.latest?.metric !== undefined) {
    const total = num(factOf(disk, "Of"))
    out.push({ kind: "disk", w: disk, freeGb: disk.latest.metric, ...(Number.isFinite(total) && total > 0 ? { totalGb: total } : {}), foot: "This Mac" })
  }
  const tests = first(ws, "tests")
  if (tests) out.push({ kind: "tests", w: tests, passing: tests.latest!.status !== "problem", foot: folderName(tests.target) })
  return out
}

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

/* Collapsed sections, per viewer */

const KEY = "axe.watching.collapsed"

export function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}

export function saveCollapsed(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]))
  } catch {}
}
