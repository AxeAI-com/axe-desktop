import { useMinute } from "@/components/watching/live/hooks"

// Calm times (2026-11-08). These used to be odometers ticking to the hundredth of a second; now they are plain
// text that changes once a minute.

/** "5 min", or "under a minute", until `to`; nothing once it's due. */
export function CountDown({ to }: { to: number }) {
  useMinute()
  const left = to - Date.now()
  if (left <= 0) return null
  const m = Math.ceil(left / 60_000)
  return <span className="tnum whitespace-nowrap">{left < 60_000 ? "under a minute" : `${m} min`}</span>
}

/** "just now" for the first minute after `from`; nothing after. */
export function CountUp({ from }: { from: number }) {
  useMinute()
  if (Date.now() - from >= 60_000) return null
  return <span className="whitespace-nowrap">just now</span>
}
