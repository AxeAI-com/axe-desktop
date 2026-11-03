import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"

import type { LocalAgent } from "@shared/types"

import { dataPath, isSelfTest, readJSON, writeJSON } from "../paths"
import { childEnv, which } from "../shell-env"

// The public ACP registry: agents that speak the Agent Client Protocol and how to
// run each (npx, uvx or a downloadable binary). Mirrors ACPRegistry.swift.

export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"
const DAY = 24 * 60 * 60 * 1000

export type RegistryPackage = { package: string; args?: string[]; env?: Record<string, string> }
export type RegistryBinary = { archive: string; cmd: string; args?: string[]; env?: Record<string, string>; sha256?: string }
export type RegistryAgent = {
  id: string
  name: string
  version: string
  description?: string
  website?: string
  icon?: string
  distribution: { npx?: RegistryPackage; uvx?: RegistryPackage; binary?: Record<string, RegistryBinary> }
}
export type Registry = { version: string; agents: RegistryAgent[] }

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const strList = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined)
const strMap = (v: unknown) =>
  isObj(v) && Object.values(v).every((x) => typeof x === "string") ? (v as Record<string, string>) : undefined

function pkg(v: unknown): RegistryPackage | undefined {
  if (!isObj(v) || !isStr(v.package)) return undefined
  const p: RegistryPackage = { package: v.package }
  const args = strList(v.args)
  const env = strMap(v.env)
  if (args) p.args = args
  if (env) p.env = env
  return p
}

function bin(v: unknown): RegistryBinary | undefined {
  if (!isObj(v) || !isStr(v.archive) || !isStr(v.cmd)) return undefined
  const b: RegistryBinary = { archive: v.archive, cmd: v.cmd }
  const args = strList(v.args)
  const env = strMap(v.env)
  if (args) b.args = args
  if (env) b.env = env
  if (isStr(v.sha256)) b.sha256 = v.sha256.toLowerCase()
  return b
}

/** Reads the registry, skipping entries this version can't use instead of failing. */
export function parseRegistry(json: unknown): Registry {
  const root = isObj(json) ? json : {}
  const agents: RegistryAgent[] = []
  for (const raw of Array.isArray(root.agents) ? root.agents : []) {
    if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.name) || !isObj(raw.distribution)) continue
    const d = raw.distribution
    const distribution: RegistryAgent["distribution"] = {}
    const npx = pkg(d.npx)
    const uvx = pkg(d.uvx)
    if (npx) distribution.npx = npx
    if (uvx) distribution.uvx = uvx
    if (isObj(d.binary)) {
      const binary: Record<string, RegistryBinary> = {}
      for (const [k, v] of Object.entries(d.binary)) {
        const b = bin(v)
        if (b) binary[k] = b
      }
      if (Object.keys(binary).length) distribution.binary = binary
    }
    if (!distribution.npx && !distribution.uvx && !distribution.binary) continue
    const a: RegistryAgent = { id: raw.id, name: raw.name, version: isStr(raw.version) ? raw.version : "0", distribution }
    if (isStr(raw.description)) a.description = raw.description
    if (isStr(raw.website)) a.website = raw.website
    if (isStr(raw.icon)) a.icon = raw.icon
    agents.push(a)
  }
  return { version: isStr(root.version) ? root.version : "?", agents }
}

// Loading: cached in userData, refreshed once a day, the stale copy used offline.

let memory: { registry: Registry; at: number } | undefined

let loading: Promise<Registry> | undefined

export async function loadRegistry(options: { maxAge?: number; fetchImpl?: typeof fetch } = {}): Promise<Registry> {
  const maxAge = options.maxAge ?? DAY
  if (memory && maxAge > 0 && Date.now() - memory.at < maxAge) return memory.registry
  // Calls made while a load runs share it, so a slow or failed second fetch can't replace the first one's list.
  loading ??= fetchRegistry(maxAge, options.fetchImpl).finally(() => (loading = undefined))
  return loading
}

