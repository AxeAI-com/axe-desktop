import { describe, expect, it } from "vitest"

import type { CommunitySkill, LocalAgent, Skill } from "@shared/types"

import { draftAgent, nameFrom } from "@/lib/agent-draft"

// An agent from one sentence, built on this computer with no model call.

const claude: LocalAgent = { id: "claude-acp", name: "Claude Code", note: "", state: "ready" }
const skill = (key: string, name: string, description: string, source: CommunitySkill["source"] = "superpowers"): CommunitySkill => ({
  key,
  name,
  description,
  source,
  repo: "obra/superpowers",
  url: "",
})
const base = {
  agents: [claude],
  signedIn: true,
  recentFolders: ["/Users/mia/Code/axe-web", "/Users/mia/Code/axe-mac"],
  lastFolder: "/Users/mia/Code/axe-mac",
  catalog: [
    { id: "github", name: "GitHub", about: "", category: "Work" as const, url: "", auth: "oauth" as const },
    { id: "notion", name: "Notion", about: "", category: "Work" as const, url: "", auth: "oauth" as const },
  ],
  connected: [{ id: "c-notion", catalogId: "notion", name: "Notion" }],
  installed: [] as Skill[],
  community: [
    skill("superpowers/requesting-code-review", "Requesting code review", "Review a pull request before it merges"),
    skill("superpowers/brainstorming", "Brainstorming", "Shape a rough idea into a design"),
    skill("voltagent/x/review", "Code review checklist", "Checks pull requests for bugs and style", "voltagent"),
  ],
}

describe("an agent from one sentence", () => {
  it("reads who, where, apps and skills", () => {
    const d = draftAgent("Review my open pull requests in axe-web on GitHub and tell me what to fix.", base)
    expect(d.name).toBe("Review pull requests")
    expect(d.answerer).toEqual({ kind: "agent", agentId: "claude-acp" })
    expect(d.cwd).toBe("/Users/mia/Code/axe-web")
    expect(d.kind).toBe("code")
    expect(d.connectors).toEqual([{ name: "GitHub", catalogId: "github" }])
    expect(d.skills.map((s) => s.name)).toContain("Requesting code review")
    expect(d.skills.map((s) => s.name)).not.toContain("Brainstorming")
  })

  it("stays with Axe for writing when signed in, and knows a connected app", () => {
    const d = draftAgent("Write a weekly newsletter from my Notion notes", base)
    expect(d.answerer).toEqual({ kind: "axe", modelId: "auto" })
    expect(d.cwd).toBeUndefined()
    expect(d.kind).toBe("write")
    expect(d.connectors).toEqual([{ name: "Notion", catalogId: "notion", id: "c-notion" }])
  })

  it("uses a CLI in your last folder when signed out, and a ~ path you typed", () => {
    expect(draftAgent("Summarise my notes", { ...base, signedIn: false }).cwd).toBe("/Users/mia/Code/axe-mac")
    expect(draftAgent("Tidy the docs in @~/Code/axe-web", base).cwd).toBe("/Users/mia/Code/axe-web")
  })

  it("names it from the first part of the job", () => {
    expect(nameFrom("sum up my inbox and send it to Sam")).toBe("Sum up inbox")
    expect(nameFrom("")).toBe("New agent")
  })
})
