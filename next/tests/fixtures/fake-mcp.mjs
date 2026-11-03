// A fake brand MCP server on 127.0.0.1 for tests: a small task list ("Taskboard") behind the same
// OAuth flow real brands use (protected-resource and authorization-server metadata, dynamic client
// registration, PKCE, refresh). /authorize approves at once and sends the browser back, so a test can
// "sign in" by fetching the sign-in URL. Nothing here talks to the internet.
//
//   node tests/fixtures/fake-mcp.mjs [--port 0] [--no-auth]   prints the MCP address

import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"

export async function startFakeMcp({ port = 0, auth = true } = {}) {
  const tasks = [
    { id: 1, title: "Send the Q3 deck to Jack", done: false },
    { id: 2, title: "Book the Lisbon trip", done: false },
    { id: 3, title: "Review Sam's launch post", done: true },
  ]
  const calls = []
  const clients = new Map()
  const codes = new Map()
  const access = new Set()
  const refresh = new Set()
  let base = ""

  const mcp = () => {
    const server = new McpServer({ name: "taskboard", version: "1.0.0" })
    server.registerTool("list_tasks", { description: "List the tasks on the board, with whether each is done.", inputSchema: {} }, async () => {
      calls.push({ tool: "list_tasks" })
      return { content: [{ type: "text", text: tasks.map((t) => `#${t.id} ${t.done ? "[done]" : "[open]"} ${t.title}`).join("\n") }] }
    })
    server.registerTool("add_task", { description: "Add a task to the board.", inputSchema: { title: z.string().describe("What needs doing") } }, async ({ title }) => {
      calls.push({ tool: "add_task", title })
      const t = { id: tasks.length + 1, title, done: false }
      tasks.push(t)
      return { content: [{ type: "text", text: `Added #${t.id} ${title}` }] }
    })
    return server
  }

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers })
    res.end(JSON.stringify(body))
  }
  const body = (req) =>
    new Promise((resolve) => {
      let s = ""
      req.on("data", (d) => (s += d))
      req.on("end", () => resolve(s))
    })
  const token = () => randomBytes(16).toString("hex")

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, base)
    const path = u.pathname
    if (path.startsWith("/.well-known/oauth-protected-resource")) return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] })
    if (path.startsWith("/.well-known/oauth-authorization-server"))
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      })
    if (path === "/register" && req.method === "POST") {
      const meta = JSON.parse(await body(req))
      const client = { ...meta, client_id: `client-${token()}`, client_id_issued_at: Math.floor(Date.now() / 1000) }
      clients.set(client.client_id, client)
      return json(res, 201, client)
    }
    if (path === "/authorize") {
      const client = clients.get(u.searchParams.get("client_id"))
      const redirect = u.searchParams.get("redirect_uri")
      if (!client || !client.redirect_uris.includes(redirect)) return json(res, 400, { error: "invalid_request" })
      const code = token()
      codes.set(code, { challenge: u.searchParams.get("code_challenge"), client: client.client_id })
      const back = new URL(redirect)
      back.searchParams.set("code", code)
      back.searchParams.set("state", u.searchParams.get("state") ?? "")
      res.writeHead(302, { location: back.toString() })
      return res.end()
    }
    if (path === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await body(req))
      if (form.get("grant_type") === "authorization_code") {
        const c = codes.get(form.get("code"))
        codes.delete(form.get("code"))
        const verifier = form.get("code_verifier") ?? ""
        const ok = c && createHash("sha256").update(verifier).digest("base64url") === c.challenge
        if (!ok) return json(res, 400, { error: "invalid_grant" })
      } else if (form.get("grant_type") === "refresh_token") {
        if (!refresh.delete(form.get("refresh_token"))) return json(res, 400, { error: "invalid_grant" })
      } else return json(res, 400, { error: "unsupported_grant_type" })
      const a = token()
      const r = token()
      access.add(a)
      refresh.add(r)
      return json(res, 200, { access_token: a, token_type: "Bearer", expires_in: 3600, refresh_token: r })
    }
    if (path === "/mcp") {
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")
      if (auth && !access.has(bearer))
        return json(res, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` })
      if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" })
      const s = mcp()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on("close", () => {
        void transport.close()
        void s.close()
      })
      await s.connect(transport)
      return transport.handleRequest(req, res, JSON.parse(await body(req)))
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
  return {
    url: `${base}/mcp`,
    tasks,
    calls,
    /** Ends every token it gave out (a test for "sign in again"). */
    revoke: () => (access.clear(), refresh.clear()),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--port")
  const f = await startFakeMcp({ port: i > 0 ? Number(process.argv[i + 1]) : 0, auth: !process.argv.includes("--no-auth") })
  console.log(f.url)
}
