import { useCallback, useEffect, useRef, useState } from "react"

import { ASK, expectedSay, firstMessage, foldedLine, foldedPlan, KIND_LABEL, repoHeadline, repoName, sentence } from "@shared/watching/copy"
import { liveProblems } from "@shared/watching/findings"
import { EVERY_LABEL } from "@shared/watching/schedule"
import { money } from "@shared/watching/price"
import { urlOf } from "@shared/watching/target"
import { type Draft, type Every, type Kind, MORE_KINDS, type News, type NotifyWhen, type OpenFinding, type PastFinding, type Run, type Said, type Step, type WatchView } from "@shared/watching/types"
import type { Answerer } from "@shared/types"

import { invoke } from "@/lib/bridge"
import { column, composerDock, composerWidth } from "@/lib/layout"
import { watchCommandOf } from "@/lib/slash"
import { defaultAnswerer, getState, setState, useStore } from "@/lib/store"
import {
  actOn,
  actOnAll,
  addElement,
  changeDraft,
  checkNow,
  closeSummary,
  draftWatch,
  fixWatch,
  ignoreChange,
  markSeen,
  openWatch,
  openWatching,
  readFreeText,
  readReply,
  namedWatches,
  replyToMany,
  replyWithUndo,
  runWatchCommand,
  setPaused,
  startWatch,
  undoable as saidUndo,
  undoSaid,
  updateWatch,
} from "@/lib/watching"

import { ChangesPanel } from "@/components/ChangesPanel"
import { Composer, type ComposerHandle } from "@/components/Composer"
import { AlertIcon, BranchIcon, CheckIcon, ChevronDown, CopyIcon, ExternalIcon, EyeIcon, FolderIcon, PencilIcon, RetryIcon, SunIcon, TrashIcon, WifiOffIcon, XIcon } from "@/components/Icons"
import { ModelChip } from "@/components/watching/Model"
import { MenuItem, MenuLabel, MenuLine, Popover } from "@/components/Popover"
import { Select } from "@/components/Select"
import { clock, Diff, day, PriceChart, SpeedChart, sameDay, span, Strip, stripLabel, UpStrip } from "@/components/watching/Evidence"
import { KindIcon, KindTile, PauseIcon, PlayIcon, TypeIcon } from "@/components/WatchIcons"
import { activeFix, CheckRows, FixBlock, FixedCard, RecordFix, RepoCard, useFixLabel } from "@/components/watching/Fix"
import { Bubble, btn, card, Dot, Facts, Line, Meta, Spin, Undo } from "@/components/watching/parts"
import { StartHeading, } from "@/screens/NewChat"
import { DeleteDialog } from "@/components/watching/DeleteDialog"
import { Catalogue } from "@/components/watching/Catalogue"
import { Dashboard } from "@/components/watching/Dashboard"

// Watching (design: docs/watching/design.html). The page lists watches, a starter puts its kind in the
// chat's own composer, the plan confirms it, and a watch's screen shows its history. Quiet runs say
// nothing: they fold into the tick strip. Only problems (orange) and news (blue) speak.

const STARTERS = ["uptime", "page", "price", "security", "repo"] as const
/** Ten more kinds behind the More starter, so the row stays one line. */
const MORE: Kind[] = MORE_KINDS
const NO_WATCHES: WatchView[] = []

/* Time words */

