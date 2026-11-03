import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { nameFor, repoHeadline } from "@shared/watching/copy"
import type { CheckRow, Kind, OpenFinding, WatchView } from "@shared/watching/types"

import { invoke } from "@/lib/bridge"
import {
  coverLine,
  GROUP_LABEL,
  groupHost,
  hostOf,
  grouped,
  healthOf,
  isDown,
  lineOf,
  loadCollapsed,
  metricsOf,
  needsLook,
  problemsOf,
  ringArcs,
  saveCollapsed,
  ticks,
  type Group,
  type Health,
  type Metric,
  type TickTone,
} from "@/lib/dashboard"
import { useMotion } from "@/lib/motion"
import { setState, useStore } from "@/lib/store"
import { checkNow, openWatch, setPaused } from "@/lib/watching"

import { agentLogo, BrandLogo } from "@/components/BrandLogo"
import { AlertIcon, CheckIcon, ChevronDown, ExternalIcon, MoreIcon, PencilIcon, RetryIcon, TrashIcon } from "@/components/Icons"
import { MenuItem, MenuLine, Popover } from "@/components/Popover"
import { KindIcon, PauseIcon, PlayIcon } from "@/components/WatchIcons"
import { DeleteDialog } from "@/components/watching/DeleteDialog"
import { clock, day, sameDay } from "@/components/watching/Evidence"
import { useFixLabel } from "@/components/watching/Fix"

// The Watching dashboard (design "Watching redesign", Dashboard and Narrow boards): how many watches are
// healthy, four numbers from real watches, what needs a look, and every watch grouped by kind with its last
// 24 checks. Each watch is a chat: a row, a card's title or its pencil opens the watch's own thread.

/** Under this width the page takes the Narrow board's one-column layout. */
const WIDE = 1000

