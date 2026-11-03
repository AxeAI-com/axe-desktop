import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"

import type { Events } from "@shared/api"
import type { PhonesView } from "@shared/types"

import { invoke, on } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"

import { PhoneIcon } from "./Icons"

/**
 * "David's iPhone is connected" with Stop (board: Remote control, RCConnected), top right while a paired
 * phone has a live session. Stop ends every phone's session and turns phone use off until you turn it on
 * again in Settings. When a phone turns on Bypass, the banner says so at once.
 */
export function PhoneBanner() {
  const [view, setView] = useState<PhonesView | null>(null)
  const [notice, setNotice] = useState<Events["phoneNotice"]>(null)
  const m = useMotion()
  useEffect(() => {
    void invoke("phones:get").then(setView).catch(() => {})
    const offPhones = on("phones", setView)
    const offNotice = on("phoneNotice", setNotice)
    return () => (offPhones(), offNotice())
  }, [])
  const connected = view?.enabled ? view.phones.filter((p) => p.connected) : []
  const show = connected.length > 0
  const label = connected.length === 1 ? `${connected[0]?.name} is connected` : `${connected.length} phones are connected`
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={m.t()}
          className={`no-drag fixed top-3.5 right-5 z-50 flex h-[34px] items-center gap-2.5 rounded-full pr-1.5 pl-3 text-[13px] ${notice ? "bg-pop text-warn-ink" : "bg-pop text-ok"}`}
        >
          <PhoneIcon size={14} />
          <span className="max-w-[420px] truncate">{notice?.text ?? label}</span>
          <button
            onClick={() => void invoke("phones:stop").then(setView)}
            className="h-6 rounded-full border-0 bg-fill-2 px-2.5 text-[12px] text-ink hover:bg-fill-3"
          >
            Stop
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
