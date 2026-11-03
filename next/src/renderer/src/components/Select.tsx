import { Children, isValidElement, useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react"

import { ChevronDown } from "./Icons"
import { MenuLabel, MenuLine, MenuRow, Popover } from "./Popover"

type Item = { value: string; label: ReactNode } | { group: string }

/** Reads `<option>` and `<optgroup>` children so callers keep writing them like a native select. */
function items(children: ReactNode, out: Item[] = []): Item[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return
    const el = c as ReactElement<{ value?: string; label?: string; children?: ReactNode }>
    if (el.type === "optgroup") {
      out.push({ group: el.props.label ?? "" })
      items(el.props.children, out)
    } else if (el.type === "option") out.push({ value: el.props.value ?? String(el.props.children ?? ""), label: el.props.children })
    else items(el.props.children, out)
  })
  return out
}

/**
 * The one dropdown for a short list of choices: a content-width 28px trigger (label, small chevron) and the
 * shared compact menu under it. Arrows, Home/End, Enter and Space pick, Escape closes and returns focus.
 */
export function Select({ value, onChange, children, label, className = "" }: { value: string; onChange: (v: string) => void; children: ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const anchor = useRef<HTMLButtonElement>(null)
  const id = useId()
  const list = useMemo(() => items(children), [children])
  const options = list.filter((i): i is Extract<Item, { value: string }> => "value" in i)
  const current = options.find((o) => o.value === value)

  const show = () => {
    setCursor(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const close = useCallback(() => {
    setOpen(false)
    anchor.current?.focus()
  }, [])
  const pick = (v: string) => {
    onChange(v)
    close()
  }
  const key = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        show()
      }
      return
    }
    const n = options.length
    if (e.key === "ArrowDown") setCursor((c) => (c + 1) % n)
    else if (e.key === "ArrowUp") setCursor((c) => (c + n - 1) % n)
    else if (e.key === "Home") setCursor(0)
    else if (e.key === "End") setCursor(n - 1)
    else if (e.key === "Enter" || e.key === " ") {
      const o = options[cursor]
      if (o) pick(o.value)
    } else if (e.key === "Tab") setOpen(false)
    else return
    e.preventDefault()
  }

  let n = -1
  return (
    <span className={`relative inline-block max-w-full ${className}`} onKeyDown={key}>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : show())}
        className="box-border inline-flex h-[28px] max-w-full items-center gap-[6px] rounded-[6px] border-0 bg-fill-4 pr-[8px] pl-[10px] text-[13px] text-ink outline-none focus-visible:ring-1 focus-visible:ring-brand-text"
      >
        <span className="truncate">{current?.label ?? ""}</span>
        <ChevronDown size={12} className="shrink-0 text-ink-3" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} origin="top left" role="listbox" label={label} className="top-[calc(100%+4px)] left-0 max-h-[320px] overflow-y-auto">
        <div id={id} className="flex flex-col">
          {list.map((it, k) => {
            if ("group" in it) return [k > 0 && <MenuLine key={`l${k}`} />, it.group && <MenuLabel key={`g${k}`}>{it.group}</MenuLabel>]
            n++
            const i = n
            return (
              <MenuRow key={it.value} role="option" checked={it.value === value} hot={i === cursor} onHover={() => setCursor(i)} onSelect={() => pick(it.value)}>
                {it.label}
              </MenuRow>
            )
          })}
        </div>
      </Popover>
    </span>
  )
}
