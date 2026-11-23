import { motion } from "motion/react"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react"

import type { Answerer, Attachment, SlashCommand } from "@shared/types"
import { KIND_LABEL } from "@shared/watching/copy"
import type { Kind, WatchView } from "@shared/watching/types"
import { commandWatch, openWatching, showSummary, watchMarkdown } from "@/lib/watching"
import { KindIcon } from "./WatchIcons"

import { answererLabel, folderName } from "@/lib/answerer"
import { invoke, inTrayWindow } from "@/lib/bridge"
import { composerWidth } from "@/lib/layout"
import { axeSkills, clearHelper, openLibrary, startWithHelper, toggleChatConnector } from "@/lib/libraries"
import { useMotion } from "@/lib/motion"
import { DICTATED, type DictatedDetail } from "@/lib/voice"
import { filterSlash, firstPick, inMenuOrder, pickedText, slashItems, slashQuery, WATCHING_COMMANDS, type SlashItem } from "@/lib/slash"
import { chatMarkdown, mentionItems, mentionQuery, replaceMention, type MentionItem } from "@/lib/mentions"
import {
  chooseFolder,
  draftFolder,
  getState,
  loadCommands,
  loadDraftCommands,
  loadInstructions,
  modeOf,
  openInstructions,
  sendInThread,
  sendNew,
  setCopy,
  setMode,
  setResearch,
  setState,
  stop,
  useStore,
} from "@/lib/store"

import { attachFiles, AttachmentTray } from "./Attachments"
import { AnswererPicker, useAnswerer } from "./AnswererPicker"
import { boxButton, Switch, underControl, underText } from "./Kit"
import { ChevronDown as LineChevron, FolderIcon as LineFolderIcon, MagicIcon } from "./Icons"
import { BranchIcon, FileIcon, GlobeIcon, MonitorIcon, PaperclipIcon, PlugIcon, SearchIcon, TelescopeIcon, XIcon } from "./SolarIcons"
import { ConnectorLogo, HelperMark } from "./Library"
import { ModeMenu, nextMode } from "./ModeMenu"
import { MentionMenu, mentionOrder } from "./MentionMenu"
import { MenuItem, MenuLabel, MenuLine, MenuRow, Popover } from "./Popover"
import { PromptInput } from "./ai/prompt-input"
import { SlashMenu } from "./SlashMenu"
import { UsageRing } from "./UsageRing"
import { DictationStrip, MicButton } from "./Voice"

const NO_COMMANDS: never[] = []
const NO_IDS: string[] = []
const NO_WATCHES: WatchView[] = []
const ONLY_CHATS = "This model can only chat. Pick one that can use tools, like Qwen 2.5, for Do it and connectors."

export type ComposerHandle = { focus: () => void; setText: (t: string) => void }

/**
 * Where you write. "start" is the two-line box on a new chat; "docked" is the one-line box under a
 * chat, with its tools underneath and Stop while it works.
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    variant: "start" | "docked"
    threadId?: string
    /** Starts something other than a plain new chat (a page's own chat); the box looks the same. */
    onStart?: (text: string, answerer: Answerer) => void
    /** The words in an empty box when `onStart` is set. */
    hint?: string
    /** Watching: the starter's chip in the text row; × or Backspace in an empty box clears it. */
    kind?: Kind | null
    onClearKind?: () => void
    /** Watching: the target is being checked. */
    busy?: boolean
    /** Watching: Esc in the box (back from a starter). */
    onEscape?: () => void
    /** Watching: told whenever the words in the box change (the starters show only while it's empty). */
    onTextChange?: (text: string) => void
    /** A watch's thread: the watch's own model shows in the picker, and picking one changes the watch. */
    answerer?: Answerer
    onAnswerer?: (a: Answerer) => void
    /**
     * Watching's / menu: its commands first (and, in a fix turn, the agent's). `id`: a watch's thread,
     * where /check, /pause and /resume apply to that watch straight away.
     */
    watching?: { id?: string }
    /** Fill the parent's width instead of the 768 px column (Oversight lines it up with its tiles). */
    fill?: boolean
  }
