import { randomUUID } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { pathToFileURL } from "node:url"

import type { ContentBlock, RequestPermissionRequest, RequestPermissionResponse, SessionUpdate } from "@agentclientprotocol/sdk"

import type {
  AgentMode,
  AgentOption,
  Answerer,
  ChatMessage,
  FileChange,
  InstructionsFile,
  Json,
  Part,
  PermissionRequest,
  SendRequest,
  SlashCommand,
  ThreadSummary,
} from "@shared/types"

import { fromACP, instructionsFiles, instructionsPath, mergeCommands, onDisk, starterText } from "./agents/commands"
import { forgetTracker, trackerFor } from "./agents/changes"
import { cachedOptions, fromACP as optionsFromACP, nextToApply, rememberOptions, withPicks } from "./agents/config"
import {
  autoAnswer,
  isMode,
  modeAfterPlan,
  modeFromNative,
  nativeMode,
  parsePlan,
  PLAN_ONLY_NOTE,
  planOptions,
  planRequest,
  toolPaths,
  touchesFiles,
} from "./agents/modes"
import { makeCopy, removeCopyIfEmpty } from "./agents/workspace"

import { type LaunchSpec, launchSpec } from "./agents/registry"
import { AgentSession } from "./agents/session"
import { deleteLocal, getLocal, isLocalId, type LocalThread, listLocal, newAgentThread, newLocalModelThread, overlayFor, saveLocal, titleFrom } from "./agents/store"
import { inputText, ReplyBuilder } from "./agents/updates"
import { client, currentProfile, isSignedIn, onSignedOut, refresh, sessionEnded } from "./axe/account"
import { AxeError, type AxeThread } from "./axe/client"
import { type Capabilities, capabilities, ensureServer, type LocalMessage, localBrain, localModelName, streamLocal } from "./local-models"
import { localFiles } from "./local-attachments"
import { settings, updateSettings } from "./settings"
import {
  applyChunk,
  cleanTitle,
  CONTEXT_CLOSE,
  CONTEXT_OPEN,
  finishReply,
  LIBRARY_CLOSE,
  LIBRARY_OPEN,
  leakedTitle,
  MEMORY_CLOSE,
  MEMORY_OPEN,
  messageText,
  plainTitle,
  publicMessage,
  storedMessage,
} from "./axe/stream"
import { emit } from "./bus"
import { MemoryStore, memoryText } from "./memory"
import { notify } from "./notify"
import { allMeta, type ChatMeta, chatMeta, contextFor, hub, setChatMeta, skills } from "./libraries"
import { getHelper } from "./libraries/helpers"
import { slashSkill } from "./libraries/skills"
import { type Brain, runToolTurn, SYSTEM as CONNECTORS_SYSTEM } from "./libraries/tool-turn"

// Every chat, whoever answers it. Axe chats live on axeai.com; agent chats live
// on this computer (agents/store.ts). Switching who answers keeps the same chat:
// each message records its answerer, and an answerer that missed turns gets them
// as context ahead of the next message.

type AgentResolver = (agentId: string) => Promise<{ name: string; spec: LaunchSpec }>

let resolveAgent: AgentResolver = launchSpec
let defaultFolder = () => homedir()
let homeFolder = () => homedir()

/** What Axe remembers about whoever is signed in. */
export const memory = new MemoryStore(() => currentProfile()?.id ?? currentProfile()?.email ?? undefined)

/** Tests swap in a fake agent, folder and home. */
export function configureChat(options: { resolveAgent?: AgentResolver; defaultFolder?: () => string; homeFolder?: () => string }) {
  if (options.resolveAgent) resolveAgent = options.resolveAgent
  if (options.defaultFolder) defaultFolder = options.defaultFolder
  if (options.homeFolder) homeFolder = options.homeFolder
}

type Turn = { reply: ChatMessage; stop: () => void }
type Live = {
  session: AgentSession
  seen: number
  turn?: { builder: ReplyBuilder; changed: () => void; threadId: string; asks: AbortController }
  /** Ends the chat's key on Axe's MCP server. */
  release?: () => void
  /** What the agent advertised for the / menu. */
  commands?: SlashCommand[]
}

const running = new Map<string, Turn>()

/** What remote control follows (remote/): a question asked or answered, a turn ended. */
export type TurnEvent =
  | { kind: "ask"; request: PermissionRequest }
  | { kind: "answered"; id: string; threadId: string }
  | { kind: "end"; threadId: string; reply: ChatMessage; error?: string }
const turnListeners = new Set<(e: TurnEvent) => void>()
export function onTurnEvent(fn: (e: TurnEvent) => void) {
  turnListeners.add(fn)
  return () => turnListeners.delete(fn)
}
function turnEvent(e: TurnEvent) {
  for (const fn of turnListeners) {
    try {
      fn(e)
    } catch {}
  }
}

/** Is any chat working now (keep-awake, background)? */
export const isBusy = () => running.size > 0
export const isRunning = (threadId: string) => running.has(threadId)
/** How many chats are working now (remote control's summary). */
export const runningCount = () => running.size

/** A chat's title as the sidebar shows it. */
export function threadTitle(threadId: string): string | undefined {
  const t = serverThreads.find((x) => x.id === threadId)
  return getLocal(threadId)?.title || (t ? cleanTitle(t.title) : undefined)
}
const sessions = new Map<string, Live>()
const permissions = new Map<string, { threadId: string; resolve: (optionId: string | null) => void; plan?: { partId: string; start?: string } }>()
let serverThreads: AxeThread[] = []
const agentNames = new Map<string, string>()
const localNames = new Map<string, string>()

onSignedOut(() => {
  serverThreads = []
  for (const [id, turn] of running) if (!isLocalId(id)) turn.stop()
  emitThreads()
})

// Threads

/** A chat's agent and connectors, for the sidebar and the composer. */
function withMeta(s: ThreadSummary, meta: ChatMeta | undefined): ThreadSummary {
  if (meta?.helperId) s.helperId = meta.helperId
  if (meta?.connectors?.length) s.connectors = meta.connectors
  if (meta?.watchId) s.watchId = meta.watchId
  return s
}

