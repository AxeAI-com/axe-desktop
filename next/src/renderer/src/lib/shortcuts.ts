import { displayAccelerator } from "@shared/accelerator"
import type { Answerer } from "@shared/types"

import { agentName } from "./answerer"
import { invoke, isMac, platform } from "./bridge"
import { replyText } from "./steps"
import {
  archiveThread,
  getState,
  installAgent,
  modeOf,
  newChat,
  openReview,
  nextAnswerer,
  openSettings,
  openThread,
  pickAnswerer,
  pinThread,
  setPalette,
  setMode,
  setResearch,
  setState,
  setTheme,
  signIn,
  signOut,
  stop,
  toggleSidebar,
  toggleTerminal,
  type State,
} from "./store"
import { openLibrary } from "./libraries"
import { openWatching } from "./watching"
import { groupThreads } from "./time"
import { holdDown, holdUp, openTalk } from "./voice"

// Every action in the app, in one table: the key handler and the command palette (⌘K) both read it.
// Entries with a key are keyboard shortcuts; the rest are reachable from the palette only. Chats,
// models and agents are added from the store by paletteEntries().

export type Group = "Actions" | "Chats" | "Voice" | "Models" | "Agents" | "Theme" | "Settings"

/** Icons the palette draws, by name (this file has no JSX). */
export type IconName =
  | "new"
  | "settings"
  | "search"
  | "attach"
  | "sidebar"
  | "stop"
  | "copy"
  | "up"
  | "down"
  | "quick"
  | "mic"
  | "talk"
  | "dark"
  | "light"
  | "system"
  | "globe"
  | "research"
  | "pin"
  | "archive"
  | "memory"
  | "keyboard"
  | "agent"
  | "credit"
  | "signout"
  | "chat"
  | "folder"
  | "helper"
  | "skill"
  | "plug"
  | "diff"
  | "mode"
  | "update"
  | "clock"
  | "eye"
  | "terminal"

export type Shortcut = {
  id: string
  label: string
  group?: Group
  icon?: IconName
  /** With ⌘ on a Mac and Ctrl elsewhere. Leave out for palette-only actions. */
  key?: string
  shift?: boolean
  alt?: boolean
  run: () => void
  /** Hold-to-talk: runs when the key is let go. */
  release?: () => void
  /** Only offered when this is true (in a chat, a reply running, …). */
  when?: () => boolean
  /** More words the palette search matches. */
  words?: string
  /** The key shown is the quick bar's global shortcut from Settings. */
  global?: boolean
}

/** Asks the composer on screen to open the file picker or take focus. */
export const composerEvent = (what: "attach" | "focus") => window.dispatchEvent(new CustomEvent(`axe:composer-${what}`))

const currentThread = () => {
  const v = getState().view
  return v.kind === "thread" ? v.id : null
}

/** The chats in sidebar order (pinned first, then newest). */
function orderedThreads() {
  return groupThreads(getState().threads.filter((t) => !t.watchId), new Date()).flatMap((s) => s.threads)
}

function moveThread(step: 1 | -1) {
  const list = orderedThreads()
  if (!list.length) return
  const at = list.findIndex((t) => t.id === currentThread())
  const next = list[at < 0 ? (step === 1 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + step))]
  if (next) void openThread(next.id)
}

function copyLastReply() {
  const id = currentThread()
  const last = [...(getState().messages[id ?? ""] ?? [])].reverse().find((m) => m.role === "assistant")
  if (last) void navigator.clipboard?.writeText(replyText(last.parts))
}

const running = () => {
  const id = currentThread()
  const s = getState()
  return !!id && (!!s.live[id] || !!s.threads.find((t) => t.id === id)?.running)
}

const openThreadSummary = () => getState().threads.find((t) => t.id === currentThread())

/** Who answers on the screen you're on. */
const answererHere = (): Answerer => {
  const id = currentThread()
  const s = getState()
  return id ? nextAnswerer(id, s) : (s.draft.answerer ?? { kind: "axe", modelId: s.catalog?.axe.defaultModelId ?? "auto" })
}
const axeHere = () => answererHere().kind === "axe"

