import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type { Answerer, Attachment, ChatMessage, QuickCapture } from "@shared/types"
import { quickPlan, quickStarted } from "@shared/watching/copy"
import type { Draft, Kind } from "@shared/watching/types"

import { answererLabel, folderName, sameAnswerer } from "@/lib/answerer"
import { invoke, isMac, on } from "@/lib/bridge"
import { D, useMotion } from "@/lib/motion"
import { quickCwd, quickKeyAction, quickSlash, typedWatch, QUICK_IDLE_RESET_MS, QUICK_STARTED_MS, type QuickCommand } from "@/lib/quick"
import { segment } from "@/lib/steps"
import { defaultAnswerer, getState, openThread, plainError, sendInThread, sendNew, setState, updateSettings, useStore } from "@/lib/store"
import { cancelDictation, DICTATED, getVoice, holdDown, holdUp, type DictatedDetail } from "@/lib/voice"

import { attachFiles, AttachmentChip } from "@/components/Attachments"
import { agentLogo, BrandLogo, modelLogo } from "@/components/BrandLogo"
import { PermissionCard } from "@/components/Cards"
import { AxeMark } from "@/components/Logo"
import { CheckIcon, ChevronDown, ClipboardIcon, EyeIcon, FolderIcon, PencilIcon, PlusIcon, ScreenIcon, SendIcon } from "@/components/Icons"
import { Keycaps } from "@/components/Kit"
import { Markdown } from "@/components/Markdown"
import { StepGroup } from "@/components/StepGroup"
import { DictationStrip, MicButton } from "@/components/Voice"
import { btn, Spin } from "@/components/watching/parts"
import { KindTile } from "@/components/WatchIcons"

// The quick bar: ask from anywhere. One line to start; the answer streams under it; Enter on a
// finished answer opens it as a full chat; Esc hides it. Lives in its own small window (#quick).

type Menu = null | "add" | "who"
/**
 * /watch: Axe reads the sentence, then shows the plan inline with one button. "ask": it needs the target
 * (the kind is set) or what to watch. "started": confirmation, then the bar closes by itself.
 */
type WatchStage =
  | null
  | { s: "reading" }
  | { s: "ask"; question: string; kind?: Kind }
  | { s: "plan"; draft: Draft; text: string }
  | { s: "starting"; draft: Draft; text: string }
  | { s: "started"; draft: Draft; id: string }

const UNCLEAR = "What should I watch? A site, a page, a price or a repo."
type Choice = { id: string; label: string; note?: string; icon: ReactNode; run: () => void; section?: string }

const EMPTY: ChatMessage[] = []

