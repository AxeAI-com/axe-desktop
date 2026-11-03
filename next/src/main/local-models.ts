import { execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir, totalmem } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import type { Json, LocalModel, ModelPull, ModelServer } from "@shared/types"

// The looser of the two loops' Brain shapes, so one local brain serves both.
import type { Brain } from "./libraries/tool-turn"
import type { SecretBox } from "./libraries/oauth"
import { dataPath } from "./paths"
import { settings, updateSettings } from "./settings"
import { childEnv, which } from "./shell-env"

// Models that servers on this computer run: Ollama, LM Studio and llama.cpp are looked for by themselves
// (a short probe each, so a missing one costs nothing), and the user can add any other server that
// speaks the OpenAI API by its address. They're free and nothing leaves the computer. Mirrors
// LocalModels.swift from the Swift app.
//
// Ollama gets more: Axe finds it on this computer, starts it when you send (or from Settings, or when
// Axe opens), pulls models with progress and warms a model when you pick it. Axe stops only an Ollama
// it started itself. Local models also work with tools (Do it, connectors) through `localBrain`.

type Server = { id: string; name: string; api: string; custom?: boolean; tags?: string }

/** Where Ollama listens. Axe only ever starts it on this computer's loopback address. */
let ollamaHost = "127.0.0.1:11434"
/** Where Axe looks for Ollama, in order: the Mac app first, then the command. */
let ollamaPaths = (): string[] => [
  ...(process.platform === "darwin" ? ["/Applications/Ollama.app", join(homedir(), "Applications/Ollama.app")] : []),
  "/opt/homebrew/bin/ollama",
  "/usr/local/bin/ollama",
]
let ollamaWhich: () => Promise<string | undefined> = () => which("ollama")
/** Ollama's own model folder, read while it isn't running so its models can still be picked. */
let ollamaModelsDir = () => process.env.OLLAMA_MODELS || join(homedir(), ".ollama", "models")

const builtIn = (): Server[] => [
  // Ollama also lists sizes on its own API, so the smallest model can go first.
  { id: "ollama", name: "Ollama", api: `http://${ollamaHost}/v1`, tags: `http://${ollamaHost}/api/tags` },
  { id: "lmstudio", name: "LM Studio", api: "http://127.0.0.1:1234/v1" },
  { id: "llamacpp", name: "llama.cpp", api: "http://127.0.0.1:8080/v1" },
]

const PROBE_MS = 600

// Keys for servers the user added live with the connectors' secrets (set at startup).
let keyBox: () => SecretBox | undefined = () => undefined
export function configureLocalModels(o: { box: () => SecretBox | undefined }) {
  keyBox = o.box
}
const connectorSecretBox = () => keyBox()

const keyId = (serverId: string) => `model-server:${serverId}`
const keyFor = (serverId: string) => connectorSecretBox()?.get(keyId(serverId))?.token

function allServers(): Server[] {
  return [...builtIn(), ...(settings().modelServers ?? []).map((s) => ({ id: s.id, name: s.name, api: s.url, custom: true }))]
}

const headers = (serverId: string): Record<string, string> => {
  const key = keyFor(serverId)
  return { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }
}

async function getJSON(url: string, h: Record<string, string>, ms = PROBE_MS): Promise<unknown> {
  const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

/** "qwen3:1.7b" → "Qwen3 1.7B", "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF" → "Qwen3 4B Instruct 2507". */
export function prettyName(model: string): string {
  const [base = model, tag] = (model.split("/").pop() ?? model).replace(/\.gguf$/i, "").split(":")
  const words = [...base.split(/[-_\s]+/), ...(tag && tag !== "latest" ? tag.split(/[-_]+/) : [])].filter((w) => w && !/^gguf$/i.test(w))
  return words.map((w) => (/^\d+(\.\d+)?[bkm]$/i.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1))).join(" ") || model
}

/** Billions of parameters from the name ("1.7b"), else the size on disk; small first. */
export function weight(m: Pick<LocalModel, "model" | "size">): number {
  const b = m.model.match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/i)
  if (b) return Number(b[1])
  return m.size ? m.size / 6e8 : Number.POSITIVE_INFINITY
}

