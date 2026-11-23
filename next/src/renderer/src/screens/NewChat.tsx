import { openWatch, openWatching } from "@/lib/watching"
import { useEffect, useMemo, useRef, useState } from "react"

import { displayAccelerator } from "@shared/accelerator"

import { agentName, folderName } from "@/lib/answerer"
import { invoke, platform } from "@/lib/bridge"
import { gettingStarted, HIDDEN_KEY, QUICK_TRIED_KEY, startedLine, type StepId } from "@/lib/getting-started"
import { openLibrary } from "@/lib/libraries"
import { problemsOf } from "@/lib/dashboard"
import { homeSections, type HomeRow } from "@/lib/home"
import { openSettingsAt } from "@/lib/shortcuts"
import { draftFolder, openThread, pickAnswerer, setMode, setResearch, setState, signIn, useStore } from "@/lib/store"
import { pickSuggestions, suggestionText, type SuggestionId } from "@/lib/suggestions"
import { pickGreeting } from "@/lib/greetings"
import { watchLine } from "@/lib/tray"

import { agentLogo, LogoTile } from "@/components/BrandLogo"
import { Composer, type ComposerHandle } from "@/components/Composer"
// The line chevron is Draft 3's, as under the composer; the rest are Solar.
import { ChevronDown } from "@/components/Icons"
import { AlertIcon } from "@/components/SolarIcons"
import { HelperMark } from "@/components/Library"
import { MenuLine, MenuRow, Popover } from "@/components/Popover"
import { AxeMark } from "@/components/Logo"

// New chat is the app's home (2026-11-08, after Claude's desktop app, Raycast and Things): one quiet
// greeting, the composer a little above the middle, four starter pills, and one quiet Getting started
// line under them (its steps open in a popover). Needs you and Working show only when they have rows.
// Follow Axe AI lives in Settings, About. Nothing animates in.

/** Today's greeting, checked every minute so it moves when the part of the day does. */
function useGreeting(name?: string) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return pickGreeting(now, name)
}

export function NewChat() {
  const name = useStore((s) => s.profile?.name)
  const agents = useStore((s) => s.catalog?.agents)
  const composer = useRef<ComposerHandle>(null)
  const hello = useGreeting(name)
  // Started from the agents library: its name instead of the greeting.
  const helper = useStore((s) => (s.draft.helperId ? s.library.helpers?.find((h) => h.id === s.draft.helperId) : undefined))

  const signedIn = useStore((s) => !!s.profile)
  const defaultModel = useStore((s) => s.catalog?.axe.defaultModelId ?? "auto")
  const folder = useStore((s) => draftFolder(s))
  const coder = agents?.find((a) => a.state === "ready")
  const ids = pickSuggestions({ signedIn, agentReady: !!coder })

  // Each pill starts the feature it names: the right answerer, mode or page, and a first line to edit.
  const asAgent = (then: () => void) => coder && void pickAnswerer({ kind: "agent", agentId: coder.id }).then((ok) => ok && then())
  const asAxe = (then: () => void) => void pickAnswerer({ kind: "axe", modelId: defaultModel }).then((ok) => ok && then())
  const write = (t: string) => composer.current?.setText(t)
  const run: Record<SuggestionId, () => void> = {
    fix: () => asAgent(() => write("Run the tests, find what's failing and fix it.")),
    plan: () =>
      asAgent(() => {
        void setMode(undefined, "plan")
        write("Plan how to ")
      }),
    research: () =>
      asAxe(() => {
        setResearch(true)
        write("Research ")
      }),
    doit: () =>
      asAxe(() => {
        setState((s) => ({ draft: { ...s.draft, doIt: true, research: false } }))
        write("Find the PDFs I downloaded this week and list them by size.")
      }),
    watch: () => openWatching(),
    skill: () => write("/"),
    install: () => openSettingsAt("clis"),
    signin: () => void signIn(),
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center px-[16px]">
      {/* Greeting, composer and pills sit a little above the middle (4 parts of free space above, 5 below).
          This block never scrolls, so the composer's menus (they open upwards) are never clipped. */}
      <div aria-hidden="true" className="min-h-[48px] flex-[4]" />
      {/* One centred column, 640 px like Draft 3: greeting, composer and its row, pills, Needs you. */}
      <div className={`flex shrink-0 flex-col items-center ${HOME}`}>
        {helper ? (
          <div className="mb-[28px] flex flex-col items-center gap-[10px]">
            <HelperMark kind={helper.kind} size={40} />
            <h1 className="m-0 text-[20px] leading-[26px] font-normal tracking-[-0.01em]">{helper.name}</h1>
            <p className="m-0 -mt-1 text-[13px] text-ink-3">{helper.role}</p>
          </div>
        ) : (
          <div className="mb-[22px]">
            <StartHeading text={hello} />
          </div>
        )}
        <div className="flex w-full flex-col items-center">
          <Composer ref={composer} variant="start" fill />
        </div>
        {!helper && (
          <div className="mt-[20px] flex w-full flex-wrap justify-center gap-[8px]">
            {ids.map((id) => (
              <button
                key={id}
                type="button"
                onClick={run[id]}
                // Draft 3's pills: 30 px, full radius, an inset hairline, ink-3; words only.
                className="inline-flex h-[30px] cursor-pointer items-center rounded-full border-0 bg-transparent px-[12px] text-[13px] text-[var(--cx-ink3)] shadow-[inset_0_0_0_1px_var(--cx-edge)] transition-colors duration-150 hover:bg-[var(--cx-hover)] hover:text-[var(--cx-ink)] focus-visible:bg-[var(--cx-hover)] focus-visible:outline-none"
              >
                {suggestionText(id, coder?.name, folder ? folderName(folder) : undefined).title}
              </button>
            ))}
          </div>
        )}
        {!helper && <GettingStarted coder={coder?.id} write={write} />}
      </div>
      <div className={`scroll min-h-0 flex-[5] overflow-y-auto pt-[32px] pb-[24px] ${HOME}`}>{!helper && <Activity />}</div>
    </div>
  )
}

