import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Answerer, Json } from "@shared/types"

import { launchSpec } from "../agents/registry"
import { AgentSession } from "../agents/session"
import { client } from "../axe/account"
import { askLocal, localModelName } from "../local-models"
import { type AskModel, ModelUnavailable } from "./model"

// One structured call to whoever the watch's model is: reading a sentence, a custom watch's run, or a
// reply. Axe models answer through api/agent/respond with no tools. CLI agents get a one-shot prompt in
// plan mode in an empty folder, with every permission refused. Local models use their JSON format.
// The caller validates the JSON; this only gets the text back.


const LIMIT_MS = 60_000

async function askAxe(modelId: string, system: string, prompt: string, signal: AbortSignal): Promise<string> {
  let text = ""
  const body = { model: modelId, system, messages: [{ role: "user", content: prompt }], tools: [], autoPaid: modelId === "auto" }
  for await (const c of client().stream("api/agent/respond", body, signal) as AsyncIterable<Record<string, Json>>) {
    if (c.type === "text-delta" && typeof c.delta === "string") text += c.delta
    else if (c.type === "error") throw new Error(typeof c.errorText === "string" ? c.errorText : "The model stopped.")
  }
  return text
}

async function askAgent(agentId: string, system: string, prompt: string, signal: AbortSignal): Promise<string> {
  const { name, spec } = await launchSpec(agentId)
  const dir = await mkdtemp(join(tmpdir(), "axe-watch-ask-"))
  let text = ""
  const session = new AgentSession(agentId, name, dir, spec, {
    onUpdate: (n) => {
      const u = n.update
      if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") text += u.content.text
    },
    // A one-shot read: it never edits, runs or fetches anything.
    onPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  })
  const stop = () => session.close()
  signal.addEventListener("abort", stop)
  try {
    await session.start()
    if (session.modes.some((m) => m.id === "plan")) await session.setMode("plan").catch(() => {})
    await session.prompt([{ type: "text", text: `${system}\n\n${prompt}` }])
    return text
  } finally {
    signal.removeEventListener("abort", stop)
    session.close()
    void rm(dir, { recursive: true, force: true })
  }
}

/** Why a model can't answer, in the row's words: "Claude Code isn’t signed in, so this can’t run." */
export async function unavailable(a: Answerer, e: unknown): Promise<string | null> {
  const msg = e instanceof Error ? e.message : String(e)
  if (a.kind === "agent") {
    const name = await launchSpec(a.agentId).then((x) => x.name, () => "That agent")
    if (/sign in/i.test(msg)) return `${name} isn’t signed in, so this can’t run.`
    if (/couldn't start|not found|ENOENT|isn't in the list/i.test(msg)) return `${name} isn’t installed, so this can’t run.`
    return null
  }
  if (a.kind === "local") {
    const server = msg.match(/^(.+?) isn't running/)?.[1]
    if (server) return `${server} isn’t running, so this can’t run.`
    if (/server isn't set up/i.test(msg)) return `${await localModelName(a.modelId).catch(() => "That model")} isn’t set up anymore, so this can’t run.`
    return null
  }
  if (/sign in/i.test(msg)) return "Axe AI isn’t signed in, so this can’t run."
  return null
}

export const askModel: AskModel = async (answerer, system, prompt, timeoutMs = LIMIT_MS) => {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const run =
      answerer.kind === "axe"
        ? askAxe(answerer.modelId, system, prompt, abort.signal)
        : answerer.kind === "local"
          ? askLocal(answerer.modelId, prompt, system, abort.signal, 1200, true)
          : askAgent(answerer.agentId, system, prompt, abort.signal)
    const timedOut = new Promise<never>((_, reject) => abort.signal.addEventListener("abort", () => reject(new Error("The model took too long to answer."))))
    return await Promise.race([run, timedOut])
  } catch (e) {
    const why = await unavailable(answerer, e)
    throw why ? new ModelUnavailable(why) : e
  } finally {
    clearTimeout(timer)
  }
}
