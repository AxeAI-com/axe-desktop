import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef } from "react"

import type { MentionItem, MentionKind } from "@/lib/mentions"
import { useMotion } from "@/lib/motion"

import { IconTile } from "./Kit"
import { ChatIcon, EyeIcon, FolderIcon, MonitorIcon, PlugIcon } from "./Icons"
import { KindIcon } from "./WatchIcons"

type Group = { kinds: MentionKind[]; title: string }
const WATCHES: Group = { kinds: ["watch"], title: "Watches" }
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
          className={`scroll absolute z-40 box-border max-h-[320px] w-max min-w-[220px] max-w-[420px] overflow-y-auto rounded-[10px] border-0 bg-pop p-[4px] text-[13px] shadow-card ${className}`}
        >
          {items.length === 0 && <div className="px-[8px] py-[6px] text-[13px] text-ink-3">Nothing by that name. Type ~/ for a folder.</div>}
          {groups(watchesFirst).map((g) => {
            const group = items.filter((x) => g.kinds.includes(x.kind))
            if (!group.length) return null
            return (
              <div key={g.title} className="flex flex-col">
                <div className="px-[8px] pt-[6px] pb-[2px] text-[12px] text-ink-3">{g.title}</div>
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
                      className={`flex h-[28px] cursor-default items-center gap-[8px] rounded-[6px] px-[8px] ${on ? "bg-fill-2" : ""}`}
                    >
                      <IconTile tone="mute" size={18}>
                        {item.watchKind ? <KindIcon kind={item.watchKind} size={12} /> : <Icon size={12} />}
                      </IconTile>
                      <span className="min-w-0 shrink truncate text-[13px] text-foreground">{item.label}</span>
                      {item.detail && <span className="min-w-0 flex-1 truncate text-right text-[13px] text-ink-3">{item.detail}</span>}
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