// What a model can do: Ollama says (POST /api/show → capabilities); other servers don't, so Axe tries
// and remembers a server that refused tools. Kept for the app's run.

export type Capabilities = { tools?: boolean; vision?: boolean; thinking?: boolean }
const shown = new Map<string, Promise<Capabilities>>()
const learned = new Map<string, Capabilities>()

async function ollamaShow(model: string): Promise<Capabilities> {
  const res = await fetch(`http://${ollamaHost}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) throw new Error(String(res.status))
  const caps = ((await res.json()) as { capabilities?: unknown }).capabilities
  // Older Ollama versions don't list capabilities: unknown, so Axe tries.
  if (!Array.isArray(caps)) return {}
  return { tools: caps.includes("tools"), vision: caps.includes("vision"), thinking: caps.includes("thinking") }
}

/** What a local model can do; an empty answer means unknown (Axe tries tools and images). */
export async function capabilities(modelId: string): Promise<Capabilities> {
  const at = modelId.indexOf("|")
  const serverId = modelId.slice(0, at)
  const model = modelId.slice(at + 1)
  let caps: Capabilities = {}
  if (serverId === "ollama") {
    let p = shown.get(model)
    if (!p) {
      p = ollamaShow(model)
      shown.set(model, p)
      // A failed look (Ollama down) is asked again next time.
      p.catch(() => shown.delete(model))
    }
    caps = await p.catch(() => ({}))
  }
  return { ...caps, ...learned.get(modelId) }
}

/** A server said no to tools for this model: remembered, so the composer greys Do it and connectors. */
function learn(modelId: string, caps: Capabilities) {
  learned.set(modelId, { ...learned.get(modelId), ...caps })
  forget()
}

/** Models Ollama has on disk, read from its manifests while it isn't running. */
function ollamaOnDisk(): { model: string; size?: number }[] {
  const root = join(ollamaModelsDir(), "manifests")
  const out: { model: string; size?: number }[] = []
  const walk = (dir: string, parts: string[]) => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const n of names) {
      const path = join(dir, n)
      try {
        if (statSync(path).isDirectory()) walk(path, [...parts, n])
        else if (parts.length >= 2) {
          // registry.ollama.ai/library/qwen2.5/7b → qwen2.5:7b; other namespaces keep theirs (me/model:tag).
          const [host, ns, ...name] = parts
          const base = host === "registry.ollama.ai" && ns === "library" ? name.join("/") : [ns, ...name].join("/")
          if (!base) continue
          const manifest = JSON.parse(readFileSync(path, "utf8")) as { layers?: { size?: unknown }[] }
          const size = (manifest.layers ?? []).reduce((sum, l) => sum + (typeof l.size === "number" ? l.size : 0), 0)
          out.push({ model: `${base}:${n}`, ...(size ? { size } : {}) })
        }
      } catch {}
    }
  }
  walk(root, [])
  return out
}

const asModel = (s: Server, model: string, size?: number): LocalModel => ({
  id: `${s.id}|${model}`,
  model,
  name: prettyName(model),
  serverId: s.id,
  serverName: s.name,
  ...(size ? { size } : {}),
})

async function withCapabilities(models: LocalModel[]): Promise<LocalModel[]> {
  return Promise.all(
    models.map(async (m) => {
      const c = await capabilities(m.id)
      return { ...m, ...(c.tools !== undefined ? { tools: c.tools } : {}), ...(c.vision !== undefined ? { vision: c.vision } : {}) }
    }),
  )
}

async function probe(s: Server): Promise<ModelServer> {
  const out: ModelServer = { id: s.id, name: s.name, url: s.api, found: false, models: [], ...(s.custom ? { custom: true } : {}) }
  if (s.custom && keyFor(s.id)) out.hasKey = true
  try {
    const json = (await getJSON(`${s.api}/models`, headers(s.id))) as { data?: { id?: unknown }[] }
    if (!Array.isArray(json.data)) return out
    const sizes = new Map<string, number>()
    if (s.tags) {
      const tags = (await getJSON(s.tags, {}).catch(() => ({}))) as { models?: { name?: unknown; size?: unknown }[] }
      for (const t of tags.models ?? []) if (typeof t.name === "string" && typeof t.size === "number") sizes.set(t.name, t.size)
    }
    out.found = true
    out.models = await withCapabilities(
      json.data
        .map((d) => d.id)
        .filter((id): id is string => typeof id === "string" && !!id && !/embed/i.test(id))
        .map((model) => asModel(s, model, sizes.get(model))),
    )
  } catch {}
  if (s.id === "ollama") {
    if (owned) out.startedByAxe = true
    if (!out.found && (await findOllama())) {
      // Not running, but here: its models can still be picked, and sending starts it.
      out.canStart = true
      out.models = ollamaOnDisk()
        .filter((m) => !/embed/i.test(m.model))
        .map((m) => ({ ...asModel(s, m.model, m.size), ...learned.get(`${s.id}|${m.model}`) }))
    }
    out.suggested = suggestedModels()
  }
  return out
}

let cached: { at: number; servers: Promise<ModelServer[]> } | undefined

// Something the window shows changed by itself (Ollama started, a model can't use tools): commands.ts
// sends the catalog again.
let changed = () => {}
export function onServersChanged(fn: () => void) {
  changed = fn
}
const forget = () => {
  cached = undefined
  changed()
}

/** Every server, running or not, with its models. Probed again after a few seconds. */
export function modelServers(fresh = false): Promise<ModelServer[]> {
  if (!fresh && cached && Date.now() - cached.at < 5000) return cached.servers
  const servers = Promise.all(allServers().map(probe))
  cached = { at: Date.now(), servers }
  return servers
}

/** Every model on a running server, smallest first. */
export async function localModels(fresh = false): Promise<LocalModel[]> {
  return (await modelServers(fresh))
    .filter((s) => s.found)
    .flatMap((s) => s.models)
    .sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name))
}

/** "http://box:8000" or "http://box:8000/v1" → "http://box:8000/v1". */
export function apiBase(address: string): string {
  const u = new URL(address.trim())
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Use an http or https address.")
  const path = u.pathname.replace(/\/+$/, "")
  return `${u.origin}${/\/v1$/.test(path) ? path : `${path}/v1`}`
}

/** Adds a server by address once it answers with its models; the key (if any) goes in the secret store. */
export async function addModelServer(address: string, key?: string): Promise<ModelServer> {
  const api = apiBase(address)
  const id = `custom-${randomUUID().slice(0, 8)}`
  const name = new URL(api).host
  const h: Record<string, string> = { accept: "application/json", ...(key?.trim() ? { authorization: `Bearer ${key.trim()}` } : {}) }
  let json: { data?: unknown }
  try {
    json = (await getJSON(`${api}/models`, h, 5000)) as { data?: unknown }
  } catch (e) {
    const status = e instanceof Error && /^\d+$/.test(e.message) ? Number(e.message) : 0
    throw new Error(status === 401 || status === 403 ? "That server wants a key." : "Nothing answered at that address.")
  }
  if (!Array.isArray(json.data)) throw new Error("That address isn't a model server.")
  if (key?.trim()) {
    const box = connectorSecretBox()
    if (!box) throw new Error("This computer has no safe place for keys.")
    box.set(keyId(id), { token: key.trim() })
  }
  updateSettings({ modelServers: [...(settings().modelServers ?? []), { id, name, url: api }] })
  cached = undefined
  return probe({ id, name, api, custom: true })
}

export function removeModelServer(id: string) {
  updateSettings({ modelServers: (settings().modelServers ?? []).filter((s) => s.id !== id) })
  connectorSecretBox()?.set(keyId(id), undefined)
  cached = undefined
}

function serverOf(modelId: string): { server: Server; model: string } {
  const at = modelId.indexOf("|")
  const server = allServers().find((s) => s.id === modelId.slice(0, at))
  if (at < 0 || !server) throw new Error("That model's server isn't set up anymore.")
  return { server, model: modelId.slice(at + 1) }
}

export async function localModelName(modelId: string): Promise<string> {
  return (await modelServers()).flatMap((s) => s.models).find((m) => m.id === modelId)?.name ?? prettyName(modelId.slice(modelId.indexOf("|") + 1))
}

// Starting Ollama

type Install = { kind: "app" | "cli"; path: string }
/** The Ollama Axe started (and so may stop). */
let owned: { pid: number; kind: Install["kind"] } | undefined
let starting: Promise<boolean> | undefined

/** Ollama on this computer: the Mac app, or the `ollama` command in a known place or on the PATH. */
export async function findOllama(): Promise<Install | undefined> {
  for (const path of ollamaPaths()) {
    if (!existsSync(path)) continue
    if (path.endsWith(".app")) {
      if (existsSync(join(path, "Contents/MacOS"))) return { kind: "app", path }
    } else return { kind: "cli", path }
  }
  const found = await ollamaWhich().catch(() => undefined)
  return found ? { kind: "cli", path: found } : undefined
}

export async function ollamaRunning(ms = PROBE_MS): Promise<boolean> {
  try {
    await getJSON(`http://${ollamaHost}/api/version`, {}, ms)
    return true
  } catch {
    return false
  }
}

