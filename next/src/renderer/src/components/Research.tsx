import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useState } from "react"

import type { Part, ResearchData } from "@shared/types"

import { invoke } from "@/lib/bridge"
import { linkNumbered, siteOf } from "@/lib/citations"
import { useMotion } from "@/lib/motion"
import { parseReport, progressFraction, progressRows, runSeconds, runSummary, type ProgressRow } from "@/lib/research"
import { formatSeconds } from "@/lib/steps"
import { approveResearch, cancelResearch, useStore } from "@/lib/store"
import { credits } from "@/lib/usage"

import { CheckIcon, ChevronDown, TelescopeIcon, XIcon } from "./Icons"
import { Markdown } from "./Markdown"

type ApprovalPart = Extract<Part, { type: "researchApproval" }>

/** Seconds since the run started, ticking while it runs. */
function useElapsed(d: ResearchData) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (d.status !== "running") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [d.status])
  return runSeconds(d, now)
}

/** What the run is doing: a bar and a checklist that fills in, like the board's research card. */
export function ResearchProgress({ data, question }: { data: ResearchData; question?: string }) {
  const m = useMotion()
  const seconds = useElapsed(data)
  const rows = progressRows(data)
  const [open, setOpen] = useState(false)
  const running = data.status === "running"

  if (!running)
    return (
      <div className="flex flex-col">
        <button
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-6 w-fit items-center gap-2 rounded-[6px] border-0 bg-transparent px-1 text-[13px] text-ink-3 transition-colors duration-150 hover:text-ink-2"
        >
          <TelescopeIcon size={14} />
          {data.status === "failed" ? "Research stopped" : `Researched for ${formatSeconds(seconds)}`}
          <span className="text-ink-4">{runSummary(data)}</span>
          <motion.span animate={{ rotate: open ? 0 : -90 }} transition={m.t(0.12)} className="flex">
            <ChevronDown size={11} />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div {...m.collapse} className="overflow-hidden">
              <Rows rows={rows} className="pt-2 pl-1" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )

  return (
    <motion.section {...m.rise} aria-label="Research in progress" className="flex flex-col gap-2.5 rounded-[16px] bg-card shadow-card px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="dots small" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[15px]">
          Researching
          {question && <span className="min-w-0 truncate text-[13px] text-ink-3">{short(question)}</span>}
        </span>
        <span className="text-[12px] text-ink-3 tabular-nums">{formatSeconds(seconds)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-fill-2" role="progressbar" aria-valuenow={Math.round(progressFraction(data) * 100)}>
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={false}
          animate={{ width: `${Math.round(progressFraction(data) * 100)}%` }}
          transition={m.t(0.32)}
        />
      </div>
      <Rows rows={rows} />
    </motion.section>
  )
}

const short = (q: string) => {
  const t = q.trim().replace(/\s+/g, " ")
  return t.length > 90 ? `${t.slice(0, 88).trim()}…` : t
}

function Rows({ rows, className = "" }: { rows: ProgressRow[]; className?: string }) {
  const m = useMotion()
  return (
    <ul className={`m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-5 ${className}`}>
      <AnimatePresence initial={false}>
        {rows.map((r) => (
          <motion.li key={r.id} layout="position" {...m.rise} transition={m.t()} className="flex items-start gap-2">
            <Mark state={r.state} />
            <span className={`min-w-0 flex-1 ${r.state === "waiting" ? "text-ink-3" : r.state === "running" ? "text-ink" : "text-ink-2"}`}>
              {r.label}
              {r.detail && <span className="ml-1.5 text-ink-3">{r.detail}</span>}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

function Mark({ state }: { state: ProgressRow["state"] }) {
  if (state === "done") return <CheckIcon size={13} strokeWidth={1.8} className="mt-[3px] shrink-0 text-ok" />
  if (state === "failed") return <XIcon size={13} className="mt-[3px] shrink-0 text-ink-3" />
  return (
    <span
      aria-hidden="true"
      className={`mt-[5px] ml-[2px] h-[9px] w-[9px] shrink-0 rounded-full border-[1.5px] ${state === "running" ? "border-accent" : "border-ink-4"}`}
    />
  )
}

/** The report as it builds: title, summary, sections rising in one by one, then the numbered sources. */
export function ResearchReport({ text, data, streaming }: { text: string; data: ResearchData; streaming: boolean }) {
  const m = useMotion()
  const report = useMemo(() => parseReport(text), [text])
  const sources = useMemo(() => [...data.sources].sort((a, b) => a.n - b.n), [data.sources])
  const cites = useMemo(() => sources.map((s) => ({ id: String(s.n), url: s.url, title: s.title })), [sources])
  const [rise] = useState(streaming)
  const linked = (body: string) => linkNumbered(body, sources)

  if (!text.trim()) return null
  return (
    <motion.article {...(rise ? m.rise : {})} aria-label="Research report" className="flex flex-col overflow-hidden rounded-[16px] bg-card shadow-card">
      <header className="flex flex-col gap-2 px-5 pt-[18px] pb-1">
        <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <TelescopeIcon size={12} />
          Research report
        </span>
        <h1 className="m-0 text-[20px] leading-7 tracking-[-0.005em]">{report.title}</h1>
      </header>
      <div className="flex flex-col gap-4 pt-2 pb-4">
        {report.summary && (
          <div className="pl-4">
            <Markdown text={linked(report.summary)} streaming={streaming && !report.sections.length} sources={cites} />
          </div>
        )}
        <AnimatePresence initial={false}>
          {report.sections.map((s, i) => (
            <motion.section key={s.id} {...(rise ? m.rise : {})} className="flex flex-col gap-2 border-t border-border pt-4">
              <h2 className="m-0 px-5 text-[15px] leading-6">{s.title}</h2>
              {s.body && (
                <div className="pl-4">
                  <Markdown text={linked(s.body)} streaming={streaming && i === report.sections.length - 1} sources={cites} />
                </div>
              )}
            </motion.section>
          ))}
        </AnimatePresence>
      </div>
      {!!sources.length && <SourceList sources={sources} />}
    </motion.article>
  )
}

function SourceList({ sources }: { sources: ResearchData["sources"] }) {
  const [all, setAll] = useState(false)
  const shown = all ? sources : sources.slice(0, 6)
  return (
    <footer className="border-t border-border bg-fill px-5 pt-3 pb-3.5">
      <div className="mb-2 text-[12px] text-ink-3">Sources</div>
      <ol className="m-0 grid list-none grid-cols-2 gap-x-5 gap-y-1.5 p-0">
        {shown.map((s) => (
          <li key={s.n} className="flex min-w-0 items-baseline gap-2 text-[13px] leading-5">
            <span className="w-4 shrink-0 text-right text-[12px] text-ink-3 tabular-nums">{s.n}</span>
            <a
              href={s.url}
              onClick={(e) => {
                e.preventDefault()
                void invoke("app:openExternal", s.url)
              }}
              title={s.url}
              className="min-w-0 truncate text-ink-2 no-underline hover:text-ink"
            >
              {s.title}
              <span className="ml-1.5 text-ink-3">{s.site || siteOf(s.url)}</span>
            </a>
          </li>
        ))}
      </ol>
      {sources.length > 6 && (
        <button onClick={() => setAll((a) => !a)} className="mt-2 border-0 bg-transparent p-0 text-[12px] text-accent-2 hover:underline">
          {all ? "Show fewer" : `Show all ${sources.length}`}
        </button>
      )}
    </footer>
  )
}

/** A paid model asks before a run spends credits. */
export function ResearchApprovalCard({ threadId, messageId, part, canAct }: { threadId: string; messageId: string; part: ApprovalPart; canAct: boolean }) {
  const m = useMotion()
  const label = useStore((s) => s.catalog?.axe.models.find((x) => x.id === part.data.modelId)?.label ?? "This model")
  const [busy, setBusy] = useState(false)
  if (part.data.status === "cancelled" || !canAct)
    return (
      <p className="m-0 px-1 text-[13px] text-ink-3">{part.data.status === "cancelled" ? "Research cancelled. Nothing was charged." : "Research wasn't run."}</p>
    )
  return (
    <motion.section {...m.rise} aria-label="Run research?" className="flex flex-col gap-3 rounded-[16px] bg-card shadow-card p-4">
      <div className="flex items-center gap-2 text-[15px]">
        <TelescopeIcon size={15} className="text-ink-3" />
        Research with {label}?
      </div>
      <p className="m-0 text-[13px] leading-[21px] text-ink-2">
        It searches the web up to {part.data.searches} times, reads up to {part.data.pages} pages and writes a report with sources. About{" "}
        {credits(part.data.estimate)} credits, charged for what it uses.
      </p>
      <div className="flex gap-2">
        <motion.button
          {...m.lift}
          transition={m.t(0.12)}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void approveResearch(threadId, messageId).catch(() => setBusy(false))
          }}
          className="h-[34px] rounded-full border-0 bg-button px-3.5 text-[13px] text-button-ink"
        >
          Run research
        </motion.button>
        <button
          onClick={() => void cancelResearch(threadId, messageId)}
          className="h-[34px] rounded-[6px] border-0 bg-transparent px-2 text-[13px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </motion.section>
  )
}
