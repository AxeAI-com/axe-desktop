import { AnimatePresence, LayoutGroup, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ThreadSummary } from "@shared/types"

import { agentName } from "@/lib/answerer"
import { invoke, isMac, shortcut } from "@/lib/bridge"
import { openSettingsAt } from "@/lib/shortcuts"
import { D, useMotion } from "@/lib/motion"
import {
  chooseFolder,
  newChat,
  openSettings,
  openThread,
  renameThread,
  setTheme,
  setState,
  signIn,
  signOut,
  toggleSidebar,
  updateSettings,
  useStore,
} from "@/lib/store"
import { groupThreads, initials } from "@/lib/time"

import { ChatMenuItems } from "./ChatMenu"
import { openLibrary } from "@/lib/libraries"
import { openWatching } from "@/lib/watching"
import { liveProblems } from "@shared/watching/findings"


import { BoltIcon, EyeIcon, FolderPlusIcon, GearGlyph, MoreIcon, NewChatIcon, PhoneGlyph, PinIcon, PlusIcon, SidebarIcon, SlidersGlyph, SlidersIcon, UserIcon } from "./Icons"
import { UpdatePill } from "./Update"
import { AxeMark } from "./Logo"
import { agentLogo, BrandLogo, LogoTile } from "./BrandLogo"
import { MenuItem, MenuLine, Popover } from "./Popover"

export const SIDEBAR_MIN = 240
export const SIDEBAR_MAX = 440
const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))

export function Sidebar() {
  const saved = useStore((s) => s.settings.sidebarWidth)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const [drag, setDrag] = useState<number | null>(null)
  const m = useMotion()
  const width = drag ?? clampWidth(saved || 300)

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width
    let last = w0
    const move = (ev: PointerEvent) => {
      last = clampWidth(w0 + ev.clientX - x0)
      setDrag(last)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.style.cursor = ""
      setDrag(null)
      if (last !== w0) void updateSettings({ sidebarWidth: last })
    }
    document.body.style.cursor = "col-resize"
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <motion.div
      initial={false}
      animate={{ width: collapsed ? 0 : width }}
      transition={drag !== null ? { duration: 0 } : m.t(D.slow)}
      className="relative h-full shrink-0 overflow-hidden"
    >
      <motion.nav
        aria-label="Chats"
        initial={false}
        animate={{ x: collapsed ? -width * 0.25 : 0, opacity: collapsed ? 0 : 1 }}
        transition={m.t(D.slow)}
        style={{ width }}
        className="flex h-full flex-col bg-side"
      >
        <SidebarBody />
      </motion.nav>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={width}
          onPointerDown={startResize}
          onDoubleClick={() => void updateSettings({ sidebarWidth: 300 })}
          className="no-drag group absolute top-[0px] right-[0px] z-10 h-full w-[6px] cursor-col-resize"
        >
          <div className="ml-auto h-full w-px bg-transparent transition-colors duration-150 group-hover:bg-line-3" />
        </div>
      )}
    </motion.div>
  )
}

type WorkState = "working" | "waiting" | "done"

/** The one mark at the end of a chat's row: a spinner while it works, amber when it needs you, a dot when it finished while you were away. */
function WorkMark({ state }: { state: WorkState }) {
  if (state === "working")
    return (
      <svg role="img" aria-label="Working" width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 animate-spin">
        <title>Working</title>
        <circle cx="12" cy="12" r="9" stroke="rgb(255 255 255 / 0.14)" strokeWidth="2.5" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="var(--ink-2)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  return (
    <span
      role="img"
      aria-label={state === "waiting" ? "Needs you" : "Done"}
      title={state === "waiting" ? "Needs you" : "Done"}
      className={`size-[7px] shrink-0 rounded-full ${state === "waiting" ? "bg-warn" : "bg-ink-2"}`}
    />
  )
}

/** The CLI on a chat as its logo, named on hover and for screen readers. */
function AgentMark({ agentId }: { agentId: string }) {
  const catalog = useStore((s) => s.catalog)
  const a = catalog?.agents.find((x) => x.id === agentId)
  const name = a?.name ?? agentName(agentId)
  return (
    <span role="img" aria-label={name} title={name} className="flex shrink-0">
      <BrandLogo logo={agentLogo(a ?? { id: agentId, name })} name={name} size={16} />
    </span>
  )
}

