#!/usr/bin/env node
// A tiny ACP agent for tests. Each prompt: thinks, proposes an edit (with a diff),
// asks permission, writes the file through the client, updates a plan, replies.
// A prompt containing "wait" hangs until cancelled.
//
// Like Claude Code it has permission modes (default, acceptEdits, plan, bypassPermissions;
// FAKE_NO_MODES=1 leaves them out). In plan mode it asks "Ready to code?" with a plan, and once
// started works through it as a to-do list. "edit:a.txt=one;b.txt=two" writes files itself (not
// through the client), asking first in default mode; "run:<command>" asks to run a command;
// "slow" spaces the steps out; "signed-out" fails like a CLI whose sign-in lapsed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { Readable, Writable } from "node:stream"

import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sessions = new Map()
let count = 0
const MODES = [
  { id: "default", name: "Manual", description: "Always ask before making changes" },
  { id: "acceptEdits", name: "Accept edits", description: "Automatically accept all file edits" },
  { id: "plan", name: "Plan", description: "Create a plan before making changes" },
  { id: "bypassPermissions", name: "Bypass permissions", description: "Accepts all permissions" },
]
// Like Claude Code, a model and an effort whose levels follow the model; "which model" answers with both.
const EFFORTS = { sonnet: ["default", "low", "high"], haiku: ["default", "low"] }
const configOptions = (s) => [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: s.mode, options: MODES.map((m) => ({ value: m.id, name: m.name })) },
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: s.model,
    options: [
      { value: "sonnet", name: "Sonnet (recommended)", description: "Everyday work" },
      { value: "haiku", name: "Haiku", description: "Fastest" },
    ],
  },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: s.effort, options: EFFORTS[s.model].map((v) => ({ value: v, name: v[0].toUpperCase() + v.slice(1) })) },
]
const PLAN = "I'll write the file and report back.\n\n1. Write **plan.txt** with one line\n2. Say done"

new AgentSideConnection(
  (conn) => ({
    async initialize() {
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: false, mcpCapabilities: { http: true } }, authMethods: [] }
    },
    async newSession({ cwd, mcpServers }) {
      const sessionId = `fake-${++count}`
      // Tests read what each session was given (FAKE_AGENT_LOG: one JSON line per session and prompt).
      if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify({ sessionId, cwd, mcpServers })}\n`)
      const s = { cwd, abort: undefined, prompts: 0, mode: "default", model: "sonnet", effort: "default" }
      sessions.set(sessionId, s)
      // Like Claude Code: the / commands arrive right after the session opens.
      setTimeout(
        () =>
          void conn.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [
                { name: "review", description: "Review the changes" },
                { name: "compact", description: "Summarise the chat", input: { hint: "what to keep" } },
              ],
            },
          }),
        5,
      )
      return process.env.FAKE_NO_MODES ? { sessionId } : { sessionId, modes: { currentModeId: "default", availableModes: MODES }, configOptions: configOptions(s) }
    },
    async setSessionMode({ sessionId, modeId }) {
      const s = sessions.get(sessionId)
      s.mode = modeId
      await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "current_mode_update", currentModeId: modeId } })
      return {}
    },
    async setSessionConfigOption({ sessionId, configId, value }) {
      const s = sessions.get(sessionId)
      if (configId === "model" && EFFORTS[value]) {
        s.model = value
        if (!EFFORTS[value].includes(s.effort)) s.effort = "default"
      } else if (configId === "effort" && EFFORTS[s.model].includes(value)) s.effort = value
      else throw RequestError.invalidParams(undefined, `No ${configId} ${value}`)
      if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify({ sessionId, set: { [configId]: value } })}\n`)
      return { configOptions: configOptions(s) }
    },
    async authenticate() {
      return {}
    },
    async cancel({ sessionId }) {
      sessions.get(sessionId)?.abort?.abort()
    },
    async prompt({ sessionId, prompt }) {
      const s = sessions.get(sessionId)
      s.prompts++
      s.abort = new AbortController()
      const texts = prompt.filter((b) => b.type === "text").map((b) => b.text)
      if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify({ sessionId, texts })}\n`)
      const asked = texts[texts.length - 1] ?? ""
      const hadContext = texts.some((t) => t.startsWith("<earlier-in-this-chat>"))
      const memory = texts.find((t) => t.startsWith("<what-to-remember-about-me>"))
      const update = (u) => conn.sessionUpdate({ sessionId, update: u })

      if (asked.includes("signed-out")) throw RequestError.authRequired()
      if (asked.includes("which model")) {
        await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Model: ${s.model}. Effort: ${s.effort}.` } })
        return { stopReason: "end_turn" }
      }

      if (asked.includes("wait")) {
        await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Waiting" } })
        await new Promise((resolve) => s.abort.signal.addEventListener("abort", resolve))
        return { stopReason: "cancelled" }
      }

      // Watching's one-shot asks (a sentence, a custom run, a reply): a JSON answer, in any mode.
      const watching = watchingAnswer(asked)
      if (watching) {
        await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: watching } })
        return { stopReason: "end_turn" }
      }
      if (s.mode === "plan") return planTurn(conn, sessionId, s, update)
      if (asked.includes("edit:") || asked.includes("run:")) return workTurn(conn, sessionId, s, update, asked)

      await update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking about " } })
      await update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "the file" } })
      await sleep(20)
      await update({
        sessionUpdate: "plan",
        entries: [
          { content: "Write hello.txt", priority: "high", status: "in_progress" },
          { content: "Say done", priority: "low", status: "pending" },
        ],
      })
      const path = join(s.cwd, "hello.txt")
      const toolCall = {
        toolCallId: `call-${s.prompts}`,
        title: "Write hello.txt",
        kind: "edit",
        status: "pending",
        locations: [{ path }],
        rawInput: { file_path: path, content: "hello\n" },
        content: [{ type: "diff", path, oldText: null, newText: "hello\n" }],
      }
      await update({ sessionUpdate: "tool_call", ...toolCall })
      const answer = await conn.requestPermission({
        sessionId,
        toolCall,
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Don't allow", kind: "reject_once" },
        ],
      })
      const allowed = answer.outcome.outcome === "selected" && answer.outcome.optionId === "allow"
      let outside = "blocked"
      if (allowed) {
        await conn.writeTextFile({ sessionId, path, content: "hello\n" })
        try {
          await conn.writeTextFile({ sessionId, path: join(s.cwd, "..", "outside.txt"), content: "no" })
          outside = "written"
        } catch {}
        const back = await conn.readTextFile({ sessionId, path })
        await update({
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: `Wrote ${back.content.length} bytes` } }],
        })
      } else {
        await update({ sessionUpdate: "tool_call_update", toolCallId: toolCall.toolCallId, status: "failed" })
      }
      await update({
        sessionUpdate: "plan",
        entries: [
          { content: "Write hello.txt", priority: "high", status: "completed" },
          { content: "Say done", priority: "low", status: "completed" },
        ],
      })
      await update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `Done. You said: ${asked}. ` },
      })
      await update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `Context: ${hadContext ? "yes" : "no"}. Prompt ${s.prompts}. Outside: ${outside}.${memory ? ` Memory: ${memory.split("\n- ")[1]?.split("\n")[0]}.` : ""}` },
      })
      await update({ sessionUpdate: "usage_update", used: 1200 * s.prompts, size: 200000, cost: { amount: 0.01 * s.prompts, currency: "USD" } })
      return { stopReason: "end_turn" }
    },
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)

