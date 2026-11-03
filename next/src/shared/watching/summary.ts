import { repoHeadline } from "./copy"
import { liveProblems, UNREACHABLE } from "./findings"
import type { News, OpenFinding, PastFinding, WatchView } from "./types"

// The morning summary: plain text from templates, no model. It covers problems that opened or cleared
// since the last summary, changes you haven't seen, and watches that couldn't run. Nothing to say: no summary.

/** Settings, Notifications: when the summary shows, or Off. */
export type SummaryAt = "7:00" | "8:00" | "9:00" | "off"
export const SUMMARY_AT: SummaryAt[] = ["7:00", "8:00", "9:00", "off"]
export const SUMMARY_DEFAULT: SummaryAt = "8:00"
export const SUMMARY_LABEL: Record<SummaryAt, string> = { "7:00": "7:00 am", "8:00": "8:00 am", "9:00": "9:00 am", off: "Off" }
export const SUMMARY_TITLE = "Good morning"
/** The card stays until you close it, or until noon. */
const NOON = 12
/** Before 6:00 counts as overnight. */
const NIGHT_ENDS = 6
const DAY = 86_400_000

export const isSummaryAt = (v: unknown): v is SummaryAt => typeof v === "string" && (SUMMARY_AT as string[]).includes(v)

type W = Pick<WatchView, "id" | "name" | "kind" | "target" | "every" | "paused" | "open" | "past" | "news" | "unread" | "latest">

export type SummaryItems = {
  /** One entry per watch with a problem that opened since the last summary. */
  problems: { w: W; found: OpenFinding[]; at: number }[]
  news: { w: W; n: News }[]
  cleared: { w: W; p: PastFinding }[]
  failed: { w: W; error?: string }[]
}

/** What happened since `since`. Paused watches stay out of it. */
export function summaryItems(watches: W[], since: number, now: number): SummaryItems {
  const out: SummaryItems = { problems: [], news: [], cleared: [], failed: [] }
  for (const w of watches) {
    if (w.paused) continue
    const found = liveProblems(w, now).filter((f) => f.openedAt > since)
    if (found.length) out.problems.push({ w, found, at: Math.min(...found.map((f) => f.openedAt)) })
    const n = w.unread ? w.news.findLast((x) => !x.ignored && x.at > since) : undefined
    if (n) out.news.push({ w, n })
    const openKeys = new Set(w.open.map((f) => f.key))
    const p = w.past.findLast((x) => x.closedAt > since && x.how !== "expected" && x.level === "problem" && !openKeys.has(x.key))
    if (p) out.cleared.push({ w, p })
    const reached = w.open.some((f) => f.key === UNREACHABLE)
    if (!reached && w.latest?.status === "failed" && w.latest.at > since) out.failed.push({ w, error: w.latest.error })
  }
  out.problems.sort((a, b) => a.at - b.at)
  out.news.sort((a, b) => a.n.at - b.n.at)
  return out
}

export const summaryEmpty = (s: SummaryItems) => !s.problems.length && !s.news.length && !s.cleared.length && !s.failed.length

/** "3:12 am". */
export const clock = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()
/** "7:30", for "At 7:30, …". */
const clockShort = (t: number) => clock(t).replace(/\s?[ap]m$/, "")

