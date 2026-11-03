import { useSyncExternalStore } from "react"

import type {
  AgentMode,
  AgentOption,
  Attachment,
  FileChange,
  Answerer,
  ChatMessage,
  ConnectorsView,
  Helper,
  InstructionsFile,
  MemoryItem,
  LocalModel,
  ModelCatalog,
  ModelPull,
  PermissionRequest,
  PowerState,
  RemoteState,
  Profile,
  ReplyUpdate,
  Settings,
  SkillLibrary,
  SlashCommand,
  Theme,
  ThreadSummary,
  UpdateState,
} from "@shared/types"
import type { Draft, DraftError, Kind, WatchList } from "@shared/watching/types"

/**
 * A sentence typed on the Watching page, shown as a short thread: your words, then "Thinking…",
 * then what Axe needs (the kind or the target) or why the target can't be watched.
 */
export type WatchAsk = { text: string; reading?: boolean; question?: string; target?: string; kind?: Kind; error?: string; button?: DraftError["button"] }

import { threadAnswerer } from "./answerer"
import { invoke, on } from "./bridge"

export type View =
  | { kind: "new" }
  | { kind: "thread"; id: string }
  | { kind: "settings" }
  | { kind: "skills" }
  | { kind: "agents" }
  | { kind: "connectors" }
  | { kind: "watching" }
  | { kind: "newWatch"; draft: Draft }
  | { kind: "watch"; id: string }

export type State = {
  boot: "loading" | "ready"
  profile: Profile | null
  signingIn: boolean
  /** The fox was clicked: the forest shows behind the chat, rippling out from where the fox sits (window point). */
  forest: { x: number; y: number } | null
  settings: Settings
  catalog: ModelCatalog | null
  threads: ThreadSummary[]
  view: View
  /** Messages per chat, as far as the window knows them. */
  messages: Record<string, ChatMessage[]>
  /** Chats whose stored messages have been fetched (or that started here). */
  loaded: Record<string, true>
  /** Replies still streaming, per chat. */
  live: Record<string, ReplyUpdate>
  /** Reply errors that came on the update rather than as a part, per message. */
  errors: Record<string, string>
  permissions: PermissionRequest[]
  /** Questions each chat has asked you since the window opened (after a few, it offers a calmer mode). */
  asks: Record<string, number>
  /** Do it may use this computer (its permissions are granted): it stays on and the composer shows no chip. */
  doItReady: boolean
  /** Who answers next in each open chat, when you picked someone. */
  picked: Record<string, Answerer>
  /** The composer's choices (research applies to Axe models only). */
  draft: {
    answerer: Answerer | null
    cwd?: string
    webSearch: boolean
    research: boolean
    doIt: boolean
    /** A new chat with this agent from the library. */
    helperId?: string
    /** Connectors on for the new chat (none when unset). */
    connectors?: string[]
    /** New agent chats: how much it may do on its own, and whether it works in a copy of the folder. */
    mode?: AgentMode
    copy?: boolean
  }
  /** The libraries, each null until its page (or the sidebar) loads it. */
  library: { skills: SkillLibrary | null; helpers: Helper[] | null; connectors: ConnectorsView | null }
  /** What Axe remembers about you; null until Settings loads it. */
  memory: MemoryItem[] | null
  /** The / menu per agent chat ("draft" for a new agent chat). */
  commands: Record<string, SlashCommand[]>
  /** A CLI agent's model and effort lists, per agent chat ("draft:<agentId>" for a new chat). */
  agentOptions: Record<string, AgentOption[]>
  /** CLAUDE.md / AGENTS.md per agent chat. */
  instructions: Record<string, InstructionsFile[]>
  /** Messages that should rise in (new this session), not ones loaded with the chat. */
  fresh: Record<string, true>
  sidebarCollapsed: boolean
  /** The terminal panel under the screen; `agentId` starts it on that CLI's sign-in, `n` tells requests apart. */
  terminal: { agentId?: string; n: number } | null
  paletteOpen: boolean
  search: string
  /** Files each agent chat changed (review). */
  changes: Record<string, FileChange[]>
  /** The chat whose changes panel is open. */
  review: string | null
  /** Every watch, problems first; null until loaded. */
  watching: WatchList | null
  /** The starter whose chip is in the Watching composer. */
  watchKind: Kind | null
  /** The composer's question when a catalogue card asks its own (Competitor pages). */
  watchHint: string | null
  /** Free text Axe couldn't read alone: it asks which kind. */
  watchAsk: WatchAsk | null
  /** Words to put back in the Watching composer (a target that couldn't be reached keeps your text). */
  watchSeed: { text: string; n: number } | null
  /** The sentence that led to the target ask, kept as the plan's bubble. */
  watchAsked: string | null
  /** A reply the watch's model is reading, per watch: its bubble shows with "Thinking…". */
  watchReplying: Record<string, string>
  /** The line under the Watching composer when a target can't be watched. */
  watchError: string | null
  /** Watching: Axe's one answer under the composer to a message for several watches, or a / command. */
  watchNote: string | null
  /** The error's way out: "Watch it anyway", "Watch the page instead". */
  watchErrorButton: DraftError["button"] | null
  /** A target is being checked before the plan shows. */
  watchBusy: boolean
  /** What's being checked, for "Checking lane-ceramics.com…". */
  watchBusyTarget: string | null
  /** The Repo starter's menu is open under the composer (the hint gives way to it). */
  watchRepoMenu: boolean
  /** The watch whose Check now is running. */
  watchChecking: string | null
  /** The open watch's Edit panel. */
  watchEditing: boolean
  /** What Axe said back to replies, per watch, this session. */
  /** A notification's Fix button: the finding to fix once the watch shows. */
  watchFix: { id: string; key: string } | null
  /** Agent chats that finished while you were elsewhere ("Done" in the sidebar until opened). */
  finished: Record<string, true>
  /** This copy's version and its updates. */
  update: { version: string; state: UpdateState }
  power: PowerState | null
  remote: RemoteState | null
  /** A model downloading into Ollama ("Get a model"), with its progress. */
  pull: ModelPull | null
  /** A local model being loaded into memory after you picked it ("Loading model"). */
  warming: string | null
}

