import { type Dirent, existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import { expandHome, PROTECTED } from "./guard"

// Files for Do it: read, write, edit, list and search. Plain Node, so unit tests run it on a temp folder.
// Relative paths are inside the workspace folder. Search never walks into the protected folders
// (Desktop, Documents, Downloads, Library) unless the search starts inside one.

const MAX_READ = 200_000
const SKIP = new Set(["node_modules", ".git", ".Trash", ".cache", "Library", "AppData", ".npm", ".pnpm-store", "dist", "out", "build"])

export const resolvePath = (path: string, workspace: string) => {
  const p = expandHome(path.trim())
  return isAbsolute(p) ? resolve(p) : resolve(workspace, p)
}

export async function readText(path: string): Promise<string> {
  const info = await stat(path).catch(() => undefined)
  if (!info) throw new Error(`There's no file at ${path}.`)
  if (info.isDirectory()) throw new Error(`${path} is a folder. Use list_folder.`)
  const buf = await readFile(path)
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${path} isn't a text file.`)
  const text = buf.toString("utf8")
  return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n…(cut: the file is ${text.length} characters)` : text
}

/** Writes a file (making its folder). Returns what was there before, for the diff. */
export async function writeText(path: string, content: string): Promise<{ before?: string }> {
  const before = existsSync(path) ? await readFile(path, "utf8").catch(() => undefined) : undefined
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  return { before }
}

export async function editText(path: string, oldText: string, newText: string): Promise<{ before: string; after: string }> {
  const before = await readFile(path, "utf8").catch(() => {
    throw new Error(`There's no file at ${path}.`)
  })
  if (!oldText) throw new Error("old_text is empty.")
  const at = before.indexOf(oldText)
  if (at < 0) throw new Error("old_text isn't in the file. Read it again and copy the text exactly.")
  if (before.indexOf(oldText, at + 1) >= 0) throw new Error("old_text appears more than once. Include more of the lines around it.")
  const after = before.slice(0, at) + newText + before.slice(at + oldText.length)
  await writeFile(path, after)
  return { before, after }
}

export async function deleteFile(path: string) {
  const info = await stat(path).catch(() => undefined)
  if (!info) throw new Error(`There's no file at ${path}.`)
  if (info.isDirectory()) throw new Error(`${path} is a folder; Axe only deletes files.`)
  await rm(path)
}

export async function listFolder(path: string): Promise<string> {
  const items = await readdir(path, { withFileTypes: true }).catch(() => {
    throw new Error(`There's no folder at ${path}.`)
  })
  if (!items.length) return "(empty)"
  const lines = items
    .filter((d) => !d.name.startsWith(".DS_Store"))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 400)
    .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
  return lines.join("\n") + (items.length > 400 ? `\n…and ${items.length - 400} more` : "")
}

/** Files whose name contains every word of the query, best first. Stops after a few seconds or 20 000 folders. */
export async function searchFiles(query: string, root: string, limit = 30, home = homedir()): Promise<string[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) throw new Error("Search for at least one word.")
  const startedInProtected = PROTECTED.some((f) => {
    const rel = relative(join(home, f), root)
    return !rel.startsWith("..") && !isAbsolute(rel)
  })
  const hits: { path: string; score: number }[] = []
  const queue = [root]
  const until = Date.now() + 4000
  let folders = 0
  while (queue.length && folders < 20_000 && Date.now() < until) {
    const dir = queue.shift()!
    folders++
    let items: Dirent[]
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of items) {
      const full = join(dir, d.name)
      if (d.isDirectory()) {
        if (SKIP.has(d.name) || d.name.startsWith(".")) continue
        if (!startedInProtected && dir === home && (PROTECTED as readonly string[]).includes(d.name)) continue
        queue.push(full)
      }
      const name = d.name.toLowerCase()
      if (words.every((w) => name.includes(w))) hits.push({ path: d.isDirectory() ? `${full}/` : full, score: (name.startsWith(words[0]!) ? 0 : 1) + full.length / 1000 })
    }
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.path)
}
