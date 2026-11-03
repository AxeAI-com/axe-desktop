import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { EventName, Events } from "@shared/api"
import type { Part, PermissionRequest, ReplyUpdate } from "@shared/types"

import { resetTrackersForTests } from "../../src/main/agents/changes"
import { autoAnswer, modeFromNative, nativeMode, parsePlan, planRequest } from "../../src/main/agents/modes"
import { getLocal, resetStoreForTests } from "../../src/main/agents/store"
import { configureAccount } from "../../src/main/axe/account"
import { setEmitter } from "../../src/main/bus"
import * as chat from "../../src/main/chat"
import { createNotifier, type Notice, setNotifier } from "../../src/main/notify"
import { resetSettingsForTests } from "../../src/main/settings"

// The agent work view's engine: permission modes, plan first, review changes, rewind,
// several agents in their own folder copies, and notifications. Whole turns go through the
// real engine and the fake ACP agent (tests/fixtures/fake-agent.mjs), which edits files itself
// the way Claude Code does.

const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-agent-work-")))
const data = join(root, "data")
const fixture = resolve(import.meta.dirname, "../fixtures/fake-agent.mjs")
const saved = { data: process.env.AXE_DATA_DIR, base: process.env.AXE_BASE_URL, token: process.env.AXE_TOKEN }

type Seen = { [K in EventName]?: Events[K][] }
let events: Seen = {}
const notices: Notice[] = []
const waiters: { check: () => boolean; resolve: () => void }[] = []
/** How the "person" answers permission cards in each test (null: leave it waiting). */
let answer: (p: PermissionRequest) => string | null = (p) => p.options.find((o) => o.kind === "allow_once")!.id
let noModes = false

function record<K extends EventName>(event: K, payload: Events[K]) {
  ;((events[event] ??= []) as Events[K][]).push(payload)
  if (event === "permission") {
    const p = payload as Events["permission"]
    const id = answer(p)
    if (id) setTimeout(() => chat.answerPermission(p.id, id), 10)
  }
  for (const w of [...waiters]) if (w.check()) (waiters.splice(waiters.indexOf(w), 1), w.resolve())
}

function until(check: () => boolean, ms = 15_000) {
  if (check()) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms)
    waiters.push({ check, resolve: () => (clearTimeout(t), resolve()) })
  })
}

const doneFor = (threadId: string, n: number) => () => (events.reply ?? []).filter((r) => r.threadId === threadId && r.done).length >= n
const lastDone = (threadId: string): ReplyUpdate => (events.reply ?? []).filter((r) => r.threadId === threadId && r.done).at(-1)!
const replyText = (u: ReplyUpdate) => u.message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("")
const asked = (threadId: string) => (events.permission ?? []).filter((p) => p.threadId === threadId)
const lastThreads = () => events.threads?.at(-1) ?? []
const agent = { kind: "agent", agentId: "fake" } as const

function folder(name: string, files: Record<string, string> = {}) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text)
  return dir
}

async function turn(threadId: string | null, text: string, extra: Partial<Parameters<typeof chat.send>[0]> = {}) {
  const before = threadId ? (events.reply ?? []).filter((r) => r.threadId === threadId && r.done).length : 0
  const r = await chat.send({ threadId, text, answerer: agent, ...extra })
  await until(doneFor(r.threadId, before + 1))
  return { threadId: r.threadId, done: lastDone(r.threadId) }
}

beforeAll(() => {
  process.env.AXE_DATA_DIR = data
  process.env.AXE_BASE_URL = "http://localhost:3000"
  process.env.AXE_TOKEN = "test-token"
  resetSettingsForTests()
  resetStoreForTests()
  resetTrackersForTests()
  configureAccount({})
  setEmitter(record)
  setNotifier((n) => notices.push(n))
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in this test")
  })
  chat.configureChat({
    resolveAgent: async () => ({
      name: "Fake Agent",
      spec: { command: process.execPath, args: [fixture], env: { ...process.env, ...(noModes ? { FAKE_NO_MODES: "1" } : {}) } as Record<string, string> },
    }),
    defaultFolder: () => folder("default"),
  })
})

beforeEach(() => {
  answer = (p) => p.options.find((o) => o.kind === "allow_once")!.id
  noModes = false
})

afterAll(() => {
  chat.shutdown()
  vi.unstubAllGlobals()
  process.env.AXE_DATA_DIR = saved.data
  process.env.AXE_BASE_URL = saved.base
  process.env.AXE_TOKEN = saved.token
  resetSettingsForTests()
  resetStoreForTests()
})

