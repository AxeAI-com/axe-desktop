import { describe, expect, it } from "vitest"

import { gettingStarted, listNames, progressLine, startedLine, type GettingStartedInput } from "@/lib/getting-started"

const base: GettingStartedInput = { threads: [], checks: 0, connectors: 0, quickKey: "⌥Space", quickTried: false, signedIn: true }

describe("gettingStarted", () => {
  it("shows five steps when signed in with no model server, none done on a new Mac", () => {
    const s = gettingStarted(base)
    expect(s.map((x) => x.id)).toEqual(["agent", "project", "oversight", "connectors", "quick"])
    expect(s.every((x) => !x.done)).toBe(true)
    expect(s.find((x) => x.id === "quick")!.hint).toBe("Press ⌥Space anywhere")
  })

  it("names the coding agents found on this Mac, not ones only runnable through npx", () => {
    const s = gettingStarted({
      ...base,
      agents: [
        { name: "Claude Code", state: "ready", here: true },
        { name: "Codex", state: "ready", here: true },
        { name: "Gemini CLI", state: "ready" },
        { name: "Goose", state: "install" },
      ],
    })
    expect(s[0]).toMatchObject({ done: true, hint: "Found Claude Code and Codex" })
  })

  it("reads each step's done state from this Mac", () => {
    const s = gettingStarted({
      ...base,
      threads: [{ source: "agent", cwd: "/Users/mia/site" }, { source: "local" }],
      checks: 1,
      connectors: 2,
      servers: [{ name: "Ollama", found: true }, { name: "LM Studio", found: false }],
      quickTried: true,
    })
    expect(Object.fromEntries(s.map((x) => [x.id, x.done]))).toEqual({ agent: false, project: true, oversight: true, connectors: true, local: true, quick: true })
    expect(s.find((x) => x.id === "local")!.hint).toBe("Found Ollama")
    expect(progressLine(s)).toBe("5 of 6 done")
    expect(startedLine(s)).toBe("Getting started, 5 of 6 done")
  })

  it("an agent chat without a folder doesn't count as work in a project", () => {
    expect(gettingStarted({ ...base, threads: [{ source: "agent" }] })[1]!.done).toBe(false)
  })

  it("adds Sign in only when signed out", () => {
    const s = gettingStarted({ ...base, signedIn: false })
    expect(s.at(-1)).toMatchObject({ id: "signin", done: false })
  })
})

describe("listNames", () => {
  it("joins names in plain English", () => {
    expect(listNames(["A"])).toBe("A")
    expect(listNames(["A", "B"])).toBe("A and B")
    expect(listNames(["A", "B", "C"])).toBe("A, B and C")
  })
})
