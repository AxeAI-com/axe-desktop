import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { Answerer, Attachment, ThreadSummary } from "@shared/types"
import { liveProblems } from "@shared/watching/findings"
import { EVERY_LABEL } from "@shared/watching/schedule"
import type { RunStatus, StripTick, WatchView } from "@shared/watching/types"

import { answererLabel } from "@/lib/answerer"
import { invoke, shortcut } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"
import { defaultAnswerer, newChat, nextAnswerer, openThread, pickAnswerer, sendInThread, sendNew, stop, useStore } from "@/lib/store"
import { DICTATED, type DictatedDetail } from "@/lib/voice"
import { checkNow } from "@/lib/watching"
import { previewOf, recentChats, shortAgo, statusTone, watchLine, type Tone } from "@/lib/tray"

import { attachFiles, AttachmentTray } from "@/components/Attachments"
import { BackGlyph, ChatGlyph, ChevronGlyph, ComposeGlyph, MicGlyph, OpenGlyph, PlusGlyph, StopGlyph } from "@/components/Icons"
import { AxeMark } from "@/components/Logo"
import { ModelPicker } from "@/components/ModelPicker"
import { DictationStrip, MicButton } from "@/components/Voice"
import { clock } from "@/components/watching/Evidence"
import { KindIcon } from "@/components/WatchIcons"

// The menu bar panel (630 wide): a header, your watches with their state, the last three chats, a one-line
// field to ask from and two links into the app. A chat you open or start shows in the panel itself, under the
// same header, field and footer (TrayApp in App.tsx).

// One look for both views, like a Control Center or Wi-Fi menu: no lines, 13 pt regular, 11 pt section
// heads in the secondary colour, 30 px rows with a soft hover fill, one glyph set (24 px grid, 1.5 stroke,
// drawn at 16) and the panel's colours from the --tray-* tokens in styles.css. Every row's content starts
// 16 px in from the panel's edge: the panel's 6 px padding plus the row's 10.

const ICON = 16
const second = "text-[var(--tray-text-2)]"
const iconButton = `grid size-[26px] shrink-0 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent ${second} transition-colors duration-150 hover:bg-[var(--tray-hover)] hover:text-ink focus-visible:ring-2 focus-visible:ring-brand`
const row =
  "flex h-[30px] w-full shrink-0 cursor-pointer items-center gap-[10px] rounded-[6px] border-0 bg-transparent px-[10px] text-left text-[13px] text-ink transition-colors duration-150 hover:bg-[var(--tray-hover)] focus-visible:ring-2 focus-visible:ring-brand"
const when = `w-[76px] shrink-0 text-right text-[13px] whitespace-nowrap tabular-nums ${second}`
const textLink = "cursor-pointer border-0 bg-transparent p-0 text-[13px] text-brand-text hover:underline"

function SectionHead({ children }: { children: string }) {
  return <div className={`shrink-0 px-[10px] pt-[12px] pb-[3px] text-[11px] leading-[14px] ${second}`}>{children}</div>
}

const DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", news: "bg-brand", mute: "bg-ink-4" }
const TICK: Record<RunStatus, string> = { quiet: "bg-ok", news: "bg-brand", problem: "bg-warn", failed: "bg-ink-4" }

function StatusDot({ tone, size = 7 }: { tone: Tone; size?: number }) {
  return <i aria-hidden="true" className={`inline-block shrink-0 rounded-full ${DOT[tone]}`} style={{ width: size, height: size }} />
}

/** The header: the mark and name on the home view; Back and the chat's title while a chat is open. */
export function TrayHeader({ threadId, title }: { threadId: string | null; title?: string }) {
  return (
    <header className="flex h-[32px] shrink-0 items-center gap-[10px] px-[10px]">
      {threadId ? (
        <>
          <button aria-label="Back" title="Back" onClick={() => newChat()} className={`${iconButton} -ml-[5px]`}>
            <BackGlyph size={ICON} />
          </button>
          <span className="-ml-[5px] min-w-0 flex-1 truncate text-[13px] text-ink">{title || "New chat"}</span>
        </>
      ) : (
        <>
          {/* The mark is drawn at the name's cap height plus its overshoot, centred on the same line. */}
          <span className="grid size-[16px] shrink-0 place-items-center text-ink">
            <AxeMark size={11} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[16px] text-ink">Axe AI</span>
          <button aria-label="New chat" title="New chat" onClick={() => newChat()} className={iconButton}>
            <ComposeGlyph size={ICON} />
          </button>
        </>
      )}
      <button aria-label="Open in Axe AI" title="Open in Axe AI" onClick={() => void invoke("tray:openInMain", threadId)} className={`${iconButton} -mr-[5px] -ml-[6px]`}>
        <OpenGlyph size={ICON} />
      </button>
    </header>
  )
}

