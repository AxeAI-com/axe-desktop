
import type { WatchView } from "@shared/watching/types"

import { factOf, lineOf, problemsOf, type Tone } from "@/lib/dashboard"

import { ArrowDownIcon } from "@/components/SolarIcons"
import { failing, unreadable } from "@/components/watching/live/actions"
import { late, loop } from "@/components/watching/live/loops"

// The motion inside a tile that fits what it watches (spec 0002, board M-WatchBLive). Everything drawn comes from
// the watch's own runs, facts and rows; a kind without them draws nothing here. Elements are spans: the tile is a
// button.

export const TONE_COLOR: Record<Tone, string> = { ok: "var(--dash-ok)", warn: "var(--dash-warn)", bad: "var(--dash-bad)", run: "var(--dash-blue)", paused: "var(--dash-label-3)" }

/** A loop from live.css, started `delay` s after the others (as a point part way through its cycle). */
const anim = (spec: string, delay?: number) => loop(spec, delay ? late(delay, Number.parseFloat(spec.split(" ")[1]!)) : undefined)
const label = "block truncate text-[12px] text-ink-3"

/** The response times, oldest first: health's answer time, else the load time uptime and page speed keep. */
export function seriesOf(w: WatchView): number[] {
  const ok = w.strip.filter((t) => t.status !== "failed")
  const v = w.kind === "health" ? ok.map((t) => t.ms) : ok.map((t) => t.metric)
  return v.filter((n): n is number => typeof n === "number").slice(-24)
}

/** The series drawn twice, scrolling left without a seam, and a dot blinking at the end. */
function Spark({ values, color }: { values: number[]; color: string }) {
  const lo0 = Math.min(...values)
  const hi0 = Math.max(...values)
  const pad = (hi0 - lo0) * 0.1 || 1
  const lo = lo0 - pad
  const hi = hi0 + pad
  const n = values.length
  const seq = [...values, ...values, values[0]!]
  const d = seq.map((v, i) => `${i ? "L" : "M"}${((i * 220) / n).toFixed(1)} ${(36 - ((v - lo) / (hi - lo)) * 30).toFixed(1)}`).join(" ")
  return (
    <span className="lv relative block h-[40px] overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 440 40" preserveAspectRatio="none" className="absolute top-0 left-0 h-[40px] w-[200%]" {...anim("lv-scroll 4s linear")}>
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute top-1/2 right-0 mt-[-4px] size-[8px] rounded-full" style={{ background: color }} {...anim("lv-blink .6s ease-in-out")} />
    </span>
  )
}

/** A check in progress: an indeterminate bar. */
export function Slider({ color }: { color: string }) {
  return (
    <span className="lv relative block h-[6px] overflow-hidden rounded-full bg-input" aria-hidden="true">
      <span className="absolute top-0 bottom-0 left-0 w-[30%] rounded-full" style={{ background: color }} {...anim("lv-slide 1.1s cubic-bezier(.23,1,.32,1)")} />
    </span>
  )
}

