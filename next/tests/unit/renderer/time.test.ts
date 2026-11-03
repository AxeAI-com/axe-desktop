import { describe, expect, it } from "vitest"

import type { ThreadSummary } from "@shared/types"

import { groupThreads } from "@/lib/time"

describe("groupThreads", () => {
  const now = new Date(2026, 9, 22, 19, 30)
  const at = (daysAgo: number, hours = 0) => new Date(2026, 9, 22 - daysAgo, 12 + hours).toISOString()
  const t = (id: string, updatedAt: string, pinned = false): ThreadSummary => ({ id, source: "axe", title: id, pinned, updatedAt })

  it("sorts chats into Pinned, Today, Yesterday, Previous 7 days and Older", () => {
    const sections = groupThreads(
      [t("old", at(30)), t("today", at(0)), t("pinned", at(40), true), t("yesterday", at(1)), t("week", at(4)), t("today2", at(0, 2))],
      now,
    )
    expect(sections.map((s) => [s.title, s.threads.map((x) => x.id)])).toEqual([
      ["Pinned", ["pinned"]],
      ["Today", ["today2", "today"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["old"]],
    ])
  })

  it("leaves out empty sections", () => {
    expect(groupThreads([t("a", at(0))], now).map((s) => s.title)).toEqual(["Today"])
  })
})