// ---------- Settings sections ----------

export type SettingsSection = "account" | "accounts" | "memory" | "voice" | "notifications" | "clis" | "models" | "updates" | "phone" | "phones" | "phone-log"
let pendingSection: SettingsSection | null = null

/** Opens Settings at a section. */
export function openSettingsAt(section: SettingsSection) {
  pendingSection = section
  openSettings()
  window.dispatchEvent(new CustomEvent("axe:settings-section", { detail: section }))
}

/** The section Settings should scroll to once it's on screen (read once). */
export function takeSettingsSection(): SettingsSection | null {
  const s = pendingSection
  pendingSection = null
  return s
}

export const SHORTCUTS: Shortcut[] = [
  { id: "palette", label: "Search chats and actions", icon: "search", key: "k", run: () => setPalette(!getState().paletteOpen) },
  { id: "new", label: "New chat", icon: "new", key: "n", run: newChat },
  { id: "quick", label: "Open the quick bar", icon: "quick", global: true, words: "spotlight ask anywhere", run: () => void invoke("quick:toggle") },
  { id: "attach", label: "Add files or photos", icon: "attach", key: "u", words: "upload attach image pdf", run: () => composerEvent("attach") },
  { id: "focus", label: "Write a message", icon: "keyboard", key: "l", run: () => composerEvent("focus") },
  { id: "stop", label: "Stop the reply", icon: "stop", key: ".", run: () => void stop(currentThread()!), when: running },
  { id: "copy", label: "Copy the last reply", icon: "copy", key: "c", shift: true, run: copyLastReply, when: () => !!currentThread() },
  { id: "prev", label: "Previous chat", icon: "up", key: "ArrowUp", alt: true, run: () => moveThread(-1) },
  { id: "next", label: "Next chat", icon: "down", key: "ArrowDown", alt: true, run: () => moveThread(1) },
  { id: "sidebar", label: "Show or hide the sidebar", icon: "sidebar", key: "\\", run: () => toggleSidebar() },
  { id: "terminal", label: "Show or hide the terminal", icon: "terminal", key: "j", words: "shell console command line sign in login", run: toggleTerminal },
  { id: "settings", label: "Settings", icon: "settings", key: ",", words: "preferences", run: openSettings },
  { id: "watching", label: "Watching", icon: "eye", words: "watch monitor uptime security alerts price changes every tell me if", run: () => openWatching() },
  {
    id: "new-watch",
    label: "Start a watch",
    icon: "eye",
    words: "watch monitor tell me if keep an eye every",
    run: () => openWatching(),
  },
  { id: "agents", label: "Agents", icon: "helper", words: "helpers assistants library", run: () => openLibrary("agents") },
  { id: "skills", label: "Skills", icon: "skill", words: "skill library install", run: () => openLibrary("skills") },
  { id: "connectors", label: "Connectors", icon: "plug", words: "apps mcp notion linear github integrations", run: () => openLibrary("connectors") },

  {
    id: "pin",
    label: "Pin this chat",
    icon: "pin",
    run: () => void pinThread(currentThread()!, true),
    when: () => !!openThreadSummary() && !openThreadSummary()!.pinned,
  },
  { id: "unpin", label: "Unpin this chat", icon: "pin", run: () => void pinThread(currentThread()!, false), when: () => !!openThreadSummary()?.pinned },
  { id: "archive", label: "Archive this chat", icon: "archive", run: () => void archiveThread(currentThread()!), when: () => !!openThreadSummary() },
  {
    id: "web",
    label: "Search the web when it helps",
    icon: "globe",
    words: "web search on off",
    run: () => setState((s) => ({ draft: { ...s.draft, webSearch: !s.draft.webSearch } })),
    when: axeHere,
  },
  { id: "research", label: "Research", icon: "research", words: "deep research report", run: () => setResearch(!getState().draft.research), when: axeHere },

  // Agent chats (and new agent chats): review what it changed, and how much it may do.
  {
    id: "review",
    label: "Review changes",
    icon: "diff",
    words: "diff undo keep files",
    run: () => openReview(currentThread()),
    when: () => openThreadSummary()?.source === "agent",
  },
  ...(
    [
      ["ask", "Ask before changes"],
      ["acceptEdits", "Accept edits"],
      ["plan", "Plan first"],
      ["full", "Full access"],
    ] as const
  ).map(
    ([mode, label]): Shortcut => ({
      id: `mode-${mode}`,
      label: `Mode: ${label}`,
      icon: "mode",
      words: "permission mode agent",
      run: () => void setMode(currentThread() ?? undefined, mode),
      when: () => !axeHere() && modeOf(currentThread() ?? undefined) !== mode,
    }),
  ),

  { id: "dictate", label: "Dictate", group: "Voice", icon: "mic", key: "d", words: "voice speak microphone hold to talk", run: () => holdDown("composer"), release: holdUp },
  { id: "talk", label: "Talk to Axe", group: "Voice", icon: "talk", key: "t", shift: true, words: "voice conversation speak orb", run: () => void openTalk() },

  { id: "dark", label: "Switch to dark theme", group: "Theme", icon: "dark", run: () => void setTheme("dark") },
  { id: "light", label: "Switch to light theme", group: "Theme", icon: "light", run: () => void setTheme("light") },
  { id: "system", label: "Match the system theme", group: "Theme", icon: "system", run: () => void setTheme("system") },

  { id: "set-account", label: "Account and credits", group: "Settings", icon: "credit", words: "plan billing", run: () => openSettingsAt("account") },
  { id: "set-memory", label: "Memory", group: "Settings", icon: "memory", words: "remember", run: () => openSettingsAt("memory") },
  {
    id: "set-voice",
    label: "Quick bar and voice",
    group: "Settings",
    icon: "keyboard",
    words: "shortcut hotkey microphone",
    run: () => openSettingsAt("voice"),
  },
  { id: "set-clis", label: "CLIs on this computer", group: "Settings", icon: "agent", words: "agents claude code codex install", run: () => openSettingsAt("clis") },
  { id: "set-updates", label: "Check for updates", group: "Settings", icon: "update", words: "version upgrade new release", run: () => (openSettingsAt("updates"), void invoke("updates:check")) },
  {
    id: "restart-update",
    label: "Restart to update",
    group: "Settings",
    icon: "update",
    words: "install new version relaunch",
    run: () => void invoke("updates:install"),
    when: () => getState().update.state.status === "ready",
  },
  { id: "credits", label: "Add credits", group: "Settings", icon: "credit", words: "billing buy", run: () => void invoke("account:openBilling"), when: () => !!getState().profile },
  { id: "signin", label: "Sign in to Axe AI", group: "Settings", icon: "signout", words: "log in account", run: () => void signIn(), when: () => !getState().profile },
  { id: "signout", label: "Sign out", group: "Settings", icon: "signout", words: "log out", run: () => void signOut(), when: () => !!getState().profile },
]

