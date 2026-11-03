import { execFile } from "node:child_process"
import { cp, lstat, readdir, realpath, rm } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { promisify } from "node:util"

import type { FolderCopy } from "@shared/types"

import { dataPath } from "../paths"

// Several agents at once: a new agent chat can work in its own copy of the folder, so
// two never edit the same files. In a git repo that is a worktree on a new branch
// (cheap, and the work can be merged back); anywhere else, a plain copy. Copies live
// in the data folder (userData/copies/), never next to your own files.

const run = promisify(execFile)

const git = (cwd: string, args: string[]) => run("git", ["-C", cwd, ...args], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })

/** Folders a plain copy leaves out: they are rebuilt, not written. */
const SKIP = new Set(["node_modules", ".DS_Store", ".next", ".turbo", "dist", "out", ".venv", "__pycache__"])
const MAX_FILES = 20_000
const MAX_BYTES = 1024 * 1024 * 1024

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "chat"

async function repoRoot(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await git(cwd, ["rev-parse", "--show-toplevel"])
    const root = stdout.trim()
    // A repo with no commits has nothing to branch from.
    await git(root, ["rev-parse", "--verify", "HEAD"])
    return root
  } catch {
    return undefined
  }
}

/** Counts what a plain copy would take, and refuses a folder too big to copy. */
async function measure(dir: string, seen = { files: 0, bytes: 0 }): Promise<typeof seen> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await measure(path, seen)
    else {
      seen.files++
      seen.bytes += (await lstat(path).catch(() => ({ size: 0 }))).size
    }
    if (seen.files > MAX_FILES || seen.bytes > MAX_BYTES) throw new Error("That folder is too big to copy. Work in it directly, or make it a git repo so it can get a worktree.")
  }
  return seen
}

/** Makes the copy a new chat works in. `id` names it (unique per chat). */
export async function makeCopy(cwd: string, id: string, title: string): Promise<{ cwd: string; copy: FolderCopy }> {
  const short = id.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase()
  const dest = dataPath("copies", `${slug(basename(cwd))}-${short}`)
  const root = await repoRoot(cwd)
  if (root) {
    const branch = `axe/${slug(title)}-${short}`
    await git(root, ["worktree", "add", "-b", branch, dest, "HEAD"]).catch((e: Error & { stderr?: string }) => {
      throw new Error(`Couldn't make a worktree: ${(e.stderr || e.message).trim().split("\n").pop()}`)
    })
    // git names the root by its real path; so must the folder (on a Mac /var is /private/var).
    const rel = relative(root, await realpath(cwd).catch(() => cwd))
    return { cwd: rel && !rel.startsWith("..") ? join(dest, rel) : dest, copy: { kind: "worktree", source: cwd, branch } }
  }
  await measure(cwd)
  await cp(cwd, dest, { recursive: true, filter: (src) => !SKIP.has(basename(src)), verbatimSymlinks: true })
  return { cwd: dest, copy: { kind: "copy", source: cwd } }
}

/**
 * The chat is deleted: a worktree with nothing in it (no changes, no new commits) goes too,
 * with its branch. Anything with work in it stays where it is.
 */
export async function removeCopyIfEmpty(cwd: string, copy: FolderCopy): Promise<boolean> {
  if (copy.kind !== "worktree" || !copy.branch) return false
  try {
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim()
    if ((await git(root, ["status", "--porcelain"])).stdout.trim()) return false
    const source = (await git(copy.source, ["rev-parse", "--show-toplevel"])).stdout.trim()
    const ahead = (await git(source, ["rev-list", "--count", `HEAD..${copy.branch}`])).stdout.trim()
    if (ahead !== "0") return false
    await git(source, ["worktree", "remove", root])
    await git(source, ["branch", "-D", copy.branch])
    return true
  } catch {
    return false
  }
}

/** Tests only: a throwaway folder's copies. */
export async function removeCopiesForTests() {
  await rm(dataPath("copies"), { recursive: true, force: true })
}
