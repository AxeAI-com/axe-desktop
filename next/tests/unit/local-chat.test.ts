import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { EventName, Events } from "@shared/api"
import type { PermissionRequest, ReplyUpdate } from "@shared/types"

import { getLocal, resetStoreForTests } from "../../src/main/agents/store"
import { configureAccount } from "../../src/main/axe/account"
import { setEmitter } from "../../src/main/bus"
import * as chat from "../../src/main/chat"
import { hub } from "../../src/main/libraries"
import * as lm from "../../src/main/local-models"
import { resetSettingsForTests, updateSettings } from "../../src/main/settings"
// @ts-expect-error: a plain .mjs fixture
import { startFakeMcp } from "../fixtures/fake-mcp.mjs"

// A chat with a model on a local server, end to end through chat.send, against a stand-in server that
// speaks the OpenAI API (thinking first, then the answer), like Ollama or LM Studio do.

const data = mkdtempSync(join(tmpdir(), "axe-local-chat-"))
const saved = process.env.AXE_DATA_DIR
const replies: ReplyUpdate[] = []
const waiters: (() => void)[] = []
const bodies: { model: string; messages: { role: string; content: string }[] }[] = []
let server: Server

function until(check: () => boolean, ms = 5000) {
  if (check()) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms)
    const w = () => check() && (clearTimeout(t), waiters.splice(waiters.indexOf(w), 1), resolve())
    waiters.push(w)
  })
}
const done = (threadId: string, n: number) => () => replies.filter((r) => r.threadId === threadId && r.done).length >= n
const last = (threadId: string) => replies.filter((r) => r.threadId === threadId && r.done).at(-1)!

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url !== "/v1/chat/completions") return void res.writeHead(404).end()
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      bodies.push(JSON.parse(body))
      res.writeHead(200, { "content-type": "text/event-stream" })
      const n = bodies.length
      for (const d of [{ reasoning_content: "Let me think." }, { content: "\n\nHello" }, { content: ` number ${n}.` }]) res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`)
      res.end("data: [DONE]\n\n")
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const a = server.address()
  const port = typeof a === "object" && a ? a.port : 0
  process.env.AXE_DATA_DIR = data
  resetSettingsForTests()
  resetStoreForTests()
  configureAccount({})
  setEmitter(<K extends EventName>(event: K, payload: Events[K]) => {
    if (event === "reply") replies.push(payload as ReplyUpdate)
    for (const w of [...waiters]) w()
  })
  updateSettings({ modelServers: [{ id: "custom-test", name: "Test box", url: `http://127.0.0.1:${port}/v1` }] })
})

afterAll(() => {
  server.close()
  process.env.AXE_DATA_DIR = saved
  resetSettingsForTests()
  resetStoreForTests()
})

describe("a chat with a local model", () => {
  const answerer = { kind: "local", modelId: "custom-test|qwen3:1.7b" } as const
  let threadId = ""

  it("streams thinking then the answer, and keeps the chat on this computer", async () => {
    threadId = (await chat.send({ threadId: null, text: "Say hello", answerer })).threadId
    await until(done(threadId, 1))
    const reply = last(threadId)
    expect(reply.error).toBeUndefined()
    expect(reply.message.parts.map((p) => p.type)).toEqual(["reasoning", "text"])
    expect(reply.message.parts[0]).toMatchObject({ text: "Let me think.", done: true })
    expect(reply.message.parts[1]).toMatchObject({ text: "Hello number 1." })
    expect(bodies[0]!.model).toBe("qwen3:1.7b")
    const local = getLocal(threadId)!
    expect(local).toMatchObject({ source: "local", localModel: answerer.modelId })
    expect((await chat.listThreads()).find((t) => t.id === threadId)).toMatchObject({ source: "local", localModel: answerer.modelId })
  })

  it("sends the earlier turns with the next message", async () => {
    await chat.send({ threadId, text: "Again", answerer })
    await until(done(threadId, 2))
    expect(last(threadId).message.parts.at(-1)).toMatchObject({ text: "Hello number 2." })
    expect(bodies[1]!.messages.map((m) => [m.role, m.content])).toEqual([
      ["system", expect.any(String)],
      ["user", "Say hello"],
      ["assistant", "Hello number 1."],
      ["user", "Again"],
    ])
  })

  it("stays a local chat: other answerers start their own", async () => {
    await expect(chat.send({ threadId, text: "Hi", answerer: { kind: "axe", modelId: "auto" } })).rejects.toThrow("Start a new chat")
  })

  it("says so in plain words when the server isn't running", async () => {
    updateSettings({ modelServers: [{ id: "custom-gone", name: "Gone", url: "http://127.0.0.1:1/v1" }] })
    const id = (await chat.send({ threadId: null, text: "Hi", answerer: { kind: "local", modelId: "custom-gone|x" } })).threadId
    await until(done(id, 1))
    expect(last(id).error).toBe("Gone isn't running. Open it, then try again.")
  })
})

