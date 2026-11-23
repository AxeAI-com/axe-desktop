import type { WatchView } from "@shared/watching/types"
import { useCallback, useRef, useState } from "react"

import { isMac, shortcut } from "@/lib/bridge"
import { openLibrary } from "@/lib/libraries"
import { totals } from "@/lib/changes"
import { WatchTitle } from "@/screens/Watching"
import { WatchingTitleExtras } from "@/components/watching/Dashboard"
import { openWatching } from "@/lib/watching"
import { currentThread, newChat, openReview, setPalette, toggleSidebar, useStore } from "@/lib/store"

import { Counts } from "./ChangesPanel"
import { ChatMenuItems } from "./ChatMenu"
import { BackIcon, ChevronDown, CommandIcon, DiffIcon, NewChatIcon, SidebarIcon, SlidersGlyph } from "./SolarIcons"
import { button, iconButton } from "./Kit"
import { MenuItem, Popover } from "./Popover"
import { RenameInput } from "./Sidebar"

const NO_WATCHES: WatchView[] = []

/** The 70 px strip above the page: it moves the window, names the page or chat, opens its menu and ends in a hairline. */
export function TitleBar() {
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const thread = useStore(currentThread)
  const view = useStore((s) => s.view)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setMenu(false), [])
  const customizing = view.kind === "skills" || view.kind === "connectors" || view.kind === "agents"
  // A sentence typed on the Watching page reads as a new watch until it becomes one.
  const reading = useStore((s) => !!s.watchAsk)
  const watches = useStore((s) => s.watching?.watches ?? NO_WATCHES)
  const page = pageTitle(view.kind === "watching" && reading ? "newWatch" : view.kind)
  const round = iconButton(true)

  return (
    <header
      data-titlebar
      className="drag relative flex h-[70px] shrink-0 items-center gap-[12px] border-b border-hairline bg-background pr-[16px] pl-[28px] text-[15px]"
    >
      {/* No exit animation: a fading pair would keep its room while the sidebar comes back, and the title would jump. */}
      {collapsed && (
          <div className={`no-drag flex items-center gap-[4px] ${isMac() ? "ml-[63px]" : ""}`}>
            <button aria-label="Show sidebar" title={`Show sidebar (${shortcut("\\")})`} onClick={() => toggleSidebar(false)} className={round}>
              <SidebarIcon size={18} />
            </button>
            <button aria-label="New chat" title={`New chat (${shortcut("N")})`} onClick={newChat} className={round}>
              <NewChatIcon size={18} />
            </button>
          </div>
      )}
      {renaming && thread ? (
        <div className="no-drag w-[320px]">
          <RenameInput thread={thread} done={() => setRenaming(false)} />
        </div>
      ) : thread ? (
        <div className="flex min-w-0 items-center gap-[4px]">
          <div className="relative flex min-w-0 shrink">
            <button
              ref={anchor}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((o) => !o)}
              onDoubleClick={() => setRenaming(true)}
              title={thread.copy?.branch ? `Works on branch ${thread.copy.branch}, in its own worktree` : thread.copy ? "Works in its own copy of the folder" : undefined}
              className={`relative left-[-8px] flex h-[28px] max-w-full min-w-0 items-center gap-[6px] rounded-[8px] border-0 px-[8px] text-left text-[15px] leading-[20px] font-normal text-ink transition-colors duration-150 hover:bg-fill ${menu ? "bg-fill" : "bg-transparent"}`}
            >
              <span className="truncate">{thread.title}</span>
              <ChevronDown size={14} className="shrink-0 text-ink-4" />
            </button>
            <Popover open={menu} onClose={close} anchor={anchor} origin="top left" className="top-[calc(100%+4px)] left-[0px]" label="Chat">
              <ChatMenuItems thread={thread} onRename={() => setRenaming(true)} close={close} />
            </Popover>
          </div>
        </div>
      ) : view.kind === "watch" ? (
        <div className="flex min-w-0 items-center gap-[8px]">
          {/* Every watch is a chat: one click (or Esc) folds it back into the dashboard. */}
          <button aria-label="Back to Oversight" title="Back to Oversight (Esc)" onClick={() => openWatching()} className={`no-drag ${iconButton()}`}>
            <BackIcon size={16} />
          </button>
          <WatchTitle id={view.id} />
        </div>
      ) : view.kind === "watching" && !reading && watches.length > 0 ? (
        <div className="flex items-center gap-[8px]">
          <span className="leading-[20px] text-ink">Oversight</span>
          <WatchingTitleExtras watches={watches} />
        </div>
      ) : page ? (
        <h1 className="m-0 truncate text-[15px] leading-[20px] text-ink">{page}</h1>
      ) : view.kind === "new" ? (
        <span className="leading-[20px] text-ink">New chat</span>
      ) : null}
      <span className="flex-1" />
      {thread?.source === "agent" && <ChangesButton threadId={thread.id} />}
      <div className={`no-drag pointer-events-auto flex shrink-0 items-center gap-[4px] ${isMac() ? "" : "mr-[132px]"}`}>
        <button
          aria-label={`Search and commands (${shortcut("K")})`}
          title={`Search and commands (${shortcut("K")})`}
          onClick={() => setPalette(true)}
          aria-haspopup="dialog"
          className={iconButton(true)}
        >
          <CommandIcon size={18} />
        </button>
        <button
          aria-label="Customize"
          title="Customize"
          onClick={() => openLibrary("skills")}
          aria-current={customizing ? "page" : undefined}
          className={`${iconButton(true)} ${customizing ? "!bg-fill-2 !text-ink" : ""}`}
        >
          <SlidersGlyph size={18} />
        </button>
      </div>
    </header>
  )
}

/** What the bar says on a page that is not a chat: one line, the same 15 px ink as a chat's title. */
function pageTitle(kind: string): string | null {
  if (kind === "watching") return "Oversight"
  if (kind === "newWatch") return "New check"
  if (kind === "settings") return "Settings"
  if (kind === "skills" || kind === "agents" || kind === "connectors") return "Customize"
  return null
}

const NO_FILES: never[] = []

/** "3 files +14 −5" on the right of an agent chat's title bar: opens the changes panel. */
function ChangesButton({ threadId }: { threadId: string }) {
  const files = useStore((s) => s.changes[threadId] ?? NO_FILES)
  const open = useStore((s) => s.review === threadId)
  const sum = totals(files)
  if (!files.length && !open) return null
  return (
        <button
          aria-label={open ? "Hide changes" : `Review changes: ${sum.files} ${sum.files === 1 ? "file" : "files"}`}
          aria-expanded={open}
          onClick={() => openReview(open ? null : threadId)}
          className={`no-drag ${button.secondary} ${open ? "!bg-fill-3" : ""}`}
        >
          <DiffIcon size={15} className="text-ink-3" />
          <span className="tabular-nums">{sum.files ? `${sum.files} ${sum.files === 1 ? "file" : "files"}` : "No changes"}</span>
          <Counts added={sum.added} removed={sum.removed} />
        </button>
  )
}
