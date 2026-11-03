import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Commands run in PowerShell on Windows and sh elsewhere (doit/terminal.ts); the tests write for each.
const win = process.platform === "win32"

import type { ChatMessage, Json, Part } from "@shared/types"

import { AxeError } from "../../src/main/axe/client"
import { fakeBrain, SORT_COMMAND } from "../../src/main/doit/fake-brain"
import { type Brain, DoItRun, type Hooks, Stopped } from "../../src/main/doit/loop"
import { type Computer, makeToolbox, type PageBrowser } from "../../src/main/doit/toolbox"

// The Do it loop with the fake brain, a fake page and a real throwaway folder. Checks what the chat
// shows (steps, plan, approvals) and what the model reads back.

const root = () => realpathSync(mkdtempSync(join(tmpdir(), "axe-doit-")))

/** The order form as a tiny model: four controls, Send sets `sent`. */
function fakePage() {
  const page = { url: "", fields: { 1: "", 2: "", 3: "" } as Record<number, string>, sent: false, opened: 0 }
  const labels: Record<number, string> = { 1: "Your name", 2: "Email", 3: "Note", 4: "Send order" }
  const browser: PageBrowser = {
    where: () => "localhost",
    async open(url) {
      page.url = url
      page.opened++
    },
    async read() {
      return [`Page: ${page.sent ? "Sent" : "Order form"}`, ...[1, 2, 3, 4].map((i) => `[${i}] ${i === 4 ? "button" : "text field"} “${labels[i]}”${page.fields[i] ? ` = ${page.fields[i]}` : ""}`)].join("\n")
    },
    async click(el) {
      if (el === 4) page.sent = true
    },
    async type(el, text) {
      page.fields[el] = text
    },
    async describe(el) {
      return { label: labels[el] ?? "", isSearch: false }
    },
    capture: async () => Buffer.from("png"),
  }
  return { page, browser }
}

const noComputer: Computer = {
  listApps: async () => "Notes\nCalculator",
  openApp: async (n) => `Opened ${n}.`,
  screenshot: async () => Buffer.from("png"),
  readScreen: async () => "App: Notes",
  click: async () => {},
  typeText: async () => {},
  pressKeys: async () => {},
  label: async () => ({ label: "", app: "Notes" }),
  lastApp: async () => "Notes",
}

function setup(options: { answers?: boolean[]; fullAccess?: boolean; brain?: Brain; userText?: string; workspace?: string; home?: string } = {}) {
  const workspace = options.workspace ?? root()
  const { page, browser } = fakePage()
  const reply: ChatMessage = { id: "r", role: "assistant", parts: [] }
  const asked: { title: string; detail?: string }[] = []
  const answers = [...(options.answers ?? [])]
  let changes = 0
  const hooks: Hooks = {
    changed: () => void changes++,
    ask: async (q) => {
      asked.push(q)
      return answers.shift() ?? false
    },
    fullAccess: () => !!options.fullAccess,
  }
  const toolbox = makeToolbox({ workspace, userText: () => options.userText ?? "", browser, computer: noComputer, home: options.home ?? workspace })
  const abort = new AbortController()
  const run = new DoItRun(reply, options.brain ?? fakeBrain("http://localhost/form.html"), toolbox, hooks, "system", abort.signal, { waits: [0, 0] })
  return { run, reply, page, asked, workspace, abort, changes: () => changes }
}

const tools = (parts: Part[]) => parts.filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool")

