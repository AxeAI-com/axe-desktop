import { motion } from "motion/react"
import { useId, useMemo, useState } from "react"

import type { RichMap } from "@shared/rich"

import { invoke } from "@/lib/bridge"
import { D, useMotion } from "@/lib/motion"

import { CardFrame, EmptyNote, seriesColor } from "./shared"

const MAP_W = 340
const MAP_H = 260
const PAD = 38

/** Web Mercator, in units of the world's width. */
const mercX = (lon: number) => (lon + 180) / 360
const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

/** Places fitted into a w×h box with padding, keeping their true shape. One place sits in the middle. */
export function project(places: { lat: number; lon: number }[], w = MAP_W, h = MAP_H, pad = PAD): [number, number][] {
  const xs = places.map((p) => mercX(p.lon))
  const ys = places.map((p) => mercY(p.lat))
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const spanX = x1 - x0
  const spanY = y1 - y0
  if (spanX === 0 && spanY === 0) return places.map(() => [w / 2, h / 2])
  const k = Math.min(spanX ? (w - 2 * pad) / spanX : Infinity, spanY ? (h - 2 * pad) / spanY : Infinity)
  const ox = (w - spanX * k) / 2
  const oy = (h - spanY * k) / 2
  return xs.map((x, i) => [ox + (x - x0) * k, oy + (ys[i]! - y0) * k])
}

const mapsURL = (p: { lat: number; lon: number; name: string }) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lon}`)}`

/** Places as numbered pins on a quiet map, joined in order, with the list beside them. */
export function MapCard({ map }: { map: RichMap }) {
  const m = useMotion()
  const pid = useId().replace(/:/g, "")
  const [hover, setHover] = useState<number | null>(null)
  // Tall enough for the list beside it, up to a point; then the list scrolls.
  const listTop = map.title ? 36 : 6
  const mapH = Math.max(MAP_H, Math.min(380, map.places.length * 56 + listTop + 6))
  const pts = useMemo(() => (map.places.length ? project(map.places, MAP_W, mapH) : []), [map.places, mapH])
  const groups = useMemo(() => [...new Set(map.places.map((p) => p.group).filter((g): g is string => !!g))], [map.places])
  const colorOf = (g?: string) => (g && groups.length > 1 ? seriesColor(groups.indexOf(g)) : "var(--accent)")

  if (!map.places.length)
    return (
      <CardFrame label={map.title ?? "Map"}>
        <EmptyNote title={map.title} text="None of these places could be found on a map." />
      </CardFrame>
    )

  const route = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")

  return (
    <CardFrame label={map.title ? `Map: ${map.title}` : "Map"} className="flex overflow-hidden">
      <svg width={MAP_W} height={mapH} role="img" aria-label={`Map of ${map.places.length} places`} className="block shrink-0" style={{ background: "var(--map-ground)" }}>
        <defs>
          <pattern id={`${pid}-dots`} width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1" fill="var(--map-dot)" />
          </pattern>
          <radialGradient
            id={`${pid}-glow`}
            gradientUnits="userSpaceOnUse"
            cx={pts.reduce((a, p) => a + p[0], 0) / Math.max(1, pts.length)}
            cy={pts.reduce((a, p) => a + p[1], 0) / Math.max(1, pts.length)}
            r={Math.max(MAP_W, mapH) * 0.7}
          >
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={MAP_W} height={mapH} fill={`url(#${pid}-dots)`} />
        <motion.rect width={MAP_W} height={mapH} fill={`url(#${pid}-glow)`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={m.t(D.slow)} />
        {pts.length > 1 && (
          <motion.path d={route} fill="none" stroke="var(--accent-2)" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="0" strokeLinecap="round" strokeLinejoin="round" {...m.draw(0.1)} />
        )}
        {pts.map(([x, y], i) => {
          const on = hover === i
          return (
            <motion.g
              key={i}
              initial={m.reduced ? { opacity: 0, x, y } : { opacity: 0, x, y: y - 14, scale: 0.6 }}
              animate={{ opacity: 1, x, y, scale: on ? 1.18 : 1 }}
              transition={{ ...m.t(D.base), delay: hover === null ? 0.12 + m.stagger(i, 0.06) : 0 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <motion.circle r={18} fill={colorOf(map.places[i]!.group)} animate={{ opacity: on ? 0.22 : 0 }} transition={m.t(D.fast)} />
              <circle r={12} fill="var(--ink)" stroke={colorOf(map.places[i]!.group)} strokeWidth={groups.length > 1 ? 2.5 : 0} style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))" }} />
              <text textAnchor="middle" y={4} fontSize={11.5} fontWeight={600} fill="var(--ground)" className="tabular-nums">
                {i + 1}
              </text>
            </motion.g>
          )
        })}
      </svg>
      <div className="flex min-w-0 flex-1 flex-col">
        {map.title && <div className="px-4 pt-3.5 pb-1 text-[12px] text-ink-2">{map.title}</div>}
        <ol className="scroll m-0 flex list-none flex-col p-0 py-1.5" style={{ maxHeight: mapH - listTop + 6 }}>
          {map.places.map((p, i) => (
            <motion.li
              key={i}
              initial={m.reduced ? { opacity: 0 } : { opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...m.t(D.base), delay: 0.12 + m.stagger(i, 0.05) }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={`group mx-1.5 flex items-start gap-3 rounded-[6px] px-2.5 py-2 transition-colors duration-150 ${hover === i ? "bg-fill" : ""}`}
            >
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fill-3 text-[12px] text-ink tabular-nums">{i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] leading-5 text-ink">{p.name}</span>
                {(p.note || (p.group && groups.length > 1)) && (
                  <span className="flex items-center gap-1.5 text-[12px] leading-[18px] text-ink-3">
                    {p.group && groups.length > 1 && <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(p.group) }} />}
                    <span className="truncate">{[p.group && groups.length > 1 ? p.group : "", p.note].filter(Boolean).join(", ")}</span>
                  </span>
                )}
              </span>
              <a
                href={mapsURL(p)}
                onClick={(e) => {
                  e.preventDefault()
                  void invoke("app:openExternal", mapsURL(p))
                }}
                className="shrink-0 text-[12px] leading-5 text-accent-ink no-underline opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus:opacity-100"
              >
                Open in Maps
              </a>
            </motion.li>
          ))}
        </ol>
      </div>
    </CardFrame>
  )
}
