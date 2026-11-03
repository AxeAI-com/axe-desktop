import type { ThreadSummary } from "@shared/types"

// The quick bar's decisions, kept apart from its drawing so they can be tested.

/** After this long hidden, the bar opens empty instead of on the last answer. */
export const QUICK_IDLE_RESET_MS = 5 * 60_000

/** The folder an agent last worked in (its newest chat), so asking it from the bar needs no picker. */
export function quickCwd(threads: ThreadSummary[], agentId: string): string | undefined {
  return [...threads]
    .filter((t) => t.source === "agent" && t.agentId === agentId && t.cwd)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]?.cwd
}

export type QuickKey = { key: string; mod: boolean; shift: boolean; composing?: boolean }
export type QuickState = { menuOpen: boolean; hasText: boolean; answered: boolean; hasThread: boolean; dictating: boolean }
export type QuickAction = "none" | "send" | "open" | "hide" | "menu-up" | "menu-down" | "menu-pick" | "menu-close" | "stop-dictation"

/**
 * What a key in the bar's box does. Enter asks (or, on a finished answer with nothing typed, opens
 * it as a full chat); ⌘Enter always opens; Esc closes a list, then a recording, then the bar.
 */
export function quickKeyAction(k: QuickKey, s: QuickState): QuickAction {
  if (k.composing) return "none"
  if (s.menuOpen) {
    if (k.key === "ArrowDown") return "menu-down"
    if (k.key === "ArrowUp") return "menu-up"
    if (k.key === "Enter") return "menu-pick"
    if (k.key === "Escape") return "menu-close"
  }
  if (k.key === "Escape") return s.dictating ? "stop-dictation" : "hide"
  if (k.key !== "Enter" || k.shift) return "none"
  if (k.mod) return s.hasThread ? "open" : s.hasText ? "send" : "none"
  if (s.hasText) return "send"
  if (s.answered) return "open"
  return "none"
}

/** The quick bar's / menu: /watch starts a watch; /write puts words in the box. */
export type QuickCommand = { name: "watch" | "write"; label: string; description: string; insert?: string }
export const QUICK_COMMANDS: QuickCommand[] = [
  { name: "watch", label: "Watch", description: "Check something on a schedule" },
  { name: "write", label: "Write", description: "Draft in your voice", insert: "Help me write " },
]

/** While you type a command ("/wa"), the list with the best match first; null when it isn't one. */
export function quickSlash(text: string): QuickCommand[] | null {
  const m = /^\/(\w*)$/.exec(text)
  if (!m) return null
  const q = m[1]!.toLowerCase()
  const starts = QUICK_COMMANDS.filter((c) => c.name.startsWith(q))
  return [...starts, ...QUICK_COMMANDS.filter((c) => !starts.includes(c))]
}

/** "/watch tell me if lane-ceramics.com goes down", typed in full: the sentence after it. */
export function typedWatch(text: string): string | null {
  const m = /^\/watch(?:\s+([\s\S]*))?$/i.exec(text.trim())
  return m ? (m[1] ?? "").trim() : null
}

/** How long the bar shows "Watching …" before it closes by itself. */
export const QUICK_STARTED_MS = 4_000
