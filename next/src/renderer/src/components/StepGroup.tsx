import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState, type ReactNode } from "react"

import { diffLines } from "@/lib/diff"
import { useMotion } from "@/lib/motion"
import { groupPhrase, groupRuns, stepLabel, toolStep } from "@/lib/step-label"
import { formatSeconds, isShellCommand, liveLabel, siteOf, summarize, type StepPart, type ToolPart } from "@/lib/steps"

import { ChevronRightMark } from "./ai/board-icons"
import { Citations } from "./ai/citations"
import { Favicon } from "./Favicon"
import { PageIcon, WebMark } from "./BoardIcons"
import { XIcon } from "./SolarIcons"

/** Waiting: the same 12 px spinner as a working step (the three bouncing dots were removed on 2026-11-08). */
export function Dots() {
  return <Spinner />
}

/** Seconds since the reply started, ticking once a second. */
function useSeconds(startedAt: number | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || !startedAt) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running, startedAt])
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null
}

/** The one thing that moves while a reply works: a 12 px ring, still under Reduce Motion. */
export function Spinner() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" stroke="var(--fill-3)" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** The live line: "Searching the code…" by a small spinner; the seconds only once it has taken a while. */
function LiveLine({ label, seconds, site }: { label: string; seconds: number | null; site?: string | null }) {
  return (
    // min-w-0: a long label truncates inside the column instead of pushing the seconds out of it.
    <div role="status" className="flex h-6 min-w-0 items-center gap-[8px] px-1 text-[13px] leading-[18px] text-ink-3">
      <span className="flex w-3.5 shrink-0 justify-center">{site ? <Favicon key={site} domain={site} size={12} /> : <Spinner />}</span>
      <span className="min-w-0 truncate">{label === "Thinking" ? label : `${label}…`}</span>
      {seconds !== null && seconds >= 10 && <span className="shrink-0 text-[12px] tabular-nums text-ink-4">{formatSeconds(seconds)}</span>}
    </div>
  )
}

type Step = Exclude<StepPart, { type: "source" }>

/**
 * Everything a reply did before its words, folded into one quiet 13 px line ("Read 2 files, ran the
 * tests"). While it works, the one step in progress shows as a live line under it ("Reading store.ts…").
 * Open, each step is one plain-English row; a row opens to the raw command, path or output in small
 * monospace. No cards, no boxes; the reply stays the hero.
 */