function ago(t: number, now = Date.now()) {
  const m = Math.round((now - t) / 60_000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m} min ago`
  if (sameDay(t, now)) return clock(t)
  if (sameDay(t, now - 86_400_000)) return "Yesterday"
  return day(t)
}

/** "tomorrow, 9:00 am", "3:45 pm", "Nov 7, 9:00 am". */
function when(t: number, now = Date.now()) {
  if (sameDay(t, now)) return clock(t)
  if (sameDay(t, now + 86_400_000)) return `tomorrow, ${clock(t)}`
  return `${day(t)}, ${clock(t)}`
}

const snoozed = (f: OpenFinding) => !!f.snoozedUntil && f.snoozedUntil > Date.now()
const problems = (w: WatchView) => liveProblems(w, Date.now())

/* Small parts */

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-[6px] p-0 pl-[2px] text-[13px] leading-[18px] text-ink-3">
      {steps.map((s) => (
        <li key={s.label} className={`flex items-center gap-[8px] ${s.state === "done" ? "text-ink-2" : s.state === "run" ? "text-ink" : ""}`}>
          {s.state === "done" ? <CheckIcon size={13} className="text-ok" /> : s.state === "run" ? <Spin /> : <i className="inline-block size-[12px] shrink-0 rounded-full border-[1.5px] border-ink-4 opacity-60" />}
          {s.label}
        </li>
      ))}
    </ul>
  )
}

function Starters({ onPick, align = "center", hot }: { onPick: (k: Kind) => void; align?: "center" | "start"; hot?: Kind }) {
  const [more, setMore] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setMore(false), [])
  const chipClass = (on: boolean) =>
    `group inline-flex h-[30px] cursor-pointer items-center gap-[7px] rounded-full border-0 bg-card pr-[12px] pl-[10px] text-[13px] shadow-card transition-colors duration-150 hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand ${on ? "text-ink" : "text-ink-2"}`
  return (
    <div role="group" aria-label="Starters" className={`flex flex-wrap gap-[6px] ${align === "center" ? "justify-center" : "justify-start"}`}>
      {STARTERS.map((k) => (
        <button key={k} type="button" onClick={() => onPick(k)} className={chipClass(hot === k)}>
          <KindIcon kind={k} size={14} className="text-ink-3" />
          {KIND_LABEL[k]}
        </button>
      ))}
      <span className="relative">
        <button ref={anchor} type="button" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((o) => !o)} className={`${chipClass(more || (!!hot && MORE.includes(hot)))} pr-[10px]!`}>
          More
          <ChevronDown size={12} className="text-ink-4" />
        </button>
        <Popover open={more} onClose={close} anchor={anchor} origin="top right" className="top-[calc(100%+6px)] right-0" label="More to watch">
          {MORE.map((k) => (
            <MenuItem
              key={k}
              icon={<KindIcon kind={k} size={14} />}
              onSelect={() => {
                close()
                onPick(k)
              }}
            >
              {KIND_LABEL[k]}
            </MenuItem>
          ))}
        </Popover>
      </span>
    </div>
  )
}

/* The Watching page */

/** One confirm for Delete, from the chevron menu or a row's menu. Delete is focused: Return confirms, Esc cancels. */
/**
 * A sentence typed on the Watching page, as a short thread: your words, "Thinking…" while the model
 * reads it, then what Axe needs (the kind, with the starters, or the target) or why it can't reach the target.
 */
function ReadThread() {
  const ask = useStore((s) => s.watchAsk)
  if (!ask) return null
  return (
    <div className="flex flex-col gap-[16px]" data-testid="watch-read">
      <Bubble>{ask.text}</Bubble>
      {ask.reading ? (
        <div className="flex items-center gap-[8px] text-[13px] leading-[18px] text-ink-3" role="status">
          <Spin />
          Thinking…
        </div>
      ) : (
        <div className="flex flex-col gap-[10px] text-[15px] leading-[22px] text-ink">
          <span>{ask.error ?? ask.question}</span>
          {ask.error && ask.button && (
            <div className="flex flex-wrap items-center gap-[6px]">
              <button
                type="button"
                className={btn()}
                onClick={() => {
                  // The plan's bubble is the starter's sentence: your words named the address it couldn't reach.
                  const b = ask.button!
                  setState({ watchAsked: null, watchKind: b.kind })
                  void draftWatch(b.kind, b.target, !!b.force)
                }}
              >
                {ask.button.label}
              </button>
            </div>
          )}
          {!ask.error && !ask.kind && (
            <Starters
              align="start"
              onPick={(k) => {
                // Your click sets the kind; with an address already found, it's checked straight away.
                if (ask.target) {
                  setState({ watchAsked: ask.text, watchKind: k })
                  void draftWatch(k, ask.target)
                } else setState({ watchAsk: null, watchKind: k })
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** The 12 px line under the composer: the hint, "Checking …", or what's wrong with the target. */
function Below() {
  const kind = useStore((s) => s.watchKind)
  const error = useStore((s) => s.watchError)
  const button = useStore((s) => s.watchErrorButton)
  const busy = useStore((s) => s.watchBusy)
  const note = useStore((s) => s.watchNote)
  const busyTarget = useStore((s) => s.watchBusyTarget)
  const repoMenuOpen = useStore((s) => s.watchRepoMenu)
  const reading = useStore((s) => !!s.watchAsk)
  const row = `${composerWidth} flex min-h-[16px] items-center gap-[10px] px-[16px] text-[12px] leading-[16px] mt-[-4px]`
  if (error)
    return (
      <div className={`${row} text-warn`} role="alert">
        <AlertIcon size={13} className="shrink-0" />
        <span>{error}</span>
        {button && (
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-brand-text hover:underline" onClick={() => {
              // "Watch the page instead": your click switches the kind, and the link stays.
              if (button.kind !== kind) setState({ watchKind: button.kind })
              void draftWatch(button.kind, button.target, !!button.force)
            }}
          >
            {button.label}
          </button>
        )}
      </div>
    )
  if (note && !busy)
    return (
      <div className={`${row} text-ink-2`} role="status">
        {note}
      </div>
    )
  if (busy)
    return (
      <div className={`${row} text-ink-3`} role="status">
        {kind === "page" ? "Reading the page…" : kind === "price" ? "Finding the price…" : kind === "repo" ? `Looking at ${repoName(busyTarget ?? "it")}…` : `Checking ${busyTarget ?? "it"}…`}
      </div>
    )
  // The Repo starter's menu stands in for the hint while it's open.
  if (kind === "repo" && repoMenuOpen) return null
  if (kind && !reading) return <div className={`${row} text-ink-3`}>Press Return to check it. Esc to go back.</div>
  return null
}

/** The chat's own Composer, with the starter's chip; Return checks the target or reads the sentence. */
function WatchingComposer({ placeholder, onTextChange, docked }: { placeholder: string; onTextChange?: (text: string) => void; docked?: boolean }) {
  const kind = useStore((s) => s.watchKind)
  const askHint = useStore((s) => s.watchHint)
  const busy = useStore((s) => s.watchBusy)
  const error = useStore((s) => s.watchError)
  const watches = useStore((s) => s.watching?.watches ?? NO_WATCHES)
  const [text, setText] = useState("")
  const [menu, setMenu] = useState<{ repos: string[]; folders: string[] } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [cursor, setCursor] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const box = useRef<ComposerHandle>(null)
  const seed = useStore((s) => s.watchSeed)
  // A target Axe couldn't reach goes back in the box, so you can fix the typo.
  useEffect(() => {
    if (!seed) return
    box.current?.setText(seed.text)
    setState({ watchSeed: null })
  }, [seed])
  // A starter, or "Which site?": the box takes the target straight away.
  useEffect(() => {
    if (kind) box.current?.focus()
  }, [kind])
  const repo = kind === "repo"
  // The Repo starter lists your GitHub repos and recent folders under the box.
  useEffect(() => {
    if (!repo) return
    setDismissed(false)
    setCursor(0)
    void invoke("watching:repos").then(setMenu)
  }, [repo])
  const q = text.trim().toLowerCase()
  const repos = (menu?.repos ?? []).filter((r) => !q || r.toLowerCase().includes(q)).slice(0, 5)
  const folders = (menu?.folders ?? []).filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 4)
  const choices: { value: string | null; label: string; icon: "branch" | "folder" }[] = [
    ...repos.map((r) => ({ value: r, label: r, icon: "branch" as const })),
    ...folders.map((f) => ({ value: f, label: f, icon: "folder" as const })),
    { value: null, label: "Choose folder…", icon: "folder" },
  ]
  const open = repo && !!menu && !dismissed && !busy && !error
  useEffect(() => {
    setState({ watchRepoMenu: open })
  }, [open])
  useEffect(() => setCursor(0), [q])
  const pick = async (c: (typeof choices)[number]) => {
    setDismissed(true)
    const target = c.value ?? (await invoke("app:pickFolder"))
    if (target) void draftWatch("repo", target)
    else setDismissed(false)
  }
  const submit = (text: string, answerer: Answerer) => {
    if (kind) return void draftWatch(kind, text)
    // "/pause @shop-web", "/summary": Watching's commands.
    const command = watchCommandOf(text)
    if (command) return void runWatchCommand(command.cmd, command.rest)
    // "@lane-ceramics.com every hour": a message to one watch goes to that watch's thread. Two or more
    // ("Pause @a and @b until Monday") change each, and Axe answers once under the composer.
    const named = namedWatches(text, watches)
    const rest = named.reduce((t, w) => t.split(`@${w.name}`).join(w.name), text).trim()
    if (named.length > 1) return void replyToMany(named, rest)
    if (named[0]) {
      void replyWithUndo(named[0].id, text.split(`@${named[0].name}`).join("").replace(/\s{2,}/g, " ").trim())
      openWatch(named[0].id)
      return
    }
    void readFreeText(text, answerer)
  }
  // Arrows move through the menu, Return picks; with nothing typed that matches, Return checks the text.
  const keys = (e: React.KeyboardEvent) => {
    if (!open) return
    const typedOnly = q && !repos.length && !folders.length
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      e.stopPropagation()
      const n = choices.length
      setCursor((c) => (c + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
    } else if (e.key === "Enter" && !e.shiftKey && !typedOnly) {
      e.preventDefault()
      e.stopPropagation()
      void pick(choices[cursor]!)
    }
  }
  return (
    <div ref={wrap} className={`relative ${composerWidth}`} onKeyDownCapture={keys}>
      <Composer
        ref={box}
        variant="start"
        hint={kind && kind !== "custom" ? (askHint ?? (ASK[kind] || placeholder)) : placeholder}
        kind={kind}
        busy={busy}
        onClearKind={() => setState({ watchKind: null, watchHint: null, watchError: null, watchErrorButton: null })}
        onEscape={kind ? () => setState({ watchKind: null, watchHint: null, watchError: null, watchErrorButton: null }) : undefined}
        onStart={(text, answerer) => submit(text, answerer)}
        watching={{}}
        onTextChange={(t) => {
          setText(t)
          onTextChange?.(t)
        }}
      />
      {/* Under the box on the empty page; above it once the box is docked at the bottom. */}
      <Popover
        open={open}
        onClose={() => setDismissed(true)}
        anchor={wrap}
        origin={docked ? "bottom left" : "top left"}
        className={`${docked ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"} left-[8px] w-[300px]! max-w-[300px]!`}
        label="Repos and folders"
      >
        {repos.length > 0 && <MenuLabel>Your repos</MenuLabel>}
        {repos.map((r, i) => (
          <MenuItem key={r} icon={<BranchIcon size={14} />} active={cursor === i} onSelect={() => void pick(choices[i]!)}>
            {r}
          </MenuItem>
        ))}
        {repos.length > 0 && <MenuLine />}
        {folders.length > 0 && <MenuLabel>Folders</MenuLabel>}
        {folders.map((f, i) => (
          <MenuItem key={f} icon={<FolderIcon size={14} />} active={cursor === repos.length + i} onSelect={() => void pick(choices[repos.length + i]!)}>
            {f}
          </MenuItem>
        ))}
        {folders.length > 0 && <MenuLine />}
        <MenuItem icon={<FolderIcon size={14} />} active={cursor === choices.length - 1} onSelect={() => void pick(choices.at(-1)!)}>
          Choose folder…
        </MenuItem>
      </Popover>
    </div>
  )
}

