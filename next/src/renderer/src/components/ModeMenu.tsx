import { AnimatePresence, motion } from "motion/react"
import { useCallback, useRef, useState } from "react"

import type { AgentMode } from "@shared/types"

import { inTrayWindow } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"
import { modeOf, setMode, useStore } from "@/lib/store"

import { AlertIcon, ChatIcon, ChecklistIcon, PencilIcon } from "./SolarIcons"
import { ChevronDown as LineChevron } from "./Icons"
import { underControl } from "./Kit"
import { MenuRow, Popover } from "./Popover"

/** The four modes, in the order the menu lists them. */
export const MODE_INFO: { mode: AgentMode; name: string; note: string; short: string }[] = [
  { mode: "ask", name: "Ask before changes", note: "It asks before editing files or running commands.", short: "Asks before editing or running commands" },
  { mode: "acceptEdits", name: "Accept edits", note: "It edits files freely and asks before commands.", short: "Asks only before commands" },
  { mode: "plan", name: "Plan first", note: "It reads and plans; nothing changes until you start.", short: "Reads and plans; nothing changes until you start" },
  { mode: "full", name: "Full access", note: "It acts without asking. Everything still shows here.", short: "Acts without asking" },
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

  const iconOnly = inTrayWindow()
  const Icon = MODE_ICON[mode]

  return (
    <div className="relative shrink-0">
      <Popover dense open={open} onClose={close} anchor={anchor} origin="bottom left" className="bottom-[calc(100%+6px)] left-0" label="How much it may do">
        {MODE_INFO.map((info) => (
          <MenuRow
            key={info.mode}
            role="menuitemradio"
            checked={info.mode === mode}
            sub={info.short}
            title={info.note}
            warn={info.mode === "full"}
            onSelect={() => {
              close()
              void setMode(threadId, info.mode)
            }}
          >
            {info.name}
          </MenuRow>
        ))}
      </Popover>
      <button
        ref={anchor}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mode: ${modeName(mode)}`}
        title={iconOnly ? `${modeName(mode)} (Shift+Tab)` : "How much it may do (Shift+Tab)"}
        onClick={() => setOpen((o) => !o)}
        // Draft 3's `.cb`: plain text and a chevron; Full access in the warn colour.
        className={`${underControl(open)} ${mode === "full" ? "!text-[var(--cx-warn)]" : ""}`}
      >
        <span className="flex items-center gap-[6px] whitespace-nowrap">{iconOnly ? <Icon size={14} /> : modeName(mode)}</span>
        {!iconOnly && <LineChevron size={12} className="opacity-70" />}
      </button>
    </div>
  )
}
