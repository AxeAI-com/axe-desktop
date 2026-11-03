import type { Every, Watch } from "./types"

// When a watch runs. Watches run on this Mac while it's awake: missed times are skipped,
// never replayed, so after sleep an overdue watch runs once.

const MIN = 60_000
export const EVERY_MS: Record<Exclude<Every, "morning">, number> = { "5m": 5 * MIN, "15m": 15 * MIN, "1h": 60 * MIN }
/** "Every morning" runs at 7:30 local time. */
export const MORNING = { h: 7, m: 30 }

export const EVERY_LABEL: Record<Every, string> = { "5m": "Every 5 minutes", "15m": "Every 15 minutes", "1h": "Every hour", morning: "Every morning" }

/** A steady offset per watch, up to 10% of its interval, so watches made together don't all start together. */
export function jitter(id: string, every: Every): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const span = every === "morning" ? 10 * MIN : EVERY_MS[every] * 0.1
  return Math.floor((h % 1000) / 1000 * span)
}

/** The first 7:30 strictly after `t`, local time. */
export function nextMorning(t: number): number {
  const d = new Date(t)
  d.setHours(MORNING.h, MORNING.m, 0, 0)
  if (d.getTime() <= t) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** When the watch is next due. Never run: due now. Paused: never. */
export function nextAt(w: Pick<Watch, "id" | "every" | "paused">, lastAt: number | undefined, now: number): number | null {
  if (w.paused) return null
  if (lastAt === undefined) return now
  const base = w.every === "morning" ? nextMorning(lastAt) : lastAt + EVERY_MS[w.every]
  return base + jitter(w.id, w.every)
}

export const isDue = (w: Pick<Watch, "id" | "every" | "paused">, lastAt: number | undefined, now: number) => {
  const at = nextAt(w, lastAt, now)
  return at !== null && at <= now
}
