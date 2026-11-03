import { randomUUID } from "node:crypto"

import type { McpServer } from "@agentclientprotocol/sdk"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import type { Connector, ConnectorsView, CustomConnector, Json } from "@shared/types"

import { readJSON, writeJSON } from "../paths"
import { catalog } from "./catalog"
import { Callback, ConnectorAuth, type SecretBox } from "./oauth"

// Connectors on this computer: brands' remote MCP servers (signed in with OAuth or a token) and local
// ones you run by command. They're stored here, never on axeai.com (connectors are off on the website).
// Axe models use their tools through the app (libraries/tool-turn.ts); CLI agents get them as MCP
// servers in their ACP session (acpServers). Ported from the old app's desktop/src/main/connectors.ts.

type Saved = { id: string; name: string; catalogId?: string; url?: string; command?: string; args?: string[]; enabled: boolean; createdAt: string }
type ToolInfo = { name: string; description?: string; inputSchema: Record<string, unknown> }
type Live = { client: Client; tools: ToolInfo[]; auth?: ConnectorAuth }

/** A connector tool as models see it: "Notion__search". */
export type ConnectorTool = { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, Json>; required: string[] }; connectorId: string; tool: string }

export type HubOptions = {
  file: () => string
  secrets: SecretBox
  /** Opens the brand's sign-in page (the browser; tests fetch it). */
  openUrl: (url: string) => Promise<void>
  onChange?: (view: ConnectorsView) => void
  env?: () => Promise<Record<string, string>>
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 24)
const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200)

export class ConnectorHub {
  private saved: Saved[]
  private live = new Map<string, Live>()
  private state = new Map<string, { state: Connector["state"]; error?: string }>()
  private opening = new Map<string, Promise<Live>>()
  private signIn?: AbortController

  constructor(private readonly o: HubOptions) {
    const s = readJSON<Saved[]>(o.file(), [])
    this.saved = Array.isArray(s) ? s.filter((x) => x && typeof x.id === "string") : []
  }

  view(): ConnectorsView {
    return {
      catalog: catalog(),
      connected: this.saved.map((s) => {
        const st = this.state.get(s.id)
        const live = this.live.get(s.id)
        const c: Connector = {
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          state: st?.state ?? "connected",
          tools: live?.tools.map((t) => t.name) ?? [],
        }
        if (s.catalogId) c.catalogId = s.catalogId
        if (s.url) c.url = s.url
        if (s.command) c.command = s.command
        if (s.args) c.args = s.args
        if (st?.error) c.error = st.error
        return c
      }),
    }
  }

  private changed() {
    this.o.onChange?.(this.view())
  }

  private persist() {
    writeJSON(this.o.file(), this.saved)
  }

  private set(id: string, state: Connector["state"], error?: string) {
    this.state.set(id, error ? { state, error } : { state })
    this.changed()
  }

