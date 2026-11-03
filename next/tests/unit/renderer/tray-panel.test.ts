import { describe, expect, it } from "vitest"

import type { ChatMessage, ThreadSummary } from "@shared/types"
import type { WatchView } from "@shared/watching/types"

import { previewOf, recentChats, shortAgo, statusTone, watchLine } from "@/lib/tray"

const NOW = new Date("2026-10-31T14:45:00").getTime()
const MIN = 60_000

const watch = (o: Partial<WatchView> = {}): WatchView =>
  ({
    id: "w",
    kind: "uptime",
    target: "lane-ceramics.com",
    name: "lane-ceramics.com",
    every: "5m",
    notify: "now",
    createdAt: NOW - 7 * 86_400_000,
    latest: { at: NOW - 2 * MIN, ms: 300, status: "quiet", findings: [] },
    open: [],
    failedStreak: 0,
    nextAt: NOW + 3 * MIN,
    strip: [],
    line: "Up. Loads in 1.3 s.",
    past: [],
    said: [],
    news: [],
    unread: false,
    fixes: [],
    ...o,
  }) as WatchView

describe("the menu bar panel", () => {
  it("gives each watch a dot", () => {
    expect(statusTone(watch(), NOW)).toBe("ok")
    expect(statusTone(watch({ paused: true }), NOW)).toBe("mute")
    expect(statusTone(watch({ latest: undefined }), NOW)).toBe("mute")
    const slow = { key: "slow", level: "problem" as const, headline: "Slow", line: "Slow: the home page takes 4.1 s.", fix: "none" as const, openedAt: NOW - 10 * MIN, lastSeenAt: NOW }
    expect(statusTone(watch({ open: [slow] }), NOW)).toBe("warn")
    expect(watchLine(watch({ open: [slow] }), NOW)).toBe("Slow: the home page takes 4.1 s")
    expect(watchLine(watch(), NOW)).toBe("Up. Loads in 1.3 s")
  })

  it("says times shortly", () => {
    expect(shortAgo(NOW, false, NOW)).toBe("Just now")
    expect(shortAgo(NOW - 15 * MIN, false, NOW)).toBe("15 min ago")
    expect(shortAgo(NOW - 3 * 60 * MIN, false, NOW)).toBe("3 h ago")
    expect(shortAgo(NOW - 26 * 60 * MIN, false, NOW)).toBe("Yesterday")
  })

  it("lists the last three chats, without a watch's fix sessions", () => {
    const t = (id: string, h: number, watchId?: string) => ({ id, source: "axe", title: id, pinned: false, updatedAt: new Date(NOW - h * 3_600_000).toISOString(), ...(watchId ? { watchId } : {}) }) as ThreadSummary
    expect(recentChats([t("a", 5), t("b", 1), t("fix", 0, "w"), t("c", 3), t("d", 2)]).map((x) => x.id)).toEqual(["b", "d", "c"])
  })

  it("previews a chat's last words on one line", () => {
    const m = (role: "user" | "assistant", text: string) => ({ id: text, role, parts: [{ type: "text", id: "p", text }] }) as ChatMessage
    expect(previewOf([m("user", "Plan a day"), m("assistant", "## A slow day\n\n**Morning:** catch [Tram 28](https://x.test)")])).toBe("A slow day Morning: catch Tram 28")
    expect(previewOf([])).toBe("")
  })
})
