import { statusOf } from "./findings"
import type { Finding, PageFile, Run, Usual } from "./types"

// Uptime and speed, decided from one probe, one full page load and the site's own history. No model.
// Down: the site fails twice, a minute apart. Slow: the load time is above twice the usual (the 7-day
// median of quiet runs) and over 2 s, two runs in a row. "Tell me above 3 s" sets a fixed line instead.

/** The GET: a status, or why there was none. `bytes` is the size of the page itself. */
export type Probe =
  | { ok: true; status: number; statusText?: string; ms: number; bytes?: number }
  | { ok: false; error: "dns" | "noanswer"; text: string }

/** The full load in a hidden window: how long until the page finished loading, and its files. */
export type FullLoad = { ms: number; files: PageFile[] }

export const FLOOR_MS = 2000
const WEEK = 7 * 86_400_000
/** With fewer quiet runs than this after "That's expected", the usual stays the value you accepted. */
const SETTLE = 6
/** A file counts as added when it's new (or grew by half) and is at least this big. */
const BIG = 200 * 1024

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  const at = (i: number) => s[i] ?? 0
  return s.length % 2 ? at(m) : (at(m - 1) + at(m)) / 2
}

/** The usual load time: the 7-day median of quiet runs, or the value you accepted with "That's expected". */
export function usualMs(history: Pick<Run, "at" | "status" | "metric">[], now: number, usual?: Usual): number | null {
  const good = history.filter((r) => r.status === "quiet" && typeof r.metric === "number" && r.at >= now - WEEK && (!usual || r.at >= usual.at)).map((r) => r.metric as number)
  if (usual && good.length < SETTLE) return usual.ms
  return good.length ? median(good) : null
}

/** Slow means above twice the usual and over 2 s. A fixed line wins. Null until there's a usual. */
export const slowLimit = (usual: number | null, fixedMs?: number): number | null => (fixedMs ? fixedMs : usual === null ? null : Math.max(2 * usual, FLOOR_MS))

export const seconds = (ms: number) => (ms < 100 ? "under 0.1 s" : `${(ms / 1000).toFixed(1)} s`)
/** "about 4 s" for "I'll treat about 4 s as usual". */
export const roughSeconds = (ms: number) => `${ms < 1000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)} s`