describe("modes, without an agent", () => {
  const request = (kind: string, extra: object = {}) =>
    ({
      sessionId: "s",
      toolCall: { toolCallId: "c", title: "Do it", kind, ...extra },
      options: [
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "always", name: "Always", kind: "allow_always" },
        { optionId: "no", name: "Don't allow", kind: "reject_once" },
      ],
    }) as never

  it("answers for you by mode", () => {
    expect(autoAnswer("ask", request("edit"), true)).toBeUndefined()
    expect(autoAnswer("acceptEdits", request("edit"), true)).toBe("yes")
    expect(autoAnswer("acceptEdits", request("execute"), true)).toBeUndefined()
    expect(autoAnswer("full", request("execute"), true)).toBe("yes")
    // Plan: an agent with its own plan mode is left to it; one without is told no for anything but reading.
    expect(autoAnswer("plan", request("edit"), true)).toBeUndefined()
    expect(autoAnswer("plan", request("edit"), false)).toBe("no")
    expect(autoAnswer("plan", request("read"), false)).toBeUndefined()
    // The plan question always goes to you, whatever the mode.
    expect(autoAnswer("full", request("switch_mode", { rawInput: { plan: "1. a" } }), true)).toBeUndefined()
  })

  it("maps to the agent's own modes", () => {
    const claude = [{ id: "default", name: "Manual" }, { id: "acceptEdits", name: "Accept" }, { id: "plan", name: "Plan" }, { id: "bypassPermissions", name: "Bypass" }]
    expect(nativeMode("plan", claude)).toBe("plan")
    expect(nativeMode("ask", claude)).toBe("default")
    expect(nativeMode("full", claude)).toBe("default")
    expect(nativeMode("plan", [{ id: "read-only", name: "Read only" }, { id: "auto", name: "Auto" }])).toBeUndefined()
    expect(modeFromNative("plan", "ask", undefined)).toBe("plan")
    expect(modeFromNative("default", "plan", "full")).toBe("full")
    expect(modeFromNative("default", "acceptEdits", undefined)).toBe("acceptEdits")
    expect(modeFromNative("bypassPermissions", "ask", undefined)).toBe("full")
  })

  it("reads a Markdown plan into steps", () => {
    const plan = parsePlan("## Fix the test\n\nThe test reads too early. Here's the fix:\n\n1. **Wait** for the save\n   - in `upload.test.ts`\n2. Run it 50 times\n\n### Notes\n- just one\n")
    expect(plan.summary).toBe("The test reads too early. Here's the fix:")
    expect(plan.entries.map((e) => e.text)).toEqual(["Wait for the save", "Run it 50 times"])
    // Claude Code's plans often show the file as it will look: that is not a list of steps.
    const real = parsePlan("# Add a note\n\n## Context\nOne new bullet.\n\n## Change\n\n```\n# Trip notes\n\n- Lisbon in May\n- Book the 28 tram\n```\n")
    expect(real).toMatchObject({ summary: "One new bullet.", entries: [] })
    expect(parsePlan("Steps:\n\n```\n- not this\n- or this\n- or this\n```\n\n1. This\n2. And this\n").entries.map((e) => e.text)).toEqual(["This", "And this"])
    expect(planRequest({ sessionId: "s", toolCall: { toolCallId: "x", title: "Ready to code?", kind: "switch_mode", rawInput: { plan: " 1. a " } }, options: [] })).toBe("1. a")
  })
})

describe("permission modes", () => {
  it("Ask shows every change; Accept edits writes freely and asks before commands; Full access asks nothing", async () => {
    const dir = folder("modes")
    const a = await turn(null, "edit:a.txt=one", { cwd: dir })
    expect(asked(a.threadId).map((p) => p.title)).toEqual(["Write a.txt"])
    expect(replyText(a.done)).toContain("Mode: default")

    await chat.setMode(a.threadId, "acceptEdits")
    expect(events.mode).toContainEqual({ threadId: a.threadId, mode: "acceptEdits" })
    expect(getLocal(a.threadId)?.mode).toBe("acceptEdits")
    const b = await turn(a.threadId, "edit:b.txt=two run:pnpm-test")
    expect(asked(a.threadId).map((p) => p.title)).toEqual(["Write a.txt", "Run pnpm-test"])
    expect(replyText(b.done)).toContain("Wrote: b.txt. Ran: yes")
    // The agent stays on its asking mode, so every edit passes through the engine first.
    expect(replyText(b.done)).toContain("Mode: default")

    await chat.setMode(a.threadId, "full")
    const c = await turn(a.threadId, "edit:c.txt=three run:rm-rf-build")
    expect(asked(a.threadId)).toHaveLength(2)
    expect(replyText(c.done)).toContain("Wrote: c.txt. Ran: yes")
    expect(lastThreads().find((t) => t.id === a.threadId)?.mode).toBe("full")
    // Starting the test agent three times is slower on Windows.
  }, process.platform === "win32" ? 30_000 : undefined)

  it("starts a new chat in the mode you picked", async () => {
    const { threadId, done } = await turn(null, "edit:x.txt=x", { cwd: folder("start-mode"), mode: "full" })
    expect(asked(threadId)).toHaveLength(0)
    expect(replyText(done)).toContain("Wrote: x.txt")
  })
})

