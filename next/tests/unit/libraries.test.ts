import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { EventName, Events } from "@shared/api"
import type { ReplyUpdate } from "@shared/types"

// @ts-expect-error: a plain .mjs fixture
import { startFakeMcp } from "../fixtures/fake-mcp.mjs"
import { resetStoreForTests } from "../../src/main/agents/store"
import { configureAccount } from "../../src/main/axe/account"
import { LIBRARY_OPEN, stripContext } from "../../src/main/axe/stream"
import { setEmitter } from "../../src/main/bus"
import * as chat from "../../src/main/chat"
import { hub } from "../../src/main/libraries"
import { deleteHelper, listHelpers, saveHelper } from "../../src/main/libraries/helpers"
import { SkillStore, skillBody, skillId, slashSkill } from "../../src/main/libraries/skills"
import { readOnly } from "../../src/main/libraries/tool-turn"
import { resetSettingsForTests } from "../../src/main/settings"

// The libraries through the real engine: skills installed into Axe and a CLI's folder and used from /,
// agents from the library, and connectors used
// by an Axe model (tool calls through /api/agent/respond, stubbed) and handed to a CLI agent over ACP.

const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-libraries-")))
const data = join(root, "data")
const home = join(root, "home")
const work = join(root, "work")
const log = join(root, "agent.log")
for (const d of [data, home, work, join(home, ".claude")]) mkdirSync(d, { recursive: true })
const fixture = resolve(import.meta.dirname, "../fixtures/fake-agent.mjs")
const saved = { data: process.env.AXE_DATA_DIR, base: process.env.AXE_BASE_URL, token: process.env.AXE_TOKEN }

const events: { [K in EventName]?: Events[K][] } = {}
const waiters: { check: () => boolean; resolve: () => void }[] = []
/** The answer each permission card gets, by its title. */
const answers: [RegExp, string][] = []
function record<K extends EventName>(event: K, payload: Events[K]) {
  ;((events[event] ??= []) as Events[K][]).push(payload)
  if (event === "permission") {
    const p = payload as Events["permission"]
    const pick = answers.find(([re]) => re.test(p.title))?.[1] ?? p.options[0]!.id
    setTimeout(() => chat.answerPermission(p.id, pick), 10)
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

let threadN = 0
const sse = (chunks: unknown[]) =>
  new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } })

type Call = { url: string; method: string; body?: Record<string, unknown> }
const calls: Call[] = []
const realFetch = globalThis.fetch
const server: unknown[] = []
let fake: { url: string; calls: { tool: string; title?: string }[]; close(): Promise<void> }

beforeAll(async () => {
  fake = await startFakeMcp({ auth: false })
  process.env.AXE_DATA_DIR = data
  process.env.AXE_BASE_URL = "http://localhost:3000"
  process.env.AXE_TOKEN = "test-token"
  process.env.FAKE_AGENT_LOG = log
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
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init)
    const method = init?.method ?? "GET"
    const body = init?.body && typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ url, method, ...(body ? { body } : {}) })
    if (url.endsWith("/api/chat/threads") && method === "POST") {
      const thread = { id: `${"0".repeat(8)}-0000-4000-8000-${String(++threadN).padStart(12, "0")}`, title: "New chat", pinned: false, archived: false, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z" }
      server.push(thread)
      return Response.json({ thread })
    }
    if (url.endsWith("/api/chat/threads")) return Response.json({ threads: server })
    if (/\/api\/chat\/threads\/[^/]+$/.test(url) && method === "PATCH") return Response.json({ ok: true })
    if (url.endsWith("/messages") && method === "GET") return Response.json({ messages: [] })
    if (url.endsWith("/messages") && method === "POST")
      return sse([{ type: "start", messageId: "srv" }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Okay." }, { type: "finish" }])
    if (url.endsWith("/api/agent/respond")) {
      // Step 1: look at the board. Step 2: add a task. Step 3: answer from what the tools said.
      const messages = (body!.messages as { role: string; content: unknown }[]).filter((m) => m.role === "tool")
      if (messages.length === 0) return sse([{ type: "tool-input-available", toolCallId: "c1", toolName: "Taskboard__list_tasks", input: {} }])
      if (messages.length === 1) return sse([{ type: "tool-input-available", toolCallId: "c2", toolName: "Taskboard__add_task", input: { title: "Call David" } }])
      const results = JSON.stringify(messages)
      return sse([{ type: "text-delta", id: "t", delta: `You have ${results.includes("Book the Lisbon trip") ? "the Lisbon trip" : "nothing"} open; ${results.includes("Added #4") ? "added Call David" : "added nothing"}.` }])
    }
    return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
  })
})

