import { AnimatePresence, motion } from "motion/react"
import { useCallback, useRef, useState } from "react"

import { repoHeadline } from "@shared/watching/copy"
import type { CheckRow, Kind, OpenFinding, WatchView } from "@shared/watching/types"

import { invoke } from "@/lib/bridge"
import { problemsOf } from "@/lib/dashboard"
import { useMotion } from "@/lib/motion"
import { setState } from "@/lib/store"
import { checkNow, openWatch, setPaused } from "@/lib/watching"

import { ChevronDown, ExternalIcon, MoreIcon, RetryIcon, TrashIcon } from "@/components/SolarIcons"
import { MenuItem, MenuLine, Popover } from "@/components/Popover"
import { PauseIcon, PlayIcon } from "@/components/WatchIcons"
import { DeleteDialog } from "@/components/watching/DeleteDialog"
import { useFixLabel } from "@/components/watching/Fix"
import { button } from "@/components/Kit"

// What a watch's tile can do besides open: the right-click menu (Check now, Pause or Resume, Delete) and, on a
// tile that needs a look, the old LookCard's sentence and buttons (Fix with the agent, Open status page, Check
// now, Show the list or Details) with the Opened board's table.

/** Numbers, times, sizes and versions in a line, with tabular figures. */
export function Nums({ children }: { children: string }) {
  const parts = children.split(/(\d[\d.,:]*(?:\s?(?:ms|GB|MB|KB|TB|s|min|days?|%))?)/)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="tnum">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  )
}

/** Check now, Pause or Resume, Delete: a right-click on a tile, or its ⋯ on hover. */
export function useWatchMenu(w: WatchView) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setAt(null), [])
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setAt({ top: e.clientY, left: Math.min(e.clientX, window.innerWidth - 200) })
  }
  const more = (
    <button
      type="button"
      aria-label={`More for ${w.name}`}
      aria-haspopup="menu"
      aria-expanded={!!at}
      onClick={(e) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        setAt((o) => (o ? null : { top: r.bottom + 4, left: Math.min(r.right - 180, window.innerWidth - 200) }))
      }}
      className="lv-more absolute top-[28px] right-[16px] grid size-[32px] cursor-pointer place-items-center rounded-full border-0 bg-raised p-0 text-ink-3 hover:text-ink"
    >
      <MoreIcon size={16} />
    </button>
  )
  const menu = (
    <>
      <Popover open={!!at} onClose={close} anchor={anchor} at={at ?? undefined} origin="top left" className="min-w-[180px]!" label={w.name}>
        <MenuItem
          icon={<RetryIcon size={14} />}
          onSelect={() => {
            close()
            void checkNow(w.id)
          }}
        >
          Check now
        </MenuItem>
        <MenuItem
          icon={w.paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
          onSelect={() => {
            close()
            void setPaused(w.id, !w.paused)
          }}
        >
          {w.paused ? "Resume" : "Pause"}
        </MenuItem>
        <MenuLine />
        <MenuItem
          danger
          icon={<TrashIcon size={14} />}
          onSelect={() => {
            close()
            setConfirm(true)
          }}
        >
          Delete
        </MenuItem>
      </Popover>
      {confirm && <DeleteDialog w={w} onClose={() => setConfirm(false)} />}
    </>
  )
  return { anchor, onContextMenu, menu, more }
}

/** A failing row of a check list: "express 4.21.2 to 5.1.0", or a service in an outage. */
export const failing = (w: WatchView): CheckRow[] => (w.latest?.rows ?? []).filter((r) => !r.ok && !unreadable(r))
/** A service with no public status feed: grey, not a problem. */
export const unreadable = (r: CheckRow) => r.value.startsWith("Not readable")

/** "Groq, Infura and GitHub look fine.": the services running normally next to the one in trouble. */
function fine(w: WatchView): string {
  const ok = (w.latest?.rows ?? []).filter((r) => r.ok).map((r) => r.label)
  if (!ok.length) return ""
  const list = ok.length < 2 ? ok[0] : `${ok.slice(0, -1).join(", ")} and ${ok.at(-1)}`
  return `${list} ${ok.length === 1 ? "looks" : "look"} fine.`
}

const SHOW_WORD: Partial<Record<Kind, string>> = { outdated: "packages", seo: "checks", links: "pages", security: "checks", dns: "records", feed: "files", expiry: "dates" }

