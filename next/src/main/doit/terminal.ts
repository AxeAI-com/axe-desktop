import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

// run_command: one shell command, its output streamed into the step as it comes. A plain child process
// (no pseudo-terminal), so it works on every OS with nothing native. Stopped with the reply, or after
// the timeout.

const KEEP = 60_000

export type CommandResult = { output: string; code: number | null; timedOut: boolean }

/** The shell commands run in; tools.ts tells the model its name. */
export const SHELL_NAME = process.platform === "win32" ? "Windows PowerShell" : "the user's shell (sh, bash or zsh)"

function shell(): { file: string; args: (command: string) => string[] } {
  // Windows: PowerShell, as the old Windows app used (cat, ls and friends work there), cmd.exe if it's missing.
  if (process.platform === "win32") {
    const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    if (existsSync(ps)) return { file: ps, args: (c) => ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", c] }
    return { file: process.env.ComSpec || "cmd.exe", args: (c) => ["/d", "/s", "/c", c] }
  }
  const sh = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : "/bin/sh"
  return { file: sh, args: (c) => ["-c", c] }
}

export function runCommand(
  command: string,
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutSeconds?: number; signal?: AbortSignal; onOutput?: (all: string) => void },
): Promise<CommandResult> {
  const { file, args } = shell()
  const timeout = Math.min(600, Math.max(1, options.timeoutSeconds ?? 120)) * 1000
  return new Promise((resolve, reject) => {
    if (!existsSync(options.cwd)) return reject(new Error(`The folder ${options.cwd} isn't there.`))
    const child = spawn(file, args(command), {
      cwd: options.cwd,
      env: { ...(options.env ?? process.env), TERM: "dumb", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    })
    let output = ""
    let timedOut = false
    const add = (d: Buffer) => {
      // Windows line endings read as plain new lines.
      output = (output + d.toString("utf8").replace(/\r\n/g, "\n")).slice(-KEEP)
      options.onOutput?.(output)
    }
    child.stdout.on("data", add)
    child.stderr.on("data", add)
    // The whole process group, so `npm test` and its children all stop.
    const kill = () => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM")
        else child.kill()
      } catch {}
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeout)
    const onAbort = () => kill()
    options.signal?.addEventListener("abort", onAbort, { once: true })
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(new Error(`Couldn't run it: ${e.message}`))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      resolve({ output, code, timedOut })
    })
  })
}

/** What the model reads back. */
export function commandReport(r: CommandResult): string {
  const tail = r.output.length > 8000 ? `…${r.output.slice(-8000)}` : r.output
  const how = r.timedOut ? "Stopped: it ran past the time limit." : r.code === 0 ? "Exit code 0." : `Exit code ${r.code ?? "unknown"}.`
  return `${tail.trim() || "(no output)"}\n\n${how}`
}
