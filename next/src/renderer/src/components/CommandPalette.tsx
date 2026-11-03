import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { useMotion } from "@/lib/motion"
import { filterPalette, paletteEntries, type IconName, type PaletteEntry } from "@/lib/shortcuts"
import { getState, setPalette, useStore } from "@/lib/store"

import { agentLogo, LogoTile, modelLogo } from "./BrandLogo"
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
} from "./Icons"

/** The board's 24-point line icons for the rows it draws; the rest use the app's own. */
function G({ d, size = 17 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  )
}
const PENCIL = "M12 20h8M16.5 3.6a2.1 2.1 0 0 1 3 3L7.5 18.6 3.5 19.5l.9-4z"

const ICONS: Record<IconName, ReactNode> = {
  new: <G d={PENCIL} />,
  settings: <GearIcon size={16} />,
  search: <SearchIcon size={16} />,
  attach: <G d="M20 11.5l-7.8 7.8a4.6 4.6 0 0 1-6.5-6.5l8.3-8.3a3 3 0 0 1 4.3 4.3l-8.3 8.3a1.5 1.5 0 0 1-2.1-2.1l7.6-7.6" />,
  sidebar: <SidebarIcon size={16} />,
  terminal: <TerminalIcon size={16} />,
  stop: <StopIcon size={14} />,
  copy: <G d="M9 9h11v11H9zM15 9V4H4v11h5" />,
  up: <ArrowDownIcon size={16} style={{ transform: "rotate(180deg)" }} />,
  down: <ArrowDownIcon size={16} />,
  quick: <G d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
  mic: <G d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3" />,
  talk: <G d="M4 12h1.5M8 8.5v7M11.5 5.5v13M15 8.5v7M18.5 11v2" />,
  dark: <MoonIcon size={16} />,
  light: <G d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />,
  system: <MonitorIcon size={16} />,
  globe: <GlobeIcon size={16} />,
  research: <TelescopeIcon size={16} />,
  pin: <PinIcon size={16} />,
  archive: <ArchiveIcon size={16} />,
  memory: <BrainIcon size={16} />,
  keyboard: <G d="M15.5 4.5l4 4L8 20H4v-4z" />,
  agent: <TerminalIcon size={16} />,
  credit: <CreditIcon size={16} />,
  signout: <SignOutIcon size={16} />,
  chat: <G d={PENCIL} />,
  folder: <FolderIcon size={16} />,
  helper: <AgentIcon size={16} />,
  skill: <SkillIcon size={16} />,
  plug: <PlugIcon size={16} />,
  update: <UpdateIcon size={16} />,
  diff: <DiffIcon size={16} />,
  mode: <AlertIcon size={16} />,
  eye: <G d="M2 12s3.7-6.5 10-6.5S22 12 22 12s-3.7 6.5-10 6.5S2 12 2 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
  clock: <G d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2" />,
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
          <motion.div
            role="dialog"
            aria-label="Command palette"
            initial={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
            transition={m.t()}
            style={{ transformOrigin: "top center" }}
            className="flex h-fit max-h-[calc(100vh-60px)] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[22px] bg-pop shadow-[var(--shadow)]"
          >
            <PaletteBody />
          </motion.div>
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
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-0 px-[22px] text-ink-3">
        <SearchIcon size={19} />
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
          className="h-full flex-1 border-0 bg-transparent text-[17px] text-foreground outline-none placeholder:text-ink-3"
        />
      </div>
      <div ref={list} role="listbox" className="scroll flex-1 px-2.5 pb-2.5">
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? it.group : null
          lastGroup = it.group
          return (
            <div key={`${it.group}-${it.id}`}>
              {header && <div className="h-[30px] px-3 pt-2.5 text-[12px] text-ink-3">{header}</div>}
              <div
                data-i={i}
                role="option"
                aria-selected={i === cursor}
                onMouseMove={() => setCursor(i)}
                onClick={() => run(it)}
                className={`flex h-[38px] items-center gap-3 rounded-[12px] px-3 text-[14px] text-foreground transition-colors duration-100 ${
                  i === cursor ? "bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]" : ""
                }`}
              >
                <span className="flex w-[22px] shrink-0 justify-center text-ink-3">{iconOf(it)}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && (/[⌘⌥⇧⌃]|\+/.test(it.hint) ? <Keys keys={it.hint} /> : <span className="shrink-0 text-[12px] text-ink-3">{it.hint}</span>)}
              </div>
            </div>
          )
        })}
        {!items.length && <div className="px-2.5 py-6 text-center text-[13px] text-ink-3">Nothing matches "{q}"</div>}
      </div>
    </>
  )
}

/** The key caps, as the board draws them: 22 px squares a row gap apart. */
function Keys({ keys }: { keys: string }) {
  const mods = keys.match(/^[⌘⌥⇧⌃]*/)?.[0] ?? ""
  const rest = keys.slice(mods.length)
  const parts = keys.length > 1 && keys.includes("+") ? [keys] : [...Array.from(mods), ...(rest ? [rest] : [])]
  return (
    <>
      {parts.map((k, i) => (
        <kbd key={i} className="flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-[7px] border-0 bg-fill-2 px-1.5 font-sans text-[12px] text-ink-2">
          {k}
        </kbd>
      ))}
    </>
  )
}

function iconOf(it: PaletteEntry): ReactNode {
  if (it.id.startsWith("agent-") || it.id.startsWith("install-")) {
    const agent = getState().catalog?.agents.find((a) => it.id.endsWith(a.id))
    if (agent) return <LogoTile logo={agentLogo(agent)} name={agent.name} size={22} />
  }
  if (it.id.startsWith("model-")) {
    const model = getState().catalog?.axe.models.find((m) => it.id === `model-${m.id}`)
    if (model) return <LogoTile auto={model.id === "auto"} logo={modelLogo(model)} name={model.label} size={22} />
  }
  if (it.group === "Chats") return ICONS.chat
  return it.icon ? ICONS[it.icon] : null
}