async function fetchRegistry(maxAge: number, fetchImpl?: typeof fetch): Promise<Registry> {
  const file = dataPath("acp-registry.json")
  let cachedAt = 0
  try {
    cachedAt = statSync(file).mtimeMs
  } catch {}
  const cached = cachedAt ? parseRegistry(readJSON<unknown>(file, {})) : undefined
  if (cached?.agents.length && maxAge > 0 && Date.now() - cachedAt < maxAge) {
    memory = { registry: cached, at: cachedAt }
    return cached
  }
  try {
    const res = await (fetchImpl ?? fetch)(REGISTRY_URL, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Axe AI Desktop" } })
    if (!res.ok) throw new Error(`registry ${res.status}`)
    const json = (await res.json()) as unknown
    const fresh = parseRegistry(json)
    if (!fresh.agents.length) throw new Error("empty registry")
    writeJSON(file, json)
    memory = { registry: fresh, at: Date.now() }
    return fresh
  } catch {
    const fallback = cached ?? (memory?.registry.agents.length ? memory.registry : { version: "?", agents: [] })
    memory = { registry: fallback, at: Date.now() - maxAge + 10 * 60 * 1000 } // retry in 10 minutes
    return fallback
  }
}

/** Tests only. */
export function setRegistryForTests(registry: Registry | undefined) {
  loading = undefined
  memory = registry ? { registry, at: Date.now() } : undefined
}

// What we say about each agent.

const NAMES: Record<string, string> = {
  "claude-acp": "Claude Code",
  "codex-acp": "Codex",
  gemini: "Gemini CLI",
  "github-copilot-cli": "GitHub Copilot",
  cursor: "Cursor",
}

const NOTES: Record<string, string> = {
  "claude-acp": "Works in your folders and terminal",
  "codex-acp": "Writes and runs code in your folders",
  gemini: "Reads, edits and runs code in your folders",
  "github-copilot-cli": "Your Copilot plan, in your folders",
  cursor: "Cursor's agent, in your folders",
  opencode: "Open-source agent for your code",
  goose: "Open-source agent that runs tasks for you",
  "qwen-code": "Reads and edits code in your folders",
  "amp-acp": "Writes and runs code in your folders",
  kimi: "Reads and edits code in your folders",
}

/** The agent's own CLI on PATH means the user already uses it (and is signed in). */
const CLI_HINTS: Record<string, string> = {
  "claude-acp": "claude",
  "codex-acp": "codex",
  gemini: "gemini",
  "github-copilot-cli": "copilot",
  opencode: "opencode",
  goose: "goose",
  cursor: "cursor-agent",
  "qwen-code": "qwen",
  cline: "cline",
  auggie: "auggie",
  kimi: "kimi",
  "amp-acp": "amp",
  "factory-droid": "droid",
  "mistral-vibe": "vibe",
}

/** How to sign in to an agent's CLI in the built-in terminal; the CLI itself (it asks) when it has no login command. */
const SIGN_IN: Record<string, string> = { "claude-acp": "claude auth login", "codex-acp": "codex login" }

/** The command for a known agent id; undefined for anything else (never an inherited key like "constructor"). */
export function signInCommand(agentId: unknown): string | undefined {
  if (typeof agentId !== "string") return undefined
  if (Object.hasOwn(SIGN_IN, agentId)) return SIGN_IN[agentId]
  return Object.hasOwn(CLI_HINTS, agentId) ? CLI_HINTS[agentId] : undefined
}

/** Shown first, in this order. */
const FEATURED = ["claude-acp", "codex-acp", "gemini", "github-copilot-cli", "cursor", "opencode", "goose", "qwen-code"]

export const displayName = (a: RegistryAgent) => NAMES[a.id] ?? a.name

export function noteFor(a: RegistryAgent): string {
  const known = NOTES[a.id]
  if (known) return known
  const first = (a.description ?? "").split(/(?<=[.!?])\s/)[0]?.replace(/[.!]+$/, "").trim() ?? ""
  if (first && first.length <= 64) return first.replace(/ · /g, ", ")
  return "Works in your folders"
}

// Running: readiness and how to launch.

export function platformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === "win32" ? "windows" : platform
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch
  return `${os}-${cpu}`
}

