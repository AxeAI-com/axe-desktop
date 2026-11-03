import type { ChatMessage, ThreadSummary } from "@shared/types"
import type { Kind as WatchKind } from "@shared/watching/types"

// The composer's @ menu: a folder on this Mac, an app (one you connected, or one installed), or one
// of your chats. Picking one puts it in the message: a folder or app as "@name", a chat as a file.

export type MentionKind = "watch" | "folder" | "connector" | "app" | "chat"
export type MentionItem = { kind: MentionKind; key: string; label: string; detail?: string; value: string; watchKind?: WatchKind }

/** The "@words" being typed at the cursor: after the start or a space, with no space in it. */
export function mentionQuery(text: string, caret: number): { at: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf("@")
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null
  const query = before.slice(at + 1)
  return /\s/.test(query) ? null : { at, query }
}

/** The text with "@query" at `at` replaced by `insert`. */
export const replaceMention = (text: string, at: number, caret: number, insert: string) => text.slice(0, at) + insert + text.slice(caret)

const has = (q: string, ...fields: (string | undefined)[]) => {
  const s = q.toLowerCase()
  return !s || fields.some((f) => f?.toLowerCase().includes(s))
}

/** Folders as the engine found them, then your connected apps, Mac apps and chats that match, a few of each. */
export function mentionItems(
  query: string,
  o: { folders: { path: string; display: string }[]; connectors: { id: string; name: string }[]; apps: string[]; threads: ThreadSummary[]; watches?: { id: string; name: string; kind: WatchKind; label: string }[] },
): MentionItem[] {
  // A typed path is about folders only.
  const pathy = query.startsWith("/") || query.startsWith("~")
  const folders: MentionItem[] = o.folders.map((f) => ({ kind: "folder", key: `f:${f.path}`, label: f.display.split("/").pop() || f.display, detail: f.display, value: f.path }))
  if (pathy) return folders
  // The engine already matched them; a list from before the last keystroke may not have.
  const near = folders.filter((f) => has(query, f.detail))
  const connected = o.connectors.filter((c) => has(query, c.name)).slice(0, 4)
  const apps = o.apps.filter((a) => has(query, a) && !connected.some((c) => c.name.toLowerCase() === a.toLowerCase())).slice(0, query ? 6 : 4)
  const chats = o.threads.filter((t) => has(query, t.title)).slice(0, query ? 6 : 4)
  const watches = (o.watches ?? []).filter((w) => has(query, w.name)).slice(0, query ? 6 : 4)
  return [
    ...watches.map((w): MentionItem => ({ kind: "watch", key: `w:${w.id}`, label: w.name, detail: w.label, value: w.id, watchKind: w.kind })),
    ...near,
    ...connected.map((c): MentionItem => ({ kind: "connector", key: `c:${c.id}`, label: c.name, detail: "Connected", value: c.id })),
    ...apps.map((a): MentionItem => ({ kind: "app", key: `a:${a}`, label: a, detail: "App", value: a })),
    ...chats.map((t): MentionItem => ({ kind: "chat", key: `t:${t.id}`, label: t.title || "New chat", detail: "Chat", value: t.id })),
  ]
}

/** A chat as Markdown to attach: its words, newest kept when it's long. */
export function chatMarkdown(title: string, messages: ChatMessage[], max = 20_000): string {
  const turns = messages
    .map((m) => {
      const words = m.parts
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim()
      return words ? `**${m.role === "user" ? "You" : "Answer"}:** ${words}` : ""
    })
    .filter(Boolean)
  let body = turns.join("\n\n")
  if (body.length > max) body = `(Earlier messages left out.)\n\n${body.slice(body.length - max)}`
  return `# ${title || "Chat"}\n\n${body}\n`
}
