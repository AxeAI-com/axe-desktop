import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { EventName, Events } from "@shared/api"
import { RICH_HINT_OPEN } from "@shared/rich"
import type { ReplyUpdate } from "@shared/types"

import { resetStoreForTests } from "../../src/main/agents/store"
import { configureAccount } from "../../src/main/axe/account"
import { setEmitter } from "../../src/main/bus"
import * as chat from "../../src/main/chat"
import { resetSettingsForTests } from "../../src/main/settings"

// Slice 2 through the real engine: research runs and their approval, memory going with
// a chat's first message, usage on replies, and an agent's / commands. Axe's server is
// a stubbed fetch; the agent is tests/fixtures/fake-agent.mjs.

const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-slice2-")))
const data = join(root, "data")
const work = join(root, "work")
const home = join(root, "home")
mkdirSync(data, { recursive: true })
mkdirSync(join(work, ".agents/skills/tidy"), { recursive: true })
mkdirSync(join(home, ".agents/skills/brand-voice"), { recursive: true })
writeFileSync(join(work, ".agents/skills/tidy/SKILL.md"), "---\nname: tidy\ndescription: Sort a folder by type\n---\n\nSteps…\n")
writeFileSync(join(home, ".agents/skills/brand-voice/SKILL.md"), "---\ndescription: Write in the house style\n---\n")
const fixture = resolve(import.meta.dirname, "../fixtures/fake-agent.mjs")
const saved = { data: process.env.AXE_DATA_DIR, base: process.env.AXE_BASE_URL, token: process.env.AXE_TOKEN }

const events: { [K in EventName]?: Events[K][] } = {}
const waiters: { check: () => boolean; resolve: () => void }[] = []
function record<K extends EventName>(event: K, payload: Events[K]) {
  ;((events[event] ??= []) as Events[K][]).push(payload)
  if (event === "permission") {
    const p = payload as Events["permission"]
    setTimeout(() => chat.answerPermission(p.id, p.options[0]!.id), 10)
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
const done = (threadId: string, n: number) => () => (events.reply ?? []).filter((r) => r.threadId === threadId && r.done).length >= n
const lastDone = (threadId: string): ReplyUpdate => (events.reply ?? []).filter((r) => r.threadId === threadId && r.done).at(-1)!

const THREAD = "11111111-2222-4333-8444-555555555555"
const sse = (chunks: unknown[]) =>
  new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } })

const research = (status: string, steps: unknown[], sources: unknown[] = []) => ({
  type: "data-research",
  id: "research",
  data: { status, queries: ["a", "b", "c"], steps, sources, startedAt: 1000, ...(status === "running" ? {} : { endedAt: 61_000 }) },
})

type Call = { url: string; method: string; body?: Record<string, unknown> }
const calls: Call[] = []
let stored: unknown[] = []