export function StepGroup({
  parts,
  live,
  startedAt,
  waiting,
  defaultOpen = false,
  cwd,
  compact,
  asked,
}: {
  /** An agent chat's folder: paths in it show relative to it, as Claude's app does. */
  cwd?: string
  parts: StepPart[]
  live: boolean
  startedAt?: number
  /** A permission request is waiting on you. */
  waiting?: boolean
  /** An agent chat waiting on you: every step shows as a plain row, nothing folded. */
  compact?: boolean
  /** Steps a permission card is asking about: the card stands in for their rows. */
  asked?: string[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const m = useMotion()
  const seconds = useSeconds(startedAt, live)
  // One finished file read: one plain line naming the file.
  const only = !live && parts.length === 1 && parts[0]!.type === "tool" && parts[0]!.kind === "read" && parts[0]!.state === "done" ? toolStep(parts[0]!).done : undefined
  const label = live ? (waiting ? "Waiting for you" : liveLabel(parts)) : (only ?? summarize(parts))
  const hasSources = !live && parts.some((p) => p.type === "source")
  // Finished and about one thing: a plain line, an icon, the label and the sites it read.
  const flat = !!only || hasSources
  // ToolSearch is a CLI looking up its own tools: plumbing, not a step anyone needs to read.
  const steps = parts.filter((p): p is Step => p.type !== "source" && (p.type === "tool" ? p.title !== "ToolSearch" : !!p.text || !p.done))
  const sources = parts.flatMap((p) => (p.type === "source" ? [p] : []))
  const tools = steps.filter((p): p is ToolPart => p.type === "tool")
  const running = live ? tools.filter((t) => t.state === "running").at(-1) : undefined
  // While it works, the site it's on shows by the line ("Opening axeai.com").
  const liveSite = running ? siteOf(running.title, running.input) : null

  // Nothing to open yet: the live line alone.
  if (live && !waiting && !tools.length) return <LiveLine label="Thinking" seconds={seconds} />
  // Done, with nothing to show (thinking without words): the line alone, not a button.
  if (!steps.length && !sources.length) {
    return <p className="m-0 flex h-6 items-center px-1 text-[13px] text-ink-3">{label}</p>
  }

  if (cwd && compact) {
    // While a card asks about a step, nothing else moves: no spinner (it would sit on another step than
    // the one asked about), and the asked step's row gives way to the card right under the list.
    const waitingOnCard = !!asked?.length
    const done = steps.filter((p) => (waitingOnCard || p !== running) && !(p.type === "reasoning" && !p.done) && !asked?.includes(p.id))
    return (
      <section data-slot="tool-group" aria-label={summarize(done, true)} className="flex flex-col gap-[2px] font-sans">
        {done.map((p) => {
          const l = stepLabel(p, formatSeconds)
          return (
            <div key={p.id} className="flex h-6 min-w-0 items-center gap-[8px] px-1 text-[13px] leading-[18px] text-ink-3">
              <span className="flex w-3.5 shrink-0 justify-center">{p.type === "tool" && p.state === "running" ? <Spinner /> : null}</span>
              <span className="min-w-0 truncate">{p.type === "tool" && p.state === "running" ? l.now : l.done}</span>
              {l.extra && <span className="shrink-0 tabular-nums text-ink-4">{l.extra}</span>}
            </div>
          )
        })}
        {live && !waitingOnCard && <LiveLine label={running ? toolStep(running).now : "Thinking"} seconds={seconds} />}
      </section>
    )
  }

  // While it works (and nothing waits on you), what is done folds into one line and the step in
  // progress is the live line under it. Waiting on you, the line says so and opens every step.
  if (live && !waiting) {
    const settled = steps.filter((p) => p !== running && !(p.type === "reasoning" && !p.done))
    return (
      <section data-slot="tool-group" className="mb-[6px] flex flex-col font-sans">
        {settled.length > 0 && (
          <>
            <FoldButton label={summarize(settled, !!cwd)} open={open} onToggle={() => setOpen((o) => !o)} />
            <AnimatePresence initial={false}>
              {open && (
                <motion.div key="steps" {...m.collapse} className="overflow-hidden">
                  <StepRows steps={settled} cwd={cwd} />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <LiveLine label={running ? toolStep(running).now : "Thinking"} seconds={seconds} site={liveSite} />
      </section>
    )
  }

  const head = live ? label : cwd && !flat ? summarize(steps, true) : label
  return (
    <section data-slot="tool-group" className={`mb-[6px] font-sans ${waiting ? "steps-waiting" : ""}`}>
      <FoldButton
        label={head}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        icon={only ? <PageIcon size={14} /> : hasSources ? <WebMark size={14} /> : null}
        hideChevron={flat}
        trailing={
          hasSources && !open ? (
            <>
              <span className="inline-flex items-center" aria-hidden="true">
                {sources.slice(0, 3).map((x, i) => (
                  <span key={x.id} className="relative ml-[4px] flex rounded-full ring-2 ring-background first:ml-0" style={{ zIndex: 3 - i }}>
                    <Favicon domain={host(x.url)} size={16} tile tileColor={i} />
                  </span>
                ))}
              </span>
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-fill-2 px-[5px] text-[12px] text-ink-3">{sources.length}</span>
            </>
          ) : null
        }
      />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="steps" {...m.collapse} className="overflow-hidden">
            <StepRows steps={steps} cwd={cwd} />
            {sources.length > 0 && (
              <div className="ml-[9px] pt-1.5 pb-1 pl-3.5">
                <Citations
                  items={sources.map((s) => ({ id: s.id, title: s.title, url: s.url, domain: host(s.url), icon: <Favicon domain={host(s.url)} size={20} /> }))}
                  onClick={(e) => {
                    // Links open in the browser through the engine, never in the app window.
                    const a = (e.target as HTMLElement).closest("a")
                    if (a?.href) e.preventDefault()
                  }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** The folded line: 13 px in ink-3, a small chevron; it opens the rows. */
function FoldButton({
  label,
  open,
  onToggle,
  icon,
  trailing,
  hideChevron,
}: {
  label: string
  open: boolean
  onToggle: () => void
  icon?: ReactNode
  trailing?: ReactNode
  hideChevron?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}
      className="group/steps flex h-6 max-w-full min-w-0 items-center gap-[6px] self-start rounded-full border-0 bg-transparent px-1 text-left text-[13px] leading-[18px] text-ink-3 transition-colors duration-150 hover:text-ink-2"
    >
      {icon}
      <h3 className="m-0 min-w-0 truncate text-[13px] leading-[18px] font-normal">{label}</h3>
      {trailing}
      <ChevronRightMark
        size={11}
        className={`shrink-0 text-ink-4 transition-[transform,opacity] duration-200 group-hover/steps:text-ink-3 ${hideChevron && !open ? "opacity-0 group-hover/steps:opacity-100" : ""} ${open ? "rotate-90" : ""}`}
      />
    </button>
  )
}

/** The open list: one row per step, and a run of one kind as one row ("Read 4 files"). */
function StepRows({ steps, cwd }: { steps: Step[]; cwd?: string }) {
  const runs = groupRuns(steps, (p) => (p.type === "tool" && p.state === "done" ? toolStep(p).group : undefined))
  return (
    <div className="mt-0.5 ml-[9px] flex flex-col pb-1 pl-2">
      {runs.map((run) => {
        const first = run.items[0]!
        if (run.group && run.items.length > 1) {
          const items = run.items as ToolPart[]
          return (
            <StepRow
              key={first.id}
              name={groupPhrase(run.group, items.length)}
              status="complete"
              detail={
                <div className="flex flex-col gap-0.5">
                  {items.map((t) => (
                    <div key={t.id} className="selectable truncate">
                      {relativeTo(rawOf(t), cwd)}
                    </div>
                  ))}
                </div>
              }
            />
          )
        }
        return first.type === "tool" ? (
          <ToolRow key={first.id} part={first} cwd={cwd} />
        ) : (
          <StepRow
            key={first.id}
            name={first.done ? stepLabel(first, formatSeconds).done : "Thinking"}
            status={first.done ? "complete" : "running"}
            detail={first.text ? <div className="selectable font-sans text-[13px] leading-5 whitespace-pre-wrap">{first.text}</div> : undefined}
          />
        )
      })}
    </div>
  )
}

/** What a step ran or touched, raw: the command, else its path or query, else its title. */
function rawOf(t: ToolPart): string {
  const title = t.title.replace(/^`|`$/g, "")
  if (isShellCommand(title)) return title
  return t.input?.trim() ? readableInput(t.input) : title
}

type StepStatus = "complete" | "running" | "error" | "declined"

/** One step: one 13 px line in ink-3; opens to what it did, in small monospace on a faint fill. */
function StepRow({ name, extra, status, detail, site }: { name: string; extra?: string; status: StepStatus; detail?: ReactNode; site?: string | null }) {
  const [open, setOpen] = useState(false)
  const m = useMotion()
  const mark =
    status === "running" ? (
      <Spinner />
    ) : status === "error" ? (
      <XIcon size={11} className="text-bad" />
    ) : status === "declined" ? (
      <XIcon size={11} className="text-ink-4" />
    ) : site ? (
      <Favicon key={site} domain={site} size={12} />
    ) : null
  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!detail}
        aria-expanded={detail ? open : undefined}
        onClick={() => setOpen((o) => !o)}
        className="group/row flex h-7 min-w-0 items-center gap-2 rounded-full border-0 bg-transparent px-1.5 text-left text-[13px] leading-[18px] text-ink-3 enabled:hover:bg-fill"
      >
        {mark && (
          <span aria-hidden="true" className="flex w-3 shrink-0 justify-center">
            {mark}
          </span>
        )}
        <span className="min-w-0 truncate">{name}</span>
        {extra && <span className="shrink-0 tabular-nums text-ink-4">{extra}</span>}
        {status === "declined" && <span className="shrink-0 text-ink-4">Not allowed</span>}
        {detail && <ChevronRightMark size={10} className={`ml-auto shrink-0 text-ink-4 opacity-0 transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${open ? "rotate-90 opacity-100" : ""}`} />}
      </button>
      <AnimatePresence initial={false}>
        {open && detail && (
          <motion.div key="detail" {...m.collapse} className="overflow-hidden">
            <div className="mt-0.5 mb-1.5 ml-1.5 rounded-media bg-fill px-3 py-2 font-mono text-[12px] leading-[18px] text-ink-3">{detail}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** "/private/var/…/work/notes.md" → "notes.md" inside the chat's folder. */
export function relativeTo(text: string, cwd?: string) {
  if (!cwd) return text
  const dir = cwd.replace(/\/+$/, "")
  return text.split(`/private${dir}/`).join("").split(`${dir}/`).join("").split(`/private${dir}`).join(".").split(dir).join(".")
}

/** A tool's input as one readable line: `{"subject":"Hi","body":"…"}` → "Hi, …". */
export function readableInput(input: string): string {
  const t = input.trim()
  if (!t.startsWith("{")) return t
  try {
    const words = Object.values(JSON.parse(t) as Record<string, unknown>).filter((v): v is string => typeof v === "string" && !!v.trim())
    return words.length ? words.join(", ").replace(/\s+/g, " ") : t
  } catch {
    return t
  }
}

function ToolRow({ part, cwd }: { part: ToolPart; cwd?: string }) {
  const l = toolStep(part)
  const raw = rawOf(part)
  // The raw command or path shows only inside, above what it printed.
  const showRaw = !!raw && (isShellCommand(raw) || raw.trim() !== l.done)
  const detail =
    part.output || part.diff?.length || showRaw ? (
      <div className="flex flex-col gap-2">
        {showRaw && <pre className="selectable scrollbar-hairline m-0 max-h-32 overflow-auto whitespace-pre-wrap">{relativeTo(raw, cwd)}</pre>}
        {part.output && <pre className="selectable scrollbar-hairline m-0 max-h-48 overflow-auto whitespace-pre-wrap">{part.output}</pre>}
        {part.diff?.map((d) => <Diff key={d.path} {...d} />)}
      </div>
    ) : undefined
  const status: StepStatus = part.state === "running" ? "running" : part.state === "failed" ? "error" : part.state === "declined" ? "declined" : "complete"
  return <StepRow name={relativeTo(status === "running" ? l.now : l.done, cwd)} extra={l.extra} status={status} detail={detail} site={siteOf(part.title, part.input)} />
}

function Diff({ path, before, after }: { path: string; before?: string; after: string }) {
  const lines = diffLines(before, after)
  const added = lines.filter((l) => l.sign === "+").length
  const removed = lines.filter((l) => l.sign === "-").length
  return (
    <div className="overflow-hidden rounded-3xl bg-card">
      <div className="flex h-9 items-center gap-2 px-3 font-mono text-[12px] text-ink-2">
        <span className="flex-1 truncate">{path}</span>
        <span className="text-ok">+{added}</span>
        <span className="text-bad">−{removed}</span>
      </div>
      <div className="selectable scroll max-h-64 py-1.5 font-mono text-[12px] leading-5">
        {lines.map((l, k) => (
          <div
            key={k}
            className="flex gap-2.5 px-2.5"
            style={{
              background: l.sign === "+" ? "var(--add-bg)" : l.sign === "-" ? "var(--del-bg)" : undefined,
              color: l.sign === "+" ? "var(--add-ink)" : l.sign === "-" ? "var(--del-ink)" : "var(--ink-2)",
            }}
          >
            <span className="w-2.5 shrink-0 text-center opacity-70">{l.sign === "-" ? "−" : l.sign}</span>
            <span className="whitespace-pre">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
