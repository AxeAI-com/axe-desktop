import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, type ReactNode } from "react"

import type { Helper } from "@shared/types"

import asana from "@/assets/connectors/asana.svg?url"
import atlassian from "@/assets/connectors/atlassian.svg?url"
import canva from "@/assets/connectors/canva.svg?url"
import figma from "@/assets/connectors/figma.svg?url"
import github from "@/assets/connectors/github.svg?url"
import huggingface from "@/assets/connectors/huggingface.svg?url"
import intercom from "@/assets/connectors/intercom.svg?url"
import linear from "@/assets/connectors/linear.svg?url"
import notion from "@/assets/connectors/notion.svg?url"
import sentry from "@/assets/connectors/sentry.svg?url"
import slack from "@/assets/connectors/slack.svg?url"
import stripe from "@/assets/connectors/stripe.svg?url"
import vercel from "@/assets/connectors/vercel.svg?url"
import webflow from "@/assets/connectors/webflow.svg?url"
import { openLibrary } from "@/lib/libraries"
import { useMotion } from "@/lib/motion"

import { BrandLogo } from "./BrandLogo"
import { button } from "./Kit"
import {
  AgentIcon,
  BoltIcon,
  BrainIcon,
  BranchIcon,
  ChartIcon,
  ChatIcon,
  ChecklistIcon,
  ChevronDown,
  ClipboardIcon,
  ClockIcon,
  DashboardIcon,
  DownloadIcon,
  FileIcon,
  GlobeIcon,
  KeyboardIcon,
  MonitorIcon,
  PencilIcon,
  PhoneIcon,
  PlugIcon,
  ScreenIcon,
  SearchIcon,
  ShapesIcon,
  SkillIcon,
  SparkIcon,
  TelescopeIcon,
  TerminalIcon,
  VoiceIcon,
  XIcon,
} from "./Icons"

// The pieces every library page is made of: a calm page with a title, filter chips, a grid of cards,
// a sheet for details and forms, and the brands' logos.

// The board's 16px side padding (Kit's px-4 is 15px at the 15px root).
export const ghost = button.secondary.replace("px-4", "px-[16px]")
export const primary = button.primary.replace("px-4", "px-[16px]")
/** The 28px secondary pill on a card's foot: Add, Connect, Sign in. */
export const small =
  "inline-flex h-[28px] shrink-0 items-center justify-center rounded-full border-0 bg-fill-4 px-[12px] text-[13px] text-ink transition-colors duration-150 enabled:hover:bg-fill-3 disabled:opacity-40"

type IconC = (p: { size?: number }) => ReactNode

