import { AnimatePresence, motion } from "motion/react"
import type { WatchView } from "@shared/watching/types"
import { useCallback, useRef, useState, type ReactNode } from "react"

import { agentName, answererLabel, folderName } from "@/lib/answerer"
import { isMac, shortcut } from "@/lib/bridge"
import { openLibrary } from "@/lib/libraries"
import { useMotion } from "@/lib/motion"
import { totals } from "@/lib/changes"
import { WatchTitle } from "@/screens/Watching"
import { LivePill, WatchingTitleExtras } from "@/components/watching/Dashboard"
import { openWatching } from "@/lib/watching"
import { currentThread, defaultAnswerer, newChat, nextAnswerer, openReview, setPalette, toggleSidebar, useStore } from "@/lib/store"

import { Counts } from "./ChangesPanel"
import { ChatMenuItems } from "./ChatMenu"
import { BackIcon, BranchIcon, ChevronDown, CommandIcon, DiffIcon, NewChatIcon, SidebarIcon, SlidersGlyph } from "./Icons"
import { MenuItem, Popover } from "./Popover"
import { RenameInput } from "./Sidebar"

const NO_WATCHES: WatchView[] = []

/** The 70 px strip above the page: it moves the window, names the page or chat, opens its menu and ends in a hairline. */
export function TitleBar() {
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const thread = useStore(currentThread)
  const view = useStore((s) => s.view)
  const catalog = useStore((s) => s.catalog)
  const subtitle = useStore((s) => {
    if (thread?.source === "agent" && thread.agentId)
      return [agentName(thread.agentId), thread.copy ? folderName(thread.copy.source) : folderName(thread.cwd)].filter(Boolean).join(", ")
    if (thread) return answererLabel(nextAnswerer(thread.id, s), catalog)
    return answererLabel(defaultAnswerer(s), catalog)
  })
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setMenu(false), [])
  const m = useMotion()
  const customizing = view.kind === "skills" || view.kind === "connectors" || view.kind === "agents"
  // A sentence typed on the Watching page reads as a new watch until it becomes one.
  const reading = useStore((s) => !!s.watchAsk)
  const watches = useStore((s) => s.watching?.watches ?? NO_WATCHES)
  const page = pageTitle(view.kind === "watching" && reading ? "newWatch" : view.kind)
  const round = "flex size-10 shrink-0 items-center justify-center rounded-full border-0 bg-button text-ink-2 transition-colors duration-150 hover:bg-fill-4 hover:text-ink"

  return (
    <header
      className="drag relative flex h-[70px] shrink-0 items-center gap-[12px] border-b border-fill-2 pr-[16px] pl-[28px] text-[15px]"
    >
      {/* No exit animation: a fading pair would keep its room while the sidebar comes back, and the title would jump. */}
      {collapsed && (
          <motion.div
            key="side"
            initial={{ opacity: 0, x: m.reduced ? 0 : -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={m.t()}
            className={`flex items-center gap-[8px] ${isMac() ? "ml-[63px]" : ""}`}
          >
            <button aria-label="Show sidebar" title={`Show sidebar (${shortcut("\\")})`} onClick={() => toggleSidebar(false)} className={round}>
              <SidebarIcon size={18} />
            </button>
            <button aria-label="New chat" title={`New chat (${shortcut("N")})`} onClick={newChat} className={round}>
              <NewChatIcon size={18} />
            </button>
          </motion.div>
      )}
      {renaming && thread ? (
        <div className="no-drag w-[320px]">
          <RenameInput thread={thread} done={() => setRenaming(false)} />
        </div>
      ) : thread ? (
        <motion.div layout="position" transition={m.t()} className="relative flex min-w-0 flex-col items-start">
          <button
            ref={anchor}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((o) => !o)}
            onDoubleClick={() => setRenaming(true)}
            title={thread.copy?.branch ? `Works on branch ${thread.copy.branch}, in its own worktree` : thread.copy ? "Works in its own copy of the folder" : undefined}
            className={`relative left-[-8px] flex max-w-full min-w-0 items-center gap-[8px] rounded-[10px] border-0 px-[8px] text-left text-[15px] leading-[20px] text-ink transition-colors duration-150 hover:bg-fill ${menu ? "bg-fill" : "bg-transparent"}`}
          >
            <span className="truncate">{thread.title}</span>
            <ChevronDown className="shrink-0 text-ink-3" />
          </button>
          <span className="flex items-center gap-[4px] text-[13px] leading-[18px] text-ink-3">
            {thread.copy && <BranchIcon size={11} />}
            {subtitle}
          </span>
          <Popover open={menu} onClose={close} anchor={anchor} origin="top left" className="top-[calc(100%+4px)] left-[0px]" label="Chat">
            <ChatMenuItems thread={thread} onRename={() => setRenaming(true)} close={close} />
          </Popover>
        </motion.div>
      ) : view.kind === "watch" ? (
        <div className="flex min-w-0 items-center gap-[8px]">
          {/* Every watch is a chat: one click (or Esc) folds it back into the dashboard. */}
          <button aria-label="Back to Watching" title="Back to Watching (Esc)" onClick={() => openWatching()} className={`no-drag ${round} size-[32px]`}>
            <BackIcon size={16} />
          </button>
          <WatchTitle id={view.id} />
        </div>
      ) : view.kind === "watching" && !reading && watches.length > 0 ? (
        <div className="flex items-center gap-[8px]">
          <span className="leading-[20px] text-ink">Watching</span>
          <WatchingTitleExtras watches={watches} />
        </div>
      ) : page ? (
        <PageTitle title={page.title} subtitle={page.subtitle} items={page.items} />
      ) : view.kind === "new" ? (
        <motion.div layout="position" transition={m.t()} className="flex min-w-0 flex-col">
          <span className="leading-[20px] text-ink">New chat</span>
          <span className="text-[13px] leading-[18px] text-ink-3">{subtitle}</span>
        </motion.div>
      ) : null}
      <span className="flex-1" />
      {view.kind === "watching" && !reading && watches.length > 0 && <LivePill watches={watches} />}
      {thread?.source === "agent" && <ChangesButton threadId={thread.id} />}
      <div className={`no-drag pointer-events-auto flex h-[40px] shrink-0 items-center rounded-full bg-button px-[4px] ${isMac() ? "" : "mr-[132px]"}`}>
        <button
          aria-label={`Search and commands (${shortcut("K")})`}
          title={`Search and commands (${shortcut("K")})`}
          onClick={() => setPalette(true)}
          aria-haspopup="dialog"
          className="flex h-[40px] w-[38px] items-center justify-center rounded-full border-0 bg-transparent text-ink-2 transition-colors duration-150 hover:bg-fill-2 hover:text-ink"
        >
          <CommandIcon size={18} />
        </button>
        <button
          aria-label="Customize"
          title="Customize"
          onClick={() => openLibrary("skills")}
          aria-current={customizing ? "page" : undefined}
          className={`flex h-[40px] w-[38px] items-center justify-center rounded-full border-0 transition-colors duration-150 hover:bg-fill-2 hover:text-ink ${customizing ? "bg-fill-2 text-ink" : "bg-transparent text-ink-2"}`}
        >
          <SlidersGlyph size={18} />
        </button>
      </div>
    </header>
  )
}

