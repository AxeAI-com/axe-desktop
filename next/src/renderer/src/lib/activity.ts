import { repoHeadline } from "@shared/watching/copy"
import type { FixTurn, OpenFinding, PastFinding, WatchView } from "@shared/watching/types"

// A check's Activity timeline: incidents, changes it noticed, your changes to it, and fixes, one line each.
// Pure: built only from what the check already keeps. When a number isn't known the line says less, never a guess.

export type ActivityEntry = {
  id: string
  /** When it happened: sorts the list and picks its day. */
  at: number
  kind: "incident" | "change" | "fix"
  text: string
  /** Incidents: open, resolved (cleared by itself), fixed, or marked as expected. */
  state?: "open" | "resolved" | "fixed" | "expected"
  /** Fixes: the agent's name and its chat. */
  agent?: string
  threadId?: string
  /** A fix still in progress. */
  running?: boolean
}

export type ActivityGroup = { label: string; entries: ActivityEntry[] }

export type ActivityInput = Pick<WatchView, "kind" | "name" | "open" | "past" | "news" | "said" | "strip" | "fixes">

const MIN = 60_000
const stop = (t: string) => t.trim().replace(/[.!?]+$/, "")
const time = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()
const dayStart = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** "under a minute", "4 min", "2 h", "1 h 5 min", "3 days". */
export function duration(ms: number): string {
  const m = Math.round(ms / MIN)
  if (m < 1) return "under a minute"
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? "1 day" : `${d} days`
}

