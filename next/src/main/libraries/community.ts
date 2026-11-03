import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, normalize } from "node:path"

import { kindOfPlugin } from "@shared/community"
import type { CommunityAgent, CommunitySkill, Helper, SkillLibrary } from "@shared/types"

import { frontMatter } from "../agents/commands"
import { dataPath, readJSON, writeJSON } from "../paths"
import { saveHelper } from "./helpers"
import { skillId, type SkillStore } from "./skills"

// Open-source libraries on the Skills and Agents pages: obra/superpowers (skills, MIT), VoltAgent's
// awesome-agent-skills (an index of skills in other repos, MIT) and wshobson/agents (agents, MIT).
// Lists come from GitHub once a day and are cached in the data folder. Adding a skill downloads its
// folder and imports it like a folder from disk; adding an agent copies it into your agents.

const API = "https://api.github.com"
const RAW = "https://raw.githubusercontent.com"
const DAY = 24 * 60 * 60_000

export const SUPERPOWERS = "obra/superpowers"
export const VOLTAGENT = "VoltAgent/awesome-agent-skills"
export const WSHOBSON = "wshobson/agents"

type Fetch = typeof fetch

async function getText(f: Fetch, url: string): Promise<string> {
  const r = await f(url, { headers: { "User-Agent": "Axe-AI-desktop", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000) })
  if (r.status === 403 || r.status === 429) throw new Error("GitHub is limiting requests right now. Try again in a few minutes.")
  if (!r.ok) throw new Error(`GitHub answered ${r.status}.`)
  return r.text()
}

/** Every file path in a repo, from one GitHub API call. */
async function tree(f: Fetch, repo: string): Promise<string[]> {
  const j = JSON.parse(await getText(f, `${API}/repos/${repo}/git/trees/HEAD?recursive=1`)) as { tree?: { path: string; type: string }[] }
  return (j.tree ?? []).filter((t) => t.type === "blob").map((t) => t.path)
}

const raw = (f: Fetch, repo: string, path: string) => getText(f, `${RAW}/${repo}/HEAD/${path.split("/").map(encodeURIComponent).join("/")}`)

/** Runs at most `n` at a time. */
async function pool<T, R>(items: T[], n: number, run: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await run(items[k]!)
      }
    }),
  )
  return out
}

const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

