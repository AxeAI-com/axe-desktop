import { type ChildProcess, spawn } from "node:child_process"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { Readable, Writable } from "node:stream"

import {
  type Client,
  ClientSideConnection,
  type ContentBlock,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  RequestError,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionMode,
  type SessionNotification,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk"

import type { LaunchSpec } from "./registry"

// One CLI agent (Claude Code, Codex…) running as a child process, spoken to over
// ACP on its stdio. The agent uses its own login and plan; we show what it does,
// relay its permission questions, and give it read/write access to files inside
// the chat's folder only. Mirrors ACPAgent.swift.

export type SessionHandlers = {
  onUpdate(n: SessionNotification): void
  onPermission(p: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse>
  /** Called before the agent writes a file through us (so it can be saved first). */
  beforeWrite?(path: string): Promise<void>
  /** MCP servers to give the agent (Axe's browser and computer use); `http` when the agent speaks MCP over HTTP. */
  mcpServers?(http: boolean): Promise<McpServer[]>
}

/** Is `path` inside `root`? Both are resolved through symlinks where they exist. */
export async function insideFolder(root: string, path: string): Promise<string | undefined> {
  if (!isAbsolute(path)) path = resolve(root, path)
  const realRoot = await realpath(root).catch(() => resolve(root))
  // The file may not exist yet: resolve its nearest existing parent.
  let probe = resolve(path)
  let rest = ""
  for (;;) {
    try {
      const real = await realpath(probe)
      const full = rest ? resolve(real, rest) : real
      const rel = relative(realRoot, full)
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? full : undefined
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return undefined
      rest = rest ? join(basename(probe), rest) : basename(probe)
      probe = parent
    }
  }
}

export class AgentSessionError extends Error {}

export class AgentSession {
  private child?: ChildProcess
  private connection?: ClientSideConnection
  private sessionId?: string
  private starting?: Promise<void>
  private stderr = ""
  private exited?: Promise<never>
  private turn?: AbortController
  closed = false
  /** The agent's own permission modes (ACP session modes), and the one it is in. */
  modes: SessionMode[] = []
  currentMode?: string
  /** The agent's own settings (ACP config options: model, effort…), as it last sent them. */
  configOptions: SessionConfigOption[] = []

  constructor(
    readonly agentId: string,
    readonly name: string,
    readonly cwd: string,
    private readonly spec: LaunchSpec,
    private readonly handlers: SessionHandlers,
  ) {}

  get running() {
    return !this.closed && !!this.child && this.child.exitCode === null && !this.child.killed
  }

  /** Starts the process and opens a session (once). */
  start(): Promise<void> {
    this.starting ??= this.open().catch((e) => {
      this.close()
      throw e
    })
    return this.starting
  }

  private async open() {
    const win = process.platform === "win32"
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.cwd,
      env: this.spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      // npx.cmd and friends need a shell on Windows.
      shell: win && /\.(cmd|bat)$/i.test(this.spec.command),
      windowsHide: true,
    })
    this.child = child
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (d: string) => {
      this.stderr = (this.stderr + d).slice(-4000)
    })
    this.exited = new Promise<never>((_, reject) => {
      child.on("error", (e) => reject(new AgentSessionError(`Couldn't start ${this.name}: ${e.message}`)))
      child.on("exit", (code, signal) => {
        this.closed = true
        reject(new AgentSessionError(this.exitMessage(code, signal)))
      })
    })
    this.exited.catch(() => {})

    const stream = ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>)
    const client: Client = {
      sessionUpdate: async (n) => this.handlers.onUpdate(n),
      requestPermission: (p) => this.handlers.onPermission(p, this.turn?.signal ?? new AbortController().signal),
      readTextFile: (p) => this.readTextFile(p),
      writeTextFile: (p) => this.writeTextFile(p),
    }
    const connection = new ClientSideConnection(() => client, stream)
    this.connection = connection

    const init = await Promise.race([
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: "axe-desktop", title: "Axe AI", version: "0.1.0" },
      }),
      this.exited,
    ])
    const mcpServers = (await this.handlers.mcpServers?.(init.agentCapabilities?.mcpCapabilities?.http === true).catch(() => [])) ?? []
    try {
      const session = await Promise.race([connection.newSession({ cwd: this.cwd, mcpServers }), this.exited])
      this.sessionId = session.sessionId
      this.modes = session.modes?.availableModes ?? []
      this.currentMode = session.modes?.currentModeId
      this.configOptions = session.configOptions ?? []
    } catch (e) {
      if (isAuthError(e) || (e instanceof RequestError && (init.authMethods?.length ?? 0) > 0))
        throw new AgentSessionError(`${this.name} needs you to sign in first. Press Sign in to do it in the terminal, then try again.`)
      throw e
    }
  }

  private exitMessage(code: number | null, signal: NodeJS.Signals | null): string {
    const tail = this.stderr.trim().split("\n").slice(-3).join("\n").trim()
    if (/not found|ENOENT|command not found/i.test(tail)) return `${this.name} couldn't start: ${tail}`
    const how = signal ? `was stopped (${signal})` : `quit (code ${code})`
    return tail ? `${this.name} ${how}: ${tail}` : `${this.name} ${how}.`
  }

  /** Sends one message; resolves when the agent finishes its turn. */
  async prompt(blocks: ContentBlock[]): Promise<PromptResponse> {
    await this.start()
    if (!this.connection || !this.sessionId || !this.exited) throw new AgentSessionError(`${this.name} isn't running.`)
    this.turn = new AbortController()
    try {
      return await Promise.race([this.connection.prompt({ sessionId: this.sessionId, prompt: blocks }), this.exited])
    } catch (e) {
      // The CLI's own sign-in lapsed mid-chat ("OAuth session expired"): say how to fix it, not "Authentication required".
      if (isAuthError(e)) throw new AgentSessionError(`${this.name} needs you to sign in again. Press Sign in to do it in the terminal, then try again.`)
      throw e
    } finally {
      this.turn = undefined
    }
  }

  /** Puts the agent in one of its own modes (session/set_mode). */
  async setMode(modeId: string) {
    await this.start()
    if (!this.connection || !this.sessionId) return
    if (this.currentMode === modeId || !this.modes.some((m) => m.id === modeId)) return
    await this.connection.setSessionMode({ sessionId: this.sessionId, modeId })
    this.currentMode = modeId
  }

  /** Changes one of the agent's settings (session/set_config_option); it answers with all of them. */
  async setConfigOption(configId: string, value: string): Promise<SessionConfigOption[]> {
    await this.start()
    if (!this.connection || !this.sessionId) return this.configOptions
    const r = await this.connection.setSessionConfigOption({ sessionId: this.sessionId, configId, value })
    if (r?.configOptions) this.configOptions = r.configOptions
    return this.configOptions
  }

  /** Stops the current turn; open permission questions are withdrawn. */
  async cancel() {
    this.turn?.abort()
    if (this.connection && this.sessionId && this.running) await this.connection.cancel({ sessionId: this.sessionId }).catch(() => {})
  }

  close() {
    this.turn?.abort()
    this.closed = true
    const child = this.child
    if (child && child.exitCode === null) {
      child.stdin?.end()
      child.kill()
      const t = setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 2000)
      t.unref?.()
    }
  }

  // The client side of ACP's file system: only inside the chat's folder.

  private async readTextFile(p: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    const path = await insideFolder(this.cwd, p.path)
    if (!path) throw RequestError.invalidParams(undefined, `Only files inside ${this.cwd} can be read.`)
    let content = await readFile(path, "utf8").catch((e: NodeJS.ErrnoException) => {
      throw e.code === "ENOENT" ? RequestError.resourceNotFound(p.path) : RequestError.internalError(undefined, e.message)
    })
    if (p.line != null || p.limit != null) {
      const lines = content.split("\n")
      const start = Math.max(0, (p.line ?? 1) - 1)
      content = lines.slice(start, p.limit != null ? start + p.limit : undefined).join("\n")
    }
    return { content }
  }

  private async writeTextFile(p: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    const path = await insideFolder(this.cwd, p.path)
    if (!path) throw RequestError.invalidParams(undefined, `Only files inside ${this.cwd} can be changed.`)
    await this.handlers.beforeWrite?.(path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, p.content, "utf8")
    return {}
  }
}

function isAuthError(e: unknown): boolean {
  if (!(e instanceof RequestError)) return false
  return e.code === -32000 || /auth/i.test(e.message)
}
