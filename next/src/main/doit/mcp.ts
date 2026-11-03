import { randomBytes, timingSafeEqual } from "node:crypto"
import { writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

import type { McpServer } from "@agentclientprotocol/sdk"

import type { Json } from "@shared/types"

import type { Tool } from "./tools"

// Axe's browser and computer use for CLI agents (Claude Code, Codex…), served as an MCP server on
// 127.0.0.1 (like MCPHTTPServer.swift in the Swift app, branch archive/swift-imperium). One key per
// chat, sent as a Bearer header, so a call knows which chat asked and nothing else can call in. Origin
// headers are refused (no web page can reach it) and Host must be the loopback address. Plain JSON
// over POST, no SSE, which the streamable HTTP transport allows. Agents that only speak stdio get a
// tiny bridge script that forwards each line to the same server.

export type McpResult = { text: string; image?: { data: string; mimeType: string }; isError: boolean }
export type McpProvider = { name: string; instructions?: string; tools: () => Tool[]; call: (name: string, args: Record<string, Json | undefined>) => Promise<McpResult> }

const providers = new Map<string, McpProvider>()
let server: Server | undefined
let port = 0
let starting: Promise<number> | undefined

export function start(): Promise<number> {
  starting ??= new Promise<number>((resolve, reject) => {
    const s = createServer((req, res) => void respond(req, res))
    s.on("error", reject)
    s.listen(0, "127.0.0.1", () => {
      port = (s.address() as AddressInfo).port
      server = s
      resolve(port)
    })
  })
  return starting
}

export function stop() {
  server?.close()
  server = undefined
  starting = undefined
  port = 0
}

/** A key for one chat's provider. */
export function register(provider: McpProvider): string {
  const key = randomBytes(24).toString("base64url")
  providers.set(key, provider)
  return key
}

export function unregister(key: string) {
  providers.delete(key)
}

export const url = () => `http://127.0.0.1:${port}/mcp`

/** The ACP session/new entry: HTTP when the agent speaks it, else the stdio bridge run by this app's own Node. */
export function acpEntry(key: string, options: { http: boolean; bridgePath: string; nodePath: string }): McpServer {
  if (options.http) return { type: "http", name: "axe", url: url(), headers: [{ name: "Authorization", value: `Bearer ${key}` }] }
  return {
    name: "axe",
    command: options.nodePath,
    args: [options.bridgePath],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      { name: "AXE_MCP_URL", value: url() },
      { name: "AXE_MCP_KEY", value: key },
    ],
  }
}

/** Writes the stdio bridge where agents can run it. */
export function writeBridge(path: string) {
  writeFileSync(path, BRIDGE)
  return path
}

// ---------- HTTP ----------

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

function send(res: ServerResponse, status: number, body?: unknown) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json", "Content-Length": Buffer.byteLength(text), Connection: "close" })
  res.end(text)
}

/** Which provider may call, or the status to refuse with. */
export function authorize(headers: Record<string, string | string[] | undefined>, path: string, remote: string | undefined, serverPort: number): McpProvider | number {
  if (!remote || !LOOPBACK.has(remote)) return 403
  if (headers.origin !== undefined) return 403
  const host = String(headers.host ?? "")
  if (![`127.0.0.1:${serverPort}`, `localhost:${serverPort}`, `[::1]:${serverPort}`].includes(host)) return 403
  if (path.split("?")[0] !== "/mcp") return 404
  const auth = String(headers.authorization ?? "")
  const given = auth.startsWith("Bearer ") ? Buffer.from(auth.slice(7)) : Buffer.alloc(0)
  for (const [key, provider] of providers) {
    const want = Buffer.from(key)
    if (given.length === want.length && timingSafeEqual(given, want)) return provider
  }
  return 401
}

async function respond(req: IncomingMessage, res: ServerResponse) {
  const who = authorize(req.headers, req.url ?? "", req.socket.remoteAddress, port)
  if (typeof who === "number") return send(res, who, who === 404 ? "Not found" : "Not allowed")
  if (req.method === "DELETE") return send(res, 200, {})
  if (req.method !== "POST") return send(res, 405, "Use POST")
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 8 * 1024 * 1024) return send(res, 413, "Too big")
    chunks.push(c as Buffer)
  }
  let message: unknown
  try {
    message = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return send(res, 400, "Bad JSON")
  }
  if (Array.isArray(message)) {
    const replies = (await Promise.all(message.map((m) => handle(m, who)))).filter((r) => r !== undefined)
    return replies.length ? send(res, 200, replies) : send(res, 202)
  }
  const reply = await handle(message, who)
  return reply === undefined ? send(res, 202) : send(res, 200, reply)
}

// ---------- JSON-RPC ----------

/** One JSON-RPC message; undefined for notifications. Transport-free, so tests call it directly. */
export async function handle(message: unknown, provider: McpProvider): Promise<Json | undefined> {
  const m = message as { id?: string | number | null; method?: string; params?: Record<string, Json> }
  if (!m || typeof m.method !== "string") return undefined
  if (m.id === undefined || m.id === null) return undefined
  const ok = (result: Json) => ({ jsonrpc: "2.0", id: m.id as Json, result })
  const fail = (code: number, msg: string) => ({ jsonrpc: "2.0", id: m.id as Json, error: { code, message: msg } })
  switch (m.method) {
    case "initialize":
      return ok({
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: provider.name, version: "1.0" },
        ...(provider.instructions ? { instructions: provider.instructions } : {}),
      })
    case "ping":
      return ok({})
    case "tools/list":
      return ok({ tools: provider.tools().map((t) => ({ name: t.name, description: t.description, inputSchema: { ...t.inputSchema, type: "object" } as unknown as Json })) })
    case "tools/call": {
      const name = m.params?.name
      if (typeof name !== "string") return fail(-32602, "params.name is required")
      const args = (m.params?.arguments && typeof m.params.arguments === "object" && !Array.isArray(m.params.arguments) ? m.params.arguments : {}) as Record<string, Json | undefined>
      try {
        const r = await provider.call(name, args)
        const content: Json[] = [{ type: "text", text: r.text }]
        if (r.image) content.push({ type: "image", data: r.image.data, mimeType: r.image.mimeType })
        return ok({ content, isError: r.isError })
      } catch (e) {
        return ok({ content: [{ type: "text", text: (e as Error).message ?? String(e) }], isError: true })
      }
    }
    default:
      return fail(-32601, `Method not found: ${m.method}`)
  }
}

/** Shown in tool rows: "mcp__axe__browser_open" reads "Axe: browser open". */
export function displayTitle(tool: string): string | undefined {
  const m = /^mcp__axe__(.+)$/.exec(tool)
  return m ? `Axe: ${m[1]!.replace(/_/g, " ")}` : undefined
}

const BRIDGE = `// Axe AI's MCP bridge: stdio in, the app's local MCP server out. Written by the app; safe to delete.
const url = process.env.AXE_MCP_URL, key = process.env.AXE_MCP_KEY
let buf = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (d) => {
  buf += d
  let nl
  while ((nl = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (line) void forward(line)
  }
})
async function forward(line) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: line })
    if (res.status === 200) process.stdout.write((await res.text()) + "\\n")
  } catch (e) {
    let id = null
    try { id = JSON.parse(line).id ?? null } catch {}
    if (id !== null) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "Axe AI isn't running." } }) + "\\n")
  }
}
`
