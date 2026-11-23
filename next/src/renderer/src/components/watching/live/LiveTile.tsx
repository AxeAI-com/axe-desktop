import type { CSSProperties } from "react"

import { EVERY_LABEL } from "@shared/watching/schedule"
import type { WatchView } from "@shared/watching/types"

import { factOf, lineOf, ticks, toneOf, type TickTone, type Tone } from "@/lib/dashboard"
import { nextCheck, shortName, STATUS_WORD, subOf, headlineOf, whenOf } from "@/lib/live-copy"
import { openWatch } from "@/lib/watching"

import { KindIcon } from "@/components/WatchIcons"
import { lookText, LookActions, useWatchMenu } from "@/components/watching/live/actions"
import { CountDown } from "@/components/watching/live/Odometer"
import { loop } from "@/components/watching/live/loops"
import { TileViz, TONE_COLOR } from "@/components/watching/live/TileViz"

// One watch as a live tile (spec 0002, board M-WatchBLive): its icon disc, name and what it watches, the headline
// value, the kind's motion, the last 24 checks and when the next one comes. A watch that needs a look spans two
// columns and keeps the old LookCard's sentence and buttons. Click opens the watch; right-click is its menu.

const wash = (t: Tone) => (t === "run" ? "var(--fill-2)" : `color-mix(in srgb, ${TONE_COLOR[t]} 14%, transparent)`)
const EDGE: Partial<Record<Tone, string>> = { warn: "inset 0 0 0 1px color-mix(in srgb, var(--warn) 35%, transparent)", bad: "inset 0 0 0 1px color-mix(in srgb, var(--bad) 35%, transparent)" }

/** A status dot with a ring that pings out of it; faster for anything but healthy. */
export function LiveDot({ tone, size = 8 }: { tone: Tone; size?: number }) {
  const c = TONE_COLOR[tone]
  return (
    <span className="lv relative block flex-none" style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute inset-0 rounded-full" style={{ background: c }} />
      {tone !== "paused" && <span className="absolute inset-0 rounded-full" style={{ background: c }} {...loop(`lv-ping ${tone === "ok" ? "1.6s" : ".8s"} ease-out`)} />}
    </span>
  )
}

/** The 40 px disc: the kind's icon in the status colour, a slow ping, or a spinning arc while it checks. */
function Disc({ w, tone }: { w: WatchView; tone: Tone }) {
  const c = TONE_COLOR[tone]
  return (
    <span className="lv relative flex size-[40px] flex-none items-center justify-center rounded-full" style={{ background: wash(tone), color: c }}>
      {tone === "run" ? (
        <span className="absolute inset-[-3px] rounded-full border-2 border-transparent" style={{ borderTopColor: c }} {...loop("lv-spin 1s linear")} />
      ) : tone !== "paused" ? (
        <span className="absolute inset-0 rounded-full border" style={{ borderColor: c }} {...loop("lv-ping 2.4s ease-out")} />
      ) : null}
      <KindIcon kind={w.kind} size={20} />
    </span>
  )
}

const BAR: Record<TickTone, string> = { ok: "var(--dash-ok)", warn: "var(--dash-warn)", news: "var(--dash-blue)", live: "var(--dash-blue)", fail: "var(--lv-tick)", empty: "var(--lv-empty)" }

