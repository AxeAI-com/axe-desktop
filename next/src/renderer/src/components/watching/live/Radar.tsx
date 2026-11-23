import type { CSSProperties } from "react"

import type { WatchView } from "@shared/watching/types"

import { healthOf, type LabelSide, radarPlace, ringLegend, toneOf } from "@/lib/dashboard"
import { radarValue, shortName, STATUS_WORD } from "@/lib/live-copy"

import { useWidth } from "@/components/watching/live/hooks"
import { LiveDot } from "@/components/watching/live/LiveTile"
import { late, loop } from "@/components/watching/live/loops"
import { TONE_COLOR } from "@/components/watching/live/TileViz"

// Every watch on one radar (spec 0002, boards M-WatchOrbit and M-WatchCombo): three rings by group, a hand that
// turns once every 6 s, and each dot pinging as the hand passes it. 470 px square, scaled down to fit its card.

const SIZE = 470
const MID = SIZE / 2
const RADII = [92, 150, 208] as const
const PERIOD = 6
const WEDGE = 34
/** Radar labels are cut to this width with an ellipsis. */
const LABEL_MAX = 140
/** Where a label sits round its dot (the dot is the origin). */
const LABEL_AT: Record<LabelSide, string> = {
  right: "top-[-18px] left-[18px] text-left",
  left: "top-[-18px] right-[18px] text-right",
  above: "bottom-[12px] left-0 -translate-x-1/2 text-center",
  below: "top-[12px] left-0 -translate-x-1/2 text-center",
}

const rad = (a: number) => (a * Math.PI) / 180
const pt = (r: number, a: number) => [MID + r * Math.sin(rad(a)), MID - r * Math.cos(rad(a))] as const

function Drawing({ rings }: { rings: Set<number> }) {
  const outer = RADII[2]
  const [wx, wy] = pt(outer, -WEDGE)
  return (
    <>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Radar of every check" className="absolute inset-0">
        {RADII.map((r, i) => rings.has(i) && <circle key={r} cx={MID} cy={MID} r={r} fill="none" stroke="var(--hairline)" strokeWidth="1" />)}
        {Array.from({ length: 60 }, (_, i) => {
          const a = i * 6
          const major = a % 30 === 0
          const [x1, y1] = pt(outer + 8, a)
          const [x2, y2] = pt(outer + (major ? 16 : 12), a)
          return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke={major ? "var(--lv-tick)" : "var(--lv-tick-2)"} strokeWidth="1" />
        })}
      </svg>
    </>
  )
}

export function Radar({ watches, style, lit, onPick }: { watches: WatchView[]; style: CSSProperties; lit?: string; onPick: (id: string) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const scale = width ? Math.min(1, width / SIZE) : 1
  const h = healthOf(watches)
  const look = h.warnings + h.down
  // A crowded radar (more than 12 watches) names each dot and keeps the value for the ones that need a look.
  const crowded = watches.length > 12
  const info = watches.map((w) => {
    const tone = toneOf(w)
    return { w, tone, name: shortName(w), value: radarValue(w), short: crowded && tone !== "warn" && tone !== "bad" }
  })
  const nodes = radarPlace(
    info.map((x) => ({ id: x.w.id, kind: x.w.kind, label: Math.min(LABEL_MAX, Math.max(x.name.length * 6.6, x.short ? 0 : x.value.length * 6)), tall: x.short ? 18 : 36 })),
    SIZE,
    RADII,
  )
  const by = new Map(info.map((x) => [x.w.id, x]))
  const legend = ringLegend(watches)
  return (
    <section aria-label="Every check, live" className="flex min-w-0 flex-col items-center gap-[8px] rounded-3xl bg-card p-[24px]" style={style} data-testid="radar">
      <div className="flex items-center gap-[8px] self-stretch">
        <LiveDot tone="ok" />
        <h2 className="m-0 flex-1 truncate text-[15px]">Every check, live</h2>
      </div>
      <div ref={ref} className="flex w-full justify-center">
        <div className="relative flex-none" style={{ width: SIZE * scale, height: (SIZE + 24) * scale }}>
          <div className="absolute top-0 left-0" style={{ width: SIZE, height: SIZE + 24, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
            <Drawing rings={new Set(nodes.map((n) => n.ring))} />
            {nodes.map((n) => {
              const x = by.get(n.id)!
              const c = TONE_COLOR[x.tone]
              const big = x.tone === "warn" || x.tone === "bad" ? 14 : 10
              const dot: CSSProperties = { left: -big / 2, top: -big / 2, width: big, height: big }
              return (
                <button
                  key={n.id}
                  type="button"
                  aria-label={`${x.name}, ${STATUS_WORD[x.tone].toLowerCase()}, ${x.value}`}
                  onClick={() => onPick(n.id)}
                  className="lv-dot absolute size-[24px] cursor-pointer rounded-full border-0 bg-transparent p-0"
                  style={{ left: n.x - 12, top: n.y - 12 }}
                  data-lit={lit === n.id || undefined}
                  data-testid={`dot-${n.id}`}
                >
                  {/* Everything below is drawn round the dot's centre. */}
                  <span className="absolute top-[12px] left-[12px] block size-0">
                  <span className={`absolute rounded-full ${big === 14 ? "lv" : ""}`} style={{ ...dot, background: c }} {...(big === 14 ? loop("lv-blink .7s ease-in-out") : {})} />
                  <span className="lv absolute rounded-full border opacity-0" style={{ ...dot, borderColor: c }} {...loop(`or-ping ${PERIOD}s linear`, late((n.angle / 360) * PERIOD, PERIOD))} />
                  <span className="lv-dot-ring absolute rounded-full border" style={{ left: -big / 2 - 4, top: -big / 2 - 4, width: big + 8, height: big + 8, borderColor: c }} />
                  <span className={`absolute max-w-[140px] whitespace-nowrap ${LABEL_AT[n.side]}`}>
                    <span className="block truncate text-[12px] leading-[18px]" style={{ color: x.tone === "ok" ? "var(--foreground)" : c }}>
                      {x.name}
                    </span>
                    {!x.short && <span className="tnum block truncate text-[12px] leading-[16px] text-ink-3">{x.value}</span>}
                  </span>
                  </span>
                </button>
              )
            })}
            <div className="absolute flex size-[112px] flex-col items-center justify-center gap-[2px] rounded-full bg-card" style={{ left: MID - 56, top: MID - 56 }}>
              <span className="tnum text-[28px] leading-[1.2]">
                {h.healthy}/{h.total}
              </span>
              <span className="text-[12px]" style={{ color: look ? "var(--dash-warn)" : "var(--dash-ok)" }}>
                {look ? `${look} ${look === 1 ? "needs" : "need"} a look` : "All healthy"}
              </span>
            </div>
            <div className="absolute bottom-0 left-0 flex gap-[16px] text-[12px] text-ink-3">
              {legend.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
