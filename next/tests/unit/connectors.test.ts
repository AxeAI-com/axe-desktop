import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { ConnectorsView } from "@shared/types"

// @ts-expect-error: a plain .mjs fixture
import { startFakeMcp } from "../fixtures/fake-mcp.mjs"
import { ConnectorHub } from "../../src/main/libraries/connectors"
import type { ConnectorSecret, SecretBox } from "../../src/main/libraries/oauth"

// Connectors end to end against a fake brand MCP server on 127.0.0.1 (tests/fixtures/fake-mcp.mjs):
// the OAuth sign-in (discovery, registration, PKCE, tokens, refresh), listing and calling tools, the
// ACP entry a CLI agent gets, a token connector, and "sign in again" once tokens are revoked.

type Fake = { url: string; tasks: { title: string }[]; calls: { tool: string; title?: string }[]; revoke(): void; close(): Promise<void> }

const dir = realpathSync(mkdtempSync(join(tmpdir(), "axe-connectors-")))
const memoryBox = (): SecretBox & { all: Map<string, ConnectorSecret> } => {
  const all = new Map<string, ConnectorSecret>()
  return { all, get: (id) => all.get(id), set: (id, s) => (s ? all.set(id, s) : all.delete(id)) }
}

let fake: Fake
let open: Fake
const opened: string[] = []
/** "The browser": follows the sign-in page's redirect back to the app's callback. */
const browser = async (url: string) => {
  opened.push(url)
  const r = await fetch(url, { redirect: "manual" })
  const back = r.headers.get("location")
  if (back) await fetch(back)
}

beforeAll(async () => {
  fake = await startFakeMcp()
  open = await startFakeMcp({ auth: false })
  process.env.AXE_TEST_CONNECTOR = `Taskboard|${fake.url}`
})
afterAll(async () => {
  delete process.env.AXE_TEST_CONNECTOR
  await fake.close()
  await open.close()
})

describe("connector hub", () => {
  const box = memoryBox()
  const views: ConnectorsView[] = []
  const hub = new ConnectorHub({ file: () => join(dir, "connectors.json"), secrets: box, openUrl: browser, onChange: (v) => views.push(v) })

  it("signs in with OAuth and lists the tools", async () => {
    const view = await hub.connect("test")
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatch(/\/authorize\?.*code_challenge=/)
    const c = view.connected.find((x) => x.catalogId === "test")!
    expect(c).toMatchObject({ name: "Taskboard", state: "connected", enabled: true, tools: ["list_tasks", "add_task"] })
    expect(views.some((v) => v.connected.some((x) => x.state === "signin"))).toBe(true)
    const secret = box.get(c.id)!
    expect(secret.tokens?.access_token).toBeTruthy()
    expect(secret.client?.client_id).toMatch(/^client-/)
  })

  it("calls a tool: a round trip through MCP", async () => {
    const tools = await hub.tools()
    expect(tools.map((t) => t.name)).toEqual(["Taskboard__list_tasks", "Taskboard__add_task"])
    const add = tools.find((t) => t.tool === "add_task")!
    expect(add.inputSchema.required).toEqual(["title"])
    const r = await hub.call(add, { title: "Water the plants" })
    expect(r).toEqual({ text: "Added #4 Water the plants", isError: false })
    const list = await hub.call(tools[0]!, {})
    expect(list.text).toContain("#4 [open] Water the plants")
    expect(fake.calls.map((c) => c.tool)).toEqual(["add_task", "list_tasks"])
  })

  it("comes back after a restart with the saved sign-in, and hands agents an http server", async () => {
    const again = new ConnectorHub({ file: () => join(dir, "connectors.json"), secrets: box, openUrl: browser })
    expect(again.view().connected).toHaveLength(1)
    const tools = await again.tools()
    expect(tools).toHaveLength(2)
    const servers = await again.acpServers(true)
    expect(servers).toHaveLength(1)
    const s = servers[0] as { type: string; name: string; url: string; headers: { name: string; value: string }[] }
    expect(s).toMatchObject({ type: "http", name: "taskboard", url: fake.url })
    expect(s.headers[0]!.value).toMatch(/^Bearer [0-9a-f]{32}$/)
    expect(await again.acpServers(false)).toEqual([])
    await again.closeAll()
  })

  it("asks you to sign in again when the brand drops the tokens", async () => {
    fake.revoke()
    const fresh = new ConnectorHub({ file: () => join(dir, "connectors.json"), secrets: box, openUrl: browser })
    expect(await fresh.tools()).toEqual([])
    expect(fresh.view().connected[0]).toMatchObject({ state: "signin" })
    await fresh.closeAll()
  })

  it("switches off and on, and removes everything it stored", async () => {
    const id = hub.view().connected[0]!.id
    await hub.setEnabled(id, false)
    expect(await hub.tools()).toEqual([])
    expect(await hub.acpServers(true)).toEqual([])
    await hub.remove(id)
    expect(hub.view().connected).toEqual([])
    expect(box.get(id)).toBeUndefined()
  })

  it("connects a server that needs no sign-in, and refuses plain http elsewhere", async () => {
    const view = await hub.addCustom({ name: "Open board", url: open.url })
    expect(view.connected[0]).toMatchObject({ name: "Open board", state: "connected", tools: ["list_tasks", "add_task"] })
    await expect(hub.addCustom({ name: "Plain", url: "http://example.com/mcp" })).rejects.toThrow(/https/)
    await expect(hub.addCustom({ name: "open board", url: open.url })).rejects.toThrow(/already/)
  })

  it("sends a pasted token as a Bearer header and says when it's wrong", async () => {
    const box2 = memoryBox()
    const h = new ConnectorHub({ file: () => join(dir, "tokens.json"), secrets: box2, openUrl: browser })
    await expect(h.addCustom({ name: "Locked", url: fake.url, token: "not-a-real-token" })).rejects.toThrow(/token didn't work/)
    expect(h.view().connected).toEqual([])
  })

  it("won't connect directory entries that aren't open yet", async () => {
    await expect(hub.connect("slack")).rejects.toThrow(/doesn't let new apps connect yet/)
    await expect(hub.connect("github")).rejects.toThrow(/Paste a GitHub token/)
  })

  afterAll(() => hub.closeAll())
})