describe("plan first", () => {
  it("shows the plan as a card waiting for Start, then works through it as a to-do list", async () => {
    const dir = folder("plan")
    answer = () => null
    const r = await chat.send({ threadId: null, text: "Write a plan file", answerer: agent, cwd: dir, mode: "plan" })
    await until(() => asked(r.threadId).length === 1)
    const question = asked(r.threadId)[0]!
    expect(question.plan?.partId).toBeTruthy()
    expect(existsSync(join(dir, "plan.txt"))).toBe(false)
    // The live reply carries the plan card, proposed.
    await until(() => (events.reply ?? []).some((u) => u.threadId === r.threadId && u.message.parts.some((p) => p.type === "plan")))
    const live = (events.reply ?? []).filter((u) => u.threadId === r.threadId).at(-1)!
    const card = live.message.parts.find((p): p is Extract<Part, { type: "plan" }> => p.type === "plan")!
    expect(card).toMatchObject({ id: question.plan!.partId, stage: "proposed", summary: "I'll write the file and report back." })
    expect(card.entries.map((e) => e.text)).toEqual(["Write plan.txt with one line", "Say done"])
    expect(notices.some((n) => n.threadId === r.threadId && n.kind === "permission" && /plan ready/.test(n.body))).toBe(true)

    // Start: Accept edits, the plan question answered, the edit goes ahead without a card.
    expect(chat.startPlan(r.threadId)).toBe(true)
    await until(doneFor(r.threadId, 1))
    const done = lastDone(r.threadId)
    expect(replyText(done)).toBe("Did the plan. Wrote: yes. Mode: default.")
    expect(readFileSync(join(dir, "plan.txt"), "utf8")).toBe("planned\n")
    expect(asked(r.threadId)).toHaveLength(1)
    expect(getLocal(r.threadId)?.mode).toBe("acceptEdits")
    const plan = done.message.parts.filter((p) => p.type === "plan")
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ id: card.id, stage: "started", entries: [{ text: "Write plan.txt", status: "done" }, { text: "Say done", status: "done" }] })
  })

  it("Change keeps planning; Start with no question waiting tells the window to send", async () => {
    answer = (p) => (p.plan ? p.options.find((o) => o.kind === "reject_once")!.id : p.options[0]!.id)
    const { threadId, done } = await turn(null, "Plan something", { cwd: folder("plan-change"), mode: "plan" })
    expect(replyText(done)).toBe("Okay, tell me what to change.")
    expect(getLocal(threadId)?.mode).toBe("plan")
    expect(chat.startPlan(threadId)).toBe(false)
    expect(getLocal(threadId)?.mode).toBe("acceptEdits")
  })

  it("asks an agent without a plan mode to plan in words, and says no to changes for it", async () => {
    noModes = true
    const dir = folder("plan-words")
    answer = () => null
    const { threadId, done } = await turn(null, "edit:a.txt=no", { cwd: dir, mode: "plan" })
    expect(asked(threadId)).toHaveLength(0)
    expect(replyText(done)).toContain("Wrote: none")
    expect(existsSync(join(dir, "a.txt"))).toBe(false)
  })
})