const run = promisify(execFile)
const pidsOf = async (pattern: string): Promise<number[]> =>
  (await run("pgrep", ["-f", pattern]).catch(() => ({ stdout: "" }))).stdout
    .split("\n")
    .map(Number)
    .filter((n) => n > 0)

/**
 * Starts Ollama when it's here and not running, and waits until it answers (up to 15 s). Resolves true
 * when Axe started it, false when it was already running. Only Axe's own Ollama is stopped on quit.
 */
export function startOllama(): Promise<boolean> {
  starting ??= (async () => {
    if (await ollamaRunning()) return false
    const install = await findOllama()
    if (!install) throw new Error("Ollama isn't on this computer. Get it from ollama.com, then try again.")
    let child: ReturnType<typeof spawn> | undefined
    let ended = false
    if (install.kind === "app") {
      // The Mac app may be up already and still starting its server: then it isn't Axe's to stop.
      const app = `${install.path}/Contents/MacOS/`
      const before = await pidsOf(app)
      await run("open", ["-g", "-a", install.path])
      if (!before.length) {
        const after = await waitFor(async () => (await pidsOf(app))[0], 3000)
        if (after) owned = { pid: after, kind: "app" }
      }
    } else {
      const log = openSync(dataPath("ollama.log"), "a")
      const env = { ...(await childEnv()), OLLAMA_HOST: ollamaHost, OLLAMA_KEEP_ALIVE: "30m" }
      child = spawn(install.path, ["serve"], { detached: true, stdio: ["ignore", log, log], env, windowsHide: true })
      closeSync(log)
      child.on("exit", () => (ended = true))
      child.on("error", () => (ended = true))
      child.unref()
      if (child.pid) owned = { pid: child.pid, kind: "cli" }
    }
    cached = undefined
    const up = await waitFor(async () => (ended ? "ended" : (await ollamaRunning(400)) ? "up" : undefined), 15_000)
    if (up === "up") {
      forget()
      return true
    }
    // One that never answered isn't left running behind your back.
    stopOllama()
    throw new Error(
      up === "ended"
        ? `Ollama stopped as it started. Its log is in ${dataPath("ollama.log")}.`
        : "Ollama didn't start in 15 seconds. Try opening it yourself.",
    )
  })().finally(() => {
    starting = undefined
  })
  return starting
}

