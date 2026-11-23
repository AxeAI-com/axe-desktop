import { describe, expect, it } from "vitest"

import { commandLabel, isShellCommand } from "../../src/renderer/src/lib/steps"

// Raw shell commands never show as a step's name: they read as a few plain words.
describe("shell steps", () => {
  const search = `cd ~ && (command -v rg >/dev/null && rg -il onion . 2>/dev/null || grep -ril onion .) | head -50`

  it("knows a command from a step's name", () => {
    expect(isShellCommand(search)).toBe(true)
    expect(isShellCommand("pnpm test")).toBe(true)
    expect(isShellCommand("Read the page")).toBe(false)
    expect(isShellCommand("Open axeai.com")).toBe(false)
  })

  it("says what it does", () => {
    expect(commandLabel(search, false)).toBe("Searching the code for ‘onion’")
    expect(commandLabel(search, true)).toBe("Searched the code for ‘onion’")
    expect(commandLabel("pnpm exec vitest run", true)).toBe("Ran the tests")
    expect(commandLabel("git status --short", false)).toBe("Checking git status")
    expect(commandLabel("cat package.json", true)).toBe("Read package.json")
    expect(commandLabel("osascript -e 'tell app \"Finder\" to get name'", false)).toBe("Running a command")
  })
})
