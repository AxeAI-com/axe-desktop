import { AnimatePresence, motion } from "motion/react"
import { useEffect, useLayoutEffect, useRef } from "react"

import type { MentionItem, MentionKind } from "@/lib/mentions"
import { useMotion } from "@/lib/motion"

import { fit, menuLabelClass, menuPanel, menuRowClass } from "./Popover"
import { ChatIcon, EyeIcon, FolderIcon, MonitorIcon, PlugIcon } from "./SolarIcons"
import { KindIcon } from "./WatchIcons"

type Group = { kinds: MentionKind[]; title: string }
const WATCHES: Group = { kinds: ["watch"], title: "Checks" }
const FOLDERS: Group = { kinds: ["folder"], title: "Folders" }
const REST: Group[] = [
  { kinds: ["connector", "app"], title: "Apps" },
  { kinds: ["chat"], title: "Chats" },
]
/** Watches come first on Watching; in a chat they come after Folders. */
const groups = (watchesFirst: boolean): Group[] => (watchesFirst ? [WATCHES, FOLDERS, ...REST] : [FOLDERS, WATCHES, ...REST])

const ICON: Record<MentionKind, (p: { size?: number }) => React.ReactNode> = { watch: EyeIcon, folder: FolderIcon, connector: PlugIcon, app: MonitorIcon, chat: ChatIcon }

/** The @ menu above the composer: folders, watches, apps, then chats. Same look and keys as the / menu. */
export function MentionMenu({
  open,
  items,
  selected,
  onPick,
  onHover,
  watchesFirst = false,
  className = "",
}: {
  open: boolean
  items: MentionItem[]
  selected: number
  onPick: (item: MentionItem) => void
  onHover: (i: number) => void
  watchesFirst?: boolean
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
          aria-label="Mention"
          className={`scroll absolute z-40 max-h-[320px] w-max min-w-[220px] max-w-[420px] overflow-y-auto ${menuPanel} ${className}`}
        >
          {items.length === 0 && <div className="px-[8px] py-[6px] text-[13px] text-[var(--cx-ink3)]">Nothing by that name. Type ~/ for a folder.</div>}
          {groups(watchesFirst).map((g) => {
            const group = items.filter((x) => g.kinds.includes(x.kind))
            if (!group.length) return null
            return (
              <div key={g.title} className="flex flex-col">
                <div className={menuLabelClass}>{g.title}</div>
                {group.map((item) => {
                  i++
                  const n = i
                  const on = n === selected
                  const Icon = ICON[item.kind]
                  return (
                    <div
                      key={item.key}
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
                      <span className="flex w-[14px] shrink-0 items-center justify-center text-[var(--cx-ink3)]">
                        {item.watchKind ? <KindIcon kind={item.watchKind} size={14} /> : <Icon size={14} />}
                      </span>
                      <span className="min-w-0 shrink truncate">{item.label}</span>
                      {item.detail && <span className="min-w-0 flex-1 truncate pl-[16px] text-right text-[var(--cx-ink4)]">{item.detail}</span>}
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

/** The order the menu draws items in (the arrow keys walk the same order). */
export const mentionOrder = (items: MentionItem[], watchesFirst = false) => groups(watchesFirst).flatMap((g) => items.filter((x) => g.kinds.includes(x.kind)))