function ago(t: number, now = Date.now()) {
  const m = Math.round((now - t) / 60_000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m} min ago`
  if (sameDay(t, now)) return clock(t)
  if (sameDay(t, now - 86_400_000)) return "Yesterday"
  return day(t)
}
const since = (t: number, now = Date.now()) => (sameDay(t, now) ? clock(t) : day(t))

/** Numbers, times, sizes and versions in a line, set in SF Mono with tabular figures. */
export function Nums({ children }: { children: string }) {
  const parts = children.split(/(\d[\d.,:]*(?:\s?(?:ms|GB|MB|KB|TB|s|min|days?|%))?)/)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="mono">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  )
}

/** Re-renders every half minute, so "3 min ago" keeps up. */
function useMinute() {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
}

/* Small parts */

function Ticks({ w, fill, j = 0 }: { w: WatchView; fill?: boolean; j?: number }) {
  return (
    <div aria-hidden="true" className={`flex gap-[2px] ${fill ? "w-full" : "flex-none"}`} data-testid="dash-ticks">
      {ticks(w.strip, !!w.checking).map((t, i) => (
        <Tick key={i} t={t} i={i + j} fill={fill} />
      ))}
    </div>
  )
}

function Tick({ t, i, fill }: { t: TickTone; i: number; fill?: boolean }) {
  return <span data-t={t} className={`dash-tick ${t === "live" ? "dash-pulse" : ""} ${fill ? "flex-1" : "w-[4px]"}`} style={{ ["--j" as string]: i }} />
}

function Dot({ tone, pulse }: { tone: "ok" | "warn" | "bad" | "blue" | "mute"; pulse?: boolean }) {
  const bg = { ok: "var(--dash-ok)", warn: "var(--dash-warn-tick)", bad: "var(--dash-bad)", blue: "var(--dash-blue)", mute: "var(--dash-label-3)" }[tone]
  return <span aria-hidden="true" className={`size-[6px] flex-none rounded-full ${pulse ? "dash-pulse" : ""}`} style={{ background: bg }} />
}

function Tile({ kind, tone = "plain" }: { kind: Kind; tone?: "plain" | "warn" | "blue" }) {
  const style =
    tone === "warn" ? { background: "var(--dash-warn-soft)", color: "var(--dash-warn)" } : tone === "blue" ? { background: "var(--dash-blue-soft)", color: "var(--dash-blue)" } : { background: "var(--dash-tile)", color: "var(--dash-label)" }
  return (
    <span className="grid size-[32px] flex-none place-items-center rounded-[8px]" style={style}>
      <KindIcon kind={kind} size={16} strokeWidth={2} />
    </span>
  )
}

function Badge({ tone, mono, children }: { tone: "warn" | "bad" | "mute"; mono?: boolean; children: ReactNode }) {
  const style = tone === "warn" ? { color: "var(--dash-warn)", background: "var(--dash-warn-soft)" } : tone === "bad" ? { color: "var(--dash-bad)", background: "color-mix(in srgb, var(--dash-bad) 14%, transparent)" } : { color: "var(--dash-label-2)", background: "var(--dash-chip)" }
  return (
    <span className={`${mono ? "mono " : ""}inline-flex h-[22px] flex-none items-center rounded-[6px] px-[8px] text-[11px]`} style={style}>
      {children}
    </span>
  )
}

const priBtn = "dash-btn inline-flex h-[28px] cursor-pointer items-center gap-[8px] rounded-[6px] border-0 text-[13px] font-medium no-underline"
const secBtn = "dash-btn inline-flex h-[28px] cursor-pointer items-center gap-[4px] rounded-[6px] border-0 px-[12px] text-[13px]"
const pri = { background: "var(--dash-btn-pri)", color: "var(--dash-btn-pri-ink)" }
const sec = { background: "var(--dash-btn)", color: "var(--dash-label)", boxShadow: "inset 0 0 0 1px var(--dash-btn-edge)" }

/** The pencil: every watch is a chat, and this opens it. */
function EditButton({ w }: { w: WatchView }) {
  return (
    <button
      type="button"
      aria-label={`Open ${w.name}`}
      title="Open its chat"
      onClick={(e) => {
        e.stopPropagation()
        openWatch(w.id)
      }}
      className="grid size-[28px] flex-none cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent p-0 hover:bg-[var(--dash-btn)]"
      style={{ color: "var(--dash-label-2)" }}
    >
      <PencilIcon size={14} />
    </button>
  )
}

/** Check now, Pause or Resume, Delete: a right-click on a row or card. */
function useWatchMenu(w: WatchView) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setAt(null), [])
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setAt({ top: e.clientY, left: Math.min(e.clientX, window.innerWidth - 200) })
  }
  // The ⋯ shows on hover or focus, before the pencil: the same menu as a right-click.
  const more = (
    <button
      type="button"
      aria-label={`More for ${w.name}`}
      aria-haspopup="menu"
      aria-expanded={!!at}
      onClick={(e) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        setAt((o) => (o ? null : { top: r.bottom + 4, left: Math.min(r.right - 180, window.innerWidth - 200) }))
      }}
      className={`grid size-[28px] flex-none cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent p-0 opacity-0 group-hover/w:opacity-100 hover:bg-[var(--dash-btn)] focus-visible:opacity-100 ${at ? "opacity-100" : ""}`}
      style={{ color: "var(--dash-label-2)" }}
    >
      <MoreIcon size={16} />
    </button>
  )
  const menu = (
    <>
      <Popover open={!!at} onClose={close} anchor={anchor} at={at ?? undefined} origin="top left" className="min-w-[180px]!" label={w.name}>
        <MenuItem
          icon={<RetryIcon size={14} />}
          onSelect={() => {
            close()
            void checkNow(w.id)
          }}
        >
          Check now
        </MenuItem>
        <MenuItem
          icon={w.paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
          onSelect={() => {
            close()
            void setPaused(w.id, !w.paused)
          }}
        >
          {w.paused ? "Resume" : "Pause"}
        </MenuItem>
        <MenuLine />
        <MenuItem
          danger
          icon={<TrashIcon size={14} />}
          onSelect={() => {
            close()
            setConfirm(true)
          }}
        >
          Delete
        </MenuItem>
      </Popover>
      {confirm && <DeleteDialog w={w} onClose={() => setConfirm(false)} />}
    </>
  )
  return { anchor, onContextMenu, menu, more }
}

/* The status strip */

const C = 2 * Math.PI * 30

function Ring({ h }: { h: Health }) {
  const arcs = ringArcs(h, C)
  const color = { ok: "var(--dash-ok)", warn: "var(--dash-warn-tick)", bad: "var(--dash-bad)" }
  return (
    <div className="relative size-[72px] flex-none">
      <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={`${h.healthy} of ${h.total} healthy`}>
        <circle cx="36" cy="36" r="30" fill="none" stroke="var(--dash-ring-track)" strokeWidth="6" />
        {arcs.map((a, i) => (
          <circle
            key={a.tone}
            className={i === 0 ? "dash-ring-ok" : "dash-ring-late"}
            cx="36"
            cy="36"
            r="30"
            fill="none"
            stroke={color[a.tone]}
            strokeWidth="6"
            strokeLinecap={arcs.length > 1 ? "round" : "butt"}
            strokeDasharray={`${a.len} 400`}
            strokeDashoffset={a.offset}
            transform="rotate(-90 36 36)"
          />
        ))}
      </svg>
      <div className="mono absolute inset-0 flex items-center justify-center text-[13px] font-medium">
        {h.healthy}/{h.total}
      </div>
    </div>
  )
}

function StatusStrip({ watches, wide }: { watches: WatchView[]; wide: boolean }) {
  const h = healthOf(watches)
  const look = h.warnings + h.down
  const running = watches.find((w) => w.checking)
  const cover = coverLine(grouped(watches).map((g) => g.group))
  const checking = running ? `Checking ${running.name} now.` : ""
  const sub = wide ? [cover, checking].filter(Boolean).join(" ") : checking || cover
  const counts: [string, number, string][] = [
    ["var(--dash-ok)", h.healthy, "healthy"],
    ["var(--dash-warn-tick)", h.warnings, h.warnings === 1 ? "warning" : "warnings"],
    [h.down ? "var(--dash-bad)" : "var(--dash-label-3)", h.down, "down"],
  ]
  return (
    <div
      className={`dash-panel dash-rise flex items-center gap-x-[24px] p-[24px] ${wide ? "" : "flex-wrap gap-y-[16px]"}`}
      style={{ ["--i" as string]: 0, boxShadow: "inset 0 0 0 1px var(--dash-panel-edge), 0 24px 56px -32px var(--dash-ok-glow), var(--dash-shadow)" }}
      data-testid="dash-status"
    >
      <Ring h={h} />
      <div className={`min-w-0 ${wide ? "flex-1" : "flex-[1_1_360px]"}`}>
        <p className="m-0 text-[26px] leading-[1.23] tracking-[-0.012em]">
          <span className="font-semibold">
            {h.healthy} of {h.total}
          </span>{" "}
          healthy
          {look > 0 && (
            <>
              ,{" "}
              <span className="font-semibold" style={{ color: "var(--dash-warn)" }}>
                {look} {look === 1 ? "needs" : "need"} a look
              </span>
            </>
          )}
        </p>
        {sub && (
          <p className="m-0 mt-[8px] text-[13px]" style={{ color: "var(--dash-label-2)" }}>
            {sub}
          </p>
        )}
      </div>
      <div className={`flex gap-[16px] text-[11px] tracking-[0.006em] ${wide ? "flex-none" : "flex-[1_1_100%]"}`} style={{ color: "var(--dash-label-2)" }}>
        {counts.map(([c, n, label]) => (
          <div key={label} className="flex items-center gap-[8px]">
            <span className="size-[8px] rounded-full" style={{ background: c }} />
            <span className="mono" style={{ color: "var(--dash-label)" }}>
              {n}
            </span>
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

/* Metric cards */

function Spark({ values, wide }: { values: number[]; wide: boolean }) {
  const v = values.slice(-13)
  if (v.length < 2) return <div className="h-[40px]" />
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const y = (n: number) => (hi === lo ? 22 : 30 - ((n - lo) / (hi - lo)) * 16)
  const x = (i: number) => (i * 240) / (v.length - 1)
  const line = v.map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(" ")
  return (
    <svg width="100%" height="40" viewBox="-4 0 248 44" preserveAspectRatio={wide ? undefined : "none"} aria-hidden="true">
      <path d={`${line} L240 44 L0 44 Z`} fill="var(--dash-blue-soft)" />
      <path d={line} fill="none" stroke="var(--dash-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {wide && <circle cx="240" cy={y(v.at(-1)!)} r="3" fill="var(--dash-blue)" />}
    </svg>
  )
}

const METRIC_ICON: Record<Metric["kind"], Kind> = { response: "uptime", certificate: "security", disk: "disk", tests: "tests" }
const METRIC_LABEL: Record<Metric["kind"], string> = { response: "API response", certificate: "Certificate", disk: "Disk", tests: "Tests" }

function MetricCard({ m, i, wide }: { m: Metric; i: number; wide: boolean }) {
  const at = m.w.latest?.at
  const fresh = at !== undefined && ago(at) === "Just now"
  const label = m.kind === "response" && m.w.kind === "uptime" ? "Response" : METRIC_LABEL[m.kind]
  const big = "mono dash-num text-[26px] font-medium tracking-[-0.01em]"
  const unit = "text-[13px]"
  return (
    <button
      type="button"
      onClick={() => openWatch(m.w.id)}
      aria-label={`${label}, ${m.w.name}`}
      className="dash-panel dash-rise flex min-w-0 cursor-pointer flex-col gap-[8px] border-0 p-[16px] text-left"
      style={{ ["--i" as string]: i + 1, color: "var(--dash-label)" }}
      data-testid={`metric-${m.kind}`}
    >
      <div className="flex w-full items-center gap-[8px] text-[11px] tracking-[0.006em]" style={{ color: "var(--dash-label-2)" }}>
        <KindIcon kind={METRIC_ICON[m.kind]} size={16} strokeWidth={2} />
        {label}
        {at !== undefined && m.kind !== "certificate" && (
          <span className="mono ml-auto" style={fresh ? { color: "var(--dash-ok)" } : undefined}>
            {ago(at)}
          </span>
        )}
      </div>
      {m.kind === "tests" ? (
        <div className="flex h-[32px] items-center gap-[8px]">
          <span className="grid size-[24px] place-items-center rounded-full" style={m.passing ? { background: "var(--dash-ok-soft)", color: "var(--dash-ok)" } : { background: "var(--dash-warn-soft)", color: "var(--dash-warn)" }}>
            {m.passing ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
          </span>
          <span className="dash-num text-[26px] font-medium tracking-[-0.012em]" style={{ ["--i" as string]: i + 1, color: m.passing ? "var(--dash-ok)" : "var(--dash-warn)" }}>
            {m.passing ? "Passing" : "Failing"}
          </span>
        </div>
      ) : (
        <div className="flex items-baseline gap-[8px]">
          <span className={big} style={{ ["--i" as string]: i + 1 }}>
            {m.kind === "response" ? Math.round(m.ms).toLocaleString("en-US") : m.kind === "certificate" ? m.days : Math.round(m.freeGb).toLocaleString("en-US")}
          </span>
          <span className={unit} style={{ color: "var(--dash-label-2)" }}>
            {m.kind === "response" ? "ms" : m.kind === "certificate" ? (m.days === 1 ? "day left" : "days left") : "GB free"}
          </span>
        </div>
      )}
      <div className="flex h-[40px] w-full flex-col justify-center gap-[8px]">
        {m.kind === "response" ? (
          <Spark values={m.series} wide={wide} />
        ) : m.kind === "disk" ? (
          <>
            <div aria-hidden="true" className="h-[8px] overflow-hidden rounded-[4px]" style={{ background: "var(--dash-bar)" }}>
              <div className="dash-grow h-full rounded-[4px]" style={{ width: `${m.totalGb ? Math.round(((m.totalGb - m.freeGb) / m.totalGb) * 100) : 0}%`, background: "var(--dash-blue)" }} />
            </div>
            <div className="flex justify-between text-[11px]" style={{ color: "var(--dash-label-2)" }}>
              <span>Used</span>
              <span>
                Free <span className="mono">{Math.round(m.freeGb)} GB</span>
              </span>
            </div>
          </>
        ) : (
          <Ticks w={m.w} fill />
        )}
      </div>
      <div className="w-full truncate text-[11px] tracking-[0.006em]" style={{ color: "var(--dash-label-2)" }}>
        {m.kind === "certificate" && m.until ? (
          <>
            {m.foot}, until <span className="mono">{m.until}</span>
          </>
        ) : m.kind === "disk" && m.totalGb ? (
          <>
            {m.foot}, of <span className="mono">{Math.round(m.totalGb)} GB</span>
          </>
        ) : (
          m.foot
        )}
      </div>
    </button>
  )
}

/* Needs a look */

/** A failing row of a check list: "express 4.21.2 to 5.1.0", or a service in an outage. */
const failing = (w: WatchView): CheckRow[] => (w.latest?.rows ?? []).filter((r) => !r.ok && !unreadable(r))
/** A service with no public status feed: grey, not a problem. */
const unreadable = (r: CheckRow) => r.value.startsWith("Not readable")

/** "OpenRouter, Groq and GitHub look fine.": the services running normally next to the one in trouble. */
function fine(w: WatchView): string {
  const ok = (w.latest?.rows ?? []).filter((r) => r.ok).map((r) => r.label)
  if (!ok.length) return ""
  const list = ok.length < 2 ? ok[0] : `${ok.slice(0, -1).join(", ")} and ${ok.at(-1)}`
  return `${list} ${ok.length === 1 ? "looks" : "look"} fine.`
}

const SHOW_WORD: Partial<Record<Kind, string>> = { outdated: "packages", seo: "checks", links: "pages", security: "checks", dns: "records", feed: "files", expiry: "dates" }

function LookCard({ w, i, span }: { w: WatchView; i: number; span: boolean }) {
  const ps = problemsOf(w)
  const f: OpenFinding | undefined = ps[0]
  const down = isDown(w)
  const { agent, agentId } = useFixLabel(w)
  const fixer = useStore((st) => st.catalog?.agents.find((a) => a.id === agentId))
  const [open, setOpen] = useState(false)
  const m = useMotion()
  const { anchor, onContextMenu, menu } = useWatchMenu(w)
  const rows = failing(w)
  const word = SHOW_WORD[w.kind]
  const service = w.kind === "status" && f
  const title = service ? f.headline : w.name
  const body = !f
    ? (w.latest?.error ? `${w.latest.error}.` : "Axe couldn’t check it the last three times.")
    : w.kind === "repo" && ps.length > 1
      ? `${repoHeadline(ps.length, w.name)}.`
      : service
        ? [f.detail ?? f.line ?? "", fine(w)].filter(Boolean).join(" ")
        : // With a list behind Show, the list says the rest.
          [f.headline.replace(/\.?$/, "."), rows.length && SHOW_WORD[w.kind] ? undefined : f.detail].filter(Boolean).join(" ")
  const statusUrl = service ? rows.find((r) => r.sub)?.sub : undefined
  return (
    <article
      ref={anchor}
      onContextMenu={onContextMenu}
      className={`dash-warn dash-rise flex min-w-0 flex-col gap-[16px] rounded-[12px] p-[24px] ${span ? "col-span-full" : ""}`}
      style={{ ["--i" as string]: 5 + i }}
      data-testid={`look-${w.kind}`}
    >
      <div className="flex items-start gap-[16px]">
        <Tile kind={w.kind} tone="warn" />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-[17px] leading-[1.29] font-semibold tracking-[-0.006em]">
            <button type="button" onClick={() => openWatch(w.id)} className="max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left font-semibold text-inherit" style={{ font: "inherit" }}>
              {title}
            </button>
          </h3>
          {f && (
            <div className="mono mt-[4px] text-[11px]" style={{ color: "var(--dash-warn)" }}>
              Since {since(f.openedAt)}
            </div>
          )}
        </div>
        <Badge tone={down ? "bad" : f ? "warn" : "mute"}>{down ? (f ? "Down" : "Couldn’t check") : "Warning"}</Badge>
        <EditButton w={w} />
      </div>
      <p className="m-0 text-[13px]">{body}</p>
      <Ticks w={w} fill />
      <AnimatePresence initial={false}>
        {open && rows.length > 0 && (
          <motion.div {...m.collapse} className="overflow-hidden">
            <RowsTable w={w} rows={rows} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-[8px]">
        {f?.fix === "agent" ? (
          <button
            type="button"
            className={`${priBtn} pr-[12px] pl-[8px]`}
            style={pri}
            onClick={() => {
              // The watch's own thread runs the fix, as a notification's Fix button does.
              setState({ watchFix: { id: w.id, key: f.key } })
              openWatch(w.id)
            }}
          >
            <BrandLogo logo={fixer ? agentLogo(fixer) : undefined} name={agent} size={16} />
            Fix with {agent}
          </button>
        ) : statusUrl ? (
          <button type="button" className={`${priBtn} pr-[8px] pl-[12px]`} style={pri} onClick={() => void invoke("app:openExternal", `https://${statusUrl}`)}>
            Open status page
            <ExternalIcon size={14} />
          </button>
        ) : !f ? (
          <button type="button" className={`${priBtn} px-[12px]`} style={pri} onClick={() => void checkNow(w.id)}>
            Check now
          </button>
        ) : null}
        {rows.length > 0 && word ? (
          <button type="button" aria-expanded={open} className={`${secBtn} pr-[8px]`} style={sec} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"} {word}
            <ChevronDown size={14} className={`transition-transform duration-[240ms] ${open ? "rotate-180" : ""}`} />
          </button>
        ) : (
          <button type="button" className={secBtn} style={sec} onClick={() => openWatch(w.id)}>
            Details
          </button>
        )}
      </div>
      {menu}
    </article>
  )
}

