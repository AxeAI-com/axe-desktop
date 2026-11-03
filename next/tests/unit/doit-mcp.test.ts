import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { isAxeTool } from "../../src/main/chat"
import * as mcp from "../../src/main/doit/mcp"
import { BROWSER_TOOLS } from "../../src/main/doit/tools"

// Axe's MCP server for CLI agents: loopback only, one Bearer key per chat, no Origin, the right Host.

let port = 0
let key = ""
const calls: { name: string; args: unknown }[] = []

beforeAll(async () => {
  port = await mcp.start()
  key = mcp.register({
    name: "Axe AI",
    instructions: "Use the browser.",
    tools: () => BROWSER_TOOLS,
    call: async (name, args) => {
      calls.push({ name, args })
      if (name === "screenshot") return { text: "Here.", image: { data: "AAAA", mimeType: "image/png" }, isError: false }
      return name === "browser_read" ? { text: "Page: Order form", isError: false } : { text: "No.", isError: true }
    },
  })
})
afterAll(() => mcp.stop())

// biome-ignore lint/suspicious/noExplicitAny: the tests read arbitrary JSON-RPC replies
function post(body: unknown, headers: Record<string, string> = {}, path = "/mcp"): Promise<{ status: number; json?: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = request(
      { host: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...headers } },
      (res) => {
        let text = ""
        res.on("data", (d) => (text += d))
        res.on("end", () => resolve({ status: res.statusCode!, json: text && res.headers["content-type"] === "application/json" ? JSON.parse(text) : undefined }))
      },
    )
    req.on("error", reject)
    req.end(data)
  })
}

describe("Axe's MCP server", () => {
  it("answers initialize, lists tools with object schemas and calls them", async () => {
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })
    expect(init.json.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "Axe AI" }, instructions: "Use the browser." })
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202)
    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    expect(list.json.result.tools.map((t: { name: string }) => t.name)).toEqual(["browser_open", "browser_read", "browser_click", "browser_type"])
    expect(list.json.result.tools[1].inputSchema.type).toBe("object")
    const call = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_read", arguments: {} } })
    expect(call.json.result).toEqual({ content: [{ type: "text", text: "Page: Order form" }], isError: false })
    const shot = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "screenshot", arguments: { target: "browser" } } })
    expect(shot.json.result.content[1]).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" })
    const batch = await post([
      { jsonrpc: "2.0", id: 5, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/cancelled" },
    ])
    expect(batch.json).toEqual([{ jsonrpc: "2.0", id: 5, result: {} }])
    expect((await post({ jsonrpc: "2.0", id: 6, method: "nope" })).json.error.code).toBe(-32601)
  })

  it("refuses a wrong key, a web page, a strange Host and other paths", async () => {
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Authorization: "Bearer guess" })).status).toBe(401)
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Authorization: "" })).status).toBe(401)
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "https://evil.example" })).status).toBe(403)
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Host: "evil.example" })).status).toBe(403)
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, {}, "/other")).status).toBe(404)
    const gone = mcp.register({ name: "x", tools: () => [], call: async () => ({ text: "", isError: false }) })
    mcp.unregister(gone)
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Authorization: `Bearer ${gone}` })).status).toBe(401)
  })

  it("gives HTTP agents a header entry and stdio agents a bridge that reaches the same server", async () => {
    const http = mcp.acpEntry(key, { http: true, bridgePath: "/x", nodePath: "/node" })
    expect(http).toEqual({ type: "http", name: "axe", url: `http://127.0.0.1:${port}/mcp`, headers: [{ name: "Authorization", value: `Bearer ${key}` }] })

    const bridge = mcp.writeBridge(join(mkdtempSync(join(tmpdir(), "axe-mcp-")), "bridge.cjs"))
    const entry = mcp.acpEntry(key, { http: false, bridgePath: bridge, nodePath: process.execPath })
    if ("type" in entry) throw new Error("expected stdio")
    const env = Object.fromEntries(entry.env.map((e) => [e.name, e.value]))
    const child = spawn(entry.command, entry.args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] })
    const lines: string[] = []
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (d: string) => lines.push(...d.split("\n").filter(Boolean)))
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "browser_read" } })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
    for (let i = 0; i < 100 && !lines.length; i++) await new Promise((r) => setTimeout(r, 20))
    child.kill()
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text: "Page: Order form" }], isError: false } }])
  })

  it("knows Axe's tools in an agent's permission question", () => {
    expect(isAxeTool("mcp__axe__browser_click", {})).toBe(true)
    expect(isAxeTool("Run tests", { server_name: "axe" })).toBe(true)
    expect(isAxeTool("mcp__other__thing", {})).toBe(false)
  })
})