/** The sentence a tile that needs a look ends with. */
export function lookText(w: WatchView): string {
  const ps = problemsOf(w)
  const f: OpenFinding | undefined = ps[0]
  const rows = failing(w)
  if (!f) return w.latest?.error ? `${w.latest.error}.` : "Axe couldn’t check it the last three times."
  if (w.kind === "repo" && ps.length > 1) return `${repoHeadline(ps.length, w.name)}.`
  if (w.kind === "status") return [...rows.map((r) => `${r.value.replace(/\.?$/, ".")}`).slice(0, 1), fine(w)].filter(Boolean).join(" ") || (f.detail ?? f.line ?? "")
  // With a list behind Show, the list says the rest.
  return [f.headline.replace(/\.?$/, "."), rows.length && SHOW_WORD[w.kind] ? undefined : f.detail].filter(Boolean).join(" ")
}

const ghost = `${button.secondary} cursor-pointer`
const light = `${button.primary} cursor-pointer`

/** The buttons of a tile that needs a look, and the list Show opens. */
export function LookActions({ w }: { w: WatchView }) {
  const f: OpenFinding | undefined = problemsOf(w)[0]
  const { agent } = useFixLabel(w)
  const [open, setOpen] = useState(false)
  const m = useMotion()
  const rows = failing(w)
  const word = SHOW_WORD[w.kind]
  const statusUrl = w.kind === "status" && f ? rows.find((r) => r.sub)?.sub : undefined
  return (
    <>
      <AnimatePresence initial={false}>
        {open && rows.length > 0 && (
          <motion.div {...m.collapse} className="overflow-hidden">
            <RowsTable w={w} rows={rows} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center gap-[8px]">
        {f?.fix === "agent" ? (
          <button
            type="button"
            className={light}
            onClick={() => {
              // The watch's own thread runs the fix, as a notification's Fix button does.
              setState({ watchFix: { id: w.id, key: f.key } })
              openWatch(w.id)
            }}
          >
            Fix with {agent}
          </button>
        ) : statusUrl ? (
          <button type="button" className={ghost} onClick={() => void invoke("app:openExternal", `https://${statusUrl}`)}>
            <ExternalIcon size={16} className="text-ink-3" />
            Open status page
          </button>
        ) : !f ? (
          <button type="button" className={light} onClick={() => void checkNow(w.id)}>
            Check now
          </button>
        ) : null}
        {rows.length > 0 && word ? (
          <button type="button" aria-expanded={open} className={ghost} onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={16} className={`text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            {open ? "Hide" : "Show"} {word}
          </button>
        ) : (
          <button type="button" className={ghost} onClick={() => openWatch(w.id)}>
            Details
          </button>
        )}
      </div>
    </>
  )
}

/** The Opened board's table: package, current, latest; any other list as label and value. */
function RowsTable({ w, rows }: { w: WatchView; rows: CheckRow[] }) {
  const split = w.kind === "outdated"
  const cols = split ? "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_24px_minmax(0,1fr)_64px]" : "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
  return (
    <div role="table" aria-label={`${w.name}, details`} className="flex flex-col gap-[8px] pb-[8px]">
      <div role="row" className={`grid ${cols} items-center gap-[16px] px-[16px] text-[12px] text-ink-3`}>
        {split ? (
          <>
            <span role="columnheader">Package</span>
            <span role="columnheader">Current</span>
            <span role="columnheader" />
            <span role="columnheader">Latest</span>
            <span role="columnheader" className="text-right">
              Change
            </span>
          </>
        ) : (
          <>
            <span role="columnheader">Check</span>
            <span role="columnheader">Found</span>
          </>
        )}
      </div>
      {rows.map((r) => {
        const [cur, next] = split ? r.value.split(" to ") : []
        return (
          <div key={r.label} role="row" className={`grid ${cols} h-[32px] items-center gap-[16px] rounded-[6px] bg-input px-[10px] text-[13px]`}>
            {split ? (
              <>
                <span role="cell" className="tnum truncate">
                  {r.label}
                </span>
                <span role="cell" className="tnum truncate text-ink-3">
                  {cur}
                </span>
                <span role="cell" style={{ color: "var(--dash-warn)" }}>
                  →
                </span>
                <span role="cell" className="tnum truncate">
                  {next ?? ""}
                </span>
                <span role="cell" className="text-right">
                  <span className="inline-flex h-[24px] items-center rounded-full px-[10px] text-[12px]" style={{ color: "var(--dash-warn)", background: "var(--dash-warn-soft)" }}>
                    Major
                  </span>
                </span>
              </>
            ) : (
              <>
                <span role="cell" className="truncate">
                  {r.label}
                </span>
                <span role="cell" className="truncate text-ink-3">
                  <Nums>{r.value}</Nums>
                </span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
