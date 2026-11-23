import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { useMotion } from "@/lib/motion"
import { filterPalette, paletteEntries, type IconName, type PaletteEntry } from "@/lib/shortcuts"
import { getState, setPalette, useStore } from "@/lib/store"

import { agentLogo, LogoTile, modelLogo } from "./BrandLogo"
import { Keycaps } from "./Kit"
import { menuLabelClass, menuRowClass } from "./Popover"
import {
  ArchiveIcon,
  ArrowDownIcon,
  BrainIcon,
  CreditIcon,
  FolderIcon,
  GearIcon,
  GlobeIcon,
  MonitorIcon,
  MoonIcon,
  PinIcon,
  SearchIcon,
  SidebarIcon,
  SignOutIcon,
  StopIcon,
  TelescopeIcon,
  TerminalIcon,
  AgentIcon,
  PlugIcon,
  SkillIcon,
  DiffIcon,
  AlertIcon,
  UpdateIcon,
  NewChatIcon,
  PaperclipIcon,
  CopyIcon,
  BoltIcon,
  MicIcon,
  VoiceIcon,
  SunIcon,
  KeyboardIcon,
  EyeIcon,
  ClockIcon,
} from "./SolarIcons"

const ICONS: Record<IconName, ReactNode> = {
  new: <NewChatIcon size={16} />,
  settings: <GearIcon size={16} />,
  search: <SearchIcon size={16} />,
  attach: <PaperclipIcon size={16} />,
  sidebar: <SidebarIcon size={16} />,
  terminal: <TerminalIcon size={16} />,
  stop: <StopIcon size={14} />,
  copy: <CopyIcon size={16} />,
  up: <ArrowDownIcon size={16} style={{ transform: "rotate(180deg)" }} />,
  down: <ArrowDownIcon size={16} />,
  quick: <BoltIcon size={16} />,
  mic: <MicIcon size={16} />,
  talk: <VoiceIcon size={16} />,
  dark: <MoonIcon size={16} />,
  light: <SunIcon size={16} />,
  system: <MonitorIcon size={16} />,
  globe: <GlobeIcon size={16} />,
  research: <TelescopeIcon size={16} />,
  pin: <PinIcon size={16} />,
  archive: <ArchiveIcon size={16} />,
  memory: <BrainIcon size={16} />,
  keyboard: <KeyboardIcon size={16} />,
  agent: <TerminalIcon size={16} />,
  credit: <CreditIcon size={16} />,
  signout: <SignOutIcon size={16} />,
  chat: <NewChatIcon size={16} />,
  folder: <FolderIcon size={16} />,
  helper: <AgentIcon size={16} />,
  skill: <SkillIcon size={16} />,
  plug: <PlugIcon size={16} />,
  update: <UpdateIcon size={16} />,
  diff: <DiffIcon size={16} />,
  mode: <AlertIcon size={16} />,
  eye: <EyeIcon size={16} />,
  clock: <ClockIcon size={16} />,
}

/** ⌘K: every action in the app, every chat, model and agent, each with its key. */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const m = useMotion()
  // The dialog is centred on the main column: the window less the sidebar, when it shows.
  const left = useStore((s) => (s.sidebarCollapsed ? 0 : s.settings.sidebarWidth))
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={m.t(0.12)}
          className="fixed inset-0 z-50 flex justify-center pt-[30px]"
          style={{ background: "var(--scrim)", paddingLeft: left }}
          onPointerDown={(e) => e.target === e.currentTarget && setPalette(false)}
        >
          <div
            role="dialog"
            aria-label="Command palette"
            className="popover-new flex h-fit max-h-[calc(100vh-60px)] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[10px] bg-[var(--cx-pop)] text-[var(--cx-ink)] shadow-[var(--cx-menu-shadow)]"
          >
            <PaletteBody />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PaletteBody() {
  const threads = useStore((s) => s.threads)
  const catalog = useStore((s) => s.catalog)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const [q, setQ] = useState("")
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => input.current?.focus(), [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => paletteEntries(getState()), [threads, catalog, view, settings])
  const items = useMemo(() => filterPalette(entries, q), [entries, q])

  useEffect(() => setCursor(0), [q])
  useEffect(() => {
    list.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  const run = (it?: PaletteEntry) => {
    if (!it) return
    setPalette(false)
    it.run()
  }

  let lastGroup = ""
  return (
    <>
      <div className="flex h-[48px] shrink-0 items-center gap-[10px] border-0 border-b border-solid border-[var(--cx-sep)] px-[14px] text-ink-3">
        <SearchIcon size={16} />
        <input
          ref={input}
          aria-label="Search chats and actions"
          placeholder="Search chats or type a command"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setCursor((c) => Math.min(items.length - 1, c + 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setCursor((c) => Math.max(0, c - 1))
            } else if (e.key === "Enter") {
              e.preventDefault()
              run(items[cursor])
            } else if (e.key === "Escape") {
              e.preventDefault()
              setPalette(false)
            }
          }}
          className="h-full flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4"
        />
      </div>
      <div ref={list} role="listbox" className="scroll flex-1 p-[4px]">
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? it.group : null
          lastGroup = it.group
          return (
            <div key={`${it.group}-${it.id}`}>
              {header && <div className={menuLabelClass}>{header}</div>}
              <div
                data-i={i}
                role="option"
                aria-selected={i === cursor}
                onMouseMove={() => setCursor(i)}
                onClick={() => run(it)}
                className={menuRowClass(i === cursor)}
              >
                <span className="flex w-[14px] shrink-0 justify-center text-[var(--cx-ink3)] [&_svg]:size-[14px]">{iconOf(it)}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && (/[⌘⌥⇧⌃]|\+/.test(it.hint) ? <Keycaps keys={it.hint} /> : <span className="shrink-0 text-[var(--cx-ink4)]">{it.hint}</span>)}
              </div>
            </div>
          )
        })}
        {!items.length && <div className="px-[8px] py-[6px] text-[13px] text-ink-3">Nothing matches "{q}"</div>}
      </div>
    </>
  )
}

function iconOf(it: PaletteEntry): ReactNode {
  if (it.id.startsWith("agent-") || it.id.startsWith("install-")) {
    const agent = getState().catalog?.agents.find((a) => it.id.endsWith(a.id))
    if (agent) return <LogoTile logo={agentLogo(agent)} name={agent.name} size={14} square />
  }
  if (it.id.startsWith("model-")) {
    const model = getState().catalog?.axe.models.find((m) => it.id === `model-${m.id}`)
    if (model) return <LogoTile auto={model.id === "auto"} logo={modelLogo(model)} name={model.label} size={14} square />
  }
  if (it.group === "Chats") return ICONS.chat
  return it.icon ? ICONS[it.icon] : null
}