/** "9:40 to 9:44 am", "11:50 am to 12:10 pm"; nothing when it crosses midnight. */
function range(a: number, b: number): string | undefined {
  if (dayStart(a) !== dayStart(b)) return undefined
  const x = time(a)
  const y = time(b)
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} to ${y}` : `${x} to ${y}`
}

/** "Today", "Yesterday", "Nov 6", "Nov 6, 2025". */
export function dayLabel(t: number, now: number): string {
  const d = dayStart(t)
  const today = dayStart(now)
  if (d === today) return "Today"
  if (d === dayStart(today - 12 * 60 * MIN)) return "Yesterday"
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear()
  return new Date(t).toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" })
}

/**
 * When a closed problem really ended: the first run after it was last seen that didn't find it. Most kinds
 * close only after two clean runs, so `closedAt` is later than the end.
 */
function endOf(f: PastFinding, strip: ActivityInput["strip"]): number {
  const next = strip.find((t) => t.at > f.lastSeenAt && t.status !== "problem")
  return next && next.at <= f.closedAt ? next.at : f.closedAt
}

const uptimeWord = (key: string) => (key === "down" ? "Down" : key === "slow" ? "Slow" : undefined)

function openIncident(f: OpenFinding, now: number): string {
  const word = uptimeWord(f.key)
  if (word) return `${word} since ${dayStart(f.openedAt) === dayStart(now) ? time(f.openedAt) : dayLabel(f.openedAt, now)}`
  return stop(f.headline)
}

function pastIncident(f: PastFinding, strip: ActivityInput["strip"]): string {
  const word = uptimeWord(f.key)
  if (!word) return stop(f.past ?? f.headline)
  // Marked as expected: it didn't end, you said it's fine.
  if (f.how === "expected") return word
  const end = endOf(f, strip)
  const r = range(f.openedAt, end)
  return `${word} for ${duration(end - f.openedAt)}${r ? `, ${r}` : ""}`
}

const STATE: Record<PastFinding["how"], ActivityEntry["state"]> = { cleared: "resolved", fixed: "fixed", expected: "expected" }

function incidents(w: ActivityInput, now: number): ActivityEntry[] {
  const out: ActivityEntry[] = []
  const problems = (fs: OpenFinding[]) => fs.filter((f) => f.level === "problem")
  // A repo's alerts that opened together (or closed together) read as one line, as its card shows them.
  const open = problems(w.open)
  const openGroups = new Map<string, OpenFinding[]>()
  for (const f of open) {
    const g = w.kind === "repo" ? `${f.openedAt}` : f.key
    openGroups.set(g, [...(openGroups.get(g) ?? []), f])
  }
  for (const fs of openGroups.values()) {
    const f = fs[0]!
    const text = fs.length > 1 ? repoHeadline(fs.length, w.name) : openIncident(f, now)
    out.push({ id: `open:${f.key}:${f.openedAt}`, at: f.openedAt, kind: "incident", text, state: f.expected ? "expected" : "open" })
  }
  const pastGroups = new Map<string, PastFinding[]>()
  for (const f of w.past.filter((x) => x.level === "problem")) {
    const g = w.kind === "repo" ? `${f.how}:${f.closedAt}` : `${f.how}:${f.key}:${f.openedAt}`
    pastGroups.set(g, [...(pastGroups.get(g) ?? []), f])
  }
  for (const fs of pastGroups.values()) {
    const f = fs[0]!
    const text = fs.length > 1 ? `${fs.length} security alerts in ${w.name}` : pastIncident(f, w.strip)
    out.push({ id: `past:${f.how}:${f.key}:${f.openedAt}`, at: f.openedAt, kind: "incident", text, state: STATE[f.how] })
  }
  return out
}

function changes(w: ActivityInput): ActivityEntry[] {
  return w.news
    .filter((n) => !n.ignored)
    .map((n) => {
      let text = stop(n.headline)
      // A price's "Down to $42" next to "Down for 4 min" needs its noun.
      if (w.kind === "price" && /^(Down|Up) to /.test(text)) text = `Price ${text[0]!.toLowerCase()}${text.slice(1)}`
      return { id: `news:${n.at}`, at: n.at, kind: "change" as const, text }
    })
}

/** What a reply changed, from the settings Undo would put back. */
const PATCH_WORDS: Record<string, string> = {
  every: "how often it checks",
  notify: "when it tells you",
  ignore: "what it ignores",
  target: "what it checks",
  name: "its name",
  condition: "what it looks for",
  limit: "its limit",
  fixedMs: "its limit",
  answerer: "who answers",
  folder: "its folder",
  paused: "whether it runs",
  snoozedUntil: "its snooze",
}

function edits(w: ActivityInput): ActivityEntry[] {
  return w.said
    .filter((s) => s.undo && !s.undone && s.you)
    .map((s) => {
      const what = [...new Set(Object.keys(s.undo!).map((k) => PATCH_WORDS[k] ?? "its settings"))]
      const list = what.length <= 2 ? what.join(" and ") : `${what.slice(0, -1).join(", ")} and ${what.at(-1)}`
      return { id: `said:${s.at}`, at: s.at, kind: "change" as const, text: `You changed ${list || "this check"}` }
    })
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "updated 4 packages" when every finding it fixed was a package alert; else "changed 3 files"; else nothing. */
function fixWhat(w: ActivityInput, t: FixTurn): string | undefined {
  const found = [...w.open, ...w.past].filter((f) => t.keys.includes(f.key))
  const packages = new Set(found.filter((f) => f.ev?.alert?.source === "package").map((f) => f.ev!.alert!.name))
  if (packages.size && packages.size === new Set(t.keys).size) return `updated ${plural(packages.size, "package", "packages")}`
  if (t.files) return `changed ${plural(t.files, "file", "files")}`
  return undefined
}

function fixes(w: ActivityInput): ActivityEntry[] {
  return w.fixes.map((t) => {
    const what = fixWhat(w, t)
    const base = { id: `fix:${t.at}`, kind: "fix" as const, agent: t.agent, threadId: t.threadId }
    if (t.state === "asking") return { ...base, at: t.at, text: "Fix waiting for a folder", running: true }
    if (t.state === "working") return { ...base, at: t.at, text: "Fix started", running: true }
    const at = t.checkedAt ?? t.endedAt ?? t.at
    if (t.state === "undone") return { ...base, at, text: `${t.agent}’s changes undone` }
    if (t.result === "fixed") return { ...base, at, text: `${t.agent} fixed it${what ? `: ${what}` : ""}` }
    if (t.result === "still") return { ...base, at, text: `${t.agent}’s fix didn’t clear it` }
    return { ...base, at, text: what ? `${t.agent} ${what}` : `${t.agent} finished a fix` }
  })
}

/**
 * The timeline, newest first: open incidents on top (under "Open"), then everything else by day,
 * "Today", "Yesterday", "Nov 6".
 */
export function activity(w: ActivityInput, now = Date.now()): ActivityGroup[] {
  const all = [...incidents(w, now), ...changes(w), ...edits(w), ...fixes(w)].sort((a, b) => b.at - a.at)
  const open = all.filter((e) => e.state === "open")
  const groups: ActivityGroup[] = open.length ? [{ label: "Open", entries: open }] : []
  for (const e of all) {
    if (e.state === "open") continue
    const label = dayLabel(e.at, now)
    const last = groups.at(-1)
    if (last && last.label === label && last.label !== "Open") last.entries.push(e)
    else groups.push({ label, entries: [e] })
  }
  return groups
}