export function Watching() {
  const watches = useStore((s) => s.watching?.watches ?? NO_WATCHES)
  const loaded = useStore((s) => !!s.watching)
  const ask = useStore((s) => s.watchAsk)
  const offline = useOffline()
  const summary = useStore((s) => s.watching?.summary)

  // An error clears on the next keystroke: any edit in the box.
  useEffect(() => {
    // After the box has taken the keystroke: a store change mid-event would re-render it with the old text.
    const clear = () => (getState().watchError || getState().watchNote) && setTimeout(() => setState({ watchError: null, watchErrorButton: null, watchNote: null }), 0)
    window.addEventListener("input", clear, true)
    return () => window.removeEventListener("input", clear, true)
  }, [])

  const pick = (k: Kind) => setState({ watchKind: k, watchHint: null, watchAsk: null, watchError: null, watchErrorButton: null })
  const dock = (placeholder: string) => (
    <>
      <WatchingComposer placeholder={placeholder} docked />
      <Below />
    </>
  )

  if (ask)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="scroll flex min-h-0 flex-1 justify-center px-[16px]">
          <div className={`${column} flex h-max flex-col gap-[16px] pt-[24px] pb-[40px]`}>
            <ReadThread />
          </div>
        </div>
        <div className={`${composerDock} flex-col items-center gap-[8px]`}>{dock("Say what to watch")}</div>
      </div>
    )

  // No watches yet: the heading, the catalogue of everything Axe can watch, and the composer docked under it.
  if (loaded && !watches.length)
    return (
      <div className="dash flex min-h-0 flex-1 flex-col">
        <div className="scroll flex min-h-0 flex-1 justify-center">
          <div className="mx-auto flex w-full max-w-[1240px] flex-col items-center gap-[32px] px-[40px] pt-[40px] pb-[40px]">
            <StartHeading text="What should Axe watch?" />
            <Catalogue onAdd={addElement} />
          </div>
        </div>
        <div className={`${composerDock} flex-col items-center gap-[8px]`}>{dock("Say what to watch")}</div>
      </div>
    )

  // Watches: the dashboard (design "Watching redesign"), and the chat's own composer docked under it.
  return (
    <div className="dash flex min-h-0 flex-1 flex-col">
      <div className="scroll flex min-h-0 flex-1 justify-center">
        <Dashboard
          watches={watches}
          top={
            (summary || offline) && (
              <div className="flex flex-col gap-[16px]">
                {summary && <SummaryCard text={summary.text} />}
                {offline && (
                  <div role="status" className="flex items-center gap-[10px] rounded-[10px] bg-fill px-[14px] py-[10px] text-[13px] leading-[18px] text-ink-2">
                    <WifiOffIcon size={16} className="shrink-0 text-ink-3" />
                    <span>This Mac is offline. Watches pick up again when it’s back.</span>
                  </div>
                )}
              </div>
            )
          }
          bottom={
            <Catalogue onAdd={addElement} />
          }
        />
      </div>
      <div className={`${composerDock} flex-col items-center gap-[8px]`}>{dock("Watch something else")}</div>
    </div>
  )
}

/** Offline for 30 s shows the banner; back online hides it straight away. */
const OFFLINE_AFTER_MS = 30_000

function useOffline() {
  const [off, setOff] = useState(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const wait = () => {
      clearTimeout(t)
      t = setTimeout(() => setOff(!navigator.onLine), OFFLINE_AFTER_MS)
    }
    const on = () => {
      clearTimeout(t)
      setOff(false)
    }
    if (!navigator.onLine) wait()
    window.addEventListener("online", on)
    window.addEventListener("offline", wait)
    return () => {
      clearTimeout(t)
      window.removeEventListener("online", on)
      window.removeEventListener("offline", wait)
    }
  }, [])
  return off
}

/** The morning summary on top of the list: from its time until you close it, or noon. */
function SummaryCard({ text }: { text: string }) {
  return (
    <div className={`${card(false)} gap-[6px]!`} aria-label="Morning summary">
      <div className="flex items-center gap-[8px] text-[15px] leading-[22px] text-ink">
        <SunIcon size={16} className="shrink-0" />
        <span>Good morning</span>
        <button
          type="button"
          aria-label="Close summary"
          onClick={() => void closeSummary()}
          className="ml-auto flex size-[22px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-ink-3 hover:bg-fill hover:text-ink"
        >
          <XIcon size={14} />
        </button>
      </div>
      <p className="m-0 text-[15px] leading-[22px] text-ink-2">{text}</p>
    </div>
  )
}

/* New watch: the plan to confirm */

