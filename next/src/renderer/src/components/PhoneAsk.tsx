import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"

import type { Events } from "@shared/api"

import { invoke, on } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"

import { PhoneIcon } from "./SolarIcons"
import { button } from "./Kit"

/**
 * "Connect David's iPhone?" (board: Remote control, RCAllow). Shown only after a phone proved it
 * scanned this computer's QR (main/remote/phones.ts): the one tap that lets a phone in. Not me is focused
 * first, so a stray Return never allows anything.
 */
export function PhoneAsk() {
  const [ask, setAsk] = useState<Events["phoneAsk"]>(null)
  const notMe = useRef<HTMLButtonElement>(null)
  const m = useMotion()
  useEffect(() => on("phoneAsk", setAsk), [])
  useEffect(() => {
    if (ask) notMe.current?.focus()
  }, [ask])
  const answer = (allow: boolean) => {
    if (!ask) return
    void invoke("phones:answer", ask.id, allow)
    setAsk(null)
  }
  return (
    <AnimatePresence>
      {ask && (
        <motion.div
          key={ask.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={m.t()}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--scrim)]"
          onKeyDown={(e) => e.key === "Escape" && answer(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="phone-ask-title"
            aria-describedby="phone-ask-body"
            initial={false}
            transition={m.t()}
            className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-5 rounded-3xl border border-hairline bg-popover p-7"
          >
            <div className="flex items-center gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-3xl bg-fill-2 text-ink">
                <PhoneIcon size={22} />
              </span>
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span id="phone-ask-title" className="truncate text-[20px] text-ink">
                  {ask.check ? `Allow ${ask.name || "this browser"} to use ${ask.computer || "this computer"}?` : `Connect ${ask.name || "this device"}?`}
                </span>
                <span className="truncate text-[13px] text-ink-3">{ask.agent ? `${ask.agent}, just now` : "Just now"}</span>
              </span>
            </div>
            {ask.check && (
              <span className="text-center text-[44px] leading-[52px] tracking-[0.06em] text-ink tabular-nums" aria-label={`Check number ${ask.check}`}>
                {ask.check}
              </span>
            )}
            <p id="phone-ask-body" className="m-0 text-[13px] leading-[1.55] text-ink-2">
              {ask.check ? "Press Allow only if the browser shows the same number. It can then use your chats and agents here, in any mode, until you remove it." : "It can use your chats and agents on this Mac, in any mode, until you remove it."}
            </p>
            <div className="flex justify-end gap-2.5">
              <button ref={notMe} onClick={() => answer(false)} className={button.secondary}>
                Not me
              </button>
              <button onClick={() => answer(true)} className={button.primary}>
                Allow
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
