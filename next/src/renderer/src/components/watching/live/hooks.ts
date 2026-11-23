import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

import { pauseLoops, startLoops, stopLoops } from "@/components/watching/live/loops"

// The live dashboard's clocks: re-render every half minute or at a given time, pause the live loops while the
// window is away, and an element's width.

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

/** Re-renders every half minute, so "3 min ago" keeps up and the odometers re-seed. */
export function useMinute() {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
}

/** Re-renders once at `at` (a time in ms), if that is in the next day. */
export function useAt(at: number | undefined) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (at === undefined) return
    const d = at - Date.now()
    if (d <= 0 || d > 86_400_000) return
    const t = setTimeout(() => tick((n) => n + 1), d + 16)
    return () => clearTimeout(t)
  }, [at])
}

/* Pausing while the window is hidden, or unfocused for a minute */

const AWAY_MS = 60_000
let paused = false
let epoch = 0
const subs = new Set<() => void>()
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

function setPausedLive(p: boolean) {
  if (p === paused) return
  paused = p
  document.documentElement.classList.toggle("live-paused", p)
  pauseLoops(p)
  // Coming back, every odometer re-seeds from the clock.
  if (!p) epoch++
  for (const f of subs) f()
}

/** Runs the live loops, and puts `.live-paused` on the root (pausing them) while the window is hidden or has been unfocused for a minute. */
export function useLivePause() {
  useEffect(() => {
    startLoops()
    let away: ReturnType<typeof setTimeout> | undefined
    const clear = () => {
      if (away) clearTimeout(away)
      away = undefined
    }
    const update = () => {
      clear()
      if (document.hidden) return setPausedLive(true)
      setPausedLive(false)
      if (!document.hasFocus()) away = setTimeout(() => setPausedLive(true), AWAY_MS)
    }
    update()
    document.addEventListener("visibilitychange", update)
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    return () => {
      clear()
      document.removeEventListener("visibilitychange", update)
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
      setPausedLive(false)
      stopLoops()
    }
  }, [])
}

/** A number that changes each time the live loops resume, for re-seeding. */
export const useLiveEpoch = () => useSyncExternalStore(subscribe, () => epoch)