export function NewWatch({ draft }: { draft: Draft }) {
  const [saving, setSaving] = useState(false)
  const [said, setSaid] = useState<{ you: string; axe: string }[]>([])
  const start = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      await startWatch(draft)
    } finally {
      setSaving(false)
    }
  }, [draft, saving])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") openWatching()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scroll flex min-h-0 flex-1 justify-center px-[16px]">
        <div className={`${column} flex h-max flex-col gap-[16px] pt-[24px] pb-[40px]`}>
          <Bubble>{draft.asked ?? sentence(draft.kind, draft.target, draft.condition, draft.limit)}</Bubble>
          <div className="flex flex-col gap-[12px] rounded-[10px] bg-card p-[16px] shadow-card">
            <div className="flex items-center gap-[10px] text-[15px] text-ink">
              <KindTile kind={draft.kind} />
              <span className="truncate">{draft.name}</span>
            </div>
            <p className="m-0 text-[15px] leading-[22px] text-ink">{draft.plan}</p>
            {/* What the check already found, for the kinds that read their target while drafting. */}
            {(MORE as string[]).includes(draft.kind) && draft.first.rows && <CheckRows rows={draft.first.rows} />}
            {(MORE as string[]).includes(draft.kind) && !draft.first.rows && draft.first.facts && draft.first.facts.length > 1 && <Facts facts={draft.first.facts} />}
            <div className="flex flex-col">
              <Kv label="How often">
                <Select value={draft.every} label="How often" onChange={(v) => changeDraft(draft, { every: v as Every })}>
                  {(["5m", "15m", "1h", "morning"] as Every[]).map((e) => (
                    <option key={e} value={e}>
                      {EVERY_LABEL[e]}
                    </option>
                  ))}
                </Select>
              </Kv>
              <Kv label="Tell me">
                <Select value={draft.notify} label="Tell me" onChange={(v) => changeDraft(draft, { notify: v as NotifyWhen })}>
                  <option value="now">Right away</option>
                  <option value="summary">In the morning summary</option>
                </Select>
              </Kv>
              {/* A custom watch uses the model on every run, so it says which one, here only. */}
              {draft.kind === "custom" && (
                <Kv label="Runs on">
                  <ModelChip label="Runs on" value={draft.answerer ?? defaultAnswerer()} onPick={(a) => setState({ view: { kind: "newWatch", draft: { ...draft, answerer: a } } })} />
                </Kv>
              )}
            </div>
            <div className="flex items-center gap-[6px]">
              <button type="button" autoFocus disabled={saving} onClick={() => void start()} className={`${btn("pri")} ${saving ? "opacity-60" : ""}`}>
                Start watching
              </button>
            </div>
          </div>
          {said.map((s) => (
            <div key={s.you} className="flex flex-col gap-[16px]">
              <Bubble>{s.you}</Bubble>
              <p className="m-0 text-[15px] leading-[22px] text-ink">{s.axe}</p>
            </div>
          ))}
        </div>
      </div>
      <div className={composerDock}>
        <Composer
          variant="docked"
          hint="Change anything by replying"
          onStart={(text) => {
            const r = readReply(draft, text)
            if (r && (r.patch.every || r.patch.notify)) {
              changeDraft(draft, { every: r.patch.every, notify: r.patch.notify })
              setSaid((x) => [...x, { you: text, axe: "Done. The plan above is updated." }])
            } else setSaid((x) => [...x, { you: text, axe: "I can change how often it checks and when it tells you. Start watching when it looks right." }])
          }}
        />
      </div>
    </div>
  )
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[32px] grid-cols-[110px_minmax(0,1fr)] items-center gap-[10px] text-[13px] text-ink-3 [&+&]:border-t [&+&]:border-[var(--watch-line)] [&+&]:pt-[4px]">
      <span>{label}</span>
      <span className="justify-self-start text-ink">{children}</span>
    </div>
  )
}

/* One watch */

/** "That's expected" and its Undo, for this session only. */
const undoable = new Set<string>()

