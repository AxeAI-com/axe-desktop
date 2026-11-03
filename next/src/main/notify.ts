// System notifications when an agent needs your OK or finishes and the window isn't
// in front. The engine says what happened here; index.ts decides whether and how to
// show it (Electron's Notification), so the engine runs without Electron in tests.

export type Notice = {
  threadId: string
  kind: "permission" | "done" | "failed" | "needs"
  title: string
  body: string
  /** A watch's problem: its finding, so the actions can act on it. */
  findingId?: string
  /** Buttons macOS shows on hover. Without them, a notice that needs you offers Fix it and Open. */
  actions?: { id: "fix" | "snooze1h" | "open"; text: string }[]
  /** No sound (news, "back up"). */
  silent?: boolean
}

let notifier: (n: Notice) => void = () => {}

export function setNotifier(fn: (n: Notice) => void) {
  notifier = fn
}

export function notify(n: Notice) {
  notifier(n)
}

/** The parts of Electron a notifier needs: injected so it can be tested. */
export type NotifierHost = {
  /** Is any window of the app in front? */
  focused(): boolean
  supported(): boolean
  show(n: Notice, onClick: () => void, onAction?: (id: "fix" | "snooze1h" | "open") => void): void
  /** Brings the window forward and opens the chat. */
  open(threadId: string): void
  /** "Fix with …" on a watch's problem: opens the watch and starts the fix there. */
  fix?(findingId: string, threadId: string): void
  /** "Snooze 1 hour" on a watch's problem. */
  snooze?(findingId: string, threadId: string): void
}

/** Shows a notice only while the app isn't in front; clicking it opens the chat. */
export function createNotifier(host: NotifierHost): (n: Notice) => void {
  return (n) => {
    if (host.focused() || !host.supported()) return
    const f = n.findingId
    const onAction = (id: "fix" | "snooze1h" | "open") => {
      if (id === "fix" && f && host.fix) host.fix(f, n.threadId)
      else if (id === "snooze1h" && f && host.snooze) host.snooze(f, n.threadId)
      else host.open(n.threadId)
    }
    host.show(n, () => host.open(n.threadId), n.actions?.length ? onAction : undefined)
  }
}