describe("Do it: the form", () => {
  it("fills the form, asks before Send, and sends once allowed", async () => {
    const t = setup({ answers: [true] })
    await t.run.run("Fill the order form and stop at Send")
    expect(t.asked).toEqual([{ title: "Click “Send order” on localhost", detail: "Sends the order form to the shop." }])
    expect(t.page.sent).toBe(true)
    expect(t.page.fields[1]).toBe("Mia Lane")
    expect(tools(t.reply.parts).map((p) => [p.title, p.kind, p.state])).toEqual([
      ["Open localhost/form.html", "fetch", "done"],
      ["Fill in “Mia Lane”", "other", "done"],
      ["Fill in “mia@example.com”", "other", "done"],
      ["Click “Send order”", "other", "done"],
    ])
    const plan = t.reply.parts.find((p) => p.type === "plan")
    expect(plan?.type === "plan" && plan.entries.every((e) => e.status === "done")).toBe(true)
    expect(t.reply.parts.at(-1)).toMatchObject({ type: "text", text: "Done: filled in the form and pressed Send order." })
    expect(t.changes()).toBeGreaterThan(5)
  })

  it("never presses Send when you say no, and tells the model", async () => {
    const t = setup({ answers: [false] })
    await t.run.run("Fill the order form and stop at Send")
    expect(t.asked).toHaveLength(1)
    expect(t.page.sent).toBe(false)
    expect(t.page.fields[2]).toBe("mia@example.com")
    const click = tools(t.reply.parts).at(-1)!
    expect(click).toMatchObject({ title: "Click “Send order”", state: "declined", output: "You said no." })
    expect(JSON.stringify(t.run.history.at(-2))).toContain("said no")
    expect(t.reply.parts.at(-1)).toMatchObject({ type: "text" })
  })

  it("goes straight on with Full access", async () => {
    const t = setup({ fullAccess: true })
    await t.run.run("Fill the order form")
    expect(t.asked).toHaveLength(0)
    expect(t.page.sent).toBe(true)
  })

  it("asks for a risky label even when the model doesn't flag it", async () => {
    let n = 0
    const brain: Brain = async function* () {
      if (n++ === 0) yield { type: "tool-input-available", toolCallId: "a", toolName: "browser_click", input: { element: 4 } }
    }
    const t = setup({ brain, answers: [false] })
    await t.run.run("press it")
    expect(t.asked[0]?.title).toBe("Click “Send order” on localhost")
    expect(t.page.sent).toBe(false)
  })
})