const defaultSettings: Settings = { baseURL: "https://axeai.com", theme: "dark", sidebarWidth: 300, quickBarKey: "Alt+Space" }

let state: State = {
  boot: "loading",
  profile: null,
  signingIn: false,
  forest: null,
  settings: defaultSettings,
  catalog: null,
  threads: [],
  view: { kind: "new" },
  messages: {},
  loaded: {},
  live: {},
  errors: {},
  permissions: [],
  asks: {},
  doItReady: false,
  picked: {},
  // Using this computer (files, apps, Axe's own browser) is on for every chat; it still asks before
  // anything it can't undo. CLI agents always have it.
  draft: { answerer: null, webSearch: true, research: false, doIt: true, connectors: [], mode: "ask", copy: false },
  library: { skills: null, helpers: null, connectors: null },
  memory: null,
  commands: {},
  agentOptions: {},
  instructions: {},
  fresh: {},
  sidebarCollapsed: false,
  terminal: null,
  paletteOpen: false,
  search: "",
  changes: {},
  review: null,
  watching: null,
  watchKind: null,
  watchHint: null,
  watchAsk: null,
  watchSeed: null,
  watchAsked: null,
  watchReplying: {},
  watchError: null,
  watchNote: null,
  watchErrorButton: null,
  watchBusy: false,
  watchBusyTarget: null,
  watchChecking: null,
  watchRepoMenu: false,
  watchEditing: false,
  watchFix: null,
  finished: {},
  update: { version: "", state: { status: "idle" } },
  power: null,
  remote: null,
  pull: null,
  warming: null,
}

const listeners = new Set<() => void>()

export function getState() {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const next = typeof patch === "function" ? patch(state) : patch
  state = { ...state, ...next }
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state),
  )
}

/** Resets the store (tests). */
export function resetStore(next: Partial<State> = {}) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

// ---------- Derived ----------

