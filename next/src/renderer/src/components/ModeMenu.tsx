import { AnimatePresence, motion } from "motion/react"
import { useCallback, useRef, useState } from "react"

import type { AgentMode } from "@shared/types"

import { inTrayWindow } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"
import { modeOf, setMode, useStore } from "@/lib/store"

import { AlertIcon, ChatIcon, ChecklistIcon, ChevronDown, PencilIcon } from "./Icons"
import { ShieldMark } from "./ai/board-icons"
import { MenuRow, Popover } from "./Popover"

/** The four modes, in the order the menu lists them. */
export const MODE_INFO: { mode: AgentMode; name: string; note: string }[] = [
  { mode: "ask", name: "Ask before changes", note: "It asks before editing files or running commands." },
  { mode: "acceptEdits", name: "Accept edits", note: "It edits files freely and asks before commands." },
  { mode: "plan", name: "Plan first", note: "It reads and plans; nothing changes until you start." },
  { mode: "full", name: "Full access", note: "It acts without asking. Everything still shows here." },
]

export const modeName = (mode: AgentMode) => MODE_INFO.find((m) => m.mode === mode)!.name

/** Each mode as a small mark, for the menu bar's chat where only the icon shows. */
const MODE_ICON: Record<AgentMode, typeof ChatIcon> = { ask: ChatIcon, acceptEdits: PencilIcon, plan: ChecklistIcon, full: AlertIcon }

/** Shift+Tab in the composer steps through the modes, like the CLIs do. */
export function nextMode(mode: AgentMode): AgentMode {
  const i = MODE_INFO.findIndex((m) => m.mode === mode)
  return MODE_INFO[(i + 1) % MODE_INFO.length]!.mode
}

/**
 * How much an agent may do on its own, next to the composer: names only, a tick on the current one,
 * and one line under the list that explains it.
 */
export function ModeMenu({ threadId, size = "docked" }: { threadId?: string; size?: "start" | "docked" }) {
  const mode = useStore((s) => modeOf(threadId, s))
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const m = useMotion()

  // Full access in orange text and Plan in the accent, so neither is missed; no filled box, no icon.
  const tone =
    mode === "full"
      ? "text-warn-ink hover:bg-fill"
      : mode === "plan"
        ? "text-accent-ink hover:bg-fill"
        : open
          ? "bg-fill-2 text-ink"
          : "bg-transparent text-ink-3 hover:bg-fill hover:text-ink-2"
  const note = MODE_INFO.find((m) => m.mode === mode)!.note
  const iconOnly = inTrayWindow()
  const Icon = MODE_ICON[mode]

  return (
    <div className="relative shrink-0">
      <Popover open={open} onClose={close} anchor={anchor} origin="bottom left" className="bottom-[calc(100%+8px)] left-0" label="How much it may do">
        {MODE_INFO.map((info, i) => (
          <MenuRow
            key={info.mode}
            role="menuitemradio"
            checked={info.mode === mode}
            hint={i === 0 && info.mode !== mode ? "⇧Tab" : undefined}
            title={info.note}
            onSelect={() => {
              close()
              void setMode(threadId, info.mode)
            }}
          >
            {info.name}
          </MenuRow>
        ))}
        <p className="m-0 px-2.5 pt-1.5 pb-1 text-[12px] leading-[17px] text-ink-3">{note}</p>
      </Popover>
      <button
        ref={anchor}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mode: ${modeName(mode)}`}
        title={iconOnly ? `${modeName(mode)} (Shift+Tab)` : "How much it may do (Shift+Tab)"}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full border-0 px-2.5 text-[13px] transition-[background-color,color,filter] duration-150 ${size === "start" ? "h-8" : "h-7"} ${tone}`}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={mode}
            initial={{ opacity: 0, y: m.reduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: m.reduced ? 0 : -4 }}
            transition={m.t(0.12)}
            className="flex items-center gap-1.5 whitespace-nowrap"
          >
            {iconOnly ? <Icon size={14} /> : <ShieldMark size={14} />}
            {!iconOnly && modeName(mode)}
          </motion.span>
        </AnimatePresence>
        {!iconOnly && <ChevronDown size={12} className="text-ink-4" />}
      </button>
    </div>
  )
}