/** Polls every 250 ms until `check` gives something, or the time is up. */
async function waitFor<T>(check: () => Promise<T | undefined>, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms
  for (;;) {
    const v = await check()
    if (v !== undefined) return v
    if (Date.now() >= end) return undefined
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** On quit: stops Ollama only when Axe started it. One the user started keeps running. */
export function stopOllama() {
  const o = owned
  owned = undefined
  if (!o) return
  try {
    // `ollama serve` was started as its own process group, so its model runners go with it.
    if (o.kind === "cli" && process.platform !== "win32") process.kill(-o.pid, "SIGTERM")
    else process.kill(o.pid, "SIGTERM")
  } catch {
    try {
      process.kill(o.pid, "SIGTERM")
    } catch {}
  }
}

/** Is this model on Ollama, and is Ollama down but here to start? Starts it and says so through `starting`. */
export async function ensureServer(modelId: string, onStarting?: () => void): Promise<void> {
  if (!modelId.startsWith("ollama|") || (await ollamaRunning())) return
  if (!(await findOllama())) return
  onStarting?.()
  await startOllama()
}

/** Models that fit this computer, for "Get a model": they all use tools. */
export function suggestedModels(memory = totalmem()): string[] {
  const gb = memory / 2 ** 30
  if (gb < 12) return ["qwen2.5:3b", "llama3.2:3b"]
  if (gb < 24) return ["qwen2.5:7b", "qwen3:8b"]
  return ["qwen2.5:14b", "qwen3:14b"]
}

let pulling: AbortController | undefined

/** Downloads a model into Ollama (starting it first), with progress as it goes. */
export async function pullModel(name: string, progress: (p: ModelPull) => void): Promise<void> {
  const model = name.trim()
  if (!/^[\w.\-/]+(:[\w.\-]+)?$/.test(model) || model.length > 200) throw new Error("Write a model name like qwen2.5:7b.")
  if (pulling) throw new Error("Another model is downloading. Wait for it to finish.")
  await startOllama()
  const abort = new AbortController()
  pulling = abort
  try {
    const res = await fetch(`http://${ollamaHost}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal: abort.signal,
    })
    if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}.`)
    let ok = false
    for await (const line of lines(res.body)) {
      const j = parseJSON(line) as { status?: unknown; total?: unknown; completed?: unknown; error?: unknown } | undefined
      if (!j) continue
      if (typeof j.error === "string") throw new Error(/not found|file does not exist/i.test(j.error) ? `Ollama has no model called ${model}.` : `Ollama: ${j.error}`)
      const status = typeof j.status === "string" ? j.status : ""
      if (status === "success") ok = true
      progress({
        model,
        status: plainStatus(status),
        ...(typeof j.total === "number" ? { total: j.total } : {}),
        ...(typeof j.completed === "number" ? { completed: j.completed } : {}),
      })
    }
    if (!ok) throw new Error("The download stopped before it finished. Try again.")
    cached = undefined
  } catch (e) {
    if (abort.signal.aborted) throw new Error("Download stopped.")
    if (e instanceof TypeError) throw new Error("Lost Ollama while downloading. Try again.")
    throw e
  } finally {
    pulling = undefined
  }
}

export function cancelPull() {
  pulling?.abort()
}

/** Ollama's words for a pull step, for people. */
function plainStatus(status: string): string {
  if (/^pulling manifest/.test(status)) return "Looking it up"
  if (/^pulling /.test(status)) return "Downloading"
  if (/^verifying/.test(status)) return "Checking the download"
  if (/^writing manifest|^removing/.test(status)) return "Finishing"
  if (status === "success") return "Done"
  return status ? status[0]!.toUpperCase() + status.slice(1) : "Working"
}

/** Loads a model into memory ahead of the first message, so the reply isn't slow. Ollama only. */
export async function warm(modelId: string): Promise<void> {
  if (!modelId.startsWith("ollama|")) return
  await startOllama()
  const res = await fetch(`http://${ollamaHost}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: modelId.slice("ollama|".length), keep_alive: "30m" }),
    signal: AbortSignal.timeout(120_000),
  })
  await res.text().catch(() => "")
  if (!res.ok) throw new Error(`Ollama couldn't load that model (${res.status}).`)
}

// Talking to a model

export type LocalMessage = { role: "system" | "user" | "assistant"; content: string | OpenAIPart[] }
type OpenAIPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }

/**
 * Splits a stream into answer and thinking: some models put thinking in <think>…</think> inside the
 * text, others send it on its own (reasoning_content, or Ollama's reasoning).
 */
export function thinkSplitter(on: { text(d: string): void; reasoning(d: string): void }) {
  let inside = false
  let pending = ""
  return (chunk: string) => {
    pending += chunk
    for (;;) {
      const tag = inside ? "</think>" : "<think>"
      const at = pending.indexOf(tag)
      if (at >= 0) {
        const before = pending.slice(0, at)
        if (before) (inside ? on.reasoning : on.text)(before)
        pending = pending.slice(at + tag.length)
        inside = !inside
        continue
      }
      // Keep a possible half tag for the next chunk.
      let keep = 0
      for (let n = Math.min(tag.length - 1, pending.length); n > 0; n--)
        if (tag.startsWith(pending.slice(-n))) {
          keep = n
          break
        }
      const out = pending.slice(0, pending.length - keep)
      if (out) (inside ? on.reasoning : on.text)(out)
      pending = pending.slice(pending.length - keep)
      return
    }
  }
}

/** The server's own words from an error body, when it sent some. */
function errorWords(detail: string): string {
  try {
    const j = JSON.parse(detail) as { error?: { message?: unknown } | string }
    return typeof j.error === "string" ? j.error : typeof j.error?.message === "string" ? j.error.message : ""
  } catch {
    return ""
  }
}

/**
 * POST /chat/completions as a stream. A down Ollama that's on this computer is started and asked once
 * more, instead of "isn't running". `retry` runs once for a 400, without the extras some servers refuse.
 */
async function postChat(server: Server, body: object, signal: AbortSignal, retry?: () => object | undefined): Promise<Response> {
  const post = (b: object) =>
    fetch(`${server.api}/chat/completions`, {
      method: "POST",
      headers: { ...headers(server.id), "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(b),
      signal,
    })
  const send = async () => {
    const res = await post(body)
    const again = res.status === 400 ? retry?.() : undefined
    return again ? post(again) : res
  }
  const down = () => new Error(`${server.name} isn't running. Open it, then try again.`)
  try {
    return await send()
  } catch (e) {
    if (signal.aborted) throw e
    if (server.id !== "ollama" || !(await findOllama())) throw down()
  }
  await startOllama()
  try {
    return await send()
  } catch (e) {
    if (signal.aborted) throw e
    throw down()
  }
}

async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) yield line
    }
  }
  if (buffer.trim()) yield buffer.trim()
}

