import type { ChatMessage, ThreadSummary } from "@shared/types"
import { liveProblems } from "@shared/watching/findings"
import type { WatchView } from "@shared/watching/types"

import { clock, day, sameDay } from "@/components/watching/Evidence"

// The menu bar panel's words: a watch's dot and one line, the short times, the three recent chats.

export type Tone = "ok" | "warn" | "news" | "mute"

/** Orange for an open problem, blue for news you haven't seen, grey while paused or unchecked, else green. */
export function statusTone(w: WatchView, now = Date.now()): Tone {
  if (w.paused || !w.latest) return "mute"
  if (liveProblems(w, now).length) return "warn"
  if (w.latest.status === "failed") return "mute"
  if (w.unread && w.news.some((n) => !n.ignored)) return "news"
  return "ok"
}

/** The row's one line: the open problem's own line, else the watch's latest fact. */
export function watchLine(w: WatchView, now = Date.now()): string {
  if (w.paused) return "Paused"
  const p = liveProblems(w, now)
  if (w.kind === "repo" && p.length > 1) return `${p.length} new security alerts`
  return (p[0]?.line ?? w.line).replace(/\.$/, "")
}

/** "Just now", "12 min ago", "3 h ago" today, then "Yesterday" and "Oct 30". `clockToday`: today's time instead. */
export function shortAgo(t: number, clockToday = false, now = Date.now()): string {
  const m = Math.round((now - t) / 60_000)
  if (m < 1) return "Just now"
  if (!clockToday && m < 60) return `${m} min ago`
  if (sameDay(t, now)) return clockToday ? clock(t) : `${Math.round(m / 60)} h ago`
  if (sameDay(t, now - 86_400_000)) return "Yesterday"
  return day(t)
}

/** The last three chats you had, newest first; a watch's fix sessions stay out, as in Recents. */
export function recentChats(threads: ThreadSummary[], n = 3): ThreadSummary[] {
  return [...threads]
    .filter((t) => !t.watchId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, n)
}

/** A chat's last words on one line, without Markdown marks. */
export function previewOf(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i]!.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ")
    const plain = text
      .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#>*_`|~]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (plain) return plain
  }
  return ""
}
