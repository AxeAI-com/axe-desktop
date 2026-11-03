import type { Finding, NotifyWhen, OpenFinding, PastFinding, Run, WatchState } from "./types"

// What a run changes: which findings open, which resolve, and whether to tell you now.
// A failed run (Axe couldn't check) changes nothing, until three in a row become a problem.

export const FAILED_LIMIT = 3
export const UNREACHABLE = "unreachable"
/** Past problems the thread keeps. */
const KEEP_PAST = 50

export type Applied = { state: WatchState; opened: OpenFinding[]; resolved: PastFinding[] }

/**
 * Folds one run into the watch's state. A problem resolves after `cleanRuns` runs that don't see it
 * (one for uptime, two for the rest). An open finding keeps the words it opened with.
 */
export function applyRun(prev: WatchState, run: Run, target: string, cleanRuns = 2): Applied {
  const at = run.at
  if (run.status === "failed") {
    const failedStreak = prev.failedStreak + 1
    const state: WatchState = { ...prev, failedStreak, lastAt: at, latest: run }
    if (failedStreak !== FAILED_LIMIT || prev.open.some((f) => f.key === UNREACHABLE)) return { state, opened: [], resolved: [] }
    const f: OpenFinding = { key: UNREACHABLE, level: "problem", headline: `Couldn’t reach ${target}`, detail: run.error, fix: "none", openedAt: at, lastSeenAt: at }
    return { state: { ...state, open: [...prev.open, f] }, opened: [f], resolved: [] }
  }
  const seen = new Map(run.findings.map((f) => [f.key, f]))
  // A site that's down can't be timed: a down run leaves its other findings as they were.
  const blind = seen.has("down")
  const open: OpenFinding[] = []
  const opened: OpenFinding[] = []
  const resolved: PastFinding[] = []
  for (const f of prev.open) {
    if (seen.has(f.key)) open.push({ ...f, lastSeenAt: at, clean: 0 })
    else if (blind) open.push(f)
    else if (f.level === "problem") {
      // A good run clears "unreachable" straight away; other problems wait for enough clean runs.
      const clean = (f.clean ?? 0) + 1
      if (f.key === UNREACHABLE || clean >= cleanRuns) resolved.push({ ...f, clean, closedAt: at, how: "cleared" })
      else open.push({ ...f, clean })
    }
  }
  for (const f of run.findings) {
    if (prev.open.some((o) => o.key === f.key)) continue
    const o: OpenFinding = { ...f, openedAt: at, lastSeenAt: at }
    if (f.level === "problem") open.push(o)
    opened.push(o)
  }
  const past = resolved.length ? [...(prev.past ?? []), ...resolved].slice(-KEEP_PAST) : prev.past
  return { state: { ...prev, open, failedStreak: 0, lastAt: at, latest: run, past }, opened, resolved }
}

/** Takes a finding you said is fine (or snoozed, or one that didn't happen) out of a run. */
export function withoutKeys(run: Run, keys: string[] | undefined): Run {
  if (!keys?.length || run.status === "failed") return run
  const findings = run.findings.filter((f) => !keys.includes(f.key))
  return findings.length === run.findings.length ? run : { ...run, findings, status: statusOf(findings) }
}

/** Whether to show a notification for what just opened. Expected findings and paused watches stay quiet. */
export function shouldNotify(w: { notify: NotifyWhen; paused?: boolean }, opened: OpenFinding[], now: number): boolean {
  if (w.notify !== "now" || w.paused) return false
  return opened.some((f) => !f.expected && !(f.snoozedUntil && f.snoozedUntil > now))
}

/** "Back up" goes out only for a problem that notified and then cleared by itself. */
export const backUp = (w: { notify: NotifyWhen; paused?: boolean }, resolved: PastFinding[]) =>
  w.notify === "now" && !w.paused ? resolved.filter((f) => f.notified && f.how === "cleared") : []

/** The problems that count: open, not expected, not snoozed, on a watch that isn't paused. */
export function liveProblems(w: { paused?: boolean; open: OpenFinding[] }, now: number): OpenFinding[] {
  if (w.paused) return []
  return w.open.filter((f) => f.level === "problem" && !f.expected && !(f.snoozedUntil && f.snoozedUntil > now))
}

/** The status a run reports from its findings (checks call this so they agree). */
export const statusOf = (findings: Finding[]): Run["status"] =>
  findings.some((f) => f.level === "problem") ? "problem" : findings.length ? "news" : "quiet"