const parseJSON = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

type Delta = {
  content?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
  tool_calls?: { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } }[]
}

/** Each streamed delta of an OpenAI-style answer; throws the server's own error. */
async function* deltas(res: Response, server: Server): AsyncGenerator<Delta> {
  for await (const line of lines(res.body as ReadableStream<Uint8Array>)) {
    if (!line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (data === "[DONE]") return
    const j = parseJSON(data) as { choices?: { delta?: Delta }[]; error?: { message?: unknown } | string } | undefined
    if (!j) continue
    if (j.error) throw new Error(typeof j.error === "string" ? j.error : typeof j.error.message === "string" ? j.error.message : `${server.name} stopped.`)
    const d = j.choices?.[0]?.delta
    if (d) yield d
  }
}

async function failure(res: Response, server: Server): Promise<Error> {
  const said = errorWords(await res.text().catch(() => ""))
  return new Error(said ? `${server.name}: ${said}` : `${server.name} answered ${res.status}.`)
}

/** Streams a reply from a local model (OpenAI chat completions over SSE). */
export async function streamLocal(
  modelId: string,
  messages: LocalMessage[],
  on: { text(d: string): void; reasoning(d: string): void },
  signal: AbortSignal,
  options: { maxTokens?: number; think?: boolean; json?: boolean } = {},
): Promise<void> {
  const { server, model } = serverOf(modelId)
  // Thinking off where the server understands it: llama.cpp and vLLM read the template switch, Ollama
  // and llama.cpp read reasoning_effort. A server that rejects them gets the plain request again.
  const noThinking = {
    ...(options.think === false ? { chat_template_kwargs: { enable_thinking: false }, reasoning_effort: "none" } : {}),
    // JSON mode (Ollama and llama.cpp read it); a server that rejects it gets the plain request.
    ...(options.json ? { response_format: { type: "json_object" } } : {}),
  }
  const plain = { model, messages, stream: true, ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}) }
  const res = await postChat(server, { ...plain, ...noThinking }, signal, () => (Object.keys(noThinking).length ? plain : undefined))
  if (!res.ok || !res.body) throw await failure(res, server)
  const split = thinkSplitter(on)
  for await (const d of deltas(res, server)) {
    const thinking = d.reasoning_content ?? d.reasoning
    if (typeof thinking === "string" && thinking) on.reasoning(thinking)
    if (typeof d.content === "string" && d.content) split(d.content)
  }
}