/** localStorage that never throws (private windows, blocked site data). */
const stored = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) === "1"
    } catch {
      return false
    }
  },
  set: (k: string) => {
    try {
      localStorage.setItem(k, "1")
    } catch {
      // Not remembered: the card shows again next time.
    }
  },
}

const StepDone = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Done" role="img">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M5.5 8.2l1.7 1.6 3.3-3.4" />
  </svg>
)
const StepRing = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="Not done" role="img">
    <circle cx="8" cy="8" r="5.5" />
  </svg>
)

/** The home's one column (Draft 3's `.cx-col`). */
const HOME = "w-[640px] max-w-full"

/** One quiet line ("Getting started, 4 of 6 done") that opens the first steps in a popover. Gone after Hide, or when every step is done. */
function GettingStarted({ coder, write }: { coder?: string; write: (t: string) => void }) {
  const catalog = useStore((s) => s.catalog)
  const threads = useStore((s) => s.threads)
  const checks = useStore((s) => s.watching?.watches.length ?? 0)
  const connectors = useStore((s) => s.library.connectors?.connected.length ?? 0)
  const quickBarKey = useStore((s) => s.settings.quickBarKey)
  const signedIn = useStore((s) => !!s.profile)
  const [hidden, setHidden] = useState(() => stored.get(HIDDEN_KEY))
  const [quickTried, setQuickTried] = useState(() => stored.get(QUICK_TRIED_KEY))
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const line = useRef<HTMLButtonElement>(null)

  const steps = gettingStarted({
    agents: catalog?.agents,
    threads,
    checks,
    connectors,
    servers: catalog?.servers,
    quickKey: displayAccelerator(quickBarKey, platform()),
    quickTried,
    signedIn,
  })
  const done = steps.filter((s) => s.done).length
  if (hidden || done === steps.length) return null

  const local = catalog?.local[0]
  const act: Record<StepId, () => void> = {
    agent: () => openSettingsAt("clis"),
    project: () =>
      coder
        ? void pickAnswerer({ kind: "agent", agentId: coder }).then((ok) => ok && write("Look around this project and tell me what it does."))
        : openSettingsAt("clis"),
    oversight: () => openWatching(),
    connectors: () => openLibrary("connectors"),
    local: () => (local ? void pickAnswerer({ kind: "local", modelId: local.id }).then((ok) => ok && write("Hi! What can you do?")) : openSettingsAt("models")),
    quick: () => {
      void invoke("quick:toggle")
      stored.set(QUICK_TRIED_KEY)
      setQuickTried(true)
    },
    signin: () => void signIn(),
  }

  const toggle = () => {
    if (!open) {
      // Open downwards when the list fits under the line, else upwards over the composer.
      const r = line.current?.getBoundingClientRect()
      setUp(!!r && window.innerHeight - r.bottom < 72 + steps.length * 52)
    }
    setOpen(!open)
  }

  return (
    <div className="relative mt-[18px] flex justify-center">
      <button
        ref={line}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        // Draft 3: 13 px ink-4, a 12 px chevron; ink-2 and a faint fill on hover.
        className={`inline-flex cursor-pointer items-center gap-[4px] rounded-[7px] border-0 px-[8px] py-[4px] text-[13px] tabular-nums transition-colors duration-150 hover:bg-[var(--cx-hover)] hover:text-[var(--cx-ink2)] focus-visible:outline-none ${open ? "bg-[var(--cx-hover)] text-[var(--cx-ink2)]" : "bg-transparent text-[var(--cx-ink4)]"}`}
      >
        {startedLine(steps)}
        <ChevronDown size={12} />
      </button>
      <Popover
        dense
        open={open}
        onClose={() => setOpen(false)}
        anchor={line}
        role="dialog"
        label="Getting started"
        origin={up ? "bottom center" : "top center"}
        className={`left-1/2 min-w-[280px] max-w-[340px] -translate-x-1/2 ${up ? "bottom-full mb-[6px]" : "top-full mt-[6px]"}`}
      >
        {steps.map((s) => (
          <MenuRow
            key={s.id}
            icon={s.done ? <StepDone /> : <StepRing />}
            hint={s.hint}
            title={s.done ? "Done" : "Not done"}
            onSelect={() => {
              setOpen(false)
              act[s.id]()
            }}
          >
            <span className={s.done ? "text-[var(--cx-ink3)]" : ""}>{s.title}</span>
          </MenuRow>
        ))}
        <MenuLine />
        <MenuRow
          onSelect={() => {
            stored.set(HIDDEN_KEY)
            setHidden(true)
            setOpen(false)
          }}
        >
          <span className="text-[var(--cx-ink3)]">Hide</span>
        </MenuRow>
      </Popover>
    </div>
  )
}

