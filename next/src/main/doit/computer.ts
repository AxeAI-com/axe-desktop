import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { app, desktopCapturer, screen, shell, systemPreferences } from "electron"

import { execCommand, filterApps, matchApp, parseDesktopEntry, splitCommandLine } from "./app-match"
import { type CursorAction, cursorDoing, moveCursor, tapCursor } from "./cursor"
import type { Computer } from "./toolbox"

// Computer use: the apps on this computer and, on the Mac, reading and pressing inside them through
// Accessibility (the axe-hands helper, native/hands/main.swift). Windows and Linux list and open
// apps and take screenshots, as the old app does. Permissions are asked the first time a step needs
// them, never at launch: Accessibility on the first read_screen, Screen Recording on the first screenshot.

type Installed = { id: string; name: string; kind: "desktop" | "lnk" | "mac"; path: string; exec?: string }

let cache: { at: number; apps: Installed[] } | undefined

export function installedApps(): Installed[] {
  if (cache && Date.now() - cache.at < 60_000) return cache.apps
  let apps: Installed[] = []
  try {
    apps = process.platform === "win32" ? scanWindows() : process.platform === "darwin" ? scanMac() : scanLinux()
  } catch {}
  const byName = new Map<string, Installed>()
  for (const a of apps) if (!byName.has(a.name.toLowerCase())) byName.set(a.name.toLowerCase(), a)
  apps = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  cache = { at: Date.now(), apps }
  return apps
}

async function openApp(query: string, url?: string): Promise<string> {
  const apps = installedApps()
  const a = matchApp(apps, query)
  if (!a) {
    const near = filterApps(apps, query, 3).map((x) => x.name)
    throw new Error(`No app called “${query}” is installed.${near.length ? ` Did you mean ${near.join(", ")}?` : ""}`)
  }
  const target = url ? (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/") ? url : `https://${url}`) : undefined
  const args = target ? [target] : []
  if (a.kind === "lnk") {
    if (!target) {
      const err = await shell.openPath(a.path)
      if (err) throw new Error(err)
    } else {
      const link = shell.readShortcutLink(a.path)
      await launch(link.target, [...splitCommandLine(link.args ?? "", false), ...args], link.cwd || undefined)
    }
  } else if (a.kind === "mac") {
    await launch("open", ["-a", a.path, ...args])
  } else if (a.exec) {
    const [cmd, ...rest] = execCommand(a.exec, args)
    if (!cmd) throw new Error(`${a.name} has no command to start it.`)
    await launch(cmd, rest)
  } else {
    await launch("gtk-launch", [a.id.replace(/\.desktop$/, ""), ...args])
  }
  return `Opened ${a.name}${target ? ` with ${target}` : ""}.`
}

/** Starts a program on its own, so it outlives Axe. */
function launch(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", cwd: cwd ?? homedir() })
    child.once("error", (e) => reject(new Error(`Couldn't start it: ${e.message}`)))
    child.once("spawn", () => {
      child.unref()
      // `open` waits for the app to launch; give it a moment so a read right after finds a window.
      setTimeout(resolve, process.platform === "darwin" ? 800 : 0)
    })
  })
}

function scanWindows(): Installed[] {
  const roots = [process.env.ProgramData, process.env.APPDATA].filter((r): r is string => !!r).map((r) => join(r, "Microsoft", "Windows", "Start Menu", "Programs"))
  const skip = /uninstall|uninst|readme|read me|help|documentation|release notes|website|license|manual/i
  const out: Installed[] = []
  const walk = (dir: string, depth: number) => {
    for (const item of list(dir)) {
      const path = join(dir, item)
      if (item.toLowerCase().endsWith(".lnk")) {
        const name = item.slice(0, -4)
        if (!skip.test(name)) out.push({ id: path.toLowerCase(), name, kind: "lnk", path })
      } else if (depth < 3 && isDir(path)) walk(path, depth + 1)
    }
  }
  for (const r of roots) walk(r, 0)
  return out
}

function scanLinux(): Installed[] {
  const home = homedir()
  const user = process.env.XDG_DATA_HOME || join(home, ".local/share")
  const xdg = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean)
  const dirs = [...new Set([user, join(user, "flatpak/exports/share"), "/var/lib/flatpak/exports/share", ...xdg])].map((d) => join(d, "applications"))
  dirs.push("/var/lib/snapd/desktop/applications")
  const seen = new Set<string>()
  const out: Installed[] = []
  const read = (dir: string, prefix: string, depth: number) => {
    for (const item of list(dir)) {
      const path = join(dir, item)
      if (item.endsWith(".desktop")) {
        const id = prefix + item
        if (seen.has(id)) continue
        seen.add(id)
        try {
          const e = parseDesktopEntry(readFileSync(path, "utf8"))
          if (e) out.push({ id, name: e.name, kind: "desktop", path, exec: e.exec })
        } catch {}
      } else if (depth < 2 && isDir(path)) read(path, `${prefix}${item}-`, depth + 1)
    }
  }
  for (const d of dirs) read(d, "", 0)
  return out
}

function scanMac(): Installed[] {
  const out: Installed[] = []
  for (const dir of ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", join(homedir(), "Applications")]) {
    for (const item of list(dir)) if (item.endsWith(".app")) out.push({ id: join(dir, item), name: item.slice(0, -4), kind: "mac", path: join(dir, item) })
  }
  return out
}