afterAll(async () => {
  chat.shutdown()
  await hub().closeAll()
  await fake.close()
  vi.unstubAllGlobals()
  delete process.env.FAKE_AGENT_LOG
  process.env.AXE_DATA_DIR = saved.data
  process.env.AXE_BASE_URL = saved.base
  process.env.AXE_TOKEN = saved.token
  resetSettingsForTests()
  resetStoreForTests()
})

describe("skills", () => {
  const store = new SkillStore(
    () => home,
    () => join(data, "skills"),
  )

  it("lists the starters and only the CLIs that are on this computer", async () => {
    const lib = await store.library()
    expect(lib.targets.map((t) => t.id)).toEqual(["axe", "claude"])
    expect(lib.skills.filter((s) => s.source === "starter").map((s) => s.id)).toContain("brand-voice")
    expect(lib.skills.every((s) => s.installedIn.length === 0)).toBe(true)
    expect(lib.skills.find((s) => s.id === "contract-review")!.description).toMatch(/^Read a contract/)
  })

  it("installs into Axe and ~/.claude/skills, and removes only what it wrote", async () => {
    let lib = await store.install("brand-voice", ["claude"])
    expect(lib.skills.find((s) => s.id === "brand-voice")!.installedIn).toEqual(["axe", "claude"])
    const text = readFileSync(join(home, ".claude/skills/brand-voice/SKILL.md"), "utf8")
    expect(text).toMatch(/^---\nname: brand-voice\ndescription: /)
    // Someone's own skill of the same name in Claude Code's folder is never overwritten.
    mkdirSync(join(home, ".claude/skills/meeting-notes"), { recursive: true })
    writeFileSync(join(home, ".claude/skills/meeting-notes/SKILL.md"), "---\nname: meeting-notes\ndescription: mine\n---\nMine.")
    await expect(store.install("meeting-notes", ["claude"])).rejects.toThrow(/already has a different skill/)
    lib = await store.install("meeting-notes", [])
    expect(lib.skills.find((s) => s.id === "meeting-notes")!.installedIn).toEqual(["axe", "claude"])
    lib = await store.uninstall("meeting-notes")
    expect(existsSync(join(home, ".claude/skills/meeting-notes/SKILL.md"))).toBe(true)
    expect(lib.skills.find((s) => s.id === "meeting-notes")!.installedIn).toEqual(["claude"])
  })

  it("makes and imports skills of your own", async () => {
    const lib = await store.create({ name: "Pricing Page!", description: "Write pricing page copy", body: "Lead with value." })
    expect(lib.skills.find((s) => s.id === "pricing-page")).toMatchObject({ source: "yours", installedIn: ["axe"] })
    await expect(store.create({ name: "pricing page", description: "x", body: "y" })).rejects.toThrow(/already/)
    await expect(store.create({ name: "brand voice", description: "x", body: "y" })).rejects.toThrow(/already/)
    const folder = join(root, "tidy-skill")
    mkdirSync(join(folder, "scripts"), { recursive: true })
    writeFileSync(join(folder, "SKILL.md"), "---\nname: tidy\ndescription: Sort a folder\n---\nSort it.")
    writeFileSync(join(folder, "scripts/sort.sh"), "echo hi")
    await store.importFolder(folder)
    expect(readFileSync(join(data, "skills/tidy/scripts/sort.sh"), "utf8")).toBe("echo hi")
    await expect(store.importFolder(root)).rejects.toThrow(/no SKILL.md/)
  })

  it("parses / and names", () => {
    expect(slashSkill("/brand-voice  rewrite this")).toEqual({ id: "brand-voice", rest: "rewrite this" })
    expect(slashSkill("/brand-voice")).toEqual({ id: "brand-voice", rest: "" })
    expect(slashSkill("not /a skill")).toBeNull()
    expect(skillId("  Deck Outline (v2)  ")).toBe("deck-outline-v2")
    expect(skillBody("---\nname: x\n---\n\nDo it.\n")).toBe("Do it.")
  })
})

