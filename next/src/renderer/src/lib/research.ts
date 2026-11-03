import type { ResearchData, ResearchStep } from "@shared/types"

// A research run's report and progress, shaped for the window. The report is the
// reply's text: "# Title", a summary, then one section per "## " heading (the same
// split axe-web's research/parse.ts makes). Works on partial text while it streams.

export type Report = { title: string; summary: string; sections: { id: string; title: string; body: string }[] }

const strip = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").trim()

export function parseReport(text: string): Report {
  const clean = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim()
  let title = ""
  const head: string[] = []
  const sections: Report["sections"] = []
  for (const line of clean.split("\n")) {
    const h1 = /^#\s+(.+)$/.exec(line)
    const h2 = /^##\s+(.+)$/.exec(line)
    if (h1 && !title && !sections.length) title = strip(h1[1] ?? "")
    else if (h2) sections.push({ id: `s${sections.length}`, title: strip(h2[1] ?? ""), body: "" })
    else {
      const current = sections[sections.length - 1]
      if (current) current.body += `${line}\n`
      else head.push(line)
    }
  }
  return { title: title || "Research report", summary: head.join("\n").trim(), sections: sections.map((s) => ({ ...s, body: s.body.trim() })) }
}

/** The rows the live card shows: the plan, each search, the reads as one row, then writing. */
export type ProgressRow = { id: string; label: string; detail?: string; state: "done" | "running" | "waiting" | "failed" }

const quoted = (s?: string) => (s ? `“${s}”` : "")
const stateOf = (s?: ResearchStep): ProgressRow["state"] =>
  !s ? "waiting" : s.status === "running" ? "running" : s.status === "failed" ? "failed" : "done"

export function progressRows(d: ResearchData): ProgressRow[] {
  const plan = d.steps.find((s) => s.kind === "plan")
  const searches = d.steps.filter((s) => s.kind === "search")
  const reads = d.steps.filter((s) => s.kind === "read")
  const write = d.steps.find((s) => s.kind === "write")
  const readDone = reads.filter((s) => s.status === "complete").length
  const reading = reads.some((s) => s.status === "running")
  const rows: ProgressRow[] = [
    {
      id: "plan",
      label: !plan || plan.status === "running" ? "Working out what to search" : `Planned ${searches.length || d.queries.length} searches`,
      state: plan ? stateOf(plan) : "running",
    },
    ...searches.map((s) => ({
      id: s.id,
      label: `${s.status === "running" ? "Searching for" : "Searched for"} ${quoted(s.target)}`,
      ...(s.detail ? { detail: s.detail } : {}),
      state: stateOf(s),
    })),
    {
      id: "read",
      label: !reads.length ? "Read the best pages" : reading ? `Reading ${reads.length} pages` : `Read ${readDone} of ${reads.length} pages`,
      ...(reads.length ? { detail: [...new Set(reads.map((s) => s.target).filter(Boolean))].join(", ") } : {}),
      state: !reads.length ? "waiting" : reading ? "running" : readDone ? "done" : "failed",
    },
    { id: "write", label: write?.status === "complete" ? "Wrote the report" : "Write the report with sources", state: stateOf(write) },
  ]
  return rows
}

/** How far along the run is, 0 to 1, for the bar. Each step counts once it finishes. */
export function progressFraction(d: ResearchData): number {
  if (d.status !== "running") return 1
  const rows = progressRows(d)
  const done = rows.filter((r) => r.state === "done" || r.state === "failed").length
  const running = rows.filter((r) => r.state === "running").length
  return Math.min(0.97, (done + running * 0.4) / rows.length)
}

/** "5 searches, 6 pages read" for the folded line once it's done. */
export function runSummary(d: ResearchData): string {
  const searches = d.steps.filter((s) => s.kind === "search").length
  const read = d.steps.filter((s) => s.kind === "read" && s.status === "complete").length
  const parts = [`${searches} ${searches === 1 ? "search" : "searches"}`, `${read} ${read === 1 ? "page" : "pages"} read`]
  return parts.join(", ")
}

/** Seconds the run took, or has taken so far. */
export const runSeconds = (d: ResearchData, now = Date.now()) => Math.max(0, Math.round(((d.endedAt ?? now) - d.startedAt) / 1000))
