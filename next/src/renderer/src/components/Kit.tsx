import type { ReactNode } from "react"

// The kit (board "Redesign 2", 2026-10-26): every screen is built from these few parts. Flat: a fill and
// one faint hairline, no gradients and nothing that lifts. Four text sizes (20, 15, 13, 12), three corners
// (6 controls, 10 cards and menus, 16 the composer and sheets).

/** A card (Raycast style): block fill, radius 16, no border. */
export const card = "rounded-[16px] border-0 bg-card text-left shadow-card transition-colors duration-150 hover:bg-raised"

/** Pill buttons, 34 high (28 with `small`). One primary per view. */
export const button = {
  primary: "inline-flex h-[34px] items-center justify-center rounded-full border-0 bg-primary px-4 text-[13px] text-primary-foreground transition-opacity duration-150 hover:opacity-85 disabled:opacity-40",
  secondary: "inline-flex h-[34px] items-center justify-center rounded-full border-0 bg-fill-4 px-4 text-[13px] text-foreground transition-colors duration-150 hover:bg-fill-3 disabled:opacity-40",
  brand: "inline-flex h-[34px] items-center justify-center rounded-full border-0 bg-brand px-4 text-[13px] text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-40",
  ghost: "inline-flex h-[34px] items-center justify-center rounded-full border-0 bg-transparent px-3 text-[13px] text-ink-3 transition-colors duration-150 hover:bg-fill hover:text-ink disabled:opacity-40",
}

/** A chip in a composer's row: 28 high, pill, ink3; on = fill2 and full ink. */
export const chip = (on = false) =>
  `inline-flex h-[28px] shrink-0 items-center gap-[6px] rounded-full border-0 px-[10px] text-[13px] transition-colors duration-150 ${on ? "bg-fill-2 text-ink" : "bg-transparent text-ink-3 hover:bg-fill hover:text-ink"}`

/** The 34 by 20 switch: on is Axe Blue, off is white 16%, a 16 px white knob. */
export function Switch({ on, label }: { on: boolean; label?: string }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`pointer-events-none relative inline-block h-5 w-[34px] shrink-0 rounded-full transition-colors duration-150 ${on ? "bg-brand" : "bg-fill-4"}`}
    >
      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] duration-150 ${on ? "left-[16px]" : "left-0.5"}`} />
    </span>
  )
}

/** The coloured square behind a starter card's icon. */
export function IconTile({ tone, children, size = 22 }: { tone: "brand" | "live" | "warn" | "bad" | "violet" | "ink" | "mute"; children: ReactNode; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }} className={`flex shrink-0 items-center justify-center text-white tile-${tone}`}>
      {children}
    </span>
  )
}

/** A starter card: 148 high, the icon tile on top, title and one line at the bottom. */
export function StarterCard({ icon, title, note, onClick, dashed }: { icon: ReactNode; title: string; note: string; onClick: () => void; dashed?: boolean }) {
  return (
    <button onClick={onClick} className={`${card} flex h-[148px] flex-col items-start gap-[18px] p-[16px] ${dashed ? "bg-transparent outline-1 outline-dashed outline-fill-3" : ""}`}>
      {icon}
      <span className="flex flex-col gap-[4px]">
        <span className="text-[15px] leading-[20px] text-ink">{title}</span>
        <span className="line-clamp-2 text-[13px] leading-[18px] text-ink-3">{note}</span>
      </span>
    </button>
  )
}

/** Shortcut keycaps: each key a 22 px rounded square, white 8%, 12 px ink2, 4 px apart. */
export function Keycaps({ keys }: { keys: string }) {
  const mods = keys.match(/^[⌘⌥⇧⌃]*/)?.[0] ?? ""
  const rest = keys.slice(mods.length)
  const parts = keys.length > 1 && keys.includes("+") ? [keys] : [...Array.from(mods), ...(rest ? [rest] : [])]
  return (
    <span className="flex shrink-0 items-center gap-1">
      {parts.map((k, i) => (
        <kbd key={i} className="flex h-[22px] min-w-[22px] items-center justify-center rounded-md border-0 bg-fill-2 px-1.5 font-sans text-[12px] text-ink-2">
          {k}
        </kbd>
      ))}
    </span>
  )
}

/** A menu row with a 16 px radio on the left: selected is a brand dot, not selected a ring (a shadow, no border). */
export function RadioRow({ checked, disabled, hint, title, onSelect, children }: { checked: boolean; disabled?: boolean; hint?: ReactNode; title?: string; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      role="menuitemradio"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-9 w-full shrink-0 items-center gap-3 rounded-[10px] border-0 px-2.5 text-left text-[14px] text-foreground transition-colors duration-150 disabled:opacity-50 ${checked ? "bg-brand-soft" : "bg-transparent hover:bg-fill-2"}`}
    >
      <span aria-hidden="true" className={`flex size-4 shrink-0 items-center justify-center rounded-full ${checked ? "bg-brand" : "shadow-[inset_0_0_0_1.5px_var(--ink-4)]"}`}>
        {checked && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[13px] text-ink-3">{hint}</span>}
    </button>
  )
}