/** One light per service: the healthy ones ripple in turn, a problem blinks, an unreadable one is dim. */
function Lights({ w }: { w: WatchView }) {
  const rows = w.latest?.rows ?? []
  return (
    <span className="lv grid gap-[8px]" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
      {rows.map((r, i) => {
        const bad = !r.ok && !unreadable(r)
        const background = r.ok ? "var(--dash-ok)" : bad ? "var(--dash-warn)" : "var(--lv-tick)"
        const motion = r.ok ? anim("lv-wave 1.8s linear", i * 0.3) : bad ? anim("lv-blink .5s ease-in-out") : {}
        return (
          <span key={r.label} className="flex min-w-0 flex-col items-center gap-[6px]" title={`${r.label}: ${r.value}`}>
            <span className="block h-[6px] w-full rounded-full" style={{ background }} {...motion} />
            <span className="block max-w-full truncate text-[12px]" style={{ color: bad ? "var(--dash-warn)" : "var(--label-foreground)" }}>
              {r.label}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** The packages behind as pills with their full versions, "cn 0.3.3 to 0.5.1". */
function Packages({ w }: { w: WatchView }) {
  const rows = failing(w)
  const shown = rows.slice(0, 4)
  return (
    <span className="flex flex-col gap-[8px]">
      <span className="grid grid-cols-2 gap-[8px]">
        {shown.map((r, i) => {
          const [from, to] = r.value.split(" to ")
          return (
            <span key={r.label} className="flex h-[28px] min-w-0 items-center gap-[8px] rounded-[7px] bg-input px-[10px] text-[13px]">
              <span className="lv size-[6px] flex-none rounded-full" style={{ background: "var(--dash-warn)" }} {...anim("lv-blink 1.2s ease-in-out", i * 0.3)} />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {from && to && (
                <span className="tnum flex-none" style={{ color: "var(--dash-warn)" }}>
                  {from} to {to}
                </span>
              )}
            </span>
          )
        })}
      </span>
      {rows.length > shown.length && <span className={label}>+{rows.length - shown.length} more</span>}
    </span>
  )
}

/** DNS: a small radar with a turning hand, and whether the records match. */
function Scope({ w }: { w: WatchView }) {
  const p = problemsOf(w)[0]
  return (
    <span className="flex items-center gap-[12px]">
      <span className="lv relative block size-[40px] flex-none" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border border-hairline" />
        <span className="absolute inset-[10px] rounded-full border border-hairline" />
        <span className="absolute inset-0" {...anim("lv-spin 2s linear")}>
          <span className="absolute top-[19.5px] left-[20px] h-[1px] w-[20px]" style={{ background: "var(--dash-ok)" }} />
        </span>
        <span className="absolute top-[10px] left-[26px] size-[4px] rounded-full" style={{ background: "var(--dash-ok)" }} {...anim("lv-blink 2s ease-in-out")} />
      </span>
      <span className={label}>{p ? (p.line ?? p.headline) : "Records match"}</span>
    </span>
  )
}

/** SEO: one dot per page of the sitemap, lighting up in a wave. */
function Pages({ n }: { n: number }) {
  const shown = Math.min(n, 60)
  return (
    <span className="lv flex flex-wrap items-center gap-[4px]" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="block size-[6px] rounded-full" style={{ background: "var(--dash-ok)" }} {...anim("lv-wave 2.9s linear", i * 0.1)} />
      ))}
      {n > shown && <span className="ml-[4px] text-[12px] text-ink-3">+{n - shown}</span>}
    </span>
  )
}

const gb = (s?: string) => (s ? Number(s.replace(/[^\d.]/g, "")) : Number.NaN)

/** Disk: the used part of the disk. */
function Used({ pct, color }: { pct: number; color: string }) {
  return (
    <span className="lv relative block h-[8px] overflow-hidden rounded-full bg-input" aria-hidden="true">
      <span className="absolute top-0 bottom-0 left-0 rounded-full" style={{ width: `${pct}%`, background: color }} />
    </span>
  )
}

/** The kind's motion for a tile, or null when its kind has none (or the watch has nothing to draw it from). */
export function TileViz({ w, tone }: { w: WatchView; tone: Tone }) {
  const color = TONE_COLOR[tone]
  if (w.checking) return <Slider color="var(--dash-blue)" />
  if (!w.latest || w.paused) return null
  const rows = w.latest.rows ?? []
  switch (w.kind) {
    case "health":
    case "uptime":
    case "pagespeed": {
      const v = seriesOf(w)
      return v.length > 1 ? <Spark values={v} color={color} /> : null
    }
    case "status":
      return rows.length ? <Lights w={w} /> : null
    case "outdated":
      return failing(w).length ? <Packages w={w} /> : null
    case "dns":
      return <Scope w={w} />
    case "seo": {
      const n = Number.parseInt(rows.find((r) => r.label === "sitemap.xml")?.value ?? "", 10)
      return n > 0 ? <Pages n={n} /> : null
    }
    case "disk": {
      const free = gb(factOf(w, "Free"))
      const of = gb(factOf(w, "Of"))
      return of > 0 && free >= 0 ? <Used pct={Math.round(((of - free) / of) * 100)} color={color} /> : null
    }
    case "expiry": {
      const domain = factOf(w, "Domain")
      return domain ? <span className={label}>Domain until {domain}</span> : null
    }
    case "feed": {
      const file = rows[0]
      return file ? (
        <span className="flex min-w-0 items-center gap-[8px] text-[12px] text-ink-3">
          <span className="lv inline-flex flex-none" style={{ color: "var(--dash-ok)" }} {...anim("lv-bob 1.4s ease-in-out")}>
            <ArrowDownIcon size={16} />
          </span>
          <span className="tnum min-w-0 truncate">
            {file.value}, {file.label}
          </span>
        </span>
      ) : null
    }
    case "tests": {
      const took = factOf(w, "Took")
      return took ? <span className={label}>Took {took}</span> : null
    }
    case "page":
    case "price":
    case "custom":
      // What changed, in the watch's own words: "New line: “Free shipping on orders over $50.”"
      return <span className={label}>{lineOf(w).replace(/\.$/, "")}</span>
    default:
      return null
  }
}
