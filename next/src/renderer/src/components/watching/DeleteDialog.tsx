import { useEffect } from "react"
import { createPortal } from "react-dom"

import type { WatchView } from "@shared/watching/types"

import { deleteWatch } from "@/lib/watching"
import { btn } from "@/components/watching/parts"

/** Delete a watch: it stops checking and its history goes. Esc or a click outside cancels. */
export function DeleteDialog({ w, onClose }: { w: WatchView; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center" style={{ background: "var(--scrim)" }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-label={`Delete ${w.name}?`} className="flex w-[380px] max-w-[calc(100%-48px)] flex-col gap-[8px] rounded-[16px] bg-pop p-[20px] shadow-[var(--shadow)]">
        <h5 className="m-0 text-[15px] leading-[22px] font-normal text-ink">Delete {w.name}?</h5>
        <p className="m-0 text-[13px] leading-[18px] text-ink-3">It stops checking, and its history is deleted. This can’t be undone.</p>
        <div className="mt-[10px] flex items-center justify-end gap-[6px]">
          <button type="button" className={btn()} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            className="inline-flex h-[28px] cursor-pointer items-center rounded-[6px] border-0 bg-bad px-[12px] text-[13px] text-white outline-none focus:shadow-[0_0_0_2px_var(--pop),0_0_0_4px_var(--brand)]"
            onClick={() => {
              onClose()
              void deleteWatch(w.id)
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