/** A skill's or agent's mark: its icon in its own colour on a soft tint of that colour, readable in both themes. */
export function SkillTile({ icon: Icon, name, tint, size = 36 }: { icon: IconC; name: string; tint?: string; size?: number }) {
  const c = tint ?? tintFor(name)
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[10px]"
      style={{ width: size, height: size, color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` }}
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  )
}

const TINTS = ["#3b82f6", "#e11d48", "#d97706", "#db2777", "#059669", "#7c3aed", "#0d9488", "#ea580c", "#0284c7", "#4f46e5"]

/** A stable colour for a name, so a skill keeps its colour. */
export function tintFor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]!
}

/** Words in a skill's or agent's name and description, and the icon they suggest. First match wins. */
const ICON_WORDS: [RegExp, IconC][] = [
  [/brows|chrome|web ?site|\burl|crawl|scrap/, GlobeIcon],
  [/video|film|frame|animat|motion|render|clip/, ScreenIcon],
  [/design|\bui\b|shadcn|figma|layout|brand|logo|css|style/, ShapesIcon],
  [/writ|copy|blog|post|tone|essay|edit text|rewrite/, PencilIcon],
  [/research|cite|citation|source|paper|study/, TelescopeIcon],
  [/find|search|discover|look ?up|index/, SearchIcon],
  [/\bcli\b|terminal|command|shell|bash|driver|script/, TerminalIcon],
  [/mac|desktop|native|swift|window|computer/, MonitorIcon],
  [/audio|music|song|voice|sound|speech|podcast/, VoiceIcon],
  [/data|chart|sql|metric|analytic|dashboard|report|number/, ChartIcon],
  [/plan|task|todo|checklist|project|roadmap/, ChecklistIcon],
  [/chat|email|mail|support|reply|message|customer/, ChatIcon],
  [/file|pdf|docx?\b|spreadsheet|xlsx|slide|deck|document/, FileIcon],
  [/memory|brain|learn|knowledge|remember|note/, BrainIcon],
  [/\bgit|branch|pull request|\bpr\b|merge|review|diff/, BranchIcon],
  [/deploy|release|ship|fast|perf|speed|optimi/, BoltIcon],
  [/schedul|calendar|time|cron|daily|weekly|meeting/, ClockIcon],
  [/phone|mobile|ios|android/, PhoneIcon],
  [/mcp|connect|integrat|plugin|\bapi\b|webhook/, PlugIcon],
  [/install|download|package|setup/, DownloadIcon],
  [/registry|catalog|library|collection|block|component|template/, DashboardIcon],
  [/shortcut|keyboard|hotkey/, KeyboardIcon],
  [/clipboard|paste|snippet/, ClipboardIcon],
  [/agent|assistant|helper|bot/, AgentIcon],
  [/code|program|debug|test|typescript|react|python/, TerminalIcon],
]
const SPARE_ICONS: IconC[] = [SparkIcon, BoltIcon, ShapesIcon, BrainIcon, ClipboardIcon, AgentIcon, ChecklistIcon, SkillIcon, DashboardIcon, KeyboardIcon]

/**
 * An icon for each item that fits its words, with no two items in one list sharing an icon while another fits:
 * the name's matches come first, then the description's, then a spare.
 */
export function pickIcons(items: { key: string; name: string; text?: string; first?: IconC }[]): Map<string, IconC> {
  const used = new Set<IconC>()
  const out = new Map<string, IconC>()
  const matches = (t: string) => ICON_WORDS.filter(([re]) => re.test(t.toLowerCase())).map(([, icon]) => icon)
  for (const it of items) {
    const fits = [...(it.first ? [it.first] : []), ...matches(it.name), ...matches(it.text ?? "")]
    let h = 0
    for (const ch of it.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const spares = SPARE_ICONS.map((_, i) => SPARE_ICONS[(h + i) % SPARE_ICONS.length]!)
    const icon = fits.find((i) => !used.has(i)) ?? spares.find((i) => !used.has(i)) ?? fits[0] ?? spares[0]!
    used.add(icon)
    out.set(it.key, icon)
  }
  return out
}

/** A sheet's action row that stays in view while the form scrolls. */
export const sheetFooter = "sticky -bottom-[24px] z-10 -mx-[24px] -mb-[24px] flex items-center gap-[8px] bg-pop px-[24px] py-[16px]"

export { Select } from "./Select"

/** Customize's tabs: one sidebar item, one page, these three. */
const CUSTOMIZE_TABS: { kind: "skills" | "connectors" | "agents"; label: string }[] = [
  { kind: "skills", label: "Skills" },
  { kind: "agents", label: "Agents" },
  { kind: "connectors", label: "Connectors" },
]

/** A page body that scrolls: its heading lives on the title bar (components/TitleBar.tsx). */
export const PAGE_TOP = "@container scroll flex min-h-0 flex-1 justify-center"

/** The page every library page shares: a centred 920 column; the title and subtitle are on the title bar, the tabs and pills here. */
export function LibraryPage({
  actions,
  tab,
  search,
  children,
}: {
  /** Named on the title bar; kept so each page still says what it is. */
  title?: string
  subtitle?: string
  actions?: ReactNode
  /** One of Customize's tabs: the page is titled Customize, with the tabs under the header. */
  tab?: "skills" | "connectors" | "agents"
  /** A search field on the right of the tabs. */
  search?: ReactNode
  children: ReactNode
}) {
  const m = useMotion()
  return (
    <div className={`${PAGE_TOP} px-[24px]`}>
      <div className="flex h-max w-full max-w-[920px] flex-col gap-[24px] pt-[24px] pb-[200px]">
        <motion.header {...m.rise} className="flex flex-col gap-[24px]">
          {tab && (
            <div className="flex items-center gap-[16px]">
              <div role="tablist" aria-label="Customize" className="flex h-[38px] items-center gap-[2px] rounded-full bg-segment p-[3px] dark:bg-card">
                {CUSTOMIZE_TABS.map((t) => (
                  <button
                    key={t.kind}
                    role="tab"
                    aria-selected={t.kind === tab}
                    onClick={() => openLibrary(t.kind)}
                    className={`h-[32px] min-w-[104px] rounded-full border-0 px-[16px] text-[14px] transition-colors duration-150 ${t.kind === tab ? "bg-raised-2 text-ink shadow-card" : "bg-transparent text-ink-3 hover:text-ink-2"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              {search}
              {actions && <div className="flex shrink-0 items-center gap-[8px]">{actions}</div>}
            </div>
          )}
          {!tab && actions && <div className="flex min-h-[40px] items-center justify-end gap-[8px]">{actions}</div>}
        </motion.header>
        {children}
      </div>
    </div>
  )
}