/**
 * One answer for boards (summaries, building one from a sentence), with thinking turned off: on NeoHorse 4B
 * a summary took 8.7 s thinking and 0.9 s without, for the same answer.
 */
export async function askLocal(modelId: string, prompt: string, system: string, signal: AbortSignal, maxTokens?: number, json?: boolean): Promise<string> {
  let text = ""
  const messages: LocalMessage[] = [{ role: "system", content: system }, { role: "user", content: prompt }]
  await streamLocal(modelId, messages, { text: (d) => (text += d), reasoning: () => {} }, signal, { think: false, ...(maxTokens ? { maxTokens } : {}), ...(json ? { json } : {}) })
  return text.trim()
}

// Tools: the Brain both tool loops (doit/loop.ts, libraries/tool-turn.ts) call, on a local server.

export const NO_TOOLS = "This model can't use tools. Turn off Do it and connectors in the + menu, or pick a model that can."

type Rec = Record<string, Json | undefined>
const rec = (x: Json | undefined): Rec => (x && typeof x === "object" && !Array.isArray(x) ? (x as Rec) : {})

/** A user message's content in OpenAI's shape: text stays text, AI SDK image parts become image_url. */
function userContent(content: Json | undefined): string | OpenAIPart[] {
  if (!Array.isArray(content)) return typeof content === "string" ? content : ""
  const parts: OpenAIPart[] = []
  for (const p of content.map(rec)) {
    if (p.type === "text" && typeof p.text === "string") parts.push({ type: "text", text: p.text })
    else if (p.type === "image" && typeof p.image === "string") parts.push({ type: "image_url", image_url: { url: p.image } })
  }
  return parts
}