/** The Opened board's table: package, current, latest; any other list as label and value. */
function RowsTable({ w, rows }: { w: WatchView; rows: CheckRow[] }) {
  const split = w.kind === "outdated"
  const cols = split ? "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_24px_minmax(0,1fr)_64px]" : "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
  return (
    <div role="table" aria-label={`${w.name}, details`} className="flex flex-col gap-[8px]">
      <div role="row" className={`grid ${cols} items-center gap-[16px] px-[16px] text-[11px] tracking-[0.006em]`} style={{ color: "var(--dash-label-2)" }}>
        {split ? (
          <>
            <span role="columnheader">Package</span>
            <span role="columnheader">Current</span>
            <span role="columnheader" />
            <span role="columnheader">Latest</span>
            <span role="columnheader" className="text-right">
              Change
            </span>
          </>
        ) : (
          <>
            <span role="columnheader">Check</span>
            <span role="columnheader">Found</span>
          </>
        )}
      </div>
      {rows.map((r) => {
        const [cur, next] = split ? r.value.split(" to ") : []
        return (
          <div key={r.label} role="row" className={`grid ${cols} h-[40px] items-center gap-[16px] rounded-[10px] px-[16px] text-[13px]`} style={{ background: "var(--dash-row)", boxShadow: "inset 0 0 0 1px var(--dash-warn-soft)" }}>
            {split ? (
              <>
                <span role="cell" className="mono truncate">
                  {r.label}
                </span>
                <span role="cell" className="mono truncate" style={{ color: "var(--dash-label-2)" }}>
                  {cur}
                </span>
                <span role="cell" style={{ color: "var(--dash-warn)" }}>
                  →
                </span>
                <span role="cell" className="mono truncate">
                  {next ?? ""}
                </span>
                <span role="cell" className="text-right">
                  <Badge tone="warn">Major</Badge>
                </span>
              </>
            ) : (
              <>
                <span role="cell" className="truncate">
                  {r.label}
                </span>
                <span role="cell" className="truncate" style={{ color: "var(--dash-label-2)" }}>
                  <Nums>{r.value}</Nums>
                </span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* Groups */

function useCollapsed() {
  const [set, setSet] = useState(loadCollapsed)
  const toggle = (key: string) =>
    setSet((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveCollapsed(next)
      return next
    })
  return [set, toggle] as const
}

/** Under a heading that names the host, a watch keeps its own name only if you renamed it: "axeai.com links" reads "Links". */
const SHORT: Partial<Record<Kind, string>> = { pagespeed: "Page speed", global: "Global response", email: "Email blacklists", uptime: "Uptime", health: "API health", links: "Links", feed: "Updates", seo: "SEO", dns: "DNS", expiry: "Expiry", security: "Security", disk: "Disk" }
const nameIn = (w: WatchView, host?: string) => (SHORT[w.kind] && (host ? hostOf(w) === host : w.kind === "disk") && w.name === nameFor(w.kind, w.target) ? SHORT[w.kind]! : w.name)

function rowTone(w: WatchView): { dot: "ok" | "warn" | "bad" | "blue" | "mute"; right: string; rightColor: string } {
  const p = problemsOf(w)
  if (w.checking) return { dot: "blue", right: "Checking", rightColor: "var(--dash-blue)" }
  if (w.paused) return { dot: "mute", right: "Paused", rightColor: "var(--dash-label-2)" }
  if (isDown(w)) return { dot: "bad", right: p[0] ? since(p[0].openedAt) : "Can’t reach", rightColor: "var(--dash-bad)" }
  if (p[0]) return { dot: "warn", right: since(p[0].openedAt), rightColor: "var(--dash-warn)" }
  if (w.unread) return { dot: "blue", right: w.latest ? ago(w.latest.at) : "", rightColor: "var(--dash-blue)" }
  if (w.kind === "expiry" && w.latest?.metric !== undefined) return { dot: "ok", right: `${w.latest.metric} days`, rightColor: "var(--dash-label)" }
  const at = w.latest?.at
  return { dot: w.latest?.status === "failed" ? "mute" : "ok", right: at ? ago(at) : "", rightColor: at && ago(at) === "Just now" ? "var(--dash-ok)" : "var(--dash-label-2)" }
}

/** One watch as a 48 px row: tile, name and line, its last 24 checks, when, and the pencil. */
function Row({ w, host }: { w: WatchView; host?: string }) {
  const t = rowTone(w)
  const { anchor, onContextMenu, menu, more } = useWatchMenu(w)
  const look = needsLook(w)
  const line = lineOf(w).replace("Says ok, answered in", "Says ok,")
  return (
    <div
      ref={anchor}
      onContextMenu={onContextMenu}
      className={`${w.checking ? "dash-live" : look ? "dash-warn" : "dash-row"} group/w flex h-[48px] items-center gap-[8px] rounded-[10px] pr-[8px]`}
      data-testid={`row-${w.id}`}
    >
      <button
        type="button"
        onClick={() => openWatch(w.id)}
        className={`flex h-full min-w-0 flex-1 cursor-pointer items-center gap-[16px] rounded-[10px] border-0 bg-transparent py-0 pl-[8px] text-left ${w.paused ? "opacity-50" : ""}`}
        style={{ color: "var(--dash-label)" }}
      >
        <Tile kind={w.kind} tone={w.checking ? "blue" : look ? "warn" : "plain"} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-[8px] text-[13px]">
            <Dot tone={t.dot} pulse={w.checking} />
            <span className="truncate">{nameIn(w, host)}</span>
          </span>
          <span className="truncate text-[11px]" style={{ color: "var(--dash-label-2)" }}>
            <Nums>{line.replace(/\.$/, "")}</Nums>
          </span>
        </span>
        <Ticks w={w} />
        <span className="mono w-[72px] flex-none text-right text-[11px]" style={{ color: t.rightColor }}>
          {t.right}
        </span>
      </button>
      {more}
      <EditButton w={w} />
      {w.checking && (
        <div aria-hidden="true" className="pointer-events-none absolute right-0 bottom-0 left-0 h-[2px] overflow-hidden" style={{ background: "color-mix(in srgb, var(--dash-blue) 10%, transparent)" }}>
          <div className="dash-sweep" />
        </div>
      )}
      {menu}
    </div>
  )
}

/** This Mac on a wide window: a card per watch, its 24 checks across the bottom. */
function MacCard({ w }: { w: WatchView }) {
  const name = nameIn(w)
  const t = rowTone(w)
  const look = needsLook(w)
  const { anchor, onContextMenu, menu, more } = useWatchMenu(w)
  const line = lineOf(w).replace("Says ok, answered in", "Says ok,")
  return (
    <div ref={anchor} onContextMenu={onContextMenu} className={`${w.checking ? "dash-live" : look ? "dash-warn" : "dash-row"} group/w flex min-w-0 flex-col gap-[16px] rounded-[10px] p-[16px]`} data-testid={`row-${w.id}`}>
      <div className="flex items-center gap-[8px]">
        <button type="button" onClick={() => openWatch(w.id)} className={`flex min-w-0 flex-1 cursor-pointer items-center gap-[16px] border-0 bg-transparent p-0 text-left ${w.paused ? "opacity-50" : ""}`} style={{ color: "var(--dash-label)" }}>
          <Tile kind={w.kind} tone={w.checking ? "blue" : look ? "warn" : "plain"} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-[8px] text-[13px]">
              <Dot tone={t.dot} pulse={w.checking} />
              <span className="truncate">{name}</span>
            </span>
            <span className="truncate text-[11px]" style={{ color: "var(--dash-label-2)" }}>
              <Nums>{line.replace(/\.$/, "")}</Nums>
            </span>
          </span>
          <span className="mono flex-none text-[11px]" style={{ color: t.rightColor }}>
            {t.right}
          </span>
        </button>
        {more}
        <EditButton w={w} />
      </div>
      <Ticks w={w} fill />
      {w.checking && (
        <div aria-hidden="true" className="pointer-events-none absolute right-0 bottom-0 left-0 h-[2px] overflow-hidden" style={{ background: "color-mix(in srgb, var(--dash-blue) 10%, transparent)" }}>
          <div className="dash-sweep" />
        </div>
      )}
      {menu}
    </div>
  )
}

/** A status watch: every provider as a pill, the ones in trouble in amber. */
function Services({ w }: { w: WatchView }) {
  const rows = w.latest?.rows ?? []
  const { anchor, onContextMenu, menu } = useWatchMenu(w)
  return (
    <div ref={anchor} onContextMenu={onContextMenu} className="flex flex-col gap-[16px]" data-testid={`row-${w.id}`}>
      <div className="flex flex-wrap gap-[8px]">
        {rows.map((r) => {
          const tone = r.ok ? "ok" : unreadable(r) ? "mute" : "warn"
          return (
            <button
              key={r.label}
              type="button"
              title={r.value}
              onClick={() => openWatch(w.id)}
              className={`inline-flex h-[28px] cursor-pointer items-center gap-[8px] rounded-[6px] border-0 px-[12px] text-[13px] ${tone === "warn" ? "dash-warn" : ""}`}
              style={tone === "warn" ? { background: "var(--dash-warn-soft)", color: "var(--dash-warn)" } : { background: "var(--dash-chip)", color: tone === "mute" ? "var(--dash-label-2)" : "var(--dash-label)" }}
            >
              <Dot tone={tone} />
              {r.label}
              {tone === "warn" && (
                <span className="text-[11px]" style={{ color: "var(--dash-label-2)" }}>
                  {r.value}
                </span>
              )}
            </button>
          )
        })}
        {!rows.length && (
          <span className="text-[13px]" style={{ color: "var(--dash-label-2)" }}>
            {w.line}
          </span>
        )}
        <span className="ml-auto">
          <EditButton w={w} />
        </span>
      </div>
      <Ticks w={w} fill />
      {menu}
    </div>
  )
}

function Section({ group, watches, wide, collapsed, onToggle, i }: { group: Group; watches: WatchView[]; wide: boolean; collapsed: boolean; onToggle: () => void; i: number }) {
  const m = useMotion()
  const host = groupHost(watches)
  const look = watches.filter((w) => needsLook(w)).length
  const services = group === "services"
  const providers = services ? watches.reduce((n, w) => n + (w.latest?.rows?.length ?? 0), 0) : 0
  const openAt = Math.min(...watches.flatMap((w) => problemsOf(w).map((f) => f.openedAt)))
  const right = collapsed
    ? `${watches.length} ${watches.length === 1 ? "watch" : "watches"}, ${look ? `${look} ${look === 1 ? "needs" : "need"} a look` : "all healthy"}`
    : services && Number.isFinite(openAt)
      ? `Since ${since(openAt)}`
      : "Last 24 checks"
  const id = `dash-${group}`
  return (
    <section className="dash-panel dash-rise flex flex-col gap-[8px] p-[16px]" style={{ ["--i" as string]: 7 + i }} aria-labelledby={id} data-testid={`group-${group}`}>
      <h2 id={id} className="m-0 text-[13px] font-normal">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className={`flex w-full cursor-pointer items-center gap-[8px] rounded-[6px] border-0 bg-transparent px-[8px] text-left ${collapsed ? "py-0" : "pt-0 pb-[8px]"}`}
          style={{ color: "var(--dash-label)", font: "inherit" }}
        >
          <span className="font-semibold">{GROUP_LABEL[group]}</span>
          <span className="text-[11px]" style={{ color: "var(--dash-label-2)" }}>
            {services ? (
              <>
                <span className="mono">{providers}</span> {providers === 1 ? "provider" : "providers"}
              </>
            ) : (
              host
            )}
          </span>
          <span className={`ml-auto text-[11px] ${services && !collapsed && Number.isFinite(openAt) ? "mono" : ""}`} style={{ color: services && !collapsed && Number.isFinite(openAt) ? "var(--dash-warn)" : "var(--dash-label-2)" }}>
            {right}
          </span>
          <ChevronDown size={14} className={`flex-none transition-transform duration-[320ms] ${collapsed ? "-rotate-90" : ""}`} style={{ color: "var(--dash-label-2)", transitionTimingFunction: "var(--spring)" }} />
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div {...m.collapse} transition={m.t(0.32)} className="overflow-hidden">
            {services ? (
              <div className="flex flex-col gap-[16px] px-[0px] pt-[8px]">
                {watches.map((w) => (
                  <Services key={w.id} w={w} />
                ))}
              </div>
            ) : (group === "mac" || group === "web") && wide ? (
              <div className="grid grid-cols-3 gap-[8px]">
                {watches.map((w) => (
                  <MacCard key={w.id} w={w} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-[8px]">
                {watches.map((w) => (
                  <Row key={w.id} w={w} host={host} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/* The page */

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export function Dashboard({ watches, top, bottom }: { watches: WatchView[]; top?: ReactNode; bottom?: ReactNode }) {
  useMinute()
  const [ref, width] = useWidth<HTMLDivElement>()
  const wide = width >= WIDE
  const [collapsed, toggle] = useCollapsed()
  const metrics = metricsOf(watches)
  const look = watches.filter((w) => needsLook(w))
  const groups = grouped(watches)
  const by = new Map(groups.map((g) => [g.group, g.watches]))
  const section = (g: Group, i: number) => {
    const ws = by.get(g)
    return ws ? <Section key={g} group={g} watches={ws} wide={wide} collapsed={collapsed.has(`group:${g}`)} onToggle={() => toggle(`group:${g}`)} i={i} /> : null
  }
  const left = section("site", 0)
  const right = [section("domain", 1), section("services", 2)].filter(Boolean)
  return (
    <div ref={ref} className="w-full" data-testid="dashboard" data-wide={wide || undefined}>
      <div className={`mx-auto flex max-w-[1200px] flex-col gap-[32px] pt-[24px] pb-[40px] ${wide ? "px-[40px]" : "px-[24px]"}`}>
        {top}
        <section aria-label="Status" className="flex flex-col gap-[16px]">
          <StatusStrip watches={watches} wide={wide} />
          {metrics.length > 0 && (
            <div className="grid gap-[16px]" style={{ gridTemplateColumns: `repeat(${wide ? 4 : 2}, minmax(0, 1fr))` }}>
              {metrics.map((m, i) => (
                <MetricCard key={m.kind} m={m} i={i} wide={wide} />
              ))}
            </div>
          )}
        </section>
        {look.length > 0 && (
          <section aria-labelledby="dash-needs" className="flex flex-col gap-[16px]">
            <div className="flex items-center gap-[8px]">
              <h2 id="dash-needs" className="m-0 text-[17px] font-semibold tracking-[-0.006em]">
                Needs a look
              </h2>
              <Badge tone="warn" mono>
                {look.length}
              </Badge>
            </div>
            <div className={`grid items-start gap-[16px] ${wide ? "grid-cols-2" : "grid-cols-1"}`}>
              {look.map((w, i) => (
                <LookCard key={w.id} w={w} i={i} span={wide && look.length % 2 === 1 && i === look.length - 1} />
              ))}
            </div>
          </section>
        )}
        {(left || right.length > 0) &&
          (wide && left && right.length ? (
            <div className="grid grid-cols-2 items-start gap-[16px]">
              {left}
              <div className="flex flex-col gap-[16px]">{right}</div>
            </div>
          ) : (
            <>
              {left}
              {right}
            </>
          ))}
        {section("mac", 3)}
        {section("web", 4)}
        {section("other", 5)}
        {bottom}
      </div>
    </div>
  )
}

/* The title bar on Watching: the count, and Live with the last check */

export function WatchingTitleExtras({ watches }: { watches: WatchView[] }) {
  return (
    <span className="mono inline-flex h-[22px] items-center rounded-[6px] px-[8px] text-[11px]" style={{ color: "var(--dash-label-2)", background: "var(--dash-chip)" }} data-testid="watch-count">
      {watches.length}
    </span>
  )
}

export function LivePill({ watches }: { watches: WatchView[] }) {
  useMinute()
  const offline = !navigator.onLine
  const last = Math.max(0, ...watches.map((w) => w.latest?.at ?? 0))
  const on = !offline && watches.some((w) => !w.paused)
  return (
    <div className="no-drag flex h-[22px] items-center gap-[8px] rounded-[6px] px-[8px] text-[11px] tracking-[0.006em]" style={{ color: "var(--dash-label-2)", background: on ? "var(--dash-ok-wash)" : "var(--dash-chip)" }} data-testid="live-pill">
      <span className={`size-[6px] rounded-full ${on ? "dash-pulse" : ""}`} style={on ? { background: "var(--dash-ok)", boxShadow: "0 0 8px var(--dash-ok)" } : { background: "var(--dash-label-3)" }} />
      <span style={on ? { color: "var(--dash-ok)" } : undefined}>{offline ? "Offline" : on ? "Live" : "Paused"}</span>
      {last > 0 && <span className="max-[1199px]:hidden">Updated {ago(last).replace(/^Just now$/, "just now")}</span>}
    </div>
  )
}

