import { nameFor } from "@shared/watching/copy"
import { folderName } from "@shared/watching/more"
import { EVERY_MS } from "@shared/watching/schedule"
import type { CheckRow, Every, Kind, WatchView } from "@shared/watching/types"

import { clock, day, sameDay } from "@/components/watching/Evidence"
import { factOf, hostOf, isDown, lineOf, problemsOf } from "@/lib/dashboard"

// The live dashboard's words for a watch (spec 0002): its short name, the line under it, the headline value,
// when, and the live log's entry. Every value comes from the watch's own runs, facts and rows.

export function ago(t: number, now = Date.now()) {
  const m = Math.round((now - t) / 60_000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m} min ago`
  if (sameDay(t, now)) return clock(t)
  if (sameDay(t, now - 86_400_000)) return "Yesterday"
  return day(t)
}
export const since = (t: number, now = Date.now()) => (sameDay(t, now) ? clock(t) : day(t))

/** An unrenamed watch reads by kind on its tile ("axeai.com DNS" is "DNS"; the line under it names the site). */
const SHORT: Partial<Record<Kind, string>> = {
  health: "API health",
  links: "Links",
  feed: "Download feed",
  seo: "SEO",
  dns: "DNS",
  expiry: "Certificate",
  status: "Services",
  tests: "Tests",
  disk: "Disk",
  security: "Security",
  pagespeed: "Page speed",
  global: "Global response",
  email: "Email blacklists",
}
export const shortName = (w: Pick<WatchView, "kind" | "name" | "target">) => (SHORT[w.kind] && w.name === nameFor(w.kind, w.target) ? SHORT[w.kind]! : w.name)

const OFTEN: Record<Every, string> = { "5m": "every 5 min", "15m": "every 15 min", "1h": "every hour", morning: "every morning" }
const tail = (path: string) => path.replace(/\/+$/, "").split("/").slice(-2).join("/")
const noProto = (t: string) => t.replace(/^https?:\/\//, "")
const stop = (s: string) => s.replace(/\.$/, "")

/** The line under the name: what is watched, in a few words. */
export function subOf(w: WatchView): string {
  const rows = w.latest?.rows ?? []
  switch (w.kind) {
    case "status":
      return rows.length ? `${rows.length} status ${rows.length === 1 ? "page" : "pages"}, ${OFTEN[w.every]}` : noProto(w.target)
    case "outdated":
      return `${tail(w.folder ?? w.target)}, ${OFTEN[w.every]}`
    case "tests": {
      const cmd = factOf(w, "Command")
      return cmd ? `${folderName(w.target)}, ${cmd}` : folderName(w.target)
    }
    case "links": {
      const pages = factOf(w, "Pages")
      return pages ? `${hostOf(w) ?? w.target}, ${pages} pages` : noProto(w.target)
    }
    case "seo":
      return rows.some((r) => r.label === "sitemap.xml") ? "sitemap.xml" : noProto(w.target)
    case "expiry": {
      const until = factOf(w, "Certificate")
      return until ? `${hostOf(w) ?? w.target}, until ${until}` : noProto(w.target)
    }
    case "disk": {
      const of = factOf(w, "Of")
      return of ? `This Mac, of ${of}` : "This Mac"
    }
    default:
      return noProto(w.target)
  }
}

const failing = (w: WatchView): CheckRow[] => (w.latest?.rows ?? []).filter((r) => !r.ok && !r.value.startsWith("Not readable"))

/** The headline value: "575 ms", "29 pages", "Cloudflare outage", "4 behind". */
export function headlineOf(w: WatchView, now = Date.now()): string {
  if (w.checking && !problemsOf(w, now).length) return "Checking"
  if (w.paused) return "Paused"
  if (!w.latest) return "Waiting"
  const p = problemsOf(w, now)
  if (p[0]) {
    if (w.kind === "status") {
      const bad = failing(w)
      return bad.length > 1 ? `${bad.length} outages` : bad[0] ? `${bad[0].label} outage` : stop(p[0].headline)
    }
    // The same count as the footer and New chat: the packages the finding lists, not the raw metric.
    if (w.kind === "outdated" && (failing(w).length || w.latest.metric !== undefined)) return `${failing(w).length || w.latest.metric} behind`
    if (isDown(w, now)) return "Down"
    return stop(p[0].headline)
  }
  if (w.latest.status === "failed") return "Couldn’t check"
  const rows = w.latest.rows ?? []
  switch (w.kind) {
    case "health":
      return `${Math.round(w.latest.ms)} ms`
    case "seo":
      return rows.find((r) => r.label === "sitemap.xml")?.value ?? "Fine"
    case "dns":
      return "Fine"
    case "expiry":
      return w.latest.metric !== undefined ? `${w.latest.metric} ${w.latest.metric === 1 ? "day" : "days"} left` : stop(w.line)
    case "feed": {
      const f = w.latest.facts?.[0]
      return f ? `${f[0]} ${f[1]}` : stop(w.line)
    }
    case "disk": {
      const free = factOf(w, "Free")
      return free ? `${free} free` : stop(w.line)
    }
    case "tests":
      return factOf(w, "Result") ?? stop(w.line)
    case "links": {
      const pages = factOf(w, "Pages")
      return pages ? `${pages} pages` : stop(w.line)
    }
    case "uptime": {
      const ms = w.latest.metric
      return ms === undefined ? "Up" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`
    }
    case "page":
      return w.unread ? "Changed" : "No changes"
    default:
      return stop(lineOf(w, now))
  }
}