const allowed = (answer) => answer.outcome.outcome === "selected" && !String(answer.outcome.optionId).startsWith("reject")

async function setMode(conn, sessionId, s, mode) {
  s.mode = mode
  await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "current_mode_update", currentModeId: mode } })
}

/** Plan mode: think, then ask to start the plan; once started, do it as a to-do list. */
async function planTurn(conn, sessionId, s, update) {
  await update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Planning the file" } })
  await update({ sessionUpdate: "tool_call", toolCallId: `read-${s.prompts}`, title: "Read notes", kind: "read", status: "completed" })
  const toolCall = { toolCallId: `plan-${s.prompts}`, title: "Ready to code?", kind: "switch_mode", status: "pending", rawInput: { plan: PLAN } }
  await update({ sessionUpdate: "tool_call", ...toolCall })
  const answer = await conn.requestPermission({
    sessionId,
    toolCall,
    options: [
      { optionId: "exit-plan-accept-edits", name: "Yes, auto-accept edits", kind: "allow_always" },
      { optionId: "exit-plan-default", name: "Yes, manually approve edits", kind: "allow_once" },
      { optionId: "reject", name: "No, keep planning", kind: "reject_once" },
    ],
  })
  if (!allowed(answer)) {
    await update({ sessionUpdate: "tool_call_update", toolCallId: toolCall.toolCallId, status: "failed" })
    await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Okay, tell me what to change." } })
    return { stopReason: "end_turn" }
  }
  await setMode(conn, sessionId, s, answer.outcome.optionId === "exit-plan-accept-edits" ? "acceptEdits" : "default")
  await update({ sessionUpdate: "tool_call_update", toolCallId: toolCall.toolCallId, status: "completed" })
  const todo = (a, b) => update({ sessionUpdate: "plan", entries: [{ content: "Write plan.txt", priority: "high", status: a }, { content: "Say done", priority: "low", status: b }] })
  await todo("in_progress", "pending")
  const wrote = await edit(conn, sessionId, s, update, "plan.txt", "planned\n")
  await todo("completed", "completed")
  await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Did the plan. Wrote: ${wrote ? "yes" : "no"}. Mode: ${s.mode}.` } })
  return { stopReason: "end_turn" }
}

/** Writes one file itself, like Claude Code's own tools: announced first, asked about in default mode. */
async function edit(conn, sessionId, s, update, name, content) {
  const path = isAbsolute(name) ? name : join(s.cwd, name)
  const old = existsSync(path) ? readFileSync(path, "utf8") : null
  const toolCallId = `edit-${s.prompts}-${name.split("/").pop()}`
  const call = { toolCallId, title: `Write ${name}`, kind: "edit", status: "pending", locations: [{ path }], rawInput: { file_path: path, content }, content: [{ type: "diff", path, oldText: old, newText: content }] }
  await update({ sessionUpdate: "tool_call", ...call })
  if (s.slow) await sleep(150)
  if (s.mode === "default") {
    const answer = await conn.requestPermission({
      sessionId,
      toolCall: call,
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Don't allow", kind: "reject_once" },
      ],
    })
    if (!allowed(answer)) {
      await update({ sessionUpdate: "tool_call_update", toolCallId, status: "failed" })
      return false
    }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  await update({ sessionUpdate: "tool_call_update", toolCallId, status: "completed" })
  return true
}

/** "edit:a.txt=one;b.txt=two" and "run:<command>". */
async function workTurn(conn, sessionId, s, update, asked) {
  s.slow = asked.includes("slow")
  const wrote = []
  const edits = asked.match(/edit:(\S+)/)?.[1]
  for (const pair of edits ? edits.split(";") : []) {
    const [name, text] = pair.split("=")
    if (await edit(conn, sessionId, s, update, name, `${text ?? ""}\n`)) wrote.push(name)
  }
  let ran = "no"
  const command = asked.match(/run:(\S+)/)?.[1]
  if (command) {
    const call = { toolCallId: `run-${s.prompts}`, title: `Run ${command}`, kind: "execute", status: "pending", rawInput: { command } }
    await update({ sessionUpdate: "tool_call", ...call })
    let ok = s.mode === "bypassPermissions"
    if (!ok)
      ok = allowed(
        await conn.requestPermission({
          sessionId,
          toolCall: call,
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "reject", name: "Don't allow", kind: "reject_once" },
          ],
        }),
      )
    await update({ sessionUpdate: "tool_call_update", toolCallId: call.toolCallId, status: ok ? "completed" : "failed" })
    ran = ok ? "yes" : "no"
  }
  if (s.slow) await sleep(300)
  await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Wrote: ${wrote.join(",") || "none"}. Ran: ${ran}. Mode: ${s.mode}. Prompt ${s.prompts}.` } })
  return { stopReason: "end_turn" }
}