/** The last 24 checks as pills in a grid (never wider than the tile), a light sweeping across, the newest breathing. */
function Bars({ w, tall, delay }: { w: WatchView; tall: boolean; delay: number }) {
  const t = ticks(w.strip, !!w.checking)
  return (
    <span className="lv relative block overflow-hidden rounded-full" aria-hidden="true" data-testid="dash-ticks">
      <span className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${t.length}, minmax(0, 1fr))` }}>
        {t.map((x, i) => (
          <span
            key={i}
            data-t={x}
            className="block rounded-full"
            style={{ height: tall ? 16 : 12, background: BAR[x] }}
            {...(i === t.length - 1 ? loop("lv-blink 1.2s ease-in-out") : {})}
          />
        ))}
      </span>
      <span className="absolute top-0 bottom-0 left-0 w-1/4" style={{ background: "var(--lv-sheen)", transform: "translateX(-100%)" }} {...loop("lv-sweep 2.4s linear", -delay)} />
    </span>
  )
}

/** Under the bars: when the next check comes, or how often it runs. */
function Foot({ w, tone }: { w: WatchView; tone: Tone }) {
  if (tone === "paused") return <>{lineOf(w).replace(/\.$/, "")}</>
  if (w.checking) return <>{EVERY_LABEL[w.every]}</>
  if (w.every === "morning") return <>Every morning</>
  const under = w.kind === "disk" ? factOf(w, "Tell me under") : undefined
  if (under) return <>Tells you under {under}</>
  const at = nextCheck(w)
  if (at === undefined) return <>{EVERY_LABEL[w.every]}</>
  if (at <= Date.now()) return <>Next check due</>
  return (
    <>
      Next check in <CountDown to={at} />
    </>
  )
}

export function LiveTile({ w, span, i, lit, onHover }: { w: WatchView; span: number; i: number; lit: boolean; onHover: (id?: string) => void }) {
  const tone = toneOf(w)
  const look = tone === "warn" || tone === "bad"
  const wide = span >= 2
  const c = TONE_COLOR[tone]
  const { anchor, onContextMenu, menu, more } = useWatchMenu(w)
  const name = shortName(w)
  const value = headlineOf(w)
  const style: CSSProperties = { gridColumn: `span ${span}`, ...(EDGE[tone] ? { boxShadow: EDGE[tone] } : {}) }
  return (
    <div
      ref={anchor}
      onContextMenu={onContextMenu}
      onMouseEnter={() => onHover(w.id)}
      onMouseLeave={() => onHover(undefined)}
      onFocus={() => onHover(w.id)}
      onBlur={() => onHover(undefined)}
      className="lv-tile group/w relative flex min-w-0 flex-col rounded-3xl bg-card"
      style={style}
      data-testid={`row-${w.id}`}
      data-tone={tone}
      data-hi={lit || undefined}
    >
      <button
        type="button"
        onClick={() => openWatch(w.id)}
        className={`flex min-w-0 flex-1 cursor-pointer flex-col gap-[16px] rounded-3xl border-0 bg-transparent p-[24px] text-left text-ink ${look ? "pb-[16px]" : ""}`}
      >
        <span className="flex w-full items-center gap-[12px]">
          <Disc w={w} tone={tone} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{name}</span>
            <span className="truncate text-[12px] text-ink-3">{subOf(w)}</span>
          </span>
          {wide ? (
            <span className="inline-flex h-[24px] flex-none items-center gap-[6px] rounded-full px-[10px] text-[12px]" style={{ background: wash(tone), color: c }}>
              <LiveDot tone={tone} />
              {STATUS_WORD[tone]}
            </span>
          ) : (
            <LiveDot tone={tone} />
          )}
        </span>
        {w.latest || w.checking ? (
          <>
            <span className="flex w-full items-baseline justify-between gap-[8px]">
              {/* A long value (a sentence from a newer kind) steps down to the title size rather than lose its end. */}
              <span className={`tnum min-w-0 truncate leading-[1.2] ${value.length > (wide ? 32 : 14) ? "text-[15px]" : wide ? "text-[28px]" : "text-[20px]"}`} style={{ color: tone === "ok" ? "var(--foreground)" : c }} title={value}>
                {value}
              </span>
              <span className="tnum flex-none text-[12px] text-ink-3">{whenOf(w)}</span>
            </span>
            <TileViz w={w} tone={tone} />
            <span className="flex-1" />
            <Bars w={w} tall={wide} delay={(i * 0.4) % 2.4} />
            <span className="block w-full text-[12px] text-ink-3">{look ? lookText(w) : <Foot w={w} tone={tone} />}</span>
          </>
        ) : (
          <>
            <span className="flex-1" />
            <span className="block text-[13px] text-ink-3">Waiting for the first check</span>
          </>
        )}
      </button>
      {look && (
        <div className="flex flex-col gap-[16px] px-[24px] pb-[24px]">
          <LookActions w={w} />
        </div>
      )}
      {more}
      {menu}
    </div>
  )
}