describe("review changes", () => {
  it("lists each changed file with before and after; Undo puts it back, Keep keeps it", async () => {
    const dir = folder("review", { "notes.md": "# Notes\n" })
    const { threadId } = await turn(null, "edit:notes.md=changed;new.txt=fresh;sub/deep.txt=deep", { cwd: dir })
    let files = await chat.changesFor(threadId)
    expect(files.map((f) => [f.rel, f.before, f.after])).toEqual([
      ["new.txt", null, "fresh\n"],
      ["notes.md", "# Notes\n", "changed\n"],
      [join("sub", "deep.txt"), null, "deep\n"],
    ])
    // The window hears about them right after the turn.
    await until(() => (events.changes ?? []).some((c) => c.threadId === threadId && c.files.length === 3))

    files = await chat.undoChanges(threadId, [join(dir, "notes.md"), join(dir, "new.txt")])
    expect(readFileSync(join(dir, "notes.md"), "utf8")).toBe("# Notes\n")
    expect(existsSync(join(dir, "new.txt"))).toBe(false)
    expect(files.map((f) => f.rel)).toEqual([join("sub", "deep.txt")])

    expect(await chat.keepChanges(threadId, null)).toEqual([])
    expect(readFileSync(join(dir, "sub", "deep.txt"), "utf8")).toBe("deep\n")

    // A later change is measured from what you kept, and Undo all takes it back there.
    await turn(threadId, "edit:sub/deep.txt=deeper")
    files = await chat.changesFor(threadId)
    expect(files.map((f) => [f.before, f.after])).toEqual([["deep\n", "deeper\n"]])
    await chat.undoChanges(threadId, null)
    expect(readFileSync(join(dir, "sub", "deep.txt"), "utf8")).toBe("deep\n")
  })

  it("follows the folder through a symlink (Claude Code names /var/folders as /private/var/folders)", async () => {
    const real = folder("real-target", { "a.txt": "before\n" })
    const link = join(root, "linked")
    symlinkSync(real, link)
    const { threadId } = await turn(null, `edit:${join(real, "a.txt")}=after`, { cwd: link })
    // The agent names the file by its real path; the chat's folder is the link.
    const files = await chat.changesFor(threadId)
    expect(files.map((f) => [f.rel, f.before, f.after])).toEqual([["a.txt", "before\n", "after\n"]])
    await chat.undoChanges(threadId, null)
    expect(readFileSync(join(real, "a.txt"), "utf8")).toBe("before\n")
  })

  it("never saves or restores files outside the chat's folder", async () => {
    const dir = folder("review-inside")
    const { threadId } = await turn(null, "edit:../escape.txt=out", { cwd: dir })
    expect(await chat.changesFor(threadId)).toEqual([])
  })
})

describe("rewind", () => {
  it("restores files to before a message, drops later turns and carries on", async () => {
    const dir = folder("rewind", { "a.txt": "original\n" })
    const first = await turn(null, "edit:a.txt=v1", { cwd: dir, messageId: "msg-first-0001" })
    const threadId = first.threadId
    await turn(threadId, "edit:a.txt=v2;b.txt=new", { messageId: "msg-second-0002" })
    await turn(threadId, "edit:c.txt=c", { messageId: "msg-third-00003" })
    expect(getLocal(threadId)?.messages).toHaveLength(6)

    expect(await chat.rewindPreview(threadId, "msg-second-0002")).toEqual({ replies: 2, files: 3 })
    const back = await chat.rewind(threadId, "msg-second-0002", true)
    expect(back.text).toBe("edit:a.txt=v2;b.txt=new")
    expect(back.messages.map((m) => m.id)).toEqual(["msg-first-0001", first.done.message.id])
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("v1\n")
    expect(existsSync(join(dir, "b.txt"))).toBe(false)
    expect(existsSync(join(dir, "c.txt"))).toBe(false)
    // Review still measures from before the chat's first change.
    expect((await chat.changesFor(threadId)).map((f) => [f.before, f.after])).toEqual([["original\n", "v1\n"]])

    // The chat goes on in a fresh session that gets the earlier turn as context.
    const next = await turn(threadId, "hello again")
    expect(replyText(next.done)).toContain("Context: yes. Prompt 1.")
    expect(getLocal(threadId)?.messages).toHaveLength(4)
  })

  it("can rewind the chat only, leaving files as they are", async () => {
    const dir = folder("rewind-chat-only")
    const { threadId } = await turn(null, "edit:a.txt=one", { cwd: dir, messageId: "msg-only-00001" })
    await chat.rewind(threadId, "msg-only-00001", false)
    expect(getLocal(threadId)?.messages).toHaveLength(0)
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\n")
  })
})

