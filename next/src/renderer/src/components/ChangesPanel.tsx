import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useState } from "react"

import type { FileChange } from "@shared/types"

import { fileDiff, hunks, totals } from "@/lib/changes"
import { D, useMotion } from "@/lib/motion"
import { keepChanges, openReview, undoChanges, useStore } from "@/lib/store"

import { XIcon } from "./Icons"

const NONE: FileChange[] = []

/**
 * Review changes: every file the agent changed in this chat, the diff of the one you pick, and
 * Keep or Undo for it or for all. Undo puts back the copy saved before the agent's first change.
 */
export function ChangesPanel({ threadId }: { threadId: string }) {
  const files = useStore((s) => s.changes[threadId] ?? NONE)
  const running = useStore((s) => !!s.threads.find((t) => t.id === threadId)?.running)
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const m = useMotion()
  const sum = useMemo(() => totals(files), [files])
  const current = files.find((f) => f.path === picked) ?? files[0]

  useEffect(() => setError(null), [files])

  const act = async (run: () => Promise<string | null | void>) => {
    setBusy(true)
    const problem = await run()
    setBusy(false)
    setError(problem || null)
  }

  return (
    <motion.aside
      aria-label="Changes"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 440, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={m.t(D.slow)}
      className="flex shrink-0 overflow-hidden pr-[8px] pb-[8px] tracking-normal"
    >
      <div className="flex w-[432px] min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-card">
        <div className="flex h-[52px] shrink-0 items-center pr-[12px] pl-[18px]">
          <span className="flex items-baseline gap-[8px]">
            <span className="text-[15px] text-ink">Changes</span>
            {files.length > 0 && (
              <span className="text-[13px] text-ink-3 tabular-nums">
                {sum.files} {sum.files === 1 ? "file" : "files"}
              </span>
            )}
          </span>
          <span className="flex-1" />
          <button
            aria-label="Close changes"
            title="Close"
            onClick={() => openReview(null)}
            className="flex size-[32px] items-center justify-center rounded-full border-0 bg-transparent text-ink-3 transition-colors duration-150 hover:bg-fill-2 hover:text-ink"
          >
            <XIcon size={15} />
          </button>
        </div>
        {files.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-10 text-center">
            <div className="text-[14px] text-ink-2">Nothing changed yet</div>
            <div className="text-[13px] text-ink-3">Files the agent changes in this chat show up here, ready to keep or undo.</div>
          </div>
        ) : (
          <>
            {/* Five whole rows (44 px each, 4 px apart), so a row is never cut in half; more scroll. */}
            <ul aria-label="Changed files" className="scroll m-0 flex max-h-[236px] shrink-0 list-none flex-col gap-[4px] px-[12px] pb-0">
              <AnimatePresence initial={false}>
                {files.map((f) => {
                  const d = fileDiff(f)
                                    return (
                    <motion.li
                      key={f.path}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={m.t()}
                      className="flex h-[44px] shrink-0 items-center rounded-[12px] bg-fill pr-[8px] transition-colors duration-150 hover:bg-fill-2"
                    >
                      <button
                        aria-current={f.path === current?.path ? "true" : undefined}
                        onClick={() => setPicked(f.path)}
                        className="flex h-full min-w-0 flex-1 items-center gap-[8px] rounded-[12px] border-0 bg-transparent pr-0 pl-[14px] text-left"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-[20px] text-ink" title={f.rel}>
                          {f.rel}
                        </span>
                        <FileState f={f} />
                        <Counts mono added={d.added} removed={d.removed} />
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void act(() => keepChanges(threadId, [f.path]))}
                        className={`${small} bg-fill-4 text-ink hover:bg-fill-3`}
                      >
                        Keep
                      </button>
                      <button
                        aria-label="Undo this file"
                        disabled={busy || running}
                        title={running ? "Wait for it to finish" : undefined}
                        onClick={() => void act(() => undoChanges(threadId, [f.path]))}
                        className={`${small} bg-transparent text-ink-2 hover:bg-fill hover:text-ink`}
                      >
                        Undo
                      </button>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
            <div className="scroll min-h-0 flex-1 px-[12px] pt-[12px]">
              {current && (
                <motion.div key={current.path} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={m.t(D.fast)}>
                  <DiffView f={current} />
                </motion.div>
              )}
            </div>
            <div className="flex h-[64px] shrink-0 items-center gap-[8px] pr-[18px] pl-[12px]">
              <motion.button {...m.lift} transition={m.t(0.12)} disabled={busy} onClick={() => void act(() => keepChanges(threadId, null))} className={keepAll}>
                Keep all
              </motion.button>
              <button disabled={busy || running} onClick={() => void act(() => undoChanges(threadId, null))} className={undoAll}>
                Undo all
              </button>
              <span className="flex-1" />
              <span className="text-[13px] text-ink-3">
                {error ?? (running ? "Undo waits until it finishes" : <Counts mono added={sum.added} removed={sum.removed} />)}
              </span>
            </div>
          </>
        )}
      </div>
    </motion.aside>
  )
}

/** Keep all and Undo all: 34 high pills. */
const pill34 = "inline-flex h-[34px] items-center justify-center rounded-full border-0 px-[16px] text-[13px] transition-colors duration-150 disabled:opacity-40"
const keepAll = `${pill34} bg-primary text-primary-foreground hover:opacity-85`
const undoAll = `${pill34} bg-fill-4 text-foreground hover:bg-fill-3`

/** A small pill inside a file row: 28 high. */
const small = "ml-[8px] inline-flex h-[28px] shrink-0 items-center rounded-full border-0 px-[12px] text-[13px] transition-colors duration-150 disabled:opacity-50"

export function Counts({ added, removed, mono }: { added: number; removed: number; mono?: boolean }) {
  return (
    <span className={`flex shrink-0 tabular-nums ${mono ? "gap-[8px] font-mono text-[12px] leading-[20px]" : "gap-1.5 text-[13px]"}`}>
      <span className="text-[var(--add-ink)]">+{added}</span>
      <span className="text-[var(--del-ink)]">−{removed}</span>
    </span>
  )
}

function FileState({ f }: { f: FileChange }) {
  const word = f.before === null ? "New" : f.after === null ? "Deleted" : null
  return word ? <span className="shrink-0 text-[13px] text-ink-3">{word}</span> : null
}

function DiffView({ f }: { f: FileChange }) {
  const d = fileDiff(f)
  if (!d.lines)
    return (
      <div className="px-4 py-6 text-[13px] text-ink-3">
        {f.binary ? "This file isn't text, so there's nothing to show. Keep or undo it as a whole." : "This file is too big to show here. Keep or undo it as a whole."}
      </div>
    )
  const rows = hunks(d.lines)
  return (
    <div className="overflow-hidden rounded-[12px] bg-entity">
      <div className="flex h-[32px] items-center gap-[8px] px-[14px] font-mono text-[12px] leading-[20px] text-ink">
        <span className="min-w-0 flex-1 truncate" title={f.path}>
          {f.rel}
        </span>
        <Counts mono added={d.added} removed={d.removed} />
      </div>
      <div className="scroll pt-[4px] pb-[8px] font-mono text-[12px] leading-[20px]">
        {rows.map((r, i) =>
          "fold" in r ? (
            <div key={i} className="my-1 px-3.5 text-[13px] text-ink-4">
              {r.fold} unchanged {r.fold === 1 ? "line" : "lines"}
            </div>
          ) : (
            <div
              key={i}
              className="flex"
              style={{
                background: r.sign === "+" ? "var(--add-bg)" : r.sign === "-" ? "var(--del-bg)" : undefined,
                color: r.sign === "+" ? "var(--add-ink)" : r.sign === "-" ? "var(--del-ink)" : "var(--ink-2)",
              }}
            >
              <span className="w-[26px] shrink-0 text-center opacity-80 select-none">{r.sign === " " ? "" : r.sign === "-" ? "−" : "+"}</span>
              <span className="selectable min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.text || " "}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
