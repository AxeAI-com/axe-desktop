import { useMemo } from "react"

import type { WatchView } from "@shared/watching/types"

import { type ActivityEntry, activity } from "@/lib/activity"
import { openThread } from "@/lib/store"

import { clock } from "@/components/watching/Evidence"

// A check's Activity: one quiet 13 px line per incident, change and fix, newest first, by day.
// Only an open incident takes the warn colour; a fix line opens its chat. Built by lib/activity.ts.

const STATE: Record<NonNullable<ActivityEntry["state"]>, string> = { open: "", resolved: "Resolved", fixed: "Fixed", expected: "Expected" }

const ROW = "grid w-full grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-[12px] rounded-full px-[10px] py-[5px] text-left text-[13px] leading-[18px]"

function Row({ e }: { e: ActivityEntry }) {
  const open = e.state === "open"
  const right = e.kind === "fix" ? (e.running ? e.agent : "") : e.state ? STATE[e.state] : ""
  const inner = (
    <>
      <span className="text-ink-3 tabular-nums">{clock(e.at)}</span>
      <span className={`min-w-0 ${open ? "text-warn" : "text-ink"}`}>{e.text}</span>
      <span className="text-ink-3">{right}</span>
    </>
  )
  const id = e.threadId
  if (id)
    return (
      <button type="button" data-testid="activity-row" className={`${ROW} cursor-pointer border-0 bg-transparent transition-colors duration-150 hover:bg-fill`} onClick={() => void openThread(id)}>
        {inner}
      </button>
    )
  return (
    <div data-testid="activity-row" className={ROW}>
      {inner}
    </div>
  )
}

export function Activity({ w }: { w: WatchView }) {
  const groups = useMemo(() => activity(w), [w])
  if (!groups.length) return null
  return (
    <section className="-mx-[10px] flex flex-col gap-[12px]" aria-label="Activity" data-testid="activity">
      <h2 className="m-0 px-[10px] text-[13px] leading-[18px] font-normal text-ink-2">Activity</h2>
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col">
          <div className="px-[10px] pb-[2px] text-[12px] leading-[16px] text-ink-3">{g.label}</div>
          {g.entries.map((e) => (
            <Row key={e.id} e={e} />
          ))}
        </div>
      ))}
    </section>
  )
}
