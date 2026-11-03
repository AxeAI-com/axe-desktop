import type { PermissionRequest } from "@shared/types"

import type { TurnEvent } from "../chat"

// What waits for your OK in any chat, so axeai.com can list it and answer it (remote control's
// "decide"). Kept in memory only: a question can't outlive the chat that asked it.

export type Waiting = { id: string; threadId: string; title: string; body: string; at: string; request: PermissionRequest }

export type ApprovalsHost = {
  /** The chat's title, for "who" asks. */
  title(threadId: string): string | undefined
  answer(requestId: string, optionId: string): void
  now(): Date
}

export class Approvals {
  private waiting: Waiting[] = []
  private listeners = new Set<() => void>()

  constructor(private host: ApprovalsHost) {}

  /** Newest first. */
  list(): Waiting[] {
    return [...this.waiting].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed() {
    for (const fn of this.listeners) fn()
  }

  /** What the chat engine says: a question, an answer, or a turn that ended (its questions go with it). */
  onTurn(e: TurnEvent) {
    if (e.kind === "ask") {
      this.waiting = [
        ...this.waiting.filter((w) => w.id !== e.request.id),
        { id: e.request.id, threadId: e.request.threadId, title: this.host.title(e.request.threadId) ?? "A chat", body: e.request.title, at: this.host.now().toISOString(), request: e.request },
      ]
      return this.changed()
    }
    const before = this.waiting.length
    this.waiting = this.waiting.filter((w) => (e.kind === "answered" ? w.id !== e.id : w.threadId !== e.threadId))
    if (this.waiting.length !== before) this.changed()
  }

  /** approve: the first allow option; no: the first reject option. */
  decide(id: string, approve: boolean): Waiting {
    const item = this.waiting.find((w) => w.id === id)
    if (!item) throw new Error("That isn't waiting anymore.")
    const kinds = approve ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"]
    const option = item.request.options.find((o) => o.kind === kinds[0]) ?? item.request.options.find((o) => o.kind === kinds[1])
    if (!option) throw new Error("That question has no such answer.")
    this.host.answer(item.request.id, option.id)
    return item
  }
}