export const installDir = (a: RegistryAgent) => dataPath("agents", a.id, a.version)
export const binaryFor = (a: RegistryAgent, key = platformKey()) => a.distribution.binary?.[key]
export const binaryPath = (a: RegistryAgent, b: RegistryBinary) => join(installDir(a), b.cmd)

export type Tools = { which(tool: string): string | undefined; exists(path: string): boolean }

export type LaunchSpec = { command: string; args: string[]; env: Record<string, string> }

export type Readiness =
  | { state: "ready"; launch: { command: string; args: string[]; env?: Record<string, string> } }
  | { state: "install"; reason?: string }
  | { state: "unavailable"; reason: string }

/** Can this agent run here, and how. Pure, so tests can feed it any computer. */
export function readiness(a: RegistryAgent, tools: Tools, key = platformKey()): Readiness {
  const d = a.distribution
  const b = binaryFor(a, key)
  // Already downloaded wins: it starts fastest.
  if (b && tools.exists(binaryPath(a, b))) return { state: "ready", launch: { command: binaryPath(a, b), args: b.args ?? [], ...(b.env ? { env: b.env } : {}) } }
  if (d.npx) {
    const npx = tools.which("npx")
    if (npx && tools.which("node"))
      return { state: "ready", launch: { command: npx, args: ["-y", d.npx.package, ...(d.npx.args ?? [])], ...(d.npx.env ? { env: d.npx.env } : {}) } }
  }
  if (d.uvx) {
    const uvx = tools.which("uvx")
    if (uvx) return { state: "ready", launch: { command: uvx, args: [d.uvx.package, ...(d.uvx.args ?? [])], ...(d.uvx.env ? { env: d.uvx.env } : {}) } }
  }
  if (b) return { state: "install" }
  if (d.npx) return { state: "unavailable", reason: "Needs Node.js. Install it from nodejs.org, then reopen Axe AI." }
  if (d.uvx) return { state: "unavailable", reason: "Needs uv. Install it from docs.astral.sh/uv, then reopen Axe AI." }
  return { state: "unavailable", reason: "There's no version for this computer yet." }
}

export async function realTools(): Promise<Tools> {
  const found = new Map<string, string | undefined>()
  for (const tool of ["npx", "node", "uvx", ...Object.values(CLI_HINTS)]) found.set(tool, await which(tool))
  return { which: (t) => found.get(t), exists: (p) => existsSync(p) }
}

export function toLocalAgent(a: RegistryAgent, r: Readiness): LocalAgent {
  const agent: LocalAgent = { id: a.id, name: displayName(a), note: noteFor(a), state: r.state }
  if (a.icon) agent.icon = a.icon
  if (r.state !== "ready" && r.reason) agent.reason = r.reason
  return agent
}

/** Every agent, featured first, then those whose CLI is already here, then ready ones. */
export function listAgents(registry: Registry, tools: Tools, key = platformKey()): LocalAgent[] {
  const rank = (a: RegistryAgent, r: Readiness) => {
    const f = FEATURED.indexOf(a.id)
    if (f >= 0) return f
    const hint = Object.hasOwn(CLI_HINTS, a.id) ? CLI_HINTS[a.id] : undefined
    if (hint && tools.which(hint)) return 100
    return r.state === "ready" ? 200 : r.state === "install" ? 300 : 400
  }
  // On this computer: its CLI is on the PATH, or its downloaded app is in place.
  const here = (a: RegistryAgent) => {
    const hint = Object.hasOwn(CLI_HINTS, a.id) ? CLI_HINTS[a.id] : undefined
    const b = binaryFor(a, key)
    return !!(hint && tools.which(hint)) || !!(b && tools.exists(binaryPath(a, b)))
  }
  return registry.agents
    .map((a) => ({ a, r: readiness(a, tools, key) }))
    .sort((x, y) => rank(x.a, x.r) - rank(y.a, y.r) || displayName(x.a).localeCompare(displayName(y.a)))
    .map(({ a, r }) => {
      const agent = toLocalAgent(a, r)
      if (here(a)) agent.here = true
      return agent
    })
}