export function QuickBar({ seedThread }: { seedThread?: string }) {
  const m = useMotion()
  const boot = useStore((s) => s.boot)
  const catalog = useStore((s) => s.catalog)
  const threads = useStore((s) => s.threads)
  const savedAnswerer = useStore((s) => s.settings.answerer)
  const answerer = useMemo<Answerer>(() => savedAnswerer ?? defaultAnswerer(), [savedAnswerer, catalog]) // eslint-disable-line react-hooks/exhaustive-deps
  const [cwd, setCwd] = useState<string | undefined>()
  const [threadId, setThreadId] = useState<string | null>(seedThread ?? null)
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Attachment[]>([])
  const [menu, setMenu] = useState<Menu>(null)
  const [cursor, setCursor] = useState(0)
  // The menu shows its highlight once you use the keys or the pointer, not before.
  const [nav, setNav] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [shownAt, setShownAt] = useState(0)
  const [closing, setClosing] = useState(false)
  const lastShown = useRef(Date.now())
  // /watch: the Watch chip in the box, and how far the watch has got.
  const [watching, setWatching] = useState(false)
  const [stage, setStage] = useState<WatchStage>(null)
  const [slashSel, setSlashSel] = useState(0)
  const [slashClosed, setSlashClosed] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)

  const messages = useStore((s) => (threadId ? (s.messages[threadId] ?? EMPTY) : EMPTY))
  const live = useStore((s) => (threadId ? s.live[threadId] : undefined))
  const running = useStore((s) => !!threadId && (!!s.live[threadId] || !!s.threads.find((t) => t.id === threadId)?.running))
  const permissions = useStore((s) => s.permissions)
  const mine = useMemo(() => permissions.filter((p) => p.threadId === threadId), [permissions, threadId])
  const thread = threads.find((t) => t.id === threadId)
  const busy = running || sending
  const answered = !!threadId && !busy && messages.some((x) => x.role === "assistant")
  const isAgent = answerer.kind === "agent"
  const folder = isAgent ? (cwd ?? quickCwd(threads, answerer.agentId)) : undefined
  const label = answererLabel(threadId ? (thread?.source === "agent" && thread.agentId ? { kind: "agent", agentId: thread.agentId } : answerer) : answerer, catalog)
  const where = thread?.cwd ?? folder
  // The / menu: only on a new question, and only until you pick or close it.
  const slash = !threadId && !watching && slashClosed !== text ? quickSlash(text) : null
  const slashPick = Math.min(slashSel, Math.max(0, (slash?.length ?? 1) - 1))
  const started = stage?.s === "started" ? stage : null

  // The seeded chat (screenshot tests) loads like any chat.
  useEffect(() => {
    if (seedThread && boot === "ready") void openThread(seedThread)
  }, [seedThread, boot])

  // Shown again: focus the box, play the entrance, and start fresh after a long break.
  useEffect(
    () =>
      on("quickShown", ({ at }) => {
        if (at - lastShown.current > QUICK_IDLE_RESET_MS && !running) reset()
        lastShown.current = at
        setClosing(false)
        setShownAt(at)
        setMenu(null)
        requestAnimationFrame(() => input.current?.focus())
      }),
    [running], // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    input.current?.focus()
  }, [threadId])

  // The window follows the panel's height (its layout height: the entrance scales it). The panel is
  // made anew on each show, so the observer follows it.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const fit = () => void invoke("quick:resize", el.offsetHeight)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shownAt])

  // Keep the newest words in view while the answer streams.
  useEffect(() => {
    const el = body.current
    if (el && running) el.scrollTop = el.scrollHeight
  }, [messages, running])

  // Dictated words land in the box.
  useEffect(() => {
    const put = (e: Event) => {
      const { target, text: words } = (e as CustomEvent<DictatedDetail>).detail
      if (target !== "quick") return
      setText((now) => (now.trim() ? `${now.trimEnd()} ${words}` : words))
      requestAnimationFrame(() => input.current?.focus())
    }
    window.addEventListener(DICTATED, put)
    return () => window.removeEventListener(DICTATED, put)
  }, [])

  // ⌘D (Ctrl+D) held: dictate into the bar.
  useEffect(() => {
    let held = false
    const down = (e: KeyboardEvent) => {
      if (!(isMac() ? e.metaKey : e.ctrlKey) || e.key.toLowerCase() !== "d" || e.shiftKey || e.altKey) return
      e.preventDefault()
      if (e.repeat) return
      held = true
      holdDown("quick")
    }
    const up = (e: KeyboardEvent) => {
      if (held && (e.key.toLowerCase() === "d" || e.key === "Meta" || e.key === "Control")) {
        held = false
        holdUp()
      }
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  function endWatch() {
    clearTimeout(closeTimer.current)
    setWatching(false)
    setStage(null)
  }

  function reset() {
    setThreadId(null)
    setText("")
    setFiles([])
    setProblem(null)
    setMenu(null)
    endWatch()
    requestAnimationFrame(() => input.current?.focus())
  }

  const hide = useCallback(() => {
    if (getVoice().dictation.phase !== "idle") cancelDictation()
    setMenu(null)
    if (m.reduced) {
      void invoke("quick:hide")
      return
    }
    setClosing(true)
    setTimeout(() => void invoke("quick:hide"), D.fast * 1000)
  }, [m.reduced])

  // A watch that started is done with once the bar goes: next time it opens empty.
  const hideBar = useCallback(() => {
    if (stage?.s === "started") {
      endWatch()
      setText("")
    }
    hide()
  }, [hide, stage])

  const pickCommand = (c: QuickCommand) => {
    setSlashSel(0)
    setProblem(null)
    if (c.name === "watch") {
      setWatching(true)
      setStage(null)
      setText("")
    } else setText(c.insert ?? "")
    requestAnimationFrame(() => input.current?.focus())
  }

  /** Reads the sentence as the Watching page does (your model, then the fallback), or drafts the target Axe asked for. */
  const readWatch = async (t: string) => {
    const asked = stage?.s === "ask" ? stage : null
    setProblem(null)
    setStage({ s: "reading" })
    try {
      const r = asked?.kind ? await invoke("watching:draft", { kind: asked.kind, target: t, answerer }) : await invoke("watching:read", { text: t, answerer })
      if ("plan" in r) return setStage({ s: "plan", draft: r, text: t })
      if ("error" in r) {
        setStage(asked)
        return setProblem(r.error)
      }
      // "Which site?": the chip stays and the box waits for the address.
      if (r.ask === "target") {
        setText("")
        return setStage({ s: "ask", question: r.question, kind: r.kind })
      }
      setStage({ s: "ask", question: UNCLEAR })
    } catch (e) {
      setStage(asked)
      setProblem(plainError(e))
    }
  }

  const startWatch = async (draft: Draft, t: string) => {
    setStage({ s: "starting", draft, text: t })
    try {
      const v = await invoke("watching:create", draft)
      setText("")
      setStage({ s: "started", draft, id: v.id })
      clearTimeout(closeTimer.current)
      closeTimer.current = setTimeout(() => {
        hide()
        endWatch()
      }, QUICK_STARTED_MS)
    } catch (e) {
      setStage({ s: "plan", draft, text: t })
      setProblem(plainError(e))
    }
  }

  const openStarted = () => {
    if (stage?.s !== "started") return
    void invoke("quick:openWatch", stage.id)
    endWatch()
    setText("")
  }

  /** Return with the Watch chip: a new sentence is read; the one the plan came from starts it. */
  const watchEnter = () => {
    const t = text.trim()
    if (stage?.s === "started") return openStarted()
    if (stage?.s === "plan" && t === stage.text) return void startWatch(stage.draft, t)
    if (stage?.s === "reading" || stage?.s === "starting" || !t) return
    void readWatch(t)
  }

  const openInMain = useCallback(() => {
    if (threadId) void invoke("quick:openInMain", threadId)
  }, [threadId])

  const pick = useCallback(
    async (a: Answerer) => {
      setMenu(null)
      if (a.kind === "agent" && !quickCwd(threads, a.agentId)) {
        const chosen = await invoke("app:pickFolder")
        if (!chosen) return
        setCwd(chosen)
      } else setCwd(undefined)
      void updateSettings({ answerer: a })
      input.current?.focus()
    },
    [threads],
  )

  const capture = useCallback(async (what: QuickCapture) => {
    setMenu(null)
    setProblem(null)
    try {
      const got = await invoke("quick:capture", what)
      if (got) setFiles((f) => [...f, got].slice(0, 10))
      else setProblem("Nothing is copied right now.")
    } catch (e) {
      setProblem(plainError(e))
    }
    input.current?.focus()
  }, [])

  const send = useCallback(async () => {
    const t = text.trim()
    if ((!t && !files.length) || busy) return
    // "/watch tell me if lane-ceramics.com goes down", typed in full.
    const sentence = threadId ? null : typedWatch(t)
    if (sentence !== null) {
      setWatching(true)
      setText(sentence)
      if (sentence) void readWatch(sentence)
      return
    }
    setProblem(null)
    setSending(true)
    const attached = files
    setText("")
    setFiles([])
    try {
      if (threadId) await sendInThread(threadId, t, attached)
      else {
        setState((s) => ({ draft: { ...s.draft, answerer, cwd: folder, research: false } }))
        await sendNew(t, attached)
        const v = getState().view
        if (v.kind === "thread") setThreadId(v.id)
      }
    } catch (e) {
      setText(t)
      setFiles(attached)
      setProblem(plainError(e))
    } finally {
      setSending(false)
    }
  }, [text, files, busy, threadId, answerer, folder, hide])

  const choices = useMemo<Choice[]>(() => {
    if (menu === "add")
      return [
        { id: "screen", label: "Add my screen", note: "A screenshot, without this bar", icon: <ScreenIcon size={15} />, run: () => void capture("screen") },
        { id: "clipboard", label: "Add what's copied", note: "Text or an image", icon: <ClipboardIcon size={15} />, run: () => void capture("clipboard") },
        ...(isAgent && !threadId
          ? [
              {
                id: "folder",
                label: "Work in another folder",
                note: folder ? folderName(folder) : undefined,
                icon: <FolderIcon size={15} />,
                run: () =>
                  void invoke("app:pickFolder").then((f) => {
                    setMenu(null)
                    if (f) setCwd(f)
                  }),
              },
            ]
          : []),
      ]
    if (menu === "who") {
      const models = (catalog?.axe.models ?? []).map(
        (x): Choice => ({
          id: `m-${x.id}`,
          section: "Axe AI",
          label: x.label,
          note: x.description ?? undefined,
          icon: <BrandLogo auto={x.id === "auto"} logo={modelLogo(x)} name={x.label} size={22} />,
          run: () => void pick({ kind: "axe", modelId: x.id }),
        }),
      )
      const agents = (catalog?.agents ?? [])
        .filter((a) => a.state === "ready")
        .map(
          (a): Choice => ({
            id: `a-${a.id}`,
            section: "On this computer",
            label: a.name,
            note: a.note,
            icon: <BrandLogo logo={agentLogo(a)} name={a.name} size={22} />,
            run: () => void pick({ kind: "agent", agentId: a.id }),
          }),
        )
      return [...models, ...agents]
    }
    return []
  }, [menu, catalog, isAgent, threadId, folder, capture, pick])

  useEffect(() => {
    setCursor(0)
    setNav(false)
  }, [menu])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    // The / menu: arrows, Return or Tab picks, Esc closes it.
    if (slash?.length && !menu) {
      const n = slash.length
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        return setSlashSel((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        return pickCommand(slash[slashPick]!)
      }
      if (e.key === "Escape") {
        e.preventDefault()
        return setSlashClosed(text)
      }
    }
    if (watching || started) {
      // Backspace in an empty box takes the chip off.
      if (e.key === "Backspace" && !text && !started) {
        e.preventDefault()
        return endWatch()
      }
      if (e.key === "Enter" && !e.shiftKey && !menu) {
        e.preventDefault()
        return watchEnter()
      }
      if (e.key === "Escape" && !menu && getVoice().dictation.phase === "idle") {
        e.preventDefault()
        return hideBar()
      }
    }
    const action = quickKeyAction(
      { key: e.key, mod: isMac() ? e.metaKey : e.ctrlKey, shift: e.shiftKey, composing: e.nativeEvent.isComposing },
      { menuOpen: !!menu, hasText: !!text.trim() || files.length > 0, answered, hasThread: !!threadId, dictating: getVoice().dictation.phase !== "idle" },
    )
    if (action === "none") return
    e.preventDefault()
    if (action === "menu-down" || action === "menu-up") setNav(true)
    if (action === "menu-down") setCursor((c) => Math.min(choices.length - 1, c + 1))
    else if (action === "menu-up") setCursor((c) => Math.max(0, c - 1))
    else if (action === "menu-pick") choices[cursor]?.run()
    else if (action === "menu-close") setMenu(null)
    else if (action === "send") void send()
    else if (action === "open") openInMain()
    else if (action === "stop-dictation") cancelDictation()
    else if (action === "hide") hideBar()
  }

  const enter = m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.965, y: -10, filter: "blur(10px)" }
  const content = (
    <motion.div
      key={shownAt}
      ref={panel}
      initial={enter}
      animate={closing ? (m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4, filter: "blur(4px)" }) : { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      transition={closing ? m.t(D.fast) : m.t(D.slow)}
      style={{ transformOrigin: "top center" }}
      className="flex w-[750px] max-w-full flex-col text-ink"
    >
        <>
          <div role="dialog" aria-label="Quick bar" className="flex flex-col overflow-hidden rounded-[28px] bg-pop" style={{ boxShadow: "var(--quick-shadow)" }}>
          <AnimatePresence initial={false}>
            {threadId && (
              <motion.div key="head" {...m.collapse} className="overflow-hidden">
                <div className="flex h-[64px] items-center gap-3 px-3.5">
                  <RoundButton label="New question" big onClick={reset}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20h8M16.5 3.6a2.1 2.1 0 0 1 3 3L7.5 18.6 3.5 19.5l.9-4z" />
                    </svg>
                  </RoundButton>
                  <div className="flex min-w-0 flex-1 flex-col leading-[18px]">
                    <span className="truncate text-[14px] text-ink">{thread?.title || firstQuestion(messages)}</span>
                    <span className="truncate text-[12px] text-ink-3">{where ? `${label}, in ${folderName(where)}` : label}</span>
                  </div>
                  <button
                    aria-label="Open in the window"
                    title={`Open in the window (${isMac() ? "⌘↩" : "Ctrl+Enter"})`}
                    onClick={openInMain}
                    className="flex h-9 shrink-0 items-center gap-2 rounded-full border-0 bg-fill-2 pr-2 pl-4 text-[13px] text-ink transition-colors duration-150 hover:bg-fill-3"
                  >
                    <span>Open in window</span>
                    <Keycaps keys={isMac() ? "⌘↵" : "Ctrl+Enter"} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {threadId && messages.length > 0 && (
              <motion.div key="body" {...m.collapse} className="overflow-hidden">
                <div ref={body} className="scroll max-h-[400px] px-[22px] pt-2 pb-[18px] [mask-image:linear-gradient(to_bottom,black_calc(100%-16px),transparent)]">
                  <Conversation threadId={threadId} messages={messages} liveAt={live?.startedAt} running={running} waiting={mine.length > 0} />
                  {mine.map((p) => (
                    <div key={p.id} className="pt-3">
                      <PermissionCard request={p} />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col px-[13px]">
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 px-2 pt-3.5 pb-1">
                {files.map((a, i) => (
                  <AttachmentChip key={a.path + i} a={a} onRemove={() => setFiles((f) => f.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            {started ? (
              <div className="flex h-[68px] items-center gap-[12px]">
                <span className="flex size-[42px] shrink-0 items-center justify-center text-ink">
                  <CheckIcon size={18} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[20px] text-ink">Watching {started.draft.name}</span>
              </div>
            ) : (
            <div className={`flex items-center ${threadId ? "h-[64px] gap-2.5" : "h-[68px] gap-[12px]"}`}>
              <RoundButton label="Add your screen or what's copied" big strong onClick={() => setMenu((x) => (x === "add" ? null : "add"))} on={menu === "add"}>
                <PlusIcon size={18} />
              </RoundButton>
              <div className={`flex min-w-0 flex-1 items-center rounded-full ${threadId ? "h-[42px] bg-fill px-[18px]" : "h-14"}`}>
                {watching && (
                  <span className="mr-[10px] inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-[6px] bg-brand-soft pr-[6px] pl-[8px] text-[13px] text-brand-text">
                    <EyeIcon size={14} />
                    Watch
                  </span>
                )}
                <input
                  ref={input}
                  aria-label="Ask Axe"
                  value={text}
                  autoFocus
                  placeholder={
                    watching
                      ? stage?.s === "ask" && stage.kind ? stage.question : "Say what to watch"
                      : threadId ? (answered ? "Ask a follow-up, or press Enter to open the chat" : "Ask a follow-up") : isAgent ? `What should ${label} do?` : "Ask Axe anything"
                  }
                  onChange={(e) => {
                    setText(e.target.value)
                    setProblem(null)
                    setSlashSel(0)
                  }}
                  onKeyDown={onKey}
                  onPaste={(e) => {
                    const pasted = Array.from(e.clipboardData.files)
                    if (!pasted.length) return
                    e.preventDefault()
                    void attachFiles(pasted)
                      .then((got) => setFiles((now) => [...now, ...got].slice(0, 10)))
                      .catch((err) => setProblem(plainError(err)))
                  }}
                  className={`min-w-0 flex-1 border-0 bg-transparent text-ink outline-none placeholder:text-ink-3 ${threadId ? "text-[14px]" : "text-[20px]"}`}
                />
              </div>
              {!threadId && (
                <button
                  aria-label={`Who answers: ${label}`}
                  aria-expanded={menu === "who"}
                  onClick={() => setMenu((x) => (x === "who" ? null : "who"))}
                  className="flex h-[34px] max-w-[200px] shrink-0 items-center gap-1.5 rounded-full border-0 bg-fill-4 pr-3 pl-[7px] text-[13px] text-ink transition-colors duration-150 hover:bg-fill-3"
                >
                  <AnswererLogo answerer={answerer} />
                  <span className="max-w-[140px] truncate">{label}</span>
                  {folder && <span className="max-w-[110px] truncate text-ink-3">{folderName(folder)}</span>}
                  <ChevronDown />
                </button>
              )}
              <MicButton target="quick" size={34} />
              <AnimatePresence initial={false}>
                {(text.trim() || files.length > 0) && (
                  <motion.button
                    key="send"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={m.t(D.fast)}
                    aria-label={watching ? "Send" : "Ask"}
                    disabled={busy || stage?.s === "reading" || stage?.s === "starting"}
                    onClick={() => (watching ? watchEnter() : void send())}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-accent text-white disabled:opacity-40"
                  >
                    <SendIcon />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            )}
            <DictationStrip target="quick" className="px-1.5" />
            {problem && (
              <p role="alert" className="m-0 px-2.5 pb-2.5 text-[12px] text-bad">
                {problem}
              </p>
            )}
          </div>
          {slash && slash.length > 0 && !menu && (
            <div role="listbox" aria-label="Commands" className="flex flex-col border-t border-[var(--hairline)] px-[16px] dark:border-white/6 py-[12px] text-[13px]">
              {slash.map((c, i) => (
                <div
                  key={c.name}
                  role="option"
                  aria-selected={i === slashPick}
                  onPointerMove={() => setSlashSel(i)}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    pickCommand(c)
                  }}
                  className={`flex h-[32px] cursor-default items-center gap-[10px] rounded-[6px] px-[8px] text-ink ${i === slashPick ? "bg-fill-2" : ""}`}
                >
                  <span className="text-ink-3">{c.name === "watch" ? <EyeIcon size={15} /> : <PencilIcon size={15} />}</span>
                  <span>{c.label}</span>
                  <small className="ml-auto text-[12px] text-ink-3">{c.description}</small>
                </div>
              ))}
            </div>
          )}
          {(watching || started) && stage && (
            <div className="flex flex-col gap-[10px] border-t border-[var(--hairline)] px-[16px] dark:border-white/6 py-[12px] text-[13px] leading-[18px]" aria-live="polite">
              {stage.s === "reading" && (
                <span className="flex items-center gap-[8px] text-ink-3" role="status">
                  <Spin />
                  Thinking…
                </span>
              )}
              {stage.s === "ask" && <span className="text-ink-2">{stage.question}</span>}
              {(stage.s === "plan" || stage.s === "starting") && (
                <>
                  <div className="flex items-center gap-[10px]">
                    <KindTile kind={stage.draft.kind} />
                    <span className="min-w-0 truncate text-[15px] text-ink">{stage.draft.name}</span>
                  </div>
                  <span className="text-ink-2">{quickPlan(stage.draft)}</span>
                  <div className="flex flex-wrap items-center gap-[6px]">
                    <button type="button" className={btn("pri")} disabled={stage.s === "starting"} onClick={() => void startWatch(stage.draft, stage.text)}>
                      Start watching
                    </button>
                    <span className="text-[12px] text-ink-3">Change it later in Watching.</span>
                  </div>
                </>
              )}
              {stage.s === "started" && (
                <>
                  <span className="text-ink-2">{quickStarted(stage.draft)}</span>
                  <div className="flex items-center gap-[6px]">
                    <button type="button" className={btn()} onClick={openStarted}>
                      Open
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {((slash && slash.length > 0 && !menu) || watching || started) && (
            <div className="flex h-[36px] items-center gap-[12px] border-t border-[var(--hairline)] px-[16px] dark:border-white/6 text-[12px] text-ink-3">
              <span className="truncate">{started ? "Closes in a moment" : label}</span>
              <span className="ml-auto flex shrink-0 gap-[12px]">
                <span>
                  <kbd className="rounded-[4px] bg-fill-2 px-[5px] py-px font-[inherit] text-[11.5px] text-ink-2">↵</kbd> {started ? "Open" : watching ? "Start" : "Pick"}
                </span>
                <span>
                  <kbd className="rounded-[4px] bg-fill-2 px-[5px] py-px font-[inherit] text-[11.5px] text-ink-2">esc</kbd> Close
                </span>
              </span>
            </div>
          )}
          </div>

          <AnimatePresence initial={false}>
            {menu && (
              <motion.div key={menu} {...m.collapse} className={`overflow-hidden ${menu === "who" ? "self-end" : ""}`}>
                <div
                  role="listbox"
                  aria-label={menu === "who" ? "Who answers" : "Add to your question"}
                  className={`scroll mt-[10px] max-h-[320px] rounded-[18px] bg-pop p-[8px] ${menu === "who" ? "w-[340px]" : "w-[310px]"}`}
                  style={{ boxShadow: "var(--quick-shadow)" }}
                >
                  {choices.map((c, i) => (
                    <div key={c.id}>
                      {c.section && c.section !== choices[i - 1]?.section && <div className="px-2.5 pt-2 pb-1 text-[12px] text-ink-3">{c.section}</div>}
                      <button
                        role="option"
                        aria-selected={i === cursor}
                        onMouseMove={() => {
                          setCursor(i)
                          setNav(true)
                        }}
                        onClick={c.run}
                        className={`flex min-h-[52px] w-full items-center gap-[12px] rounded-[12px] border-0 px-[10px] py-1.5 text-left leading-[18px] transition-colors duration-100 ${
                          nav && i === cursor ? "bg-fill-2" : "bg-transparent"
                        }`}
                      >
                        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-fill-3 text-white">{c.icon}</span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[14px] text-ink">{c.label}</span>
                          {c.note && <span className="truncate text-[12px] text-ink-3">{c.note}</span>}
                        </span>
                        {menu === "who" && sameAnswerer(answerer, c.id.startsWith("m-") ? { kind: "axe", modelId: c.id.slice(2) } : { kind: "agent", agentId: c.id.slice(2) }) && (
                          <span className="text-[12px] text-accent-ink">Now</span>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
    </motion.div>
  )

  return content
}

const firstQuestion = (messages: ChatMessage[]) => {
  const u = messages.find((x) => x.role === "user")
  return u?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") || "Your question"
}

function AnswererLogo({ answerer }: { answerer: Answerer }) {
  const catalog = useStore((s) => s.catalog)
  if (answerer.kind === "agent") {
    const a = catalog?.agents.find((x) => x.id === answerer.agentId)
    return <BrandLogo logo={a ? agentLogo(a) : undefined} name={a?.name ?? answerer.agentId} size={22} />
  }
  const model = catalog?.axe.models.find((x) => x.id === answerer.modelId)
  if (answerer.modelId === "auto")
    return (
      <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-brand text-white">
        <AxeMark size={11} />
      </span>
    )
  return <BrandLogo auto={answerer.modelId === "auto"} logo={model ? modelLogo(model) : undefined} name={model?.label ?? "Auto"} size={22} />
}

/** Your questions on the right, each answer under it: steps folded into one line, then the words. */
function Conversation({ threadId, messages, liveAt, running, waiting }: { threadId: string; messages: ChatMessage[]; liveAt?: number; running: boolean; waiting: boolean }) {
  const m = useMotion()
  const last = messages[messages.length - 1]
  const liveId = running && last?.role === "assistant" ? last.id : null
  const pending = running && last?.role === "user"
  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg) => {
        if (msg.role === "user") {
          const t = msg.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
          return (
            <motion.div key={msg.id} {...m.rise} className="flex flex-col items-end gap-1.5">
              {!!msg.attachments?.length && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {msg.attachments.map((a, i) => (
                    <AttachmentChip key={a.path + i} a={a} />
                  ))}
                </div>
              )}
              {t && <div className="selectable max-w-[85%] rounded-[18px] bg-fill-3 px-[18px] py-2.5 text-[16px] leading-6 text-ink">{t}</div>}
            </motion.div>
          )
        }
        const live = msg.id === liveId
        const segs = segment(msg.parts)
        return (
          <motion.div key={msg.id} {...m.rise} className="quick-answer flex flex-col gap-2.5">
            {live && segs.length === 0 && <StepGroup parts={[]} live startedAt={liveAt} waiting={waiting} />}
            {segs.map((s, i) => {
              if (s.kind === "steps") return <StepGroup key={s.id} parts={s.parts} live={live && i === segs.length - 1} startedAt={liveAt} waiting={waiting && i === segs.length - 1} />
              if (s.kind === "text") return <Markdown key={s.id} text={s.text} streaming={live && i === segs.length - 1} />
              if (s.kind === "error") return <p key={s.id} className="m-0 text-[13px] text-bad">{s.text}</p>
              return null
            })}
          </motion.div>
        )
      })}
      {pending && (
        <div className="quick-answer">
          <StepGroup parts={[]} live startedAt={liveAt} waiting={waiting} />
        </div>
      )}
      <span hidden data-thread={threadId} />
    </div>
  )
}

function RoundButton({ label, hint, onClick, on, big, strong, children }: { label: string; hint?: string; onClick: () => void; on?: boolean; big?: boolean; strong?: boolean; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center rounded-full border-0 transition-colors duration-150 ${big ? "h-[38px] w-[38px]" : "h-7 w-7"} ${
        on ? "bg-fill-3 text-ink-2" : `${strong ? "bg-fill-3" : "bg-fill-2"} text-ink-2 hover:bg-fill-4 hover:text-ink`
      }`}
    >
      {children}
    </button>
  )
}
