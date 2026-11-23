import type { ReactNode } from "react"

// The kit: every screen is built from these few parts. Flat: a fill and one faint hairline, no gradients, no shadows.
// Controls follow Draft 3's mock (2026-11-08): 32 high at radius 8, or 28 at radius 7; containers 24, media 16.
// Type: 28 greeting, 20 titles, 15 reading, 13 controls, 12 hints, regular weight. Hover is 150 ms ease-out:
// a faint fill appears and the label goes to ink. Nothing scales or slides.

/** Hover for a control: background and colour, 150 ms. */
export const press = "transition-[background-color,color,opacity] duration-150 ease-out"

/** A card: the card fill at 24px, raised on hover. No shadow. */
export const card = "rounded-3xl border-0 bg-card text-left transition-colors duration-150 ease-out hover:bg-raised"

/** Buttons, 32 high at radius 8 (28 at radius 7 with `compact`). One primary per view, and it is the only Axe Blue. */
export const button = {
  primary: `inline-flex h-[32px] shrink-0 items-center justify-center gap-[6px] rounded-[8px] border-0 bg-brand px-[12px] text-[13px] text-white hover:bg-brand-hover disabled:opacity-40 ${press}`,
  secondary: `inline-flex h-[32px] shrink-0 items-center justify-center gap-[6px] rounded-[8px] border-0 bg-fill-2 px-[12px] text-[13px] text-ink enabled:hover:bg-fill-3 disabled:opacity-40 ${press}`,
  ghost: `inline-flex h-[32px] shrink-0 items-center justify-center gap-[6px] rounded-[8px] border-0 bg-transparent px-[10px] text-[13px] text-ink-3 enabled:hover:bg-fill-2 enabled:hover:text-ink disabled:opacity-40 ${press}`,
  /** Remove, Sign out, Delete: secondary with the status red. */
  danger: `inline-flex h-[32px] shrink-0 items-center justify-center gap-[6px] rounded-[8px] border-0 bg-fill-2 px-[12px] text-[13px] text-bad enabled:hover:bg-fill-3 disabled:opacity-40 ${press}`,
}

/** The same buttons at 28 high, radius 7. */
export const compact = (cls: string) => cls.replace("h-[32px]", "h-[28px]").replace("rounded-[8px]", "rounded-[7px]").replace("px-[12px]", "px-[10px]")

/** An icon button: 28 at radius 7 (32 at radius 8 with `main`), the icon in ink-3 until hover. */
export const iconButton = (main = false) =>
  `inline-flex ${main ? "size-[32px] rounded-[8px]" : "size-[28px] rounded-[7px]"} shrink-0 items-center justify-center border-0 bg-transparent text-ink-3 enabled:hover:bg-fill-2 enabled:hover:text-ink disabled:opacity-40 ${press}`

/** A text field: 32 high, radius 8, the input fill. */
export const inputClass =
  "box-border h-[32px] w-full rounded-[8px] border-0 bg-fill px-[10px] text-[13px] leading-[20px] text-ink outline-none transition-colors duration-150 ease-out placeholder:text-ink-4 focus:bg-fill-2"

/**
 * A text control in the row under the composer (Draft 3's `.cb`): 28 px, radius 7, 13 px in ink-3; on hover or
 * while its menu is open a faint fill and ink. 14 px icons, a 12 px chevron at 70%.
 */
export const underControl = (on = false) =>
  `inline-flex h-[28px] min-w-0 shrink-0 cursor-pointer items-center gap-[6px] rounded-[7px] border-0 px-[8px] text-[13px] whitespace-nowrap transition-colors duration-150 ease-out ${
    on ? "bg-[var(--cx-hover)] text-[var(--cx-ink)]" : "bg-transparent text-[var(--cx-ink3)] hover:bg-[var(--cx-hover)] hover:text-[var(--cx-ink)]"
  }`

/** The same row's plain text, for what can't change here (an agent chat's folder). */
export const underText = "inline-flex h-[28px] min-w-0 shrink-0 items-center gap-[6px] px-[8px] text-[13px] whitespace-nowrap text-[var(--cx-ink3)]"

