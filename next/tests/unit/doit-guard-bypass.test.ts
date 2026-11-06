import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ BrowserWindow: class {}, ipcMain: { handle: () => {} } }))

import { mustAsk, mustConfirm, readOnlyCommand } from "../../src/main/doit/guard"
import { commandPaths, makeToolbox } from "../../src/main/doit/toolbox"
import { trustedPage } from "../../src/main/ipc"

// Ways around "it asks first" found in a security review (Nov 2026). Each test pins the fix.

const home = realpathSync(mkdtempSync(join(tmpdir(), "axe-guard-")))
const workspace = join(home, "Library", "Application Support", "Axe AI", "Workspace")
mkdirSync(workspace, { recursive: true })
mkdirSync(join(home, "Documents"), { recursive: true })
writeFileSync(join(home, "Documents", "a.txt"), "notes")
writeFileSync(join(home, "Documents", "b.txt"), "keep me")

const page = { label: "Continue", isSearch: false, submits: true }
const browser = { describe: async () => page, where: () => "shop.example" } as never
const toolbox = (userText = "tidy my notes") => makeToolbox({ workspace, userText: () => userText, browser, computer: {} as never, home })

describe("commands that write through their own options aren't read-only", () => {
  it("asks for sort -o, uniq's output file, tree -o and git --output", () => {
    for (const c of ["sort -o out.txt in.txt", "sort -ro out.txt in.txt", "sort --output=out.txt in.txt", "uniq in.txt out.txt", "tree -o out.txt", "git log --output=out.txt", "git diff --output out.txt"])
      expect(readOnlyCommand(c), c).toBe(false)
  })
  it("still lets their read-only forms through", () => {
    for (const c of ["sort in.txt", "sort -rn in.txt", "uniq -c in.txt", "tree -L 2", "git log --oneline", "git diff --stat"]) expect(readOnlyCommand(c), c).toBe(true)
  })
})

describe("protected folders count every path a step touches", () => {
  it("finds paths written in a shell command", () => {
    expect(commandPaths("cat ~/Documents/a.txt | grep x", "/Users/mia")).toEqual(["/Users/mia/Documents/a.txt"])
    expect(commandPaths('head "$HOME/Desktop/y" && ls /tmp', "/Users/mia")).toEqual(["/Users/mia/Desktop/y", "/tmp"])
    expect(commandPaths("ls -la src", "/Users/mia")).toEqual([])
  })

  it("asks before a read-only command reads a protected folder, with no cwd", async () => {
    const check = await toolbox().check("run_command", { command: `cat ${join(home, "Documents", "a.txt")}` })
    expect(check).toEqual({ reason: "Use your Documents folder", always: true })
    expect(mustAsk(check, true, false, new Set())).toBe(true)
  })

  it("asks before the browser opens a file in a protected folder, and before any local file", async () => {
    expect(await toolbox().check("browser_open", { url: `file://${join(home, "Documents", "a.txt")}` })).toEqual({ reason: "Use your Documents folder", always: true })
    const other = await toolbox().check("browser_open", { url: `file://${join(home, "notes.txt")}` })
    expect(other.reason).toMatch(/^Open .*notes\.txt in the browser$/)
  })

  it("still lets the user's named folder through", async () => {
    expect((await toolbox("summarise my Documents").check("run_command", { command: `cat ${join(home, "Documents", "a.txt")}` })).reason).toBeUndefined()
  })
})

describe("allowing a protected folder once doesn't allow a later delete there", () => {
  it("asks about the delete itself after a read was allowed", async () => {
    const tb = toolbox()
    const allowed = new Set<string>()
    const read = await tb.check("read_file", { path: join(home, "Documents", "a.txt") })
    expect(read).toEqual({ reason: "Use your Documents folder", always: true })
    allowed.add(read.reason!)
    const del = await tb.check("delete_file", { path: join(home, "Documents", "b.txt") })
    expect(del).toEqual({ reason: "Delete b.txt in your Documents folder", always: true })
    expect(mustAsk(del, false, false, allowed)).toBe(true)
    expect(mustAsk(del, true, false, allowed)).toBe(true)
    const edit = await tb.check("edit_file", { path: join(home, "Documents", "a.txt") })
    expect(mustAsk(edit, false, false, allowed)).toBe(true)
  })
})

describe("a click that submits a form asks, whatever its label", () => {
  it("asks for a submit button labelled Continue, not for search forms or plain links", async () => {
    expect((await toolbox().check("browser_click", { element: 3 })).reason).toBe("Click “Continue” on shop.example (this submits the form)")
    expect(mustConfirm("browser_click", {}, { label: "Go", submits: true, searchOnly: true })).toBeUndefined()
    expect(mustConfirm("browser_click", {}, { label: "Next page", submits: false })).toBeUndefined()
  })
  it("still asks when the page only marks the form as a search", () => {
    // A checkout can add role="search" or a hidden search box; that alone must not skip the question.
    expect(mustConfirm("browser_click", {}, { label: "Continue", submits: true, isSearch: true, where: "shop.example" })).toBe("Click “Continue” on shop.example (this submits the form)")
  })
})

describe("only the app's own page can call the engine", () => {
  const app = "file:///Applications/Axe%20AI.app/Contents/Resources/app.asar/out/renderer/index.html"
  it("accepts the app page in the top frame, with a hash", () => {
    expect(trustedPage(app, true, app, undefined)).toBe(true)
    expect(trustedPage(`${app}#quick`, true, app, undefined)).toBe(true)
  })
  it("refuses other pages, local files and frames", () => {
    expect(trustedPage("https://evil.example/", true, app, undefined)).toBe(false)
    expect(trustedPage("file:///Users/mia/Downloads/page.html", true, app, undefined)).toBe(false)
    expect(trustedPage(app, false, app, undefined)).toBe(false)
    expect(trustedPage(undefined, true, app, undefined)).toBe(false)
  })
  it("accepts the dev server only while developing", () => {
    expect(trustedPage("http://localhost:5173/#tray", true, app, "http://localhost:5173")).toBe(true)
    expect(trustedPage("http://localhost:5174/", true, app, "http://localhost:5173")).toBe(false)
  })
})
