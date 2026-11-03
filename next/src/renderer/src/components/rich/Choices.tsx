import { motion } from "motion/react"
import { useEffect } from "react"

import type { RichChoices } from "@shared/rich"

import { D, useMotion } from "@/lib/motion"

import { CheckIcon } from "../Icons"
import { CardFrame, EmptyNote, useRich } from "./shared"

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Two to four options; clicking one (or pressing its number) sends it as your next message. */
export function ChoicesCard({ choices }: { choices: RichChoices }) {
  const m = useMotion()
  const { canAnswer, answeredWith, choose } = useRich()
  const picked = answeredWith === undefined ? -1 : choices.options.findIndex((o) => same(o.label, answeredWith))
  const answered = answeredWith !== undefined
  const live = canAnswer && !answered && !!choose
  const pick = (i: number) => {
    const o = choices.options[i]
    if (live && o) choose!(o.label)
  }

  // 1, 2, 3 pick while the card is the open question and you're not typing (an empty composer counts as not typing).
  useEffect(() => {
    if (!live) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const emptyComposer = t instanceof HTMLTextAreaElement && t.getAttribute("aria-label") === "Message" && !t.value
      if (t && !emptyComposer && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return
      const n = Number(e.key)
      if (n >= 1 && n <= choices.options.length) {
        e.preventDefault()
        pick(n - 1)
      } else if (n === choices.options.length + 1) {
        e.preventDefault()
        focusComposer()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!choices.options.length)
    return (
      <CardFrame label="Choose one">
        <EmptyNote title={choices.question} text="No options came with this question. Reply in your own words." />
      </CardFrame>
    )

  return (
    <div className="flex flex-col gap-2">
      <CardFrame label="Choose one" className="flex flex-col gap-1 p-2">
        {choices.question && <div className="px-2.5 pt-2.5 pb-2 text-[15px]">{choices.question}</div>}
        {choices.options.map((o, i) => {
          const isPicked = picked === i
          const faded = answered && !isPicked
          return (
            <motion.button
              key={i}
              disabled={!live}
              aria-pressed={isPicked}
              onClick={() => pick(i)}
              initial={m.reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: faded ? 0.5 : 1, y: 0 }}
              whileHover={live && !m.reduced ? { y: -1 } : undefined}
              whileTap={live && !m.reduced ? { scale: 0.99 } : undefined}
              transition={{ ...m.t(D.base), delay: answered ? 0 : 0.08 + m.stagger(i, 0.06) }}
              className={`group flex items-start gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] duration-200 ${
                isPicked
                  ? "border-[var(--accent-line)] bg-accent-bg"
                  : live
                    ? "border-line hover:border-line-3 hover:bg-fill hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                    : "border-line"
              }`}
            >
              <span
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-[12px] tabular-nums ${
                  isPicked ? "bg-accent text-white" : "bg-fill-2 text-ink-2"
                }`}
              >
                {isPicked ? <CheckIcon size={12} strokeWidth={2.2} /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="flex items-center gap-2 text-[15px] leading-[20px] text-ink">
                  {o.label}
                  {"recommended" in o && o.recommended && (
                    <span className="rounded-[6px] bg-accent-bg px-1.5 py-px text-[12px] text-accent-ink">Recommended</span>
                  )}
                </span>
                {"detail" in o && o.detail && <span className="text-[13px] leading-[19px] text-ink-2">{o.detail}</span>}
              </span>
            </motion.button>
          )
        })}
        {live && (
          <motion.button
            onClick={focusComposer}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...m.t(D.base), delay: 0.08 + m.stagger(choices.options.length, 0.06) }}
            className="flex items-center gap-3 rounded-[10px] border border-transparent bg-transparent px-3.5 py-3 text-left text-[13px] text-ink-3 hover:text-ink-2"
          >
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-fill-2 text-[12px] tabular-nums">{choices.options.length + 1}</span>
            Something else, type it below
          </motion.button>
        )}
      </CardFrame>
      {live && (
        <div className="pl-1 text-[12px] text-ink-3">
          Press {choices.options.map((_, i) => i + 1).join(", ").replace(/, (\d)$/, " or $1")} to choose
        </div>
      )}
    </div>
  )
}

function focusComposer() {
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus()
}
