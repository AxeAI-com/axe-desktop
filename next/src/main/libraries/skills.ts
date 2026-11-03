import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import type { Skill, SkillLibrary, SkillTarget } from "@shared/types"

import { frontMatter } from "../agents/commands"
import { dataPath, isSelfTest } from "../paths"
import { STARTER_SKILLS } from "@shared/starter-skills"

// The skills library: Axe's starter skills and yours, each a folder with a SKILL.md (the open Agent
// Skills format). Installing copies the folder into Axe's own skills folder (so Axe models can use it
// from the / menu) and into the CLIs' skill folders you pick (~/.claude/skills and the rest), where
// Claude Code, Codex and Gemini CLI find it themselves. We only ever remove folders we wrote.

const TARGETS: { id: SkillTarget["id"]; name: string; home: string; rel: string }[] = [
  { id: "claude", name: "Claude Code", home: ".claude", rel: ".claude/skills" },
  { id: "codex", name: "Codex", home: ".codex", rel: ".codex/skills" },
  { id: "gemini", name: "Gemini CLI", home: ".gemini", rel: ".gemini/skills" },
  { id: "agents", name: "Other CLIs", home: ".agents", rel: ".agents/skills" },
]

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

/** "Brand voice!" → "brand-voice". */
export function skillId(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "")
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )
const read = (p: string) => readFile(p, "utf8").catch(() => "")

export class SkillStore {
  constructor(
    // Self-tests keep their CLI folders in a temporary home, never yours.
    private readonly home: () => string = () => (isSelfTest() && process.env.AXE_SKILLS_HOME) || homedir(),
    private readonly axeDir: () => string = () => dataPath("skills"),
  ) {}

  /** Axe always; a CLI only when its folder is in your home (it's installed or was). */
  async targets(): Promise<SkillTarget[]> {
    const out: SkillTarget[] = [{ id: "axe", name: "Axe", path: this.axeDir() }]
    for (const t of TARGETS) if (await exists(join(this.home(), t.home))) out.push({ id: t.id, name: t.name, path: join(this.home(), t.rel) })
    return out
  }

  private dirOf(target: SkillTarget["id"]): string {
    if (target === "axe") return this.axeDir()
    const t = TARGETS.find((x) => x.id === target)
    if (!t) throw new Error("That isn't a place skills can go.")
    return join(this.home(), t.rel)
  }

  async library(): Promise<SkillLibrary> {
    const targets = await this.targets()
    const found = new Map<string, Skill>()
    for (const s of STARTER_SKILLS) {
      const fm = frontMatter(s.text)
      found.set(s.id, { id: s.id, name: fm.name || s.id, description: fm.description ?? "", source: "starter", category: s.category, installedIn: [] })
    }
    for (const t of targets) {
      for (const id of await folders(t.path)) {
        const text = await read(join(t.path, id, "SKILL.md"))
        if (!text) continue
        let s = found.get(id)
        if (!s) {
          const fm = frontMatter(text)
          s = { id, name: fm.name || id, description: fm.description ?? "", source: t.id === "axe" ? "yours" : "cli", installedIn: [] }
          found.set(id, s)
        } else if (s.source === "cli" && t.id === "axe") s.source = "yours"
        s.installedIn.push(t.id)
      }
    }
    const order = { starter: 0, yours: 1, cli: 2 }
    return { skills: [...found.values()].sort((a, b) => order[a.source] - order[b.source]), targets }
  }

  /** The SKILL.md text: Axe's copy first, then a starter, then any CLI's. */
  async text(id: string): Promise<string> {
    if (!ID.test(id)) throw new Error("That isn't a skill.")
    const mine = await read(join(this.axeDir(), id, "SKILL.md"))
    if (mine) return mine
    const starter = STARTER_SKILLS.find((s) => s.id === id)
    if (starter) return starter.text
    for (const t of await this.targets()) {
      const text = await read(join(t.path, id, "SKILL.md"))
      if (text) return text
    }
    throw new Error("That skill isn't here anymore.")
  }

  /** Installed in Axe (so an Axe model can use it from /). */
  async installed(id: string): Promise<boolean> {
    return ID.test(id) && exists(join(this.axeDir(), id, "SKILL.md"))
  }