/** AI SDK messages (what the loops keep) → OpenAI chat messages. */
export function toOpenAI(system: string, messages: Json[]): object[] {
  const out: object[] = system ? [{ role: "system", content: system }] : []
  for (const m of messages.map(rec)) {
    if (m.role === "user") out.push({ role: "user", content: userContent(m.content) })
    else if (m.role === "system" && typeof m.content === "string") out.push({ role: "system", content: m.content })
    else if (m.role === "assistant") {
      if (typeof m.content === "string") {
        out.push({ role: "assistant", content: m.content })
        continue
      }
      const parts = Array.isArray(m.content) ? m.content.map(rec) : []
      const text = parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text as string).join("")
      const calls = parts
        .filter((p) => p.type === "tool-call" && typeof p.toolCallId === "string" && typeof p.toolName === "string")
        .map((p) => ({ id: p.toolCallId, type: "function", function: { name: p.toolName, arguments: JSON.stringify(p.input ?? {}) } }))
      out.push({ role: "assistant", content: text || (calls.length ? null : ""), ...(calls.length ? { tool_calls: calls } : {}) })
    } else if (m.role === "tool" && Array.isArray(m.content)) {
      for (const r of m.content.map(rec)) {
        if (r.type !== "tool-result" || typeof r.toolCallId !== "string") continue
        const o = rec(r.output)
        const value = typeof o.value === "string" ? o.value : JSON.stringify(o.value ?? r.output ?? "")
        out.push({ role: "tool", tool_call_id: r.toolCallId, content: value })
      }
    }
  }
  return out
}

/** The model's arguments as an object; small models sometimes wrap them in a code fence. */
export function parseArguments(raw: string): { input: Rec } | { error: string } {
  const text = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1")
  if (!text) return { input: {} }
  const parsed = parseJSON(text)
  // Some servers send the arguments as a JSON string inside the string.
  const value = typeof parsed === "string" ? parseJSON(parsed) : parsed
  if (value && typeof value === "object" && !Array.isArray(value)) return { input: value as Rec }
  return { error: raw.slice(0, 500) }
}