const stop = (s: string) => s.trim().replace(/[.!?]+$/, "")
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** "Anyone can send email…" → "anyone can send email…"; names and "TLS" stay as they are. */
const lower = (s: string) => (/^[A-Z][a-z’']*\b/.test(s) && !/^[A-Z][a-z]*[A-Z]/.test(s) && !/^[A-Z][a-z’']*\s+[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
const count = (n: number) => WORDS[n] ?? String(n)

/** "A", "A and B", "A, B and C". */
const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

/** A page watch in a sentence: "the pricing page", or the address itself for a home page. */
function pageNoun(w: W): string {
  if (w.name !== w.target) return w.name
  const path = w.target.replace(/^https?:\/\//, "").split(/[?#]/)[0]!.split("/").filter(Boolean)
  const last = path.length > 1 ? path.at(-1)!.replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ") : ""
  return last ? `the ${last.toLowerCase()} page` : w.target
}

/** A watch's problems as a clause: "lane-ceramics.com is slow", "2 new security alerts in shop-web". */
function problemClause(w: W, found: OpenFinding[]): string {
  if (w.kind === "repo" && found.length > 1) return repoHeadline(found.length, w.name)
  const f = found[0]!
  if (f.key === UNREACHABLE) return `Axe couldn’t reach ${w.target}`
  return lower(stop(f.headline))
}

/** A product's name in a sentence: "Stoneware clay, 25 lb" → "Stoneware clay". */
const short = (name: string) => name.split(",")[0]!.trim() || name

/** A change as a clause. `past`: "went down to $42" (overnight); else "is down to $42". */
function newsClause(w: W, n: News, past = false): string {
  if (w.kind === "page") return `${pageNoun(w)} changed`
  if (w.kind === "price") {
    const h = stop(n.headline)
    const m = /^(Down|Up) to (.+)$/.exec(h)
    const name = short(w.name)
    if (m) return `${name} ${past ? `went ${m[1]!.toLowerCase()}` : `is ${m[1]!.toLowerCase()}`} to ${m[2]}`
    if (h === "Out of stock") return `${name} ${past ? "sold out" : "is out of stock"}`
    if (h === "Back in stock") return `${name} ${past ? "came back in stock" : "is back in stock"}`
    return `${name}: ${lower(h)}`
  }
  return lower(stop(n.headline))
}

/** "from 3:05 to 3:19 am": the first time drops its am or pm when both share it. */
function fromTo(a: number, b: number): string {
  const x = clock(a)
  const y = clock(b)
  return `from ${x.slice(-2) === y.slice(-2) ? x.slice(0, -3) : x} to ${y}`
}

function clearedSentence(w: W, p: PastFinding, since: number): string {
  const span = p.openedAt > since ? ` ${fromTo(p.openedAt, p.closedAt)}` : ""
  if (p.key === "down") return `${w.name} was down${span}, and is back up.`
  if (p.key.startsWith("slow")) return `${w.name} was slow${span}, and is back to normal.`
  if (p.how === "fixed") return `${cap(lower(stop(p.past ?? p.headline)))}. It’s fixed now.`
  return `${cap(lower(stop(p.past ?? p.headline)))}${span ? `,${span}` : ""}. It’s cleared now.`
}

const failedSentence = (w: W, error?: string) => `${w.name} couldn’t run${error ? `: ${lower(stop(error))}` : ""}.`

/** The sentences after problems and news: what cleared and what couldn't run, two of each at most. */
function tail(s: SummaryItems, since: number): string[] {
  const out = s.cleared.slice(0, 2).map(({ w, p }) => clearedSentence(w, p, since))
  if (s.cleared.length > 2) out.push(`${cap(count(s.cleared.length - 2))} more cleared.`)
  out.push(...s.failed.slice(0, 2).map(({ w, error }) => failedSentence(w, error)))
  if (s.failed.length > 2) out.push(`${cap(count(s.failed.length - 2))} more couldn’t run.`)
  return out
}

/** The night before the summary's morning: anything before 6:00 on its day. */
function night(t: number, now: number) {
  const six = new Date(now)
  six.setHours(NIGHT_ENDS, 0, 0, 0)
  return t < six.getTime()
}

/**
 * The notification's body: "2 problems: lane-ceramics.com is slow, and anyone can send email as
 * lane-ceramics.com. Stoneware clay is down to $42." At most two problems by name, then "and 3 more".
 */
export function summaryNote(s: SummaryItems, since: number, now: number): string | null {
  if (summaryEmpty(s)) return null
  const parts: string[] = []
  const n = s.problems.length
  if (n) {
    const names = s.problems.slice(0, 2).map((p) => problemClause(p.w, p.found))
    const list = n === 1 ? names[0] : n === 2 ? `${names[0]}, and ${names[1]}` : `${names[0]}, ${names[1]} and ${n - 2} more`
    const overnight = s.problems.every((p) => night(p.at, now))
    parts.push(`${n} ${n === 1 ? "problem" : "problems"}${overnight ? " overnight" : ""}: ${list}.`)
  }
  if (s.news.length) {
    const xs = s.news.map(({ w, n: x }) => newsClause(w, x))
    const list = xs.length === 1 ? xs[0]! : xs.length === 2 ? `${xs[0]}, and ${xs[1]}` : `${xs[0]}, ${xs[1]} and ${count(xs.length - 2)} more changes`
    parts.push(`${cap(list)}.`)
  }
  parts.push(...tail(s, since))
  return parts.join(" ")
}

/**
 * The card on top of Watching, in the order things happened: "Overnight, lane-ceramics.com got slow at
 * 3:12 am and the pricing page changed. At 7:30, the security check found one thing to fix. Stoneware
 * clay is down to $42."
 */
export function summaryCard(s: SummaryItems, since: number, now: number): string | null {
  if (summaryEmpty(s)) return null
  const happened = (w: W, found: OpenFinding[], at: number) => {
    const f = found[0]!
    if (f.key === "down") return `${w.name} went down at ${clock(at)}`
    if (f.key.startsWith("slow")) return `${w.name} got slow at ${clock(at)}`
    return `${problemClause(w, found)}, at ${clock(at)}`
  }
  const events = [
    ...s.problems.map((p) => ({ at: p.at, night: night(p.at, now), morning: p.w.every === "morning", text: happened(p.w, p.found, p.at), p })),
    ...s.news.map((x) => ({ at: x.n.at, night: night(x.n.at, now), morning: false, text: newsClause(x.w, x.n, true), p: undefined })),
  ].sort((a, b) => a.at - b.at)
  const out: string[] = []
  const atNight = events.filter((e) => e.night && !e.morning)
  if (atNight.length) out.push(`Overnight, ${and(atNight.map((e) => e.text))}.`)
  // Morning checks (security, repo) say what they found, by the time they ran.
  const morning = events.filter((e) => e.morning && e.p)
  const kinds = morning.map((e) => e.p!.w.kind)
  for (const e of morning) {
    const w = e.p!.w
    const noun = kinds.filter((k) => k === w.kind).length > 1 ? `${w.name}` : w.kind === "security" ? "security" : w.kind === "repo" ? "repo" : w.name
    const things = e.p!.found.length
    out.push(`At ${clockShort(e.at)}, the ${noun} check found ${count(things)} ${things === 1 ? "thing" : "things"} to fix.`)
  }
  const day = events.filter((e) => !e.night && !e.morning)
  const dayProblems = day.filter((e) => e.p)
  if (dayProblems.length) out.push(`${cap(and(dayProblems.map((e) => e.text)))}.`)
  const dayNews = s.news.filter((x) => !night(x.n.at, now))
  if (dayNews.length) out.push(`${cap(and(dayNews.map((x) => newsClause(x.w, x.n))))}.`)
  out.push(...tail(s, since))
  return out.join(" ")
}

/** "Nothing new since 8:00 am." for /summary when there's nothing to say. */
export const nothingSince = (since: number, now: number) => `Nothing new since ${now - since < DAY && new Date(since).getDate() === new Date(now).getDate() ? clock(since) : new Date(since).toLocaleDateString("en-US", { weekday: "long" })}.`

/** Today's summary time, or null when it's Off. */
export function summaryTime(at: SummaryAt, now: number): number | null {
  if (at === "off") return null
  const [h, m] = at.split(":").map(Number)
  const d = new Date(now)
  d.setHours(h!, m!, 0, 0)
  return d.getTime()
}

/** Noon on the summary's day: the card goes then. */
export function noonOf(t: number): number {
  const d = new Date(t)
  d.setHours(NOON, 0, 0, 0)
  return d.getTime()
}

/** Whether today's summary is due: past its time, before noon, and not shown yet today. */
export function summaryDue(at: SummaryAt, now: number, lastAt: number | undefined): boolean {
  const t = summaryTime(at, now)
  if (t === null || now < t || now >= noonOf(now)) return false
  return !lastAt || lastAt < t
}
