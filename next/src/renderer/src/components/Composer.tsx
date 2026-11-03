import { AnimatePresence, motion } from "motion/react"
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
  defaultAnswerer,
  draftFolder,
  getState,
  loadCommands,
  loadDraftCommands,
  loadInstructions,
  modeOf,
  nextAnswerer,
  openInstructions,
  pickAnswerer,
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
import { AxeTile, agentLogo, LogoTile, localModelLogo, modelLogo } from "./BrandLogo"
import { chip, IconTile, Switch } from "./Kit"
import { BranchIcon, CheckIcon, ChevronDown, FileIcon, FolderIcon, GlobeIcon, MonitorIcon, PaperclipIcon, PencilIcon, PlugIcon, PlusIcon, SearchIcon, TelescopeIcon, XIcon } from "./Icons"
import { ConnectorLogo, HelperMark } from "./Library"
import { AgentOptionsMenu } from "./AgentOptionsMenu"
import { ModeMenu, nextMode } from "./ModeMenu"
import { MentionMenu, mentionOrder } from "./MentionMenu"
import { ModelPicker } from "./ModelPicker"
import { FoxPet } from "./Pet"
import { MenuItem, MenuLabel, MenuLine, Popover } from "./Popover"
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
  }
>(function Composer({ variant, threadId, onStart, hint, kind, onClearKind, busy, onEscape, onTextChange, answerer: ownAnswerer, onAnswerer, watching }, handle) {
  const [text, setText] = useState("")
  useEffect(() => onTextChange?.(text), [text, onTextChange])
  const [picker, setPicker] = useState(false)
  // The list opens above the button and never runs past the top of the window.
  const [room, setRoom] = useState(560)
  const [plus, setPlus] = useState(false)
  const [files, setFiles] = useState<Attachment[]>([])
  const [dropping, setDropping] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const modelBtn = useRef<HTMLButtonElement>(null)
  const plusBtn = useRef<HTMLButtonElement>(null)
  const m = useMotion()

  const catalog = useStore((s) => s.catalog)
  const draft = useStore((s) => s.draft)
  const thread = useStore((s) => (threadId ? s.threads.find((t) => t.id === threadId) : undefined))
  const running = useStore((s) => (threadId ? !!s.live[threadId] || !!thread?.running : false))
  // Selected as a string: the helpers build fresh objects, and the store wants stable snapshots.
  const answererKey = useStore((s) => JSON.stringify(ownAnswerer ?? (threadId ? nextAnswerer(threadId, s) : (s.draft.answerer ?? defaultAnswerer(s)))))
  const answerer = useMemo(() => JSON.parse(answererKey) as Answerer, [answererKey])
  const isAgent = answerer.kind === "agent"
  // A model on a local server: no web search or research (those are axeai.com's). With tools it gets Do it
  // and connectors like an Axe model; one that can't use tools only chats.
  const isLocal = answerer.kind === "local"
  const isAxe = answerer.kind === "axe"
  const label = answererLabel(answerer, catalog)
  const model = answerer.kind === "axe" ? catalog?.axe.models.find((x) => x.id === answerer.modelId) : undefined
  const agent = answerer.kind === "agent" ? catalog?.agents.find((x) => x.id === answerer.agentId) : undefined
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
      el?.focus()
      el?.setSelectionRange(at, at)
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
      if (w) add(async () => [await invoke("app:attachBytes", `${w.name.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "Watch"}.md`, "text/markdown", new TextEncoder().encode(watchMarkdown(w)))])
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

  const closePicker = useCallback(() => setPicker(false), [])
  const closePlus = useCallback(() => setPlus(false), [])

  const doIt = usesTools && draft.doIt
  // Local chats stay with local models, other chats never switch to one (a local chat lives only here).
  const pagePicker: ("axe" | "agent" | "local")[] | undefined = thread?.source === "local" ? ["local"] : thread ? ["axe", "agent"] : undefined
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
        : "Ask anything, @ for tools, / for commands"
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
  const control =
    "inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-muted-foreground transition-[color,background-color,scale] duration-150 hover:bg-fill-2 hover:text-foreground active:scale-[0.97] disabled:opacity-40"

  // Any chat can switch to any of Axe's models or CLIs; the next one gets the earlier turns as context.

  const modelButton = (
    <button
      ref={modelBtn}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={picker}
      onClick={() => {
        if (!picker) setRoom(Math.min(560, (modelBtn.current?.getBoundingClientRect().top ?? 600) - 32))
        setPicker((p) => !p)
      }}
      className={chip(picker)}
    >
      {isAgent ? (
        <LogoTile logo={agent ? agentLogo(agent) : undefined} name={label} size={16} />
      ) : answerer.kind === "local" ? (
        <LogoTile logo={localModel ? localModelLogo(localModel) : undefined} name={label} size={16} />
      ) : (
        answerer.modelId === "auto" ? <AxeTile size={16} /> : <LogoTile logo={model ? modelLogo(model) : undefined} name={label} size={16} />
      )}
      {label}
      <ChevronDown size={12} className="text-ink-4" />
    </button>
  )
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
  const folderChip = isAgent && !cwd && !threadId ? (
    <button
      onClick={() => void chooseFolder()}
      className={chip()}
    >
      <FolderIcon size={13} />
      Choose a folder
    </button>
  ) : isAgent && cwd && (
    <button
      onClick={() => !threadId && void chooseFolder()}
      disabled={!!threadId}
      title={copy ? `${copy.branch ? `Branch ${copy.branch} in ` : "A copy in "}${cwd}` : cwd}
      className={`${chip()} min-w-0 enabled:hover:bg-fill`}
    >
      {copying ? <BranchIcon size={13} /> : <FolderIcon size={13} />}
      <span className="truncate">{copy ? folderName(copy.source) : folderName(cwd)}</span>
      {copying && <span className="shrink-0 text-ink-4">{copy?.kind === "copy" ? "copy" : "worktree"}</span>}
    </button>
  )
  const modeMenu = isAgent && <ModeMenu threadId={threadId} size="docked" />
  // Hidden in the menu bar's narrow chat, like the folder chip.
  const optionsMenu = answerer.kind === "agent" && !inTrayWindow() && <AgentOptionsMenu threadId={threadId} agentId={answerer.agentId} />

  const plusMenu = (
    <Popover open={plus} onClose={closePlus} anchor={plusBtn} origin="bottom left" className="bottom-[calc(100%+14px)] left-0" label="Add">
      <MenuItem
        icon={<IconTile tone="mute" size={18}><PaperclipIcon size={12} /></IconTile>}
        onSelect={() => {
          closePlus()
          pickFiles()
        }}
      >
        Add files or photos
      </MenuItem>
      <MenuLine />
      <MenuLabel>Watch</MenuLabel>
      {(["uptime", "page", "price", "security", "repo"] as const).map((k) => (
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
      <MenuLine />
      {/* Watching: files, the Watch section and connectors only, whatever the model. */}
      {!onStart && (isAgent ? (
        <>
          <MenuItem
            icon={<FolderIcon size={14} />}
            hint={cwd ? folderName(cwd) : undefined}
            onSelect={() => {
              closePlus()
              void chooseFolder()
            }}
          >
            Work in a folder
          </MenuItem>
          {!threadId && (
            <MenuItem
              icon={<BranchIcon size={14} />}
              hint={<Switch on={!!draft.copy} />}
              onSelect={() => {
                closePlus()
                setCopy(!draft.copy)
              }}
            >
              Work in a copy
            </MenuItem>
          )}
        </>
      ) : isLocal ? (
        <MenuItem
          icon={<IconTile tone="mute" size={18}><MonitorIcon size={12} /></IconTile>}
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
            icon={<IconTile tone={draft.webSearch && !researching ? "brand" : "mute"} size={18}><GlobeIcon size={12} /></IconTile>}
            hint={<Switch on={!!draft.webSearch && !researching} />}
            onSelect={() => setState((s) => ({ draft: { ...s.draft, webSearch: !s.draft.webSearch } }))}
          >
            Search the web
          </MenuItem>
          <MenuItem
            icon={<IconTile tone="mute" size={18}><MonitorIcon size={12} /></IconTile>}
            hint={<Switch on={!!draft.doIt} />}
            onSelect={() => {
              closePlus()
              setState((s) => ({ draft: { ...s.draft, doIt: !s.draft.doIt, research: s.draft.doIt ? s.draft.research : false } }))
            }}
          >
            Do it
          </MenuItem>
          <MenuItem
            icon={<IconTile tone="mute" size={18}><SearchIcon size={12} /></IconTile>}
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
      {!onStart && <MenuLine />}
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
                icon={<ConnectorLogo catalogId={c.catalogId} name={c.name} size={18} />}
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
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={m.t(0.12)}
      onClick={() => setResearch(false)}
      title="Turn research off"
      aria-label="Research is on. Turn it off"
      className="group/chip flex h-7 shrink-0 items-center gap-1.5 rounded-full border-0 bg-brand-soft px-2.5 text-[13px] text-brand-text"
    >
      <TelescopeIcon size={13} className="group-hover/chip:hidden" />
      <XIcon size={12} className="hidden group-hover/chip:block" />
      Research
    </motion.button>
  )

  const activeConnectors = !usesTools ? [] : (connected ?? []).filter((c) => c.enabled && chatConnectors.includes(c.id))
  const connectorChip = activeConnectors.length > 0 && (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={m.t(0.12)}
      onClick={() => setPlus(true)}
      title="Connectors in this chat"
      aria-label={`Connectors on: ${activeConnectors.map((c) => c.name).join(", ")}`}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border-0 bg-entity px-2 text-[13px] text-ink-2 hover:bg-fill-2"
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
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={m.t(0.12)}
      onClick={clearHelper}
      title={`Stop using ${helper.name}`}
      aria-label={`${helper.name} is on. Turn it off`}
      className="group/chip flex h-7 shrink-0 items-center gap-1.5 rounded-full border-0 bg-brand-soft pr-2.5 pl-1 text-[13px] text-brand-text"
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

  const picked = (a: Answerer) => {
    if (onAnswerer) {
      onAnswerer(a)
      return setPicker(false)
    }
    void pickAnswerer(a, threadId).then((ok) => {
      if (ok) setPicker(false)
    })
  }

  // Left of the text, inside the box, like the desktop app's.
  const plusButton = (
    <button
      ref={plusBtn}
      type="button"
      aria-label="Add files, tools and connectors"
      aria-expanded={plus}
      onClick={() => {
        if (!plus && threadId && isAgent) void loadInstructions(threadId)
        setPlus((p) => !p)
      }}
      className={`inline-flex size-[36px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-ink-2 transition-[color,background-color,scale] duration-150 hover:bg-fill-2 hover:text-foreground active:scale-[0.97] disabled:opacity-40 ${plus ? "bg-fill-2 text-foreground" : ""}`}
    >
      <PlusIcon size={20} />
    </button>
  )

  // Under the box: where it works and how much it may do on the left; who answers and context on the right.
  const toolbar = (
    <div className="relative flex min-w-0 items-center gap-[2px] px-[6px] pt-[6px]">
      <ModelPicker
        sections={pagePicker}
        open={picker}
        onClose={closePicker}
        anchor={modelBtn}
        current={answerer}
        onPick={picked}
        className="right-0 bottom-[calc(100%-14px)]"
        maxHeight={room}
      />
      <div className="flex min-w-0 flex-1 items-center gap-[4px]">
        {/* The menu bar's chat works in your last folder without showing it. */}
        {/* Watching (onStart) runs no agent turn here: only the model picker shows, as in the design. */}
        {!inTrayWindow() && !onStart && folderChip}
        {!onStart && modeMenu}
        {!onStart && optionsMenu}
        {chatOnlyNote}
        {helperChip}
        {researchChip}
        {connectorChip}
      </div>
      {loadingNote}
      {modelButton}
      {threadId && <UsageRing threadId={threadId} />}
    </div>
  )

  return (
    <div className={`relative ${composerWidth}`}>
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
      <div className="relative">
      {/* The fox greets you on a new chat; once a chat has messages it steps aside. */}
      {variant === "start" && !onStart && <FoxPet className="absolute right-[72px] bottom-[calc(100%-3px)]" />}
      <PromptInput
        inline
        leading={
          kind ? (
            <>
              {plusButton}
              <span className="ml-[2px] inline-flex h-[26px] shrink-0 items-center gap-[6px] self-center rounded-[6px] bg-brand-soft pr-[4px] pl-[8px] text-[13px] text-brand-text">
                <KindIcon kind={kind} size={14} />
                {KIND_LABEL[kind]}
                <button type="button" aria-label="Remove" onClick={onClearKind} className="grid size-[18px] cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-brand-text hover:bg-brand-soft">
                  <XIcon size={11} />
                </button>
              </span>
            </>
          ) : (
            plusButton
          )
        }
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
          className: `selectable max-h-[192px] min-h-[36px] pl-[2px] ${inTrayWindow() ? "placeholder:text-[15px]" : ""}`,
          onKeyDownCapture,
          onSelect: (e) => setCaret(e.currentTarget.selectionStart),
          onPaste: (e) => {
            const pasted = Array.from(e.clipboardData.files)
            if (!pasted.length) return
            e.preventDefault()
            add(() => attachFiles(pasted))
          },
        }}
        header={
          <>
            <DictationStrip target="composer" className="mb-1" />
          </>
        }
        actions={<MicButton target="composer" size={36} />}
        className={`relative transition-[box-shadow] duration-150 ${dropping ? "ring-[3px] ring-brand-soft" : ""}`}
        {...dropProps}
      />
      </div>
      {toolbar}
    </div>
  )
})
