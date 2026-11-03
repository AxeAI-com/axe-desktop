import { motion } from "motion/react"
import { useId, useMemo, useState } from "react"

import type { RichChart } from "@shared/rich"
import { isEmpty } from "@shared/rich"

import { D, useCountUp, useMotion } from "@/lib/motion"

import { CardFrame, EmptyNote, formatValue, niceStep, seriesColor, useWidth } from "./shared"

const H = 186 // plot height
const PAD_TOP = 8
const SVG_H = 220 // plot, the day labels under it and a little air
const AXIS_W = 44 // room for the value labels on the left
const PAD_RIGHT = 10

/** A chart card: bar, line, area or donut. Draws itself in; hover reads a value in the header. */
export function ChartCard({ chart }: { chart: RichChart }) {
  if (isEmpty(chart))
    return (
      <CardFrame label={chart.title ?? "Chart"}>
        <EmptyNote title={chart.title} text="There's nothing to chart yet." />
      </CardFrame>
    )
  return chart.type === "donut" ? <Donut chart={chart} /> : <XYChart chart={chart} />
}

// ---------- Header: the big number ----------

function BigNumber({ value, prefix, suffix }: { value: number; prefix: string; suffix: string }) {
  const text = useCountUp(value, (n) => formatValue(n, prefix, suffix))
  return <motion.span className="text-[30px] leading-[38px] tracking-[-0.02em] tabular-nums">{text}</motion.span>
}

/** "Daily sales" is compared with the day before, "Weekly sign-ups" with the week before. */
const unitOf = (title?: string) => (/daily/i.test(title ?? "") ? "day" : /weekly/i.test(title ?? "") ? "week" : /monthly/i.test(title ?? "") ? "month" : "one")

function Change({ now, before, unit }: { now: number; before: number | undefined; unit: string }) {
  if (before === undefined || before === 0) return null
  const pct = ((now - before) / Math.abs(before)) * 100
  const up = pct >= 0
  return (
    <span className="text-[13px] whitespace-nowrap tabular-nums" style={{ color: up ? "var(--live)" : "var(--bad)" }}>
      {up ? "+" : "−"}
      {Math.abs(pct).toFixed(1)}% on the {unit} before
    </span>
  )
}

function Legend({ chart, at }: { chart: RichChart; at: number }) {
  if (chart.series.length < 2) return null
  return (
    <div className="flex flex-wrap justify-end gap-x-[16px] gap-y-[4px] text-[12px]">
      {chart.series.map((s, i) => (
        <span key={i} className="flex items-center gap-[6px] text-ink-2">
          <i className="h-2 w-2 rounded-full" style={{ background: seriesColor(i) }} />
          {s.name || `Series ${i + 1}`}
          <span className="text-ink-3 tabular-nums">{formatValue(s.values[at] ?? 0, chart.prefix, chart.suffix, true)}</span>
        </span>
      ))}
    </div>
  )
}

// ---------- Bar, line, area ----------