export function defaultAnswerer(s: State = state): Answerer {
  if (s.settings.answerer) return s.settings.answerer
  // Signed out, a CLI agent on this computer answers: Axe's models need an account.
  const agent = s.profile ? undefined : s.catalog?.agents.find((a) => a.state === "ready")
  if (agent) return { kind: "agent", agentId: agent.id }
  // No account and no CLI: a model on a local server, when one is running.
  const local = s.profile ? undefined : s.catalog?.local[0]
  return local ? { kind: "local", modelId: local.id } : { kind: "axe", modelId: s.catalog?.axe.defaultModelId ?? "auto" }
}

/** The folder of your newest agent chat (where a copy came from, for chats in a copy). */
export function lastFolder(s: State = state): string | undefined {
  const t = s.threads
    .filter((x) => x.source === "agent" && x.cwd)
    .reduce<ThreadSummary | undefined>((a, b) => (!a || Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a), undefined)
  return t?.copy?.source ?? t?.cwd
}

/** Where a new agent chat works: the folder you picked, else the one you used last. */
export function draftFolder(s: State = state): string | undefined {
  return s.draft.cwd ?? lastFolder(s)
}

export function currentThread(s: State = state): ThreadSummary | undefined {
  const v = s.view
  return v.kind === "thread" ? s.threads.find((t) => t.id === v.id) : undefined
}

/** Who answers the next message in a chat. */
export function nextAnswerer(threadId: string, s: State = state): Answerer {
  if (s.picked[threadId]) return s.picked[threadId]
  const thread = s.threads.find((t) => t.id === threadId)
  const msgs = s.messages[threadId] ?? []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const a = msgs[i]!.answerer
    if (a) return a
  }
  return threadAnswerer(thread, defaultAnswerer(s))
}

export function resolvedTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

// ---------- Actions ----------

let started = false

/** Loads everything the window needs and listens to the engine. */
export async function start() {
  if (started) return
  started = true
  on("account", (profile) => {
    const wasOut = !state.profile
    setState({ profile, signingIn: false })
    // Signing in adds Axe's models and chats to what is already here.
    if (profile && wasOut && state.boot === "ready") void loadAll()
  })
  on("threads", (threads) => setState({ threads }))
  // The model used last in any window (the app or the menu bar) is the one new chats start with.
  on("settings", (settings) =>
    setState((s) => ({ settings, draft: JSON.stringify(settings.answerer) !== JSON.stringify(s.draft.answerer) ? { ...s.draft, answerer: null } : s.draft })),
  )
  on("models", (catalog) => setState({ catalog }))
  on("modelPull", (pull) => setState({ pull }))
  on("reply", applyReply)
  on("permission", (p) =>
    setState((s) => ({
      permissions: [...s.permissions.filter((x) => x.id !== p.id), p],
      asks: p.plan ? s.asks : { ...s.asks, [p.threadId]: (s.asks[p.threadId] ?? 0) + 1 },
    })),
  )
  on("permissionDone", ({ id }) => setState((s) => ({ permissions: s.permissions.filter((x) => x.id !== id) })))
  on("commands", ({ threadId, commands }) => setState((s) => ({ commands: { ...s.commands, [threadId]: commands } })))
  on("agentOptions", ({ threadId, options }) => setState((s) => ({ agentOptions: { ...s.agentOptions, [threadId]: options } })))
  on("mode", ({ threadId, mode }) => setState((s) => ({ threads: s.threads.map((t) => (t.id === threadId ? { ...t, mode } : t)) })))
  on("changes", ({ threadId, files }) => setState((s) => ({ changes: { ...s.changes, [threadId]: files } })))
  on("openThread", ({ threadId }) => void openThread(threadId))
  on("openWatching", () => setState({ view: { kind: "watching" }, paletteOpen: false, watchKind: null, watchAsk: null, watchError: null, watchErrorButton: null }))
  on("openWatch", ({ id, fix }) => setState({ view: { kind: "watch", id }, paletteOpen: false, watchEditing: false, watchFix: fix ? { id, key: fix } : null }))
  on("connectors", (connectors) => setState((s) => ({ library: { ...s.library, connectors } })))
  // Permissions change in System Settings, so look again whenever the window comes back.
  const checkAccess = () =>
    void invoke("doit:access")
      .then((doItReady) => setState({ doItReady }))
      .catch(() => {})
  checkAccess()
  window.addEventListener("focus", checkAccess)
  on("update", (u) => setState((s) => ({ update: { ...s.update, state: u } })))
  void invoke("updates:get")
    .then((update) => setState({ update }))
    .catch(() => {})
  on("watching", (watching) => setState({ watching }))
  on("power", (power) => setState({ power }))
  on("remote", (remote) => setState({ remote }))

  const [profile, settings] = await Promise.all([invoke("account:get"), invoke("settings:get")])
  setState({ profile, settings, boot: "ready" })
  // Signed out works too: CLI agents, local chats and skills need no account.
  await loadAll()
}

