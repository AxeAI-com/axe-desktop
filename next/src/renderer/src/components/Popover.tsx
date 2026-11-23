import { AnimatePresence, motion } from "motion/react"
import { createContext, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

import { useMotion } from "@/lib/motion"

/** A compact menu (Draft 3's `.cx-menu`): 28 px rows, 4 px padding, radius 10, labels and details in ink-4. */
const Dense = createContext(true)

/** Draft 3's menu panel, for the few lists that draw their own rows (slash, mention, palette). */
export const menuPanel = "popover-new box-border rounded-[10px] border-0 bg-[var(--cx-pop)] p-[4px] text-[13px] text-[var(--cx-ink)] shadow-[var(--cx-menu-shadow)]"
/** A 28 px row at radius 6 for those lists; `hot` is the keyboard cursor. */
export const menuRowClass = (hot: boolean) =>
  `flex min-h-[28px] cursor-default items-center gap-[8px] rounded-[6px] px-[8px] text-[13px] transition-colors duration-150 ease-out ${hot ? "bg-[var(--cx-hover)]" : ""}`
/** A group's label in those lists. */
export const menuLabelClass = "px-[8px] pt-[6px] pb-[2px] text-[12px] leading-[16px] text-[var(--cx-ink4)]"

/** Keeps an open panel inside the window and under the title bar: flips below its anchor when there is more room
 * there, else caps its height to the room it has and lets it scroll. */
export function fit(el: HTMLElement, anchor: HTMLElement | null | undefined) {
  el.style.maxHeight = ""
  const top = (document.querySelector("[data-titlebar]")?.getBoundingClientRect().bottom ?? 0) + 8
  const bottom = window.innerHeight - 8
  let r = el.getBoundingClientRect()
  const a = anchor?.getBoundingClientRect()
  const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect()
  if (a && parent && r.top < top && r.bottom <= a.top + 1 && bottom - a.bottom > a.top - top) {
    el.style.top = `${a.bottom - parent.top + 4}px`
    el.style.bottom = "auto"
    r = el.getBoundingClientRect()
  }
  const room = r.top < top ? r.bottom - top : r.bottom > bottom ? bottom - r.top : 0
  if (room > 0) {
    el.style.maxHeight = `${Math.max(120, room)}px`
    el.style.overflowY = "auto"
  }
}

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
  dense: denseProp,
  children,
}: {
  /**
   * Compact (Draft 3, 2026-11-08): 28 px rows, 4 px padding, radius 10, 220 to 300 wide, a hairline and one soft
   * shadow, labels and details in ink-4, a "✓" for the current item. On for menus and lists; a `dialog` keeps the
   * same panel look and lays out its own content. Only the frozen sidebar's account card turns it off.
   */
  dense?: boolean
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
  const dense = denseProp ?? true
  // A caller's own width or padding wins over the defaults.
  const width = /(^|\s)!?(min-w|max-w|w)-/.test(className) ? "" : "min-w-[220px] max-w-[300px]"
  const pad = /(^|\s)!?p-/.test(className) ? "" : "p-[4px]"

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

  useLayoutEffect(() => {
    if (open && !at && ref.current) fit(ref.current, anchor?.current)
  }, [open, at, anchor])

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
          className={`popover-new ${at ? "fixed" : "absolute"} z-40 box-border w-max font-sans text-[13px] text-ink-3 ${
            dense
              ? `${width} ${pad} rounded-[10px] border-0 bg-[var(--cx-pop)] text-[var(--cx-ink)] shadow-[var(--cx-menu-shadow)]`
              : "min-w-[160px] max-w-[320px] rounded-3xl border border-hairline bg-pop p-[8px]"
          } ${className}`}
        >
          <Dense.Provider value={dense}>{children}</Dense.Provider>
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
  sub,
  warn,
  onSelect,
  onHover,
}: {
  /** Compact menus: a second line under the name, 12 px in ink-3. */
  sub?: string
  /** Compact menus: the name in the warn colour (Full access). */
  warn?: boolean
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
        className={`group flex min-h-[28px] w-full shrink-0 cursor-pointer items-center gap-[8px] rounded-[6px] border-0 px-[8px] text-left text-[13px] outline-none transition-colors duration-150 ease-out focus-visible:bg-[var(--cx-hover)] disabled:cursor-default disabled:opacity-50 ${sub ? "py-[5px]" : ""} ${
          danger ? "text-destructive" : warn ? "text-[var(--cx-warn)]" : "text-[var(--cx-ink)]"
        } ${hot ? "bg-[var(--cx-hover)]" : "bg-transparent hover:bg-[var(--cx-hover)]"}`}
      >
        {icon && <span className="flex w-[14px] shrink-0 items-center justify-center text-[var(--cx-ink3)]">{icon}</span>}
        {sub ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{children}</span>
            <span className="truncate text-[12px] leading-[16px] text-[var(--cx-ink3)]">{sub}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{children}</span>
        )}
        {hint && <span className="flex shrink-0 items-center pl-[16px] text-[13px] text-[var(--cx-ink4)]">{hint}</span>}
        {checked && <span className="shrink-0 pl-[16px] text-[var(--cx-ink4)]">✓</span>}
      </button>
  )
}

/** A small grey heading over a group of rows. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className={menuLabelClass}>{children}</div>
}

export function MenuLine() {
  return <div role="separator" className="mx-[6px] my-[4px] h-px shrink-0 bg-[var(--cx-sep)]" />
}