/** The value beside a radar dot, shorter than a tile's: "Cloudflare", "78 days". */
export function radarValue(w: WatchView, now = Date.now()): string {
  if (w.kind === "status" && problemsOf(w, now)[0]) {
    const bad = failing(w)
    if (bad.length) return bad.length > 1 ? `${bad.length} services` : bad[0]!.label
  }
  if (w.kind === "expiry" && w.latest?.metric !== undefined && !problemsOf(w, now)[0]) return `${w.latest.metric} ${w.latest.metric === 1 ? "day" : "days"}`
  return headlineOf(w, now)
}

/** Right of the value: "Now" while checking, "Since 11:27 am" for a problem, else when it last ran. */
export function whenOf(w: WatchView, now = Date.now()): string {
  const p = problemsOf(w, now)
  if (p[0]) return `Since ${since(Math.min(...p.map((f) => f.openedAt)), now)}`
  if (w.checking) return "Now"
  return w.latest ? ago(w.latest.at, now) : ""
}

/** When the next check is due: the last run plus the watch's interval; none for morning or paused watches. */
export function nextCheck(w: WatchView): number | undefined {
  if (w.paused || w.every === "morning" || !w.latest) return undefined
  return w.latest.at + EVERY_MS[w.every]
}

/** The live log's entry for a watch: its problem, what it's checking, or its value. */
export function logValue(w: WatchView, now = Date.now()): string {
  if (problemsOf(w, now)[0]) return stop(lineOf(w, now))
  if (w.checking) {
    const pages = factOf(w, "Pages")
    return pages && w.kind === "links" ? `checking ${pages} pages` : "checking now"
  }
  if (w.kind === "health" && w.latest && factOf(w, "ok") === "true") return `${Math.round(w.latest.ms)} ms, ok`
  if (w.kind === "tests" && factOf(w, "Result")) return [factOf(w, "Result"), factOf(w, "Took")].filter(Boolean).join(" in ")
  const v = headlineOf(w, now)
  return v === "Fine" ? "fine" : v
}

/** The status word for a dot's label and a tile's pill. */
export const STATUS_WORD = { ok: "Healthy", warn: "Warning", bad: "Down", run: "Checking", paused: "Paused" } as const
