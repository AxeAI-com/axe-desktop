import { type ChildProcess, spawn } from "node:child_process"
import { createServer, type Server } from "node:http"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { deflateSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { Json } from "@shared/types"

import type { ConnectorSecret, SecretBox } from "../../src/main/libraries/oauth"

// A stand-in OpenAI-compatible server (what Jan, vLLM or a llama.cpp box answer with), added by address.

const saved = process.env.AXE_DATA_DIR
process.env.AXE_DATA_DIR = mkdtempSync(join(tmpdir(), "axe-local-models-"))

const lm = await import("../../src/main/local-models")
const { localFiles, pdfText } = await import("../../src/main/local-attachments")
const { runToolTurn } = await import("../../src/main/libraries/tool-turn")
// Nothing here may find or start the Ollama on this computer: an empty port, no known paths.
const emptyModels = mkdtempSync(join(tmpdir(), "axe-ollama-models-"))
lm.ollamaForTests({ host: "127.0.0.1:9", paths: [], which: "", modelsDir: emptyModels })
const { resetSettingsForTests, settings } = await import("../../src/main/settings")

const secrets = new Map<string, ConnectorSecret>()
const box: SecretBox = { get: (id) => secrets.get(id), set: (id, s) => (s ? secrets.set(id, s) : secrets.delete(id)) }

let server: Server
let base = ""
let lastBody: { model?: string; messages?: { role: string; content: string }[]; reasoning_effort?: string; chat_template_kwargs?: object } = {}
let rejectExtras = false

beforeAll(async () => {
  lm.configureLocalModels({ box: () => box })
  server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer sekret") {
      res.writeHead(401).end()
      return
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ data: [{ id: "qwen3-4b-instruct-2507" }, { id: "nomic-embed-text" }, { id: "qwen3:1.7b" }] }))
      return
    }
    if (req.url === "/v1/chat/completions") {
      let body = ""
      req.on("data", (c) => (body += c))
      req.on("end", () => {
        lastBody = JSON.parse(body)
        // Some servers refuse settings they don't know.
        if (rejectExtras && lastBody.reasoning_effort) return void res.writeHead(400).end()
        res.writeHead(200, { "content-type": "text/event-stream" })
        // Thinking inside the text, a tag split across chunks, then the answer.
        for (const piece of ["<thi", "nk>weighing it</th", "ink>", "All ", "fine."]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
        res.end("data: [DONE]\n\n")
      })
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const a = server.address()
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`
  resetSettingsForTests()
})

afterAll(() => {
  server.close()
  process.env.AXE_DATA_DIR = saved
})

describe("names and order", () => {
  it("writes model names for people", () => {
    expect(lm.prettyName("qwen3:1.7b")).toBe("Qwen3 1.7B")
    expect(lm.prettyName("qwen3:latest")).toBe("Qwen3")
    expect(lm.prettyName("lmstudio-community/Qwen3-4B-Instruct-2507-GGUF")).toBe("Qwen3 4B Instruct 2507")
    expect(lm.prettyName("gemma-3-4b-it.gguf")).toBe("Gemma 3 4B It")
  })

  it("puts the smallest first, by parameters in the name, else size", () => {
    expect(lm.weight({ model: "qwen3:1.7b" })).toBe(1.7)
    expect(lm.weight({ model: "qwen3-4b-instruct-2507" })).toBe(4)
    expect(lm.weight({ model: "mystery", size: 1.2e9 })).toBe(2)
    expect(lm.weight({ model: "mystery" })).toBe(Number.POSITIVE_INFINITY)
  })

  it("takes an address with or without /v1", () => {
    expect(lm.apiBase("http://box:8000")).toBe("http://box:8000/v1")
    expect(lm.apiBase("http://box:8000/v1/")).toBe("http://box:8000/v1")
    expect(() => lm.apiBase("ftp://box")).toThrow("http or https")
  })
})

describe("thinking", () => {
  it("keeps <think> out of the answer, even split across chunks", () => {
    let text = ""
    let thought = ""
    const split = lm.thinkSplitter({ text: (d) => (text += d), reasoning: (d) => (thought += d) })
    for (const c of ["Hi <th", "ink>hmm</thi", "nk> there <", "b>"]) split(c)
    expect(thought).toBe("hmm")
    expect(text).toBe("Hi  there <b>")
  })
})

describe("a server added by address", () => {
  it("says when it needs a key, and saves it encrypted once it answers", async () => {
    await expect(lm.addModelServer(base)).rejects.toThrow("wants a key")
    await expect(lm.addModelServer("http://127.0.0.1:1")).rejects.toThrow("Nothing answered")
    const s = await lm.addModelServer(base, "sekret")
    expect(s.found).toBe(true)
    expect(s.hasKey).toBe(true)
    // Embedding models can't chat, so they're left out.
    expect(s.models.map((m) => m.name)).toEqual(["Qwen3 4B Instruct 2507", "Qwen3 1.7B"])
    expect(settings().modelServers?.[0]?.url).toBe(`${base}/v1`)
    expect([...secrets.values()]).toEqual([{ token: "sekret" }])
  })

  it("lists its models with the others, smallest first", async () => {
    const mine = (await lm.localModels(true)).filter((m) => m.serverId.startsWith("custom-"))
    expect(mine.map((m) => m.model)).toEqual(["qwen3:1.7b", "qwen3-4b-instruct-2507"])
  })

  it("answers with the thinking left out", async () => {
    const id = (await lm.localModels()).find((m) => m.model === "qwen3:1.7b")!.id
    const text = await lm.askLocal(id, "How is the site?", "You write the summary box.", AbortSignal.timeout(5000))
    expect(text).toBe("All fine.")
    expect(lastBody.model).toBe("qwen3:1.7b")
    expect(lastBody.messages?.map((m) => m.role)).toEqual(["system", "user"])
    // Boards don't need thinking: asked off, both ways servers understand.
    expect(lastBody).toMatchObject({ reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } })
  })

  it("asks again plainly when a server refuses the thinking switch", async () => {
    rejectExtras = true
    const id = (await lm.localModels()).find((m) => m.model === "qwen3:1.7b")!.id
    expect(await lm.askLocal(id, "How is the site?", "Summary.", AbortSignal.timeout(5000))).toBe("All fine.")
    expect(lastBody.reasoning_effort).toBeUndefined()
    rejectExtras = false
  })

  it("goes away with its key", async () => {
    const id = settings().modelServers![0]!.id
    lm.removeModelServer(id)
    expect(settings().modelServers).toEqual([])
    expect(secrets.size).toBe(0)
    await expect(lm.askLocal(`${id}|qwen3:1.7b`, "x", "y", AbortSignal.timeout(1000))).rejects.toThrow("isn't set up anymore")
  })
})

// Tools: a stand-in server that answers each request with what the test sets, and keeps the bodies.

type Body = { model: string; messages: Record<string, Json>[]; tools?: { type: string; function: { name: string; parameters: Json } }[]; temperature?: number }
let toolServer: Server
let toolBase = ""
const toolBodies: Body[] = []
let answer: (b: Body) => { status?: number; error?: string; deltas?: object[] } = () => ({ deltas: [] })

const sse = (deltas: object[]) => deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`).join("") + "data: [DONE]\n\n"

beforeAll(async () => {
  toolServer = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      if (req.url === "/v1/models") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "tooly" }] }))
      const b = JSON.parse(body) as Body
      toolBodies.push(b)
      const a = answer(b)
      if (a.status) return void res.writeHead(a.status, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: a.error ?? "" } }))
      res.writeHead(200, { "content-type": "text/event-stream" }).end(sse(a.deltas ?? []))
    })
  })
  await new Promise<void>((r) => toolServer.listen(0, "127.0.0.1", r))
  const a = toolServer.address()
  toolBase = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/v1`
})

afterAll(() => toolServer.close())

// Added once the address tests above are done with the list.
async function updateSettingsForTools() {
  const { updateSettings } = await import("../../src/main/settings")
  updateSettings({ modelServers: [...(settings().modelServers ?? []), { id: "custom-tools", name: "Tool box", url: toolBase }] })
}

const TOOLS = [
  { name: "write_file", description: "Create a text file.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "read_file", description: "Read a text file.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
] as const

async function collect(messages: Json[], tools = TOOLS as unknown as { name: string; description: string; inputSchema: Json }[], modelId = "custom-tools|tooly") {
  const out: Record<string, Json>[] = []
  for await (const c of lm.localBrain(modelId)({ system: "Be brief.", messages, tools, signal: AbortSignal.timeout(5000) })) out.push(c as Record<string, Json>)
  return out
}

describe("a local model with tools", () => {
  it("joins streamed tool-call fragments into whole calls, in order, after the words", async () => {
    await updateSettingsForTools()
    answer = () => ({
      deltas: [
        { content: "\n\nI'll write it, " },
        { content: "<think>which file?</think>then read it." },
        // llama.cpp: id and name first, the arguments in pieces, a second call by index.
        { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "write_file", arguments: "" } }] },
        { tool_calls: [{ index: 0, function: { arguments: '{"path":"no' } }] },
        { tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":' } }] },
        { tool_calls: [{ index: 0, function: { arguments: 'tes.txt","content":"hi"}' } }] },
        { tool_calls: [{ index: 1, function: { arguments: '"notes.txt"}' } }] },
      ],
    })
    const out = await collect([{ role: "user", content: "Make notes.txt saying hi, then read it." }])
    expect(out.filter((c) => c.type === "text-delta").map((c) => c.delta).join("")).toBe("I'll write it, then read it.")
    expect(out.filter((c) => c.type === "reasoning-delta").map((c) => c.delta).join("")).toBe("which file?")
    expect(out.filter((c) => c.type === "tool-input-available")).toEqual([
      { type: "tool-input-available", toolCallId: "call_a", toolName: "write_file", input: { path: "notes.txt", content: "hi" } },
      { type: "tool-input-available", toolCallId: "call_b", toolName: "read_file", input: { path: "notes.txt" } },
    ])
    // The calls come after every word.
    expect(out.at(-1)?.type).toBe("tool-input-available")
    const sent = toolBodies.at(-1)!
    expect(sent.temperature).toBeLessThanOrEqual(0.3)
    expect(sent.tools?.map((t) => [t.type, t.function.name])).toEqual([
      ["function", "write_file"],
      ["function", "read_file"],
    ])
    expect(sent.tools?.[0]?.function.parameters).toMatchObject({ type: "object", required: ["path", "content"] })
  })

  it("takes Ollama's whole calls too: no index, arguments as an object", async () => {
    answer = () => ({ deltas: [{ content: "", tool_calls: [{ id: "call_x", function: { name: "read_file", arguments: { path: "a.txt" } } }] }] })
    const out = await collect([{ role: "user", content: "Read a.txt" }])
    expect(out).toEqual([{ type: "tool-input-available", toolCallId: "call_x", toolName: "read_file", input: { path: "a.txt" } }])
  })

  it("sends the loop's history in OpenAI's shape: tool_calls, then role tool with tool_call_id", async () => {
    answer = () => ({ deltas: [{ content: "Done." }] })
    await collect([
      { role: "user", content: "Make notes.txt" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Writing it." },
          { type: "tool-call", toolCallId: "call_a", toolName: "write_file", input: { path: "notes.txt", content: "hi" } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call_a", toolName: "write_file", output: { type: "text", value: "Wrote notes.txt." } }] },
      { role: "user", content: [{ type: "text", text: "And this?" }, { type: "image", image: "data:image/png;base64,AAAA", mediaType: "image/png" }] },
    ])
    expect(toolBodies.at(-1)!.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Make notes.txt" },
      {
        role: "assistant",
        content: "Writing it.",
        tool_calls: [{ id: "call_a", type: "function", function: { name: "write_file", arguments: '{"path":"notes.txt","content":"hi"}' } }],
      },
      { role: "tool", tool_call_id: "call_a", content: "Wrote notes.txt." },
      {
        role: "user",
        content: [
          { type: "text", text: "And this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
    ])
  })

  it("hands broken JSON arguments back as an error for the model, without running anything", async () => {
    answer = () => ({ deltas: [{ tool_calls: [{ index: 0, id: "call_bad", function: { name: "write_file", arguments: '{"path": "notes.txt", content: hi' } }] }] })
    const out = await collect([{ role: "user", content: "Make notes.txt" }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: "tool-input-available", toolCallId: "call_bad", toolName: "write_file", input: {} })
    expect(String(out[0]!.inputError)).toMatch(/weren't valid JSON[\s\S]*Send the call again/)
    // A code fence around good JSON is fine.
    expect(lm.parseArguments('```json\n{"path":"a"}\n```')).toEqual({ input: { path: "a" } })
    expect(lm.parseArguments('"{\\"path\\":\\"a\\"}"')).toEqual({ input: { path: "a" } })
    expect(lm.parseArguments("")).toEqual({ input: {} })
  })

  it("the connector loop sends a broken call back, and the model's second try runs", async () => {
    let n = 0
    answer = () => {
      n++
      if (n === 1) return { deltas: [{ tool_calls: [{ index: 0, id: "c1", function: { name: "Notes__search_pages", arguments: "{oops" } }] }] }
      if (n === 2) return { deltas: [{ tool_calls: [{ index: 0, id: "c2", function: { name: "Notes__search_pages", arguments: '{"query":"plans"}' } }] }] }
      return { deltas: [{ content: "Your plan says ship Friday." }] }
    }
    const calls: Json[] = []
    const reply = { id: "r", role: "assistant" as const, parts: [] as never[] }
    const tool = { name: "Notes__search_pages", tool: "search_pages", description: "Search pages", inputSchema: { type: "object", properties: { query: { type: "string" } } } }
    await runToolTurn({
      reply,
      brain: lm.localBrain("custom-tools|tooly"),
      tools: [tool as never],
      system: "Use the tools.",
      history: [],
      text: "What does my plan say?",
      signal: AbortSignal.timeout(5000),
      hooks: { changed() {}, allowed: new Set(), ask: async () => "no", call: async (_t, input) => (calls.push(input as Json), { text: "plans: ship Friday", isError: false }) },
    })
    expect(calls).toEqual([{ query: "plans" }])
    const second = toolBodies.at(-2)!.messages
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1", content: expect.stringContaining("weren't valid JSON") })
    expect(reply.parts.map((p: { type: string; text?: string }) => p.text ?? p.type)).toContain("Your plan says ship Friday.")
  })

  it("says in plain words when a model can't use tools, and remembers it", async () => {
    answer = () => ({ status: 400, error: "registry.ollama.ai/library/gemma:2b does not support tools" })
    await expect(collect([{ role: "user", content: "Hi" }])).rejects.toThrow("This model can't use tools")
    expect((await lm.capabilities("custom-tools|tooly")).tools).toBe(false)
    const m = (await lm.localModels(true)).find((x) => x.id === "custom-tools|tooly")
    expect(m?.tools).toBe(false)
  })
})

// Ollama: what it says a model can do, finding and starting it, its models on disk, pulling.

async function freePort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r))
  const a = s.address()
  await new Promise((r) => s.close(r))
  return typeof a === "object" && a ? a.port : 0
}

const fixture = resolve(import.meta.dirname, "../fixtures/fake-ollama.mjs")
const bin = mkdtempSync(join(tmpdir(), "axe-ollama-bin-"))
/** An `ollama` command that runs the fake, as the launcher would find it. */
function fakeOllama(script = `#!/bin/sh\n[ "$1" = serve ] || exit 2\nexec "${process.execPath}" "${fixture}"\n`) {
  const path = join(bin, `ollama-${Math.random().toString(36).slice(2, 8)}`)
  writeFileSync(path, script)
  chmodSync(path, 0o755)
  return path
}
const until = async (check: () => Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe("Ollama", () => {
  let port = 0
  let mine: ChildProcess | undefined
  beforeAll(async () => {
    port = await freePort()
    lm.ollamaForTests({ host: `127.0.0.1:${port}`, paths: [], which: "" })
  })
  afterAll(() => {
    lm.stopOllama()
    mine?.kill()
  })

  it("says it isn't here when nothing is installed", async () => {
    expect(await lm.findOllama()).toBeUndefined()
    await expect(lm.startOllama()).rejects.toThrow("Ollama isn't on this computer")
  })

  it("lists the models on disk while it's stopped, so they can be picked", async () => {
    const dir = join(emptyModels, "manifests/registry.ollama.ai/library/qwen2.5")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "7b"), JSON.stringify({ layers: [{ size: 4_000_000_000 }, { size: 700_000_000 }] }))
    lm.ollamaForTests({ paths: [fakeOllama()] })
    const ollama = (await lm.modelServers(true)).find((s) => s.id === "ollama")!
    expect(ollama).toMatchObject({ found: false, canStart: true })
    expect(ollama.models).toEqual([{ id: "ollama|qwen2.5:7b", model: "qwen2.5:7b", name: "Qwen2.5 7B", serverId: "ollama", serverName: "Ollama", size: 4_700_000_000 }])
    // Boards only ask running servers by themselves.
    expect((await lm.localModels()).some((m) => m.serverId === "ollama")).toBe(false)
  })

  it("starts it on demand for a message, on 127.0.0.1, and only stops the one it started", async () => {
    let text = ""
    await lm.streamLocal("ollama|qwen2.5:7b", [{ role: "user", content: "Hi" }], { text: (d) => (text += d), reasoning() {} }, AbortSignal.timeout(20_000))
    expect(text).toBe("Started and answering.")
    expect(lm.ownsOllama()).toBe(true)
    const v = (await (await fetch(`http://127.0.0.1:${port}/api/version`)).json()) as { keepAlive?: string }
    expect(v.keepAlive).toBe("30m")
    // Running now: its models come from its API, with what it says they can do.
    const ollama = (await lm.modelServers(true)).find((s) => s.id === "ollama")!
    expect(ollama).toMatchObject({ found: true, startedByAxe: true })
    expect(ollama.models[0]).toMatchObject({ id: "ollama|qwen2.5:7b", tools: true, vision: false })
    expect(await lm.capabilities("ollama|qwen2.5:7b")).toEqual({ tools: true, vision: false, thinking: false })
    lm.stopOllama()
    await until(async () => !(await lm.ollamaRunning()))
    expect(lm.ownsOllama()).toBe(false)
  }, 30_000)

  it("leaves one you started alone: not Axe's to stop", async () => {
    mine = spawn(process.execPath, [fixture], { env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}` }, stdio: "ignore" })
    await until(() => lm.ollamaRunning())
    expect(await lm.startOllama()).toBe(false)
    expect(lm.ownsOllama()).toBe(false)
    lm.stopOllama()
    await new Promise((r) => setTimeout(r, 300))
    expect(await lm.ollamaRunning()).toBe(true)
  })

  it("pulls a model with progress in plain words, and says when there's no such model", async () => {
    const seen: string[] = []
    let last: { completed?: number; total?: number } = {}
    await lm.pullModel("qwen2.5:3b", (p) => {
      if (seen.at(-1) !== p.status) seen.push(p.status)
      if (p.total) last = p
    })
    expect(seen).toEqual(["Looking it up", "Downloading", "Checking the download", "Done"])
    expect(last).toMatchObject({ completed: 1000, total: 1000 })
    await expect(lm.pullModel("nope:1b", () => {})).rejects.toThrow("Ollama has no model called nope:1b.")
    await expect(lm.pullModel("rm -rf /", () => {})).rejects.toThrow("Write a model name like qwen2.5:7b.")
    await lm.warm("ollama|qwen2.5:7b")
    mine?.kill()
    await until(async () => !(await lm.ollamaRunning()))
  })

  it("says so when Ollama quits as it starts", async () => {
    lm.ollamaForTests({ paths: [fakeOllama("#!/bin/sh\necho 'Error: listen tcp: address already in use' >&2\nexit 1\n")] })
    await expect(lm.startOllama()).rejects.toThrow(/Ollama stopped as it started\. Its log is in .*ollama\.log/)
    expect(lm.ownsOllama()).toBe(false)
  })

  it("offers models that fit this computer", () => {
    expect(lm.suggestedModels(8 * 2 ** 30)).toEqual(["qwen2.5:3b", "llama3.2:3b"])
    expect(lm.suggestedModels(16 * 2 ** 30)).toEqual(["qwen2.5:7b", "qwen3:8b"])
    expect(lm.suggestedModels(64 * 2 ** 30)).toEqual(["qwen2.5:14b", "qwen3:14b"])
  })
})

describe("files for a local model", () => {
  const dir = mkdtempSync(join(tmpdir(), "axe-local-files-"))
  const file = (name: string, body: string | Buffer, mime: string) => {
    const path = join(dir, name)
    writeFileSync(path, body)
    return { path, name, mime, size: Buffer.byteLength(body) }
  }
  // A one-page PDF whose page stream is compressed, as most PDFs are.
  const page = deflateSync(Buffer.from("BT /F1 12 Tf 72 720 Td (Invoice 42: two hours of design) Tj T* [(Total ) -250 (due: 300)] TJ ET", "latin1"))
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n4 0 obj << /Length " + page.length + " /Filter /FlateDecode >>\nstream\n", "latin1"),
    page,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ])

  it("puts text and PDF text inline, photos as images for a model that sees", async () => {
    const f = await localFiles(
      [file("notes.md", "# Plan\nShip Friday.", "text/markdown"), file("invoice.pdf", pdf, "application/pdf"), file("photo.png", Buffer.from([137, 80, 78, 71]), "image/png")],
      true,
    )
    expect(f.text).toContain('<file name="notes.md">\n# Plan\nShip Friday.\n</file>')
    expect(f.text).toContain("Invoice 42: two hours of design\nTotal due: 300")
    expect(f.images).toEqual([{ type: "image", image: "data:image/png;base64,iVBORw==", mediaType: "image/png" }])
    expect(f.left).toEqual([])
    expect(pdfText(Buffer.from("%PDF-1.4 nothing here"))).toBe("")
  })

  it("says when a model can't see a photo, or can't get a file", async () => {
    const f = await localFiles([file("photo.png", Buffer.from([137, 80, 78, 71]), "image/png"), file("deck.pptx", Buffer.from([80, 75, 3, 4, 0, 0]), "application/vnd.openxmlformats-officedocument.presentationml.presentation")], false)
    expect(f.images).toEqual([])
    expect(f.left.map((l) => l.name)).toEqual(["photo.png", "deck.pptx"])
    expect(f.left[0]!.why).toBe("This model can't see photos, so it only got the file's name.")
    expect(f.text).toContain("(Attached: photo.png, a photo you can't see.)")
  })
})
