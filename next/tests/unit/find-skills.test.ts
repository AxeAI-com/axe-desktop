import { describe, expect, it } from "vitest"

import type { CommunitySkill, Skill } from "@shared/types"

import { findSkills } from "@/screens/Skills"

// The Skills page search: what you need to do, across yours and the open-source libraries.

const mine: Skill[] = [{ id: "brand-voice", name: "brand-voice", description: "Write or rewrite text in a calm brand voice", source: "starter", installedIn: ["axe"] }]
const open: CommunitySkill[] = [
  { key: "voltagent/x/release-notes", name: "Release notes", description: "Write release notes from merged pull requests", source: "voltagent", repo: "x/y", url: "" },
  { key: "superpowers/brainstorming", name: "Brainstorming", description: "Shape a rough idea into a design", source: "superpowers", repo: "obra/superpowers", url: "" },
]

describe("finding a skill by what you need to do", () => {
  it("ranks the best fit first and leaves out what doesn't fit", () => {
    const hits = findSkills("write release notes", mine, open)
    expect(hits[0]).toMatchObject({ kind: "open", skill: { key: "voltagent/x/release-notes" } })
    expect(hits.some((h) => h.kind === "open" && h.skill.key === "superpowers/brainstorming")).toBe(false)
    expect(hits.some((h) => h.kind === "mine")).toBe(true)
  })

  it("finds nothing for an empty search", () => {
    expect(findSkills("  ", mine, open)).toEqual([])
  })
})