/** Needs you and Working: each a small label and plain rows (Things' lists, Raycast's accessories). */
function Activity() {
  const threads = useStore((s) => s.threads)
  const permissions = useStore((s) => s.permissions)
  const watches = useStore((s) => s.watching?.watches)
  const sections = useMemo(() => {
    const now = Date.now()
    const waiting = new Set(permissions.map((p) => p.threadId))
    const problems = (watches ?? []).filter((w) => problemsOf(w, now).length).map((w) => ({ id: w.id, name: w.name, line: watchLine(w, now) }))
    return homeSections(threads, waiting, problems)
  }, [threads, permissions, watches])
  if (!sections.length) return null
  return (
    <div className="flex flex-col gap-[20px]">
      {sections.map((s) => (
        <section key={s.id} aria-label={s.title} className="flex flex-col">
          <h2 className="m-0 mb-[4px] px-[10px] text-[12px] leading-4 font-normal text-ink-3">{s.title}</h2>
          {s.rows.map((r) => (
            <Row key={r.kind === "thread" ? r.thread.id : `w-${r.id}`} row={r} />
          ))}
        </section>
      ))}
    </div>
  )
}

function Row({ row }: { row: HomeRow }) {
  const catalog = useStore((s) => s.catalog)
  const base =
    "group flex h-[32px] w-full items-center gap-[12px] rounded-[8px] border-0 bg-transparent px-[10px] text-left text-[13px] text-ink transition-colors duration-150 hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
  if (row.kind === "watch") {
    return (
      <button className={base} onClick={() => openWatch(row.id)}>
        <span className="flex size-[18px] shrink-0 items-center justify-center text-warn-ink">
          <AlertIcon size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate">{row.name}</span>
        <span className="max-w-[45%] shrink-0 truncate text-[12px] text-warn-ink">{row.line}</span>
      </button>
    )
  }
  const t = row.thread
  const agent = t.agentId ? catalog?.agents.find((a) => a.id === t.agentId) : undefined
  const who = t.source === "agent" && t.agentId ? (agent?.name ?? agentName(t.agentId)) : "Axe AI"
  return (
    <button className={base} onClick={() => void openThread(t.id)}>
      <span role="img" aria-label={who} title={who} className="flex shrink-0">
        {t.source === "agent" && t.agentId ? <LogoTile logo={agentLogo(agent ?? { id: t.agentId, name: who })} name={who} size={18} square /> : <LogoTile name="Axe AI" auto size={18} square />}
      </span>
      <span className="min-w-0 flex-1 truncate">{t.title}</span>
      {row.state === "waiting" ? (
        <span className="shrink-0 text-[12px] text-warn-ink">Needs your OK</span>
      ) : (
        <span className="flex shrink-0 items-center gap-[6px] text-[12px] text-ink-3">
          <span aria-hidden="true" className="size-[6px] rounded-full bg-ink-3" />
          Working
        </span>
      )}
    </button>
  )
}

/** The logo and the line on top of a start page, in the system font: regular weight, a little tight. */
export function StartHeading({ text }: { text: string }) {
  return (
    // The mark is the capitals' height and sits on the baseline, so mark and words read as one line.
    <h1 className="m-0 text-[28px] leading-[36px] font-normal tracking-[-0.02em] text-ink">
      <AxeMark size={20} className="mr-[12px] inline-block align-baseline" />
      {text}
    </h1>
  )
}