function SidebarBody() {
  const threads = useStore((s) => s.threads)
  const search = useStore((s) => s.search)
  const view = useStore((s) => s.view)
  const permissions = useStore((s) => s.permissions)
  const finished = useStore((s) => s.finished)
  const activeId = view.kind === "thread" ? view.id : null
  // Chats that are working or waiting for you sit in "Working now"; a finished one gets a small dot in its row.
  const states = useMemo(() => {
    const waiting = new Set(permissions.map((p) => p.threadId))
    const out: Record<string, WorkState> = {}
    for (const t of threads) {
      const state: WorkState | null = waiting.has(t.id) ? "waiting" : t.running ? "working" : finished[t.id] ? "done" : null
      if (state) out[t.id] = state
    }
    return out
  }, [threads, permissions, finished])
  // The badge counts watches with open problems that aren't snoozed or expected. Watches never list
  // themselves under it: they live on the Watching page.
  const needing = useStore((s) => {
    const now = Date.now()
    return (s.watching?.watches ?? []).filter((w) => liveProblems(w, now).length).length
  })
  const { busy, sections } = useMemo(() => {
    const q = search.trim().toLowerCase()
    // A watch's fix sessions live in that watch's thread, never in Recents.
    const own = threads.filter((t) => !t.watchId)
    const list = q ? own.filter((t) => t.title.toLowerCase().includes(q)) : own
    const isBusy = (t: ThreadSummary) => states[t.id] === "working" || states[t.id] === "waiting"
    return { busy: list.filter(isBusy), sections: groupThreads(list.filter((t) => !isBusy(t)), new Date()) }
  }, [threads, search, states])

  return (
    <>
      <div className={`drag flex h-[66px] shrink-0 items-center gap-[16px] pr-[14px] ${isMac() ? "pl-[91px]" : "pl-[16px]"}`}>
        <button
          aria-label="Hide sidebar"
          title={`Hide sidebar (${shortcut("\\")})`}
          onClick={() => toggleSidebar(true)}
          className="flex size-[40px] shrink-0 items-center justify-center rounded-full border-0 bg-button text-ink-2 transition-colors duration-150 hover:bg-fill-4 hover:text-ink"
        >
          <SidebarIcon size={18} />
        </button>
        <span className="flex-1" />
        <div className="no-drag flex h-[40px] shrink-0 items-center rounded-full bg-button px-[4px]">
          <button
            aria-label="New folder"
            title="New folder"
            onClick={() => {
              newChat()
              void chooseFolder()
            }}
            className="flex h-[40px] w-[38px] items-center justify-center rounded-full border-0 bg-transparent text-ink-2 transition-colors duration-150 hover:bg-fill-2 hover:text-ink"
          >
            <FolderPlusIcon size={18} />
          </button>
          <button
            aria-label="New chat"
            title={`New chat (${shortcut("N")})`}
            onClick={newChat}
            className="flex h-[40px] w-[38px] items-center justify-center rounded-full border-0 bg-transparent text-ink-2 transition-colors duration-150 hover:bg-fill-2 hover:text-ink"
          >
            <NewChatIcon size={18} />
          </button>
        </div>
      </div>
      <div className="flex shrink-0 flex-col px-[10px]">
        <button onClick={newChat} aria-current={view.kind === "new" ? "page" : undefined} className={navClass(view.kind === "new")}>
          <NavIcon>
            <NewChatIcon size={18} />
          </NavIcon>
          <span className="flex-1">New chat</span>
          <span className="text-[13px] text-ink-4">{shortcut("N")}</span>
        </button>
        <button
          onClick={() => openWatching()}
          aria-label={needing ? `Watching, ${needing} ${needing === 1 ? "problem" : "problems"}` : "Watching"}
          aria-current={view.kind === "watching" || view.kind === "newWatch" || view.kind === "watch" ? "page" : undefined}
          className={navClass(view.kind === "watching" || view.kind === "newWatch" || view.kind === "watch")}
        >
          <NavIcon>
            <EyeIcon size={18} />
          </NavIcon>
          <span className="flex-1 text-left">Watching</span>
          {needing > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warn-bg px-[6px] text-[11px] leading-none text-warn tabular-nums">{needing}</span>
          )}
        </button>
        <button
          onClick={() => openLibrary("skills")}
          aria-label="Customize"
          aria-current={view.kind === "skills" || view.kind === "connectors" || view.kind === "agents" ? "page" : undefined}
          className={navClass(view.kind === "skills" || view.kind === "connectors" || view.kind === "agents")}
        >
          <NavIcon>
            <SlidersIcon size={18} />
          </NavIcon>
          Customize
        </button>
      </div>
      <div className="scroll min-h-0 flex-1 px-[10px] pb-[12px]">
        <LayoutGroup>
          {busy.length > 0 && (
            <section aria-label="Working now">
              <motion.div layout="position" className="mt-[4px] flex h-[32px] items-center gap-[11px] px-[12px] text-[15px] text-ink-3">
                <BoltIcon size={18} />
                Working now
              </motion.div>
              <AnimatePresence initial={false}>
                {busy.map((t) => (
                  <ChatRow key={t.id} thread={t} state={states[t.id]} active={t.id === activeId} busy />
                ))}
              </AnimatePresence>
            </section>
          )}
          {sections.map((s) => (
            <section key={s.title} aria-label={s.title}>
              <motion.div
                layout="position"
                className={`mt-[4px] flex items-center px-[12px] text-ink-3 ${s.title === "Pinned" ? "h-[32px] gap-[11px] text-[15px]" : "h-[28px] pt-[4px] text-[13px]"}`}
              >
                {s.title === "Pinned" && <PinIcon size={18} />}
                <span className="flex-1">{s.title}</span>
              </motion.div>
              <AnimatePresence initial={false}>
                {s.threads.map((t) => (
                  <ChatRow key={t.id} thread={t} state={states[t.id]} active={t.id === activeId} />
                ))}
              </AnimatePresence>
            </section>
          ))}
        </LayoutGroup>
        {search && !sections.length && !busy.length && <div className="px-[12px] pt-[24px] text-[13px] text-ink-3">No chats match "{search}"</div>}
      </div>
      <UpdatePill />
      <AccountRow />
    </>
  )
}