// Local models with tools, through chat.send, against a stand-in Ollama: qwen2.5:7b uses tools, gemma:2b
// only chats and can't see. Do it writes in a temp workspace; a connector is the fake Taskboard.

type ToolBody = { model: string; messages: { role: string; content: unknown; tool_call_id?: string }[]; tools?: { function: { name: string } }[] }
const toolBodies: ToolBody[] = []
const permissions: PermissionRequest[] = []
let ollama: Server
let fake: { url: string; calls: { tool: string }[]; close(): Promise<void> }
const workspace = mkdtempSync(join(tmpdir(), "axe-local-workspace-"))
const qwen = { kind: "local", modelId: "ollama|qwen2.5:7b" } as const
const gemma = { kind: "local", modelId: "ollama|gemma:2b" } as const

const said = (deltas: object[]) => `${deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`).join("")}data: [DONE]\n\n`

beforeAll(async () => {
  process.env.AXE_DOIT_WORKSPACE = workspace
  fake = await startFakeMcp({ auth: false })
  ollama = createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const json = (v: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v))
      if (req.url === "/api/version") return json({ version: "0.40.11" })
      if (req.url === "/api/tags") return json({ models: [] })
      if (req.url === "/v1/models") return json({ data: [{ id: "qwen2.5:7b" }, { id: "gemma:2b" }] })
      const body = JSON.parse(raw) as ToolBody
      if (req.url === "/api/show") return json({ capabilities: body.model === "gemma:2b" ? ["completion"] : ["completion", "tools"] })
      if (req.url !== "/v1/chat/completions") return void res.writeHead(404).end()
      toolBodies.push(body)
      if (body.tools && body.model === "gemma:2b") return json({ error: { message: "registry.ollama.ai/library/gemma:2b does not support tools" } }, 400)
      res.writeHead(200, { "content-type": "text/event-stream" })
      const last = body.messages.at(-1)!
      const names = (body.tools ?? []).map((t) => t.function.name)
      if (!body.tools) return void res.end(said([{ content: "Just chatting." }]))
      if (last.role === "tool") return void res.end(said([{ content: names.includes("write_file") ? "Made notes.txt saying hi." : `From your board: ${String(last.content).slice(0, 60)}` }]))
      if (names.includes("write_file"))
        return void res.end(said([{ content: "", tool_calls: [{ id: `call_${toolBodies.length}`, index: 0, type: "function", function: { name: "write_file", arguments: '{"path":"notes.txt","content":"hi"}' } }] }]))
      res.end(said([{ tool_calls: [{ id: "call_board", index: 0, type: "function", function: { name: "Taskboard__list_tasks", arguments: "{}" } }] }]))
    })
  })
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r))
  const a = ollama.address()
  lm.ollamaForTests({ host: `127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, paths: [], which: "" })
  setEmitter(<K extends EventName>(event: K, payload: Events[K]) => {
    if (event === "reply") replies.push(payload as ReplyUpdate)
    if (event === "permission") permissions.push(payload as PermissionRequest)
    for (const w of [...waiters]) w()
  })
})

afterAll(async () => {
  ollama.close()
  await hub().closeAll()
  await fake.close()
  delete process.env.AXE_DOIT_WORKSPACE
})

const tools = (threadId: string) => last(threadId).message.parts.flatMap((p) => (p.type === "tool" ? [[p.title, p.state]] : []))
const words = (threadId: string) => last(threadId).message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("")