describe("agents library", () => {
  it("has starters, saves yours, copies a changed starter and won't delete starters", () => {
    expect(listHelpers().filter((h) => h.starter).map((h) => h.id)).toEqual(["writer", "researcher", "meeting-notes", "launch", "contracts", "code-reviewer"])
    const writer = listHelpers().find((h) => h.id === "writer")!
    const after = saveHelper({ ...writer, name: "Writer for Jack" })
    const copy = after.find((h) => h.name === "Writer for Jack")!
    expect(copy.id).not.toBe("writer")
    expect(copy.starter).toBeUndefined()
    expect(after.find((h) => h.id === "writer")!.name).toBe("Writer")
    expect(() => saveHelper({ ...writer, name: " " })).toThrow(/name/)
    expect(() => deleteHelper("writer")).toThrow(/can't be deleted/)
    expect(deleteHelper(copy.id).some((h) => h.id === copy.id)).toBe(false)
  })
})

describe("in chats", () => {
  const posts = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/messages"))
  const sentText = (c: Call) => ((c.body!.message as { parts: { text: string }[] }).parts[0]!.text)

  it("an Axe model gets a skill's instructions when you pick it from /, and the chat shows only what you typed", async () => {
    await new SkillStore(
      () => home,
      () => join(data, "skills"),
    ).install("brand-voice", [])
    const { threadId } = await chat.send({ threadId: null, text: "/brand-voice Make this calmer: BUY NOW!!!", answerer: { kind: "axe", modelId: "auto" } })
    await until(done(threadId, 1))
    const text = sentText(posts().at(-1)!)
    expect(text.startsWith(LIBRARY_OPEN)).toBe(true)
    expect(text).toContain('The user picked the skill "brand-voice"')
    expect(text).toContain("No hype words")
    expect(stripContext(text)).toBe("/brand-voice Make this calmer: BUY NOW!!!")
    // A skill that isn't installed goes as plain text.
    await chat.send({ threadId, text: "/deck-outline for Monday", answerer: { kind: "axe", modelId: "auto" } })
    await until(done(threadId, 2))
    expect(sentText(posts().at(-1)!)).toBe("/deck-outline for Monday")
  })

  it("a chat started with an agent carries it, once", async () => {
    const { threadId } = await chat.send({ threadId: null, text: "Plan day one", answerer: { kind: "axe", modelId: "auto" }, helperId: "researcher" })
    await until(done(threadId, 1))
    const first = sentText(posts().at(-1)!)
    expect(first).toContain('You are "Researcher"')
    expect(first).toContain('The user picked the skill "research-brief"')
    const listed = await chat.listThreads()
    expect(listed.find((t) => t.id === threadId)).toMatchObject({ helperId: "researcher" })
    await chat.send({ threadId, text: "And day two?", answerer: { kind: "axe", modelId: "auto" } })
    await until(done(threadId, 2))
    expect(sentText(posts().at(-1)!)).toBe("And day two?")
  })

  it("an Axe model uses a connector: tools through /api/agent/respond, a round trip to the MCP server, and asks before changing things", async () => {
    const view = await hub().addCustom({ name: "Taskboard", url: fake.url })
    const id = view.connected[0]!.id
    answers.push([/^Let Taskboard add task/, "chat"])
    const { threadId } = await chat.send({ threadId: null, text: "What's on my board? Add 'Call David'.", answerer: { kind: "axe", modelId: "auto" }, connectors: [id] })
    await until(done(threadId, 1), 20_000)
    const reply = lastDone(threadId)
    expect(reply.error).toBeUndefined()
    const tools = reply.message.parts.filter((x) => x.type === "tool")
    expect(tools.map((t) => (t.type === "tool" ? [t.title, t.state, t.kind] : []))).toEqual([
      ["Taskboard: List tasks", "done", "other"],
      ["Taskboard: Add task", "done", "other"],
    ])
    const text = reply.message.parts.find((x) => x.type === "text")
    expect(text && text.type === "text" && text.text).toBe("You have the Lisbon trip open; added Call David.")
    expect(fake.calls).toEqual([{ tool: "list_tasks" }, { tool: "add_task", title: "Call David" }])
    // Asked once, before the change, and remembered "Allow in this chat".
    expect((events.permission ?? []).filter((p) => p.threadId === threadId).map((p) => p.title)).toEqual(["Let Taskboard add task?"])
    const respond = calls.filter((c) => c.url.endsWith("/api/agent/respond"))
    expect(respond[0]!.body).toMatchObject({ model: "auto", autoPaid: true })
    expect((respond[0]!.body!.tools as { name: string }[]).map((t) => t.name)).toEqual(["Taskboard__list_tasks", "Taskboard__add_task"])
    // The server named the chat from the message; the turn lives on this computer beside it.
    expect(calls.some((c) => c.method === "PATCH" && (c.body as { title?: string })?.title === "What's on my board? Add 'Call David'.")).toBe(true)
    const listed = await chat.listThreads()
    expect(listed.find((t) => t.id === threadId)!.connectors).toEqual([id])
    const stored = await chat.threadMessages(threadId)
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"])

    // Next turn: no question this time.
    await chat.send({ threadId, text: "Again please", answerer: { kind: "axe", modelId: "auto" } })
    await until(done(threadId, 2), 20_000)
    expect((events.permission ?? []).filter((p) => p.threadId === threadId)).toHaveLength(1)

    // Connectors off for the chat: back to the normal chat endpoint.
    chat.setConnectors(threadId, [])
    const before = posts().length
    await chat.send({ threadId, text: "Thanks", answerer: { kind: "axe", modelId: "auto" } })
    await until(done(threadId, 3))
    expect(posts().length).toBe(before + 1)
  })

  it("read-only tools never ask", () => {
    expect(readOnly("list_tasks")).toBe(true)
    expect(readOnly("search")).toBe(true)
    expect(readOnly("add_task")).toBe(false)
    expect(readOnly("delete_page")).toBe(false)
  })

  it("a CLI agent works in its folder and gets the connectors over ACP", async () => {
    const { threadId } = await chat.send({ threadId: null, text: "Look at the notes", answerer: { kind: "agent", agentId: "fake" }, cwd: work })
    await until(done(threadId, 1), 20_000)
    expect(lastDone(threadId).error).toBeUndefined()
    const lines = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { cwd?: string; mcpServers?: { type?: string; name: string; url?: string }[]; texts?: string[] })
    const session = lines.filter((l) => l.mcpServers).at(-1)!
    expect(session.cwd).toBe(work)
    // Axe's own browser and computer use (package D) first, then your connectors.
    expect(session.mcpServers!.map((m) => m.name)).toEqual(["axe", "taskboard"])
    expect(session.mcpServers![1]).toEqual({ type: "http", name: "taskboard", url: fake.url, headers: [] })
    const prompt = lines.filter((l) => l.texts).at(-1)!.texts!
    expect(prompt.at(-1)).toBe("Look at the notes")
    expect(existsSync(join(work, "hello.txt"))).toBe(true)
  })
})