const navClass = (on: boolean) =>
  `flex h-[36px] w-full items-center gap-[11px] rounded-[12px] border-0 px-[12px] text-left text-[15px] transition-colors duration-150 ${
    on ? "bg-sidebar-item-active text-ink" : "bg-transparent text-side-ink hover:bg-sidebar-item-hover hover:text-ink"
  }`

const NavIcon = ({ children }: { children: React.ReactNode }) => <span className="flex w-[18px] justify-center text-ink-3">{children}</span>

function ChatRow({ thread, state, active, busy = false }: { thread: ThreadSummary; state?: WorkState; active: boolean; busy?: boolean }) {
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const m = useMotion()
  const close = useCallback(() => setMenu(null), [])
  const catalog = useStore((s) => s.catalog)
  const agent = thread.agentId ? catalog?.agents.find((x) => x.id === thread.agentId) : undefined
  const h = busy ? 46 : 36

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    const r = btn.current!.getBoundingClientRect()
    setMenu(menu ? null : { top: r.bottom + 4, left: Math.max(8, r.right - 200) })
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: h }}
      exit={{ opacity: 0, height: 0 }}
      transition={m.t()}
      className="relative"
    >
      {renaming ? (
        <RenameInput thread={thread} done={() => setRenaming(false)} />
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-current={active ? "page" : undefined}
          onClick={() => void openThread(thread.id)}
          onKeyDown={(e) => e.key === "Enter" && void openThread(thread.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ top: e.clientY, left: e.clientX })
          }}
          style={{ height: h }}
          className={`group flex items-center gap-[11px] rounded-[12px] px-[12px] text-[15px] outline-none transition-colors duration-150 focus-visible:bg-sidebar-item-hover ${
            active || menu ? "bg-sidebar-item-active text-ink" : "text-side-ink hover:bg-sidebar-item-hover hover:text-ink"
          }`}
        >
          {busy && (
            <span role="img" aria-label={agent?.name ?? "Axe AI"} title={agent?.name ?? "Axe AI"} className="flex shrink-0">
              {thread.source === "agent" && thread.agentId ? <LogoTile logo={agentLogo(agent ?? { id: thread.agentId, name: agentName(thread.agentId) })} name={agent?.name ?? agentName(thread.agentId)} size={18} /> : <LogoTile name="Axe AI" auto size={18} />}
            </span>
          )}
          {busy ? (
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate leading-[20px]">{thread.title}</span>
              <span className={`text-[12px] leading-[16px] ${state === "waiting" ? "text-warn-ink" : "text-ink-3"}`}>{state === "waiting" ? "Needs your OK" : "Working"}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          )}
          {state && <WorkMark state={state} />}
          {!busy && thread.source === "agent" && thread.agentId && (
            // In grey: a full-colour logo on a finished chat read as still working.
            <span className={`shrink-0 opacity-60 grayscale ${menu ? "hidden" : "group-hover:hidden"}`}>
              <AgentMark agentId={thread.agentId} />
            </span>
          )}
          <button
            ref={btn}
            aria-label={`More for ${thread.title}`}
            onClick={openMenu}
            className={`size-[24px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-ink-3 hover:bg-fill-3 hover:text-ink ${
              menu ? "flex" : "hidden group-hover:flex group-focus-visible:flex"
            }`}
          >
            <MoreIcon />
          </button>
        </div>
      )}
      <Popover open={!!menu} onClose={close} anchor={btn} at={menu ?? undefined} origin="top right" label="Chat">
        <ChatMenuItems thread={thread} onRename={() => setRenaming(true)} close={close} />
      </Popover>
    </motion.div>
  )
}

