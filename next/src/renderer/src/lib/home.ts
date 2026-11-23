// What New chat lists under the composer: the work that needs you and what is running (the sidebar has
// your last chats, so the home doesn't repeat them).
// Pure, so it is tested without the store.

import type { ThreadSummary } from "@shared/types"

export type HomeRow =
  | { kind: "thread"; thread: ThreadSummary; state: "waiting" | "working" }
  | { kind: "watch"; id: string; name: string; line: string }

export type HomeSection = { id: "needs" | "working"; title: string; rows: HomeRow[] }

type WatchLike = { id: string; name: string; line: string }

/**
 * `waiting`: ids of chats with an open permission request. `problems`: watches with live problems, each
 * with its one-line reason. A watch's own fix chats stay out, as in the sidebar's Recents.
 */
export function homeSections(threads: ThreadSummary[], waiting: Set<string>, problems: WatchLike[]): HomeSection[] {
  const own = threads.filter((t) => !t.watchId)
  const needs: HomeRow[] = [
    ...own.filter((t) => waiting.has(t.id)).map((thread) => ({ kind: "thread" as const, thread, state: "waiting" as const })),
    ...problems.map((w) => ({ kind: "watch" as const, id: w.id, name: w.name, line: w.line })),
  ]
  const working: HomeRow[] = own.filter((t) => t.running && !waiting.has(t.id)).map((thread) => ({ kind: "thread", thread, state: "working" }))
  const out: HomeSection[] = [
    { id: "needs", title: "Needs you", rows: needs },
    { id: "working", title: "Working", rows: working },
  ]
  return out.filter((s) => s.rows.length > 0)
}
