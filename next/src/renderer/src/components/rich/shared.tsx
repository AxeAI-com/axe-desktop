import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { motion } from "motion/react"

import { useMotion } from "@/lib/motion"

/** What a card needs from the message it sits in. */
export type RichContextValue = {
  /** The reply is the chat's latest and nothing is running: choices can still be picked. */
  canAnswer: boolean
  /** The user's next message, if there is one (shows which choice was picked). */
  answeredWith?: string
  /** Sends a picked choice as the next message. */
  choose?: (text: string) => void
}

export const RichContext = createContext<RichContextValue>({ canAnswer: false })
export const useRich = () => useContext(RichContext)

/** Series colours, in order. Tokens, so light and dark each get theirs. */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
export const seriesColor = (i: number) => SERIES[i % SERIES.length]!

/** The width a card's drawing has, kept current as the window resizes. */
export function useWidth<T extends HTMLElement>(fallback = 698) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth || fallback)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, width] as const
}

/** The frame every card shares: a rounded panel that arrives with a soft rise. */
export function CardFrame({ label, children, className = "", delay = 0 }: { label: string; children: ReactNode; className?: string; delay?: number }) {
  const m = useMotion()
  return (
    <motion.section {...m.card(delay)} aria-label={label} className={`rich-card ${className}`}>
      {children}
    </motion.section>
  )
}

/** A quiet line for a card that arrived with nothing in it. */
export function EmptyNote({ title, text }: { title?: string; text: string }) {
  return (
    <div className="flex flex-col gap-1 px-[18px] py-4">
      {title && <span className="text-[12px] text-ink-3">{title}</span>}
      <span className="text-[13px] text-ink-2">{text}</span>
    </div>
  )
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })

/** A value with its prefix and suffix; big numbers grouped, small ones with a decimal or two. */
export function formatValue(n: number, prefix = "", suffix = "", short = false) {
  const abs = Math.abs(n)
  const digits = abs < 10 ? 2 : abs < 100 ? 1 : 0
  const body =
    short && abs >= 10_000
      ? compact.format(abs)
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(abs)
  return `${n < 0 ? "−" : ""}${prefix}${body}${suffix}`
}

/** A "nice" axis step: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(range: number, ticks = 4) {
  const raw = range / ticks || 1
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
}