function summaries(): ThreadSummary[] {
  const meta = allMeta()
  const locals = listLocal()
  const linked = new Set(locals.map((t) => t.axeThreadId).filter((x): x is string => !!x))
  const overlays = new Map(locals.filter((t) => t.source === "axe").map((t) => [t.id, t]))
  const out: ThreadSummary[] = []
  for (const t of serverThreads) {
    if (linked.has(t.id) || t.archived) continue
    const o = overlays.get(t.id)
    const updatedAt = o && o.updatedAt > t.updatedAt ? o.updatedAt : t.updatedAt
    out.push(withMeta({ id: t.id, source: "axe", title: cleanTitle(t.title), pinned: t.pinned, updatedAt, running: running.has(t.id) }, meta[t.id]))
  }
  for (const t of locals) {
    if (t.source === "local" && !t.archived) {
      const s: ThreadSummary = { id: t.id, source: "local", title: t.title, pinned: t.pinned, updatedAt: t.updatedAt, running: running.has(t.id) }
      if (t.localModel) s.localModel = t.localModel
      out.push(withMeta(s, meta[t.id]))
      continue
    }
    if (t.source !== "agent" || t.archived) continue
    const s: ThreadSummary = { id: t.id, source: "agent", title: t.title, pinned: t.pinned, updatedAt: t.updatedAt, running: running.has(t.id) }
    if (t.agentId) s.agentId = t.agentId
    if (t.cwd) s.cwd = t.cwd
    s.mode = t.mode ?? "ask"
    if (t.copy) s.copy = t.copy
    out.push(withMeta(s, meta[t.id]))
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

export function emitThreads() {
  emit("threads", summaries())
}

/** Every chat, newest first. Fetches axeai.com's list when signed in. */
export async function listThreads(): Promise<ThreadSummary[]> {
  if (isSignedIn()) {
    try {
      serverThreads = await client().threads()
    } catch (e) {
      sessionEnded(e)
    }
  }
  const list = summaries()
  emit("threads", list)
  return list
}

const byTime = (a: ChatMessage, b: ChatMessage) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")

async function axeTranscript(threadId: string): Promise<ChatMessage[]> {
  const raw = isSignedIn() ? await client().messages(threadId) : []
  const server = raw.map(storedMessage).filter((m): m is ChatMessage => m !== undefined)
  const overlay = getLocal(threadId)?.messages ?? []
  const merged = [...server, ...overlay.filter((m) => !server.some((s) => s.id === m.id))]
  return merged.every((m) => m.createdAt) ? merged.sort(byTime) : merged
}

export async function threadMessages(threadId: string): Promise<ChatMessage[]> {
  const local = isLocalId(threadId) ? getLocal(threadId) : undefined
  let messages: ChatMessage[]
  if (local) messages = local.messages
  else {
    try {
      messages = await axeTranscript(threadId)
    } catch (e) {
      sessionEnded(e)
      throw new Error(e instanceof AxeError ? e.plain : "Couldn't load this chat.")
    }
    // A reply still streaming isn't on the server yet.
    const live = running.get(threadId)?.reply
    if (live && !messages.some((m) => m.id === live.id)) messages = [...messages, live]
  }
  return messages.map(publicMessage)
}

function closeSession(threadId: string) {
  sessions.get(threadId)?.release?.()
  sessions.get(threadId)?.session.close()
  sessions.delete(threadId)
}

export async function renameThread(threadId: string, title: string) {
  const clean = title.trim().slice(0, 200)
  if (!clean) return
  const local = isLocalId(threadId) ? getLocal(threadId) : undefined
  if (local) saveLocal({ ...local, title: clean })
  else {
    await client().updateThread(threadId, { title: clean })
    serverThreads = serverThreads.map((t) => (t.id === threadId ? { ...t, title: clean } : t))
  }
  emitThreads()
}

export async function pinThread(threadId: string, pinned: boolean) {
  const local = isLocalId(threadId) ? getLocal(threadId) : undefined
  if (local) saveLocal({ ...local, pinned })
  else {
    await client().updateThread(threadId, { pinned })
    serverThreads = serverThreads.map((t) => (t.id === threadId ? { ...t, pinned } : t))
  }
  emitThreads()
}

export async function archiveThread(threadId: string) {
  running.get(threadId)?.stop()
  closeSession(threadId)
  const local = isLocalId(threadId) ? getLocal(threadId) : undefined
  if (local) saveLocal({ ...local, archived: true })
  else {
    await client().updateThread(threadId, { archived: true })
    serverThreads = serverThreads.filter((t) => t.id !== threadId)
  }
  emitThreads()
}

export async function deleteThread(threadId: string) {
  running.get(threadId)?.stop()
  closeSession(threadId)
  const local = getLocal(threadId)
  if (isLocalId(threadId)) {
    if (local?.axeThreadId && isSignedIn()) await client().deleteThread(local.axeThreadId).catch(() => {})
  } else {
    await client().deleteThread(threadId)
    serverThreads = serverThreads.filter((t) => t.id !== threadId)
  }
  if (local) deleteLocal(threadId)
  forgetTracker(threadId)
  if (local?.copy && local.cwd) void removeCopyIfEmpty(local.cwd, local.copy)
  setChatMeta(threadId, { helperId: undefined, connectors: undefined, allowed: undefined })
  emitThreads()
}

// Sending

/** Reply updates go out about 20 times a second, and always once when done. */
function replyEmitter(threadId: string, reply: ChatMessage, startedAt: number) {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const send = () => {
    timer = undefined
    last = Date.now()
    emit("reply", { threadId, message: publicMessage(reply), done: false, startedAt })
  }
  return {
    changed() {
      if (timer) return
      const wait = 50 - (Date.now() - last)
      if (wait <= 0) send()
      else timer = setTimeout(send, wait)
    },
    done(error?: string) {
      if (timer) clearTimeout(timer)
      timer = undefined
      const update = { threadId, message: publicMessage(reply), done: true, startedAt, ...(error ? { error } : {}) }
      emit("reply", update)
      turnEvent({ kind: "end", threadId, reply, ...(error ? { error } : {}) })
    },
  }
}

function chooseFolder(cwd: string | undefined): string {
  if (cwd) {
    try {
      if (statSync(cwd).isDirectory()) return cwd
    } catch {}
    throw new Error("That folder isn't there anymore. Pick another one.")
  }
  return defaultFolder()
}

const plainError = (e: unknown) => (e instanceof AxeError ? e.plain : e instanceof Error ? e.message : String(e))

function answererName(a: Answerer | undefined): string {
  if (!a) return "Assistant"
  if (a.kind === "local") return localNames.get(a.modelId) ?? "Local model"
  return a.kind === "agent" ? (agentNames.get(a.agentId) ?? a.agentId) : "Axe"
}

/** Earlier turns as plain text, newest kept when it's long. */
export function contextText(messages: ChatMessage[], limit = 24_000): string {
  const lines: string[] = []
  for (const m of messages) {
    const text = messageText(m).trim()
    if (!text) continue
    lines.push(`${m.role === "user" ? "User" : answererName(m.answerer)}: ${text}`)
  }
  let out = lines.join("\n\n")
  if (out.length > limit) out = `…${out.slice(out.length - limit)}`
  return out
}

const withContext = (context: string, text: string, remember = "") =>
  [remember && `${MEMORY_OPEN}\n${remember}\n${MEMORY_CLOSE}`, context && `${CONTEXT_OPEN}\n${context}\n${CONTEXT_CLOSE}`, text].filter(Boolean).join("\n\n")

/** Memory goes with the first message of a chat only, like a system note. */
function rememberFor(firstMessage: boolean): string {
  if (!firstMessage) return ""
  try {
    return memoryText(memory.list())
  } catch {
    return ""
  }
}

const withLibrary = (library: string, text: string) => (library ? `${LIBRARY_OPEN}\n${library}\n${LIBRARY_CLOSE}\n\n${text}` : text)

/**
 * "/brand-voice …" names a skill installed in Axe. Axe models get its instructions with the message;
 * a CLI agent gets them only when the skill isn't in its own folders (then it runs it itself).
 */
async function pickedSkill(text: string, answerer: Answerer, cwd: string | undefined): Promise<string | undefined> {
  const s = slashSkill(text)
  if (!s || !(await skills.installed(s.id))) return undefined
  if (answerer.kind === "agent" && (await onDisk(answerer.agentId, cwd, homeFolder())).some((c) => c.name === s.id)) return undefined
  return s.id
}

/**
 * Puts a finished message into a chat on this computer (a watch's result), making the chat the first time.
 * `send()` can keep talking in it afterwards. Returns the chat's id.
 */
export function postMessage(opts: { threadId: string | null; title: string; answerer: Answerer; cwd?: string; message: ChatMessage }): string {
  let local = opts.threadId ? getLocal(opts.threadId) : undefined
  if (!local) {
    local =
      opts.answerer.kind === "local"
        ? newLocalModelThread({ modelId: opts.answerer.modelId, text: opts.title })
        : newAgentThread({ agentId: opts.answerer.kind === "agent" ? opts.answerer.agentId : "", cwd: chooseFolder(opts.cwd), text: opts.title })
  }
  local.messages.push(opts.message)
  local.updatedAt = opts.message.createdAt ?? new Date().toISOString()
  saveLocal(local)
  emitThreads()
  return local.id
}

/** Starts a reply; updates arrive as "reply" events. */
export async function send(request: SendRequest): Promise<{ threadId: string }> {
  const text = request.text.trim()
  const attachments = request.attachments ?? []
  if (!text && !attachments.length) throw new Error("Write a message first.")
  const answerer = request.answerer
  // New chats in every window (the app, the menu bar) start with what you used last.
  const latest = { answerer, ...(request.mode && isMode(request.mode) ? { mode: request.mode } : {}) }
  if (!request.keepDefaults && (JSON.stringify(settings().answerer) !== JSON.stringify(answerer) || (latest.mode && latest.mode !== settings().mode)))
    updateSettings(latest)
  let threadId = request.threadId
  let local: LocalThread | undefined

  const helper = !request.threadId && request.helperId ? getHelper(request.helperId) : undefined
  const startConnectors = request.connectors ?? helper?.connectors ?? []
  if (!threadId) {
    if (answerer.kind === "local") {
      local = newLocalModelThread({ modelId: answerer.modelId, text: request.title || text || attachments[0]?.name || "" })
      threadId = local.id
    } else if (answerer.kind === "agent") {
      local = newAgentThread({ agentId: answerer.agentId, cwd: chooseFolder(request.cwd), text: request.title || text || attachments[0]?.name || "" })
      if (request.mode && isMode(request.mode) && request.mode !== "ask") {
        local.mode = request.mode
        saveLocal(local)
      }
      threadId = local.id
    } else {
      let t = await client().createThread()
      // Do it and connector turns never reach the server's chat endpoint, so the server can't name the chat.
      if (request.doIt || startConnectors.length || request.title) {
        const title = titleFrom(request.title || text || attachments[0]?.name || "")
        await client().updateThread(t.id, { title }).catch(() => {})
        t = { ...t, title }
      }
      serverThreads = [t, ...serverThreads.filter((x) => x.id !== t.id)]
      threadId = t.id
    }
    setChatMeta(threadId, { helperId: helper?.id, connectors: startConnectors.length ? startConnectors : undefined, watchId: request.watchId })
  } else if (isLocalId(threadId)) {
    local = getLocal(threadId)
    if (!local) throw new Error("That chat isn't here anymore.")
  }
  // A local model's chat lives only on this computer, so it stays with local models (any of them).
  if ((local?.source === "local") !== (answerer.kind === "local")) throw new Error(answerer.kind === "local" ? "Local models answer in a new chat of their own." : "This chat is with a local model. Start a new chat to use another.")

  running.get(threadId)?.stop()
  const now = new Date()
  const user: ChatMessage = {
    id: request.messageId && SAFE_MESSAGE_ID.test(request.messageId) ? request.messageId : randomUUID(),
    role: "user",
    parts: text ? [{ type: "text", id: randomUUID(), text }] : [],
    answerer,
    createdAt: now.toISOString(),
    ...(attachments.length ? { attachments } : {}),
  }
  const reply: ChatMessage = { id: randomUUID(), role: "assistant", parts: [], answerer, createdAt: new Date(now.getTime() + 1).toISOString() }
  const id = threadId
  // The chat shows what you typed; the model also gets the background, when there is some.
  request = request.context ? { ...request, text: `${request.context}\n\n${text}` } : request
  const skill = await pickedSkill(text, answerer, local?.cwd)
  const turn =
    answerer.kind === "local"
      ? localAnswer(id, local!, answerer.modelId, request, user, reply, { first: !request.threadId, skill })
      : answerer.kind === "agent"
      ? agentTurn(id, local, answerer.agentId, request, user, reply, skill)
      : request.doIt
        ? doItTurn(id, local, answerer.modelId, request, user, reply)
        : chatMeta(id).connectors?.length
          ? connectorTurn(id, local, answerer.modelId, request, user, reply, { first: !request.threadId, skill })
          : axeTurn(id, local, answerer.modelId, request, user, reply, { first: !request.threadId, skill })
  void turn
  return { threadId: id }
}

/** Ids the window may give a message: a UUID or similar, nothing that could reach a path. */
const SAFE_MESSAGE_ID = /^[A-Za-z0-9_-]{8,80}$/

async function agentTurn(
  threadId: string,
  local: LocalThread | undefined,
  agentId: string,
  request: SendRequest,
  user: ChatMessage,
  reply: ChatMessage,
  skill?: string,
) {
  const startedAt = Date.now()
  const out = replyEmitter(threadId, reply, startedAt)
  let stopped = false
  running.set(threadId, { reply, stop: () => ((stopped = true), void sessions.get(threadId)?.session.cancel()) })
  let error: string | undefined
  let record: LocalThread | undefined
  const builder = new ReplyBuilder(reply)
  try {
    // What came before, so a new or switched-in agent has the context.
    let transcript: ChatMessage[]
    if (local) {
      record = local
      transcript = [...local.messages]
    } else {
      transcript = await axeTranscript(threadId).catch(() => getLocal(threadId)?.messages ?? [])
      record = overlayFor(threadId, { agentId, cwd: chooseFolder(request.cwd) })!
    }
    // A new chat that works in its own copy of the folder gets it before the agent starts.
    if (request.copy && !record.copy && !record.messages.length && record.cwd) {
      const made = await makeCopy(record.cwd, record.id, record.title)
      record.cwd = made.cwd
      record.copy = made.copy
    }
    const cwd = record.cwd ?? defaultFolder()
    const tracker = trackerFor(threadId, cwd)
    tracker.beginTurn(user.id)
    record.agentId = agentId
    record.messages.push(user, reply)
    record.updatedAt = user.createdAt!
    saveLocal(record)
    emitThreads()

    let live = sessions.get(threadId)
    if (live && (live.session.agentId !== agentId || live.session.cwd !== cwd || live.session.closed)) {
      closeSession(threadId)
      live = undefined
    }
    if (!live) {
      const { name, spec } = await resolveAgent(agentId)
      agentNames.set(agentId, name)
      const holder: Live = { seen: 0, session: undefined as unknown as AgentSession }
      holder.session = new AgentSession(agentId, name, cwd, spec, {
        onUpdate: (n) => {
          const id = holder.turn?.threadId ?? threadId
          if (n.update.sessionUpdate === "current_mode_update") {
            holder.session.currentMode = n.update.currentModeId
            followNativeMode(id, n.update.currentModeId)
            return
          }
          if (n.update.sessionUpdate === "config_option_update") {
            holder.session.configOptions = n.update.configOptions
            publishOptions(id, holder.session)
            return
          }
          if (n.update.sessionUpdate === "tool_call" || n.update.sessionUpdate === "tool_call_update") saveBeforeChange(id, cwd, n.update)
          if (n.update.sessionUpdate === "available_commands_update") {
            holder.commands = fromACP(n.update.availableCommands)
            const id = holder.turn?.threadId ?? threadId
            void commandsFor(id).then((commands) => emit("commands", { threadId: id, commands }))
            return
          }
          const t = holder.turn
          if (t && t.builder.apply(n.update)) t.changed()
        },
        onPermission: (p, signal) => agentPermission(holder.turn?.threadId ?? threadId, holder, cwd, p, signal),
        beforeWrite: (path) => trackerFor(holder.turn?.threadId ?? threadId, cwd).capture([path]),
        // Axe's own browser and computer use, as tools the agent can call (risky steps ask in this chat),
        // and your connectors, as MCP servers the agent calls itself.
        mcpServers: async (http) => {
          const { mcpFor } = await import("./doit/agent-tools")
          const mcp = await mcpFor({
            http,
            userText: () => "",
            fullAccess: () => fullAccessIn(holder.turn?.threadId ?? threadId),
            ask: async (q) => {
              const t = holder.turn
              if (!t) return false
              const options = [
                { id: "allow", label: "Allow", kind: "allow_once" as const },
                { id: "deny", label: "Don't allow", kind: "reject_once" as const },
              ]
              return (await askUser(t.threadId, { title: q.title, ...(q.detail ? { detail: q.detail } : {}), options }, t.asks.signal)) === "allow"
            },
          })
          holder.release = mcp.release
          return [mcp.server, ...(await hub().acpServers(http).catch(() => []))]
        },
      })
      live = holder
      sessions.set(threadId, live)
    }
    if (stopped) throw new Stopped()
    live.turn = { builder, changed: out.changed, threadId, asks: new AbortController() }
    const context = contextText(transcript.slice(live.seen))
    const remember = rememberFor(live.seen === 0)
    const mode = modeOf(threadId)
    const planInWords = await syncMode(live.session, mode)
    if (!record.config) {
      // A new chat starts with the model and effort you used last with this agent.
      record.config = { ...picksOf(threadId, agentId) }
      saveLocal(record)
    }
    await syncConfig(threadId, live.session)
    const meta = chatMeta(threadId)
    const library = await contextFor({ helperId: meta.helperId, skillIds: skill ? [skill] : [], start: live.seen === 0 })
    const blocks: ContentBlock[] = []
    if (library) blocks.push({ type: "text", text: `${LIBRARY_OPEN}\n${library}\n${LIBRARY_CLOSE}` })
    if (remember) blocks.push({ type: "text", text: `${MEMORY_OPEN}\n${remember}\n${MEMORY_CLOSE}` })
    if (planInWords) blocks.push({ type: "text", text: PLAN_ONLY_NOTE })
    if (context) blocks.push({ type: "text", text: `${CONTEXT_OPEN}\n${context}\n${CONTEXT_CLOSE}` })
    if (request.text.trim()) blocks.push({ type: "text", text: request.text.trim() })
    for (const a of request.attachments ?? []) blocks.push({ type: "resource_link", uri: pathToFileURL(a.path).href, name: a.name, mimeType: a.mime, size: a.size })
    const result = await live.session.prompt(blocks)
    builder.usage(result.usage)
    builder.finish(result.stopReason)
    live.seen = (local ? record.messages.length : transcript.length + 2)
  } catch (e) {
    if (!(e instanceof Stopped)) {
      error = plainError(e)
      builder.error(error)
    } else builder.finish("cancelled")
    // A dead process can't take the next message.
    const live = sessions.get(threadId)
    if (live && (live.session.closed || !live.session.running)) closeSession(threadId)
  } finally {
    const live = sessions.get(threadId)
    // Cards for Axe's tools that are still open are withdrawn with the turn.
    live?.turn?.asks.abort()
    if (live) live.turn = undefined
    if (running.get(threadId)?.reply === reply) running.delete(threadId)
    if (record) {
      record.updatedAt = new Date().toISOString()
      saveLocal(record)
    }
    out.done(error)
    emitThreads()
    void emitChanges(threadId)
    if (!stopped) {
      const name = agentNames.get(agentId) ?? "The agent"
      notify({
        threadId,
        kind: error ? "failed" : "done",
        title: record?.title || name,
        body: error ? `${name} stopped: ${error}` : `${name} finished.`,
      })
    }
  }
}

class Stopped extends Error {}

/** The website sometimes names a new chat after the context the app sent ahead of your words; name it after your words. */
async function fixLeakedTitle(threadId: string, serverId: string, text: string) {
  const t = serverThreads.find((x) => x.id === serverId)
  if (t && leakedTitle(t.title)) await renameThread(threadId, plainTitle(text)).catch(() => {})
}

type AxeTurnMode = {
  /** The chat's first message: memory goes with it. */
  first: boolean
  /** A skill you picked from / (its instructions go with this message). */
  skill?: string
  /** Redo the last answer (approving research) instead of sending `user`. */
  regenerate?: boolean
  researchApproved?: boolean
}

async function axeTurn(
  threadId: string,
  local: LocalThread | undefined,
  modelId: string,
  request: SendRequest,
  user: ChatMessage | null,
  reply: ChatMessage,
  mode: AxeTurnMode,
) {
  const startedAt = Date.now()
  const out = replyEmitter(threadId, reply, startedAt)
  const abort = new AbortController()
  running.set(threadId, { reply, stop: () => abort.abort() })
  let error: string | undefined
  let first = mode.first
  // The chat on axeai.com (an agent chat that switched to Axe has its own linked one).
  let serverId = threadId
  try {
    const c = client()
    // Turns another answerer gave since Axe last answered here.
    const overlay = local ?? getLocal(threadId)
    const unseen = overlay ? overlay.messages.slice(overlay.axeSeen ?? 0) : []
    const at = user?.createdAt ?? reply.createdAt!
    if (local) {
      if (!local.axeThreadId) {
        local.axeThreadId = (await c.createThread()).id
        first = true
      }
      serverId = local.axeThreadId
      local.messages.push(...(user ? [user] : []), reply)
      local.updatedAt = at
      saveLocal(local)
    } else {
      serverThreads = serverThreads.map((t) => (t.id === threadId ? { ...t, updatedAt: at } : t))
    }
    emitThreads()
    const text = request.text.trim()
    const context = mode.regenerate ? "" : contextText(unseen, Math.max(0, 30_000 - text.length))
    const ids: string[] = []
    for (const a of request.attachments ?? []) ids.push(await c.upload(a.path, a.name, a.mime))
    const meta = chatMeta(threadId)
    const library = mode.regenerate
      ? ""
      : await contextFor({ helperId: meta.helperId, skillIds: mode.skill ? [mode.skill] : [], start: first })
    const body = withLibrary(library, withContext(context, text, mode.regenerate ? "" : rememberFor(first)))
    const options = {
      modelId,
      webSearch: !!request.webSearch,
      attachments: ids,
      research: !!request.research,
      researchApproved: !!mode.researchApproved,
      regenerate: !!mode.regenerate,
    }
    for await (const chunk of c.send(serverId, user?.id ?? reply.id, body, options, abort.signal)) {
      error = applyChunk(reply, chunk) ?? error
      out.changed()
    }
    if (overlay) {
      overlay.axeSeen = overlay.messages.length
      saveLocal(overlay)
    }
  } catch (e) {
    if (!abort.signal.aborted) {
      error = plainError(e)
      sessionEnded(e)
      if (!reply.parts.some((p) => p.type === "error")) reply.parts.push({ type: "error", id: randomUUID(), text: error })
    }
  } finally {
    finishReply(reply)
    if (running.get(threadId)?.reply === reply) running.delete(threadId)
    if (local) {
      local.updatedAt = new Date().toISOString()
      saveLocal(local)
    }
    out.done(error)
    // The server names new chats; pick that up for the sidebar. Credits changed too.
    if (isSignedIn()) {
      void listThreads().then(() => (first && request.text.trim() ? fixLeakedTitle(threadId, serverId, request.text) : undefined))
      void refresh().catch(() => {})
    } else emitThreads()
  }
}

/**
 * A model on a local server (Ollama, LM Studio, llama.cpp, one the user added): the whole chat is sent
 * each turn, it streams back over the OpenAI API, and everything stays on this computer. Plain chat:
 * its files go in the message (text inline, photos when it can see). Tools go through localAnswer.
 */
async function localTurn(
  threadId: string,
  local: LocalThread,
  modelId: string,
  request: SendRequest,
  user: ChatMessage,
  reply: ChatMessage,
  mode: AxeTurnMode,
  caps: Capabilities,
) {
  const startedAt = Date.now()
  const out = replyEmitter(threadId, reply, startedAt)
  const abort = new AbortController()
  running.set(threadId, { reply, stop: () => abort.abort() })
  let error: string | undefined
  try {
    if (local.localModel !== modelId) local.localModel = modelId
    localNames.set(modelId, await localModelName(modelId).catch(() => "Local model"))
    const earlier = local.messages
    local.messages.push(user, reply)
    local.updatedAt = user.createdAt!
    saveLocal(local)
    emitThreads()
    const meta = chatMeta(threadId)
    const library = await contextFor({ helperId: meta.helperId, skillIds: mode.skill ? [mode.skill] : [], start: mode.first })
    const files = await filesFor(request, reply, caps)
    const text = withLibrary(library, withContext("", [request.text.trim(), files.text].filter(Boolean).join("\n\n"), rememberFor(mode.first)))
    if (files.left.length) out.changed()
    // Newest turns kept when the chat is long; small models have small windows.
    const history: LocalMessage[] = []
    let room = 24_000 - text.length
    for (const m of [...earlier.slice(0, -2)].reverse()) {
      const t = messageText(m).trim()
      if (!t || (room -= t.length) < 0) break
      history.unshift({ role: m.role, content: t })
    }
    const system = "You are Axe AI, running on this computer. Answer clearly and briefly, in plain words."
    let thinking: Extract<ChatMessage["parts"][number], { type: "reasoning" }> | undefined
    let answer: Extract<ChatMessage["parts"][number], { type: "text" }> | undefined
    await streamLocal(
      modelId,
      [
        { role: "system", content: system },
        ...history,
        {
          role: "user",
          content: files.images.length
            ? [{ type: "text", text }, ...files.images.map((i) => ({ type: "image_url" as const, image_url: { url: String((i as { image: string }).image) } }))]
            : text,
        },
      ],
      {
        reasoning(d) {
          if (answer) return
          if (!thinking) reply.parts.push((thinking = { type: "reasoning", id: randomUUID(), text: "", done: false }))
          thinking.text += d
          out.changed()
        },
        text(d) {
          if (!answer) {
            if (!d.trim()) return
            d = d.replace(/^\s+/, "")
            if (thinking && !thinking.done) Object.assign(thinking, { done: true, seconds: Math.round((Date.now() - startedAt) / 1000) })
            reply.parts.push((answer = { type: "text", id: randomUUID(), text: "" }))
          }
          answer.text += d
          out.changed()
        },
      },
      abort.signal,
    )
    if (!answer && !abort.signal.aborted) throw new Error("The model didn't answer. Try again, or pick another model.")
  } catch (e) {
    if (!abort.signal.aborted) {
      error = plainError(e)
      if (!reply.parts.some((p) => p.type === "error")) reply.parts.push({ type: "error", id: randomUUID(), text: error })
    }
  } finally {
    finishReply(reply)
    if (running.get(threadId)?.reply === reply) running.delete(threadId)
    local.updatedAt = new Date().toISOString()
    saveLocal(local)
    out.done(error)
    emitThreads()
  }
}

/**
 * Who handles a local model's turn: Do it or connectors when it can use tools (Ollama says; other
 * servers are tried), else plain chat. An Ollama that's on this computer but not running is started
 * first, shown as a step.
 */
async function localAnswer(threadId: string, local: LocalThread, modelId: string, request: SendRequest, user: ChatMessage, reply: ChatMessage, mode: AxeTurnMode) {
  let step: Extract<Part, { type: "tool" }> | undefined
  try {
    await ensureServer(modelId, () => {
      running.set(threadId, { reply, stop: () => {} })
      step = { type: "tool", id: randomUUID(), title: "Starting Ollama", kind: "execute", state: "running" }
      reply.parts.push(step)
      emit("reply", { threadId, message: publicMessage(reply), done: false, startedAt: Date.now() })
      emitThreads()
    })
    if (step) Object.assign(step, { state: "done", title: "Started Ollama" })
  } catch (e) {
    if (step) Object.assign(step, { state: "failed", output: plainError(e) })
    return localFailed(threadId, local, modelId, user, reply, plainError(e))
  }
  const caps = await capabilities(modelId).catch((): Capabilities => ({}))
  const tools = caps.tools !== false
  if (tools && request.doIt) return doItTurn(threadId, local, modelId, request, user, reply, caps)
  if (tools && chatMeta(threadId).connectors?.length) return connectorTurn(threadId, local, modelId, request, user, reply, mode, caps)
  return localTurn(threadId, local, modelId, request, user, reply, mode, caps)
}

/** A local turn that ended before it began (its server wouldn't start): saved with the error. */
function localFailed(threadId: string, local: LocalThread, modelId: string, user: ChatMessage, reply: ChatMessage, error: string) {
  const out = replyEmitter(threadId, reply, Date.now())
  local.localModel = modelId
  local.messages.push(user, reply)
  reply.parts.push({ type: "error", id: randomUUID(), text: error })
  finishReply(reply)
  local.updatedAt = new Date().toISOString()
  saveLocal(local)
  if (running.get(threadId)?.reply === reply) running.delete(threadId)
  out.done(error)
  emitThreads()
}

/** A local model's files: text inline, photos for a model that sees, and a step for each one it can't get. */
async function filesFor(request: SendRequest, reply: ChatMessage, caps: Capabilities) {
  const files = await localFiles(request.attachments ?? [], caps.vision)
  for (const f of files.left) reply.parts.push({ type: "tool", id: randomUUID(), title: `Left out ${f.name}`, kind: "read", state: "failed", output: f.why })
  return files
}

/** Do it: an Axe model (or a local one that can use tools) works on this computer. Its turns live on this computer, like an agent's. */
async function doItTurn(
  threadId: string,
  local: LocalThread | undefined,
  modelId: string,
  request: SendRequest,
  user: ChatMessage,
  reply: ChatMessage,
  caps?: Capabilities,
) {
  const startedAt = Date.now()
  const out = replyEmitter(threadId, reply, startedAt)
  const abort = new AbortController()
  running.set(threadId, { reply, stop: () => abort.abort() })
  let error: string | undefined
  let record: LocalThread | undefined
  try {
    let transcript: ChatMessage[]
    if (local) {
      record = local
      transcript = [...local.messages]
    } else {
      transcript = await axeTranscript(threadId).catch(() => getLocal(threadId)?.messages ?? [])
      record = overlayFor(threadId, {})!
    }
    // The whole chat's length (server turns too), so a turn in between means the next one starts fresh.
    const before = transcript.length
    if (caps) await nameLocal(record, modelId)
    record.messages.push(user, reply)
    record.updatedAt = user.createdAt!
    saveLocal(record)
    emitThreads()
    const userText = [...transcript, user].filter((m) => m.role === "user").map(messageText).join("\n")
    // Axe models get files through the website; a local model gets them in its message.
    const files = caps ? await filesFor(request, reply, caps) : undefined
    if (files?.left.length) out.changed()
    const { runDoIt } = await import("./doit")
    await runDoIt({
      threadId,
      before,
      modelId,
      reply,
      text: [request.text.trim(), files?.text].filter(Boolean).join("\n\n"),
      ...(files?.images.length ? { images: files.images } : {}),
      context: (text) => withContext(contextText(transcript, 20_000), text),
      userText,
      signal: abort.signal,
      changed: out.changed,
      fullAccess: () => fullAccessIn(threadId),
      ask: async (q) => {
        const options = [
          { id: "allow", label: "Allow", kind: "allow_once" as const },
          { id: "deny", label: "Don't allow", kind: "reject_once" as const },
        ]
        return (await askUser(threadId, { title: q.title, ...(q.detail ? { detail: q.detail } : {}), options }, abort.signal)) === "allow"
      },
    })
  } catch (e) {
    if (!abort.signal.aborted) {
      error = plainError(e)
      sessionEnded(e)
      if (!reply.parts.some((p) => p.type === "error")) reply.parts.push({ type: "error", id: randomUUID(), text: error })
    }
  } finally {
    finishReply(reply)
    if (running.get(threadId)?.reply === reply) running.delete(threadId)
    if (record) {
      record.updatedAt = new Date().toISOString()
      saveLocal(record)
    }
    out.done(error)
    emitThreads()
  }
}

/** A local chat remembers its model, and the chat names it ("Qwen2.5 7B: …" in context). */
async function nameLocal(record: LocalThread, modelId: string) {
  if (record.source === "local" && record.localModel !== modelId) record.localModel = modelId
  localNames.set(modelId, await localModelName(modelId).catch(() => "Local model"))
}

/** The model behind connector turns: POST /api/agent/respond. Tests swap in a fake. */
let connectorBrain = (modelId: string): Brain => ({ system, messages, tools, signal }) =>
  client().stream("api/agent/respond", { model: modelId, system, messages, tools, autoPaid: modelId === "auto" }, signal)

export function configureConnectorBrain(brain: (modelId: string) => Brain) {
  connectorBrain = brain
}

/**
 * An Axe model with your connectors on: the turn runs through the app (libraries/tool-turn.ts), so it
 * lives on this computer like an agent's turn, beside the chat on axeai.com.
 */
async function connectorTurn(
  threadId: string,
  local: LocalThread | undefined,
  modelId: string,
  request: SendRequest,
  user: ChatMessage,
  reply: ChatMessage,
  mode: AxeTurnMode,
  caps?: Capabilities,
) {
  const startedAt = Date.now()
  const out = replyEmitter(threadId, reply, startedAt)
  const abort = new AbortController()
  running.set(threadId, { reply, stop: () => abort.abort() })
  let error: string | undefined
  let record: LocalThread | undefined
  try {
    let transcript: ChatMessage[]
    if (local) {
      record = local
      transcript = [...local.messages]
    } else {
      transcript = await axeTranscript(threadId).catch(() => getLocal(threadId)?.messages ?? [])
      record = overlayFor(threadId, {})!
    }
    if (caps) await nameLocal(record, modelId)
    record.messages.push(user, reply)
    record.updatedAt = user.createdAt!
    saveLocal(record)
    emitThreads()
    const meta = chatMeta(threadId)
    const tools = await hub().tools(meta.connectors)
    if (!tools.length) throw new Error("None of this chat's connectors are working. Check them on the Connectors page.")
    const library = await contextFor({ helperId: meta.helperId, skillIds: mode.skill ? [mode.skill] : [], start: mode.first })
    const files = caps ? await filesFor(request, reply, caps) : undefined
    if (files?.left.length) out.changed()
    const asked = [request.text.trim(), files?.text].filter(Boolean).join("\n\n")
    const goal = withLibrary(library, withContext(contextText(transcript, 20_000), asked, rememberFor(mode.first)))
    const allowed = new Set(meta.allowed ?? [])
    await runToolTurn({
      reply,
      brain: caps ? localBrain(modelId) : connectorBrain(modelId),
      tools,
      system: CONNECTORS_SYSTEM,
      history: [],
      text: files?.images.length ? [{ type: "text", text: goal }, ...files.images] : goal,
      signal: abort.signal,
      hooks: {
        changed: out.changed,
        allowed,
        call: (tool, input) => hub().call(tool, input),
        ask: async (q) => {
          const options = [
            { id: "once", label: "Allow once", kind: "allow_once" as const },
            { id: "chat", label: "Allow in this chat", kind: "allow_always" as const },
            { id: "no", label: "Don't allow", kind: "reject_once" as const },
          ]
          const chosen = await askUser(threadId, { title: q.title, ...(q.detail ? { detail: q.detail } : {}), options }, abort.signal)
          return chosen === "once" ? "once" : chosen === "chat" ? "chat" : "no"
        },
      },
    })
    if (allowed.size) setChatMeta(threadId, { allowed: [...allowed] })
  } catch (e) {
    if (!abort.signal.aborted) {
      error = plainError(e)
      sessionEnded(e)
      if (!reply.parts.some((p) => p.type === "error")) reply.parts.push({ type: "error", id: randomUUID(), text: error })
    }
  } finally {
    finishReply(reply)
    if (running.get(threadId)?.reply === reply) running.delete(threadId)
    if (record) {
      record.updatedAt = new Date().toISOString()
      saveLocal(record)
    }
    out.done(error)
    emitThreads()
  }
}

/** Which connectors a chat uses from now on (Axe models; agents get every enabled one). */
export function setConnectors(threadId: string, ids: string[]) {
  setChatMeta(threadId, { connectors: [...new Set(ids)] })
  emitThreads()
}

// Research that asks first (paid models)

/** Where an Axe chat lives on the server, and its local overlay when it has one. */
function serverChat(threadId: string): { serverId: string; local?: LocalThread } {
  if (isLocalId(threadId)) {
    const local = getLocal(threadId)
    if (!local?.axeThreadId) throw new Error("That chat isn't on Axe.")
    return { serverId: local.axeThreadId, local }
  }
  return { serverId: threadId }
}

/** Runs the research a paid model asked about: the server redoes that answer as a research run. */
export async function approveResearch(threadId: string, messageId: string): Promise<void> {
  if (running.has(threadId)) throw new Error("Wait for the current answer to finish.")
  const { serverId, local } = serverChat(threadId)
  const stored = (await client().messages(serverId)).map(storedMessage).filter((m): m is ChatMessage => !!m)
  const asked = stored.find((m) => m.id === messageId)
  const card = asked?.parts.find((p): p is Extract<Part, { type: "researchApproval" }> => p.type === "researchApproval")
  if (!asked || !card) throw new Error("That research request isn't here anymore.")
  if (stored[stored.length - 1]?.id !== messageId) throw new Error("Only the latest answer can run research.")
  if (local) local.messages = local.messages.filter((m) => m.id !== messageId)
  const answerer: Answerer = { kind: "axe", modelId: card.data.modelId }
  const reply: ChatMessage = { id: randomUUID(), role: "assistant", parts: [], answerer, createdAt: new Date().toISOString() }
  void axeTurn(threadId, local, card.data.modelId, { threadId, text: "", answerer, research: true }, null, reply, {
    first: false,
    regenerate: true,
    researchApproved: true,
  })
}

export async function cancelResearch(threadId: string, messageId: string): Promise<void> {
  const { serverId } = serverChat(threadId)
  await client().cancelResearch(serverId, messageId)
}

// The / menu and instructions files for agent chats

function agentChat(threadId: string): { agentId: string; cwd: string } {
  const t = getLocal(threadId)
  if (!t?.agentId || !t.cwd) throw new Error("That isn't an agent chat.")
  return { agentId: t.agentId, cwd: t.cwd }
}

/** The agent's advertised commands (once its session is open) and the skills on disk. */
export async function commandsFor(threadId: string): Promise<SlashCommand[]> {
  const t = getLocal(threadId)
  if (!t?.agentId) return []
  const disk = await onDisk(t.agentId, t.cwd, homeFolder())
  return mergeCommands(sessions.get(threadId)?.commands ?? [], disk)
}

export const commandsBeforeStart = (agentId: string, cwd: string) => onDisk(agentId, cwd, homeFolder())

export function instructionsFor(threadId: string): Promise<InstructionsFile[]> {
  const { agentId, cwd } = agentChat(threadId)
  return instructionsFiles(agentId, cwd)
}

/** Opens CLAUDE.md (or AGENTS.md…) in the chat's folder; starts one when it isn't there. */
export async function openInstructions(threadId: string, name: string, open: (path: string) => Promise<string>) {
  const { cwd } = agentChat(threadId)
  const path = instructionsPath(cwd, name)
  if (!existsSync(path)) await writeFile(path, starterText(cwd), { flag: "wx" }).catch(() => {})
  const problem = await open(path)
  if (problem) throw new Error(problem)
}

export function stop(threadId: string) {
  running.get(threadId)?.stop()
}

// Permission questions from CLI agents

async function askPermission(
  threadId: string,
  p: RequestPermissionRequest,
  signal: AbortSignal,
  plan?: { partId: string; start?: string },
): Promise<RequestPermissionResponse> {
  const call = p.toolCall
  // Axe's own tools (mcp__axe__…) ask for themselves when a step is risky, so the agent's question is answered here.
  const own = p.options.find((o) => o.kind === "allow_once")
  if (own && isAxeTool(call.title, call.rawInput)) return { outcome: { outcome: "selected", optionId: own.optionId } }
  const detail = inputText(call.rawInput, call.locations)
  const chosen = await askUser(
    threadId,
    {
      title: call.title || "Allow this action?",
      ...(detail ? { detail } : {}),
      ...(call.toolCallId ? { toolCallId: call.toolCallId } : {}),
      options: p.options.map((o) => ({ id: o.optionId, label: o.name, kind: o.kind })),
      ...(plan ? { plan: { partId: plan.partId } } : {}),
    },
    signal,
    plan?.start,
  )
  return chosen ? { outcome: { outcome: "selected", optionId: chosen } } : { outcome: { outcome: "cancelled" } }
}

/** An agent's tool call that is one of Axe's MCP tools. */
export function isAxeTool(title: string | null | undefined, rawInput: unknown): boolean {
  if (/^mcp__axe__/.test(title ?? "")) return true
  const raw = rawInput as { server_name?: unknown; server?: unknown } | null | undefined
  return raw?.server_name === "axe" || raw?.server === "axe"
}

/**
 * Shows a permission card in the chat and waits for the option you pick (null if withdrawn). A plan
 * question carries `plan` (its card shows Start and Change); `planStart` is the option Start picks.
 */
export async function askUser(
  threadId: string,
  question: Omit<PermissionRequest, "id" | "threadId">,
  signal: AbortSignal,
  planStart?: string,
): Promise<string | null> {
  const id = randomUUID()
  const request: PermissionRequest = { id, threadId, ...question }
  const plan = question.plan ? { partId: question.plan.partId, ...(planStart ? { start: planStart } : {}) } : undefined
  const chosen = await new Promise<string | null>((resolve) => {
    if (signal.aborted) return resolve(null)
    permissions.set(id, { threadId, resolve, ...(plan ? { plan } : {}) })
    signal.addEventListener("abort", () => resolve(null), { once: true })
    emit("permission", request)
    turnEvent({ kind: "ask", request })
    const agentId = getLocal(threadId)?.agentId
    const name = agentId ? (agentNames.get(agentId) ?? "The agent") : "Axe"
    notify({
      threadId,
      kind: "permission",
      title: getLocal(threadId)?.title || name,
      body: plan ? `${name} has a plan ready for you.` : `${name} needs your OK: ${request.title}`,
    })
  })
  permissions.delete(id)
  emit("permissionDone", { id })
  turnEvent({ kind: "answered", id, threadId })
  return chosen
}

export function answerPermission(requestId: string, optionId: string) {
  permissions.get(requestId)?.resolve(optionId)
}

/** Ends every agent process (app quit). */
export function shutdown() {
  for (const turn of running.values()) turn.stop()
  for (const id of [...sessions.keys()]) closeSession(id)
}

// Permission modes (agents/modes.ts)

/** Modes of chats that have no record on this computer yet (an Axe chat an agent hasn't answered). */
const looseModes = new Map<string, AgentMode>()

export function modeOf(threadId: string): AgentMode {
  return getLocal(threadId)?.mode ?? looseModes.get(threadId) ?? "ask"
}

/** Full access is the chat's own mode (the one under the composer), or the Settings switch while it still exists. */
function fullAccessIn(threadId: string): boolean {
  return modeOf(threadId) === "full" || !!settings().fullAccess
}

function storeMode(threadId: string, mode: AgentMode) {
  const local = getLocal(threadId)
  const was = modeOf(threadId)
  if (local) {
    if (mode === "plan" && was !== "plan") local.beforePlan = was
    local.mode = mode
    saveLocal(local)
  } else looseModes.set(threadId, mode)
  emit("mode", { threadId, mode })
}

/**
 * Puts the agent in the native mode for ours (see modes.ts). Returns true when Plan has to be
 * asked for in words, because the agent has no plan mode of its own.
 */
async function syncMode(session: AgentSession, mode: AgentMode): Promise<boolean> {
  await session.start()
  const target = nativeMode(mode, session.modes)
  if (target) await session.setMode(target).catch(() => {})
  return mode === "plan" && !target
}

/** You picked a mode. A running agent switches straight away. */
export async function setMode(threadId: string, mode: AgentMode) {
  if (!isMode(mode)) throw new Error("That isn't a mode.")
  storeMode(threadId, mode)
  const live = sessions.get(threadId)
  if (live?.session.running) await syncMode(live.session, mode).catch(() => {})
  emitThreads()
}

// Model and effort (agents/config.ts)

/** Picks for chats that have no record on this computer yet. */
const loosePicks = new Map<string, Record<string, string>>()

function picksOf(threadId: string, agentId: string): Record<string, string> | undefined {
  return getLocal(threadId)?.config ?? loosePicks.get(threadId) ?? settings().agentConfig?.[agentId]
}

/** The agent's lists to the window (and remembered for its next new chat). */
function publishOptions(threadId: string, session: AgentSession) {
  const options = optionsFromACP(session.configOptions)
  if (options.length) rememberOptions(session.agentId, options)
  emit("agentOptions", { threadId, agentId: session.agentId, options })
}

/** Puts a starting (or running) agent on the chat's model and effort, model first. */
async function syncConfig(threadId: string, session: AgentSession) {
  await session.start()
  const picks = picksOf(threadId, session.agentId)
  for (let i = 0; i < 4; i++) {
    const next = nextToApply(optionsFromACP(session.configOptions), picks)
    if (!next) break
    await session.setConfigOption(next.id, next.value).catch(() => {})
  }
  publishOptions(threadId, session)
}

/**
 * The model and effort choices for a chat (null: a new chat with `agentId`): the running agent's
 * own lists, else the lists it sent last time with the chat's picks.
 */
export function agentOptions(threadId: string | null, agentId: string): AgentOption[] {
  const live = threadId ? sessions.get(threadId) : undefined
  if (live && !live.session.closed && live.session.agentId === agentId && live.session.configOptions.length) return optionsFromACP(live.session.configOptions)
  return withPicks(cachedOptions(agentId), threadId ? picksOf(threadId, agentId) : settings().agentConfig?.[agentId])
}

/** You picked a model or effort: the chat keeps it, new chats with this agent start with it, a running agent switches now. */
export async function setAgentOption(threadId: string | null, agentId: string, configId: string, value: string): Promise<AgentOption[]> {
  if (typeof configId !== "string" || typeof value !== "string" || configId.length > 100 || value.length > 200) throw new Error("That isn't a choice.")
  // A chat with no picks of its own yet starts from the remembered ones, so picking the model keeps the effort.
  const before = threadId ? picksOf(threadId, agentId) : undefined
  const all = settings().agentConfig ?? {}
  updateSettings({ agentConfig: { ...all, [agentId]: { ...all[agentId], [configId]: value } } })
  if (threadId) {
    const local = getLocal(threadId)
    if (local) {
      local.config = { ...before, [configId]: value }
      saveLocal(local)
    } else loosePicks.set(threadId, { ...before, [configId]: value })
    const live = sessions.get(threadId)
    if (live?.session.running && live.session.agentId === agentId) await syncConfig(threadId, live.session).catch(() => {})
  }
  return agentOptions(threadId, agentId)
}

/** The agent changed its own mode (it entered or left plan mode by itself): ours follows. */
function followNativeMode(threadId: string, nativeId: string) {
  const now = modeOf(threadId)
  const next = modeFromNative(nativeId, now, getLocal(threadId)?.beforePlan)
  if (next !== now) {
    storeMode(threadId, next)
    emitThreads()
  }
}

/**
 * Start a plan. When the agent is waiting on its plan question (Claude Code's "Ready to code?"),
 * that is answered and it goes on in the same turn. Returns false when there's no question: the
 * window then sends "Go ahead with the plan." in the new mode.
 */
export function startPlan(threadId: string): boolean {
  const next = modeAfterPlan(getLocal(threadId)?.beforePlan)
  storeMode(threadId, next)
  emitThreads()
  for (const [id, p] of permissions) {
    if (p.threadId !== threadId || !p.plan) continue
    const live = sessions.get(threadId)
    live?.turn?.builder.startPlan(p.plan.partId)
    live?.turn?.changed()
    if (p.plan.start) p.resolve(p.plan.start)
    permissions.delete(id)
    return true
  }
  return false
}

/** Every permission request from an agent: plans, answers the mode gives, and saving files first. */
async function agentPermission(threadId: string, holder: Live, cwd: string, p: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse> {
  const tracker = trackerFor(threadId, cwd)
  const saveFirst = async (optionId: string | null) => {
    const option = p.options.find((o) => o.optionId === optionId)
    if (option?.kind.startsWith("allow") && touchesFiles(p)) await tracker.capture(toolPaths(p.toolCall)).catch(() => {})
  }

  const plan = planRequest(p)
  if (plan) {
    const builder = holder.turn?.builder
    const partId = builder?.proposePlan(parsePlan(plan)) ?? randomUUID()
    holder.turn?.changed()
    const { start } = planOptions(p.options)
    return askPermission(threadId, p, signal, { partId, ...(start ? { start: start.optionId } : {}) })
  }

  const nativePlan = !!nativeMode("plan", holder.session.modes)
  const auto = autoAnswer(modeOf(threadId), p, nativePlan)
  if (auto) {
    await saveFirst(auto)
    return { outcome: { outcome: "selected", optionId: auto } }
  }
  const answer = await askPermission(threadId, p, signal)
  if (answer.outcome.outcome === "selected") await saveFirst(answer.outcome.optionId)
  return answer
}

/**
 * A tool call that will change files: save them now, before it runs (once per turn). One that
 * already finished without telling us first is worked out from its diff.
 */
function saveBeforeChange(threadId: string, cwd: string, u: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>) {
  const kind = u.kind ?? ""
  const diffs = (u.content ?? []).filter((c) => c.type === "diff")
  if (!["edit", "delete", "move"].includes(kind) && !diffs.length) return
  const tracker = trackerFor(threadId, cwd)
  if (u.status === "completed" || u.status === "failed") {
    for (const d of diffs) if (d.type === "diff") void tracker.recover(d.path, d.oldText, d.newText)
    return
  }
  void tracker.capture(toolPaths(u)).catch(() => {})
}

// Review changes

function agentFolder(threadId: string): string {
  const t = getLocal(threadId)
  if (!t?.cwd) throw new Error("That isn't an agent chat.")
  return t.cwd
}

export async function changesFor(threadId: string): Promise<FileChange[]> {
  const t = getLocal(threadId)
  if (!t?.cwd) return []
  return trackerFor(threadId, t.cwd).list()
}

async function emitChanges(threadId: string): Promise<FileChange[]> {
  const files = await changesFor(threadId).catch(() => [])
  emit("changes", { threadId, files })
  return files
}

export async function keepChanges(threadId: string, paths: string[] | null): Promise<FileChange[]> {
  await trackerFor(threadId, agentFolder(threadId)).keep(paths)
  return emitChanges(threadId)
}

export async function undoChanges(threadId: string, paths: string[] | null): Promise<FileChange[]> {
  if (running.has(threadId)) throw new Error("Wait for the agent to finish, or stop it first.")
  await trackerFor(threadId, agentFolder(threadId)).undo(paths)
  return emitChanges(threadId)
}

// Rewind

function rewindPoint(threadId: string, messageId: string): { local: LocalThread; index: number } {
  const local = isLocalId(threadId) ? getLocal(threadId) : undefined
  if (!local || local.source !== "agent") throw new Error("Only agent chats can rewind.")
  const index = local.messages.findIndex((m) => m.id === messageId && m.role === "user")
  if (index < 0) throw new Error("That message isn't in this chat anymore.")
  return { local, index }
}

export async function rewindPreview(threadId: string, messageId: string): Promise<{ replies: number; files: number }> {
  const { local, index } = rewindPoint(threadId, messageId)
  const replies = local.messages.slice(index).filter((m) => m.role === "assistant").length
  const files = local.cwd ? await trackerFor(threadId, local.cwd).rewindCount(messageId) : 0
  return { replies, files }
}

/**
 * Goes back to before one of your messages: it and everything after it leave the chat, the
 * agent starts a fresh session (it gets the earlier turns as context), and with `files` every
 * file it changed since is put back. Returns the chat as it is now and the message's text.
 */
export async function rewind(threadId: string, messageId: string, files: boolean): Promise<{ messages: ChatMessage[]; text: string }> {
  running.get(threadId)?.stop()
  const { local, index } = rewindPoint(threadId, messageId)
  const text = messageText(local.messages[index]!)
  if (local.cwd) await trackerFor(threadId, local.cwd).rewind(messageId, files)
  closeSession(threadId)
  local.messages = local.messages.slice(0, index)
  if (local.axeSeen !== undefined) local.axeSeen = Math.min(local.axeSeen, index)
  local.updatedAt = new Date().toISOString()
  saveLocal(local)
  emitThreads()
  void emitChanges(threadId)
  return { messages: local.messages.map(publicMessage), text }
}
