import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

import { useMotion } from "@/lib/motion"

import { CheckIcon } from "./Icons"

/**
 * A floating panel that scales and fades from its anchor. The parent places it (absolute);
 * clicking outside it or pressing Escape closes it.
 */
export function Popover({
  open,
  onClose,
  anchor,
  origin = "bottom left",
  className = "",
  label,
  role = "menu",
  at,
  children,
}: {
  /** Window coordinates, for menus that must escape a scrolling list (drawn in a portal). */
  at?: { top: number; left: number }
  open: boolean
  onClose: () => void
  anchor?: RefObject<HTMLElement | null>
  origin?: string
  className?: string
  label?: string
  role?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const m = useMotion()

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.current?.contains(t)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("keydown", key, true)
    return () => {
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("keydown", key, true)
    }
  }, [open, onClose, anchor])

  const pop = m.pop(origin)
  const panel = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role={role}
          aria-label={label}
          {...pop}
          style={at ? { ...pop.style, top: at.top, left: at.left } : pop.style}
          className={`${at ? "fixed" : "absolute"} z-40 box-border w-max min-w-[160px] max-w-[320px] rounded-[10px] border-0 bg-pop p-[4px] font-sans text-[13px] text-muted-foreground shadow-card ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
  return at ? createPortal(panel, document.body) : panel
}

export function MenuItem({
  icon,
  children,
  hint,
  danger,
  onSelect,
  active,
  disabled,
  title,
}: {
  icon?: ReactNode
  children: ReactNode
  hint?: ReactNode
  danger?: boolean
  active?: boolean
  /** Greyed and not clickable; `title` says why. */
  disabled?: boolean
  title?: string
  onSelect: () => void
}) {
  return (
    <MenuRow role="menuitem" icon={icon} hint={hint} danger={danger} hot={active} disabled={disabled} title={title} onSelect={onSelect}>
      {children}
    </MenuRow>
  )
}

/**
 * The one row every menu uses: one line, an optional logo or icon, a muted hint on the right, and a
 * tick for the current choice. No status words, no second line; detail goes in `title` (on hover).
 */
export function MenuRow({
  icon,
  children,
  hint,
  checked,
  danger,
  hot,
  disabled,
  title,
  role = "menuitem",
  onSelect,
  onHover,
}: {
  icon?: ReactNode
  children: ReactNode
  hint?: ReactNode
  /** The current choice: a tick at the end, and `aria-checked`/`aria-selected` for the role. */
  checked?: boolean
  danger?: boolean
  /** Highlighted (keyboard cursor or hover). */
  hot?: boolean
  disabled?: boolean
  title?: string
  role?: "menuitem" | "menuitemradio" | "option"
  onSelect: () => void
  onHover?: () => void
}) {
  const state = role === "option" ? { "aria-selected": !!checked } : role === "menuitemradio" ? { "aria-checked": !!checked } : {}
  return (
    <button
      role={role}
      {...state}
      title={title}
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`flex h-[28px] w-full shrink-0 items-center gap-[8px] rounded-[6px] border-0 px-[8px] text-left text-[13px] outline-none transition-colors duration-150 focus-visible:bg-fill-2 focus-visible:ring-1 focus-visible:ring-brand-text disabled:opacity-50 ${
        danger ? "text-destructive" : "text-foreground"
      } ${checked ? "bg-brand-soft" : hot ? "bg-fill-2" : "bg-transparent hover:bg-fill-2"}`}
    >
      {icon && <span className={`flex min-w-[18px] shrink-0 items-center justify-center ${danger ? "text-destructive" : "text-ink-3"}`}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="ml-[16px] shrink-0 text-[13px] text-ink-3">{hint}</span>}
      {checked && <CheckIcon size={14} className="shrink-0 text-brand-text" />}
    </button>
  )
}

/** A small grey heading over a group of rows. */
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="box-border h-[24px] px-[8px] pt-[6px] text-[12px] text-ink-3">{children}</div>

export const MenuLine = () => <div role="separator" className="mx-[4px] my-[4px] h-px shrink-0 bg-fill-3" />
