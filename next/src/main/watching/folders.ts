import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { listLocal } from "../agents/store"
import type { CheckDeps } from "./checks/deps"
import { expand } from "./checks/repo"

// Where code lives on this Mac, for "Which folder has the code?" and the Repo starter's menu: the
// folders of recent agent chats, newest first, with what each one is and when it last changed.

/** Folders of recent agent chats, newest first, written with ~ for home. */
export function recentFolders(limit = 8): string[] {
  const home = homedir()
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...listLocal()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))) {
    if (t.source !== "agent" || !t.cwd || t.copy) continue
    const short = t.cwd.startsWith(`${home}/`) ? `~/${t.cwd.slice(home.length + 1)}` : t.cwd
    if (seen.has(short) || !existsSync(t.cwd)) continue
    seen.add(short)
    out.push(short)
    if (out.length >= limit) break
  }
  return out
}

/** "Node app", "Shopify theme": what a folder holds, from the files at its top. */
export function folderKind(dir: string): string {
  const has = (f: string) => existsSync(join(dir, f))
  if (has("layout/theme.liquid") || has("config/settings_schema.json")) return "Shopify theme"
  if (has("wp-config.php") || has("style.css") && has("functions.php")) return "WordPress site"
  if (has("next.config.js") || has("next.config.mjs") || has("next.config.ts")) return "Next.js app"
  if (has("package.json")) return "Node app"
  if (has("pyproject.toml") || has("requirements.txt")) return "Python app"
  if (has("Gemfile")) return "Ruby app"
  if (has("go.mod")) return "Go app"
  if (has("Cargo.toml")) return "Rust app"
  if (has("index.html")) return "Website"
  return "Folder"
}

function changedWords(dir: string, now: number): string {
  let t = 0
  for (const f of [".git/index", ".git/HEAD", "."]) {
    try {
      t = Math.max(t, statSync(join(dir, f)).mtimeMs)
    } catch {}
  }
  if (!t) return ""
  const day = (x: number) => new Date(x).toDateString()
  if (day(t) === day(now)) return "changed today"
  if (day(t) === day(now - 86_400_000)) return "changed yesterday"
  return `changed ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}

/** How well a folder matches a watch's target: its git remote or package name names the domain or repo. */
async function score(dir: string, target: string, d: CheckDeps): Promise<number> {
  const stem = target.replace(/^www\./, "").split(/[./]/).filter((x) => x && !/^(com|net|org|io|co|app|dev|shop|store)$/.test(x))
  const words = stem.map((x) => x.toLowerCase())
  const remote = (await d.exec("git", ["remote", "get-url", "origin"], { cwd: dir, timeoutMs: 3_000 })).stdout.toLowerCase()
  let name = ""
  try {
    name = String((JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string }).name ?? "").toLowerCase()
  } catch {}
  const base = dir.split("/").pop()?.toLowerCase() ?? ""
  let s = 0
  for (const w of words) {
    if (remote.includes(w)) s += 3
    if (name.includes(w)) s += 2
    if (base.includes(w)) s += 1
  }
  return s
}

/** Suggestions for one watch: best match first, then newest. */
export async function folderSuggestions(target: string, d: CheckDeps, now = Date.now()): Promise<{ path: string; about: string }[]> {
  const list = recentFolders()
  const scored = await Promise.all(list.map(async (p, i) => ({ p, i, s: await score(expand(p), target, d) })))
  scored.sort((a, b) => b.s - a.s || a.i - b.i)
  return scored.slice(0, 4).map(({ p }) => ({ path: p, about: [folderKind(expand(p)), changedWords(expand(p), now)].filter(Boolean).join(", ") }))
}

/** Your GitHub repos, newest first, when gh is installed and signed in. */
export async function githubRepos(d: CheckDeps): Promise<string[]> {
  const r = await d.exec("gh", ["repo", "list", "--limit", "30", "--json", "nameWithOwner", "--jq", ".[].nameWithOwner"], { cwd: homedir(), timeoutMs: 15_000 })
  return r.code === 0 ? r.stdout.split("\n").map((x) => x.trim()).filter(Boolean) : []
}
