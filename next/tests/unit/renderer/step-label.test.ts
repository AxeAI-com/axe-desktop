import { describe, expect, it } from "vitest"

import { formatSeconds, type ToolPart } from "@/lib/steps"
import { commandStep, connectorName, groupPhrase, groupRuns, stepLabel, toolStep } from "@/lib/step-label"

const tool = (title: string, kind: ToolPart["kind"], more: Partial<ToolPart> = {}): ToolPart => ({ type: "tool", id: title, title, kind, state: "done", ...more })

describe("shell commands in plain English", () => {
  it("names test runs", () => {
    for (const c of ["pnpm test", "npm test -- upload", "pnpm exec vitest run tests/unit", "npx jest", "pytest -q", "go test ./...", "cargo test", "cd app && pnpm run test:unit"])
      expect(commandStep(c).done, c).toBe("Ran the tests")
    expect(commandStep("pnpm test").now).toBe("Running the tests")
  })

  it("names searches by their first pattern", () => {
    expect(commandStep(`cd . && grep -rniE "unarchive|restore" src | head; echo done`).done).toBe("Searched the code for ‘unarchive|restore’")
    expect(commandStep("rg -n --glob '*.ts' useStore src").done).toBe("Searched the code for ‘useStore’")
    expect(commandStep("grep -e foo -e bar .").done).toBe("Searched the code for ‘foo’")
    expect(commandStep(`find . -name "*.test.ts" -not -path "*/node_modules/*"`).now).toBe("Searching the code for ‘*.test.ts’")
    expect(commandStep("find src -type f").done).toBe("Searched the code")
  })

  it("names listing, git, installs and the rest", () => {
    expect(commandStep("ls -la src").done).toBe("Listed files")
    expect(commandStep("tree -L 2").done).toBe("Listed files")
    expect(commandStep("git status --short").done).toBe("Checked git status")
    expect(commandStep("git diff HEAD~1").done).toBe("Checked git status")
    expect(commandStep("git log --oneline -5").done).toBe("Checked git history")
    expect(commandStep("pnpm install --frozen-lockfile").done).toBe("Installed packages")
    expect(commandStep("pip install requests").done).toBe("Installed packages")
    expect(commandStep("cat src/lib/store.ts").done).toBe("Read store.ts")
    // Axe's own app tools keep their words, in the past tense once done.
    expect(toolStep(tool("Open Claude", "other"))).toMatchObject({ done: "Opened Claude", now: "Opening Claude" })
    expect(toolStep(tool("Click in the app", "other")).done).toBe("Clicked in the app")
    expect(toolStep(tool("Take a screenshot", "other")).done).toBe("Took a screenshot")
    expect(toolStep(tool("Look for apps like “claude”", "search")).done).toBe("Looked for apps like “claude”")
    // Redirections are not files: never "Read null".
    expect(commandStep("cat .claude/memory/MEMORY.md 2>/dev/null | head -40").done).toBe("Read MEMORY.md")
    expect(commandStep("cat notes.md 2> /dev/null").done).toBe("Read notes.md")
    expect(commandStep("tail -n 20 app.log > out.txt").done).toBe("Read app.log")
    expect(commandStep('grep -rn "<div" src').done).toBe("Searched the code for ‘<div’")
    expect(commandStep("curl -s https://www.axeai.com/pricing").done).toBe("Opened axeai.com")
    expect(commandStep("node scripts/build.mjs").done).toBe("Ran a command")
    expect(commandStep("git commit -m 'x'").now).toBe("Running a command")
  })
})

describe("tool steps", () => {
  it("reads and edits name the file", () => {
    expect(toolStep(tool("Read /Users/mia/app/src/store.ts (1 - 40)", "read")).done).toBe("Read store.ts")
    expect(toolStep(tool("Read File", "read", { input: "/Users/mia/app/README.md" })).done).toBe("Read README.md")
    expect(toolStep(tool("Read the page", "fetch")).done).toBe("Read the page")
    const edit = toolStep(tool("Edit `src/cart.js`", "edit", { diff: [{ path: "src/cart.js", before: "a\nb\n", after: "a\nc\nd\n" }] }))
    expect(edit).toMatchObject({ done: "Edited cart.js", now: "Editing cart.js", extra: "+2 −1" })
    expect(toolStep(tool("Write notes.txt", "edit")).done).toBe("Edited notes.txt")
  })

  it("runs a CLI's shell step through the command words", () => {
    expect(toolStep(tool("`pnpm test`", "execute")).done).toBe("Ran the tests")
    expect(toolStep(tool("grep -n \"Composer\" src", "search")).done).toBe("Searched the code for ‘Composer’")
    expect(toolStep(tool("Find `**/*.tsx`", "search")).done).toBe("Searched the code for ‘**/*.tsx’")
    // Words an engine already wrote stay.
    expect(toolStep(tool("Ran the test 10 times", "execute", { input: "pnpm test upload" })).done).toBe("Ran the test 10 times")
  })

  it("names the web and connectors", () => {
    expect(toolStep(tool("Fetch https://docs.axeai.com/start", "fetch")).done).toBe("Opened docs.axeai.com")
    expect(toolStep(tool("Read a page", "fetch", { input: "https://www.example.com/a" })).done).toBe("Opened example.com")
    expect(toolStep(tool(`"best espresso grinder"`, "fetch")).done).toBe("Searched the web for ‘best espresso grinder’")
    expect(toolStep(tool("Searched the web", "search", { input: "weather in Lisbon" })).done).toBe("Searched the web for ‘weather in Lisbon’")
    expect(toolStep(tool("Searching the web", "search", { state: "running" })).now).toBe("Searching the web")
    expect(toolStep(tool("mcp__claude_ai_Google_Drive__search", "other")).done).toBe("Used Google Drive")
    expect(toolStep(tool("mcp__github__create_issue", "other")).now).toBe("Using GitHub")
    expect(connectorName("linear")).toBe("Linear")
  })

  it("thinking reads as its seconds", () => {
    expect(stepLabel({ type: "reasoning", id: "r", text: "", done: true, seconds: 4 }, formatSeconds).done).toBe("Thought for 4s")
    expect(stepLabel({ type: "reasoning", id: "r", text: "", done: false }, formatSeconds).now).toBe("Thinking")
  })
})

describe("grouping", () => {
  it("folds a run of one kind", () => {
    const runs = groupRuns(["read", "read", "read", "code", "read", undefined], (g) => g)
    expect(runs.map((r) => [r.group, r.items.length])).toEqual([
      ["read", 3],
      ["code", 1],
      ["read", 1],
      [undefined, 1],
    ])
    expect(groupPhrase("read", 4)).toBe("Read 4 files")
    expect(groupPhrase("command", 2)).toBe("Ran 2 commands")
  })
})