/* Watching */

function WatchBoard({ w }: { w: WatchView }) {
  const p = liveProblems(w, Date.now())
  const latest = w.latest
  const facts = latest?.facts?.slice(0, 6) ?? []
  const rows = latest?.rows?.slice(0, 6)
  const note = p[0]?.detail ?? p[0]?.note
  const ticks: StripTick[] = w.strip.slice(-48)
  const [checking, setChecking] = useState(false)
  return (
    <div className="flex flex-col gap-[10px] pt-[2px] pr-[10px] pb-[10px] pl-[36px] text-[12px]">
      <div className={`flex justify-between gap-[12px] ${second}`}>
        <span>{w.paused ? "Paused" : latest ? `Latest check at ${clock(latest.at)}` : "Not checked yet"}</span>
        <span>{`Checks ${EVERY_LABEL[w.every].toLowerCase()}`}</span>
      </div>
      {rows?.length ? (
        <div className="grid grid-cols-3 gap-x-[16px] gap-y-[6px]">
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-0 items-center gap-[6px]">
              <StatusDot tone={r.ok ? "ok" : "warn"} size={6} />
              <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
              <span className={`truncate ${r.ok ? second : "text-warn"}`}>{r.value}</span>
            </div>
          ))}
        </div>
      ) : facts.length ? (
        <div className="grid grid-cols-3 gap-x-[16px] gap-y-[6px]">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col">
              <span className={`truncate ${second}`}>{label}</span>
              <span className="truncate text-ink">{value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {note && <div className="text-ink">{note}</div>}
      {latest?.status === "failed" && latest.error && <div className="text-ink">{`Couldn’t check. ${latest.error}`}</div>}
      {ticks.length > 1 && (
        <div className="flex flex-col gap-[4px]">
          <div className="flex h-[12px] gap-[2px]" role="img" aria-label="Recent checks">
            {ticks.map((t) => (
              <span key={t.at} className={`max-w-[10px] min-w-[2px] flex-1 rounded-[2px] ${TICK[t.status]} ${t.status === "quiet" ? "opacity-60" : ""}`} />
            ))}
          </div>
          <div className={`flex justify-between text-[11px] ${second}`}>
            <span>{shortAgo(ticks[0]!.at)}</span>
            <span>Now</span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-[16px]">
        <button type="button" onClick={() => void invoke("tray:open", { watch: w.id })} className={textLink}>
          Open in Axe AI
        </button>
        {!w.paused && (
          <button
            type="button"
            disabled={checking || !!w.steps}
            onClick={() => {
              setChecking(true)
              void checkNow(w.id).finally(() => setChecking(false))
            }}
            className={`${textLink} disabled:cursor-default disabled:text-[var(--tray-text-2)] disabled:no-underline`}
          >
            {checking || w.steps ? "Checking…" : "Check now"}
          </button>
        )}
      </div>
    </div>
  )
}

function WatchRow({ w, open, onToggle }: { w: WatchView; open: boolean; onToggle: () => void }) {
  const m = useMotion()
  const tone = statusTone(w)
  const line = watchLine(w)
  const ago = w.paused ? "Paused" : w.latest ? shortAgo(w.latest.at) : ""
  return (
    <div className={`flex shrink-0 flex-col rounded-[6px] ${open ? "bg-[var(--tray-open)]" : ""}`}>
      <button type="button" aria-expanded={open} onClick={onToggle} className={row}>
        <KindIcon kind={w.kind} size={ICON} strokeWidth={1.5} className={`shrink-0 ${open ? "text-ink" : second}`} />
        <span className={`w-[180px] shrink-0 truncate ${w.paused ? second : ""}`}>{w.name}</span>
        <span className={`min-w-0 flex-1 truncate ${tone === "warn" ? "text-warn" : second}`}>{line}</span>
        <span className={when}>{ago}</span>
        <StatusDot tone={tone} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="board" {...m.collapse} className="overflow-hidden">
            <WatchBoard w={w} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const NONE: WatchView[] = []

export function TrayWatching() {
  const watches = useStore((s) => s.watching?.watches ?? NONE)
  const loaded = useStore((s) => !!s.watching)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section aria-label="Watching" className="flex min-h-0 shrink flex-col">
      <SectionHead>Watching</SectionHead>
      {watches.length ? (
        <div className="scroll flex min-h-0 flex-col overflow-y-auto">
          {watches.map((w) => (
            <WatchRow key={w.id} w={w} open={open === w.id} onToggle={() => setOpen((o) => (o === w.id ? null : w.id))} />
          ))}
        </div>
      ) : (
        loaded && (
          <div className="flex h-[30px] shrink-0 items-center gap-[12px] px-[10px] text-[13px]">
            <span className={second}>No watches yet</span>
            <button type="button" onClick={() => void invoke("tray:open", "watching")} className={textLink}>
              Start a watch
            </button>
          </div>
        )
      )}
    </section>
  )
}

/* Recent chats */

const NO_THREADS: ThreadSummary[] = []

export function TrayRecents() {
  const threads = useStore((s) => s.threads ?? NO_THREADS)
  const recent = useMemo(() => recentChats(threads), [threads])
  const messages = useStore((s) => s.messages)
  // Each row's one line: the last thing said, fetched once per chat when it isn't loaded already.
  const [fetched, setFetched] = useState<Record<string, string>>({})
  const key = recent.map((t) => `${t.id}:${t.updatedAt}`).join(",")
  useEffect(() => {
    let alive = true
    for (const t of recent) {
      if (messages[t.id]) continue
      void invoke("threads:messages", t.id)
        .then((list) => alive && setFetched((f) => ({ ...f, [t.id]: previewOf(list) })))
        .catch(() => {})
    }
    return () => {
      alive = false
    }
    // Only when the three chats change.
  }, [key])
  if (!recent.length) return null
  return (
    <section aria-label="Recent chats" className="flex shrink-0 flex-col">
      <SectionHead>Recent chats</SectionHead>
      {recent.map((t) => (
        <button key={t.id} type="button" onClick={() => void openThread(t.id)} className={row}>
          <ChatGlyph size={ICON} className={`shrink-0 ${second}`} />
          <span className="w-[180px] shrink-0 truncate">{t.title || "New chat"}</span>
          <span className={`min-w-0 flex-1 truncate ${second}`}>{messages[t.id] ? previewOf(messages[t.id]!) : (fetched[t.id] ?? "")}</span>
          <span className={when}>{shortAgo(new Date(t.updatedAt).getTime(), true)}</span>
          {/* The watch rows' dot column, so the times line up. */}
          <span aria-hidden="true" className="w-[7px] shrink-0" />
        </button>
      ))}
    </section>
  )
}

/* The field */

const fieldButton = `-my-[3px] flex h-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent ${second} transition-colors duration-150 hover:bg-[var(--tray-hover)] hover:text-ink`

/**
 * A native one-line field, the same on home and in a chat: + for files, the words, who answers as a small
 * pull-down, the mic. Return sends: a new chat on home (it opens in the panel), the next message in a chat.
 */
export function TrayComposer({ threadId = null }: { threadId?: string | null }) {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Attachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const pickerBtn = useRef<HTMLButtonElement>(null)
  const catalog = useStore((s) => s.catalog)
  const answererKey = useStore((s) => JSON.stringify(threadId ? nextAnswerer(threadId, s) : (s.draft.answerer ?? defaultAnswerer(s))))
  const answerer = useMemo(() => JSON.parse(answererKey) as Answerer, [answererKey])
  const running = useStore((s) => !!threadId && (!!s.live[threadId] || !!s.threads.find((t) => t.id === threadId)?.running))
  const label = answererLabel(answerer, catalog)
  const closePicker = useCallback(() => setPicker(false), [])

  // Grows to five lines, then scrolls.
  useEffect(() => {
    const t = area.current
    if (!t) return
    t.style.height = "18px"
    t.style.height = `${Math.min(t.scrollHeight, 90)}px`
  }, [text])

  useEffect(() => {
    const put = (e: Event) => {
      const d = (e as CustomEvent<DictatedDetail>).detail
      if (d.target !== "composer") return
      setText((t) => (t.trim() ? `${t.trimEnd()} ${d.text}` : d.text))
      area.current?.focus()
    }
    window.addEventListener(DICTATED, put)
    return () => window.removeEventListener(DICTATED, put)
  }, [])

  const add = async (get: () => Promise<Attachment[]>) => {
    try {
      const got = await get()
      setFiles((f) => [...f, ...got.filter((g) => !g.path || !f.some((x) => x.path === g.path))].slice(0, 10))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "That file couldn't be added.")
    }
    area.current?.focus()
  }

  const canSend = text.trim().length > 0 || files.length > 0
  const send = () => {
    if (!canSend || running) return
    const t = text.trim()
    const attached = files
    setText("")
    setFiles([])
    void (threadId ? sendInThread(threadId, t, attached) : sendNew(t, attached))
  }

  return (
    <div className="relative shrink-0 pt-[8px]">
      <AttachmentTray files={files} onRemove={(i) => setFiles((f) => f.filter((_, j) => j !== i))} />
      {error && <div className="px-[10px] pb-[4px] text-[12px] text-bad">{error}</div>}
      <DictationStrip target="composer" className="mb-[4px]" />
      <ModelPicker
        open={picker}
        onClose={closePicker}
        anchor={pickerBtn}
        current={answerer}
        onPick={(a) => void pickAnswerer(a, threadId ?? undefined).then((ok) => ok && setPicker(false))}
        className="right-0 bottom-[calc(100%-6px)]"
        maxHeight={560}
      />
      <div
        className="flex min-h-[32px] items-end gap-[8px] rounded-[8px] bg-[var(--tray-field)] px-[5px] py-[7px] transition-colors duration-150 focus-within:bg-[var(--tray-field-focus)]"
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          const list = Array.from(e.dataTransfer.files)
          void add(() => attachFiles(list))
        }}
      >
        <button type="button" aria-label="Add files or photos" title="Add files or photos" onClick={() => void add(() => invoke("app:pickFiles"))} className={`${fieldButton} w-[24px]`}>
          <PlusGlyph size={ICON} />
        </button>
        <textarea
          ref={area}
          rows={1}
          aria-label="Message"
          placeholder={threadId ? "Reply…" : "Ask Axe…"}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files)
            if (!pasted.length) return
            e.preventDefault()
            void add(() => attachFiles(pasted))
          }}
          className="selectable block h-[18px] min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-[13px] leading-[18px] text-ink outline-none [scrollbar-width:none] placeholder:text-[var(--tray-text-2)]"
        />
        <button
          ref={pickerBtn}
          type="button"
          aria-label={`Model: ${label}`}
          aria-haspopup="listbox"
          aria-expanded={picker}
          onClick={() => setPicker((p) => !p)}
          className={`${fieldButton} flex max-w-[180px] items-center gap-[3px] px-[6px] text-[12px] ${picker ? "bg-[var(--tray-hover)] text-ink" : ""}`}
        >
          <span className="truncate">{label}</span>
          <ChevronGlyph size={12} className="shrink-0" />
        </button>
        {running && threadId ? (
          <button type="button" aria-label="Stop" title="Stop" onClick={() => void stop(threadId)} className={`${fieldButton} w-[24px]`}>
            <StopGlyph size={ICON} />
          </button>
        ) : (
          <MicButton target="composer" size={24} icon={<MicGlyph size={ICON} />} className="-my-[3px] rounded-[5px]" />
        )}
      </div>
    </div>
  )
}

/** Open Axe AI and Settings…, like the items at the foot of a menu. */
export function TrayFooter() {
  const link = "flex h-[28px] w-full shrink-0 cursor-pointer items-center justify-between rounded-[6px] border-0 bg-transparent px-[10px] text-left text-[13px] text-ink transition-colors duration-150 hover:bg-[var(--tray-hover)]"
  const keys = `text-[13px] tabular-nums ${second}`
  return (
    <nav aria-label="Axe AI" className="flex shrink-0 flex-col pt-[6px]">
      <button type="button" onClick={() => void invoke("tray:openInMain", null)} className={link}>
        <span>Open Axe AI</span>
        <span className={keys}>{shortcut("O")}</span>
      </button>
      <button type="button" onClick={() => void invoke("tray:open", "settings")} className={link}>
        <span>Settings…</span>
        <span className={keys}>{shortcut(",")}</span>
      </button>
    </nav>
  )
}

/** The panel with no chat open: Watching and Recent chats, then the field and the footer. */
export function TrayHome() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TrayWatching />
      <TrayRecents />
      <div className="min-h-[8px] flex-1" />
    </div>
  )
}