/** The first sentence, for a card. */
export function firstSentence(s: string, max = 160): string {
  const t = oneLine(s)
  const m = /^(.+?[.!?])(\s|$)/.exec(t)
  const one = m ? m[1]! : t
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/** "ui-visual-validator" → "UI visual validator". */
export function humanName(id: string): string {
  const CAPS = new Set(["ui", "ux", "api", "sql", "seo", "ai", "ml", "llm", "ios", "aws", "gcp", "css", "html", "graphql", "devops", "tdd", "dx", "c4"])
  const words = id.split(/[-_\s]+/).filter(Boolean)
  return words.map((w, i) => (CAPS.has(w.toLowerCase()) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ")
}

// ---------- VoltAgent's index ----------

/** Where an index link points: a GitHub repo, maybe a folder in it, maybe a skill name to look for. */
export function resolveLink(url: string): { repo: string; path?: string; skill?: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  // officialskills.sh/<owner>/<repo>/<skill>
  if (u.hostname === "officialskills.sh" && parts.length >= 2) return { repo: `${parts[0]}/${parts[1]}`, ...(parts[2] ? { skill: parts[2] } : {}) }
  if (u.hostname !== "github.com" || parts.length < 2) return null
  const repo = `${parts[0]}/${parts[1]}`
  // github.com/<owner>/<repo>/(tree|blob)/<branch>/<path…>
  if ((parts[2] === "tree" || parts[2] === "blob") && parts.length > 4) {
    let path = parts.slice(4).join("/")
    if (/(^|\/)SKILL\.md$/i.test(path)) path = dirname(path) === "." ? "" : dirname(path)
    return path ? { repo, path } : { repo }
  }
  return { repo }
}

/** "- **[owner/name](url)** - what it does" lines, with the section they're under. */
export function parseIndex(readme: string): CommunitySkill[] {
  const out: CommunitySkill[] = []
  const seen = new Set<string>()
  let category: string | undefined
  for (const line of readme.split(/\r?\n/)) {
    const h = /^#{3,4}\s+(.+?)\s*$/.exec(line) ?? /<summary>\s*<h3[^>]*>(.+?)<\/h3>/.exec(line)
    if (h) {
      category = h[1]!.replace(/<[^>]+>/g, "").replace(/[*_`]/g, "").trim()
      continue
    }
    if (/^##\s/.test(line)) category = undefined
    const m = /^\s*[-*]\s+\*\*\[([^\]]+)\]\(([^)\s]+)\)\*\*\s*[-–—:]\s*(.+)$/.exec(line)
    if (!m) continue
    const [, label, url, about] = m as unknown as [string, string, string, string]
    const where = resolveLink(url)
    if (!where) continue
    const key = `voltagent/${label.trim()}`
    if (seen.has(key)) continue
    seen.add(key)
    const short = label.split("/").pop() ?? label
    out.push({
      key,
      name: humanName(short),
      description: oneLine(about),
      source: "voltagent",
      ...(category ? { category } : {}),
      repo: where.repo,
      ...(where.path ? { path: where.path } : {}),
      ...(where.skill ? { skill: where.skill } : {}),
      url,
    })
  }
  return out
}

/**
 * The folder of the skill an entry means: its own folder when the link named one, the folder whose
 * name matches the skill, or the repo's only skill. Null when a repo holds many and none is named.
 */
export function skillFolder(paths: string[], entry: Pick<CommunitySkill, "path" | "skill">): string | null {
  const dirs = paths.filter((p) => /(^|\/)SKILL\.md$/.test(p)).map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""))
  if (entry.path !== undefined) {
    const inside = dirs.filter((d) => d === entry.path || d.startsWith(`${entry.path}/`))
    if (inside.includes(entry.path)) return entry.path
    if (inside.length === 1) return inside[0]!
  }
  if (entry.skill) {
    const name = entry.skill.toLowerCase()
    const hit = dirs.filter((d) => d.split("/").pop()?.toLowerCase() === name)
    if (hit.length) return hit.sort((a, b) => a.length - b.length)[0]!
  }
  return dirs.length === 1 ? dirs[0]! : null
}

// ---------- wshobson/agents ----------

/** plugins/<plugin>/agents/<name>.md → the listing, from the file's front matter. */
export function agentEntry(path: string, text: string): CommunityAgent | null {
  const m = /^plugins\/([^/]+)\/agents\/([^/]+)\.md$/.exec(path)
  if (!m) return null
  const fm = frontMatter(text)
  const id = fm.name || m[2]!
  return {
    key: `wshobson/${m[1]}/${m[2]}`,
    name: humanName(id),
    description: firstSentence(fm.description ?? ""),
    plugin: m[1]!,
    path,
    url: `https://github.com/${WSHOBSON}/blob/HEAD/${path}`,
  }
}

const body = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()

// ---------- The libraries ----------

type Cache<T> = { at: number; items: T[] }

export class Community {
  constructor(
    private readonly skills: SkillStore,
    private readonly f: Fetch = (...a) => fetch(...a),
    private readonly now: () => number = Date.now,
  ) {}

  private cached<T>(name: string, fresh: boolean, load: () => Promise<T[]>): Promise<T[]> {
    const file = dataPath(`community-${name}.json`)
    const c = readJSON<Cache<T> | null>(file, null)
    if (!fresh && c && Array.isArray(c.items) && this.now() - c.at < DAY) return Promise.resolve(c.items)
    return load().then(
      (items) => {
        writeJSON(file, { at: this.now(), items })
        return items
      },
      // Offline or limited: yesterday's list beats an error.
      (e) => {
        if (c?.items?.length) return c.items
        throw e
      },
    )
  }

  async skillList(fresh = false): Promise<CommunitySkill[]> {
    const [powers, index] = await Promise.all([
      this.cached<CommunitySkill>("superpowers", fresh, async () => {
        const dirs = (await tree(this.f, SUPERPOWERS)).filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p))
        return pool(dirs, 8, async (p) => {
          const fm = frontMatter(await raw(this.f, SUPERPOWERS, p).catch(() => ""))
          const folder = p.slice(0, -"/SKILL.md".length)
          const id = folder.split("/").pop()!
          return {
            key: `superpowers/${id}`,
            name: humanName(fm.name || id),
            description: firstSentence(fm.description ?? "", 200),
            source: "superpowers" as const,
            repo: SUPERPOWERS,
            path: folder,
            url: `https://github.com/${SUPERPOWERS}/tree/HEAD/${folder}`,
          }
        })
      }).catch(() => [] as CommunitySkill[]),
      this.cached<CommunitySkill>("voltagent", fresh, async () => parseIndex(await raw(this.f, VOLTAGENT, "README.md"))).catch(() => [] as CommunitySkill[]),
    ])
    if (!powers.length && !index.length) throw new Error("Couldn't reach GitHub for the skill libraries. Check your connection.")
    return [...powers, ...index]
  }

  private async skill(key: string): Promise<CommunitySkill> {
    const s = (await this.skillList()).find((x) => x.key === key)
    if (!s) throw new Error("That skill isn't in the library anymore.")
    return s
  }

  /** The folder in its repo and the repo's files, found once per look. */
  private async locate(s: CommunitySkill): Promise<{ folder: string; files: string[] }> {
    const paths = await tree(this.f, s.repo)
    const folder = skillFolder(paths, s)
    if (folder === null) throw new Error("That repo has several skills and none is named here. Open it on GitHub to pick one.")
    const prefix = folder ? `${folder}/` : ""
    return { folder, files: paths.filter((p) => p.startsWith(prefix) && (folder || !p.includes("/") || p.startsWith("scripts/") || p.startsWith("references/") || p.startsWith("assets/"))) }
  }

  async skillText(key: string): Promise<string> {
    const s = await this.skill(key)
    if (s.path !== undefined && s.source === "superpowers") return raw(this.f, s.repo, `${s.path}/SKILL.md`)
    const { folder } = await this.locate(s)
    return raw(this.f, s.repo, folder ? `${folder}/SKILL.md` : "SKILL.md")
  }

  async installSkill(key: string, targets: string[]): Promise<SkillLibrary> {
    const s = await this.skill(key)
    const { folder, files } = await this.locate(s)
    if (files.length > 80) throw new Error("That skill is too big to add here. Open it on GitHub instead.")
    const tmp = await mkdtemp(join(dataPath("tmp"), "skill-")).catch(async () => {
      await mkdir(dataPath("tmp"), { recursive: true })
      return mkdtemp(join(dataPath("tmp"), "skill-"))
    })
    // Named like the skill, for a SKILL.md without a name of its own.
    const dir = join(tmp, skillId(basename(folder) || s.skill || s.name) || "skill")
    try {
      let size = 0
      await pool(files, 6, async (p) => {
        const rel = folder ? p.slice(folder.length + 1) : p
        const to = normalize(join(dir, rel))
        // Nothing lands outside the folder we made.
        if (!to.startsWith(`${dir}/`)) return
        const r = await this.f(`${RAW}/${s.repo}/HEAD/${p.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(30_000) })
        if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${rel}.`)
        const bytes = Buffer.from(await r.arrayBuffer())
        size += bytes.length
        if (size > 5_000_000) throw new Error("That skill is too big to add here. Open it on GitHub instead.")
        await mkdir(dirname(to), { recursive: true })
        await writeFile(to, bytes)
      })
      const before = new Set((await this.skills.library()).skills.map((x) => x.id))
      const lib = await this.skills.importFolder(dir)
      const added = lib.skills.find((x) => !before.has(x.id))
      return added && targets.length ? this.skills.install(added.id, targets) : lib
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }

  async agentList(fresh = false): Promise<CommunityAgent[]> {
    return this.cached<CommunityAgent>("wshobson", fresh, async () => {
      const files = (await tree(this.f, WSHOBSON)).filter((p) => /^plugins\/[^/]+\/agents\/[^/]+\.md$/.test(p))
      const all = await pool(files, 12, async (p) => agentEntry(p, await raw(this.f, WSHOBSON, p).catch(() => "")))
      // The same agent ships in several plugins: keep the first.
      const seen = new Set<string>()
      return all.filter((a): a is CommunityAgent => !!a && !seen.has(a.name) && !!seen.add(a.name))
    })
  }

  private async agent(key: string): Promise<CommunityAgent> {
    const a = (await this.agentList()).find((x) => x.key === key)
    if (!a) throw new Error("That agent isn't in the library anymore.")
    return a
  }

  async agentText(key: string): Promise<string> {
    return body(await raw(this.f, WSHOBSON, (await this.agent(key)).path))
  }

  async addAgent(key: string): Promise<Helper[]> {
    const a = await this.agent(key)
    const instructions = body(await raw(this.f, WSHOBSON, a.path))
    return saveHelper({ name: a.name, role: firstSentence(a.description, 120), instructions, kind: kindOfPlugin(a.plugin), skills: [], connectors: [], webSearch: false })
  }
}
