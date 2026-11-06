import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ BrowserWindow: class {}, ipcMain: { handle: () => {} } }))

import { mustAsk, mustConfirm, protectedFolder, readOnlyCommand } from "../../src/main/doit/guard"
import { commandPaths, makeToolbox, shellWords } from "../../src/main/doit/toolbox"
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

describe("read-only commands that can run another program", () => {
  it("asks for sort's compress program and rg's preprocessor, however they're written", () => {
    for (const c of [
      "sort --compress-program=sh in.txt",
      "sort --compress-program sh in.txt",
      "sort --compress=sh in.txt",
      "sort -T /tmp in.txt",
      "rg --pre=./run.sh foo",
      "rg --pre ./run.sh foo",
      "rg --pre-glob '*.txt' --pre sh foo",
      "rg -z foo",
      "rg --search-zip foo",
      "rg --hostname-bin=sh foo",
      "rg -n --pr=sh foo",
      "rg '--pre=sh' foo",
      'rg "--pre"=sh foo',
      "rg --p\\re=sh foo",
      "find . '-delete'",
    ])
      expect(readOnlyCommand(c), c).toBe(false)
  })
  it("still lets ordinary searches and sorts through", () => {
    for (const c of [
      "sort -k2,2 -t, in.txt",
      "sort -k 2 -t , -n in.txt",
      "sort --key=2 --numeric-sort -u in.txt",
      "rg -n foo src",
      "rg -i --glob '*.ts' -C 2 foo",
      "rg --type ts -e --pre src",
      "rg -l foo -- --pre",
      "rg --files --hidden",
    ])
      expect(readOnlyCommand(c), c).toBe(true)
  })
})

describe("protected folders without the exact case, or through a link", () => {
  const link = join(home, "notes-link")
  symlinkSync(join(home, "Documents"), link)
  symlinkSync(join(home, "Documents"), join(workspace, "docs-link"))

  it("matches any case where the disk ignores case", () => {
    expect(protectedFolder("~/documents/x", "/Users/mia", true)).toBe("Documents")
    expect(protectedFolder("/Users/mia/DESKTOP", "/Users/mia", true)).toBe("Desktop")
    expect(protectedFolder("/users/MIA/library/Caches", "/Users/mia", true)).toBe("Library")
    expect(protectedFolder("~/documents/x", "/Users/mia", false)).toBeUndefined()
  })
  it("ignores case by default on the Mac and Windows", () => {
    if (process.platform === "darwin" || process.platform === "win32") expect(protectedFolder("~/documents/x", "/Users/mia")).toBe("Documents")
  })
  it("follows a symlink into a protected folder, for files there and not there yet", () => {
    expect(protectedFolder(join(link, "a.txt"), home)).toBe("Documents")
    expect(protectedFolder(join(link, "new", "c.txt"), home)).toBe("Documents")
    expect(protectedFolder(link, home)).toBe("Documents")
  })
  it("asks for a read through a link, even one inside the workspace", async () => {
    expect(await toolbox().check("read_file", { path: join(link, "a.txt") })).toEqual({ reason: "Use your Documents folder", always: true })
    expect(await toolbox().check("read_file", { path: join(workspace, "docs-link", "a.txt") })).toEqual({ reason: "Use your Documents folder", always: true })
    expect(await toolbox().check("run_command", { command: "cat docs-link/a.txt" })).toEqual({ reason: "Use your Documents folder", always: true })
  })
})

describe("protected folders written in ways the old check missed", () => {
  const asks = { reason: "Use your Documents folder", always: true }
  it("splits shell words the way the shell does", () => {
    expect(shellWords(`cat "$HOME"/Documents/a.txt | wc -l`, false)).toEqual([["cat", "$HOME/Documents/a.txt"], ["wc", "-l"]])
    expect(shellWords(`cat ~/"Doc"'uments'/a\\ b.txt`, false)).toEqual([["cat", "~/Documents/a b.txt"]])
  })
  it("asks for quotes in the middle, .., cd, globs and variables", async () => {
    for (const command of [
      `cat "$HOME"/Documents/a.txt`,
      `cat ~/"Documents"/a.txt`,
      `cat ~/Doc"uments"/a.txt`,
      `cat \\~/Documents/a.txt`,
      "cat ../../Documents/a.txt",
      "cat ../../../../Documents/a.txt",
      "cd ~ && cat Documents/a.txt",
      "cd && cat Documents/a.txt",
      "cd .. ; cd .. ; cat ../../Documents/a.txt",
      "cat $HOME/D*/a.txt",
      "cat ~/Doc?ments/a.txt",
      "cat ~/[Dd]ocuments/a.txt",
      "cat ~/{Documents,x}/a.txt",
      "cat ~/$X/a.txt",
      `cat ${home}/*/a.txt`,
      `cat ${join(home, "..")}/*/Documents/a.txt`,
      "X=~/Documents; cat $X/a.txt",
      "cat $PWD/../Documents/a.txt",
    ]) {
      const check = await toolbox().check("run_command", { command })
      expect(check.always, command).toBe(true)
      expect(check.reason, command).toMatch(/your (Documents|Library|Desktop) folder$/)
    }
    expect(await toolbox().check("run_command", { command: "cat $HOME/Do*/a.txt" })).toEqual(asks)
    // ~/documents is ~/Documents only where the disk ignores case; on Linux it's another folder.
    const lower = await toolbox().check("run_command", { command: "rg --files ~/documents" })
    if (process.platform === "darwin" || process.platform === "win32") expect(lower).toEqual(asks)
    else expect(lower.always).toBeUndefined()
  })
  it("asks for a relative path when the command runs outside the workspace", async () => {
    expect(await toolbox().check("run_command", { command: "cat Documents/a.txt", cwd: join(home, "Projects") })).toEqual(asks)
    expect(await toolbox().check("run_command", { command: "cat a.txt", cwd: home })).toEqual({ reason: undefined })
  })
  it("still runs plain commands in the workspace without asking", async () => {
    for (const command of ["ls -la", "ls *", "cat notes/library.md", "grep -rn todo .", "cat Documents.md"]) expect((await toolbox().check("run_command", { command })).always, command).toBeUndefined()
  })
  it("still lets the user's named folder through", async () => {
    expect((await toolbox("summarise my documents").check("run_command", { command: "cd ~ && cat Documents/a.txt" })).always).toBeUndefined()
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

  it("still asks when the file: address starts with spaces or a newline (the browser trims them)", async () => {
    for (const lead of [" ", "\n", "\t "]) {
      const check = await toolbox().check("browser_open", { url: `${lead}file://${join(home, "notes.txt")}` })
      expect(check.reason, JSON.stringify(lead)).toMatch(/^Open .*notes\.txt in the browser$/)
    }
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
