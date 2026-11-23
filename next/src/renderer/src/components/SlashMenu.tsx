import { AnimatePresence, motion } from "motion/react"
import { useEffect, useLayoutEffect, useRef } from "react"

import { useMotion } from "@/lib/motion"
import type { SlashItem } from "@/lib/slash"

import { fit, menuLabelClass, menuPanel, menuRowClass } from "./Popover"

const GROUPS: { source: SlashItem["source"]; title: string }[] = [
  { source: "watching", title: "Oversight" },
  { source: "agent", title: "Commands" },
  { source: "skill", title: "Skills" },
  { source: "helper", title: "Agents" },
  { source: "axe", title: "Axe" },
]

/** The / menu above the composer: what the agent offers, its skills, then Axe's starters. */
export function SlashMenu({
  open,
  items,
  selected,
  agentName,
  onPick,
  onHover,
  className = "",
}: {
  open: boolean
  items: SlashItem[]
  selected: number
  agentName?: string
  onPick: (item: SlashItem) => void
  onHover: (i: number) => void
  className?: string
}) {
  const m = useMotion()
  const list = useRef<HTMLDivElement>(null)
  const pop = m.pop("bottom left")

  // Never past the window's top or over the title bar: cap the height to the room above the composer.
  useLayoutEffect(() => {
    if (open && list.current) fit(list.current, null)
  }, [open, items.length])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${selected}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selected])

  let i = -1
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...pop}
          ref={list}
          role="listbox"
          aria-label="Commands"
          className={`scroll absolute z-40 max-h-[320px] w-max min-w-[220px] max-w-[420px] overflow-y-auto ${menuPanel} ${className}`}
        >
          {items.length === 0 && <div className="px-[8px] py-[6px] text-[13px] text-[var(--cx-ink3)]">No command by that name</div>}
          {GROUPS.map((g) => {
            const group = items.filter((x) => x.source === g.source)
            if (!group.length) return null
            return (
              <div key={g.source} className="flex flex-col">
                <div className={menuLabelClass}>
                  {g.source === "axe" || g.source === "helper" || g.source === "watching" || !agentName ? g.title : `${g.title} from ${agentName}`}
                </div>
                {group.map((item) => {
                  i++
                  const n = i
                  const on = n === selected
                  return (
                    <div
                      key={`${item.source}:${item.name}`}
                      role="option"
                      aria-selected={on}
                      data-i={n}
                      onPointerMove={() => !on && onHover(n)}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        onPick(item)
                      }}
                      className={menuRowClass(on)}
                    >
                      {item.source === "watching" ? (
                        // Watching's commands: the name, and what it does on the right.
                        <>
                          <span className="shrink-0">/{item.name}</span>
                          <span className="ml-auto min-w-0 truncate pl-[16px] text-[var(--cx-ink4)]">{item.description}</span>
                        </>
                      ) : (
                        <>
                          <span className="w-[140px] shrink-0 truncate">/{item.name}</span>
                          <span className="min-w-0 flex-1 truncate text-[var(--cx-ink4)]">{item.description}</span>
                          {item.hint && <span className="max-w-[120px] shrink-0 truncate text-[var(--cx-ink4)]">{item.hint}</span>}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