/**
 * A local model as a Brain: the loops' AI SDK messages and tools go out in OpenAI's shape, streamed
 * tool-call fragments (id, name, arguments) are put back together, and each call comes out as one
 * `tool-input-available` at the end. Arguments that aren't JSON come out with `inputError`, which the
 * loops send back as the call's result so the model sends it again.
 */
export function localBrain(modelId: string): Brain {
  return async function* ({ system, messages, tools, signal }) {
    const { server, model } = serverOf(modelId)
    const body = {
      model,
      messages: toOpenAI(system, messages),
      stream: true,
      // Low, so small models call tools the same way each time.
      temperature: 0.2,
      ...(tools.length
        ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
        : {}),
    }
    const res = await postChat(server, body, signal)
    if (res.status === 400 && tools.length) {
      const said = errorWords(await res.text().catch(() => ""))
      // Ollama: "… does not support tools"; LM Studio and llama.cpp say "tools" or "tool_choice".
      if (!said || /tool/i.test(said)) {
        learn(modelId, { tools: false })
        throw new Error(NO_TOOLS)
      }
      throw new Error(`${server.name}: ${said}`)
    }
    if (!res.ok || !res.body) throw await failure(res, server)

    const out: Json[] = []
    let started = false
    const split = thinkSplitter({
      text: (d) => {
        // Leading blank lines before the first words read as a gap.
        if (!started) {
          d = d.replace(/^\s+/, "")
          if (!d) return
          started = true
        }
        out.push({ type: "text-delta", delta: d })
      },
      reasoning: (d) => out.push({ type: "reasoning-delta", delta: d }),
    })
    const calls: { id: string; name: string; args: string }[] = []
    for await (const d of deltas(res, server)) {
      const thinking = d.reasoning_content ?? d.reasoning
      if (typeof thinking === "string" && thinking) out.push({ type: "reasoning-delta", delta: thinking })
      if (typeof d.content === "string" && d.content) split(d.content)
      for (const t of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
        const id = typeof t.id === "string" && t.id ? t.id : undefined
        // Fragments name their call by index; a server without indexes starts a new call with a new id.
        const i =
          typeof t.index === "number" ? t.index : id && !calls.some((c) => c.id === id) ? calls.length : Math.max(0, calls.length - 1)
        const c = (calls[i] ??= { id: "", name: "", args: "" })
        if (id) c.id = id
        const name = t.function?.name
        // Most servers send the name once; some repeat it with every fragment.
        if (typeof name === "string" && name) c.name = c.name && name.startsWith(c.name) ? name : c.name + name
        const args = t.function?.arguments
        if (typeof args === "string") c.args += args
        else if (args && typeof args === "object") c.args = JSON.stringify(args)
      }
      while (out.length) yield out.shift()!
    }
    while (out.length) yield out.shift()!
    for (const c of calls) {
      if (!c.name) continue
      const toolCallId = c.id || `call_${randomUUID().slice(0, 8)}`
      const parsed = parseArguments(c.args)
      if ("input" in parsed) yield { type: "tool-input-available", toolCallId, toolName: c.name, input: parsed.input as Json }
      else
        yield {
          type: "tool-input-available",
          toolCallId,
          toolName: c.name,
          input: {},
          inputError: `Your arguments for ${c.name} weren't valid JSON, so nothing ran: ${parsed.error}\nSend the call again with the arguments as one JSON object.`,
        }
    }
  }
}

/** Tests only. */
export function forgetServersForTests() {
  cached = undefined
  shown.clear()
  learned.clear()
}

/** Tests only: where Ollama lives and listens. */
export function ollamaForTests(o: { host?: string; paths?: string[]; which?: string; modelsDir?: string }) {
  if (o.host) ollamaHost = o.host
  if (o.paths) ollamaPaths = () => o.paths!
  if (o.paths || o.which !== undefined) ollamaWhich = async () => o.which || undefined
  if (o.modelsDir) ollamaModelsDir = () => o.modelsDir!
  cached = undefined
}

/** Tests only: did Axe start the Ollama that's running? */
export const ownsOllama = () => !!owned