/** The composer's 32 px icon buttons (Draft 3's `.cx-ib`): radius 8, ink-2; a faint fill and ink on hover. */
export const boxButton = (on = false) =>
  `grid size-[32px] shrink-0 cursor-pointer place-items-center rounded-[8px] border-0 transition-colors duration-150 ease-out disabled:opacity-40 ${
    on ? "bg-[var(--cx-hover)] text-[var(--cx-ink)]" : "bg-transparent text-[var(--cx-ink2)] hover:bg-[var(--cx-hover)] hover:text-[var(--cx-ink)]"
  }`

/** A chip in a composer's row: 32 high, pill, secondary; on = raised and full ink. */
export const chip = (on = false) =>
  `inline-flex h-[32px] shrink-0 items-center gap-[8px] rounded-full border-0 px-[12px] text-[13px] ${press} ${on ? "bg-fill-2 text-ink" : "bg-transparent text-ink-3 hover:bg-fill-2 hover:text-ink"}`

/**
 * The one switch, 34 by 20: on is an ink track with a knob in the page colour, off is a grey track with a light knob.
 * With `onChange` it is a button; without, it only shows the state (inside a clickable menu row).
 */
export function Switch({ on, label, onChange }: { on: boolean; label?: string; onChange?: (on: boolean) => void }) {
  const track = `relative inline-block h-[20px] w-[34px] shrink-0 rounded-full border-0 p-0 transition-colors duration-150 ease-out ${on ? "bg-ink" : "bg-[var(--switch-off)]"}`
  const knob = (
    <span
      className={`absolute top-[2px] size-[16px] rounded-full transition-[left] duration-150 ease-out ${on ? "left-[16px] bg-background" : "left-[2px] bg-[var(--knob)] shadow-[0_0_0_0.5px_var(--knob-edge)]"}`}
    />
  )
  if (!onChange)
    return (
      <span role="switch" aria-checked={on} aria-label={label} className={`pointer-events-none ${track}`}>
        {knob}
      </span>
    )
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={(e) => (e.stopPropagation(), onChange(!on))} className={`cursor-pointer ${track}`}>
      {knob}
    </button>
  )
}

/** The one icon tile (starters, skills, agents): a flat raised circle with the icon in ink. */
export function IconTile({ children, size = 32 }: { children: ReactNode; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-raised text-ink">
      {children}
    </span>
  )
}

/** A starter card: 24px radius, 24 padding, the icon tile on top, title and one line at the bottom. */
export function StarterCard({ icon, title, note, onClick, dashed }: { icon: ReactNode; title: string; note: string; onClick: () => void; dashed?: boolean }) {
  return (
    <button onClick={onClick} className={`${card} flex h-[148px] flex-col items-start gap-[16px] p-[24px] ${dashed ? "bg-transparent outline-1 outline-dashed outline-line-3" : ""}`}>
      {icon}
      <span className="flex flex-col gap-[4px]">
        <span className="text-[15px] leading-[20px] text-ink">{title}</span>
        <span className="line-clamp-2 text-[13px] leading-[18px] text-ink-3">{note}</span>
      </span>
    </button>
  )
}

/** Shortcut keycaps, the one style everywhere: each key 20 px at radius 5, the input fill, 12 px ink-3, 4 px apart. */
export function Keycaps({ keys }: { keys: string }) {
  const mods = keys.match(/^[⌘⌥⇧⌃]*/)?.[0] ?? ""
  const rest = keys.slice(mods.length)
  const parts = keys.length > 1 && keys.includes("+") ? [keys] : [...Array.from(mods), ...(rest ? [rest] : [])]
  return (
    <span className="flex shrink-0 items-center gap-1">
      {parts.map((k, i) => (
        <kbd key={i} className="flex h-[20px] min-w-[20px] items-center justify-center rounded-[5px] border-0 bg-fill px-[5px] font-sans text-[12px] leading-none text-ink-3">
          {k}
        </kbd>
      ))}
    </span>
  )
}

/** The one empty state: a 13 px line in ink-3, left-aligned in its list, with an optional action link after it. */
export function Empty({ children, action }: { children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <p className="m-0 py-[6px] text-left text-[13px] leading-[20px] text-ink-3">
      {children}
      {action && (
        <>
          {" "}
          <button type="button" onClick={action.onClick} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">
            {action.label}
          </button>
        </>
      )}
    </p>
  )
}
