import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { EventName, Events } from "@shared/api"
import { RICH_HINT_OPEN } from "@shared/rich"
import type { ReplyUpdate } from "@shared/types"

import { getLocal, resetStoreForTests } from "../../src/main/agents/store"
import { configureAccount } from "../../src/main/axe/account"
import { stripContext } from "../../src/main/axe/stream"
import { setEmitter } from "../../src/main/bus"
import * as chat from "../../src/main/chat"
import { resetSettingsForTests } from "../../src/main/settings"

// Drives whole prompts through the real engine and a fake ACP agent process
// (tests/fixtures/fake-agent.mjs). No network: Axe's server is a stubbed fetch.

const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-engine-")))
const data = join(root, "data")
const work = join(root, "work")
mkdirSync(work, { recursive: true })
const fixture = resolve(import.meta.dirname, "../fixtures/fake-agent.mjs")
const saved = { data: process.env.AXE_DATA_DIR, base: process.env.AXE_BASE_URL, token: process.env.AXE_TOKEN }

type Seen = { [K in EventName]?: Events[K][] }
const events: Seen = {}
const waiters: { check: () => boolean; resolve: () => void }[] = []

function record<K extends EventName>(event: K, payload: Events[K]) {
  ;((events[event] ??= []) as Events[K][]).push(payload)
  if (event === "permission") {
    const p = payload as Events["permission"]
    // Answer like a person would, a moment later.
    setTimeout(() => chat.answerPermission(p.id, p.options.find((o) => o.kind === "allow_once")!.id), 10)
  }
  for (const w of [...waiters]) if (w.check()) (waiters.splice(waiters.indexOf(w), 1), w.resolve())
}

function until(check: () => boolean, ms = 15_000) {
  if (check()) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms)
    waiters.push({ check, resolve: () => (clearTimeout(t), resolve()) })
  })
}

const doneFor = (threadId: string, n: number) => () => (events.reply ?? []).filter((r) => r.threadId === threadId && r.done).length >= n
const lastDone = (threadId: string): ReplyUpdate => (events.reply ?? []).filter((r) => r.threadId === threadId && r.done).at(-1)!

beforeAll(() => {
  process.env.AXE_DATA_DIR = data
  process.env.AXE_BASE_URL = "http://localhost:3000"
  process.env.AXE_TOKEN = "test-token"
  resetSettingsForTests()
  resetStoreForTests()
  configureAccount({})
  setEmitter(record)
  chat.configureChat({
    resolveAgent: async () => ({ name: "Fake Agent", spec: { command: process.execPath, args: [fixture], env: { ...process.env } as Record<string, string> } }),
    defaultFolder: () => work,
  })
})

afterAll(() => {
  chat.shutdown()
  vi.unstubAllGlobals()
  process.env.AXE_DATA_DIR = saved.data
  process.env.AXE_BASE_URL = saved.base
  process.env.AXE_TOKEN = saved.token
  resetSettingsForTests()
  resetStoreForTests()
})

