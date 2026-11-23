import { useEffect, useRef, useState, type ReactNode } from "react"

import type { WatchView } from "@shared/watching/types"

import { coverLine, fillRows, grouped, healthOf, loadOrder, needsLook, saveOrder, sortTiles, type Order } from "@/lib/dashboard"

import { useLivePause, useMinute, useWidth } from "@/components/watching/live/hooks"
import { LiveTile } from "@/components/watching/live/LiveTile"
import { Radar } from "@/components/watching/live/Radar"
import { wideWidth } from "@/lib/layout"
import "@/components/watching/live/live.css"

// The Watching dashboard, live (spec 0002, board M-WatchCombo): how many are healthy and the order switch, the
// live log, then one grid: the radar of every watch, each watch that needs a look as a two-column tile, and every
// other watch as a live tile. The grid never leaves an empty cell (`fillRows`).

/** Under this width the grid has two columns and the radar takes a row of its own. */
export const WIDE = 1000

function Heading({ watches, order, setOrder }: { watches: WatchView[]; order: Order; setOrder: (o: Order) => void }) {
  const h = healthOf(watches)
  const look = h.warnings + h.down
  const running = watches.find((w) => w.checking)
  const sub = [coverLine(grouped(watches).map((g) => g.group)), running ? `Checking ${running.name} now.` : ""].filter(Boolean).join(" ")
  const seg = (o: Order, label: string) => (
    <button
      type="button"
      aria-pressed={order === o}
      onClick={() => setOrder(o)}
      className={`h-[32px] cursor-pointer rounded-full border-0 px-[14px] text-[13px] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] ${order === o ? "bg-raised text-ink" : "bg-transparent text-ink-3 hover:bg-raised hover:text-ink"}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap items-end gap-x-[24px] gap-y-[16px]" data-testid="dash-status">
      <div className="min-w-0 flex-[1_1_360px]">
        <h1 className="m-0 text-[28px] leading-[1.2] font-normal">
          {h.healthy} of {h.total} {h.total === 1 ? "check" : "checks"} healthy
          {look > 0 && (
            <>
              , <span style={{ color: "var(--dash-warn)" }}>{look} {look === 1 ? "needs" : "need"} a look</span>
            </>
          )}
        </h1>
        {sub && <p className="m-0 mt-[4px] text-ink-3">{sub}</p>}
      </div>
      <div role="group" aria-label="Order" className="flex flex-none gap-[4px] rounded-full bg-input p-[4px]">
        {seg("problems", "Problems first")}
        {seg("group", "By group")}
      </div>
    </div>
  )
}

export function LiveDashboard({ watches, top, bottom }: { watches: WatchView[]; top?: ReactNode; bottom?: ReactNode }) {
  useMinute()
  useLivePause()
  const [ref, width] = useWidth<HTMLDivElement>()
  const wide = width >= WIDE
  const cols = wide ? 4 : 2
  const [order, setOrderState] = useState(loadOrder)
  const setOrder = (o: Order) => {
    setOrderState(o)
    saveOrder(o)
  }
  const [hover, setHover] = useState<string>()
  const [hi, setHi] = useState<string>()
  const hiTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(hiTimer.current), [])
  const tiles = sortTiles(watches, order)
  // The radar keeps one order whichever way the tiles are sorted, so its dots never jump.
  const radarOrder = grouped(watches).flatMap((g) => g.watches)
  const [radar, ...cells] = fillRows([{ w: 2, h: wide ? 2 : 1 }, ...tiles.map((w) => (needsLook(w) ? 2 : 1))], cols)
  // A dot on the radar brings its tile into view and marks it for a second.
  const pick = (id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="row-${CSS.escape(id)}"]`)
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" })
    clearTimeout(hiTimer.current)
    setHi(id)
    hiTimer.current = setTimeout(() => setHi(undefined), 1000)
  }
  return (
    <div ref={ref} className="w-full text-[15px] leading-[1.47]" data-testid="dashboard" data-wide={wide || undefined}>
      <div className={`mx-auto flex ${wideWidth} flex-col gap-[24px] pt-[24px] pb-[40px] ${wide ? "px-[40px]" : "px-[24px]"}`}>
        {top}
        <Heading watches={watches} order={order} setOrder={setOrder} />
        <div className="grid gap-[16px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-testid="live-grid">
          <Radar watches={radarOrder} style={{ gridColumn: `span ${radar!.w}`, gridRow: `span ${radar!.h}` }} lit={hover} onPick={pick} />
          {tiles.map((w, i) => (
            <LiveTile key={w.id} w={w} span={cells[i]!.w} i={i} lit={hi === w.id} onHover={setHover} />
          ))}
        </div>
        {bottom}
      </div>
    </div>
  )
}