beforeAll(() => {
  process.env.AXE_DATA_DIR = data
  process.env.AXE_BASE_URL = "http://localhost:3000"
  process.env.AXE_TOKEN = "test-token"
  // Signed in as Mia: memory is per account.
  writeFileSync(join(data, "profile.json"), JSON.stringify({ id: "u_mia", email: "mia@example.com", name: "Mia Lane" }))
  resetSettingsForTests()
  resetStoreForTests()
  configureAccount({})
  setEmitter(record)
  chat.configureChat({
    resolveAgent: async () => ({ name: "Fake Agent", spec: { command: process.execPath, args: [fixture], env: { ...process.env } as Record<string, string> } }),
    defaultFolder: () => work,
    homeFolder: () => home,
  })
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    calls.push({ url, method, ...(init?.body && typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}) })
    if (url.endsWith("/api/chat/threads") && method === "POST")
      return Response.json({ thread: { id: THREAD, title: "New chat", pinned: false, archived: false, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z" } })
    if (url.endsWith("/api/chat/threads")) return Response.json({ threads: [] })
    if (url.includes("/research-approval")) return Response.json({ ok: true })
    if (url.endsWith("/messages") && method === "GET") return Response.json({ messages: stored })
    if (url.endsWith("/messages") && method === "POST") {
      const body = JSON.parse(String(init!.body)) as { research: boolean; modelId: string }
      if (!body.research)
        return sse([{ type: "start", messageId: "srv-2" }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Plain answer." }, { type: "finish" }])
      return sse([
        { type: "start", messageId: "srv-1", messageMetadata: { modelId: body.modelId } },
        research("running", [{ id: "plan-0", kind: "plan", verb: "Planning", target: "the searches", status: "running", startedAt: 1000 }]),
        research("running", [
          { id: "plan-0", kind: "plan", verb: "Planned", target: "3 searches", status: "complete", startedAt: 1000, endedAt: 2000 },
          { id: "search-1", kind: "search", verb: "Searching for", target: "a", status: "running", startedAt: 2000 },
        ]),
        { type: "text-start", id: "r" },
        { type: "text-delta", id: "r", delta: "# Pricing\n\nShort answer [1].\n\n## Per minute\n\nMost charge per minute [1]." },
        research(
          "complete",
          [
            { id: "plan-0", kind: "plan", verb: "Planned", target: "3 searches", status: "complete", startedAt: 1000, endedAt: 2000 },
            { id: "search-1", kind: "search", verb: "Searched for", target: "a", status: "complete", startedAt: 2000, endedAt: 3000, detail: "6 results" },
            { id: "write-2", kind: "write", verb: "Wrote", target: "the report", status: "complete", startedAt: 3000, endedAt: 9000 },
          ],
          [{ n: 1, title: "Rates", url: "https://example.com/rates", site: "example.com", snippet: "…", read: true }],
        ),
        { type: "finish", messageMetadata: { modelId: "gpt-oss-120b", usage: { inputTokens: 9000, outputTokens: 1200 }, cost: 0 } },
      ])
    }
    return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
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

describe("memory", () => {
  it("adds, edits, removes, and refuses blanks and repeats", () => {
    expect(chat.memory.list()).toEqual([])
    chat.memory.add("  I run a small   video studio. ")
    chat.memory.add("Prices in US dollars")
    expect(chat.memory.add("prices in us dollars")).toHaveLength(2)
    expect(() => chat.memory.add("   ")).toThrow(/Write something/)
    const [first] = chat.memory.list()
    expect(first!.text).toBe("I run a small video studio.")
    chat.memory.update(first!.id, "I run a video studio with David.")
    expect(chat.memory.list()[0]!.text).toBe("I run a video studio with David.")
    expect(JSON.parse(readFileSync(join(data, "memory-u_mia.json"), "utf8"))).toHaveLength(2)
  })
})

describe("research in an Axe chat", () => {
  let threadId = ""

  it("asks for research, sends memory with the first message, and builds the report live", async () => {
    calls.length = 0
    const r = await chat.send({ threadId: null, text: "How do creators price short films?", answerer: { kind: "axe", modelId: "auto" }, webSearch: true, research: true })
    threadId = r.threadId
    await until(done(threadId, 1))
    const sent = calls.find((c) => c.method === "POST" && c.url.endsWith("/messages"))!.body as Record<string, unknown> & { message: { parts: { text: string }[] } }
    expect(sent).toMatchObject({ research: true, researchApproved: false, webSearch: false, trigger: "submit", modelId: "auto" })
    const text = sent.message.parts[0]!.text
    expect(text.startsWith("<what-to-remember-about-me>")).toBe(true)
    expect(text).toContain("- I run a video studio with David.")
    // A new chat's first message also carries the rich-card hint after the words (shared/rich.ts).
    expect(text.split(RICH_HINT_OPEN)[0]!.trimEnd().endsWith("How do creators price short films?")).toBe(true)

    const final = lastDone(threadId)
    expect(final.error).toBeUndefined()
    expect(final.message.parts.map((p) => p.type)).toEqual(["research", "text"])
    const run = final.message.parts[0]!
    expect(run.type === "research" && run.data).toMatchObject({ status: "complete", sources: [{ n: 1, site: "example.com", read: true }] })
    expect(run.type === "research" && run.data.steps.map((s) => s.kind)).toEqual(["plan", "search", "write"])
    expect(final.message.context).toEqual({ used: 10_200, modelId: "gpt-oss-120b" })
  })

  it("does not send memory again later in the chat", async () => {
    calls.length = 0
    await chat.send({ threadId, text: "Thanks", answerer: { kind: "axe", modelId: "auto" } })
    await until(done(threadId, 2))
    const sent = calls.find((c) => c.method === "POST" && c.url.endsWith("/messages"))!.body as { research: boolean; message: { parts: { text: string }[] } }
    expect(sent.research).toBe(false)
    expect(sent.message.parts[0]!.text).toBe("Thanks")
  })

  it("approving a paid model's research redoes that answer as a run", async () => {
    stored = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Wedding film rates?" }] },
      {
        id: "ask-1",
        role: "assistant",
        parts: [{ type: "data-researchApproval", data: { status: "pending", searches: 5, pages: 6, estimate: 4200, modelId: "sonnet-5.5", reasoningEffort: "medium" } }],
        metadata: { modelId: "sonnet-5.5" },
      },
    ]
    calls.length = 0
    await chat.approveResearch(threadId, "ask-1")
    await until(done(threadId, 3))
    const sent = calls.find((c) => c.method === "POST" && c.url.endsWith("/messages"))!.body as Record<string, unknown>
    expect(sent).toMatchObject({ trigger: "regenerate", research: true, researchApproved: true, modelId: "sonnet-5.5" })
    expect(sent.message).toBeUndefined()
    expect(lastDone(threadId).message.answerer).toEqual({ kind: "axe", modelId: "sonnet-5.5" })
  })

  it("won't approve an approval that isn't the latest answer", async () => {
    stored = [...stored, { id: "later", role: "assistant", parts: [{ type: "text", text: "Something else" }] }]
    await expect(chat.approveResearch(threadId, "ask-1")).rejects.toThrow(/latest answer/)
  })

  it("cancelling marks the card on the server", async () => {
    calls.length = 0
    await chat.cancelResearch(threadId, "ask-1")
    expect(calls[0]).toMatchObject({ method: "PATCH", url: expect.stringContaining(`/threads/${THREAD}/messages/ask-1/research-approval`), body: { status: "cancelled" } })
  })
})

describe("agent chats: / commands, usage, memory, instructions", () => {
  let threadId = ""

  it("lists skills on disk before the session starts", async () => {
    const before = await chat.commandsBeforeStart("fake", work)
    expect(before.map((c) => [c.name, c.source])).toEqual([
      ["tidy", "skill"],
      ["brand-voice", "skill"],
    ])
  })

  it("merges the agent's advertised commands with its skills, and reports context usage", async () => {
    const r = await chat.send({ threadId: null, text: "Make hello.txt", answerer: { kind: "agent", agentId: "fake" }, cwd: work })
    threadId = r.threadId
    await until(done(threadId, 1))
    await until(() => (events.commands ?? []).some((c) => c.threadId === threadId))
    const pushed = events.commands!.filter((c) => c.threadId === threadId).at(-1)!.commands
    expect(pushed.map((c) => c.name)).toEqual(["review", "compact", "tidy", "brand-voice"])
    expect(pushed[1]).toEqual({ name: "compact", description: "Summarise the chat", source: "agent", hint: "what to keep" })
    expect(await chat.commandsFor(threadId)).toEqual(pushed)

    const final = lastDone(threadId)
    expect(final.message.context).toEqual({ used: 1200, size: 200_000, cost: { amount: 0.01, currency: "USD" } })
    // Memory went with the session's first prompt.
    expect(final.message.parts.at(-1)).toMatchObject({ text: expect.stringContaining("Memory: I run a video studio with David.") })
  })

  it("the next prompt in the same session carries no memory", async () => {
    await chat.send({ threadId, text: "Again", answerer: { kind: "agent", agentId: "fake" } })
    await until(done(threadId, 2))
    const text = lastDone(threadId).message.parts.at(-1)
    expect(text).toMatchObject({ text: expect.stringContaining("Prompt 2.") })
    expect(text).not.toMatchObject({ text: expect.stringContaining("Memory:") })
    expect(lastDone(threadId).message.context?.used).toBe(2400)
  })

  it("offers the CLI's own instructions file and starts one when it's missing", async () => {
    const files = await chat.instructionsFor(threadId)
    expect(files).toEqual([{ name: "AGENTS.md", path: join(work, "AGENTS.md"), exists: false }])
    const opened: string[] = []
    await chat.openInstructions(threadId, "AGENTS.md", async (p) => (opened.push(p), ""))
    expect(opened).toEqual([join(work, "AGENTS.md")])
    expect(readFileSync(join(work, "AGENTS.md"), "utf8")).toMatch(/^# work\n/)
    expect((await chat.instructionsFor(threadId))[0]!.exists).toBe(true)
    await expect(chat.openInstructions(threadId, "../secrets.md", async () => "")).rejects.toThrow(/isn't an instructions file/)
  })
})