async function loadAll() {
  const [catalog, threads, skills, connectors] = await Promise.all([
    invoke("models:get"),
    invoke("threads:list"),
    invoke("skills:list").catch(() => null),
    invoke("connectors:list").catch(() => null),
  ])
  // Your agents too: the / menu offers them on a new chat.
  const helpers = await invoke("helpers:list").catch(() => null)
  setState((s) => ({ catalog, threads, library: { ...s.library, skills, connectors, helpers } }))
  const watching = await invoke("watching:list").catch(() => null)
  setState({ watching })
}

export function applyReply(u: ReplyUpdate) {
  setState((s) => {
    const list = s.messages[u.threadId] ?? []
    const i = list.findIndex((m) => m.id === u.message.id)
    const messages = { ...s.messages, [u.threadId]: i >= 0 ? list.map((m, j) => (j === i ? u.message : m)) : [...list, u.message] }
    const live = { ...s.live }
    if (u.done) delete live[u.threadId]
    else live[u.threadId] = u
    const fresh = i >= 0 ? s.fresh : { ...s.fresh, [u.message.id]: true as const }
    const errors = u.error ? { ...s.errors, [u.message.id]: u.error } : s.errors
    const threads = s.threads.map((t) => (t.id === u.threadId && !!t.running !== !u.done ? { ...t, running: !u.done } : t))
    // An agent that finishes while you look at another chat says so in the sidebar.
    const elsewhere = !(s.view.kind === "thread" && s.view.id === u.threadId)
    const agentChat = u.message.answerer?.kind === "agent" || threads.find((t) => t.id === u.threadId)?.source === "agent"
    const finished = u.done && elsewhere && agentChat ? { ...s.finished, [u.threadId]: true as const } : s.finished
    return { messages, live, fresh, errors, threads, finished }
  })
}

export async function signIn() {
  setState({ signingIn: true })
  try {
    const profile = await invoke("account:signIn")
    setState({ profile, signingIn: false })
    if (profile) await loadAll()
  } catch {
    setState({ signingIn: false })
  }
}

export async function cancelSignIn() {
  setState({ signingIn: false })
  await invoke("account:cancelSignIn")
}

export async function signOut() {
  await invoke("account:signOut")
  setState({ profile: null, threads: [], messages: {}, loaded: {}, live: {}, permissions: [], view: { kind: "new" } })
  // Chats with CLI agents stay; they live on this computer.
  await loadAll()
}

export async function updateSettings(patch: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...patch } }))
  const settings = await invoke("settings:set", patch)
  setState({ settings })
}

export const setTheme = (theme: Theme) => updateSettings({ theme })

export function newChat() {
  setState({ view: { kind: "new" }, paletteOpen: false, draft: { ...state.draft, doIt: !state.draft.research, cwd: undefined, helperId: undefined, connectors: [] } })
}

export async function openThread(id: string) {
  setState((s) => {
    const finished = { ...s.finished }
    delete finished[id]
    return { view: { kind: "thread", id }, paletteOpen: false, finished, review: s.review === id ? id : null }
  })
  if (state.threads.find((t) => t.id === id)?.source === "agent") void loadChanges(id)
  await loadMessages(id)
}

