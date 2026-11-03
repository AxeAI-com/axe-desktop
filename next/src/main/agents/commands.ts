import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import type { AvailableCommand } from "@agentclientprotocol/sdk"

import type { InstructionsFile, SlashCommand } from "@shared/types"

// A CLI's own / commands and skills for the composer's / menu, and its own
// instructions file (CLAUDE.md, AGENTS.md) for the chat's folder.
// Commands come from the agent itself (ACP available_commands_update) once a session
// is open; skills and command files on disk fill the menu before that.

/** ACP's advertised commands as menu lines. */
export function fromACP(commands: AvailableCommand[]): SlashCommand[] {
  const out: SlashCommand[] = []
  for (const c of commands) {
    const name = c.name.replace(/^\//, "").trim()
    if (!name || out.some((o) => o.name === name)) continue
    const hint = c.input && "hint" in c.input ? c.input.hint : undefined
    out.push({ name, description: oneLine(c.description), source: "agent", ...(hint ? { hint } : {}) })
  }
  return out
}

/** Where each CLI keeps skills and saved commands, in the project and in your home folder. */
function places(agentId: string): { skills: string[]; commands: string[] } {
  const id = agentId.toLowerCase()
  if (id.includes("claude")) return { skills: [".claude/skills"], commands: [".claude/commands"] }
  if (id.includes("codex")) return { skills: [".codex/skills", ".agents/skills"], commands: [".codex/prompts"] }
  if (id.includes("gemini")) return { skills: [".gemini/skills"], commands: [".gemini/commands"] }
  return { skills: [".agents/skills"], commands: [] }
}

/** YAML-ish front matter: just the flat `key: value` lines we need. */
export function frontMatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "").trim()
  }
  return out
}

const oneLine = (s: string | undefined, n = 120) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** The first line of prose after the front matter (for command files without a description). */
const firstLine = (text: string) =>
  text
    .replace(/^---[\s\S]*?---/, "")
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find(Boolean)

async function dirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name)
  } catch {
    return []
  }
}

async function files(path: string, ext: string): Promise<string[]> {
  try {
    return (await readdir(path)).filter((f) => f.endsWith(ext))
  } catch {
    return []
  }
}

const read = (path: string) => readFile(path, "utf8").catch(() => "")

/** Skills and saved commands on disk, the project's first. Never throws. */
export async function onDisk(agentId: string, cwd: string | undefined, home = homedir()): Promise<SlashCommand[]> {
  const { skills, commands } = places(agentId)
  const roots = [cwd, home].filter((r): r is string => !!r)
  const out: SlashCommand[] = []
  const add = (c: SlashCommand) => {
    if (c.name && !out.some((o) => o.name === c.name)) out.push(c)
  }
  for (const root of roots) {
    for (const rel of skills) {
      const base = join(root, rel)
      for (const name of (await dirs(base)).sort()) {
        const text = await read(join(base, name, "SKILL.md"))
        if (!text) continue
        const fm = frontMatter(text)
        add({ name: fm.name || name, description: oneLine(fm.description || firstLine(text)), source: "skill" })
      }
    }
    for (const rel of commands) {
      const base = join(root, rel)
      for (const file of (await files(base, ".md")).sort()) {
        const text = await read(join(base, file))
        const fm = frontMatter(text)
        const hint = fm["argument-hint"]
        add({ name: basename(file, ".md"), description: oneLine(fm.description || firstLine(text)), source: "skill", ...(hint ? { hint } : {}) })
      }
    }
  }
  return out.slice(0, 200)
}

/** The agent's own commands first, then skills it didn't already list. */
export function mergeCommands(agent: SlashCommand[], disk: SlashCommand[]): SlashCommand[] {
  return [...agent, ...disk.filter((d) => !agent.some((a) => a.name === d.name))]
}

// Instructions files

const NAMES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"] as const

/** The file this CLI reads first. */
export function instructionsName(agentId: string): (typeof NAMES)[number] {
  const id = agentId.toLowerCase()
  if (id.includes("claude")) return "CLAUDE.md"
  if (id.includes("gemini")) return "GEMINI.md"
  return "AGENTS.md"
}

/** The CLI's own file (even when missing, so it can be started) and any others already in the folder. */
export async function instructionsFiles(agentId: string, cwd: string): Promise<InstructionsFile[]> {
  const own = instructionsName(agentId)
  const out: InstructionsFile[] = []
  for (const name of [own, ...NAMES.filter((n) => n !== own)]) {
    const path = join(cwd, name)
    const exists = await stat(path).then(
      (s) => s.isFile(),
      () => false,
    )
    if (exists || name === own) out.push({ name, path, exists })
  }
  return out
}

/** The path to open for `name` in `cwd`; only the known file names, only directly in the folder. */
export function instructionsPath(cwd: string, name: string): string {
  if (!(NAMES as readonly string[]).includes(name)) throw new Error("That isn't an instructions file.")
  return join(cwd, name)
}

export const starterText = (cwd: string) =>
  `# ${basename(cwd) || "This folder"}\n\nNotes for the agent working here: how to build and test, what to leave alone.\n`