describe("several agents at once", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()

  it("gives each new chat its own worktree, and runs two side by side", async () => {
    const repo = folder("repo", { "app.txt": "app\n" })
    git(repo, "init", "-q", "-b", "main")
    git(repo, "-c", "user.email=t@example.com", "-c", "user.name=T", "add", ".")
    git(repo, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "start")

    const one = await chat.send({ threadId: null, text: "edit:app.txt=one slow", answerer: agent, cwd: repo, copy: true, mode: "full" })
    const two = await chat.send({ threadId: null, text: "edit:app.txt=two slow", answerer: agent, cwd: repo, copy: true, mode: "full" })
    await until(() => (events.threads ?? []).some((list) => [one.threadId, two.threadId].every((id) => list.find((t) => t.id === id)?.running)))
    await until(doneFor(one.threadId, 1))
    await until(doneFor(two.threadId, 1))

    const a = getLocal(one.threadId)!
    const b = getLocal(two.threadId)!
    expect(a.copy).toMatchObject({ kind: "worktree", source: repo })
    expect(a.copy?.branch).toMatch(/^axe\/edit-app-txt-one-slow-/)
    expect(a.cwd).not.toBe(b.cwd)
    expect(readFileSync(join(a.cwd!, "app.txt"), "utf8")).toBe("one\n")
    expect(readFileSync(join(b.cwd!, "app.txt"), "utf8")).toBe("two\n")
    expect(readFileSync(join(repo, "app.txt"), "utf8")).toBe("app\n")
    // Git prints Windows paths with / and the long folder names; compare the same folder either way.
    const same = (p: string) => realpathSync.native(p).replace(/\\/g, "/").toLowerCase()
    expect(git(repo, "worktree", "list").replace(/\\/g, "/").toLowerCase()).toContain(same(a.cwd!))
    const summary = lastThreads().find((t) => t.id === one.threadId)!
    expect(summary).toMatchObject({ cwd: a.cwd, copy: { kind: "worktree" } })
  })

  it("finds the folder inside the worktree when it is reached through a symlink", async () => {
    const repo = folder("repo-linked", { "a.txt": "a\n" })
    mkdirSync(join(repo, "sub"))
    writeFileSync(join(repo, "sub", "b.txt"), "b\n")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "-c", "user.email=t@example.com", "-c", "user.name=T", "add", ".")
    git(repo, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "start")
    const link = join(root, "repo-link")
    symlinkSync(repo, link)
    const { threadId, done } = await turn(null, "edit:b.txt=changed", { cwd: join(link, "sub"), copy: true, mode: "full" })
    expect(done.error).toBeUndefined()
    const t = getLocal(threadId)!
    expect(t.cwd!.endsWith(join("sub"))).toBe(true)
    expect(readFileSync(join(t.cwd!, "b.txt"), "utf8")).toBe("changed\n")
    expect(readFileSync(join(repo, "sub", "b.txt"), "utf8")).toBe("b\n")
  })

  it("makes a plain copy of a folder that isn't a repo", async () => {
    const plain = folder("plain", { "a.txt": "a\n" })
    mkdirSync(join(plain, "node_modules"))
    writeFileSync(join(plain, "node_modules", "big.js"), "x")
    const { threadId } = await turn(null, "edit:a.txt=changed", { cwd: plain, copy: true, mode: "full" })
    const t = getLocal(threadId)!
    expect(t.copy).toEqual({ kind: "copy", source: plain })
    expect(readFileSync(join(t.cwd!, "a.txt"), "utf8")).toBe("changed\n")
    expect(readFileSync(join(plain, "a.txt"), "utf8")).toBe("a\n")
    expect(existsSync(join(t.cwd!, "node_modules"))).toBe(false)
  })
})

describe("notifications", () => {
  it("tells you when an agent needs your OK and when it finishes", async () => {
    const before = notices.length
    const { threadId } = await turn(null, "edit:n.txt=n", { cwd: folder("notify") })
    const mine = notices.slice(before).filter((n) => n.threadId === threadId)
    expect(mine.map((n) => n.kind)).toEqual(["permission", "done"])
    expect(mine[0]!.body).toBe("Fake Agent needs your OK: Write n.txt")
    expect(mine[1]).toMatchObject({ title: "edit:n.txt=n", body: "Fake Agent finished." })
  })

  it("shows them only while the window isn't in front, and a click opens the chat", () => {
    let focused = true
    const shown: Notice[] = []
    const opened: string[] = []
    let click = () => {}
    const notifier = createNotifier({
      focused: () => focused,
      supported: () => true,
      show: (n, onClick) => {
        shown.push(n)
        click = onClick
      },
      open: (id) => opened.push(id),
    })
    const n: Notice = { threadId: "agent_x", kind: "done", title: "Fix the test", body: "Claude Code finished." }
    notifier(n)
    expect(shown).toHaveLength(0)
    focused = false
    notifier(n)
    expect(shown).toEqual([n])
    click()
    expect(opened).toEqual(["agent_x"])
  })
})
