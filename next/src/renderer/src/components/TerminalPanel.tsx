import "@xterm/xterm/css/xterm.css"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { TerminalIcon, XIcon } from "@/components/Icons"
import { plainError, setState, useStore } from "@/lib/store"
import { attachTerminal, endTerminal, ensureTerminal } from "@/lib/terminal"

/** The built-in terminal, docked under the screen: a real shell on this computer (⌘J shows or hides it). */
export function TerminalPanel() {
  const request = useStore((s) => s.terminal)
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(0)
  const [error, setError] = useState<string>()

  // Each request (⌘J, or a Sign in button) picks the shell to show, then the screen is put in place.
  useEffect(() => {
    if (!request) return
    setError(undefined)
    let gone = false
    ensureTerminal(request.agentId)
      .then(() => !gone && setReady((n) => n + 1))
      .catch((e) => !gone && setError(plainError(e)))
    return () => {
      gone = true
    }
  }, [request])

  useLayoutEffect(() => {
    if (!request || !ready || !host.current) return
    return attachTerminal(host.current)
  }, [request, ready])

  if (!request) return null
  const close = () => {
    endTerminal()
    setState({ terminal: null })
  }

  return (
    <section aria-label="Terminal" className="flex h-[280px] shrink-0 flex-col border-t border-border bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 pr-2 pl-4 text-[13px] text-muted-foreground">
        <TerminalIcon size={14} />
        <span className="flex-1">Terminal</span>
        <button type="button" aria-label="Hide the terminal" title="Hide (the shell keeps running)" onClick={() => setState({ terminal: null })} className="inline-flex h-6 items-center rounded-[6px] px-2 hover:bg-muted hover:text-foreground">
          Hide
        </button>
        <button type="button" aria-label="Close the terminal" onClick={close} className="inline-flex size-6 items-center justify-center rounded-[6px] hover:bg-muted hover:text-foreground">
          <XIcon size={12} />
        </button>
      </header>
      {error ? (
        <p role="alert" className="mx-4 mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : (
        <div className="min-h-0 flex-1 pb-2 pl-4">
          <div ref={host} className="h-full w-full" />
        </div>
      )}
    </section>
  )
}
