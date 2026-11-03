import { describe, expect, it } from "vitest"

import type { ThreadSummary } from "@shared/types"

import { draftFolder, getState, lastFolder } from "@/lib/store"

// A new agent chat starts in the folder you used last, so sending never stops at a folder picker.

const t = (id: string, cwd: string, updatedAt: string, more: Partial<ThreadSummary> = {}): ThreadSummary => ({ id, source: "agent", agentId: "claude-code", cwd, title: id, pinned: false, updatedAt, ...more })

describe("new chat folder", () => {
  const threads = [
    t("a", "/w/old", "2026-10-01T00:00:00Z"),
    t("b", "/w/new", "2026-10-20T00:00:00Z", { agentId: "codex" }),
    { id: "x", source: "axe", title: "x", pinned: false, updatedAt: "2026-10-22T00:00:00Z" } as ThreadSummary,
  ]

  it("is the newest agent chat's folder, from any agent", () => {
    expect(lastFolder({ ...getState(), threads })).toBe("/w/new")
    expect(lastFolder({ ...getState(), threads: [] })).toBeUndefined()
  })

  it("is the folder a copy came from, not the copy", () => {
    const copied = [t("c", "/tmp/copy-1", "2026-10-23T00:00:00Z", { copy: { kind: "worktree", source: "/w/app", branch: "fix" } })]
    expect(lastFolder({ ...getState(), threads: copied })).toBe("/w/app")
  })

  it("gives way to a folder you picked", () => {
    const s = getState()
    expect(draftFolder({ ...s, threads, draft: { ...s.draft, cwd: "/w/picked" } })).toBe("/w/picked")
    expect(draftFolder({ ...s, threads, draft: { ...s.draft, cwd: undefined } })).toBe("/w/new")
  })
})