export function size(bytes: number, round = false) {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${round || mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const HTTP: Record<number, string> = {
  200: "OK", 201: "Created", 204: "No Content", 301: "Moved Permanently", 302: "Found", 304: "Not Modified", 400: "Bad Request", 401: "Unauthorized",
  403: "Forbidden", 404: "Not Found", 410: "Gone", 429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
}
export const httpLine = (status: number, text?: string) => `${status} ${text || HTTP[status] || ""}`.trim()

const clock = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]
const count = (n: number) => WORDS[n] ?? String(n)

/** "photo" for an image, and so on, so the cause reads like a person wrote it. */
function noun(f: PageFile): string {
  const ext = (f.name.split(".").pop() ?? "").toLowerCase()
  if (/^(jpe?g|png|gif|webp|avif|heic|bmp|tiff?)$/.test(ext)) return "photo"
  if (/^(mp4|webm|mov|m4v)$/.test(ext)) return "video"
  if (/^(js|mjs)$/.test(ext)) return "script"
  if (/^(woff2?|ttf|otf)$/.test(ext)) return "font"
  return "file"
}

/** Where the page is, for the sentences: "the home page", or the path. */
export function where(target: string) {
  const path = target.includes("/") ? target.slice(target.indexOf("/")) : ""
  return path && path !== "/" ? path : "the home page"
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Why it got slow, from the full load: the big files that are new (or grew by half) since the last
 * quiet run, and when they first showed up. Null when no file explains it.
 */
export function slowCause(files: PageFile[], history: Pick<Run, "at" | "status" | "files" | "metric">[], limitMs = Number.POSITIVE_INFINITY): { text: string; label: string; at: number } | null {
  // The last run that was quiet and not slow (the first slow run is still "quiet").
  const baseAt = history.findLastIndex((r) => r.status === "quiet" && r.files?.length && (r.metric ?? 0) <= limitMs)
  const base = baseAt >= 0 ? history[baseAt]!.files! : []
  const before = new Map(base.map((f) => [f.url, f.bytes]))
  const added = files.filter((f) => f.bytes >= BIG && !(before.has(f.url) && before.get(f.url)! * 1.5 >= f.bytes))
  if (!added.length) return null
  // When: the file's own date if the server says, else the first run that saw it.
  const urls = new Set(added.map((f) => f.url))
  const seen = history.slice(baseAt + 1).find((r) => r.files?.some((f) => urls.has(f.url)))?.at
  const dated = added.every((f) => f.modified) ? Math.max(...added.map((f) => f.modified!)) : undefined
  const at = dated ?? seen ?? Date.now()
  const kinds = new Set(added.map(noun))
  const one = kinds.size === 1 ? [...kinds][0]! : "file"
  const n = added.length
  const label = `${n} ${one}${n === 1 ? "" : "s"} added`
  if (n === 1) return { text: `A ${one} added at ${clock(at)} is ${size(added[0]!.bytes)}.`, label, at }
  const sizes = added.map((f) => f.bytes)
  const total = sizes.reduce((a, b) => a + b, 0)
  if (Math.max(...sizes) <= Math.min(...sizes) * 1.5) return { text: `${count(n)} ${one}s added at ${clock(at)} are ${size(total / n, true)} each.`, label, at }
  const big = [...added].sort((a, b) => b.bytes - a.bytes)[0]!
  return { text: `${count(n)} ${one}s added at ${clock(at)} add ${size(total)}, the largest ${big.name} at ${size(big.bytes)}.`, label, at }
}

const DOWN_BODY = "Checked twice, a minute apart."

/** One run's findings. `ok` runs carry the facts the first message and the slow card show. */
export function evaluateUptime(
  target: string,
  p: { probe: Probe; load?: FullLoad | null },
  history: Pick<Run, "at" | "status" | "metric" | "files">[],
  w: { usual?: Usual; fixedMs?: number },
  at: number,
  ms: number,
): Run {
  const { probe } = p
  if (!probe.ok || probe.status >= 400) {
    const host = target.split("/")[0] ?? target
    const status = probe.ok ? httpLine(probe.status, probe.statusText) : undefined
    const what = !probe.ok ? (probe.error === "dns" ? `${host} no longer resolves.` : "It doesn’t answer.") : `It returns ${status}.`
    const f: Finding = { key: "down", level: "problem", headline: `${target} is down`, detail: `${what} ${DOWN_BODY}`, line: `Down. ${what}`, note: `Down. ${what}`, fix: "none", ev: { status: status ?? (!probe.ok && probe.error === "dns" ? "Not found" : "No answer") } }
    return { at, ms, status: "problem", findings: [f], ...(status ? { http: status } : {}) }
  }
  const loadMs = p.load?.ms ?? probe.ms
  const page: PageFile = { name: "the page", url: target, bytes: probe.bytes ?? 0 }
  const files = [...(p.load?.files ?? []), ...(probe.bytes ? [page] : [])].sort((a, b) => b.bytes - a.bytes).slice(0, 12)
  const usual = usualMs(history, at, w.usual)
  const limit = slowLimit(usual, w.fixedMs)
  const last = history.at(-1)
  const findings: Finding[] = []
  if (limit !== null && loadMs > limit && last?.metric !== undefined && last.status !== "failed" && last.metric > limit) {
    const cause = slowCause(files, history, limit)
    const up = usual !== null ? `, up from ${seconds(usual)}` : ""
    findings.push({
      key: "slow",
      level: "problem",
      headline: `${target} is slow`,
      detail: `${cap(where(target))} takes ${seconds(loadMs)} to load${usual !== null ? `, up from about ${seconds(usual)}` : ""}.${cause ? ` ${cause.text}` : ""}`,
      line: `Slow: ${where(target)} takes ${seconds(loadMs)}.`,
      note: `Slow: ${where(target)} takes ${seconds(loadMs)}${up}.`,
      fix: "agent",
      value: loadMs,
      ev: { usualMs: usual ?? undefined, limitMs: limit, ...(cause ? { eventAt: cause.at, eventLabel: cause.label } : {}) },
    })
  }
  const http = httpLine(probe.status, probe.statusText)
  const largest = files[0]
  return {
    at,
    ms,
    status: statusOf(findings),
    findings,
    metric: loadMs,
    http,
    files,
    facts: [
      ["Status", http],
      ["Loads in", seconds(loadMs)],
      ["Largest file", largest ? `${largest.name}, ${size(largest.bytes)}` : "None"],
    ],
  }
}

/** The row's line for an uptime watch. */
export function uptimeLine(latest: Run | undefined): string {
  if (!latest) return "Not checked yet."
  const problem = latest.findings.find((f) => f.level === "problem")
  if (problem) return problem.line ?? problem.detail ?? problem.headline
  if (latest.status === "failed") return latest.error ? `Couldn’t check. ${latest.error}.` : "Couldn’t check."
  return latest.metric !== undefined ? `Up. Loads in ${seconds(latest.metric)}.` : "Up."
}
