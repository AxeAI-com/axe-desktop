import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState, type ReactNode } from "react"

import { diffLines } from "@/lib/diff"
import { useMotion } from "@/lib/motion"
import { commandLabel, formatSeconds, isShellCommand, liveLabel, siteOf, summarize, type StepPart, type ToolPart } from "@/lib/steps"

import { ChevronRightMark, EditMark, FileMark, TerminalMark, ThoughtMark } from "./ai/board-icons"
import { Citations } from "./ai/citations"
import { ThinkingShimmer } from "./ai/thinking-shimmer"
import { Favicon } from "./Favicon"
import { PageIcon, WebMark } from "./BoardIcons"
import { CheckIcon, ChevronDown, XIcon } from "./Icons"

export function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
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

/**
 * Everything a reply did before its words, folded into one quiet line ("Used 1 tool"). Before any
 * step arrives it is the Thinking Shimmer with the seconds. Open, the steps hang off a thin line,
 * one short row each; a row opens to show what it read, ran or changed. No cards, no boxes.
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
  // One finished file read: the board shows it as one plain line naming the file.
  const only = !live && parts.length === 1 && parts[0]!.type === "tool" && parts[0]!.kind === "read" && parts[0]!.state === "done" ? parts[0]!.title : undefined
  const label = live ? (waiting ? "Waiting for you" : liveLabel(parts)) : (only ?? summarize(parts))
  const hasSources = !live && parts.some((p) => p.type === "source")
  // Finished and about one thing: the board shows a plain line, an icon, the label and the sites it read.
  const flat = !!only || hasSources
  // ToolSearch is a CLI looking up its own tools: plumbing, not a step anyone needs to read.
  const steps = parts.filter(
    (p): p is Exclude<StepPart, { type: "source" }> => p.type !== "source" && (p.type === "tool" ? p.title !== "ToolSearch" : !!p.text || !p.done),
  )
  const sources = parts.flatMap((p) => (p.type === "source" ? [p] : []))
  // While it works, the site it's on shows by the line ("Opening axeai.com").
  const tools = steps.filter((p): p is ToolPart => p.type === "tool")
  const liveSite = live ? (tools.filter((t) => t.state === "running").concat(tools.slice(-1)).map((t) => siteOf(t.title, t.input)).find(Boolean) ?? null) : null

  // Nothing to open yet: the live line alone.
  if (live && !steps.some((p) => p.type === "tool")) {
    return <ThinkingShimmer label={label} seconds={seconds ?? undefined} className="h-6 px-1" />
  }
  // Done, with nothing to show (thinking without words): the line alone, not a button.
  if (!steps.length && !sources.length) {
    return <p className="m-0 flex h-6 items-center px-1 text-sm text-muted-foreground">{label}</p>
  }

  // An agent chat (board RC-AgentWorking): what is done folds into one quiet line, and the step in
  // progress sits under it as its own row with the command it runs and the seconds.
  if (cwd) {
    const running = live ? tools.filter((t) => t.state === "running").at(-1) : undefined
    const thinking = live && !running
    if (compact) {
      const mark = (p: Exclude<StepPart, { type: "source" }>) =>
        p.type === "reasoning" ? <ThoughtMark size={15} /> : p.kind === "edit" || p.kind === "delete" || p.kind === "move" ? <EditMark size={15} /> : p.kind === "execute" ? <TerminalMark size={15} /> : <FileMark size={15} />
      // While a card asks about a step, nothing else moves: no spinner (it would sit on another step than
      // the one asked about), and the asked step's row gives way to the card right under the list.
      const waitingOnCard = !!asked?.length
      const done = steps.filter((p) => (waitingOnCard || p !== running) && !(p.type === "reasoning" && !p.done) && !asked?.includes(p.id))
      return (
        <section data-slot="tool-group" aria-label={summarize(done, true)} className="flex flex-col gap-[6px] font-sans text-[14px] leading-[22px]">
          {done.map((p) => (
            <div key={p.id} className="flex items-center gap-[10px] text-ink-3">
              <span className="flex">{mark(p)}</span>
              <span>{p.type === "reasoning" ? (p.seconds !== undefined ? `Thought for ${formatSeconds(p.seconds)}` : "Thought") : relativeTo(p.title, cwd)}</span>
            </div>
          ))}
          {live && !waitingOnCard && (
            <div role="status" className="flex items-center gap-[10px] text-ink">
              <span aria-hidden="true" className="flex w-[15px] justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin motion-reduce:animate-none">
                  <circle cx="12" cy="12" r="9" stroke="var(--fill-3)" strokeWidth="2.5" />
                  <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </span>
              <span>{thinking ? "Thinking" : relativeTo(running!.title, cwd)}</span>
            </div>
          )}
        </section>
      )
    }
    const settled = steps.filter((p) => p !== running && !(p.type === "reasoning" && !p.done))
    const sub = running?.input && running.input.trim() !== running.title.trim() ? relativeTo(readableInput(running.input), cwd) : ""
    return (
      <section data-slot="tool-group" className="flex flex-col gap-[10px] font-sans">
        {settled.length > 0 && (
          <div className="flex flex-col">
            <button
              type="button"
              aria-label={summarize(settled, true)}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="group/steps inline-flex items-center gap-[6px] self-start rounded-[6px] border-0 bg-transparent p-0 text-left text-[15px] leading-[22px] text-ink-3 transition-colors duration-150 hover:text-ink-2"
            >
              <h3 className="m-0 min-w-0 truncate text-[15px] leading-[22px] font-normal">{summarize(settled, true)}</h3>
              <ChevronRightMark size={13} className={`text-ink-3 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div key="steps" {...m.collapse} className="overflow-hidden">
                  <div className="mt-1 ml-[9px] flex flex-col pb-1 pl-3.5">
                    {settled.map((p) =>
                      p.type === "tool" ? (
                        <ToolRow key={p.id} part={p} cwd={cwd} />
                      ) : p.type === "reasoning" ? (
                        <StepRow
                          key={p.id}
                          name={p.seconds !== undefined ? `Thought for ${formatSeconds(p.seconds)}` : "Thought"}
                          summary={p.text.split("\n").find((l) => l.trim()) ?? ""}
                          status="complete"
                          detail={p.text ? <div className="selectable font-sans text-[13px] leading-5 whitespace-pre-wrap text-ink-2">{p.text}</div> : undefined}
                        />
                      ) : null,
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {live && (
          // min-w-0: a long command truncates inside the column instead of pushing the seconds out of it.
          <div role="status" className="flex min-w-0 items-center gap-[10px] text-[15px] leading-[22px] text-ink">
            <span aria-hidden="true" className="flex w-[16px] shrink-0 justify-center">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="animate-spin motion-reduce:animate-none">
                <circle cx="12" cy="12" r="9" stroke="var(--fill-3)" strokeWidth="2.5" />
                <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="min-w-0 truncate" title={thinking ? undefined : running!.title}>
              {thinking ? "Thinking" : relativeTo(running!.title, cwd)}
            </span>
            {sub && <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-[20px] text-ink-4">{sub}</span>}
            {!sub && <span className="flex-1" />}
            {seconds !== null && <span className="ml-auto shrink-0 text-[13px] tabular-nums text-ink-3">{formatSeconds(seconds)}</span>}
          </div>
        )}
      </section>
    )
  }

  return (
    <section data-slot="tool-group" className={`mb-[6px] font-sans ${live && !waiting ? "steps-live" : waiting ? "steps-waiting" : ""}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`group/steps flex items-center ${flat ? "h-[22px] gap-[10px] px-0" : "h-[32px] gap-[8px] px-[4px]"} rounded-[10px] border-0 bg-transparent text-[15px] text-ink-3 transition-colors duration-150 hover:text-ink-2`}
      >
        {only ? <PageIcon size={16} /> : hasSources ? <WebMark size={16} /> : null}
        {liveSite && <Favicon key={liveSite} domain={liveSite} size={14} />}
        <h3 className="m-0 min-w-0 truncate text-[15px] leading-6 font-normal">{label}</h3>
        {live && seconds !== null && <span className="text-[13px] tabular-nums text-ink-4">{formatSeconds(seconds)}</span>}
        {hasSources && !open && (
          <>
            <span className="inline-flex items-center" aria-hidden="true">
              {sources.slice(0, 3).map((x, i) => (
                <span key={x.id} className="relative flex first:ml-0 ml-[4px] rounded-[5px] shadow-[0_0_0_2px_var(--background)]" style={{ zIndex: 3 - i }}>
                  <Favicon domain={host(x.url)} size={18} tile tileColor={i} />
                </span>
              ))}
            </span>
            <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-fill-2 px-[6px] text-[12px] text-ink-2">{sources.length}</span>
          </>
        )}
        <ChevronDown className={`text-ink-4 transition-[transform,opacity] duration-200 group-hover/steps:text-ink-3 ${flat && !open ? "opacity-0 group-hover/steps:opacity-100" : ""} ${open ? "" : "-rotate-90"}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="steps" {...m.collapse} className="overflow-hidden">
            <div className="mt-1 ml-[9px] flex flex-col pb-1 pl-3.5">
              {steps.map((p) =>
                p.type === "tool" ? (
                  <ToolRow key={p.id} part={p} cwd={cwd} />
                ) : (
                  <StepRow
                    key={p.id}
                    name={p.done ? (p.seconds !== undefined ? `Thought for ${formatSeconds(p.seconds)}` : "Thought") : "Thinking"}
                    summary={p.text.split("\n").find((l) => l.trim()) ?? ""}
                    status={p.done ? "complete" : "running"}
                    detail={p.text ? <div className="selectable font-sans text-[13px] leading-5 whitespace-pre-wrap text-ink-2">{p.text}</div> : undefined}
                  />
                ),
              )}
              {sources.length > 0 && (
                <div className="pt-1.5">
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

type StepStatus = "complete" | "running" | "error" | "declined"

/** One step: a small mark, its name, one muted line; opens to what it did when there is something to show. */
function StepRow({ name, summary, status, detail, site }: { name: string; summary: string; status: StepStatus; detail?: ReactNode; site?: string | null }) {
  const [open, setOpen] = useState(false)
  const m = useMotion()
  const mark =
    site && (status === "running" || status === "complete") ? (
      <Favicon key={site} domain={site} size={13} className={status === "running" ? "animate-pulse motion-reduce:animate-none" : ""} />
    ) : status === "running" ? (
      <span className="size-[11px] animate-spin rounded-full border-[1.5px] border-ink-4 border-t-transparent motion-reduce:animate-none" />
    ) : status === "error" ? (
      <XIcon size={11} className="text-bad" />
    ) : status === "declined" ? (
      <XIcon size={11} className="text-ink-4" />
    ) : (
      <CheckIcon size={12} className="text-ink-4" />
    )
  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!detail}
        aria-expanded={detail ? open : undefined}
        onClick={() => setOpen((o) => !o)}
        className="group/row flex h-8 min-w-0 items-center gap-2 rounded-[10px] border-0 bg-transparent px-1 text-left text-[15px] enabled:hover:bg-fill"
      >
        <span aria-hidden="true" className="flex w-3.5 shrink-0 justify-center">
          {mark}
        </span>
        <span className={`shrink-0 truncate ${status === "declined" ? "text-ink-3" : "text-ink-2"}`}>{name}</span>
        {summary && <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-4">{summary}</span>}
        {detail && <ChevronDown className={`ml-auto shrink-0 text-ink-4 opacity-0 transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${open ? "opacity-100" : "-rotate-90"}`} />}
      </button>
      <AnimatePresence initial={false}>
        {open && detail && (
          <motion.div key="detail" {...m.collapse} className="overflow-hidden">
            <div className="mt-0.5 mb-1.5 ml-[26px] rounded-[6px] bg-fill px-3 py-2 font-mono text-[12px] leading-[18px] text-ink-2">{detail}</div>
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
  // A raw shell command never shows as the step: it reads "Searched files", and the command itself
  // waits inside, above what it printed.
  const shell = isShellCommand(part.title)
  const detail =
    part.output || part.diff?.length || shell ? (
      <div className="flex flex-col gap-2">
        {shell && <pre className="selectable scrollbar-hairline m-0 max-h-32 overflow-auto whitespace-pre-wrap text-ink-3">{relativeTo(part.title, cwd)}</pre>}
        {part.output && <pre className="selectable scrollbar-hairline m-0 max-h-48 overflow-auto whitespace-pre-wrap">{part.output}</pre>}
        {part.diff?.map((d) => <Diff key={d.path} {...d} />)}
      </div>
    ) : undefined
  return (
    <StepRow
      name={shell ? commandLabel(part.title, part.state !== "running") : relativeTo(part.title, cwd)}
      summary={part.state === "declined" ? "Not allowed" : !shell && part.input && part.input.trim() !== part.title.trim() ? relativeTo(readableInput(part.input), cwd) : ""}
      status={part.state === "running" ? "running" : part.state === "failed" ? "error" : part.state === "declined" ? "declined" : "complete"}
      detail={detail}
      site={siteOf(part.title, part.input)}
    />
  )
}

function Diff({ path, before, after }: { path: string; before?: string; after: string }) {
  const lines = diffLines(before, after)
  const added = lines.filter((l) => l.sign === "+").length
  const removed = lines.filter((l) => l.sign === "-").length
  return (
    <div className="overflow-hidden rounded-[16px] bg-card">
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