/** A chat's messages, once (a page's own chat loads them without opening the chat). */
export async function loadMessages(id: string) {
  if (state.loaded[id]) return
  const stored = await invoke("threads:messages", id)
  setState((s) => {
    // What streamed in meanwhile wins over the stored copy; anything sent from here is kept.
    const have = s.messages[id] ?? []
    const merged = stored.map((m) => have.find((h) => h.id === m.id) ?? m)
    for (const h of have) if (!merged.some((m) => m.id === h.id)) merged.push(h)
    return { messages: { ...s.messages, [id]: merged }, loaded: { ...s.loaded, [id]: true } }
  })
}

export function openSettings() {
  setState({ view: { kind: "settings" }, paletteOpen: false })
}

/** Picks who answers: for a new chat, or the next message of an open one. */
export async function pickAnswerer(answerer: Answerer, threadId?: string) {
  if (threadId) {
    setState((s) => ({ picked: { ...s.picked, [threadId]: answerer } }))
    if (answerer.kind === "local") warmModel(answerer.modelId)
    return true
  }
  let cwd = draftFolder()
  // Agent chats ask for a folder only when there's no folder yet.
  if (answerer.kind === "agent" && !cwd) {
    const folder = await invoke("app:pickFolder")
    if (!folder) return false
    cwd = folder
  }
  setState((s) => ({ draft: { ...s.draft, answerer, cwd: answerer.kind === "agent" ? cwd : undefined } }))
  void updateSettings({ answerer })
  if (answerer.kind === "local") warmModel(answerer.modelId)
  return true
}

export async function chooseFolder() {
  const folder = await invoke("app:pickFolder")
  if (folder) setState((s) => ({ draft: { ...s.draft, cwd: folder } }))
}

let localId = 0
const userMessage = (text: string, answerer: Answerer, attachments: Attachment[] = []): ChatMessage => ({
  // The engine keeps this id, so the window can point at the message later (rewind).
  id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `local-${Date.now()}-${++localId}`,
  role: "user",
  parts: text ? [{ type: "text", id: "t", text }] : [],
  answerer,
  createdAt: new Date().toISOString(),
  ...(attachments.length ? { attachments } : {}),
})

/** Sends from the new-chat screen and opens the chat. */
export async function sendNew(text: string, attachments: Attachment[] = []) {
  const answerer = state.draft.answerer ?? defaultAnswerer()
  let cwd = draftFolder()
  if (answerer.kind === "agent" && !cwd) {
    cwd = (await invoke("app:pickFolder")) ?? undefined
    if (!cwd) return
  }
  const msg = userMessage(text, answerer, attachments)
  const agent = answerer.kind === "agent"
  const { helperId } = state.draft
  const connectors = state.draft.connectors ?? []
  const { threadId } = await invoke("chat:send", {
    threadId: null,
    text,
    answerer,
    attachments,
    cwd,
    messageId: msg.id,
    mode: agent ? modeOf(undefined) : undefined,
    copy: agent && state.draft.copy ? true : undefined,
    webSearch: answerer.kind === "axe" ? state.draft.webSearch : undefined,
    research: answerer.kind === "axe" && state.draft.research ? true : undefined,
    doIt: canDoIt(answerer) && state.draft.doIt ? true : undefined,
    ...(helperId ? { helperId } : {}),
    ...(connectors.length ? { connectors } : {}),
  })
  setState((s) => {
    const replies = (s.messages[threadId] ?? []).filter((m) => m.role === "assistant")
    const threads = s.threads.some((t) => t.id === threadId)
      ? s.threads
      : [
          {
            id: threadId,
            source: answerer.kind,
            agentId: answerer.kind === "agent" ? answerer.agentId : undefined,
            cwd,
            title: (text || attachments[0]?.name || "").slice(0, 60),
            pinned: false,
            updatedAt: new Date().toISOString(),
            running: true,
            ...(agent ? { mode: modeOf(undefined) } : {}),
            ...(helperId ? { helperId } : {}),
            ...(connectors.length ? { connectors } : {}),
          } satisfies ThreadSummary,
          ...s.threads,
        ]
    return {
      messages: { ...s.messages, [threadId]: [msg, ...replies] },
      loaded: { ...s.loaded, [threadId]: true },
      fresh: { ...s.fresh, [msg.id]: true },
      view: { kind: "thread", id: threadId },
      threads,
      draft: { ...s.draft, doIt: !s.draft.research, cwd: undefined, helperId: undefined, connectors: [], copy: false },
    }
  })
}

