import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"

import { invoke, on } from "./bridge"

// The built-in terminal's screen. The xterm lives here, not in a React component, so the shell keeps its
// screen and scrollback while the panel is hidden. The shell itself runs in the engine (src/main/terminal.ts).
// Ported from the old Electron app (desktop/src/renderer/src/lib/terminal.ts), one shell at a time.

type Live = { id: string; term: Terminal; fit: FitAddon; el: HTMLDivElement; opened: boolean; exited?: boolean }

let live: Live | undefined
let listening = false

function listen() {
  if (listening) return
  listening = true
  on("terminal", ({ id, data }) => live?.id === id && live.term.write(data))
  on("terminalExit", ({ id }) => {
    if (live?.id !== id) return
    live.exited = true
    live.term.write("\r\n\x1b[2mThe shell has ended. Close the terminal and open it again for a new one.\x1b[0m\r\n")
  })
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Colours follow the app's light or dark theme. */
function theme() {
  return {
    background: css("--background"),
    foreground: css("--foreground"),
    cursor: css("--foreground"),
    cursorAccent: css("--background"),
    selectionBackground: css("--surface-hover"),
  }
}

function create(id: string, output = ""): Live {
  const term = new Terminal({
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "DejaVu Sans Mono", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: theme(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.onData((data) => void invoke("terminal:write", id, data))
  term.onResize(({ cols, rows }) => void invoke("terminal:resize", id, cols, rows))
  // Copy and paste: Ctrl+Shift+C / V, and Ctrl+C (with a selection) / Ctrl+V on Windows. ⌘C / ⌘V work on a Mac.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown" || !e.ctrlKey) return true
    const k = e.key.toLowerCase()
    const win = navigator.userAgent.includes("Windows")
    if (k === "c" && (e.shiftKey || (win && term.hasSelection()))) {
      if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
      return false
    }
    // Returning false lets the browser paste into xterm's own text field.
    if (k === "v" && (e.shiftKey || win)) return false
    return true
  })
  const el = document.createElement("div")
  el.className = "h-full w-full"
  if (output) term.write(output)
  return { id, term, fit, el, opened: false }
}

function drop() {
  if (!live) return
  void invoke("terminal:close", live.id)
  live.term.dispose()
  live.el.remove()
  live = undefined
}

/** The shell being found or started, so a second ⌘J or Sign in waits for it instead of starting another. */
let pending: Promise<void> | undefined

/**
 * The shell to show: the one already running (also after a window reload), or a new one. With `agentId`,
 * that CLI's sign-in is typed into the running shell, or a new shell starts on it.
 */
export async function ensureTerminal(agentId?: string): Promise<void> {
  listen()
  while (pending) await pending.catch(() => {})
  const step = showShell(agentId)
  pending = step
  try {
    await step
  } finally {
    if (pending === step) pending = undefined
  }
}

async function showShell(agentId?: string): Promise<void> {
  if (!live || live.exited) {
    drop()
    const [running] = await invoke("terminal:list")
    if (running) live = create(running.id, running.output)
  }
  if (live && !live.exited) {
    if (agentId) await invoke("terminal:signIn", live.id, agentId)
    return
  }
  const s = await invoke("terminal:open", 100, 30, agentId)
  live = create(s.id)
}

/** Ends the shell (the panel's close button). */
export const endTerminal = drop

/** Puts the terminal into `host` and sizes it. Returns how to take it out again. */
export function attachTerminal(host: HTMLElement): () => void {
  const t = live
  if (!t) return () => {}
  host.appendChild(t.el)
  // xterm measures its box when it opens, so it opens the first time it's on screen.
  if (!t.opened) {
    t.term.open(t.el)
    t.opened = true
  }
  t.term.options.theme = theme()
  const refit = () => {
    if (host.clientWidth === 0 || host.clientHeight === 0) return
    try {
      t.fit.fit()
    } catch {}
  }
  refit()
  void invoke("terminal:resize", t.id, t.term.cols, t.term.rows)
  t.term.focus()
  const ro = new ResizeObserver(refit)
  ro.observe(host)
  const themeWatch = new MutationObserver(() => (t.term.options.theme = theme()))
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => {
    ro.disconnect()
    themeWatch.disconnect()
    t.el.remove()
  }
}