export const shortcutById = (id: string) => SHORTCUTS.find((s) => s.id === id)

const ARROWS: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓" }

/** "⌥⌘↑" on a Mac, "Ctrl+Alt+↑" elsewhere. */
export function keysOf(s: Pick<Shortcut, "key" | "shift" | "alt">): string {
  if (!s.key) return ""
  const key = ARROWS[s.key] ?? s.key.toUpperCase()
  if (isMac()) return `${s.alt ? "⌥" : ""}${s.shift ? "⇧" : ""}⌘${key}`
  return ["Ctrl", s.alt && "Alt", s.shift && "Shift", key].filter(Boolean).join("+")
}

/** The key the palette shows next to an action. */
export function hintOf(s: Shortcut, state: State = getState()): string {
  if (s.global) return displayAccelerator(state.settings.quickBarKey, platform())
  return keysOf(s)
}

/** The shortcut a key press means, if any. */
export function match(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): Shortcut | undefined {
  if (!(isMac() ? e.metaKey : e.ctrlKey)) return undefined
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  return SHORTCUTS.find((s) => s.key && s.key === key && !!s.shift === e.shiftKey && !!s.alt === e.altKey && (!s.when || s.when()))
}

// ---------- The palette's list ----------

export type PaletteEntry = { id: string; group: Group; label: string; icon?: IconName; hint?: string; words?: string; run: () => void }