export function FilterChips<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-[4px]">
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`h-[28px] rounded-full border-0 px-[14px] text-[13px] transition-colors duration-150 ${on ? "bg-fill-4 text-ink" : "bg-transparent text-ink-3 hover:bg-fill hover:text-ink-2"}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Up to three across (two, then one, as the window narrows). */
export function Grid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className="@container">
      <div className={`grid grid-cols-1 gap-[16px] @[560px]:grid-cols-2 ${cols === 3 ? "@[860px]:grid-cols-3" : ""}`}>{children}</div>
    </div>
  )
}

/** A gallery card: rises in after the one before, lifts on hover. */
export function Card({ i, onOpen, label, children, className = "" }: { i: number; onOpen?: () => void; label: string; children: ReactNode; className?: string }) {
  const m = useMotion()
  return (
    <motion.div
      {...m.card(m.stagger(i, 0.03, 0.3))}
      {...(onOpen ? m.lift : {})}
      role={onOpen ? "button" : "article"}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => onOpen && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className={`relative flex h-[136px] flex-col gap-[8px] rounded-[16px] bg-card p-[16px] text-left outline-none transition-colors duration-150 focus-visible:bg-raised ${onOpen ? "cursor-default hover:bg-raised" : ""} ${className}`}
    >
      {children}
    </motion.div>
  )
}

/** A sheet over the page for details and forms. Escape or the scrim closes it. */
export function Sheet({ open, onClose, label, children, width = 560 }: { open: boolean; onClose: () => void; label: string; children: ReactNode; width?: number }) {
  const m = useMotion()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose())
    window.addEventListener("keydown", key, true)
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("input, textarea, button[data-autofocus]")?.focus())
    return () => window.removeEventListener("keydown", key, true)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={m.t(0.12)}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
          style={{ background: "var(--scrim)" }}
          onPointerDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={box}
            {...m.pop("top center")}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            style={{ width, ...m.pop("top center").style }}
            className="scroll relative box-border flex max-h-[76vh] max-w-[calc(100%-48px)] flex-col gap-[20px] rounded-[16px] bg-pop p-[24px] shadow-[var(--shadow)]"
          >
            <button
              aria-label="Close"
              onClick={onClose}
              className="absolute top-[16px] right-[16px] flex h-[28px] w-[28px] items-center justify-center rounded-[6px] border-0 bg-transparent text-ink-3 hover:bg-fill-2 hover:text-ink"
            >
              <XIcon size={14} />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-[13px] text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </label>
  )
}

export const inputClass =
  "box-border w-full rounded-[6px] border-0 bg-composer px-[12px] py-[9px] text-[13px] leading-[20px] text-ink outline-none placeholder:text-ink-4 focus:shadow-[0_0_0_1px_var(--accent-2)]"

export function Switch({ on, onChange, label, flat }: { on: boolean; onChange: (on: boolean) => void; label: string; flat?: boolean }) {
  const m = useMotion()
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => (e.stopPropagation(), onChange(!on))}
      className={`flex shrink-0 items-center rounded-full border-0 p-[2px] transition-colors duration-150 ${flat ? "h-[20px] w-[34px]" : "h-[22px] w-[38px]"} ${on ? "justify-end bg-brand" : flat ? "justify-start bg-fill-4" : "justify-start bg-fill-4"}`}
    >
      <motion.span layout transition={m.t(0.12)} className={`block rounded-full bg-white ${flat ? "size-[16px]" : "h-[18px] w-[18px]"}`} />
    </button>
  )
}

export function ErrorLine({ text }: { text: string | null }) {
  return text ? <p className="m-0 text-[13px] text-bad">{text}</p> : null
}

// Logos

const CONNECTOR_LOGOS: Record<string, { src: string; mono: boolean }> = {
  notion: { src: notion, mono: false },
  linear: { src: linear, mono: true },
  github: { src: github, mono: true },
  slack: { src: slack, mono: true },
  canva: { src: canva, mono: false },
  atlassian: { src: atlassian, mono: false },
  figma: { src: figma, mono: true },
  asana: { src: asana, mono: true },
  sentry: { src: sentry, mono: true },
  vercel: { src: vercel, mono: true },
  stripe: { src: stripe, mono: false },
  intercom: { src: intercom, mono: true },
  webflow: { src: webflow, mono: false },
  huggingface: { src: huggingface, mono: false },
}

/** Each brand on its own colour, like an app icon; white: draw a one-colour mark in white on it. */
const BRAND_TILES: Record<string, { bg: string; white?: boolean }> = {
  notion: { bg: "#ffffff" },
  linear: { bg: "#5e6ad2", white: true },
  github: { bg: "#24292f", white: true },
  slack: { bg: "#ffffff" },
  canva: { bg: "#ffffff" },
  atlassian: { bg: "#ffffff" },
  figma: { bg: "#1e1e1e", white: true },
  asana: { bg: "#f06a6a", white: true },
  sentry: { bg: "#362d59", white: true },
  vercel: { bg: "#000000", white: true },
  stripe: { bg: "#635bff", white: true },
  intercom: { bg: "#1f8ded", white: true },
  webflow: { bg: "#146ef5", white: true },
  huggingface: { bg: "#ffd21e" },
}

/** A connector's logo on its brand's colour, or a plug for ones you added yourself. */
export function ConnectorLogo({ catalogId, name, size = 36 }: { catalogId?: string; name: string; size?: number }) {
  const logo = catalogId ? CONNECTOR_LOGOS[catalogId] : undefined
  const tile = catalogId ? BRAND_TILES[catalogId] : undefined
  if (logo && tile)
    return (
      <span aria-hidden="true" className="flex shrink-0 items-center justify-center" style={{ width: size, height: size, borderRadius: Math.round(size / 4) + 1, background: tile.bg }}>
        <img src={logo.src} alt="" style={{ width: Math.round(size * 0.61), height: Math.round(size * 0.61), filter: tile.white ? "brightness(0) invert(1)" : undefined }} />
      </span>
    )
  if (logo) return <BrandLogo logo={logo} name={name} size={size} />
  return <IconTile icon={PlugIcon} colors={["#64748b", "#334155"]} size={size} />
}

/** A coloured icon, like an app icon: a two-tone tile with a white glyph. Skills and agents use it. */
export function IconTile({ icon: Icon, colors, size = 36 }: { icon: (p: { size?: number }) => ReactNode; colors: readonly [string, string]; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center text-white [&_svg]:text-white"
      style={{ width: size, height: size, borderRadius: Math.round(size / 4) + 1, background: `linear-gradient(145deg, ${colors[0]}, ${colors[1]})` }}
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  )
}

const TILE_COLORS: readonly (readonly [string, string])[] = [
  ["#3b82f6", "#1d4ed8"],
  ["#f43f5e", "#be123c"],
  ["#f59e0b", "#d97706"],
  ["#ec4899", "#a21caf"],
  ["#10b981", "#047857"],
  ["#a78bfa", "#7c3aed"],
  ["#2dd4bf", "#0e7490"],
  ["#fb923c", "#e11d48"],
  ["#38bdf8", "#4f46e5"],
  ["#64748b", "#312e81"],
]

/** A stable colour pair for a name, so a skill keeps its colour. */
export function tileColors(name: string): readonly [string, string] {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TILE_COLORS[h % TILE_COLORS.length]!
}

export const KIND_ICONS: Record<Helper["kind"], IconC> = {
  write: PencilIcon,
  research: TelescopeIcon,
  code: TerminalIcon,
  plan: ChecklistIcon,
  support: ChatIcon,
  data: ChartIcon,
  design: ShapesIcon,
  custom: SparkIcon,
}

/** An agent's mark: its kind's icon on a quiet tile. */
const KIND_COLORS: Record<Helper["kind"], readonly [string, string]> = {
  write: ["#fb923c", "#e11d48"],
  research: ["#38bdf8", "#4f46e5"],
  code: ["#64748b", "#312e81"],
  plan: ["#a78bfa", "#7c3aed"],
  support: ["#2dd4bf", "#0e7490"],
  data: ["#34d399", "#0d9488"],
  design: ["#f472b6", "#a21caf"],
  custom: ["#fbbf24", "#d97706"],
}

export function HelperMark({ kind, size = 36, flat, icon, name }: { kind: Helper["kind"]; size?: number; flat?: boolean; icon?: IconC; name?: string }) {
  if (flat) return <SkillTile icon={icon ?? KIND_ICONS[kind] ?? SparkIcon} name={name ?? kind} tint={name ? undefined : KIND_COLORS[kind]?.[0]} size={size} />
  return <IconTile icon={KIND_ICONS[kind] ?? SparkIcon} colors={KIND_COLORS[kind] ?? KIND_COLORS.custom} size={size} />
}
