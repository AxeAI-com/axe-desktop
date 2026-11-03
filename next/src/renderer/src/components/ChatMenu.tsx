import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

import type { ThreadSummary } from "@shared/types"

import { useMotion } from "@/lib/motion"
import { archiveThread, deleteThread, pinThread } from "@/lib/store"

import { ArchiveIcon, PencilIcon, PinIcon, TrashIcon } from "./Icons"
import { MenuItem, MenuLine } from "./Popover"

/** Rename, Pin, Archive, Delete (Delete asks first, in place). */
/** `noDelete`: a watch's chat, whose menu deletes the watch itself instead. */
export function ChatMenuItems({ thread, onRename, close, noDelete = false }: { thread: ThreadSummary; onRename: () => void; close: () => void; noDelete?: boolean }) {
  const [confirm, setConfirm] = useState(false)
  const m = useMotion()
  return (
    <AnimatePresence mode="wait" initial={false}>
      {confirm ? (
        <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={m.t(0.12)} className="p-2">
          <div className="text-[13px] text-ink">Delete this chat?</div>
          <div className="mt-1 text-[13px] leading-[18px] text-ink-3">It's gone for good. Archive keeps it out of the way instead.</div>
          <div className="mt-3 flex gap-1.5">
            <button
              autoFocus
              onClick={() => {
                close()
                void deleteThread(thread.id)
              }}
              className="h-[30px] rounded-[6px] border-0 bg-bad px-3 text-[13px] text-white hover:opacity-90"
            >
              Delete
            </button>
            <button onClick={() => setConfirm(false)} className="h-[30px] rounded-[6px] border-0 bg-transparent px-2.5 text-[13px] text-ink-2 hover:bg-fill-2">
              Cancel
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div key="items" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={m.t(0.12)}>
          <MenuItem
            icon={<PencilIcon size={14} />}
            onSelect={() => {
              close()
              onRename()
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={<PinIcon size={14} />}
            onSelect={() => {
              close()
              void pinThread(thread.id, !thread.pinned)
            }}
          >
            {thread.pinned ? "Unpin" : "Pin"}
          </MenuItem>
          <MenuItem
            icon={<ArchiveIcon size={14} />}
            onSelect={() => {
              close()
              void archiveThread(thread.id)
            }}
          >
            Archive
          </MenuItem>
          {!noDelete && (
            <>
              <MenuLine />
              <MenuItem danger icon={<TrashIcon size={14} />} onSelect={() => setConfirm(true)}>
                Delete
              </MenuItem>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
