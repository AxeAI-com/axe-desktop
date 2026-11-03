import type { OpenFinding, PastFinding, Run, Watch } from "@shared/watching/types"
import { SUMMARY_TITLE } from "@shared/watching/summary"
import { seconds } from "@shared/watching/uptime"

import type { Notice } from "../notify"

// A watch's notices. The title is the watch's name and the body is one line. Clicking opens the watch
// (`watch:<id>`). A problem offers "Fix with …" (when an agent can fix it) and "Snooze 1 hour"; news
// is silent and has no actions. Repeats share the watch's id, so they stack under one watch.

export function watchNotice(w: Pick<Watch, "id" | "name"> & { kind?: Watch["kind"] }, opened: OpenFinding[], fixLabel?: string): Notice | null {
  const f = opened.find((o) => o.level === "problem") ?? opened[0]
  if (!f) return null
  const problem = f.level === "problem"
  // A repo's new alerts are one notice: "2 new security alerts."
  const alerts = w.kind === "repo" ? opened.filter((o) => o.level === "problem").length : 0
  const body = alerts > 1 ? `${alerts} new security alerts.` : (f.note ?? f.line ?? f.detail ?? f.headline)
  return {
    threadId: `watch:${w.id}`,
    kind: "needs",
    title: w.name,
    body,
    findingId: f.key,
    silent: !problem,
    actions: problem ? [...(f.fix === "agent" && fixLabel ? [{ id: "fix" as const, text: fixLabel }] : []), { id: "snooze1h" as const, text: "Snooze 1 hour" }] : [],
  }
}

/** "Back up after 14 min." for a problem that notified and then cleared by itself. */
export function backUpNotice(w: Pick<Watch, "id" | "name">, resolved: PastFinding[], latest: Run): Notice | null {
  const f = resolved[0]
  if (!f) return null
  const mins = Math.max(1, Math.round((f.closedAt - f.openedAt) / 60_000))
  const span = mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`
  const body = f.key === "down" ? `Back up after ${span}.` : f.key === "tests:failing" ? "The tests pass again." : f.key === "slow" && latest.metric ? `Back to normal. Loads in ${seconds(latest.metric)}.` : `${f.headline.replace(/\.$/, "")} cleared.`
  return { threadId: `watch:${w.id}`, kind: "done", title: w.name, body, silent: true, actions: [] }
}

/** Clicking the morning summary opens Watching with the card on top. */
export const SUMMARY_THREAD = "watching:summary"

/** "Good morning": the summary's notification. It makes a sound only when it names a problem. */
export const summaryNotice = (body: string, problems: boolean): Notice => ({ threadId: SUMMARY_THREAD, kind: "done", title: SUMMARY_TITLE, body, silent: !problems, actions: [] })