/**
 * Self-tests can add a stand-in agent to the real app (AXE_TEST_AGENT="Name|/path/to/agent.mjs"), run with
 * this app's own Node, so a real-app run doesn't depend on a CLI's sign-in.
 */
function testAgent(): { name: string; script: string } | undefined {
  const v = process.env.AXE_TEST_AGENT
  if (!v || !isSelfTest()) return undefined
  const [name, script] = v.split("|")
  return name && script ? { name, script } : undefined
}

export async function localAgents(): Promise<LocalAgent[]> {
  const test = testAgent()
  const agents = listAgents(await loadRegistry(), await realTools())
  return test ? [{ id: "test-agent", name: test.name, note: "A stand-in agent for self-tests", state: "ready" }, ...agents] : agents
}

/** How to start an agent, with the user's login environment. */
export async function launchSpec(agentId: string): Promise<{ name: string; spec: LaunchSpec }> {
  const test = agentId === "test-agent" ? testAgent() : undefined
  if (test) return { name: test.name, spec: { command: process.execPath, args: [test.script], env: { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: "1" } } }
  const a = (await loadRegistry()).agents.find((x) => x.id === agentId)
  if (!a) throw new Error("That agent isn't in the list anymore.")
  const r = readiness(a, await realTools())
  if (r.state === "install") throw new Error(`Install ${displayName(a)} first.`)
  if (r.state === "unavailable") throw new Error(r.reason)
  return { name: displayName(a), spec: { command: r.launch.command, args: r.launch.args, env: { ...(await childEnv()), ...(r.launch.env ?? {}) } } }
}

// Installing binary agents.

const ARCHIVE = /\.(zip|tar\.gz|tgz|tar\.bz2|tbz2?|tar\.xz|txz|tar)$/i

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: "ignore" })
    p.on("error", reject)
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${basename(command)} exited with ${code}`))))
  })
}

async function unpack(archive: string, file: string, dir: string) {
  if (/\.zip$/i.test(archive)) {
    if (process.platform === "darwin") await run("/usr/bin/ditto", ["-x", "-k", file, dir])
    else if (process.platform === "win32") await run("tar", ["-xf", file, "-C", dir])
    else await run("unzip", ["-q", "-o", file, "-d", dir])
  } else await run("tar", ["-xf", file, "-C", dir])
}

/** Downloads and unpacks a binary agent into userData, checking its SHA-256 when listed. */
export async function installAgent(agentId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const a = (await loadRegistry()).agents.find((x) => x.id === agentId)
  if (!a) throw new Error("That agent isn't in the list anymore.")
  const b = binaryFor(a)
  // npx and uvx agents need nothing: they download on first run.
  if (!b) return
  const res = await fetchImpl(b.archive, { headers: { "User-Agent": "Axe AI Desktop" } })
  if (!res.ok) throw new Error(`Couldn't download ${displayName(a)} (${res.status}).`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (b.sha256) {
    const actual = createHash("sha256").update(bytes).digest("hex")
    if (actual !== b.sha256) throw new Error(`The download of ${displayName(a)} didn't match its checksum, so it wasn't installed.`)
  }
  const dir = installDir(a)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  if (ARCHIVE.test(new URL(b.archive).pathname)) {
    const file = join(dataPath("agents", a.id), `download-${a.version}${new URL(b.archive).pathname.match(ARCHIVE)?.[0] ?? ""}`)
    writeFileSync(file, bytes)
    try {
      await unpack(b.archive, file, dir)
    } finally {
      rmSync(file, { force: true })
    }
  } else {
    // A bare executable.
    const exe = binaryPath(a, b)
    mkdirSync(join(exe, ".."), { recursive: true })
    writeFileSync(exe, bytes)
  }
  const exe = binaryPath(a, b)
  if (!(await stat(exe).catch(() => undefined))) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`${displayName(a)} downloaded, but its program wasn't in it.`)
  }
  if (process.platform !== "win32") chmodSync(exe, 0o755)
}
