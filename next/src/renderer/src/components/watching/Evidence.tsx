import { useState } from "react"

import { stripWords } from "@shared/watching/copy"
import type { DiffLine } from "@shared/watching/diff"
import { money } from "@shared/watching/price"
import { EVERY_MS } from "@shared/watching/schedule"
import type { Every, Kind, StripTick } from "@shared/watching/types"
import { seconds } from "@shared/watching/uptime"

// What a watch's screen draws: the strip of quiet runs, the load-time chart on a slow card, the up
// and down bars on a down card, a page change's line diff and the price step chart. Plain SVG in the
// design's sizes; colours come from the theme.

export const clock = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()
export const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
const hourLabel = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric" }).toLowerCase()

/** A run that couldn't reach the site (a down run), as opposed to a slow one. */
const isDown = (t: StripTick) => t.status === "problem" && !(t.http ?? "").startsWith("2")

/* The strip */

const STRIP_W = 736

function tickText(t: StripTick, kind: Kind) {
  const when = `${sameDay(t.at, Date.now()) ? "" : `${day(t.at)}, `}${clock(t.at)}`
  if (t.status === "failed") return `${when}, couldn’t check`
  if (kind === "uptime") {
    if (isDown(t)) return `${when}, down${t.http ? `, ${t.http.split(" ")[0]}` : ""}`
    return `${when}, ${t.status === "problem" ? "slow" : "up"}${t.metric !== undefined ? `, ${seconds(t.metric)}` : ""}`
  }
  if (kind === "price" && t.metric !== undefined) return `${when}, ${money(t.metric, undefined, false)}${t.stock && t.stock !== "Unknown" ? `, ${t.stock.toLowerCase()}` : ""}`
  if (kind === "page") return `${when}, ${t.status === "news" ? "changed" : t.status === "problem" ? "a problem" : "no change"}`
  const what = t.status === "problem" ? "a problem" : t.status === "news" ? "a change" : "quiet"
  return `${when}, ${what}`
}

/**
 * The strip's label: "Quiet since Oct 24", "No changes since Oct 24", "$48, in stock, since Oct 1".
 * Since the first run after the last loud one before the latest. When the quiet stretch starts before
 * the strip's oldest tick, `events` (times of earlier changes and problems) say when it began.
 */
export function stripLabel(ticks: StripTick[], createdAt: number, o: { kind?: Kind; events?: number[]; currency?: string } = {}) {
  const loud = (t: StripTick) => t.status === "problem" || t.status === "news"
  let end = ticks.length
  while (end > 0 && loud(ticks[end - 1]!)) end--
  let i = end
  while (i > 0 && !loud(ticks[i - 1]!)) i--
  if (end === 0 && ticks.length && o.kind !== "page" && o.kind !== "price") return `Since ${clock(ticks[0]!.at)}`
  // A change is the start of its own quiet stretch: "No changes since 10:05 am".
  const changeKind = o.kind === "page" || o.kind === "price"
  let since = (changeKind && i > 0 ? ticks[i - 1]?.at : ticks[i]?.at) ?? createdAt
  if (i === 0) since = Math.max(createdAt, ...(o.events ?? []).filter((t) => t < (ticks[0]?.at ?? Number.POSITIVE_INFINITY)))
  const kind = o.kind ?? "uptime"
  if (kind === "price") {
    // Price carries today's value, since its last change: "$42, in stock, since 9:00 am".
    const now = [...ticks].reverse().find((t) => t.metric !== undefined && t.status !== "failed")
    const changed = [...ticks].reverse().find((t) => t.status === "news")?.at ?? Math.max(createdAt, ...(o.events ?? []))
    if (now?.metric !== undefined) return stripWords("price", changed, { price: now.metric, currency: o.currency, stock: now.stock ?? "Unknown" })
  }
  if (kind === "custom") {
    // How things stood before the latest news, since they last changed: "Full since Oct 29".
    const read = (end > 0 ? ticks.slice(0, end) : ticks).filter((t) => t.status !== "failed" && t.state)
    const now = read.at(-1)
    if (now) {
      let j = read.length - 1
      while (j > 0 && read[j - 1]!.state === now.state) j--
      return stripWords("custom", j === 0 ? Math.max(createdAt, read[0]!.at) : read[j]!.at, undefined, now.state)
    }
  }
  return stripWords(kind, since)
}

/**
 * One tick per run, at most the last 120, newest on the right: grey quiet, orange a problem, blue news,
 * an outline a run that couldn't check. Fewer than 64 runs keep the right side, so the ticks don't stretch.
 */
