import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { EventName, Events } from "@shared/api"

import { resetStoreForTests } from "../../src/main/agents/store"
import { configureAccount } from "../../src/main/axe/account"
import type { AxeClient } from "../../src/main/axe/client"
import { setEmitter } from "../../src/main/bus"
import * as chat from "../../src/main/chat"
import { Approvals } from "../../src/main/remote/approvals"
import { EventReader, RemoteLink } from "../../src/main/remote/remote"
import { resetSettingsForTests } from "../../src/main/settings"

// Remote control from axeai.com: what waits for your OK in any chat (approvals.ts), answered from the
// website, and the link's four commands (remote.ts). Approvals run on the real chat engine with the
// fake ACP agent in a temp folder.

vi.mock("electron", () => ({ BrowserWindow: class {}, app: { getPath: () => tmpdir() }, shell: {}, clipboard: {}, nativeImage: {}, screen: {}, desktopCapturer: {} }))

const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-remote-")))
const data = join(root, "data")
const fixture = resolve(import.meta.dirname, "../fixtures/fake-agent.mjs")
const saved = { data: process.env.AXE_DATA_DIR, base: process.env.AXE_BASE_URL, token: process.env.AXE_TOKEN }

type Seen = { [K in EventName]?: Events[K][] }
const events: Seen = {}

function record<K extends EventName>(event: K, payload: Events[K]) {
  ;((events[event] ??= []) as Events[K][]).push(payload)
}

