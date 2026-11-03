import type { ThreadSummary } from "@shared/types"

export type ChatSection = { title: string; threads: ThreadSummary[] }

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Sidebar sections: Pinned, Today, Yesterday, Previous 7 days, Older. Newest first in each. */
export function groupThreads(threads: ThreadSummary[], now: Date): ChatSection[] {
  const today = dayStart(now)
  const day = 86_400_000
  const sections: ChatSection[] = [
    { title: "Pinned", threads: [] },
    { title: "Today", threads: [] },
    { title: "Yesterday", threads: [] },
    { title: "Previous 7 days", threads: [] },
    { title: "Older", threads: [] },
  ]
  const sorted = [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  for (const t of sorted) {
    const at = Date.parse(t.updatedAt)
    const i = t.pinned ? 0 : at >= today ? 1 : at >= today - day ? 2 : at >= today - 7 * day ? 3 : 4
    sections[i]!.threads.push(t)
  }
  return sections.filter((s) => s.threads.length)
}

export function initials(name?: string, email?: string): string {
  const src = name?.trim() || email || "?"
  return src.charAt(0).toUpperCase()
}

/** "just now", "3 minutes ago", "2 hours ago", "yesterday". */
export function relativeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`
  const d = Math.round(h / 24)
  return d === 1 ? "yesterday" : `${d} days ago`
}
