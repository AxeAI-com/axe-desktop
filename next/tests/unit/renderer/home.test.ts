import { describe, expect, it } from "vitest"

import type { ThreadSummary } from "@shared/types"
import { homeSections } from "@/lib/home"

const t = (id: string, updatedAt: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({ id, source: "agent", title: id, pinned: false, updatedAt, ...extra })

describe("homeSections", () => {
  const threads = [
    t("a", "2026-11-08T09:00:00Z"),
    t("b", "2026-11-08T10:00:00Z", { running: true }),
    t("c", "2026-11-08T11:00:00Z", { running: true }),
    t("d", "2026-11-07T09:00:00Z"),
    t("e", "2026-11-06T09:00:00Z"),
    t("f", "2026-11-05T09:00:00Z"),
    t("g", "2026-11-04T09:00:00Z"),
    t("fix", "2026-11-08T12:00:00Z", { watchId: "w1" }),
  ]

  it("puts waiting chats and problem watches under Needs you, running under Working", () => {
    const s = homeSections(threads, new Set(["c"]), [{ id: "w1", name: "Packages in next", line: "4 packages behind" }])
    expect(s.map((x) => x.id)).toEqual(["needs", "working"])
    expect(s[0]!.rows.map((r) => (r.kind === "thread" ? r.thread.id : r.id))).toEqual(["c", "w1"])
    expect(s[1]!.rows.map((r) => r.kind === "thread" && r.thread.id)).toEqual(["b"])
  })

  it("has no Recent list: idle chats stay in the sidebar", () => {
    expect(homeSections(threads, new Set(), []).map((x) => x.id)).toEqual(["working"])
  })

  it("leaves out empty sections", () => {
    expect(homeSections([], new Set(), [])).toEqual([])
  })
})