>(function Composer({ variant, threadId, onStart, hint, kind, onClearKind, busy, onEscape, onTextChange, answerer: ownAnswerer, onAnswerer, watching, fill }, handle) {
  const [text, setText] = useState("")
  useEffect(() => onTextChange?.(text), [text, onTextChange])
  const [plus, setPlus] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const folderBtn = useRef<HTMLButtonElement>(null)
  const closeFolder = useCallback(() => setFolderOpen(false), [])
  // The + menu opens above the box, or below it when the window has no room above (New chat sits high).
  const [plusBelow, setPlusBelow] = useState(false)
  const [files, setFiles] = useState<Attachment[]>([])
  const [dropping, setDropping] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const plusBtn = useRef<HTMLButtonElement>(null)
  const m = useMotion()

  const catalog = useStore((s) => s.catalog)
  const draft = useStore((s) => s.draft)
  const thread = useStore((s) => (threadId ? s.threads.find((t) => t.id === threadId) : undefined))
  const running = useStore((s) => (threadId ? !!s.live[threadId] || !!thread?.running : false))
  const answerer = useAnswerer(threadId, ownAnswerer)
  const isAgent = answerer.kind === "agent"
  // A model on a local server: no web search or research (those are axeai.com's). With tools it gets Do it
  // and connectors like an Axe model; one that can't use tools only chats.
  const isLocal = answerer.kind === "local"
  const isAxe = answerer.kind === "axe"
  const label = answererLabel(answerer, catalog)
  const model = answerer.kind === "axe" ? catalog?.axe.models.find((x) => x.id === answerer.modelId) : undefined
  const localModel = answerer.kind === "local" ? catalog?.local.find((x) => x.id === answerer.modelId) : undefined
  // Unknown (a server that doesn't say) counts as yes: Axe tries, and remembers a no.
  const localTools = isLocal && localModel?.tools !== false
  const usesTools = isAxe || localTools
  const onlyChats = isLocal && !localTools
  const warming = useStore((s) => answerer.kind === "local" && s.warming === answerer.modelId)
  // Research needs a model that can use tools (the same flag as web search).
  const canResearch = isAxe && (model?.webSearch ?? true)
  const researching = canResearch && draft.research
  const commandsKey = threadId ?? "draft"
  const agentCommands = useStore((s) => (isAgent ? (s.commands[commandsKey] ?? NO_COMMANDS) : NO_COMMANDS))
  const instructions = useStore((s) => (threadId ? s.instructions[threadId] : undefined))
  // Skills installed in Axe: Axe models get their instructions; a CLI that hasn't got one gets them too.
  const skillLib = useStore((s) => s.library.skills)
  const helpers = useStore((s) => s.library.helpers)
  const offSkills = useStore((s) => s.settings.offSkills)
  const ownSkills = useMemo<SlashCommand[]>(
    () => axeSkills(skillLib, offSkills ?? []).map((k) => ({ name: k.id, description: k.description, source: "skill" })),
    [skillLib, offSkills],
  )
  const connected = useStore((s) => s.library.connectors?.connected)
  const chatConnectors = useStore((s) => (threadId ? thread?.connectors : s.draft.connectors)) ?? NO_IDS
  const helper = useStore((s) => (!threadId && s.draft.helperId ? s.library.helpers?.find((h) => h.id === s.draft.helperId) : undefined))
  const [slashSel, setSlashSel] = useState<number | null>(null)
  // The @ menu: where the cursor is, what it found, which row is picked, and the text it was closed on.
  const [caret, setCaret] = useState(0)
  const [mentionSel, setMentionSel] = useState(0)
  const [mentionClosed, setMentionClosed] = useState<string | null>(null)
  const [folderHits, setFolderHits] = useState<{ path: string; display: string }[]>([])
  const [macApps, setMacApps] = useState<string[]>([])
  const threads = useStore((s) => s.threads)
  const watches = useStore((s) => s.watching?.watches ?? NO_WATCHES)
  const [slashClosed, setSlashClosed] = useState<string | null>(null)
  const mode = useStore((s) => modeOf(threadId, s))

  useImperativeHandle(handle, () => ({
    focus: () => area.current?.focus(),
    setText: (t: string) => {
      setText(t)
      requestAnimationFrame(() => {
        const el = area.current
        if (!el) return
        el.focus()
        el.setSelectionRange(t.length, t.length)
      })
    },
  }))

  // Grow with the text, up to a point.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text, variant])

  useEffect(() => {
    area.current?.focus()
  }, [threadId])

  // The agent's / commands: from its session once it runs, from its skill folders before that.
  const draftCwd = useStore((s) => draftFolder(s))
  const agentId = answerer.kind === "agent" ? answerer.agentId : undefined
  useEffect(() => {
    if (!agentId) return
    if (threadId) void loadCommands(threadId)
    else if (draftCwd) void loadDraftCommands(agentId, draftCwd)
  }, [agentId, threadId, draftCwd])

  const query = slashQuery(text)
  const slashOpen = query !== null && slashClosed !== text
  const onWatching = !!watching
  const slashList = useMemo(() => {
    if (query === null) return []
    // Watching: its own commands; a fix turn (an agent's chat) adds the agent's commands and skills.
    const all = onWatching
      ? [...WATCHING_COMMANDS, ...(threadId && isAgent ? slashItems(agentCommands, true, ownSkills).filter((i) => i.source === "agent" || i.source === "skill") : [])]
      : slashItems(agentCommands, isAgent, ownSkills, threadId ? [] : (helpers ?? []))
    return inMenuOrder(filterSlash(all, query))
  }, [query, agentCommands, isAgent, ownSkills, helpers, threadId, onWatching])
  const watchIdRef = useRef(watching?.id)
  watchIdRef.current = watching?.id
  // Until you move, the first command whose name starts with what you typed is picked.
  const sel = Math.min(slashSel ?? firstPick(slashList, query ?? ""), Math.max(0, slashList.length - 1))
  const pickSlash = useCallback((item: SlashItem) => {
    // /summary shows the card; in a watch's thread the others apply to it now.
    const watchId = watchIdRef.current
    if (item.watch === "summary" || (item.watch && watchId)) {
      setText("")
      setSlashSel(null)
      if (item.watch === "summary") void showSummary()
      else if (watchId) void commandWatch(item.watch!, watchId)
      return
    }
    if (item.action === "helper") {
      // A new chat with that agent: its name takes the greeting's place.
      const h = getState().library.helpers?.find((x) => x.id === item.helperId)
      setText("")
      if (h) startWithHelper(h)
      return
    }
    if (item.action === "research") setResearch(true)
    if (item.action === "open" && item.opens) {
      setText("")
      openLibrary(item.opens)
      return
    }
    const next = pickedText(item)
    setText(next)
    setSlashSel(null)
    requestAnimationFrame(() => {
      const el = area.current
      el?.focus()
      // To the end of what's there now: you may already have typed on.
      el?.setSelectionRange(el.value.length, el.value.length)
      // "/pause @" opens the @ list of watches.
      if (el) setCaret(el.value.length)
    })
  }, [])

  // @: folders, apps and chats. Lists come in as you type; nothing is read before the first @.
  const mention = slashOpen ? null : mentionQuery(text, caret)
  const mentionOpen = !!mention && mentionClosed !== text
  const mentionText = mention?.query
  const recentFolders = useMemo(
    () => [...new Set(threads.filter((t) => t.source === "agent" && t.cwd).map((t) => t.copy?.source ?? t.cwd!))],
    [threads],
  )
  useEffect(() => {
    if (mentionText === undefined) return
    let live = true
    void invoke("mention:folders", mentionText, recentFolders)
      .then((hits) => live && setFolderHits(hits))
      .catch(() => live && setFolderHits([]))
    return () => {
      live = false
    }
  }, [mentionText, recentFolders])
  const wantApps = mentionText !== undefined
  useEffect(() => {
    if (wantApps && !macApps.length) void invoke("mention:apps").then(setMacApps, () => {})
  }, [wantApps, macApps.length])
  const mentionList = useMemo(
    () =>
      mentionText === undefined
        ? []
        : mentionOrder(
            mentionItems(mentionText, {
              folders: folderHits,
              connectors: (connected ?? []).filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name })),
              apps: macApps,
              threads: threads.filter((t) => t.id !== threadId),
              watches: watches.map((w) => ({ id: w.id, name: w.name, kind: w.kind, label: KIND_LABEL[w.kind] })),
            }),
            !!onStart,
          ),
    [mentionText, folderHits, connected, macApps, threads, threadId, watches, onStart],
  )
  const mSel = Math.min(mentionSel, Math.max(0, mentionList.length - 1))

  const putText = (next: string, at: number) => {
    setText(next)
    requestAnimationFrame(() => {
      const el = area.current
      // Typing on before this frame (a fast "@saf⏎ and @…") already moved the caret: leave it, or the next
      // Enter would send instead of picking.
      if (!el || el.value !== next) return
      el.focus()
      el.setSelectionRange(at, at)
      setCaret(at)
    })
  }

  const pickMention = (item: MentionItem) => {
    if (!mention) return
    const end = mention.at + 1 + mention.query.length
    setMentionSel(0)
    // A new agent chat takes the folder as the one it works in.
    if (item.kind === "folder" && !threadId && isAgent && !draft.cwd) {
      setState((s) => ({ draft: { ...s.draft, cwd: item.value } }))
      putText(replaceMention(text, mention.at, end, ""), mention.at)
      return
    }
    if (item.kind === "chat") {
      const title = item.label
      putText(replaceMention(text, mention.at, end, ""), mention.at)
      add(async () => {
        const messages = await invoke("threads:messages", item.value)
        const name = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "Chat"}.md`
        return [await invoke("app:attachBytes", name, "text/markdown", new TextEncoder().encode(chatMarkdown(title, messages)))]
      })
      return
    }
    // In a chat, a watch comes with its latest result and open problems, attached like a file.
    if (item.kind === "watch" && !onStart) {
      const w = getState().watching?.watches.find((x) => x.id === item.value)
      if (w) add(async () => [await invoke("app:attachBytes", `${w.name.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "Check"}.md`, "text/markdown", new TextEncoder().encode(watchMarkdown(w)))])
    }
    if (item.kind === "connector" && usesTools && !chatConnectors.includes(item.value)) void toggleChatConnector(item.value, threadId)
    const word = `@${item.kind === "folder" ? (item.detail ?? item.value) : item.label} `
    putText(replaceMention(text, mention.at, end, word), mention.at + word.length)
  }

  // ⌘U and ⌘L reach whichever composer is on screen.
  useEffect(() => {
    const focus = () => area.current?.focus()
    const attach = () => pickFilesRef.current()
    // Rewind puts the message you went back to here, to send again or change.
    const put = (e: Event) => {
      const t = String((e as CustomEvent).detail ?? "")
      setText(t)
      requestAnimationFrame(() => {
        area.current?.focus()
        area.current?.setSelectionRange(t.length, t.length)
      })
    }
    window.addEventListener("axe:composer-focus", focus)
    window.addEventListener("axe:composer-attach", attach)
    window.addEventListener("axe:composer-text", put)
    return () => {
      window.removeEventListener("axe:composer-focus", focus)
      window.removeEventListener("axe:composer-attach", attach)
      window.removeEventListener("axe:composer-text", put)
    }
  }, [])

  // Dictated words go where the cursor is.
  useEffect(() => {
    const put = (e: Event) => {
      const { target, text: words } = (e as CustomEvent<DictatedDetail>).detail
      if (target !== "composer") return
      const el = area.current
      setText((now) => {
        const at = el && document.activeElement === el ? el.selectionStart : now.length
        const before = now.slice(0, at)
        const after = now.slice(at)
        const spaced = `${before && !/\s$/.test(before) ? " " : ""}${words}${after && !/^\s/.test(after) ? " " : ""}`
        const next = before + spaced + after
        requestAnimationFrame(() => {
          el?.focus()
          el?.setSelectionRange(before.length + spaced.length, before.length + spaced.length)
        })
        return next
      })
    }
    window.addEventListener(DICTATED, put)
    return () => window.removeEventListener(DICTATED, put)
  }, [])

  const canSend = (text.trim().length > 0 || files.length > 0) && !running && !busy
  // Files still being added (a big paste, a slow disk) go with the message: sending waits for them.
  const adding = useRef<Promise<void> | null>(null)
  const filesNow = useRef(files)
  filesNow.current = files
  const send = useCallback(async () => {
    if (adding.current) await adding.current
    const t = text.trim()
    const attached = filesNow.current
    if ((!t && !attached.length) || running) return
    // Watching's target ask keeps the address: an error under the box says what to fix in it.
    if (!(onStart && kind)) setText("")
    setFiles([])
    setFileError(null)
    if (threadId) void sendInThread(threadId, t, attached)
    else if (onStart) onStart(t, answerer)
    else void sendNew(t, attached)
  }, [text, running, threadId, onStart, answerer, kind])

  const add = useCallback((get: () => Promise<Attachment[]>) => {
    const job = (async () => {
      try {
        const got = await get()
        if (got.length) {
          // The same file twice is one file.
          const fresh = got.filter((g) => !g.path || !filesNow.current.some((f) => f.path === g.path))
          filesNow.current = [...filesNow.current, ...fresh].slice(0, 10)
          setFiles(filesNow.current)
        }
        setFileError(null)
      } catch (e) {
        setFileError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "That file couldn't be added.")
      }
    })()
    adding.current = job
    void job.finally(() => {
      if (adding.current === job) adding.current = null
      area.current?.focus()
    })
  }, [])
  const pickFiles = () => add(() => invoke("app:pickFiles"))
  const pickFilesRef = useRef(pickFiles)
  pickFilesRef.current = pickFiles

  // Files dragged anywhere onto the composer, and screenshots pasted into it.
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return
      e.preventDefault()
      setDropping(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      setDropping(false)
      const list = Array.from(e.dataTransfer.files)
      add(() => attachFiles(list))
    },
  }
  const tray = (
    <>
      <AttachmentTray files={files} onRemove={(i) => setFiles((f) => (filesNow.current = f.filter((_, j) => j !== i)))} />
      {fileError && <div className="px-1 pt-1 text-[12px] text-bad">{fileError}</div>}
      {isLocal && localModel?.vision === false && files.some((f) => f.mime.startsWith("image/")) && (
        <div className="px-1 pt-1 text-[12px] text-ink-3">{label} can't see photos. It gets their names only.</div>
      )}
    </>
  )

  const closePlus = useCallback(() => setPlus(false), [])

  const _doIt = usesTools && draft.doIt
  // A page's own words win (Watching's "Reply to Claude Code" on a fix's session too).
  const placeholder = hint
    ? hint
    : researching
    ? "What should Axe research?"
    : isAgent && threadId && mode === "plan"
      ? "Say what to change in the plan"
    : variant === "start"
      ? helper
        ? `Ask ${helper.name}`
        : "Describe a task or ask a question"
      : "Reply"

  // Keys the / menu and the mode switch take before the box sends on Enter.
  const onKeyDownCapture = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const take = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (kind && onClearKind && e.key === "Backspace" && !text) {
      take()
      onClearKind()
      return
    }
    if (onEscape && e.key === "Escape" && !slashOpen && !mentionOpen) {
      take()
      onEscape()
      return
    }
    if (slashOpen && slashList.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        take()
        const n = slashList.length
        setSlashSel((sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
        return
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        take()
        pickSlash(slashList[sel]!)
        return
      }
    }
    if (mentionOpen && mentionList.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        take()
        const n = mentionList.length
        setMentionSel((mSel + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
        return
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        take()
        pickMention(mentionList[mSel]!)
        return
      }
    }
    if (mentionOpen && e.key === "Escape") {
      take()
      setMentionClosed(text)
      return
    }
    if (isAgent && e.key === "Tab" && e.shiftKey) {
      take()
      void setMode(threadId, nextMode(mode))
      return
    }
    if (slashOpen && e.key === "Escape") {
      take()
      setSlashClosed(text)
    }
  }

  // The website's round controls in the box's bottom row.
  const _control =
    "inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-ink-3 transition-[color,background-color,scale] duration-150 hover:bg-fill-2 hover:text-ink active:scale-[0.97] disabled:opacity-40"

  // Who answers: the one picker, on the right under the box (2026-11-08). Any chat can switch to any of Axe's
  // models or CLIs; the next one gets the earlier turns as context. On New chat a pick becomes the default.
  const modelButton = <AnswererPicker place="above" threadId={threadId} answerer={ownAnswerer} onAnswerer={onAnswerer} />
  // An Ollama model loads into memory once picked; the first reply waits for it.
  // A local model without tools says so where Do it would be.
  const chatOnlyNote = onlyChats && (
    <span title={ONLY_CHATS} className="shrink-0 truncate px-[6px] text-[12px] text-ink-3">
      This model can only chat
    </span>
  )
  const loadingNote = warming && (
    <span role="status" className="flex shrink-0 items-center gap-[6px] px-[6px] text-[12px] text-ink-3">
      <span aria-hidden="true" className="block size-[10px] animate-spin rounded-full border-[1.5px] border-line-3 border-t-ink-2" />
      Loading model
    </span>
  )

  const cwd = threadId ? thread?.cwd : draftCwd
  // A chat in its own copy names the folder it came from, with the branch it works on.
  const copy = threadId ? thread?.copy : undefined
  const copying = threadId ? !!copy : draft.copy
  // The folder, under the box. A new chat picks it (the folder dialog); a chat's folder can't change, so it is
  // plain text there, with no chevron and no hover.
  const folderLabel = cwd ? (copy ? folderName(copy.source) : folderName(cwd)) : ""
  const folderTitle = cwd ? (copy ? `${copy.branch ? `Branch ${copy.branch} in ` : "A copy in "}${cwd}` : cwd) : undefined
  const copyWord = <span className="shrink-0 text-ink-4">{copy?.kind === "copy" ? "copy" : "worktree"}</span>
  const folderChip = !isAgent ? null : threadId ? (
    cwd && (
      <span title={folderTitle} className={underText}>
        {copying ? <BranchIcon size={14} /> : <LineFolderIcon size={14} />}
        <span className="truncate">{folderLabel}</span>
        {copying && copyWord}
      </span>
    )
  ) : (
    <div className="relative min-w-0">
      <button ref={folderBtn} type="button" aria-haspopup="menu" aria-expanded={folderOpen} onClick={() => setFolderOpen((o) => !o)} title={folderTitle} className={underControl(folderOpen)}>
        {copying ? <BranchIcon size={14} /> : <LineFolderIcon size={14} />}
        <span className="truncate">{cwd ? folderLabel : "Choose a folder"}</span>
        {copying && copyWord}
        <LineChevron size={12} className="shrink-0 opacity-70" />
      </button>
      {/* Draft 3's folder menu: recent folders, Choose a folder…, and Work in a copy. */}
      <Popover open={folderOpen} onClose={closeFolder} anchor={folderBtn} origin="bottom left" className="bottom-[calc(100%+6px)] left-0" label="Folder">
        {recentFolders.length > 0 && <MenuLabel>Recent folders</MenuLabel>}
        {recentFolders.slice(0, 4).map((f) => (
          <MenuRow
            key={f}
            role="menuitemradio"
            checked={f === cwd}
            title={f}
            icon={<LineFolderIcon size={14} />}
            onSelect={() => {
              closeFolder()
              setState((st) => ({ draft: { ...st.draft, cwd: f } }))
            }}
          >
            {folderName(f)}
          </MenuRow>
        ))}
        <MenuRow
          icon={<span className="text-[13px] leading-none">…</span>}
          onSelect={() => {
            closeFolder()
            void chooseFolder()
          }}
        >
          Choose a folder…
        </MenuRow>
        <MenuLine />
        <MenuRow role="menuitemradio" checked={!!draft.copy} onSelect={() => setCopy(!draft.copy)}>
          Work in a copy (worktree)
        </MenuRow>
      </Popover>
    </div>
  )
  const modeMenu = isAgent && <ModeMenu threadId={threadId} size="docked" />

  const plusMenu = (
    <Popover dense open={plus} onClose={closePlus} anchor={plusBtn} origin={plusBelow ? "top left" : "bottom left"} className={`min-w-[220px] max-w-[280px] ${plusBelow ? "top-[calc(100%+4px)] left-0" : "bottom-[calc(100%+8px)] left-0"}`} label="Add">
      <MenuItem
        icon={<PaperclipIcon size={14} />}
        onSelect={() => {
          closePlus()
          pickFiles()
        }}
      >
        Add files or photos
      </MenuItem>
      <MenuLine />
      <MenuLabel>Add a check</MenuLabel>
      {(["uptime", "page", "price", "security"] as const).map((k) => (
        <MenuItem
          key={k}
          icon={<KindIcon kind={k} size={14} />}
          onSelect={() => {
            closePlus()
            openWatching(k)
          }}
        >
          {KIND_LABEL[k]}
        </MenuItem>
      ))}
      <MenuItem
        icon={<span className="text-[13px] leading-none">⋯</span>}
        onSelect={() => {
          closePlus()
          openWatching()
        }}
      >
        More checks
      </MenuItem>
      {/* An agent's folder and copy live in the folder menu under the box (Draft 3). */}
      {!onStart && !isAgent && <MenuLine />}
      {/* Watching: files, the checks and connectors only, whatever the model. */}
      {!onStart && (isAgent ? null : isLocal ? (
        <MenuItem
          icon={<MonitorIcon size={14} />}
          hint={onlyChats ? "Not with this model" : <Switch on={!!draft.doIt} />}
          disabled={onlyChats}
          title={onlyChats ? ONLY_CHATS : undefined}
          onSelect={() => {
            closePlus()
            setState((s) => ({ draft: { ...s.draft, doIt: !s.draft.doIt } }))
          }}
        >
          Do it
        </MenuItem>
      ) : (
        <>
          <MenuItem
            icon={<GlobeIcon size={14} />}
            hint={<Switch on={!!draft.webSearch && !researching} />}
            onSelect={() => setState((s) => ({ draft: { ...s.draft, webSearch: !s.draft.webSearch } }))}
          >
            Search the web
          </MenuItem>
          <MenuItem
            icon={<MonitorIcon size={14} />}
            hint={<Switch on={!!draft.doIt} />}
            onSelect={() => {
              closePlus()
              setState((s) => ({ draft: { ...s.draft, doIt: !s.draft.doIt, research: s.draft.doIt ? s.draft.research : false } }))
            }}
          >
            Do it
          </MenuItem>
          <MenuItem
            icon={<SearchIcon size={14} />}
            hint={!canResearch ? "Not with this model" : <Switch on={researching} />}
            onSelect={() => {
              if (!canResearch) return
              setResearch(!draft.research)
              closePlus()
            }}
          >
            Research
          </MenuItem>
        </>
      ))}
      <MenuLine />
      {isAgent || onStart ? (
        <MenuItem
          icon={<PlugIcon size={14} />}
          hint={connected?.some((c) => c.enabled) ? `${connected.filter((c) => c.enabled).length} on` : undefined}
          onSelect={() => {
            closePlus()
            openLibrary("connectors")
          }}
        >
          Connectors
        </MenuItem>
      ) : connected?.some((c) => c.enabled) ? (
        <>
          <MenuLabel>Connectors</MenuLabel>
          {connected
            .filter((c) => c.enabled)
            .map((c) => (
              <MenuItem
                key={c.id}
                icon={<ConnectorLogo catalogId={c.catalogId} name={c.name} size={14} />}
                hint={onlyChats ? "Not with this model" : <Switch on={chatConnectors.includes(c.id)} />}
                disabled={onlyChats}
                title={onlyChats ? ONLY_CHATS : undefined}
                onSelect={() => void toggleChatConnector(c.id, threadId)}
              >
                {c.name}
              </MenuItem>
            ))}
        </>
      ) : (
        <MenuItem
          icon={<PlugIcon size={14} />}
          onSelect={() => {
            closePlus()
            openLibrary("connectors")
          }}
        >
          Connect your apps
        </MenuItem>
      )}
      {isAgent && threadId && !!instructions?.length && (
        <>
          <MenuLine />
          {instructions.map((f) => (
            <MenuItem
              key={f.name}
              icon={<FileIcon size={14} />}
              hint={f.exists ? undefined : "New"}
              onSelect={() => {
                closePlus()
                void openInstructions(threadId, f.name)
              }}
            >
              {f.exists ? `Open ${f.name}` : `Start a ${f.name}`}
            </MenuItem>
          ))}
        </>
      )}
    </Popover>
  )

  const researchChip = researching && (
    <motion.button
      initial={false}
      transition={m.t(0.12)}
      onClick={() => setResearch(false)}
      title="Turn research off"
      aria-label="Research is on. Turn it off"
      className="group/chip flex h-[32px] shrink-0 items-center gap-[8px] rounded-full border-0 bg-fill-2 px-[12px] text-[13px] text-ink transition-transform duration-150 ease-out active:scale-[0.96]"
    >
      <TelescopeIcon size={13} className="group-hover/chip:hidden" />
      <XIcon size={12} className="hidden group-hover/chip:block" />
      Research
    </motion.button>
  )

  const activeConnectors = !usesTools ? [] : (connected ?? []).filter((c) => c.enabled && chatConnectors.includes(c.id))
  const connectorChip = activeConnectors.length > 0 && (
    <motion.button
      initial={false}
      transition={m.t(0.12)}
      onClick={() => setPlus(true)}
      title="Connectors in this chat"
      aria-label={`Connectors on: ${activeConnectors.map((c) => c.name).join(", ")}`}
      className="flex h-[32px] shrink-0 items-center gap-[8px] rounded-full border-0 bg-fill px-[12px] text-[13px] text-ink-3 transition-[background-color,color,transform] duration-150 ease-out hover:bg-fill-2 hover:text-ink active:scale-[0.96]"
    >
      <span className="flex -space-x-1">
        {activeConnectors.slice(0, 3).map((c) => (
          <ConnectorLogo key={c.id} catalogId={c.catalogId} name={c.name} size={16} />
        ))}
      </span>
      {activeConnectors.length === 1 ? activeConnectors[0]!.name : `${activeConnectors.length} apps`}
    </motion.button>
  )
  const helperChip = helper && (
    <motion.button
      initial={false}
      transition={m.t(0.12)}
      onClick={clearHelper}
      title={`Stop using ${helper.name}`}
      aria-label={`${helper.name} is on. Turn it off`}
      className="group/chip flex h-[32px] shrink-0 items-center gap-[8px] rounded-full border-0 bg-fill-2 pr-[12px] pl-[4px] text-[13px] text-ink transition-transform duration-150 ease-out active:scale-[0.96]"
    >
      <span className="group-hover/chip:hidden">
        <HelperMark kind={helper.kind} size={20} />
      </span>
      <span className="hidden h-5 w-5 items-center justify-center group-hover/chip:flex">
        <XIcon size={12} />
      </span>
      {helper.name}
    </motion.button>
  )

  const slashMenu = (
    <SlashMenu
      open={slashOpen}
      items={slashList}
      selected={sel}
      agentName={isAgent ? label : undefined}
      onPick={pickSlash}
      onHover={setSlashSel}
      className={`bottom-[calc(100%+8px)] left-0 ${onWatching && !(threadId && isAgent) ? "w-[400px]" : variant === "start" ? "w-[640px]" : "w-[760px]"} max-w-full`}
    />
  )

  // Left of the text, inside the box, like the desktop app's.
  const plusButton = (
    <button
      ref={plusBtn}
      type="button"
      aria-label="Add files, tools and connectors"
      aria-expanded={plus}
      onClick={() => {
        if (!plus && threadId && isAgent) void loadInstructions(threadId)
        if (!plus) setPlusBelow((plusBtn.current?.getBoundingClientRect().top ?? 900) < 440)
        setPlus((p) => !p)
      }}
      // The sparkle (2026-11-08): files, tools and connectors. Draft 3's 32 px icon button.
      className={boxButton(plus)}
    >
      <MagicIcon size={16} />
    </button>
  )

  // Claude Code's desktop composer (2026-11-08): inside the box one row, the wand, the text, the mic, and send only
  // when there is something to send (or Stop while it runs). Under the box one quiet row of text controls.
  const kindChip = kind && (
    <span className="inline-flex h-[28px] shrink-0 items-center gap-[6px] rounded-full bg-fill-2 pr-[6px] pl-[10px] text-[13px] text-ink">
      <KindIcon kind={kind} size={13} />
      {KIND_LABEL[kind]}
      <button type="button" aria-label="Remove" onClick={onClearKind} className="grid size-[18px] cursor-pointer place-items-center rounded-full border-0 bg-transparent text-brand-text hover:bg-brand-soft">
        <XIcon size={11} />
      </button>
    </span>
  )
  const under = (
    <div className="flex min-h-[28px] items-center justify-between gap-[2px] px-[4px] pt-[8px]" data-testid="composer-under">
      <div className="flex min-w-0 items-center gap-[2px]">
        {kindChip}
        {/* The menu bar's chat works in your last folder without showing it. Oversight (onStart) runs no agent turn. */}
        {!inTrayWindow() && !onStart && folderChip}
        {!onStart && modeMenu}
        {chatOnlyNote}
        {helperChip}
        {researchChip}
        {connectorChip}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-[2px]">
        {loadingNote}
        {/* Who answers, with an agent's model and effort in the same control and menu. */}
        {modelButton}
        {/* While a chat runs, the small context ring (it opens the usage card). */}
        {threadId && running && <UsageRing threadId={threadId} />}
      </div>
    </div>
  )

  return (
    <div className={`relative ${fill ? "w-full" : composerWidth}`}>
      {slashMenu}
      <MentionMenu
        open={mentionOpen}
        items={mentionList}
        selected={mSel}
        onPick={pickMention}
        onHover={setMentionSel}
        watchesFirst={!!onStart}
        className={`bottom-[calc(100%+8px)] left-0 ${variant === "start" ? "w-[520px]" : "w-[560px]"} max-w-full`}
      />
      {plusMenu}
      {tray}
      <PromptInput
        value={text}
        onValueChange={(v) => {
          setText(v)
          setSlashSel(null)
          setMentionSel(0)
          setCaret(area.current?.selectionStart ?? v.length)
        }}
        onSubmit={() => void send()}
        onStop={() => threadId && void stop(threadId)}
        pending={!!running && !!threadId}
        canSubmit={canSend}
        checking={!!busy}
        submitLabel="Send"
        stopLabel="Stop"
        placeholder={placeholder}
        textareaRef={area}
        textareaProps={{
          spellCheck: false,
          // The menu bar's chat is narrow: a touch smaller placeholder keeps it on one line.
          // Draft 3: 15/22, 5 px by 4 px, one line (32 px) to start, the placeholder in ink-4.
          className: `selectable min-h-[32px] max-h-[186px] px-[4px] py-[5px] text-[15px]/[22px] md:text-[15px]/[22px] text-[var(--cx-ink)] placeholder:text-[var(--cx-ink4)] ${inTrayWindow() ? "placeholder:text-[15px]" : ""}`,
          onKeyDownCapture,
          onSelect: (e) => setCaret(e.currentTarget.selectionStart),
          onPaste: (e) => {
            const pasted = Array.from(e.clipboardData.files)
            if (!pasted.length) return
            e.preventDefault()
            add(() => attachFiles(pasted))
          },
        }}
        header={<DictationStrip target="composer" className="mb-1" />}
        inline
        leading={plusButton}
        actions={<MicButton target="composer" size={32} box />}
        // Draft 3's box: radius 16, its own fill, an inset 1 px hairline, 8 px padding (6 on the left).
        className={`relative rounded-[16px] border-0 bg-[var(--cx-box)] py-[8px] pr-[8px] pl-[6px] shadow-[inset_0_0_0_1px_var(--cx-edge)] ${dropping ? "ring-[3px] ring-brand-soft" : ""}`}
        {...dropProps}
      />
      {under}
    </div>
  )
})
