import { randomUUID } from "node:crypto"
import { accessSync, chmodSync, constants, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import type { IPty } from "node-pty"

import type { TerminalSession } from "@shared/types"

import { emit } from "./bus"
import { childEnv } from "./shell-env"

// The built-in terminal: a real shell in a pseudo-terminal (node-pty), shown with xterm.js in the window.
// Shells live here, so they keep running while the panel is closed, and are killed when the app quits.
// Ported from the old Electron app (desktop/src/main/terminal.ts).

type Session = TerminalSession & { pty: IPty; output: string; pending: string; timer?: NodeJS.Timeout }

const sessions = new Map<string, Session>()
const KEEP = 200_000 // characters of scrollback kept for a window that reloads

/** Loaded on first use, so a missing native module only breaks the terminal, not the app. */
let pty: typeof import("node-pty") | undefined
function nodePty(): typeof import("node-pty") {
  if (pty) return pty
  try {
    const require = createRequire(import.meta.url)
    pty = require("node-pty") as typeof import("node-pty")
    if (process.platform !== "win32") runnableHelper(dirname(require.resolve("node-pty/package.json")))
    return pty
  } catch (e) {
    throw new Error(`The terminal isn't available on this computer (${(e as Error).message.split("\n")[0]}).`)
  }
}

/** node-pty starts shells through its spawn-helper, which pnpm installs without the execute bit ("posix_spawnp failed"). */
function runnableHelper(dir: string) {
  const helper = join(dir.replace("app.asar", "app.asar.unpacked"), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper")
  try {
    accessSync(helper, constants.X_OK)
  } catch {
    try {
      chmodSync(helper, 0o755)
    } catch {}
  }
}

/** $SHELL as a login shell (bash if unset), PowerShell on Windows (cmd.exe if missing). */
export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const root = process.env.SystemRoot || "C:\\Windows"
    const ps = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if (existsSync(ps)) return { file: ps, args: ["-NoLogo"] }
    return { file: process.env.ComSpec || "cmd.exe", args: [] }
  }
  const sh = process.env.SHELL
  if (sh && existsSync(sh)) return { file: sh, args: ["-l"] }
  for (const f of ["/bin/zsh", "/bin/bash", "/usr/bin/bash"]) if (existsSync(f)) return { file: f, args: ["-l"] }
  return { file: "/bin/sh", args: [] }
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : lo)

/** Starts a shell; `run` is typed into it once it's up (a CLI's sign-in). */
export async function open(cols: number, rows: number, run?: string): Promise<TerminalSession> {
  const { spawn } = nodePty()
  const shell = defaultShell()
  const env = await childEnv()
  env.TERM = "xterm-256color"
  env.COLORTERM = "truecolor"
  env.TERM_PROGRAM = "AxeAI"
  const p = spawn(shell.file, shell.args, { name: "xterm-256color", cols: clamp(cols, 2, 500), rows: clamp(rows, 2, 300), cwd: homedir(), env })
  const id = randomUUID()
  const title = basename(shell.file).replace(/\.exe$/i, "")
  const s: Session = { id, title, pty: p, output: "", pending: "" }
  sessions.set(id, s)
  // Output goes to the window in small batches, not one message per byte.
  p.onData((data) => {
    s.output = (s.output + data).slice(-KEEP)
    s.pending += data
    s.timer ??= setTimeout(() => {
      s.timer = undefined
      const chunk = s.pending
      s.pending = ""
      emit("terminal", { id, data: chunk })
    }, 8)
  })
  p.onExit(({ exitCode }) => {
    if (s.timer) clearTimeout(s.timer)
    if (s.pending) emit("terminal", { id, data: s.pending })
    sessions.delete(id)
    emit("terminalExit", { id, code: exitCode })
  })
  if (run) p.write(`${run}\r`)
  return { id, title }
}

export const list = () => [...sessions.values()].map((s) => ({ id: s.id, title: s.title, output: s.output }))

export function write(id: string, data: string) {
  sessions.get(id)?.pty.write(data)
}

/** Types a command line into a running shell, as if you typed it and pressed Return. */
export function type(id: string, line: string) {
  const s = sessions.get(id)
  if (!s) throw new Error("That terminal has ended.")
  s.pty.write(`${line}\r`)
}

export function resize(id: string, cols: number, rows: number) {
  try {
    sessions.get(id)?.pty.resize(clamp(cols, 2, 500), clamp(rows, 2, 300))
  } catch {}
}

export function close(id: string) {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  if (s.timer) clearTimeout(s.timer)
  try {
    s.pty.kill()
  } catch {}
}

export function closeAll() {
  for (const id of [...sessions.keys()]) close(id)
}