describe("Do it: terminal and files", () => {
  it("writes, runs, edits and reads in the workspace, asking before the command and the edit", async () => {
    const t = setup({ answers: [true, true] })
    await t.run.run("Make a notes file and sort it")
    expect(t.asked.map((a) => a.title)).toEqual([`Run ${SORT_COMMAND}`, "Change notes.txt"])
    expect(readFileSync(join(t.workspace, "sorted.txt"), "utf8").replace(/\r\n/g, "\n")).toBe("plums\npears\napples\n")
    expect(readFileSync(join(t.workspace, "notes.txt"), "utf8")).toBe("apples\nfigs\nplums\n")
    const steps = tools(t.reply.parts)
    expect(steps.map((p) => [p.kind, p.state])).toEqual([
      ["edit", "done"],
      ["execute", "done"],
      ["edit", "done"],
      ["read", "done"],
    ])
    expect(steps[0]?.diff?.[0]).toMatchObject({ after: "apples\npears\nplums\n" })
    expect(steps[0]?.diff?.[0]?.before).toBeUndefined()
    expect(steps[1]?.output).toBe("plums\npears\napples")
    expect(steps[2]?.diff?.[0]).toMatchObject({ before: "apples\npears\nplums\n", after: "apples\nfigs\nplums\n" })
  })

  it("streams a command's output into its step as it comes", async () => {
    let n = 0
    const brain: Brain = async function* () {
      if (n++ === 0) yield { type: "tool-input-available", toolCallId: "a", toolName: "run_command", input: { command: win ? "echo one; Start-Sleep -Milliseconds 300; echo two" : "echo one; sleep 0.3; echo two" } }
    }
    const t = setup({ brain, answers: [true] })
    const seen: string[] = []
    const timer = setInterval(() => {
      const out = tools(t.reply.parts)[0]?.output
      if (out && !seen.includes(out)) seen.push(out)
    }, 20)
    await t.run.run("go")
    clearInterval(timer)
    expect(seen[0]).toBe("one\n")
    expect(tools(t.reply.parts)[0]?.output).toBe("one\ntwo")
    // Windows PowerShell takes a few seconds to start on a cold machine.
  }, win ? 30_000 : undefined)

  it("runs a look-only command without asking", async () => {
    let n = 0
    const brain: Brain = async function* () {
      if (n++ === 0) yield { type: "tool-input-available", toolCallId: "a", toolName: "run_command", input: { command: win ? "(Get-ChildItem).Count" : "ls -la | wc -l" } }
    }
    const t = setup({ brain })
    await t.run.run("go")
    expect(t.asked).toHaveLength(0)
    expect(tools(t.reply.parts)[0]?.state).toBe("done")
  })

  it("asks before a protected folder, even with Full access, unless you named it", async () => {
    const home = root()
    mkdirSync(join(home, "Documents"))
    writeFileSync(join(home, "Documents", "plan.txt"), "secret plan")
    let n = 0
    const brain: Brain = async function* () {
      if (n++ === 0) yield { type: "tool-input-available", toolCallId: "a", toolName: "read_file", input: { path: join(home, "Documents", "plan.txt") } }
    }
    const t = setup({ brain, fullAccess: true, home })
    await t.run.run("go")
    expect(t.asked[0]?.title).toBe("Use your Documents folder")
    expect(tools(t.reply.parts)[0]?.state).toBe("declined")

    n = 0
    const named = setup({ brain, fullAccess: true, home, userText: "read plan.txt in my Documents" })
    await named.run.run("read plan.txt in my Documents")
    expect(named.asked).toHaveLength(0)
    expect(JSON.stringify(named.run.history)).toContain("secret plan")
  })

  it("sends failures back to the model instead of ending the run", async () => {
    let n = 0
    const brain: Brain = async function* () {
      const chunk: Json =
        n++ === 0 ? { type: "tool-input-available", toolCallId: "a", toolName: "read_file", input: { path: "missing.txt" } } : { type: "text-delta", delta: "That file isn't there." }
      yield chunk
    }
    const t = setup({ brain })
    await t.run.run("go")
    expect(tools(t.reply.parts)[0]).toMatchObject({ state: "failed" })
    expect(JSON.stringify(t.run.history)).toContain("Failed: There's no file at")
  })
})

describe("Do it: the model", () => {
  it("waits and tries again while a free model is busy, dropping the half-written words", async () => {
    let n = 0
    const brain: Brain = async function* () {
      n++
      if (n === 1) {
        yield { type: "text-delta", delta: "Half" }
        throw new AxeError(503, "busy", "busy")
      }
      yield { type: "text-delta", delta: "Hello." }
    }
    const t = setup({ brain })
    await t.run.run("hi")
    expect(n).toBe(2)
    expect(t.reply.parts).toEqual([expect.objectContaining({ type: "text", text: "Hello." })])
  })

  it("stops when the reply is stopped", async () => {
    const t = setup({
      brain: async function* ({ signal }) {
        yield { type: "text-delta", delta: "Working" }
        await new Promise((r) => signal.addEventListener("abort", r))
        throw new Error("aborted")
      },
    })
    setTimeout(() => t.abort.abort(), 20)
    await expect(t.run.run("go")).rejects.toBeInstanceOf(Stopped)
  })

  it("turns thinking into a reasoning step, timed when it takes a second or more", async () => {
    const brain: Brain = async function* () {
      yield { type: "reasoning-delta", delta: "Let me see." } as Json
      yield { type: "text-delta", delta: "Done." }
    }
    const t = setup({ brain })
    await t.run.run("go")
    expect(t.reply.parts[0]).toMatchObject({ type: "reasoning", text: "Let me see.", done: true })
    expect(t.reply.parts[0]).not.toHaveProperty("seconds")
  })
})