/**
 * Stand-in answers for Watching's structured asks (a sentence, a custom run, a reply), keyed on the
 * design's sentences.
 */
function watchingAnswer(text) {
  if (!/(for|in) the Axe AI app/.test(text)) return null
  const j = (o) => JSON.stringify(o)
  const empty = { target: null, every: null, notify: null, condition: null, name: null }
  if (text.startsWith("You turn one sentence")) {
    const said = text.split("The sentence:\n")[1] ?? ""
    const host = said.match(/\b((?:localhost|127\.0\.0\.1):\d+|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/[^\s]*)?/i)
    const target = host ? `${host[1]}${(host[2] ?? "").replace(/[.,]+$/, "")}` : null
    if (/glaze workshop/i.test(said)) return j({ ...empty, kind: "custom", target, condition: "the Saturday glaze workshop has a seat", name: "Saturday glaze workshop seats" })
    if (/goes down|is down|gets slow/i.test(said)) return j({ ...empty, kind: "uptime", target })
    if (/changes/i.test(said)) return j({ ...empty, kind: "page", target })
    return j({ ...empty, kind: "unclear", target })
  }
  if (text.startsWith("You read one web page")) {
    const page = text.split("The page's text:\n")[1] ?? ""
    const left = page.match(/(\d+) places? left/)
    const line = page.split("\n").find((l) => /Sat 7 Nov/.test(l)) ?? page.split("\n")[0] ?? ""
    return left
      ? j({ met: true, level: "news", headline: "A seat opened in the Saturday glaze workshop", detail: `${left[1]} of 8 seats are free now.`, quote: line, state: `${left[1]} seats free` })
      : j({ met: false, level: "news", headline: "The workshop is still full", detail: "All 8 seats are taken.", quote: line, state: "Full" })
  }
  if (text.startsWith("You find a product's price")) {
    const page = text.split("The page's text:\n")[1] ?? ""
    const m = page.match(/(Our price|Price):?\s*\$(\d+(?:\.\d{2})?)/)
    return m ? j({ near: m[1], price: Number(m[2]), currency: "USD", name: page.split("\n")[0] || null }) : "There is no price on this page."
  }
  if (text.startsWith("You look after one watch")) {
    const reply = (text.split("The reply:\n")[1] ?? "").trim()
    if (/once a day|every morning/i.test(reply)) {
      const ignore = /ignore the date/i.test(reply) ? ["date"] : null
      return j({ patch: { every: "morning", ...(ignore ? { ignore } : {}) }, say: `Done. I’ll check every morning at 7:30${ignore ? " and ignore the date line at the bottom" : ""}.` })
    }
    if (/what changed/i.test(reply)) return j({ patch: null, say: "Nothing changed last week. The last change was today." })
    // Anything else: not JSON, so Axe's plain phrases take over (as with no model).
    return "Let me think about that."
  }
  return null
}
