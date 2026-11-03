import { describe, expect, it } from "vitest"

import { pickSuggestions, suggestionText } from "@/lib/suggestions"

// The new chat's four cards: each a feature you can use right now.

describe("new chat suggestions", () => {
  it("shows what you can use, signed in or not", () => {
    expect(pickSuggestions({ signedIn: true, agentReady: true })).toEqual(["fix", "research", "doit", "skill"])
    expect(pickSuggestions({ signedIn: false, agentReady: true })).toEqual(["fix", "plan", "skill", "watch"])
    expect(pickSuggestions({ signedIn: false, agentReady: false })).toEqual(["install", "signin", "plan", "watch"])
    expect(pickSuggestions({ signedIn: true, agentReady: false })[0]).toBe("install")
  })

  it("names the agent and the folder it works in", () => {
    expect(suggestionText("fix", "Claude Code", "axe-web").note).toBe("Claude Code fixes failing tests in axe-web.")
    expect(suggestionText("fix").note).toBe("Your CLI fixes failing tests.")
  })

  it("keeps every card short, with no middle dots", () => {
    for (const id of ["fix", "plan", "research", "doit", "watch", "skill", "install", "signin"] as const) {
      const t = suggestionText(id, "Claude Code", "axe-web")
      expect(t.title.length).toBeLessThanOrEqual(24)
      // Two lines on a card.
      expect(t.note.length).toBeLessThanOrEqual(50)
      expect(`${t.title}${t.note}`).not.toContain(" · ")
    }
  })
})