/** Everything the palette offers right now: actions, then chats, models and agents from the store. */
export function paletteEntries(state: State = getState()): PaletteEntry[] {
  const actions: PaletteEntry[] = SHORTCUTS.filter((s) => s.id !== "palette" && (!s.when || s.when())).map((s) => ({
    id: s.id,
    group: s.group ?? "Actions",
    label: s.label,
    icon: s.icon,
    hint: hintOf(s, state) || undefined,
    words: s.words,
    run: s.run,
  }))
  const chats: PaletteEntry[] = [...state.threads.filter((t) => !t.watchId)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((t) => ({
      id: t.id,
      group: "Chats",
      label: t.title,
      hint: t.source === "agent" && t.agentId ? agentName(t.agentId) : "Axe AI",
      run: () => void openThread(t.id),
    }))
  const here = state.view.kind === "thread" ? state.threads.find((t) => t.id === (state.view as { id: string }).id) : undefined
  // In an agent chat the agent stays; Axe's models can be switched anywhere else.
  const models: PaletteEntry[] =
    here?.source === "agent"
      ? []
      : (state.catalog?.axe.models ?? []).map((m) => ({
          id: `model-${m.id}`,
          group: "Models",
          label: `Answer with ${m.label}`,
          words: `model ${m.provider} ${m.description ?? ""}`,
          run: () => void pickAnswerer({ kind: "axe", modelId: m.id }, here?.id),
        }))
  const agents: PaletteEntry[] = (state.catalog?.agents ?? [])
    .filter((a) => a.state !== "unavailable")
    .map((a) =>
      a.state === "install"
        ? { id: `install-${a.id}`, group: "Agents", label: `Install ${a.name}`, icon: "agent", words: "cli agent", run: () => void installAgent(a.id) }
        : {
            id: `agent-${a.id}`,
            group: "Agents",
            label: `New chat with ${a.name}`,
            icon: "agent",
            words: "cli agent folder",
            run: () => {
              newChat()
              void pickAnswerer({ kind: "agent", agentId: a.id })
            },
          },
    )
  return [...actions, ...chats, ...models, ...agents]
}

/** The palette's list for a query: with nothing typed, the everyday actions and recent chats. */
export function filterPalette(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    // The board's list: everyday actions, then two of each other kind (the theme switch goes the
    // other way from the one showing).
    const pick = (ids: string[], group?: Group) =>
      ids.map((id) => entries.find((e) => e.id === id)).filter((e): e is PaletteEntry => !!e).map((e) => (group ? { ...e, group } : e))
    const of = (group: Group, n: number) => entries.filter((e) => e.group === group).slice(0, n)
    const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    const theme = entries.filter((e) => e.id === (dark ? "light" : "dark"))
    return [
      ...pick(["new", "quick", "attach", "focus", "copy", "new-watch"], "Actions"),
      ...of("Chats", 2),
      ...pick(["dictate", "talk"]),
      ...of("Models", 2),
      ...of("Agents", 2),
      ...theme.slice(0, 1),
    ]
  }
  const terms = q.split(/\s+/)
  const score = (e: PaletteEntry) => {
    const label = e.label.toLowerCase()
    const all = `${label} ${e.words ?? ""} ${e.group.toLowerCase()}`.toLowerCase()
    if (!terms.every((t) => all.includes(t))) return 0
    if (label.startsWith(q)) return 3
    if (label.split(/\s+/).some((w) => w.startsWith(terms[0]!))) return 2
    return 1
  }
  const order: Group[] = ["Actions", "Voice", "Chats", "Models", "Agents", "Settings", "Theme"]
  return entries
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => order.indexOf(a.e.group) - order.indexOf(b.e.group) || b.s - a.s)
    .map((x) => x.e)
}