export function Strip({ ticks, kind, label, right }: { ticks: StripTick[]; kind: Kind; label: string; right: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = ticks.slice(-120)
  const slots = Math.min(120, Math.max(64, shown.length))
  const gap = STRIP_W / slots
  const offset = slots - shown.length
  const tip = hover !== null ? shown[hover] : undefined
  const tipLeft = hover !== null ? Math.min(Math.max(0, (offset + hover) * gap - 60), STRIP_W - 160) : 0
  return (
    <div className="relative flex flex-col gap-[6px]" data-testid="watch-strip">
      <div className="flex justify-between text-[12px] leading-[16px] text-ink-3">
        <span>{label}</span>
        <span>{right}</span>
      </div>
      <svg width="100%" height="20" viewBox={`0 0 ${STRIP_W} 20`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)} role="img" aria-label={label}>
        {hover !== null && <rect x={(offset + hover) * gap - 3} y={0} width={8.5} height={20} rx={3} fill="var(--fill-2)" />}
        {shown.map((t, i) => {
          const c = t.status === "problem" ? "var(--warn)" : t.status === "news" ? "var(--brand)" : t.status === "failed" ? "var(--ink-4)" : "var(--watch-tick)"
          const loud = t.status === "problem" || t.status === "news"
          const x = (offset + i) * gap
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: the tooltip is extra; the strip's label says what it shows
            <g key={`${t.at}-${i}`} onMouseEnter={() => setHover(i)}>
              <rect x={x - gap / 2 + 1.25} y={0} width={gap} height={20} fill="transparent" />
              {t.status === "failed" ? (
                <rect x={x + 0.5} y={4.5} width={2} height={11} rx={1} fill="none" stroke={c} />
              ) : (
                <rect x={x} y={loud ? 2 : 6} width={2.5} height={loud ? 16 : 12} rx={1.25} fill={c} />
              )}
            </g>
          )
        })}
      </svg>
      {tip && (
        <div className="pointer-events-none absolute -top-[6px] z-10 rounded-[6px] bg-pop px-[8px] py-[4px] text-[12px] leading-[16px] whitespace-nowrap text-ink shadow-[var(--elevation-overlay)]" style={{ left: `${(tipLeft / STRIP_W) * 100}%` }}>
          {tickText(tip, kind)}
        </div>
      )}
    </div>
  )
}

/* The load-time chart on a slow card */

const CW = 704
const CH = 168
const L = 34
const T = 18
const B = 26
const R = 10
const SIX_HOURS = 6 * 3_600_000

/**
 * The last 6 hours of load times, with the dashed line it tells you above, a dotted line where the
 * largest files changed, and the latest value in orange (green once fixed).
 */