async function until(check: () => boolean, ms = 20_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

let approvals: Approvals
let unsubscribe: () => void

beforeAll(() => {
  mkdirSync(data, { recursive: true })
  process.env.AXE_DATA_DIR = data
  process.env.AXE_BASE_URL = "http://localhost:3000"
  process.env.AXE_TOKEN = "test-token"
  resetSettingsForTests()
  resetStoreForTests()
  configureAccount({})
  setEmitter(record)
  chat.configureChat({
    resolveAgent: async () => ({ name: "Fake Agent", spec: { command: process.execPath, args: [fixture], env: { ...process.env } as Record<string, string> } }),
    defaultFolder: () => root,
  })
  approvals = new Approvals({ title: (id) => chat.threadTitle(id), answer: (id, o) => chat.answerPermission(id, o), now: () => new Date() })
  unsubscribe = chat.onTurnEvent((e) => approvals.onTurn(e))
})

afterAll(() => {
  unsubscribe()
  chat.shutdown()
  for (const [k, v] of Object.entries({ AXE_DATA_DIR: saved.data, AXE_BASE_URL: saved.base, AXE_TOKEN: saved.token })) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetSettingsForTests()
  resetStoreForTests()
})

const waitingIn = (threadId: string) => approvals.list().find((w) => w.threadId === threadId)

describe("what waits for you", { timeout: 30_000 }, () => {
  it("lists a chat's question; a no from axeai.com reaches the agent, and a yes lets it finish", async () => {
    const dir = join(root, "no-then-yes")
    mkdirSync(dir, { recursive: true })
    const first = await chat.send({ threadId: null, text: "edit:report.txt=weekly", title: "Weekly report", answerer: { kind: "agent", agentId: "fake" }, cwd: dir })
    await until(() => !!waitingIn(first.threadId))
    expect(waitingIn(first.threadId)).toMatchObject({ title: "Weekly report" })
    approvals.decide(waitingIn(first.threadId)!.id, false)
    await until(() => !chat.isRunning(first.threadId))
    expect(existsSync(join(dir, "report.txt"))).toBe(false)
    expect(waitingIn(first.threadId)).toBeUndefined()

    const second = await chat.send({ threadId: null, text: "edit:report.txt=weekly", answerer: { kind: "agent", agentId: "fake" }, cwd: dir })
    await until(() => !!waitingIn(second.threadId))
    approvals.decide(waitingIn(second.threadId)!.id, true)
    await until(() => !chat.isRunning(second.threadId))
    expect(readFileSync(join(dir, "report.txt"), "utf8")).toBe("weekly\n")
  })

  it("drops a question once it's answered in the chat", async () => {
    const { threadId } = await chat.send({ threadId: null, text: "edit:x.txt=1", answerer: { kind: "agent", agentId: "fake" }, cwd: root })
    await until(() => !!waitingIn(threadId))
    const asked = events.permission!.filter((p) => p.threadId === threadId).at(-1)!
    chat.answerPermission(asked.id, asked.options.find((o) => o.kind === "allow_once")!.id)
    await until(() => !waitingIn(threadId))
    await until(() => !chat.isRunning(threadId))
    expect(approvals.list()).toEqual([])
  })

  it("won't answer a question that isn't waiting", () => {
    expect(() => approvals.decide("nope", true)).toThrow(/isn't waiting anymore/)
  })
})

describe("remote control", { timeout: 30_000 }, () => {
  const posted: { path: string; method?: string; body: unknown }[] = []
  const fakeClient = {
    url: (p: string) => `http://localhost:3000/${p}`,
    token: "t",
    json: async (path: string, init?: { method?: string; json?: unknown; body?: unknown }) => {
      posted.push({ path, method: init?.method, body: init?.json ?? (typeof init?.body === "string" ? JSON.parse(init.body) : undefined) })
      return { ok: true }
    },
  } as unknown as AxeClient
  let mode = "runs"
  const link = () =>
    new RemoteLink({
      client: () => fakeClient,
      enabled: () => true,
      approvals,
      doing: () => chat.runningCount(),
      deviceName: () => "Mia's Mac",
      platform: "mac",
      version: "0.1.0",
      wake: "none",
      power: { report: () => ({ keepAwake: mode as never, holding: false, awakeUntil: null, nextWakeAt: null, onBattery: false }), setMode: (m) => void (mode = m), keepAwakeUntil: () => {} },
      askToAllow: async () => false,
      load: () => ({ code: "", created: 0 }),
      save: () => {},
      emit: () => {},
    })

  it("reads named server-sent events", () => {
    const r = new EventReader()
    expect(r.push('event: ready\ndata: {"deviceId":"d"}\n\nevent: comm')).toEqual([{ event: "ready", data: '{"deviceId":"d"}' }])
    expect(r.push("and\ndata: {}\n\n")).toEqual([{ event: "command", data: "{}" }])
  })

  it("does only what it allows, and reports each result; routines are gone", async () => {
    const l = link()
    expect(await l.handle({ id: "1", command: { type: "shell", id: "rm -rf /" } as never })).toEqual({ ok: false, message: "Axe can't do that remotely." })
    expect(await l.handle({ id: "2", command: { type: "run-agent", id: "r1" } })).toEqual({ ok: false, message: "Axe can't do that remotely." })
    expect(await l.handle({ id: "3", command: { type: "decide", id: "nope", approve: true } })).toMatchObject({ ok: false, message: "That isn't waiting anymore." })
    expect(await l.handle({ id: "4", command: { type: "keep-awake", mode: "always" } })).toMatchObject({ ok: true })
    expect(mode).toBe("always")
    expect(await l.handle({ id: "5", command: { type: "approve-browser", browser: "Safari on iPhone" } })).toEqual({ ok: false, message: "Not allowed on Mia's Mac." })
    expect(posted.filter((p) => p.path === "api/remote/results").map((p) => (p.body as { id: string }).id)).toEqual(["1", "2", "3", "4", "5"])
    expect(l.newCode().code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  })

  it("shares what waits and answers it from axeai.com; it lists no agents", async () => {
    const dir = join(root, "remote-folder")
    mkdirSync(dir, { recursive: true })
    const { threadId } = await chat.send({ threadId: null, text: "edit:remote.txt=phone", title: "Phone chat", answerer: { kind: "agent", agentId: "fake" }, cwd: dir })
    await until(() => !!waitingIn(threadId))
    const l = link()
    const snap = l.snapshot()
    expect(snap.agents).toEqual([])
    expect(snap.tasks.doing).toBeGreaterThanOrEqual(1)
    expect(snap.needsYou.find((n) => n.id === waitingIn(threadId)!.id)).toMatchObject({ who: "Phone chat" })
    expect(await l.handle({ id: "6", command: { type: "decide", id: waitingIn(threadId)!.id, approve: true } })).toMatchObject({ ok: true, message: expect.stringMatching(/^Allowed .* for Phone chat$/) })
    await until(() => !chat.isRunning(threadId))
    expect(readFileSync(join(dir, "remote.txt"), "utf8")).toBe("phone\n")
  })
})