export function RenameInput({ thread, done, className = "" }: { thread: ThreadSummary; done: () => void; className?: string }) {
  const [value, setValue] = useState(thread.title)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const commit = () => {
    if (value.trim() && value.trim() !== thread.title) void renameThread(thread.id, value)
    done()
  }
  return (
    <input
      ref={ref}
      aria-label="Chat name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape") done()
      }}
      className={`h-[36px] w-full rounded-[12px] border-0 bg-fill-3 px-[12px] text-[15px] text-ink outline-none ${className}`}
    />
  )
}

const menuRow = "flex h-[40px] w-full items-center gap-[12px] rounded-[10px] border-0 bg-transparent px-[10px] text-left text-[15px] leading-[22px] text-ink transition-colors duration-150 hover:bg-fill-2 focus-visible:bg-fill-2 focus-visible:outline-none"

/** One row of the account menu: 17 px glyph in ink-2, label in ink, a muted hint on the right. */
function AccountItem({ icon, hint, onSelect, children }: { icon: React.ReactNode; hint?: string; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button role="menuitem" onClick={onSelect} className={menuRow}>
      <span className="flex shrink-0 text-ink-2">{icon}</span>
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[13px] text-ink-4">{hint}</span>}
    </button>
  )
}

function AccountRow() {
  const profile = useStore((s) => s.profile)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  if (!profile) return <SignInRow />
  const name = profile.name || profile.email
  const plan = `${profile.plan ?? "Free"}, ${(profile.credits ?? 0).toLocaleString("en-US")} credits`
  return (
    <div className="relative flex h-[68px] shrink-0 items-center gap-[6px] pr-[12px] pb-[4px] pl-[10px]">
      <Popover open={open} onClose={close} anchor={anchor} origin="bottom left" className="bottom-full left-[10px] flex w-[290px] !p-[8px] flex-col gap-[2px]" label="Account">
        <div className="flex flex-col px-[10px] pt-[8px] pb-[10px] text-[15px] leading-[22px]">
          <div className="truncate text-ink">{name}</div>
          <div className="truncate text-[13px] text-ink-3">{profile.email}</div>
        </div>
        <div className="flex items-center gap-[12px] rounded-[12px] bg-fill p-[14px]">
          <UsageRingMark />
          <div className="flex min-w-0 flex-1 flex-col leading-[19px]">
            <span className="text-[15px] text-ink">{(profile.credits ?? 0).toLocaleString("en-US")} credits</span>
            <span className="text-[13px] text-ink-3">{profile.plan ? `${profile.plan} plan` : "Free plan"}</span>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              close()
              void invoke("account:openBilling")
            }}
            className="inline-flex h-[28px] shrink-0 items-center justify-center rounded-full border-0 bg-brand px-[12px] text-[13px] whitespace-nowrap text-white transition-colors duration-150 hover:bg-brand-hover"
          >
            Add credits
          </button>
        </div>
        <ThemeRow />
        <div className="h-[6px]" />
        <AccountItem
          icon={<GearGlyph size={17} />}
          hint={shortcut(",")}
          onSelect={() => {
            close()
            openSettings()
          }}
        >
          Settings
        </AccountItem>
        <AccountItem
          icon={<SlidersGlyph size={17} />}
          onSelect={() => {
            close()
            openLibrary("skills")
          }}
        >
          Customize
        </AccountItem>
        <AccountItem
          icon={<PhoneGlyph size={17} />}
          onSelect={() => {
            close()
            openSettingsAt("phone")
          }}
        >
          Use from your phone
        </AccountItem>
        <div className="h-[6px]" />
        <AccountItem
          icon={<UserIcon size={17} />}
          onSelect={() => {
            close()
            void signOut()
          }}
        >
          Sign out
        </AccountItem>
      </Popover>
      <button
        ref={anchor}
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-[52px] min-w-0 flex-1 items-center gap-[11px] rounded-[14px] border-0 px-[10px] text-left text-ink transition-colors duration-150 hover:bg-sidebar-item-hover ${open ? "bg-sidebar-item-active" : "bg-transparent"}`}
      >
        <Avatar profile={profile} size={32} />
        <span className="flex min-w-0 flex-1 flex-col leading-[19px]">
          <span className="truncate text-[15px]">{name}</span>
          <span className="truncate text-[13px] text-ink-3">{plan}</span>
        </span>
      </button>
      <SettingsButton />
    </div>
  )
}

/** The small ring in the account menu's credits block: a track and a short arc (decoration, no usage figure behind it). */
const UsageRingMark = () => (
  <svg width="24" height="24" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
    <circle cx="9" cy="9" r="7" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
    <circle cx="9" cy="9" r="7" fill="none" className="stroke-ink-2" strokeWidth="2" strokeLinecap="round" strokeDasharray="7.92 43.98" transform="rotate(-90 9 9)" />
  </svg>
)

/** System / Light / Dark in the account menu; writes the `theme` setting. */
function ThemeRow() {
  const theme = useStore((s) => s.settings.theme)
  return (
    <div className="flex flex-col gap-[8px] px-[10px] pt-[12px] pb-[8px]">
      <span className="text-[13px] text-ink-3">Theme</span>
      <div role="radiogroup" aria-label="Theme" className="flex gap-[2px] rounded-full bg-segment p-[3px] dark:bg-fill-2">
        {(["system", "light", "dark"] as const).map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={theme === t}
            onClick={() => void setTheme(t)}
            className={`h-[30px] flex-1 rounded-full border-0 text-[13px] capitalize transition-colors duration-150 ${theme === t ? "bg-raised-2 text-ink shadow-card" : "bg-transparent text-ink-3 hover:text-ink"}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The gear at the end of the account row. */