export function SpeedChart({ ticks, limitMs, eventAt, eventLabel, tone = "warn" }: { ticks: StripTick[]; limitMs?: number; eventAt?: number; eventLabel?: string; tone?: "warn" | "ok" }) {
  const last = ticks.at(-1)
  const pts = ticks.filter((t) => t.metric !== undefined && last && t.at >= last.at - SIX_HOURS && t.status !== "failed" && !isDown(t))
  if (pts.length < 2 || !last) return null
  const t0 = pts[0]!.at
  const t1 = pts.at(-1)!.at
  const span = Math.max(1, t1 - t0)
  const top = Math.max(5, Math.ceil(Math.max(...pts.map((p) => p.metric! / 1000), (limitMs ?? 0) / 1000) + 0.5))
  const step = top > 10 ? 5 : top > 6 ? 2 : 1
  const ih = CH - T - B
  const x = (t: number) => L + ((t - t0) / span) * (CW - L - R)
  const y = (s: number) => T + (1 - s / top) * ih
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)} ${y(p.metric! / 1000).toFixed(1)}`).join(" ")
  const end = pts.at(-1)!
  const lc = tone === "ok" ? "var(--ok)" : "var(--warn)"
  const grid: number[] = []
  for (let g = step; g <= top; g += step) grid.push(g)
  // X labels: whole hours inside the range, then the end time; nothing within 56 px of the end.
  const hours: number[] = []
  const h = new Date(t0)
  h.setMinutes(0, 0, 0)
  for (let t = h.getTime() + 3_600_000; t < t1; t += 3_600_000) if (x(t1) - x(t) > 56) hours.push(t)
  const labels: [number, string, "start" | "middle" | "end"][] = hours.length ? hours.map((t) => [x(t), hourLabel(t), "middle"]) : [[L, clock(t0), "start"]]
  if (hours.length && x(hours[0]!) - L < 20) labels[0] = [L, hourLabel(hours[0]!), "start"]
  labels.push([CW - R, clock(t1), "end"])
  const ex = eventAt !== undefined && eventAt >= t0 ? x(eventAt) : null
  return (
    <svg width="100%" viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label="Load time" className="block">
      {grid.map((g) => (
        <g key={g}>
          <line x1={L} x2={CW - R} y1={y(g)} y2={y(g)} stroke="var(--chart-grid)" />
          <text x={L - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
            {g} s
          </text>
        </g>
      ))}
      <path d={`${d} L${x(end.at)} ${y(0)} L${x(t0)} ${y(0)} Z`} fill="var(--fill)" />
      {limitMs !== undefined && limitMs / 1000 <= top && (
        <>
          <line x1={L} x2={CW - R} y1={y(limitMs / 1000)} y2={y(limitMs / 1000)} stroke="var(--warn)" strokeDasharray="4 4" opacity=".75" />
          <text x={L + 6} y={y(limitMs / 1000) - 6} fontSize="11" fill="var(--warn)">
            Tells you above {seconds(limitMs)}
          </text>
        </>
      )}
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
      {ex !== null && (
        <>
          <line x1={ex} x2={ex} y1={T} y2={y(0)} stroke="var(--ink-3)" strokeDasharray="2 3" />
          {eventLabel && (
            <text x={ex - L > 130 ? ex - 6 : ex + 6} y={T + 10} textAnchor={ex - L > 130 ? "end" : "start"} fontSize="11" fill="var(--ink-2)">
              {eventLabel}
            </text>
          )}
        </>
      )}
      <circle cx={x(end.at)} cy={y(end.metric! / 1000)} r="3.5" fill={lc} />
      <text x={x(end.at) - 8} y={y(end.metric! / 1000) - 9} textAnchor="end" fontSize="12" fill={lc}>
        {seconds(end.metric!)}
      </text>
      {labels.map(([lx, t, a]) => (
        <text key={`${lx}-${t}`} x={lx} y={CH - 6} textAnchor={a} fontSize="11" fill="var(--ink-3)">
          {t}
        </text>
      ))}
    </svg>
  )
}

/* Up and down bars on a down card */

const EIGHT_HOURS = 8 * 3_600_000

/** The last 8 hours, one bar per run slot; the down ones taller and orange. Slots with no run stay empty. */
export function UpStrip({ ticks, every, now }: { ticks: StripTick[]; every: Every; now: number }) {
  const slot = every === "morning" ? 86_400_000 : EVERY_MS[every]
  const n = Math.min(96, Math.max(8, Math.round(EIGHT_HOURS / slot)))
  const t0 = now - n * slot
  const g = CW / n
  const bars = new Map<number, StripTick>()
  for (const t of ticks) {
    if (t.at < t0) continue
    const i = Math.min(n - 1, Math.floor((t.at - t0) / slot))
    const was = bars.get(i)
    if (!was || isDown(t)) bars.set(i, t)
  }
  const labelAt = [t0, t0 + (n * slot) / 2, now]
  return (
    <svg width="100%" viewBox={`0 0 ${CW} 38`} role="img" aria-label="Last 8 hours" className="block">
      {[...bars].map(([i, t]) => {
        const down = isDown(t)
        return <rect key={i} x={i * g} y={down ? 0 : 4} width={Math.max(1, g - 2)} height={down ? 18 : 14} rx={1.5} fill={down ? "var(--warn)" : t.status === "failed" ? "var(--ink-4)" : "var(--watch-tick)"} />
      })}
      {labelAt.map((t, i) => (
        <text key={t} x={[0, CW / 2, CW][i]} y={34} textAnchor={(["start", "middle", "end"] as const)[i]} fontSize="11" fill="var(--ink-3)">
          {hourLabel(t)}
        </text>
      ))}
    </svg>
  )
}

/** "14 min", "2 h 5 min". */
export function span(ms: number) {
  const m = Math.max(1, Math.round(ms / 60_000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/* A page change's line diff */

const DIFF_SHOWN = 12

/** Removed lines in red, added in green, context in grey. Long diffs show 12 lines and "N more lines". */
export function Diff({ lines }: { lines: DiffLine[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? lines : lines.slice(0, DIFF_SHOWN)
  const more = lines.length - shown.length
  return (
    <div className="selectable overflow-hidden rounded-[6px] bg-fill font-mono text-[12.5px] leading-[19px]" data-testid="page-diff">
      {shown.map((l, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lines repeat; their order is the identity
          key={i}
          className={`px-[12px] py-[3px] break-words whitespace-pre-wrap ${l.t === "a" ? "bg-[var(--watch-add-bg)] text-[var(--watch-add-ink)]" : l.t === "d" ? "bg-[var(--watch-del-bg)] text-[var(--watch-del-ink)]" : "text-ink-3"}`}
        >
          {l.t === "a" ? "+ " : l.t === "d" ? "− " : "  "}
          {l.s}
        </div>
      ))}
      {more > 0 && (
        <button type="button" onClick={() => setAll(true)} className="block w-full cursor-pointer border-0 bg-transparent px-[12px] py-[3px] text-left font-mono text-[12.5px] leading-[19px] text-brand-text hover:underline">
          {more} more {more === 1 ? "line" : "lines"}
        </button>
      )}
    </div>
  )
}

/* The price step chart */

const PW = 704
const PH = 130
const PL = 40
const PT = 14
const PB = 24
const PR = 12
const MONTH = 30 * 86_400_000

/** A grid step that gives three or four lines: 1, 2, 2.5, 4, 5, 10, 20… */
function niceStep(range: number) {
  const raw = range / 1.5
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 0.01)))
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (m * mag >= raw) return m * mag
  return 10 * mag
}

/**
 * The last 30 days of the price as steps. Today's price gets a brand-blue dot and its value; each
 * earlier change gets a small label. Four dates along the bottom, the last one "Today".
 */
export function PriceChart({ points, currency, now }: { points: [number, number][]; currency?: string; now: number }) {
  if (!points.length) return null
  const t0 = Math.max(points[0]![0], now - MONTH)
  const span = Math.max(1, now - t0)
  const prices = points.map((p) => p[1])
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const step = niceStep(Math.max(hi - lo, hi * 0.1, 1))
  const first = Math.floor(lo / step) * step
  const top = Math.floor(hi / step) * step + step
  const grid: number[] = []
  for (let g = first; g <= top + 1e-9; g += step) grid.push(+g.toFixed(2))
  const yMin = first - step / 2
  const yMax = top
  const ih = PH - PT - PB
  const x = (t: number) => PL + ((Math.max(t, t0) - t0) / span) * (PW - PL - PR)
  const y = (p: number) => PT + (1 - (p - yMin) / (yMax - yMin)) * ih
  let d = `M${x(points[0]![0]).toFixed(1)} ${y(points[0]![1]).toFixed(1)}`
  for (let i = 1; i < points.length; i++) d += ` L${x(points[i]![0]).toFixed(1)} ${y(points[i - 1]![1]).toFixed(1)} L${x(points[i]![0]).toFixed(1)} ${y(points[i]![1]).toFixed(1)}`
  d += ` L${x(now).toFixed(1)} ${y(points.at(-1)![1]).toFixed(1)}`
  const last = points.at(-1)!
  const fmt = (p: number) => money(p, currency, false)
  const label = (g: number) => (Number.isInteger(g) ? fmt(g) : money(g, currency))
  // Labels on earlier changes only: today's price has the dot and its own label.
  const changes = points.slice(1).filter((p, i) => p[1] !== points[i]![1] && p !== last)
  if (changes.at(-1)?.[1] === last[1]) changes.pop()
  const dates = [0, 1, 2, 3].map((i) => t0 + (i / 3) * span)
  // A watch younger than a day and a half reads in times, not dates.
  const short = span < 36 * 3_600_000
  return (
    <svg width="100%" viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label="Price over 30 days" className="block">
      {grid.map((g) => (
        <g key={g}>
          <line x1={PL} x2={PW - PR} y1={y(g)} y2={y(g)} stroke="var(--chart-grid)" />
          <text x={PL - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
            {label(g)}
          </text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      {changes.map(([t, p]) => (
        <text key={t} x={x(t) + 6} y={y(p) - 6} fontSize="11" fill="var(--ink-3)">
          {fmt(p)}
        </text>
      ))}
      <circle cx={x(now)} cy={y(last[1])} r="3.5" fill="var(--brand)" />
      <text x={x(now) - 8} y={y(last[1]) - 9} textAnchor="end" fontSize="12" fill="var(--brand-text)">
        {fmt(last[1])}
      </text>
      {dates.map((t, i) => {
        const text = i === 3 ? (short ? "Now" : "Today") : short ? clock(t) : day(t)
        // Within a few minutes the middle times repeat the first; show each once.
        if (i > 0 && i < 3 && text === (short ? clock(dates[i - 1]!) : day(dates[i - 1]!))) return null
        return (
          <text key={t} x={PL + (i / 3) * (PW - PL - PR)} y={PH - 6} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize="11" fill="var(--ink-3)">
            {text}
          </text>
        )
      })}
    </svg>
  )
}
