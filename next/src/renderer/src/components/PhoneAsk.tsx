import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"

import type { Events } from "@shared/api"

import { invoke, on } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"

import { PhoneIcon } from "./Icons"

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
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45"
          onKeyDown={(e) => e.key === "Escape" && answer(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="phone-ask-title"
            aria-describedby="phone-ask-body"
            initial={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            transition={m.t()}
            className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-5 rounded-[1rem] bg-popover p-7 [box-shadow:var(--card-shadow),0_24px_64px_rgb(0_0_0/0.35)]"
          >
            <div className="flex items-center gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-fill-2 text-ink">
                <PhoneIcon size={22} />
              </span>
              <span className="flex min-w-0 flex-col gap-[3px]">
                <span id="phone-ask-title" className="truncate text-[17px] text-ink">
                  Connect {ask.name || "this phone"}?
                </span>
                <span className="truncate text-[13px] text-ink-3">{ask.agent ? `${ask.agent}, just now` : "Just now"}</span>
              </span>
            </div>
            <p id="phone-ask-body" className="m-0 text-[14px] leading-[1.55] text-ink-2">
              It can use your chats and agents on this Mac, in any mode, until you remove it.
            </p>
            <div className="flex justify-end gap-2.5">
              <button ref={notMe} onClick={() => answer(false)} className="h-9 rounded-[9px] border-0 bg-fill-2 px-4 text-[14px] text-ink hover:bg-fill-3">
                Not me
              </button>
              <button onClick={() => answer(true)} className="h-9 rounded-[9px] border-0 bg-brand px-5 text-[14px] text-white hover:opacity-90">
                Allow
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
