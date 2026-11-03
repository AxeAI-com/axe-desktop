import { randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, rmSync } from "node:fs"

import type { AgentMode, ChatMessage, FolderCopy } from "@shared/types"

import { dataPath, readJSON, writeJSON } from "../paths"

// Chats kept on this computer, one JSON file each in userData/threads:
// - source "agent": a chat started with a CLI agent (the whole transcript lives here);
// - source "axe": turns a CLI agent gave inside an axeai.com chat (the rest is on the server);
// - source "local": a chat with a model on a local server (Ollama, LM Studio…), all of it here.

export type LocalThread = {
  id: string
  source: "agent" | "axe" | "local"
  agentId?: string
  /** Local chats: the model's id ("<server>|<model>"). */
  localModel?: string
  cwd?: string
  title: string
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
  /** Agent chats: the axeai.com chat that Axe answers in when you switch to an Axe model. */
  axeThreadId?: string
  /** How many of `messages` Axe has already been given (the rest go as context next time). */
  axeSeen?: number
  /** Agent chats: how much it may do on its own (Ask when missing), and the mode before Plan. */
  mode?: AgentMode
  beforePlan?: AgentMode
  /** Agent chats: the model and effort picked for it (option id to value), applied when its session starts. */
  config?: Record<string, string>
  /** Agent chats that work in a copy of the folder (`cwd` is the copy). */
  copy?: FolderCopy
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/
const dir = () => {
  const d = dataPath("threads")
  mkdirSync(d, { recursive: true })
  return d
}
const fileFor = (id: string) => {
  if (!SAFE_ID.test(id)) throw new Error("Bad chat id.")
  return dataPath("threads", `${id}.json`)
}

let cache: Map<string, LocalThread> | undefined

function all(): Map<string, LocalThread> {
  if (cache) return cache
  cache = new Map()
  for (const name of readdirSync(dir())) {
    if (!name.endsWith(".json")) continue
    const t = readJSON<LocalThread | null>(dataPath("threads", name), null)
    if (t && typeof t.id === "string" && SAFE_ID.test(t.id) && Array.isArray(t.messages)) cache.set(t.id, t)
  }
  return cache
}

export const AGENT_PREFIX = "agent_"
export const isLocalId = (id: string) => id.startsWith(AGENT_PREFIX)

/** A sidebar title from the first message: its first line, cut at a word. */
export function titleFrom(text: string): string {
  const line = text.trim().split("\n").find((l) => l.trim())?.trim().replace(/\s+/g, " ") ?? ""
  if (!line) return "New chat"
  if (line.length <= 60) return line
  const cut = line.slice(0, 60)
  const space = cut.lastIndexOf(" ")
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`
}

export function listLocal(): LocalThread[] {
  return [...all().values()]
}

export function getLocal(id: string): LocalThread | undefined {
  return all().get(id)
}

export function saveLocal(t: LocalThread) {
  all().set(t.id, t)
  writeJSON(fileFor(t.id), t)
}

export function deleteLocal(id: string) {
  all().delete(id)
  rmSync(fileFor(id), { force: true })
}

export function newAgentThread(options: { agentId: string; cwd: string; text: string }): LocalThread {
  const now = new Date().toISOString()
  const t: LocalThread = {
    id: `${AGENT_PREFIX}${randomUUID()}`,
    source: "agent",
    agentId: options.agentId,
    cwd: options.cwd,
    title: titleFrom(options.text),
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  saveLocal(t)
  return t
}

/** A chat with a model on a local server. */
export function newLocalModelThread(options: { modelId: string; text: string }): LocalThread {
  const now = new Date().toISOString()
  const t: LocalThread = {
    id: `${AGENT_PREFIX}${randomUUID()}`,
    source: "local",
    localModel: options.modelId,
    title: titleFrom(options.text),
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
  saveLocal(t)
  return t
}

/** Turns an agent (or Do it) gave inside an axeai.com chat. */
export function overlayFor(axeThreadId: string, create: { agentId?: string; cwd?: string } | undefined): LocalThread | undefined {
  const existing = getLocal(axeThreadId)
  if (existing || !create) return existing
  const now = new Date().toISOString()
  const t: LocalThread = { id: axeThreadId, source: "axe", ...create, title: "", pinned: false, archived: false, createdAt: now, updatedAt: now, messages: [] }
  saveLocal(t)
  return t
}

/** Tests only: re-read from disk. */
export function resetStoreForTests() {
  cache = undefined
}
