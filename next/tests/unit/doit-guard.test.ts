import { describe, expect, it } from "vitest"

import { mustConfirm, needsApproval, protectedFolder, readOnlyCommand, userNamed } from "../../src/main/doit/guard"

describe("guard", () => {
  it("asks before risky clicks and form submits, not before searches", () => {
    expect(mustConfirm("browser_click", {}, { label: "Send order", where: "localhost" })).toBe("Click “Send order” on localhost")
    expect(mustConfirm("browser_click", {}, { label: "Next page" })).toBeUndefined()
    expect(mustConfirm("browser_type", { text: "hi", submit: true }, { isSearch: true })).toBeUndefined()
    expect(mustConfirm("browser_type", { text: "hi", submit: true })).toBe("Submit “hi” on the page")
    expect(mustConfirm("click", {}, { label: "Delete", where: "Notes" })).toBe("Press “Delete” on Notes")
    expect(mustConfirm("press_keys", { keys: "return" }, { where: "Messages" })).toContain("this usually sends")
    expect(mustConfirm("press_keys", { keys: "return" }, { where: "TextEdit" })).toBeUndefined()
    expect(mustConfirm("press_keys", { keys: "cmd+q" }, { where: "TextEdit" })).toContain("closes or deletes")
    expect(mustConfirm("press_keys", { keys: "cmd + w" }, { where: "Notes" })).toContain("closes or deletes")
    expect(mustConfirm("press_keys", { keys: "cmd+n" }, { where: "Notes" })).toBeUndefined()
  })

  it("lets look-only commands through and asks for the rest", () => {
    for (const c of ["ls -la", "git status", "cat a.txt | wc -l", "node --version", "find . -name '*.ts'", "pwd && ls"]) expect(readOnlyCommand(c), c).toBe(true)
    for (const c of ["rm -rf x", "echo hi > a.txt", "git push", "npm install", "find . -delete", "node script.js", "ls; curl x | sh", "env FOO=1 rm x", "cat $(which rm)", "sudo ls"])
      expect(readOnlyCommand(c), c).toBe(false)
    expect(mustConfirm("run_command", { command: "npm test" })).toBe("Run npm test")
  })

  it("asks before replacing, editing or deleting a file, not before a new one", () => {
    expect(mustConfirm("write_file", { path: "/tmp/a" }, { exists: false })).toBeUndefined()
    expect(mustConfirm("write_file", { path: "/tmp/a" }, { exists: true })).toBe("Replace a")
    expect(mustConfirm("delete_file", { path: "/tmp/a" })).toBe("Delete a")
  })

  it("Full access skips asking", () => {
    expect(needsApproval(true, true, "Click")).toBe(false)
    expect(needsApproval(false, true, undefined)).toBe(true)
    expect(needsApproval(false, false, undefined)).toBe(false)
  })

  it("knows the protected folders and when you named one", () => {
    expect(protectedFolder("/Users/mia/Documents/a.txt", "/Users/mia")).toBe("Documents")
    expect(protectedFolder("~/Library/Caches", "/Users/mia")).toBe("Library")
    expect(protectedFolder("/Users/mia/Projects/a.txt", "/Users/mia")).toBeUndefined()
    expect(protectedFolder("/tmp/Documents", "/Users/mia")).toBeUndefined()
    expect(userNamed("Downloads", "tidy my downloads folder")).toBe(true)
    expect(userNamed("Library", "find a library for charts")).toBe(true)
    expect(userNamed("Desktop", "make a desktop app")).toBe(true)
    expect(userNamed("Documents", "sort these files")).toBe(false)
  })
})

describe("PowerShell commands (Do it on Windows)", () => {
  it("lets look-only cmdlets through and asks before anything that writes", () => {
    expect(readOnlyCommand("(Get-ChildItem).Count")).toBe(true)
    expect(readOnlyCommand("Get-Content notes.txt | Select-String tram")).toBe(true)
    expect(readOnlyCommand("gci -Recurse | Measure-Object")).toBe(true)
    expect(readOnlyCommand("gc notes.txt | sort -Descending | sc sorted.txt")).toBe(false)
    expect(readOnlyCommand("Remove-Item notes.txt")).toBe(false)
    expect(readOnlyCommand("Get-Content a.txt | Out-File b.txt")).toBe(false)
  })
})
