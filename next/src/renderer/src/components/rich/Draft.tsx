import { AnimatePresence, motion } from "motion/react"
import { useLayoutEffect, useRef, useState } from "react"

import type { RichDraft } from "@shared/rich"

import { D, useMotion } from "@/lib/motion"

import { CopyMark } from "../BoardIcons"
import { CheckIcon } from "../Icons"
import { CardFrame, EmptyNote } from "./shared"

/** Character limits people actually hit. */
const LIMITS: Record<string, number> = { x: 280, twitter: 280, threads: 500, bluesky: 300, linkedin: 3000 }

/** An email or a post you can edit in place and copy. Nothing is sent from here. */
export function DraftCard({ draft }: { draft: RichDraft }) {
  const m = useMotion()
  const [subject, setSubject] = useState(draft.subject ?? "")
  const [body, setBody] = useState(draft.body)
  const [copied, setCopied] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const isEmail = draft.format === "email"
  const limit = draft.channel ? LIMITS[draft.channel.toLowerCase()] : undefined
  const edited = body !== draft.body || subject !== (draft.subject ?? "")

  // The text box grows with its text.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [body])

  if (!draft.body)
    return (
      <CardFrame label={isEmail ? "Email draft" : "Post draft"}>
        <EmptyNote title={draft.subject} text="The draft came back empty. Ask again with a little more detail." />
      </CardFrame>
    )

  const copy = () => {
    void navigator.clipboard?.writeText(isEmail && subject ? `Subject: ${subject}\n\n${body}` : body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <CardFrame label={isEmail ? "Email draft" : draft.channel ? `Post for ${draft.channel}` : "Post draft"} className="overflow-hidden">
      <div className="flex h-[44px] items-center justify-between px-[18px] text-[13px]">
        <span className="text-ink-3">{isEmail ? "Email draft" : `Post${draft.channel ? ` for ${draft.channel}` : ""}`}</span>
        {!isEmail && (
          <span className="text-[12px] tabular-nums" style={{ color: limit && body.length > limit ? "var(--bad)" : "var(--ink-3)" }}>
            {body.length}
            {limit ? ` of ${limit}` : " characters"}
          </span>
        )}
      </div>
      {isEmail && (
        <>
          <div className="flex items-baseline px-[18px] text-[13px] leading-[24px]">
            <span className="w-[64px] shrink-0 text-ink-3">To</span>
            <span className={draft.to ? "text-ink" : "text-ink-4"}>{draft.to ?? "Add when you send it"}</span>
          </div>
          <label className="flex items-baseline px-[18px] text-[13px] leading-[24px]">
            <span className="w-[64px] shrink-0 text-ink-3">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-label="Subject"
              className="selectable h-[24px] min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] leading-[24px] text-ink outline-none"
            />
          </label>
        </>
      )}
      <textarea
        ref={area}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label={isEmail ? "Email text" : "Post text"}
        spellCheck
        className="selectable block w-full resize-none border-0 bg-transparent px-[18px] pt-[10px] pb-[14px] text-[15px] leading-[23px] text-ink outline-none"
      />
      <div className="flex items-center gap-[8px] px-[18px] pb-[16px]">
        <motion.button
          {...m.lift}
          transition={m.t(D.fast)}
          onClick={copy}
          className="flex h-[28px] items-center gap-[6px] rounded-full border-0 bg-button px-[12px] text-[13px] text-button-ink"
        >
          {copied ? <CheckIcon size={14} /> : <CopyMark size={14} />}
          {copied ? "Copied" : "Copy"}
        </motion.button>
        <AnimatePresence>
          {edited && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={m.t(D.fast)}
              onClick={() => {
                setBody(draft.body)
                setSubject(draft.subject ?? "")
              }}
              className="h-8 rounded-[6px] border-0 bg-transparent px-2 text-[13px] text-ink-3 hover:text-ink"
            >
              Undo my edits
            </motion.button>
          )}
        </AnimatePresence>
        <span className="flex-1" />
        <span className="text-[12px] text-ink-3">Click the text to edit it</span>
      </div>
    </CardFrame>
  )
}
