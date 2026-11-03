import type { SlashCommand } from "@shared/types"

// The composer's / menu: the agent's commands and skills, then Axe's own starters.

export type SlashItem = Omit<SlashCommand, "source"> & {
  /** watching: Watching's own commands, on the Watching page and in a watch's thread. */
  source: SlashCommand["source"] | "watching"
  /** Watching's command. */
  watch?: WatchCommand
  /** Axe starters put words in the box instead of "/name". */
  insert?: string
  /** Axe starters that switch something on instead, or open a library page; "helper" starts a chat with one of your agents. */
  action?: "research" | "open" | "helper"
  opens?: "skills" | "agents" | "connectors"
  helperId?: string
}

export const AXE_STARTERS: SlashItem[] = [
  { name: "write", description: "Draft something in your voice", source: "axe", insert: "Help me write " },
  { name: "explain", description: "Explain a topic simply", source: "axe", insert: "Explain " },
  { name: "plan", description: "Make a step-by-step plan", source: "axe", insert: "Make a plan for " },
  { name: "summarise", description: "Summarise text you paste", source: "axe", insert: "Summarise this: " },
  { name: "research", description: "Search, read and write a cited report", source: "axe", action: "research" },
  { name: "skills", description: "Browse and add skills", source: "axe", action: "open", opens: "skills" },
  { name: "agents", description: "Start a chat with a ready-made agent", source: "axe", action: "open", opens: "agents" },
  { name: "connectors", description: "Connect Notion, Linear, GitHub and more", source: "axe", action: "open", opens: "connectors" },
]

export type WatchCommand = "check" | "pause" | "resume" | "summary"

/** Watching's group in the / menu. /check, /pause and /resume then ask for a watch with the @ list. */
export const WATCHING_COMMANDS: SlashItem[] = [
  { name: "check", description: "Check a watch now", source: "watching", watch: "check" },
  { name: "pause", description: "Pause a watch", source: "watching", watch: "pause" },
  { name: "resume", description: "Start a paused watch again", source: "watching", watch: "resume" },
  { name: "summary", description: "Show the morning summary now", source: "watching", watch: "summary" },
]

/** "/pause @shop-web": a Watching command typed in full, and the words after it. */
export function watchCommandOf(text: string): { cmd: WatchCommand; rest: string } | null {
  const m = /^\/(check|pause|resume|summary)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return m ? { cmd: m[1] as WatchCommand, rest: (m[2] ?? "").trim() } : null
}

/** What follows the slash while you're still typing the command, or null when the menu should close. */
export function slashQuery(text: string): string | null {
  const m = /^\/([\w:.-]*)$/.exec(text)
  return m ? (m[1] ?? "") : null
}

/** Names that start with the query first, then names or descriptions that contain it. */
export function filterSlash(items: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase()
  if (!q) return items
  const starts = items.filter((i) => i.name.toLowerCase().startsWith(q))
  const rest = items.filter((i) => !starts.includes(i) && (i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)))
  return [...starts, ...rest]
}

/** The text the box holds after picking an item. */
export function pickedText(item: SlashItem): string {
  if (item.insert !== undefined) return item.insert
  if (item.action) return ""
  if (item.watch === "summary") return ""
  if (item.watch) return `/${item.name} @`
  return `/${item.name} `
}

/** "Code reviewer" → "code-reviewer": an agent's name as a / command. */
export const helperCommand = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

/**
 * Agent chats: no research starter (the CLI researches on its own). `skills`: ones installed in Axe.
 * `helpers`: your agents, offered on a new chat only (a chat keeps the agent it started with).
 */
export function slashItems(agent: SlashCommand[], isAgent: boolean, skills: SlashCommand[] = [], helpers: { id: string; name: string; role: string }[] = []): SlashItem[] {
  const starters = isAgent ? AXE_STARTERS.filter((s) => s.action !== "research") : AXE_STARTERS
  const own = skills.filter((k) => !agent.some((a) => a.name === k.name))
  const taken = (name: string) => agent.some((a) => a.name === name) || own.some((k) => k.name === name)
  const yours: SlashItem[] = helpers
    .map((h) => ({ name: helperCommand(h.name), description: h.role, source: "helper" as const, action: "helper" as const, helperId: h.id }))
    .filter((h) => h.name && !taken(h.name))
  return [...agent, ...own, ...yours, ...starters.filter((s) => !taken(s.name) && !yours.some((h) => h.name === s.name))]
}

const RANK: Record<SlashItem["source"], number> = { watching: -1, agent: 0, skill: 1, helper: 2, axe: 3 }

/** The order the menu draws its groups in (the arrow keys walk the same order). */
export const inMenuOrder = (items: SlashItem[]) => [...items].sort((a, b) => RANK[a.source] - RANK[b.source])

/**
 * Where the selection starts: the closest name that starts with the query, the shortest one
 * ("/res" picks /research over a researcher agent), else the top.
 */
export function firstPick(items: SlashItem[], query: string): number {
  const q = query.toLowerCase()
  if (!q) return 0
  let best = -1
  items.forEach((it, i) => {
    if (it.name.toLowerCase().startsWith(q) && (best < 0 || it.name.length < items[best]!.name.length)) best = i
  })
  return Math.max(0, best)
}