describe("agent chat end to end", () => {
  let threadId = ""

  it("streams a thought, a tool call with a diff, asks permission and replies", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in this test")
    })
    const r = await chat.send({ threadId: null, text: "Make hello.txt please", answerer: { kind: "agent", agentId: "fake" } })
    threadId = r.threadId
    expect(threadId).toMatch(/^agent_/)
    await until(doneFor(threadId, 1))

    const done = lastDone(threadId)
    expect(done.error).toBeUndefined()
    const parts = done.message.parts
    expect(parts.map((p) => p.type)).toEqual(["reasoning", "plan", "tool", "text"])
    expect(parts[0]).toMatchObject({ type: "reasoning", text: "Thinking about the file", done: true })
    expect(parts[0]?.type === "reasoning" && parts[0].seconds).toBeGreaterThanOrEqual(1)
    expect(parts[1]).toMatchObject({ type: "plan", entries: [{ text: "Write hello.txt", status: "done" }, { text: "Say done", status: "done" }] })
    expect(parts[2]).toMatchObject({
      type: "tool",
      title: "Write hello.txt",
      kind: "edit",
      state: "done",
      input: join(work, "hello.txt"),
      output: "Wrote 6 bytes",
      diff: [{ path: join(work, "hello.txt"), after: "hello\n" }],
    })
    expect(parts[3]).toMatchObject({ type: "text", text: "Done. You said: Make hello.txt please. Context: no. Prompt 1. Outside: blocked." })
    expect(done.message.answerer).toEqual({ kind: "agent", agentId: "fake" })

    // The permission went out and was withdrawn after the answer.
    const asked = events.permission!.find((p) => p.threadId === threadId)!
    expect(asked).toMatchObject({ title: "Write hello.txt", detail: join(work, "hello.txt") })
    expect(asked.options.map((o) => o.label)).toEqual(["Allow", "Don't allow"])
    expect(events.permissionDone).toContainEqual({ id: asked.id })

    // The client wrote inside the chat's folder only.
    expect(readFileSync(join(work, "hello.txt"), "utf8")).toBe("hello\n")
    expect(existsSync(join(root, "outside.txt"))).toBe(false)

    // Streaming updates came before the final one, all with the same start time.
    const updates = events.reply!.filter((u) => u.threadId === threadId)
    expect(updates.length).toBeGreaterThan(1)
    expect(new Set(updates.map((u) => u.startedAt)).size).toBe(1)
  })

  it("stores the chat locally and lists it as running while it works", async () => {
    const t = getLocal(threadId)!
    expect(t).toMatchObject({ source: "agent", agentId: "fake", cwd: work, title: "Make hello.txt please" })
    expect(t.messages.map((m) => m.role)).toEqual(["user", "assistant"])
    const lists = events.threads!.map((l) => l.find((s) => s.id === threadId)).filter(Boolean)
    expect(lists.some((s) => s!.running)).toBe(true)
    expect(lists.at(-1)).toMatchObject({ source: "agent", running: false, cwd: work })
    const msgs = await chat.threadMessages(threadId)
    expect(msgs[1]?.parts.at(-1)).toMatchObject({ type: "text" })
  })

  it("reuses the same agent process for the next message", async () => {
    await chat.send({ threadId, text: "Again", answerer: { kind: "agent", agentId: "fake" } })
    await until(doneFor(threadId, 2))
    expect(lastDone(threadId).message.parts.at(-1)).toMatchObject({ text: expect.stringContaining("Context: no. Prompt 2.") })
  })

  it("switching to an Axe model keeps the chat and sends it the agent's turns as context", async () => {
    const calls: { url: string; body?: unknown }[] = []
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith("/api/chat/threads") && init?.method === "POST")
        return Response.json({ thread: { id: "11111111-2222-4333-8444-555555555555", title: "New chat", pinned: false, archived: false, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z" } })
      if (url.endsWith("/messages") && init?.method === "POST") {
        const sse = [
          { type: "start", messageId: "srv-reply" },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Here is a summary." },
          { type: "text-end", id: "t" },
          { type: "finish" },
        ]
          .map((c) => `data: ${JSON.stringify(c)}\n\n`)
          .join("")
        return new Response(`${sse}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } })
      }
      if (url.endsWith("/api/chat/threads")) return Response.json({ threads: [] })
      return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
    })
    const r = await chat.send({ threadId, text: "Sum it up", answerer: { kind: "axe", modelId: "auto" } })
    expect(r.threadId).toBe(threadId)
    await until(doneFor(threadId, 3))
    const done = lastDone(threadId)
    expect(done.error).toBeUndefined()
    expect(done.message).toMatchObject({ id: "srv-reply", answerer: { kind: "axe", modelId: "auto" }, parts: [{ type: "text", text: "Here is a summary." }] })

    const sent = calls.find((c) => c.url.endsWith("/messages"))!.body as { modelId: string; clientHints: string[]; message: { parts: { text: string }[] } }
    expect(sent.modelId).toBe("auto")
    // The card instructions go by name; the website puts them in its system prompt, not in the message.
    expect(sent.clientHints).toEqual(["rich-cards"])
    const text = sent.message.parts[0]!.text
    expect(text.startsWith("<earlier-in-this-chat>")).toBe(true)
    expect(text).toContain("User: Make hello.txt please")
    expect(text).toContain("Fake Agent: Done. You said: Make hello.txt please")
    expect(text).not.toContain(RICH_HINT_OPEN)
    expect(stripContext(text).endsWith("Sum it up")).toBe(true)

    const t = getLocal(threadId)!
    expect(t.axeThreadId).toBe("11111111-2222-4333-8444-555555555555")
    expect(t.messages.map((m) => m.answerer?.kind)).toEqual(["agent", "agent", "agent", "agent", "axe", "axe"])
    // The linked server chat stays out of the sidebar.
    expect(events.threads!.at(-1)!.filter((s) => s.id === t.axeThreadId)).toEqual([])
  })

  it("back to the agent: it gets only the turns it missed", async () => {
    await chat.send({ threadId, text: "Thanks", answerer: { kind: "agent", agentId: "fake" } })
    await until(doneFor(threadId, 4))
    expect(lastDone(threadId).message.parts.at(-1)).toMatchObject({ text: expect.stringContaining("Context: yes. Prompt 3.") })
  })

  it("stop cancels the agent's turn", async () => {
    await chat.send({ threadId, text: "Please wait here", answerer: { kind: "agent", agentId: "fake" } })
    await until(() => (events.reply ?? []).some((u) => u.threadId === threadId && !u.done && u.message.parts.some((p) => p.type === "text" && p.text === "Waiting")))
    chat.stop(threadId)
    await until(doneFor(threadId, 5))
    expect(lastDone(threadId).error).toBeUndefined()
  })

  it("renames, pins and deletes local chats", async () => {
    await chat.renameThread(threadId, "  Hello file  ")
    await chat.pinThread(threadId, true)
    expect(events.threads!.at(-1)!.find((s) => s.id === threadId)).toMatchObject({ title: "Hello file", pinned: true })
    await chat.deleteThread(threadId)
    expect(getLocal(threadId)).toBeUndefined()
    expect(events.threads!.at(-1)!.some((s) => s.id === threadId)).toBe(false)
  })

  it("reports an agent that can't start in plain words", async () => {
    chat.configureChat({ resolveAgent: async () => ({ name: "Ghost", spec: { command: join(root, "missing-binary"), args: [], env: {} } }) })
    const r = await chat.send({ threadId: null, text: "Hi", answerer: { kind: "agent", agentId: "ghost" } })
    await until(doneFor(r.threadId, 1))
    const done = lastDone(r.threadId)
    expect(done.error).toMatch(/Ghost/)
    expect(done.message.parts.at(-1)).toMatchObject({ type: "error" })
  })
})
