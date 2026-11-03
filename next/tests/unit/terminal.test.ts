import { createRequire } from "node:module"

import { afterAll, describe, expect, it } from "vitest"

import { signInCommand } from "../../src/main/agents/registry"
import { setEmitter } from "../../src/main/bus"
import * as terminal from "../../src/main/terminal"
import { signInAgent } from "../../src/renderer/src/components/Cards"

// No prebuilt node-pty for Linux (the CI container): the shell test needs one.
const ptyLoads = (() => {
  try {
    createRequire(import.meta.url)("node-pty")
    return true
  } catch {
    return false
  }
})()

describe("built-in terminal", () => {
  afterAll(() => terminal.closeAll())

  it.skipIf(!ptyLoads)("runs a real shell and types the command it was opened with", async () => {
    let out = ""
    setEmitter((event, payload) => {
      if (event === "terminal") out += (payload as { data: string }).data
    })
    const s = await terminal.open(80, 24, "echo axe-term-$((40+2))")
    await expect.poll(() => out, { timeout: 10_000 }).toContain("axe-term-42")
    expect(terminal.list().map((x) => x.id)).toContain(s.id)
    terminal.close(s.id)
    expect(terminal.list().map((x) => x.id)).not.toContain(s.id)
  })

  it("knows each CLI's sign-in", () => {
    expect(signInCommand("claude-acp")).toBe("claude auth login")
    expect(signInCommand("codex-acp")).toBe("codex login")
    expect(signInCommand("gemini")).toBe("gemini")
    expect(signInCommand("nope")).toBeUndefined()
  })

  it("offers Sign in only for an agent whose sign-in lapsed", () => {
    const text = "Claude Code needs you to sign in again. Press Sign in to do it in the terminal, then try again."
    expect(signInAgent(text, { kind: "agent", agentId: "claude-acp" })).toBe("claude-acp")
    expect(signInAgent("Something else broke", { kind: "agent", agentId: "claude-acp" })).toBeUndefined()
    expect(signInAgent(text, { kind: "axe", modelId: "auto" })).toBeUndefined()
  })
})