function SnoozeButton({ w, keys }: { w: WatchView; keys: string[] }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  // Near the bottom of the thread the menu would sit under the composer: scroll it into view.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => wrap.current?.querySelector('[role="menu"]')?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
    return () => cancelAnimationFrame(id)
  }, [open])
  return (
    <span ref={wrap} className="relative">
      <button ref={anchor} type="button" className={`${btn()} ${open ? "bg-fill-3" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Snooze
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} origin="top left" className="top-[calc(100%+4px)] left-0" label="Snooze">
        {(
          [
            ["snooze1h", "For 1 hour"],
            ["snoozeDay", "Until tomorrow"],
            ["snoozeWeek", "For a week"],
          ] as const
        ).map(([a, t]) => (
          <MenuItem
            key={a}
            onSelect={() => {
              setOpen(false)
              void actOnAll(w.id, keys, a)
            }}
          >
            {t}
          </MenuItem>
        ))}
      </Popover>
    </span>
  )
}

/** The last run that was up before `t`: "3:00 pm, 0.6 s". */
function lastUp(w: WatchView, t: number) {
  const up = [...w.strip].reverse().find((x) => x.at < t && (x.http ?? "").startsWith("2") && x.metric !== undefined)
  return up ? `${clock(up.at)}, ${(up.metric! / 1000).toFixed(1)} s` : "Not yet"
}

/**
 * A problem's card: time, headline, cause, evidence, facts, buttons. Slow draws the load-time chart;
 * down draws the last 8 hours. `closed`: a past problem opened again from its folded line, without buttons.
 */
function ProblemCard({ w, f, closed }: { w: WatchView; f: OpenFinding | PastFinding; closed?: boolean }) {
  const { agent } = useFixLabel(w)
  const checking = useStore((s) => s.watchChecking === w.id)
  const now = Date.now()
  const end = "closedAt" in f ? f.closedAt : now
  const ticks = closed ? w.strip.filter((t) => t.at <= end) : w.strip
  let evidence: React.ReactNode = null
  let facts: [string, string][] = []
  let warn = -1
  if (f.key === "slow") {
    evidence = <SpeedChart ticks={ticks} limitMs={f.ev?.limitMs} eventAt={f.ev?.eventAt} eventLabel={f.ev?.eventLabel} />
    facts = (closed ? undefined : w.latest?.facts) ?? [["Loads in", f.value ? `${(f.value / 1000).toFixed(1)} s` : ""]]
    warn = facts.findIndex(([a]) => a === "Loads in")
  } else if (f.key === "down") {
    evidence = <UpStrip ticks={ticks} every={w.every} now={end} />
    facts = [
      ["Status", f.ev?.status ?? w.latest?.http ?? "No answer"],
      ["Down for", span(end - f.openedAt)],
      ["Last up", lastUp(w, f.openedAt)],
    ]
    warn = 0
  } else if (f.ev?.record) evidence = <RecordFix r={f.ev.record} />
  else if (!closed && w.latest?.facts) facts = w.latest.facts
  const copied = "copiedAt" in f && !!f.copiedAt && !closed
  // A run after Copy record still saw it: the card says so, and Axe keeps checking hourly.
  const unchanged = copied && f.lastSeenAt > (f as OpenFinding).copiedAt!
  return (
    <div className={card(!closed)} data-testid={`problem-${f.key}`}>
      <Meta at={f.openedAt} tone={closed ? "mute" : "warn"} />
      <div className="text-[17px] leading-[24px] text-ink">{f.headline}</div>
      {f.detail && <p className="m-0 text-[15px] leading-[22px] text-ink-2">{f.detail}</p>}
      {evidence}
      <Facts facts={facts} warn={warn} />
      {copied && (
        <p className="m-0 text-[13px] leading-[20px] text-ink-3">
          {unchanged ? "The record hasn’t changed yet. I’ll check again in an hour." : "Copied. When you’ve changed it, I’ll check again. DNS can take an hour."}
        </p>
      )}
      {!closed && (
        <div className="flex flex-wrap items-center gap-[6px]">
          {f.fix === "agent" && (
            <button type="button" disabled={w.paused} className={btn("pri")} onClick={() => void fixWatch(w.id, [f.key])}>
              Fix with {agent}
            </button>
          )}
          {f.fix === "record" && f.ev?.record && !copied && (
            <button
              type="button"
              className={btn("pri")}
              onClick={() => void actOn(w.id, f.key, "copied")}
            >
              <CopyIcon size={14} />
              Copy record
            </button>
          )}
          {(f.fix === "none" || copied || (f.fix === "record" && !f.ev?.record)) && (
            <button type="button" disabled={checking} className={btn(copied ? "pri" : "sec")} onClick={() => void checkNow(w.id)}>
              {checking ? <Spin size={12} /> : <RetryIcon size={14} />}
              Check now
            </button>
          )}
          {f.key !== "down" && f.key !== "unreachable" && (
            <button
              type="button"
              className={btn()}
              onClick={() => {
                undoable.add(`${w.id}:${f.key}`)
                void actOn(w.id, f.key, "expected")
              }}
            >
              That’s expected
            </button>
          )}
          <SnoozeButton w={w} keys={[f.key]} />
        </div>
      )}
    </div>
  )
}

/** That's expected and Snooze on a repo card: they act on every alert in it. */
function RepoActs({ w, keys }: { w: WatchView; keys: string[] }) {
  return (
    <>
      <button
        type="button"
        className={btn()}
        onClick={() => {
          for (const k of keys) undoable.add(`${w.id}:${k}`)
          void actOnAll(w.id, keys, "expected")
        }}
      >
        That’s expected
      </button>
      <SnoozeButton w={w} keys={keys} />
    </>
  )
}

/** A problem folded to one line. Clicking it opens the card again, without buttons. */
function Folded({ w, f, how, text }: { w: WatchView; f: OpenFinding | PastFinding; how: "cleared" | "expected" | "open" | "fixed"; text?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Line icon={<Dot tone="mute" />} onClick={() => setOpen((o) => !o)}>
        {text ?? foldedLine(f, w.target, how)}
      </Line>
      {open && <ProblemCard w={w} f={f} closed />}
    </>
  )
}

const lines = (n = 0) => `${n} ${n === 1 ? "line" : "lines"}`
const count = (n: number) => n.toLocaleString("en-US")

/**
 * A change, in blue: page changes draw the line diff, price changes the 30-day step chart. Buttons
 * show while the card is the last thing in the thread; a change isn't a fault, so there's no Fix.
 */
function NewsCard({ w, n, acts }: { w: WatchView; n: News; acts: boolean }) {
  const ev = n.ev ?? {}
  let evidence: React.ReactNode = null
  let facts: [string, string][] = n.facts ?? []
  if (ev.diff) {
    evidence = <Diff lines={ev.diff} />
    const [a, b] = ev.words ?? [0, 0]
    facts = [
      ["Added", lines(ev.added)],
      ["Removed", lines(ev.removed)],
      ["Words", a === b ? count(b) : `${count(a)} to ${count(b)}`],
    ]
  } else if (ev.to !== undefined) {
    const latest = w.news.findLast((x) => x.ev?.to !== undefined) === n
    const now = latest ? Date.now() : n.at
    const points = (w.prices ?? []).filter(([t]) => t <= now)
    const low = Math.min(ev.to, ...points.filter(([t]) => t >= now - 30 * 86_400_000).map(([, p]) => p))
    evidence = points.length > 1 ? <PriceChart points={points} currency={ev.currency} now={now} /> : null
    facts = [
      ["Price", money(ev.to, ev.currency)],
      ["30-day low", money(low, ev.currency)],
      ["Stock", ev.stock ?? "Unknown"],
    ]
  } else if (ev.quote) {
    // Custom: the words on the page the model relied on, checked to be there.
    evidence = (
      <div className="selectable truncate rounded-[6px] bg-fill px-[12px] py-[8px] font-mono text-[12.5px] leading-[19px] whitespace-nowrap text-ink-2" title={ev.quote} data-testid="custom-quote">
        {`“${ev.quote}”`}
      </div>
    )
    facts = []
  }
  return (
    <div className={card(false)} data-testid={`news-${w.kind}`}>
      <Meta at={n.at} tone="news" />
      <div className="text-[17px] leading-[24px] text-ink">{n.headline}</div>
      {n.detail && <p className="m-0 text-[15px] leading-[22px] text-ink-2">{n.detail}</p>}
      {evidence}
      <Facts facts={facts} />
      {acts && (
        <div className="flex flex-wrap items-center gap-[6px]">
          <button type="button" className={btn()} onClick={() => void invoke("app:openExternal", urlOf(w.target))}>
            <ExternalIcon size={14} className="opacity-80" />
            Open page
          </button>
          {w.kind === "page" && !n.ignored && (
            <button type="button" className={btn()} onClick={() => void ignoreChange(w.id, n.at)}>
              Ignore changes like this
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** An earlier change, folded to one line: "Oct 19. Down to $45 from $48." Clicking opens its card. */
function FoldedNews({ w, n }: { w: WatchView; n: News }) {
  const [open, setOpen] = useState(false)
  const when = sameDay(n.at, Date.now()) ? clock(n.at) : day(n.at)
  return (
    <>
      <Line icon={<Dot tone="mute" />} onClick={() => setOpen((o) => !o)}>
        {`${when}. ${(n.line ?? n.headline).replace(/\.$/, "")}.`}
      </Line>
      {open && <NewsCard w={w} n={n} acts={false} />}
    </>
  )
}

/** Your reply (or a button you pressed) and Axe's answer, with Undo for a change made this session. */
function SaidItem({ w, s }: { w: WatchView; s: Said }) {
  return (
    <div className="flex flex-col gap-[16px]">
      {s.you && <Bubble>{s.you}</Bubble>}
      <div className="flex flex-col gap-[10px] text-[15px] leading-[22px] text-ink">
        <span>{s.axe}</span>
        {s.undone ? <span className="text-[13px] leading-[18px] text-ink-3">Undone.</span> : s.undo && saidUndo.has(`${w.id}:${s.at}`) && <Undo onClick={() => void undoSaid(w.id, s.at)} />}
      </div>
    </div>
  )
}

/**
 * Edit: four fields, each saved as it changes, no Save button. The target saves on Return or when you
 * leave the field, after the same check as creating; an error shows under it. Esc or a click outside closes.
 */
function EditPanel({ w }: { w: WatchView }) {
  const [target, setTarget] = useState(w.target)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const saved = useRef(w.target)
  const save = async () => {
    const t = target.trim()
    if (!t || t === saved.current || checking) return
    setChecking(true)
    try {
      const r = await updateWatch(w.id, { target: t })
      if (r && "error" in r) setError(r.error)
      else if (r) {
        saved.current = r.target
        setTarget(r.target)
      }
    } finally {
      setChecking(false)
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // A picker or menu inside the panel closes first.
      const inMenu = (document.activeElement as HTMLElement | null)?.closest('[role="listbox"], [role="menu"]') || document.querySelector('[aria-label="Choose who answers"]')
      if (e.key !== "Escape" || e.defaultPrevented || inMenu) return
      // Esc closes Edit first; the next one folds the watch back into the dashboard.
      e.preventDefault()
      setState({ watchEditing: false })
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])
  return (
    <div role="dialog" aria-label="Edit" className="absolute top-[-4px] left-[14px] z-20 flex w-[380px] flex-col gap-[6px] rounded-[10px] bg-pop px-[16px] py-[14px] shadow-[var(--elevation-overlay)]">
      <EditRow label="Watching">
        <input
          autoFocus
          aria-label="Watching"
          className={`selectable h-[28px] w-[240px] rounded-[6px] border-0 bg-fill px-[10px] text-[13px] text-ink outline-none ${error ? "shadow-[inset_0_0_0_1px_var(--warn)]" : "shadow-[inset_0_0_0_1px_var(--line-2)] focus:shadow-[inset_0_0_0_1px_var(--brand),0_0_0_3px_var(--brand-soft)]"}`}
          value={target}
          disabled={checking}
          onChange={(e) => {
            setTarget(e.target.value)
            setError(null)
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save()
          }}
        />
      </EditRow>
      {(error || checking) && (
        <div className={`flex items-center gap-[6px] pl-[106px] text-[12px] leading-[16px] ${error ? "text-warn" : "text-ink-3"}`} role={error ? "alert" : "status"}>
          {error ? <AlertIcon size={13} className="shrink-0" /> : <Spin />}
          <span>{error ?? `Checking ${target.trim()}…`}</span>
        </div>
      )}
      <EditRow label="How often">
        <Select value={w.every} label="How often" onChange={(v) => void updateWatch(w.id, { every: v as Every })}>
          {(["5m", "15m", "1h", "morning"] as Every[]).map((e) => (
            <option key={e} value={e}>
              {EVERY_LABEL[e]}
            </option>
          ))}
        </Select>
      </EditRow>
      <EditRow label="Tell me">
        <Select value={w.notify} label="Tell me" onChange={(v) => void updateWatch(w.id, { notify: v as NotifyWhen })}>
          <option value="now">Right away</option>
          <option value="summary">In the morning summary</option>
        </Select>
      </EditRow>
      <EditRow label="Model">
        <ModelChip value={w.answerer ?? defaultAnswerer()} onPick={(a) => void updateWatch(w.id, { answerer: a })} />
      </EditRow>
      <div className="pl-[106px] text-[12px] leading-[16px] text-ink-3">Only used when a check needs one.</div>
      {w.folder && (
        <EditRow label="Code folder">
          <span className="truncate text-[13px] text-ink">{w.folder}</span>
        </EditRow>
      )}
    </div>
  )
}

/** A row of the Edit panel: a 96 px label, then the field. */
function EditRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[32px] grid-cols-[96px_minmax(0,1fr)] items-center gap-[10px] text-[13px] text-ink-3 [&+&]:border-t [&+&]:border-[var(--watch-line)] [&+&]:pt-[4px]">
      <span>{label}</span>
      <span className="min-w-0 justify-self-start text-ink">{children}</span>
    </div>
  )
}

/** "Checking now" with the steps of a new watch's first run. */
function Live({ steps }: { steps: Step[] }) {
  return (
    <div className="flex flex-col gap-[8px]" role="status">
      <div className="flex items-center gap-[8px] text-[13px] leading-[18px] text-ink-2">
        <Dot tone="live" />
        Checking now
      </div>
      <Steps steps={steps} />
    </div>
  )
}

export function Watch({ id }: { id: string }) {
  const w = useStore((s) => s.watching?.watches.find((x) => x.id === id))
  const editing = useStore((s) => s.watchEditing)
  const fixing = useStore((s) => s.watchFix)
  const replying = useStore((s) => s.watchReplying[id])
  const end = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [, rerender] = useState(0)
  const reviewing = useStore((s) => s.review)

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [w?.strip.length, w?.said.length, w?.open.length, w?.news.length, w?.fixes.length])

  const loaded = !!w
  // Something that grows at the end (an Undo, an opened card) stays in view while you're at the bottom.
  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    let last = inner.offsetHeight
    const ro = new ResizeObserver(() => {
      const grew = inner.offsetHeight - last
      last = inner.offsetHeight
      if (grew > 0 && el.scrollHeight - el.scrollTop - el.clientHeight <= grew + 48) el.scrollTop = el.scrollHeight
    })
    ro.observe(inner)
    return () => ro.disconnect()
  }, [loaded])

  // Opening the watch reads its changes: the row's blue dot goes.
  const unread = !!w?.unread
  useEffect(() => {
    if (unread) void markSeen(id)
  }, [id, unread])

  // A notification's Fix button: start the fix once the watch shows.
  useEffect(() => {
    if (!w || fixing?.id !== w.id) return
    setState({ watchFix: null })
    const f = w.open.find((x) => x.key === fixing.key)
    // A repo's alerts are fixed together, as their card shows them.
    if (f) void fixWatch(w.id, w.kind === "repo" ? liveProblems(w, Date.now()).map((x) => x.key) : [f.key])
  }, [w, fixing])

  // Esc folds the chat back into the dashboard, unless a menu, a dialog or Edit takes it first, or you're
  // typing in a box that has words in it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (getState().watchEditing || document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]')) return
      const el = document.activeElement as HTMLElement | null
      const typed = el && (el.isContentEditable ? (el.textContent ?? "").trim() : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.trim() : "")
      if (typed) return
      openWatching()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === "r") {
        e.preventDefault()
        void checkNow(id)
      } else if (e.key === "e") {
        e.preventDefault()
        setState((s) => ({ watchEditing: !s.watchEditing }))
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [id])

  if (!w) return <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">This watch was deleted.</div>

  // While "Checking now" shows, the first result waits (page and price already ran it while validating).
  const firstRun: Run | undefined = w.steps ? undefined : (w.first ?? w.latest)
  const open = w.open.filter((f) => f.level === "problem")
  // The thread after the first result, in order: problems that closed, fixes, changes, and your replies.
  // A repo's alerts that opened or closed together read as one.
  const fixedBy = (key: string) => w.fixes.some((t) => t.keys.includes(key))
  const groups = new Map<string, PastFinding[]>()
  for (const f of w.past) {
    const g = w.kind === "repo" || f.how === "fixed" ? `${f.how}:${f.closedAt}` : `${f.how}:${f.key}:${f.openedAt}`
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  const items: { at: number; news?: boolean; node: (last: boolean) => React.ReactNode }[] = [
    ...[...groups.values()].map((fs) => {
      const f = fs[0]!
      const label = w.kind === "repo" && fs.length > 1 ? `${clock(f.openedAt)}. ${repoHeadline(fs.length, w.name)}.` : undefined
      const k = `p-${f.how}-${f.key}-${f.closedAt}`
      if (f.how === "fixed")
        return {
          at: f.closedAt,
          node: () => (
            <div key={k} className="flex flex-col gap-[16px]">
              {!fs.some((x) => fixedBy(x.key)) && <Folded w={w} f={f} how="fixed" text={label} />}
              <FixedCard w={w} found={fs} run={w.latest && w.latest.at >= f.closedAt ? w.latest : undefined} />
            </div>
          ),
        }
      if (f.how === "expected")
        return {
          at: f.openedAt,
          node: () => (
            <div key={k} className="flex flex-col gap-[10px]">
              <Folded w={w} f={f} how="expected" text={label} />
              <div className="flex flex-col gap-[10px] text-[15px] leading-[22px] text-ink">
                <span>{expectedSay(w.target, f.key, f.key === "slow" ? (w.usual?.ms ?? f.value) : undefined)}</span>
                {undoable.has(`${w.id}:${f.key}`) && w.past.findLast((x) => x.key === f.key) === f && (
                  <Undo
                    onClick={() => {
                      for (const x of fs) undoable.delete(`${w.id}:${x.key}`)
                      rerender((n) => n + 1)
                      void actOnAll(
                        w.id,
                        fs.map((x) => x.key),
                        "unexpected",
                      )
                    }}
                  />
                )}
              </div>
            </div>
          ),
        }
      return { at: f.openedAt, node: () => <Folded key={k} w={w} f={f} how="cleared" text={label} /> }
    }),
    // A fix: the problem folds to one line above it while the agent works.
    ...w.fixes.map((t, i) => {
      const first = [...w.open, ...w.past].filter((f) => t.keys.includes(f.key)).sort((a, b) => a.openedAt - b.openedAt)[0]
      return {
        at: t.at,
        node: (last: boolean) => (
          <div key={`f-${t.at}`} className="flex flex-col gap-[16px]">
            {first && <Line icon={<Dot tone="mute" />}>{`${clock(first.openedAt)}. ${t.headline.replace(/\.$/, "")}.`}</Line>}
            <FixBlock w={w} turn={t} last={last || i === w.fixes.length - 1} />
          </div>
        ),
      }
    }),
    // The latest change shows as its card; earlier ones fold to a line.
    ...w.news.map((n, i) => ({
      at: n.at,
      news: true,
      node: (last: boolean) => (i === w.news.length - 1 ? <NewsCard key={`n-${n.at}`} w={w} n={n} acts={last && !open.length} /> : <FoldedNews key={`n-${n.at}`} w={w} n={n} />),
    })),
    ...w.said.map((s) => ({ at: s.at, node: () => <SaidItem key={`s-${s.at}`} w={w} s={s} /> })),
  ].sort((a, b) => a.at - b.at)
  // Problems a fix is working on show in the fix, not as cards.
  const cards = open.filter((f) => !activeFix(w, f.key))
  const repoLive = w.kind === "repo" ? cards.filter((f) => !snoozed(f) || w.paused) : []
  const repoSnoozed = w.kind === "repo" && !w.paused ? cards.filter((f) => snoozed(f)) : []
  const working = w.fixes.findLast((t) => t.state === "working" && !!t.threadId && t.answerer.kind !== "local")
  const quietRows = !problems(w).length && w.latest && w.latest !== w.first && w.latest.at !== w.first?.at ? w.latest.rows : undefined
  const loudTimes = [...w.news.filter((n) => !n.ignored).map((n) => n.at), ...w.past.map((f) => f.openedAt)]
  const lastTick = w.strip.at(-1)
  // The watch's model can't run (not signed in, not running): say so once, with a way to pick another.
  const cantRun = w.latest?.status === "failed" && w.latest.error && /can’t run\.$/.test(w.latest.error) ? w.latest.error : null

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {editing && (
        <>
          <button type="button" aria-label="Close" className="absolute inset-0 z-10 cursor-default border-0 bg-transparent" onClick={() => setState({ watchEditing: false })} />
          <EditPanel w={w} />
        </>
      )}
      <div ref={scroller} className="scroll flex min-h-0 flex-1 justify-center px-[16px]">
        <div ref={content} className={`${column} flex h-max flex-col gap-[16px] pt-[24px] pb-[40px]`}>
          <div className="flex justify-center text-[12px] leading-[16px] text-ink-3">{day(w.createdAt)}</div>
          <Bubble>{w.asked ?? sentence(w.kind, w.target, w.condition, w.limit)}</Bubble>
          <Line icon={<EyeIcon size={14} />}>{foldedPlan(w.every, w.notify)}</Line>
          {firstRun ? (
            <div className="flex flex-col gap-[10px] text-[15px] leading-[22px] text-ink">
              <span>{firstMessage(w.kind, w.target, firstRun, w.firstEvery ?? w.every)}</span>
              {firstRun.facts && w.kind !== "custom" && <Facts facts={firstRun.facts} />}
              {firstRun.rows && <CheckRows rows={firstRun.rows} />}
            </div>
          ) : (
            <Live steps={w.steps ?? [{ label: `Loading ${w.target}`, state: "run" }]} />
          )}
          {firstRun && w.strip.length > 1 && (
            <div className="mt-[10px]">
              <Strip
                ticks={w.strip}
                kind={w.kind}
                label={stripLabel(w.strip, w.targetAt ?? w.first?.at ?? w.createdAt, { kind: w.kind, events: loudTimes, currency: w.latest?.currency })}
                right={
                  w.paused
                    ? w.pausedAt
                      ? `Paused ${sameDay(w.pausedAt, Date.now()) ? clock(w.pausedAt) : day(w.pausedAt)}`
                      : "Paused"
                    : w.every === "morning" && lastTick
                      ? sameDay(lastTick.at, Date.now())
                        ? "This morning"
                        : day(lastTick.at)
                      : lastTick && (lastTick.status === "news" || lastTick.status === "problem")
                        ? "Today"
                        : "Now"
                }
              />
            </div>
          )}
          {firstRun && quietRows && <CheckRows rows={quietRows} />}
          {items.map((x, i) => x.node(i === items.length - 1))}
          {repoLive.length > 0 && <RepoCard w={w} findings={repoLive} paused={w.paused} acts={<RepoActs w={w} keys={repoLive.map((f) => f.key)} />} />}
          {repoSnoozed.length > 0 && (
            <div className="flex flex-col gap-[10px]">
              <Folded w={w} f={repoSnoozed[0]!} how="open" text={`${clock(repoSnoozed[0]!.openedAt)}. ${repoHeadline(repoSnoozed.length, w.name)}.`} />
              <div className="flex items-baseline gap-[8px] text-[15px] leading-[22px] text-ink">
                <span>Snoozed until {when(repoSnoozed[0]!.snoozedUntil!)}.</span>
                <Undo
                  onClick={() =>
                    void actOnAll(
                      w.id,
                      repoSnoozed.map((f) => f.key),
                      "unsnooze",
                    )
                  }
                />
              </div>
            </div>
          )}
          {(w.kind === "repo" ? [] : cards).map((f) =>
            snoozed(f) && !w.paused ? (
              <div key={f.key} className="flex flex-col gap-[10px]">
                <Folded w={w} f={f} how="open" />
                <div className="flex items-baseline gap-[8px] text-[15px] leading-[22px] text-ink">
                  <span>Snoozed until {when(f.snoozedUntil!)}.</span>
                  <Undo onClick={() => void actOn(w.id, f.key, "unsnooze")} />
                </div>
              </div>
            ) : (
              <ProblemCard key={f.key} w={w} f={f} />
            ),
          )}
          {w.latest?.status === "failed" && w.failedStreak > 0 && !cantRun && <Line icon={<Dot tone="mute" />}>{`${clock(w.latest.at)}. Couldn’t check. ${w.latest.error ?? ""}`.trim()}</Line>}
          {replying && (
            <div className="flex flex-col gap-[16px]">
              <Bubble>{replying}</Bubble>
              <div className="flex items-center gap-[8px] text-[13px] leading-[18px] text-ink-3" role="status">
                <Spin />
                Thinking…
              </div>
            </div>
          )}
          {cantRun && !w.paused && (
            <div className="flex flex-wrap items-center gap-[8px] text-[15px] leading-[22px] text-ink" data-testid="model-missing">
              <span>{cantRun.replace("so this can’t run", "so this watch can’t run")} Use another model:</span>
              <ModelChip
                up
                value={w.answerer ?? defaultAnswerer()}
                onPick={(a) => {
                  void updateWatch(w.id, { answerer: a }).then(() => checkNow(w.id))
                }}
              />
            </div>
          )}
          {w.paused && (
            <Line icon={<PauseIcon size={14} />}>{w.pausedAt ? `Paused at ${sameDay(w.pausedAt, Date.now()) ? clock(w.pausedAt) : `${clock(w.pausedAt)} on ${day(w.pausedAt)}`}.` : "Paused."}</Line>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className={composerDock}>
        {w.paused ? (
          <div className={`${composerWidth} flex items-center rounded-[16px] bg-composer px-[16px] py-[10px] pr-[10px] shadow-[var(--composer-edge)]`}>
            <span className="text-[15px] text-ink-3">This watch is paused.</span>
            <button type="button" className={`${btn("pri")} ml-auto`} onClick={() => void setPaused(w.id, false)}>
              <PlayIcon size={14} className="opacity-80" />
              Resume
            </button>
          </div>
        ) : working ? (
          // While a fix works, the box talks to the agent: its folder chip, mode menu and context ring show.
          <Composer key={working.threadId} variant="docked" threadId={working.threadId} hint={`Reply to ${working.agent}`} watching={{ id: w.id }} />
        ) : (
          <Composer
            variant="docked"
            hint="Reply to change this watch"
            busy={!!replying}
            answerer={w.answerer ?? defaultAnswerer()}
            onAnswerer={(a) => void updateWatch(w.id, { answerer: a })}
            onStart={(text) => {
              const command = watchCommandOf(text)
              if (command) void runWatchCommand(command.cmd, command.rest, w.id)
              else void replyWithUndo(w.id, text)
            }}
            watching={{ id: w.id }}
          />
        )}
      </div>
      {working?.threadId && reviewing === working.threadId && (
        <div className="absolute top-0 right-0 bottom-0 z-20 flex">
          <ChangesPanel threadId={working.threadId} />
        </div>
      )}
    </div>
  )
}

/** The title row of a watch: its name and a chevron menu with every action. */
export function WatchTitle({ id }: { id: string }) {
  const w = useStore((s) => s.watching?.watches.find((x) => x.id === id))
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // The title keeps its fill while Edit is open under it.
  const editing = useStore((s) => s.watchEditing)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  if (!w) return <span className="text-[15px] text-ink">Watching</span>
  if (renaming)
    return (
      <input
        autoFocus
        defaultValue={w.name}
        className="no-drag selectable h-[30px] w-[320px] rounded-[6px] border-0 bg-fill px-[8px] text-[15px] text-ink outline-none ring-1 ring-brand"
        onBlur={(e) => {
          const name = e.target.value.trim()
          if (name && name !== w.name) void updateWatch(w.id, { name })
          setRenaming(false)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          if (e.key === "Escape") setRenaming(false)
        }}
      />
    )
  return (
    <div className="relative flex min-w-0 flex-col items-start">
      <button
        ref={anchor}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`no-drag relative left-[-8px] flex max-w-full min-w-0 cursor-pointer items-center gap-[8px] rounded-[10px] border-0 px-[8px] text-left text-[15px] leading-[20px] text-ink transition-colors duration-150 hover:bg-fill ${open || editing ? "bg-fill" : "bg-transparent"}`}
      >
        <span className="truncate">{w.name}</span>
        <ChevronDown className="shrink-0 text-ink-3" />
      </button>
      <Popover open={open} onClose={close} anchor={anchor} origin="top left" className="top-[calc(100%+4px)] left-[0px]" label={w.name}>
        <MenuItem
          icon={<RetryIcon size={14} />}
          hint="⌘R"
          onSelect={() => {
            close()
            void checkNow(w.id)
          }}
        >
          Check now
        </MenuItem>
        <MenuItem
          icon={<PencilIcon size={14} />}
          hint="⌘E"
          onSelect={() => {
            close()
            setState({ watchEditing: true })
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          icon={<TypeIcon size={14} />}
          onSelect={() => {
            close()
            setRenaming(true)
          }}
        >
          Rename
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
    </div>
  )
}

export { XIcon }