function SettingsButton() {
  return (
    <button
      onClick={() => openSettings()}
      aria-label={`Settings (${shortcut(",")})`}
      title={`Settings (${shortcut(",")})`}
      className="flex size-[36px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-ink-3 transition-colors duration-150 hover:bg-fill-2 hover:text-ink"
    >
      <GearGlyph size={18} />
    </button>
  )
}

/** Signed out: everything works with CLI agents; signing in adds Axe's models and sync. */
function SignInRow() {
  const waiting = useStore((s) => s.signingIn)
  return (
    <div className="flex h-[68px] shrink-0 items-center gap-[6px] pr-[12px] pb-[4px] pl-[10px]">
      <button
        onClick={() => void signIn()}
        disabled={waiting}
        className="flex h-[52px] min-w-0 flex-1 items-center gap-[11px] rounded-[14px] border-0 bg-transparent px-[10px] text-left text-[15px] text-ink transition-colors duration-150 hover:bg-sidebar-item-hover disabled:text-ink-3"
      >
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-full bg-brand text-white">
          <AxeMark size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate">{waiting ? "Finish signing in in your browser" : "Sign in to Axe AI"}</span>
      </button>
      <SettingsButton />
    </div>
  )
}

export function Avatar({ profile, size }: { profile: { name?: string; email: string; image?: string }; size: number }) {
  const [broken, setBroken] = useState<string | null>(null)
  if (profile.image && broken !== profile.image)
    return (
      <img
        src={profile.image}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        onError={() => setBroken(profile.image!)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    )
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.46 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-avatar text-avatar-ink"
    >
      {initials(profile.name, profile.email)}
    </span>
  )
}