/** Sends the next message in an open chat. */
export async function sendInThread(threadId: string, text: string, attachments: Attachment[] = []) {
  const answerer = nextAnswerer(threadId)
  const msg = userMessage(text, answerer, attachments)
  setState((s) => ({
    messages: { ...s.messages, [threadId]: [...(s.messages[threadId] ?? []), msg] },
    fresh: { ...s.fresh, [msg.id]: true },
  }))
  const thread = state.threads.find((t) => t.id === threadId)
  await invoke("chat:send", {
    threadId,
    text,
    answerer,
    attachments,
    messageId: msg.id,
    webSearch: answerer.kind === "axe" ? state.draft.webSearch : undefined,
    research: answerer.kind === "axe" && state.draft.research ? true : undefined,
    doIt: canDoIt(answerer) && state.draft.doIt ? true : undefined,
    // A chat that switches to a CLI works in your last folder until it has its own.
    cwd: thread?.cwd ?? (answerer.kind === "agent" ? lastFolder() : undefined),
  })
}

/** Asks again: sends the question before this reply once more. */
export async function retry(threadId: string, assistantId: string) {
  const msgs = state.messages[threadId] ?? []
  const i = msgs.findIndex((m) => m.id === assistantId)
  for (let j = (i < 0 ? msgs.length : i) - 1; j >= 0; j--) {
    const m = msgs[j]!
    if (m.role === "user") {
      const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")
      if (text) await sendInThread(threadId, text)
      return
    }
  }
}

export async function stop(threadId: string) {
  await invoke("chat:stop", threadId)
}

export async function answerPermission(requestId: string, optionId: string) {
  setState((s) => ({ permissions: s.permissions.filter((p) => p.id !== requestId) }))
  await invoke("chat:answerPermission", requestId, optionId)
}

// Chat housekeeping: change the window first, then tell the engine.

export async function renameThread(id: string, title: string) {
  const clean = title.trim()
  if (!clean) return
  setState((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, title: clean } : t)) }))
  await invoke("threads:rename", id, clean)
}

export async function pinThread(id: string, pinned: boolean) {
  setState((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, pinned } : t)) }))
  await invoke("threads:pin", id, pinned)
}

function dropThread(id: string) {
  setState((s) => ({
    threads: s.threads.filter((t) => t.id !== id),
    view: s.view.kind === "thread" && s.view.id === id ? { kind: "new" } : s.view,
  }))
}

export async function archiveThread(id: string) {
  dropThread(id)
  await invoke("threads:archive", id)
}

export async function deleteThread(id: string) {
  dropThread(id)
  await invoke("threads:delete", id)
}

/** Looks for local model servers again (one may have started since). */
/** The local model behind an answerer, from the catalog. */
export const localModelOf = (a: Answerer, s: State = state): LocalModel | undefined =>
  a.kind === "local" ? s.catalog?.local.find((m) => m.id === a.modelId) : undefined

/** Axe models, and local models that can use tools (or haven't said they can't), work on this computer. */
export function canDoIt(a: Answerer, s: State = state): boolean {
  return a.kind === "axe" || (a.kind === "local" && localModelOf(a, s)?.tools !== false)
}

/** Loads an Ollama model into memory once you pick it, so the first reply isn't slow. */
export function warmModel(modelId: string) {
  if (!modelId.startsWith("ollama|") || state.warming === modelId) return
  setState({ warming: modelId })
  void invoke("models:warm", modelId)
    .catch(() => {})
    .finally(() => setState((s) => (s.warming === modelId ? { warming: null } : {})))
}

export async function startOllama() {
  setState({ catalog: await invoke("models:startOllama") })
}

/** Downloads a model into Ollama; progress arrives as modelPull events. */
export async function pullModel(name: string) {
  setState({ pull: { model: name.trim(), status: "Starting" } })
  try {
    setState({ catalog: await invoke("models:pull", name) })
  } finally {
    setState({ pull: null })
  }
}

export function cancelPull() {
  void invoke("models:cancelPull")
}

