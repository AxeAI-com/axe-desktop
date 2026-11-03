import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import type { ChatMessage } from "@shared/types"

import { fromACP, frontMatter, instructionsFiles, instructionsName, instructionsPath, mergeCommands, onDisk } from "../../src/main/agents/commands"
import { ReplyBuilder } from "../../src/main/agents/updates"
import { memoryText } from "../../src/main/memory"

describe("an agent's / commands", () => {
  it("maps advertised commands, dropping slashes, blanks and repeats", () => {
    expect(
      fromACP([
        { name: "/review", description: "Review\n the   branch" },
        { name: "review", description: "again" },
        { name: " ", description: "blank" },
        { name: "compact", description: "Compact", input: { hint: "what to keep" } },
      ]),
    ).toEqual([
      { name: "review", description: "Review the branch", source: "agent" },
      { name: "compact", description: "Compact", source: "agent", hint: "what to keep" },
    ])
  })

  it("reads front matter", () => {
    expect(frontMatter('---\nname: brand-voice\ndescription: "House style"\n---\nBody')).toEqual({ name: "brand-voice", description: "House style" })
    expect(frontMatter("no front matter")).toEqual({})
  })

  it("finds Claude Code skills and command files in the project, then home", async () => {
    const root = mkdtempSync(join(tmpdir(), "axe-cmds-"))
    const cwd = join(root, "proj")
    const home = join(root, "home")
    mkdirSync(join(cwd, ".claude/skills/release-notes"), { recursive: true })
    mkdirSync(join(cwd, ".claude/commands"), { recursive: true })
    mkdirSync(join(home, ".claude/skills/release-notes"), { recursive: true })
    mkdirSync(join(home, ".claude/skills/empty"), { recursive: true })
    writeFileSync(join(cwd, ".claude/skills/release-notes/SKILL.md"), "---\ndescription: Notes from merged changes\n---\n")
    writeFileSync(join(home, ".claude/skills/release-notes/SKILL.md"), "---\ndescription: The home copy\n---\n")
    writeFileSync(join(cwd, ".claude/commands/ship.md"), "---\nargument-hint: <version>\n---\n# Ship a release\n")
    const found = await onDisk("claude-code", cwd, home)
    expect(found).toEqual([
      { name: "release-notes", description: "Notes from merged changes", source: "skill" },
      { name: "ship", description: "Ship a release", source: "skill", hint: "<version>" },
    ])
    expect(await onDisk("claude-code", join(root, "missing"), join(root, "nowhere"))).toEqual([])
  })

  it("keeps the agent's own entry when a skill has the same name", () => {
    const merged = mergeCommands([{ name: "review", description: "Agent", source: "agent" }], [
      { name: "review", description: "Disk", source: "skill" },
      { name: "tidy", description: "Disk", source: "skill" },
    ])
    expect(merged.map((c) => `${c.name}:${c.source}`)).toEqual(["review:agent", "tidy:skill"])
  })
})

describe("instructions files", () => {
  it("names each CLI's own file", () => {
    expect(instructionsName("claude-code")).toBe("CLAUDE.md")
    expect(instructionsName("codex-acp")).toBe("AGENTS.md")
    expect(instructionsName("gemini-cli")).toBe("GEMINI.md")
  })

  it("lists the CLI's file even when missing, plus others already there", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "axe-instr-"))
    writeFileSync(join(cwd, "AGENTS.md"), "# notes")
    expect(await instructionsFiles("claude-code", cwd)).toEqual([
      { name: "CLAUDE.md", path: join(cwd, "CLAUDE.md"), exists: false },
      { name: "AGENTS.md", path: join(cwd, "AGENTS.md"), exists: true },
    ])
  })

  it("opens only known names directly in the folder", () => {
    expect(instructionsPath("/w", "CLAUDE.md")).toBe(join("/w", "CLAUDE.md"))
    for (const bad of ["../CLAUDE.md", "notes.md", "/etc/passwd", "sub/AGENTS.md"]) expect(() => instructionsPath("/w", bad)).toThrow()
  })
})

describe("usage from an agent", () => {
  it("takes usage_update, and falls back to the turn's token count without a window", () => {
    const m: ChatMessage = { id: "m", role: "assistant", parts: [] }
    const b = new ReplyBuilder(m)
    expect(b.apply({ sessionUpdate: "usage_update", used: 0, size: 0 })).toBe(false)
    expect(b.apply({ sessionUpdate: "usage_update", used: 5000, size: 200_000, cost: { amount: 0.12, currency: "USD" } })).toBe(true)
    b.usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 })
    expect(m.context).toEqual({ used: 5000, size: 200_000, cost: { amount: 0.12, currency: "USD" } })

    const n: ChatMessage = { id: "n", role: "assistant", parts: [] }
    new ReplyBuilder(n).usage({ inputTokens: 900, outputTokens: 100, cachedReadTokens: 4000, totalTokens: 5000 })
    expect(n.context).toEqual({ used: 5000 })
  })
})

describe("the memory block", () => {
  it("is empty with nothing remembered, a short list otherwise", () => {
    expect(memoryText([])).toBe("")
    const t = memoryText([{ id: "1", text: "Prices in USD", createdAt: "", updatedAt: "" }])
    expect(t.split("\n").at(-1)).toBe("- Prices in USD")
  })
})