  /** Opens a session to one connector. `interactive` lets it send you to the brand's sign-in. */
  private async open(s: Saved, interactive: boolean, signal?: AbortSignal): Promise<Live> {
    if (s.command) {
      const env = { ...getDefaultEnvironment(), ...((await this.o.env?.()) ?? {}) }
      const transport = new StdioClientTransport({ command: s.command, args: s.args ?? [], env, stderr: "ignore" })
      return this.handshake(transport)
    }
    if (!s.url) throw new Error("This connector has no address.")
    const secret = this.o.secrets.get(s.id)
    if (secret?.token) {
      const transport = new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: { Authorization: `Bearer ${secret.token}` } } })
      try {
        return await this.handshake(transport)
      } catch (e) {
        if ((e as { code?: unknown }).code === 401 || /401|unauthori[sz]ed|invalid_token/i.test(plain(e))) throw new Error("That token didn't work. Make a new one and try again.")
        throw e
      }
    }
    if (!interactive) {
      const auth = new ConnectorAuth(s.id, this.o.secrets)
      try {
        return { ...(await this.handshake(new StreamableHTTPClientTransport(new URL(s.url), { authProvider: auth }))), auth }
      } catch (e) {
        if (e instanceof UnauthorizedError) throw new NeedsSignIn()
        throw e
      }
    }
    const callback = new Callback()
    const redirect = await callback.start()
    try {
      // A new address for the browser to come back to: register again.
      const prior = this.o.secrets.get(s.id)
      this.o.secrets.set(s.id, prior?.tokens ? { tokens: prior.tokens } : undefined)
      const auth = new ConnectorAuth(s.id, this.o.secrets, redirect)
      const first = new StreamableHTTPClientTransport(new URL(s.url), { authProvider: auth })
      try {
        return { ...(await this.handshake(first)), auth }
      } catch (e) {
        if (!(e instanceof UnauthorizedError) || !auth.signInUrl) throw e
      }
      this.set(s.id, "signin")
      const code = callback.wait(auth.stateValue, signal ?? new AbortController().signal)
      await this.o.openUrl(auth.signInUrl.toString())
      await first.finishAuth(await code)
      return { ...(await this.handshake(new StreamableHTTPClientTransport(new URL(s.url), { authProvider: auth }))), auth }
    } finally {
      callback.close()
    }
  }

  private async handshake(transport: StreamableHTTPClientTransport | StdioClientTransport): Promise<Live> {
    const client = new Client({ name: "Axe AI", version: "1.0.0" })
    await client.connect(transport)
    try {
      const { tools } = await client.listTools()
      return { client, tools: tools as ToolInfo[] }
    } catch (e) {
      await client.close().catch(() => {})
      throw e
    }
  }

  /** A live session, opening it if needed. Never sends you to sign in; marks it instead. */
  async ensure(id: string): Promise<Live> {
    const have = this.live.get(id)
    if (have) return have
    const s = this.saved.find((x) => x.id === id)
    if (!s) throw new Error("That connector isn't here anymore.")
    let p = this.opening.get(id)
    if (!p) {
      p = this.open(s, false)
      this.opening.set(id, p)
    }
    try {
      const live = await p
      this.live.set(id, live)
      this.set(id, "connected")
      return live
    } catch (e) {
      this.set(id, e instanceof NeedsSignIn ? "signin" : "error", e instanceof NeedsSignIn ? "Sign in again to use it." : plain(e))
      throw e instanceof NeedsSignIn ? new Error(`${s.name} needs you to sign in again.`) : e
    } finally {
      this.opening.delete(id)
    }
  }

  /** Connects a directory entry (OAuth in the browser, or the token you pasted). */
  async connect(catalogId: string, token?: string): Promise<ConnectorsView> {
    const entry = catalog().find((c) => c.id === catalogId)
    if (!entry) throw new Error("That connector isn't in the directory.")
    if (entry.auth === "soon") throw new Error(`${entry.name} doesn't let new apps connect yet.`)
    if (entry.auth === "token" && !token?.trim()) throw new Error(`Paste a ${entry.name} token first.`)
    const existing = this.saved.find((s) => s.catalogId === catalogId)
    const s: Saved = existing ?? { id: `c_${randomUUID()}`, name: entry.name, catalogId, url: entry.url, enabled: true, createdAt: new Date().toISOString() }
    return this.add(s, token?.trim())
  }

  async addCustom(c: CustomConnector): Promise<ConnectorsView> {
    const name = c.name.replace(/\s+/g, " ").trim().slice(0, 40)
    if (!name) throw new Error("Give it a name.")
    if (this.saved.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`There's already a connector called ${name}.`)
    const s: Saved = { id: `c_${randomUUID()}`, name, enabled: true, createdAt: new Date().toISOString() }
    if (c.url) {
      const u = new URL(c.url.trim())
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1"
      if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error("Use the https address the brand gives for its MCP server.")
      s.url = u.toString()
    } else if (c.command?.trim()) {
      s.command = c.command.trim()
      s.args = (c.args ?? []).map((a) => a.trim()).filter(Boolean)
    } else throw new Error("Add an address or a command.")
    return this.add(s, c.token?.trim())
  }

  private async add(s: Saved, token: string | undefined): Promise<ConnectorsView> {
    this.signIn?.abort()
    const abort = new AbortController()
    this.signIn = abort
    if (token) this.o.secrets.set(s.id, { token })
    if (!this.saved.some((x) => x.id === s.id)) this.saved.push(s)
    await this.drop(s.id)
    this.set(s.id, "connecting")
    try {
      const live = await this.open(s, true, abort.signal)
      this.live.set(s.id, live)
      s.enabled = true
      this.persist()
      this.set(s.id, "connected")
      return this.view()
    } catch (e) {
      // A first connect that didn't work leaves nothing behind.
      if (!this.wasSaved(s.id)) {
        this.saved = this.saved.filter((x) => x.id !== s.id)
        this.o.secrets.set(s.id, undefined)
        this.state.delete(s.id)
        this.changed()
      } else this.set(s.id, "error", plain(e))
      throw e
    } finally {
      if (this.signIn === abort) this.signIn = undefined
    }
  }

  private wasSaved(id: string) {
    return readJSON<Saved[]>(this.o.file(), []).some((x) => x.id === id)
  }

  /** Stops a sign-in that is waiting for the browser. */
  cancel() {
    this.signIn?.abort()
  }

  async setEnabled(id: string, enabled: boolean): Promise<ConnectorsView> {
    this.saved = this.saved.map((s) => (s.id === id ? { ...s, enabled } : s))
    this.persist()
    if (!enabled) await this.drop(id)
    this.changed()
    return this.view()
  }

  async remove(id: string): Promise<ConnectorsView> {
    await this.drop(id)
    this.saved = this.saved.filter((s) => s.id !== id)
    this.o.secrets.set(id, undefined)
    this.state.delete(id)
    this.persist()
    this.changed()
    return this.view()
  }

  private async drop(id: string) {
    const l = this.live.get(id)
    this.live.delete(id)
    await l?.client.close().catch(() => {})
  }

  /** Enabled connectors among `ids` (all enabled ones when ids is undefined). */
  private chosen(ids?: string[]): Saved[] {
    return this.saved.filter((s) => s.enabled && (!ids || ids.includes(s.id)))
  }

  /** The tools of the connectors you picked, named "<Connector>__<tool>". Ones that fail are left out. */
  async tools(ids?: string[]): Promise<ConnectorTool[]> {
    const out: ConnectorTool[] = []
    for (const s of this.chosen(ids)) {
      const live = await this.ensure(s.id).catch(() => undefined)
      if (!live) continue
      for (const t of live.tools) {
        const schema = t.inputSchema as { properties?: Record<string, Json>; required?: string[] }
        out.push({
          name: `${safe(s.name)}__${t.name}`.slice(0, 64),
          description: (t.description ?? t.name).slice(0, 1000),
          inputSchema: { type: "object", properties: schema.properties ?? {}, required: schema.required ?? [] },
          connectorId: s.id,
          tool: t.name,
        })
      }
    }
    return out
  }

  async call(tool: ConnectorTool, args: Record<string, Json | undefined>): Promise<{ text: string; isError: boolean }> {
    const live = await this.ensure(tool.connectorId)
    const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined))
    const r = (await live.client.callTool({ name: tool.tool, arguments: clean })) as { content?: { type: string; text?: string }[]; isError?: boolean }
    const text = (r.content ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : `[${p.type}]`)).join("\n")
    return { text: text || (r.isError ? "The connector reported an error." : "Done."), isError: !!r.isError }
  }

  /**
   * The enabled connectors as MCP servers for a CLI agent's ACP session. Remote ones need the agent to
   * speak MCP over HTTP; their sign-in travels as a Bearer header, refreshed first.
   */
  async acpServers(http: boolean): Promise<McpServer[]> {
    const out: McpServer[] = []
    for (const s of this.chosen()) {
      const name = safe(s.name).toLowerCase()
      if (s.command) {
        out.push({ name, command: s.command, args: s.args ?? [], env: [] })
        continue
      }
      if (!http || !s.url) continue
      const live = await this.ensure(s.id).catch(() => undefined)
      if (!live) continue
      const secret = this.o.secrets.get(s.id)
      const bearer = secret?.token ?? secret?.tokens?.access_token
      out.push({ type: "http", name, url: s.url, headers: bearer ? [{ name: "Authorization", value: `Bearer ${bearer}` }] : [] })
    }
    return out
  }

  async closeAll() {
    await Promise.all([...this.live.keys()].map((id) => this.drop(id)))
  }
}

class NeedsSignIn extends Error {}