describe("a local model with tools", () => {
  let threadId = ""

  it("does it: writes the file in the workspace, shown as a step", async () => {
    threadId = (await chat.send({ threadId: null, text: "Make notes.txt in the workspace saying hi", answerer: qwen, doIt: true })).threadId
    await until(done(threadId, 1), 15_000)
    expect(last(threadId).error).toBeUndefined()
    expect(readFileSync(join(workspace, "notes.txt"), "utf8")).toBe("hi")
    expect(tools(threadId)).toEqual([["Write notes.txt", "done"]])
    expect(words(threadId)).toBe("Made notes.txt saying hi.")
    // The Do it tools went out in OpenAI's shape, and the result came back as a tool message.
    const [first, second] = toolBodies.slice(-2)
    expect(first!.tools!.map((t) => t.function.name)).toEqual(expect.arrayContaining(["write_file", "run_command", "browser_open"]))
    expect(second!.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: expect.stringMatching(/^call_/) })
    expect(getLocal(threadId)).toMatchObject({ source: "local", localModel: qwen.modelId })
  })

  it("asks first, as for Axe models: replacing a file waits for a yes, and a no keeps it", async () => {
    writeFileSync(join(workspace, "notes.txt"), "keep me")
    await chat.send({ threadId, text: "Write it again", answerer: qwen, doIt: true })
    await until(() => permissions.some((p) => p.threadId === threadId))
    const ask = permissions.find((p) => p.threadId === threadId)!
    expect(ask.title).toBe("Replace notes.txt")
    chat.answerPermission(ask.id, "deny")
    await until(done(threadId, 2), 15_000)
    expect(readFileSync(join(workspace, "notes.txt"), "utf8")).toBe("keep me")
    expect(tools(threadId)).toEqual([["Write notes.txt", "declined"]])
  })

  it("uses a connector: calls its read tool and answers from the result", async () => {
    const view = await hub().addCustom({ name: "Taskboard", url: fake.url })
    const id = view.connected[0]!.id
    const t = (await chat.send({ threadId: null, text: "What's on my board?", answerer: qwen, connectors: [id] })).threadId
    await until(done(t, 1), 15_000)
    expect(last(t).error).toBeUndefined()
    expect(tools(t)).toEqual([["Taskboard: List tasks", "done"]])
    expect(fake.calls).toEqual([{ tool: "list_tasks" }])
    expect(words(t)).toMatch(/^From your board: [\s\S]*Lisbon/)
  })

  it("a model without tools just chats, even with Do it on, and says it can't see a photo", async () => {
    const photo = join(workspace, "photo.png")
    writeFileSync(photo, Buffer.from([137, 80, 78, 71]))
    const t = (
      await chat.send({ threadId: null, text: "What's this?", answerer: gemma, doIt: true, attachments: [{ path: photo, name: "photo.png", mime: "image/png", size: 4 }] })
    ).threadId
    await until(done(t, 1), 15_000)
    expect(last(t).error).toBeUndefined()
    expect(tools(t)).toEqual([["Left out photo.png", "failed"]])
    expect(last(t).message.parts.find((p) => p.type === "tool")).toMatchObject({ output: "This model can't see photos, so it only got the file's name." })
    expect(words(t)).toBe("Just chatting.")
    const sent = toolBodies.at(-1)!
    expect(sent.tools).toBeUndefined()
    expect(String(sent.messages.at(-1)!.content)).toContain("(Attached: photo.png, a photo you can't see.)")
  })
})

describe("Ollama started for a message", () => {
  it("starts a stopped Ollama, shows it as a step, then answers; quitting stops only that one", async () => {
    ollama.close()
    const port = await new Promise<number>((r) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const a = s.address()
        s.close(() => r(typeof a === "object" && a ? a.port : 0))
      })
    })
    const wrapper = join(workspace, "ollama")
    writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${resolve(import.meta.dirname, "../fixtures/fake-ollama.mjs")}"\n`)
    chmodSync(wrapper, 0o755)
    lm.ollamaForTests({ host: `127.0.0.1:${port}`, paths: [wrapper] })
    const t = (await chat.send({ threadId: null, text: "Hi", answerer: qwen })).threadId
    await until(done(t, 1), 20_000)
    expect(last(t).error).toBeUndefined()
    expect(tools(t)).toEqual([["Started Ollama", "done"]])
    expect(words(t)).toBe("Started and answering.")
    expect(lm.ownsOllama()).toBe(true)
    lm.stopOllama()
    const end = Date.now() + 5000
    while ((await lm.ollamaRunning()) && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
    expect(await lm.ollamaRunning()).toBe(false)
  }, 30_000)
})