export function refreshModels() {
  return invoke("models:refresh").then((catalog) => setState({ catalog })).catch(() => {})
}

export async function addModelServer(address: string, key?: string) {
  setState({ catalog: await invoke("models:addServer", address, key) })
}

export async function removeModelServer(serverId: string) {
  setState({ catalog: await invoke("models:removeServer", serverId) })
}

export async function installAgent(agentId: string) {
  const catalog = await invoke("agents:install", agentId)
  setState({ catalog })
}

export function toggleSidebar(collapsed?: boolean) {
  setState((s) => ({ sidebarCollapsed: collapsed ?? !s.sidebarCollapsed }))
}

/** Shows the terminal panel (with `agentId`: a new shell on that CLI's sign-in), or hides it. */
export function openTerminal(agentId?: string) {
  setState((s) => ({ terminal: { agentId, n: (s.terminal?.n ?? 0) + 1 } }))
}

export function toggleTerminal() {
  setState((s) => ({ terminal: s.terminal ? null : { n: 1 } }))
}

export function setPalette(open: boolean) {
  setState({ paletteOpen: open })
}

// ---------- Research ----------

export function setResearch(on: boolean) {
  // Research and Do it are different runs; one at a time.
  setState((s) => ({ draft: { ...s.draft, research: on, doIt: !on } }))
}

/** Runs the research a paid model asked about. The run replaces the card. */
export async function approveResearch(threadId: string, messageId: string) {
  setState((s) => ({
    messages: { ...s.messages, [threadId]: (s.messages[threadId] ?? []).filter((m) => m.id !== messageId) },
    threads: s.threads.map((t) => (t.id === threadId ? { ...t, running: true } : t)),
  }))
  await invoke("chat:approveResearch", threadId, messageId)
}

export async function cancelResearch(threadId: string, messageId: string) {
  setState((s) => ({
    messages: {
      ...s.messages,
      [threadId]: (s.messages[threadId] ?? []).map((m) =>
        m.id !== messageId
          ? m
          : { ...m, parts: m.parts.map((p) => (p.type === "researchApproval" ? { ...p, data: { ...p.data, status: "cancelled" as const } } : p)) },
      ),
    },
  }))
  await invoke("chat:cancelResearch", threadId, messageId).catch(() => {})
}

// ---------- Memory ----------

/** Engine errors arrive wrapped ("Error invoking remote method …: Error: …"); keep the sentence. */
export const plainError = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^.*?Error: /, "")

export async function loadMemory() {
  setState({ memory: await invoke("memory:list") })
}

async function memoryChange(run: () => Promise<MemoryItem[]>): Promise<string | null> {
  try {
    setState({ memory: await run() })
    return null
  } catch (e) {
    return plainError(e)
  }
}

export const addMemory = (text: string) => memoryChange(() => invoke("memory:add", text))
export const updateMemory = (id: string, text: string) => memoryChange(() => invoke("memory:update", id, text))
export function deleteMemory(id: string) {
  setState((s) => ({ memory: (s.memory ?? []).filter((m) => m.id !== id) }))
  return memoryChange(() => invoke("memory:delete", id))
}

// ---------- Agent chats: / commands and instructions ----------

export async function loadCommands(threadId: string) {
  const commands = await invoke("chat:commands", threadId).catch(() => [])
  setState((s) => ({ commands: { ...s.commands, [threadId]: commands } }))
}

export async function loadDraftCommands(agentId: string, cwd: string) {
  const commands = await invoke("agents:commands", agentId, cwd).catch(() => [])
  setState((s) => ({ commands: { ...s.commands, draft: commands } }))
}

export async function loadInstructions(threadId: string) {
  const files = await invoke("agents:instructions", threadId).catch(() => [])
  setState((s) => ({ instructions: { ...s.instructions, [threadId]: files } }))
}

export async function openInstructions(threadId: string, name: string) {
  await invoke("agents:openInstructions", threadId, name)
  void loadInstructions(threadId)
}

// ---------- Agent work: modes, plan first, review changes ----------

/** What Start sends when the agent planned in words (no plan question waiting). */
export const GO_AHEAD = "Go ahead with the plan."