function XYChart({ chart }: { chart: RichChart }) {
  const m = useMotion()
  const gid = useId().replace(/:/g, "")
  const [box, width] = useWidth<HTMLDivElement>()
  const n = chart.labels.length
  const all = chart.series.flatMap((s) => s.values)
  const isBar = chart.type === "bar"
  // The number up top follows the last series: with "Q2" and "Q3", that's the newer one.
  const first = chart.series[chart.series.length - 1]!

  // Bars point at their tallest by default; lines at their last point.
  const top = first.values.indexOf(Math.max(...first.values))
  const rest = isBar ? Math.max(0, top) : n - 1
  const [hover, setHover] = useState<number | null>(null)
  const at = hover ?? rest

  const scale = useMemo(() => {
    let lo = Math.min(...all)
    let hi = Math.max(...all)
    if (chart.type !== "line") lo = Math.min(0, lo)
    if (chart.type === "line") {
      const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1
      lo = lo >= 0 && lo - pad < 0 ? 0 : lo - pad
      hi += pad
    }
    if (hi === lo) hi = lo + 1
    const step = niceStep(hi - lo)
    const min = Math.floor(lo / step) * step
    const max = Math.ceil(hi / step) * step
    const ticks: number[] = []
    for (let v = min; v <= max + step / 2; v += step) ticks.push(v)
    return { min, max, ticks }
  }, [all, chart.type])

  const plotW = Math.max(120, width - AXIS_W - PAD_RIGHT)
  const band = plotW / n
  const x = (i: number) => AXIS_W + (isBar ? band * (i + 0.5) : n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD_TOP + H - ((v - scale.min) / (scale.max - scale.min)) * H
  const base = y(Math.max(scale.min, Math.min(0, scale.max)))

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left
    let best = 0
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    setHover(best)
  }

  const label = hover !== null || isBar || n > 1 ? chart.labels[at] : undefined
  const xTicks = pickTicks(n, Math.max(2, Math.floor(plotW / 130)))

  return (
    <CardFrame label={chart.title ?? "Chart"} className="overflow-hidden">
      <div className="flex h-[44px] items-center justify-between px-[18px] text-[13px] text-ink-3">
        <span className="truncate">{chart.title}</span>
        <span className="whitespace-nowrap">{label}</span>
      </div>
      <div className="flex items-baseline gap-[12px] px-[18px] pt-[2px]">
        <BigNumber value={first.values[at] ?? 0} prefix={chart.prefix} suffix={chart.suffix} />
        {chart.series.length === 1 && !isBar && <Change now={first.values[at] ?? 0} before={at > 0 ? first.values[at - 1] : undefined} unit={unitOf(chart.title)} />}
        <span className="flex-1" />
        <Legend chart={chart} at={at} />
      </div>
      <div className="mt-[16px] px-[18px] pb-[16px]">
      <div ref={box} className="relative">
        <svg
          width={width}
          height={SVG_H}
          role="img"
          aria-label={`${chart.title ?? "Chart"}: ${chart.labels.length} points`}
          className="block overflow-visible"
          onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            {chart.series.map((_, i) => (
              <linearGradient key={i} id={`${gid}-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={seriesColor(i)} stopOpacity={chart.type === "area" ? 0.34 : 0.18} />
                <stop offset="1" stopColor={seriesColor(i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {scale.ticks.map((t, i) => (
            <g key={t}>
              <motion.line
                x1={AXIS_W}
                x2={AXIS_W + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--chart-grid)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...m.t(D.base), delay: m.stagger(i, 0.03) }}
              />
              <text x={AXIS_W - 10} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
                {formatValue(t, chart.prefix, chart.suffix, true)}
              </text>
            </g>
          ))}

          {isBar ? (
            <Bars chart={chart} x={x} y={y} base={base} band={band} hover={hover} />
          ) : (
            chart.series.map((s, si) => <Line key={si} values={s.values} si={si} x={x} y={y} base={base} area={chart.type === "area"} straight={chart.type === "line"} fill={`url(#${gid}-fill-${si})`} />)
          )}

          {/* The reading line follows the pointer and snaps to the nearest point; at rest it stands on the latest. */}
          {!isBar && (
            <motion.line
              key="cross"
              y1={PAD_TOP}
              y2={PAD_TOP + H}
              stroke="rgb(255 255 255 / 0.14)"
              initial={{ opacity: 0, x1: x(at), x2: x(at) }}
              animate={{ opacity: 1, x1: x(at), x2: x(at) }}
              transition={m.t(D.fast)}
            />
          )}
          {!isBar &&
            chart.series.map((s, si) => (
              <motion.g
                key={si}
                initial={{ opacity: 0, x: x(at), y: y(s.values[at] ?? 0) }}
                animate={{ opacity: 1, x: x(at), y: y(s.values[at] ?? 0) }}
                transition={{ ...m.t(D.fast), opacity: { ...m.t(D.base), delay: m.reduced ? 0 : 0.3 } }}
                style={{ pointerEvents: "none" }}
              >
                <circle r={4.5} fill="var(--card)" stroke={seriesColor(si)} strokeWidth={2} />
              </motion.g>
            ))}
          {xTicks.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={SVG_H - 6}
              fontSize={11}
              fill="var(--ink-3)"
              textAnchor={i === 0 && !isBar ? "start" : i === n - 1 && !isBar ? "end" : "middle"}
            >
              {chart.labels[i]}
            </text>
          ))}
        </svg>
      </div>
      </div>
    </CardFrame>
  )
}

/** Which x labels to print: all when they fit, else evenly spaced with the first and last. */
export function pickTicks(n: number, room: number): number[] {
  if (n <= room) return Array.from({ length: n }, (_, i) => i)
  const step = Math.ceil((n - 1) / (room - 1))
  const out: number[] = []
  for (let i = 0; i < n; i += step) out.push(i)
  // The last label, unless it would sit on top of the one before.
  if (out[out.length - 1] !== n - 1) {
    if (n - 1 - out[out.length - 1]! <= step / 2) out.pop()
    out.push(n - 1)
  }
  return out
}

/** A smooth path through points that never overshoots between them. */
export function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return ""
  let d = `M${pts[0]![0]} ${pts[0]![1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!
    const [x1, y1] = pts[i]!
    const cx = (x0 + x1) / 2
    d += ` C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`
  }
  return d
}

function Line({
  values,
  si,
  x,
  y,
  base,
  area,
  straight,
  fill,
}: {
  values: number[]
  si: number
  x: (i: number) => number
  y: (v: number) => number
  base: number
  area: boolean
  straight?: boolean
  fill: string
}) {
  const m = useMotion()
  const pts = values.map((v, i) => [x(i), y(v)] as [number, number])
  const line = straight ? pts.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ") : smoothPath(pts)
  const shape = `${line} L${pts[pts.length - 1]![0]} ${base} L${pts[0]![0]} ${base} Z`
  const delay = m.stagger(si, 0.12)
  return (
    <g>
      {area && (
        <motion.path
          d={shape}
          fill={fill}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...m.t(D.slow), delay: delay + (m.reduced ? 0 : 0.22) }}
        />
      )}
      <motion.path d={line} fill="none" stroke={seriesColor(si)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...m.draw(delay)} />
      {values.length === 1 && <circle cx={pts[0]![0]} cy={pts[0]![1]} r={4} fill={seriesColor(si)} />}
    </g>
  )
}

function Bars({
  chart,
  x,
  y,
  base,
  band,
  hover,
}: {
  chart: RichChart
  x: (i: number) => number
  y: (v: number) => number
  base: number
  band: number
  hover: number | null
}) {
  const m = useMotion()
  const k = chart.series.length
  const groupW = Math.min(band * 0.64, 44 * k)
  const barW = Math.max(2, groupW / k - (k > 1 ? 3 : 0))
  return (
    <g>
      {chart.labels.map((_, i) => (
        <motion.g key={i} animate={{ opacity: hover === null || hover === i ? 1 : 0.42 }} transition={m.t(D.fast)}>
          {chart.series.map((s, si) => {
            const v = s.values[i] ?? 0
            const top = Math.min(y(v), base)
            const h = Math.max(1.5, Math.abs(base - y(v)))
            const left = x(i) - groupW / 2 + si * (groupW / k) + (k > 1 ? 1.5 : 0)
            const r = Math.min(5, barW / 2, h)
            const up = v >= 0
            // Rounded on the end away from the base.
            const d = up
              ? `M${left} ${top + h} V${top + r} Q${left} ${top} ${left + r} ${top} H${left + barW - r} Q${left + barW} ${top} ${left + barW} ${top + r} V${top + h} Z`
              : `M${left} ${top} V${top + h - r} Q${left} ${top + h} ${left + r} ${top + h} H${left + barW - r} Q${left + barW} ${top + h} ${left + barW} ${top + h - r} V${top} Z`
            return (
              <motion.path
                key={si}
                d={d}
                fill={seriesColor(si)}
                style={{ originY: up ? 1 : 0 }}
                {...m.grow(m.stagger(i * k + si, 0.035))}
              />
            )
          })}
        </motion.g>
      ))}
    </g>
  )
}

// ---------- Donut ----------

const R = 78
const THICK = 20

function arc(a0: number, a1: number, r = R) {
  const p = (a: number) => [Math.cos(a - Math.PI / 2) * r, Math.sin(a - Math.PI / 2) * r]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
}

function Donut({ chart }: { chart: RichChart }) {
  const m = useMotion()
  const s = chart.series[0]!
  const values = s.values.map((v) => Math.max(0, v))
  const total = values.reduce((a, b) => a + b, 0)
  const [hover, setHover] = useState<number | null>(null)
  const gap = values.filter((v) => v > 0).length > 1 ? 0.035 : 0
  let a = 0
  const segs = values.map((v, i) => {
    const sweep = total ? (v / total) * Math.PI * 2 : 0
    const seg = { i, a0: a + gap / 2, a1: a + sweep - gap / 2, v }
    a += sweep
    return seg
  })
  // Shares that are already percents have no useful total: the biggest part leads instead.
  const isShare = chart.suffix === "%"
  const biggest = values.indexOf(Math.max(...values))
  const shown = hover ?? (isShare ? biggest : null)
  const centerValue = shown === null ? total : values[shown]!
  const centerLabel = shown === null ? "Total" : chart.labels[shown]
  const text = useCountUp(centerValue, (n) => formatValue(n, chart.prefix, chart.suffix, true))

  return (
    <CardFrame label={chart.title ?? "Chart"} className="flex flex-col gap-3 px-[18px] pt-[16px] pb-[16px]">
      {chart.title && <span className="text-[12px] text-ink-2">{chart.title}</span>}
      <div className="flex items-center gap-8">
        <svg width={2 * (R + THICK)} height={2 * (R + THICK)} viewBox={`${-R - THICK} ${-R - THICK} ${2 * (R + THICK)} ${2 * (R + THICK)}`} role="img" aria-label={`${chart.title ?? "Share"}: ${chart.labels.length} parts`} className="shrink-0 overflow-visible">
          <circle r={R} fill="none" stroke="var(--fill-2)" strokeWidth={THICK} />
          {segs.map((g) =>
            g.a1 > g.a0 ? (
              <motion.path
                key={g.i}
                d={arc(g.a0, g.a1)}
                fill="none"
                stroke={seriesColor(g.i)}
                strokeLinecap="butt"
                initial={m.draw().initial}
                animate={{ pathLength: 1, opacity: hover === null || hover === g.i ? 1 : 0.38, strokeWidth: hover === g.i ? THICK + 6 : THICK }}
                transition={{ ...m.t(D.fast), pathLength: { ...m.t(D.slow), delay: m.stagger(g.i, 0.07) } }}
                style={{ strokeWidth: THICK }}
                onMouseEnter={() => setHover(g.i)}
                onMouseLeave={() => setHover(null)}
              />
            ) : null,
          )}
          <foreignObject x={-R + THICK / 2} y={-28} width={2 * R - THICK} height={56}>
            <div className="flex h-full flex-col items-center justify-center">
              <motion.span className="text-[20px] leading-[28px] font-light tracking-[-0.02em] text-ink tabular-nums">{text}</motion.span>
              <span className="max-w-full truncate text-[12px] text-ink-3">{centerLabel}</span>
            </div>
          </foreignObject>
        </svg>
        <ol className="m-0 flex min-w-0 flex-1 list-none flex-col p-0">
          {segs.map((g, i) => (
            <motion.li
              key={g.i}
              initial={{ opacity: 0, x: m.reduced ? 0 : 6 }}
              animate={{ opacity: hover === null || hover === g.i ? 1 : 0.5, x: 0 }}
              transition={{ ...m.t(D.base), delay: hover === null ? m.stagger(i, 0.05) : 0 }}
              onMouseEnter={() => setHover(g.i)}
              onMouseLeave={() => setHover(null)}
              className="flex items-center gap-3 rounded-[6px] px-2 py-[7px] text-[13px] hover:bg-fill"
            >
              <i className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: seriesColor(g.i) }} />
              <span className="min-w-0 flex-1 truncate">{chart.labels[g.i]}</span>
              <span className="text-ink-2 tabular-nums">{formatValue(g.v, chart.prefix, chart.suffix, true)}</span>
              {!isShare && <span className="w-12 text-right text-ink-3 tabular-nums">{total ? Math.round((g.v / total) * 100) : 0}%</span>}
            </motion.li>
          ))}
        </ol>
      </div>
    </CardFrame>
  )
}
