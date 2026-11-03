import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

// What the composer's @ menu lists from this computer: folders (your recent ones, or the folders
// in a path you type) and the apps in the Applications folders. Nothing is read until you type @,
// and a folder is only listed when you typed its parent's path yourself.

export type FolderHit = { path: string; display: string }

const shown = (path: string, home: string) => (path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)

/** "~/Doc" → the folders in ~ that start with "Doc"; otherwise your recent folders that match. */
export async function folderHits(query: string, recent: string[], home = homedir()): Promise<FolderHit[]> {
  const typed = query.startsWith("~") ? home + query.slice(1) : query
  if (typed.startsWith("/")) {
    const dir = typed.endsWith("/") ? typed : dirname(typed)
    const start = typed.endsWith("/") ? "" : basename(typed).toLowerCase()
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name.toLowerCase().startsWith(start))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 20)
      .map((name) => {
        const path = join(dir, name)
        return { path, display: shown(path, home) }
      })
  }
  const q = query.toLowerCase()
  return [...new Set(recent)]
    .filter((p) => p.startsWith("/") && (!q || shown(p, home).toLowerCase().includes(q)))
    .slice(0, 8)
    .map((path) => ({ path, display: shown(path, home) }))
}

let apps: string[] | undefined

/** The apps on this Mac by name, read once. Empty elsewhere. */
export async function appNames(home = homedir()): Promise<string[]> {
  if (process.platform !== "darwin") return []
  if (apps) return apps
  const found = new Set<string>()
  const scan = async (dir: string, depth: number) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.endsWith(".app")) found.add(e.name.slice(0, -4))
      else if (depth > 0 && e.isDirectory() && !e.name.startsWith(".")) await scan(join(dir, e.name), depth - 1)
    }
  }
  for (const dir of ["/Applications", "/System/Applications", join(home, "Applications")]) await scan(dir, 1)
  apps = [...found].sort((a, b) => a.localeCompare(b))
  return apps
}