const list = (dir: string) => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Axe's cursor glides to the middle of the element it's about to use (when the app says where it is). */
async function pointAt(element: number, action: CursorAction) {
  const f = await hands.call<{ x: number; y: number; width: number; height: number } | null>("frame", { element }).catch(() => null)
  if (f && f.width > 0 && f.height > 0) await moveCursor(f.x + f.width / 2, f.y + f.height / 2, action)
}

// The Mac's hands: one helper process, started on first use.

class HandsClient {
  private child?: ChildProcess
  private next = 1
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ""

  private path(): string | undefined {
    const candidates = [join(process.resourcesPath ?? "", "axe-hands"), join(app.getAppPath(), "resources", "axe-hands")]
    return candidates.find((p) => existsSync(p))
  }

  private start(): ChildProcess {
    if (this.child && this.child.exitCode === null) return this.child
    const file = this.path()
    if (!file) throw new Error("Using other apps isn't part of this build.")
    const child = spawn(file, [], { stdio: ["pipe", "pipe", "ignore"] })
    child.stdout!.setEncoding("utf8")
    child.stdout!.on("data", (d: string) => {
      this.buffer += d
      let nl: number
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl)
        this.buffer = this.buffer.slice(nl + 1)
        try {
          const r = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string }
          const w = this.waiting.get(r.id)
          this.waiting.delete(r.id)
          if (r.ok) w?.resolve(r.result)
          else w?.reject(new Error(r.error ?? "It didn't work."))
        } catch {}
      }
    })
    child.on("exit", () => {
      for (const w of this.waiting.values()) w.reject(new Error("The helper for other apps stopped. Try again."))
      this.waiting.clear()
      this.child = undefined
    })
    this.child = child
    return child
  }

  async call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const child = this.start()
    const id = this.next++
    const reply = new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error("The app didn't answer in time."))
      }, 15_000)
    })
    child.stdin!.write(`${JSON.stringify({ id, cmd, ...args })}\n`)
    try {
      return await reply
    } catch (e) {
      if ((e as Error).message === "not_trusted") throw askForAccessibility()
      throw e
    }
  }

  stop() {
    this.child?.kill()
    this.child = undefined
  }
}

/** Whether Do it can use this computer without asking: Screen Recording and Accessibility on the Mac. Only
 * reads the state, so no system prompt shows. Windows and Linux need neither. Self-tests never use the screen. */
export function computerAccess(): boolean {
  if (process.env.AXE_HEADLESS) return false
  if (process.platform !== "darwin") return true
  return systemPreferences.getMediaAccessStatus("screen") === "granted" && systemPreferences.isTrustedAccessibilityClient(false)
}

/** Shows macOS's Accessibility prompt (not in self-tests) and explains what to do. */
function askForAccessibility(): Error {
  if (!process.env.AXE_HEADLESS) systemPreferences.isTrustedAccessibilityClient(true)
  return new Error(
    "Axe AI needs the Accessibility permission to use other apps. macOS just asked for it: turn on Axe AI in System Settings, Privacy & Security, Accessibility, then try again.",
  )
}

export const hands = new HandsClient()

const notOnThisOS = () => new Error(`Reading and pressing inside other apps works on the Mac for now. Here, use open_app, the browser, files and the terminal.`)

export const computer: Computer = {
  async listApps(query) {
    const apps = installedApps()
    const found = query ? filterApps(apps, query, 40) : apps
    if (!found.length) return query ? `No installed app matches “${query}”.` : "No apps found."
    return found.map((a) => a.name).join("\n")
  },
  openApp,
  async screenshot() {
    // Self-tests never look at the real screen; they screenshot Axe's own browser instead.
    if (process.env.AXE_HEADLESS) throw new Error("Screenshots of the screen are off in this run. Use target \"browser\".")
    cursorDoing("look")
    const { width, height } = screen.getPrimaryDisplay().size
    // On the Mac the first call shows the Screen Recording prompt.
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } })
    const shot = sources[0]?.thumbnail
    if (!shot || shot.isEmpty())
      throw new Error("Axe AI can't see the screen yet. Allow it in System Settings, Privacy & Security, Screen Recording, then try again.")
    return shot.toPNG()
  },
  async readScreen(appName) {
    if (process.platform !== "darwin") throw notOnThisOS()
    cursorDoing("look")
    return hands.call<string>("read", appName ? { app: appName } : {})
  },
  async click(element) {
    if (process.platform !== "darwin") throw notOnThisOS()
    await pointAt(element, "click")
    await hands.call("press", { element })
    tapCursor()
  },
  async typeText(text, element) {
    if (process.platform !== "darwin") throw notOnThisOS()
    if (element !== undefined) await pointAt(element, "type")
    else cursorDoing("type")
    try {
      await hands.call("type", element === undefined ? { text } : { text, element })
    } finally {
      cursorDoing()
    }
  },
  async pressKeys(keys) {
    if (process.platform !== "darwin") throw notOnThisOS()
    cursorDoing("type")
    try {
      await hands.call("keys", { keys })
    } finally {
      cursorDoing()
    }
  },
  async label(element) {
    if (process.platform !== "darwin") return { label: "", app: "" }
    return hands.call<{ label: string; app: string }>("label", { element }).catch(() => ({ label: "", app: "" }))
  },
  async lastApp() {
    if (process.platform !== "darwin") return ""
    return hands.call<string>("lastApp").catch(() => "")
  },
}
