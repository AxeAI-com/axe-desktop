import { execFile } from "node:child_process"
import { accessSync, constants, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"

// Apps opened from the Dock, Start menu or a desktop launcher don't get the PATH
// from the user's shell profile, so npx and agent CLIs go missing. Like
// ShellEnvironment.swift: ask the login shell once, add common install folders,
// and keep the app's own PATH last. Windows already passes the user's PATH.

let cached: Promise<string> | undefined

function loginShellPath(): Promise<string | undefined> {
  if (process.platform === "win32") return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh"
    execFile(shell, ["-ilc", 'printf "__PATH__%s__END__" "$PATH"'], { timeout: 4000, env: process.env }, (err, stdout) => {
      const m = /__PATH__(.*)__END__/s.exec(stdout ?? "")
      resolve(!err && m?.[1] ? m[1] : undefined)
    })
  })
}

function extraDirs(): string[] {
  const home = homedir()
  if (process.platform === "win32") {
    const appData = process.env.APPDATA
    return [appData ? join(appData, "npm") : "", process.env.ProgramFiles ? join(process.env.ProgramFiles, "nodejs") : ""].filter(Boolean)
  }
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin", join(home, ".local/bin"), join(home, ".bun/bin"), join(home, ".cargo/bin"), join(home, ".volta/bin")]
  // nvm keeps node per version; newest first.
  try {
    const versions = readdirSync(join(home, ".nvm/versions/node")).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    dirs.push(...versions.map((v) => join(home, ".nvm/versions/node", v, "bin")))
  } catch {}
  return dirs
}

export function mergePaths(...lists: (string | undefined)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists)
    for (const dir of (list ?? "").split(delimiter))
      if (dir && !seen.has(dir)) {
        seen.add(dir)
        out.push(dir)
      }
  return out.join(delimiter)
}

/** The PATH programs started for the user should see. */
export function loginPath(): Promise<string> {
  cached ??= loginShellPath().then((shellPath) => mergePaths(shellPath, extraDirs().join(delimiter), process.env.PATH))
  return cached
}

/** Finds an executable on a PATH (PATHEXT on Windows). */
export function whichIn(tool: string, path: string): string | undefined {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""]
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, tool + ext)
      try {
        if (!statSync(candidate).isFile()) continue
        if (process.platform !== "win32") accessSync(candidate, constants.X_OK)
        return candidate
      } catch {}
    }
  }
  return undefined
}

export async function which(tool: string): Promise<string | undefined> {
  return whichIn(tool, await loginPath())
}

/** Environment for programs the engine starts (agents): the login PATH, without
 * what Electron or an AppImage launcher set for the app itself. */
export async function childEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  if (process.env.APPIMAGE) for (const k of ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "LD_LIBRARY_PATH"]) delete env[k]
  for (const k of Object.keys(env)) if (k.startsWith("ELECTRON_") || k === "NODE_OPTIONS") delete env[k]
  // Never hand the engine's own test hooks or session to a CLI.
  for (const k of Object.keys(env)) if (k.startsWith("AXE_")) delete env[k]
  const path = await loginPath()
  if (process.platform === "win32") for (const k of Object.keys(env)) if (k.toUpperCase() === "PATH") delete env[k]
  env.PATH = path
  return env
}