  /** The folder to copy from: Axe's copy, a CLI's copy, or a starter written out fresh. */
  private async source(id: string): Promise<string | { text: string }> {
    if (await exists(join(this.axeDir(), id, "SKILL.md"))) return join(this.axeDir(), id)
    const starter = STARTER_SKILLS.find((s) => s.id === id)
    if (starter) return { text: starter.text }
    for (const t of await this.targets()) if (await exists(join(t.path, id, "SKILL.md"))) return join(t.path, id)
    throw new Error("That skill isn't here anymore.")
  }

  async install(id: string, targets: string[]): Promise<SkillLibrary> {
    if (!ID.test(id)) throw new Error("That isn't a skill.")
    const want = new Set<SkillTarget["id"]>(["axe", ...(targets as SkillTarget["id"][])])
    const from = await this.source(id)
    const ours = typeof from === "string" ? await read(join(from, "SKILL.md")) : from.text
    for (const target of want) {
      const dir = join(this.dirOf(target), id)
      if (typeof from === "string" && from === dir) continue
      const there = await read(join(dir, "SKILL.md"))
      if (there === ours) continue
      // Someone else's skill by the same name: leave it alone.
      if (there || (await exists(dir))) {
        const name = target === "axe" ? "Axe" : (TARGETS.find((t) => t.id === target)?.name ?? target)
        throw new Error(`${name} already has a different skill called ${id}. Rename one of them first.`)
      }
      await mkdir(this.dirOf(target), { recursive: true })
      if (typeof from === "string") await cp(from, dir, { recursive: true, errorOnExist: true, force: false })
      else {
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, "SKILL.md"), from.text, "utf8")
      }
    }
    return this.library()
  }

  /** Removes Axe's copy and every CLI copy that is the same text (ones we put there). */
  async uninstall(id: string): Promise<SkillLibrary> {
    if (!ID.test(id)) throw new Error("That isn't a skill.")
    const ours = await read(join(this.axeDir(), id, "SKILL.md"))
    const starter = STARTER_SKILLS.find((s) => s.id === id)?.text
    for (const t of await this.targets()) {
      const dir = join(t.path, id)
      const text = await read(join(dir, "SKILL.md"))
      if (!text) continue
      if (t.id === "axe" || text === ours || text === starter) await rm(dir, { recursive: true, force: true })
    }
    return this.library()
  }

  async create(skill: { name: string; description: string; body: string }): Promise<SkillLibrary> {
    const id = skillId(skill.name)
    if (!id) throw new Error("Give the skill a name.")
    const description = skill.description.replace(/\s+/g, " ").trim()
    if (!description) throw new Error("Say in one line when to use it.")
    if (description.length > 1024) throw new Error("Keep the description under 1,024 characters.")
    const body = skill.body.trim()
    if (!body) throw new Error("Write what it should do.")
    const dir = join(this.axeDir(), id)
    if ((await exists(dir)) || STARTER_SKILLS.some((s) => s.id === id)) throw new Error(`There's already a skill called ${id}.`)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: ${description}\n---\n\n${body}\n`, "utf8")
    return this.library()
  }

  /** Copies a skill folder (one with a SKILL.md) into Axe. */
  async importFolder(folder: string): Promise<SkillLibrary> {
    const text = await read(join(folder, "SKILL.md"))
    if (!text) throw new Error("That folder has no SKILL.md.")
    const id = skillId(frontMatter(text).name || basename(folder))
    if (!id) throw new Error("That skill has no name.")
    const dir = join(this.axeDir(), id)
    if (await exists(dir)) throw new Error(`There's already a skill called ${id}.`)
    await mkdir(this.axeDir(), { recursive: true })
    await cp(folder, dir, { recursive: true, errorOnExist: true, force: false })
    return this.library()
  }
}

async function folders(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && ID.test(d.name))
      .map((d) => d.name)
      .sort()
  } catch {
    return []
  }
}

/** The instructions of a SKILL.md, without its front matter. */
export const skillBody = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()

/** The block an Axe model gets when you pick a skill from / (stripped again when the chat shows it). */
export function skillBlock(id: string, text: string): string {
  return `The user picked the skill "${id}". Follow its instructions for this message:\n\n${skillBody(text)}`
}

/** "/brand-voice rewrite this" → { id: "brand-voice", rest: "rewrite this" }. */
export function slashSkill(text: string): { id: string; rest: string } | null {
  const m = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/.exec(text.trim())
  return m ? { id: m[1]!, rest: (m[2] ?? "").trim() } : null
}
