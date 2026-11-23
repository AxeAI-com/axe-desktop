import type { ReactNode } from "react"

import type { WatchView } from "@shared/watching/types"


import { LiveDashboard } from "@/components/watching/live/LiveDashboard"

// The Watching dashboard: with watches, Watching is the live dashboard (spec 0002, `live/`). Each watch is a chat:
// a tile opens the watch's own thread. The title bar shows the count and the Live pill.

export { useWidth } from "@/components/watching/live/hooks"
export { Nums } from "@/components/watching/live/actions"

export function Dashboard({ watches, top, bottom }: { watches: WatchView[]; top?: ReactNode; bottom?: ReactNode }) {
  return <LiveDashboard watches={watches} top={top} bottom={bottom} />
}

/* The title bar on Watching: the count, and Live with the last check */

export function WatchingTitleExtras({ watches }: { watches: WatchView[] }) {
  return (
    <span className="tnum inline-flex h-[22px] items-center rounded-full bg-input px-[8px] text-[12px] text-ink-3" data-testid="watch-count">
      {watches.length}
    </span>
  )
}

