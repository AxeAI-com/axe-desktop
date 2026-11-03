import { describe, expect, it } from "vitest"

import { axeSkills, skillTitle } from "@/lib/libraries"
import { filterSlash, firstPick, inMenuOrder, pickedText, slashItems } from "@/lib/slash"

// The window's side of the libraries: installed skills and the library pages in the / menu.

const skill = (name: string, description: string) => ({ name, description, source: "skill" as const })

describe("the / menu with libraries", () => {
  it("lists Axe's installed skills between the agent's commands and the starters, once each", () => {
    const items = slashItems([{ name: "review", description: "Check", source: "agent" }], false, [skill("brand-voice", "Write in the house style"), skill("review", "dup")])
    expect(inMenuOrder(items).map((i) => `${i.source}:${i.name}`).slice(0, 3)).toEqual(["agent:review", "skill:brand-voice", "axe:write"])
    expect(items.filter((i) => i.name === "review")).toHaveLength(1)
  })

  it("offers the library pages in Axe and agent chats, research only in Axe chats", () => {
    const axe = slashItems([], false).map((i) => i.name)
    const agent = slashItems([], true).map((i) => i.name)
    for (const name of ["skills", "agents", "connectors"]) {
      expect(axe).toContain(name)
      expect(agent).toContain(name)
    }
    // Projects and Studio are not in the desktop app.
    expect(axe).not.toContain("projects")
    expect(axe).not.toContain("studio")
    expect(agent).not.toContain("research")
    const open = slashItems([], false).find((i) => i.name === "connectors")!
    expect(open).toMatchObject({ action: "open", opens: "connectors" })
    expect(pickedText(open)).toBe("")
  })

  it("offers your agents by name; picking one starts a chat with it", () => {
    const items = inMenuOrder(slashItems([], false, [skill("brand-voice", "Write in our voice")], [{ id: "h1", name: "Code reviewer", role: "Reviews a branch" }]))
    const reviewer = items.find((i) => i.name === "code-reviewer")!
    expect(reviewer).toMatchObject({ source: "helper", action: "helper", helperId: "h1", description: "Reviews a branch" })
    expect(pickedText(reviewer)).toBe("")
    // Skills first, then agents, then Axe's starters.
    const order = items.map((i) => i.source)
    expect(order.indexOf("skill")).toBeLessThan(order.indexOf("helper"))
    expect(order.indexOf("helper")).toBeLessThan(order.indexOf("axe"))
  })

  it("starts on the first name match even when a skill's description matched above it", () => {
    const items = inMenuOrder(filterSlash(slashItems([], false, [skill("brand-voice", "Write or rewrite text")]), "wri"))
    expect(items[0]!.name).toBe("brand-voice")
    expect(items[firstPick(items, "wri")]!.name).toBe("write")
    expect(firstPick(items, "")).toBe(0)
    expect(firstPick(items, "zzz")).toBe(0)
  })
})

describe("skill helpers", () => {
  it("names skills for people and keeps only Axe's for its models", () => {
    expect(skillTitle({ id: "deck-outline", name: "deck-outline" })).toBe("Deck outline")
    const lib = {
      targets: [],
      skills: [
        { id: "a", name: "a", description: "", source: "starter" as const, installedIn: ["axe" as const] },
        { id: "b", name: "b", description: "", source: "cli" as const, installedIn: ["claude" as const] },
      ],
    }
    expect(axeSkills(lib).map((s) => s.id)).toEqual(["a"])
    expect(axeSkills(null)).toEqual([])
  })
})

describe("starting a chat with an agent", () => {
  it("uses your default Axe model when the agent has none, never the CLI you used last", async () => {
    const { getState, resetStore } = await import("@/lib/store")
    const { startWithHelper } = await import("@/lib/libraries")
    resetStore({
      settings: { baseURL: "https://axeai.com", theme: "dark", sidebarWidth: 300, quickBarKey: "Alt+Space", answerer: { kind: "agent", agentId: "claude-acp" } },
      catalog: { axe: { defaultModelId: "auto", models: [] }, agents: [{ id: "claude-acp", name: "Claude Code", note: "", state: "ready" }], local: [], servers: [] },
    })
    ;(globalThis as { window?: unknown }).window ??= globalThis
    ;(window as unknown as { axe: unknown }).axe = { invoke: async () => getState().settings, on: () => () => {}, platform: "darwin", pathOf: () => "" }
    startWithHelper({ id: "writer", name: "Writer", role: "", instructions: "x", kind: "write", skills: [], connectors: ["c1"], webSearch: false })
    expect(getState().draft).toMatchObject({ answerer: { kind: "axe", modelId: "auto" }, helperId: "writer", connectors: ["c1"] })
    expect(getState().view).toEqual({ kind: "new" })
    startWithHelper({ id: "code", name: "Code", role: "", instructions: "x", kind: "code", skills: [], connectors: [], webSearch: false, answerer: { kind: "agent", agentId: "claude-acp" } })
    expect(getState().draft.answerer).toEqual({ kind: "agent", agentId: "claude-acp" })
    // A CLI that isn't on this computer falls back to Axe.
    startWithHelper({ id: "gem", name: "G", role: "", instructions: "x", kind: "code", skills: [], connectors: [], webSearch: false, answerer: { kind: "agent", agentId: "gemini" } })
    expect(getState().draft.answerer).toEqual({ kind: "axe", modelId: "auto" })
  })
})
