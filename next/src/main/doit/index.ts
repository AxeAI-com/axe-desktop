import { mkdirSync } from "node:fs"

import type { ChatMessage, Json } from "@shared/types"

import { client } from "../axe/account"
import { dataPath } from "../paths"
import { settings } from "../settings"
import { childEnv } from "../shell-env"
import { browser } from "./browser"
import { computer } from "./computer"
import { localBrain } from "../local-models"
import { fakeBrain } from "./fake-brain"
import { type Brain, DoItRun } from "./loop"
import { makeToolbox } from "./toolbox"
import { systemPrompt } from "./tools"

// One Do it turn inside a chat: an Axe model works on this computer and its tool calls show as steps
// in the reply. chat.ts owns the chat (saving, the reply events, permission cards); this runs the work.

/** Axe's own folder for files and commands: the app's data folder, so nothing of yours is touched unasked. */
export function workspace(): string {
  const dir = process.env.AXE_DOIT_WORKSPACE || dataPath("Workspace")
  mkdirSync(dir, { recursive: true })
  return dir
}

/** The real model (POST /api/agent/respond), a model on a local server ("ollama|qwen2.5:7b"), or the fake one in self-tests. */
export function brainFor(modelId: string): Brain {
  if (modelId.includes("|")) return localBrain(modelId)
  if (process.env.AXE_FAKE_BRAIN) return fakeBrain()
  return ({ system, messages, tools, signal }) =>
    client().stream("api/agent/respond", { model: modelId, system, messages, tools, autoPaid: modelId === "auto" }, signal)
}

export type DoItTurn = {
  threadId: string
  /** How many messages the chat had before this turn: a follow-up right after a Do it turn continues it. */
  before: number
  modelId: string
  reply: ChatMessage
  /** What the user asked now. */
  text: string
  /** Photos that go with it, as AI SDK image parts (local models that can see). */
  images?: Json[]
  /** Earlier turns as plain text, for a run that doesn't follow on from this app's last Do it turn here. */
  context: (text: string) => string
  /** Every word the user wrote in this chat (a protected folder is fine once they named it). */
  userText: string
  signal: AbortSignal
  changed: () => void
  ask: (question: { title: string; detail?: string }) => Promise<boolean>
  /** Is this chat in Full access (its mode, not just the Settings switch)? */
  fullAccess?: () => boolean
}

// Protected folders each chat already allowed, so they ask once per chat, not on every step. Memory only.
const allowedByThread = new Map<string, Set<string>>()

// The model's own record of the last Do it turn per chat (tool calls and results, not just words), so
// "okay, press Send now" carries on from the filled-in form instead of starting over. Memory only.
const last = new Map<string, { history: Json[]; after: number }>()

export async function runDoIt(turn: DoItTurn): Promise<void> {
  const dir = workspace()
  const toolbox = makeToolbox({ workspace: dir, userText: () => turn.userText, browser, computer, env: await childEnv() })
  const previous = last.get(turn.threadId)
  const follows = previous !== undefined && previous.after === turn.before
  const run = new DoItRun(
    turn.reply,
    brainFor(turn.modelId),
    toolbox,
    {
      changed: turn.changed,
      ask: turn.ask,
      fullAccess: turn.fullAccess ?? (() => !!settings().fullAccess),
      allowed: allowedByThread.get(turn.threadId) ?? allowedByThread.set(turn.threadId, new Set()).get(turn.threadId)!,
    },
    systemPrompt(dir),
    turn.signal,
    follows ? { history: previous.history.slice(-200) } : {},
  )
  last.delete(turn.threadId)
  try {
    const goal = follows ? turn.text : turn.context(turn.text)
    await run.run(turn.images?.length ? [{ type: "text", text: goal }, ...turn.images] : goal)
  } finally {
    // A turn that broke off mid-call still left its words and results; the next one picks up from them.
    if (run.history.length) last.set(turn.threadId, { history: closed(run.history), after: turn.before + 2 })
  }
}

/** Drops a trailing assistant message whose tool calls never got results (the server wants them paired). */
function closed(history: Json[]): Json[] {
  const end = history[history.length - 1] as { role?: string; content?: Json } | undefined
  if (end?.role === "assistant" && Array.isArray(end.content) && end.content.some((c) => (c as { type?: string }).type === "tool-call")) return history.slice(0, -1)
  return history
}