type Page = { title: string; subtitle: string; items?: (close: () => void) => ReactNode }

const CUSTOMIZE_SUBTITLE = {
  skills: "Add a skill, then type / in any chat to use it.",
  agents: "Describe the job. Axe sets it up.",
  connectors: "Your apps, for your models and CLIs.",
} as const

/** What the bar says on a page that is not a chat. */
function pageTitle(kind: string): Page | null {
  if (kind === "watching") return { title: "Watching", subtitle: "" }
  if (kind === "newWatch") return { title: "New watch", subtitle: "" }
  if (kind === "settings") return { title: "Settings", subtitle: "Account, shortcuts and the tools Axe can use." }
  if (kind === "skills" || kind === "agents" || kind === "connectors")
    return {
      title: "Customize",
      subtitle: CUSTOMIZE_SUBTITLE[kind],
      items: (close) => (
        <>
          {(["skills", "agents", "connectors"] as const).map((k) => (
            <MenuItem
              key={k}
              active={k === kind}
              onSelect={() => {
                close()
                openLibrary(k)
              }}
            >
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </MenuItem>
          ))}
        </>
      ),
    }
  return null
}

/** The name and one quiet line under it; with menu items the name opens them, like a chat's. */
function PageTitle({ title, subtitle, items }: Page) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  return (
    <div className="relative flex min-w-0 flex-col items-start">
      <div role="heading" aria-level={1} className="min-w-0 max-w-full">
        {items ? (
          <button
            ref={anchor}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={`no-drag relative left-[-8px] flex max-w-full min-w-0 items-center gap-[8px] rounded-[10px] border-0 px-[8px] text-left text-[15px] leading-[20px] text-ink transition-colors duration-150 hover:bg-fill ${open ? "bg-fill" : "bg-transparent"}`}
          >
            <span className="truncate">{title}</span>
            <ChevronDown className="shrink-0 text-ink-3" />
          </button>
        ) : (
          <span className="block truncate text-[15px] leading-[20px] text-ink">{title}</span>
        )}
      </div>
      {subtitle && <span className="text-[13px] leading-[18px] text-ink-3">{subtitle}</span>}
      {items && (
        <Popover open={open} onClose={close} anchor={anchor} origin="top left" className="top-[calc(100%+4px)] left-[0px]" label={title}>
          {items(close)}
        </Popover>
      )}
    </div>
  )
}

const NO_FILES: never[] = []

/** "3 files +14 −5" on the right of an agent chat's title bar: opens the changes panel. */
function ChangesButton({ threadId }: { threadId: string }) {
  const files = useStore((s) => s.changes[threadId] ?? NO_FILES)
  const open = useStore((s) => s.review === threadId)
  const m = useMotion()
  const sum = totals(files)
  return (
    <AnimatePresence initial={false}>
      {(files.length > 0 || open) && (
        <motion.button
          key="changes"
          initial={{ opacity: 0, x: m.reduced ? 0 : 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: m.reduced ? 0 : 6 }}
          transition={m.t()}
          aria-label={open ? "Hide changes" : `Review changes: ${sum.files} ${sum.files === 1 ? "file" : "files"}`}
          aria-expanded={open}
          onClick={() => openReview(open ? null : threadId)}
          className={`no-drag flex h-[40px] items-center gap-[8px] rounded-full border-0 px-[16px] text-[13px] transition-colors duration-150 ${
            open ? "bg-fill-3 text-ink" : "bg-fill-2 text-ink-2 hover:bg-fill-3 hover:text-ink"
          }`}
        >
          <DiffIcon size={15} className="text-ink-3" />
          <span className="tabular-nums">{sum.files ? `${sum.files} ${sum.files === 1 ? "file" : "files"}` : "No changes"}</span>
          <Counts added={sum.added} removed={sum.removed} />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