/** The mode of an agent chat, or of the next new agent chat. */
export function modeOf(threadId: string | undefined, s: State = state): AgentMode {
  // A new chat starts in the mode you used last.
  if (!threadId) return s.settings.mode ?? s.draft.mode ?? "ask"
  return s.threads.find((t) => t.id === threadId)?.mode ?? "ask"
}

export async function setMode(threadId: string | undefined, mode: AgentMode) {
  if (!threadId) {
    setState((s) => ({ draft: { ...s.draft, mode } }))
    void updateSettings({ mode })
    return
  }
  setState((s) => ({ threads: s.threads.map((t) => (t.id === threadId ? { ...t, mode } : t)) }))
  void updateSettings({ mode })
  await invoke("agents:setMode", threadId, mode)
}

// Model and effort for CLI agents: the agent's own lists (ACP config options).

const optionsKey = (threadId: string | undefined, agentId: string) => threadId ?? `draft:${agentId}`

const NO_OPTIONS: AgentOption[] = []

export const agentOptionsOf = (threadId: string | undefined, agentId: string, s: State = state): AgentOption[] =>
  s.agentOptions[optionsKey(threadId, agentId)] ?? NO_OPTIONS

/** Asks the engine for the lists (the running agent's, else the ones it sent last time). */
export async function loadAgentOptions(threadId: string | undefined, agentId: string) {
  const options = await invoke("agents:options", threadId ?? null, agentId).catch(() => null)
  if (options) setState((s) => ({ agentOptions: { ...s.agentOptions, [optionsKey(threadId, agentId)]: options } }))
}

/** Picks a model or effort for the chat (or new chats with this agent). */
export async function setAgentOption(threadId: string | undefined, agentId: string, configId: string, value: string) {
  const key = optionsKey(threadId, agentId)
  setState((s) => ({ agentOptions: { ...s.agentOptions, [key]: (s.agentOptions[key] ?? []).map((o) => (o.id === configId ? { ...o, current: value } : o)) } }))
  const options = await invoke("agents:setOption", threadId ?? null, agentId, configId, value)
  setState((s) => ({ agentOptions: { ...s.agentOptions, [key]: options } }))
}

export function setCopy(copy: boolean) {
  setState((s) => ({ draft: { ...s.draft, copy } }))
}

/** The agent's question to start its plan, if it is waiting on one. */
export const planQuestion = (threadId: string, s: State = state) => s.permissions.find((p) => p.threadId === threadId && p.plan)

/** Start: leaves Plan for the next mode and lets the agent work. */
export async function startPlan(threadId: string) {
  const question = planQuestion(threadId)
  if (question) setState((s) => ({ permissions: s.permissions.filter((p) => p.id !== question.id) }))
  const answered = await invoke("chat:startPlan", threadId)
  if (!answered) await sendInThread(threadId, GO_AHEAD)
}

/** Change: the agent keeps planning, and you say what to change in the composer. */
export async function changePlan(threadId: string) {
  const question = planQuestion(threadId)
  const no = question?.options.find((o) => o.kind === "reject_once") ?? question?.options.find((o) => o.kind.startsWith("reject"))
  window.dispatchEvent(new Event("axe:composer-focus"))
  if (question && no) await answerPermission(question.id, no.id)
}

export async function loadChanges(threadId: string) {
  const files = await invoke("changes:list", threadId).catch(() => [] as FileChange[])
  setState((s) => ({ changes: { ...s.changes, [threadId]: files } }))
}

export function openReview(threadId: string | null) {
  setState({ review: threadId })
  if (threadId) void loadChanges(threadId)
}

export async function keepChanges(threadId: string, paths: string[] | null) {
  const files = await invoke("changes:keep", threadId, paths)
  setState((s) => ({ changes: { ...s.changes, [threadId]: files } }))
}

/** Undo files; the error (it is still working) comes back as plain words. */
export async function undoChanges(threadId: string, paths: string[] | null): Promise<string | null> {
  try {
    const files = await invoke("changes:undo", threadId, paths)
    setState((s) => ({ changes: { ...s.changes, [threadId]: files } }))
    return null
  } catch (e) {
    return plainError(e)
  }
}

