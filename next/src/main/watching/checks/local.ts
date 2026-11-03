import { readFileSync } from "node:fs"
import { lstat, readlink } from "node:fs/promises"
import { posix } from "node:path"

import { statusOf } from "@shared/watching/findings"
import { cleanFolder, DEFAULT_LIMIT, folderName, inProtected } from "@shared/watching/more"
import type { CheckRow, Finding, Run, Step } from "@shared/watching/types"

import type { CheckDeps } from "./deps"

// Three More kinds on this computer: a folder's tests on a schedule, its packages a major version
// behind (the package manager asks the public registry), and free disk space. Folders under Desktop,
// Documents, Downloads and Library are never read: more.ts `cleanFolder` refuses them as typed, and
// `safeFolder` again right before anything runs, with every symlink followed.

const TESTS_TIMEOUT = 15 * 60_000
const OUTDATED_TIMEOUT = 120_000

export const expandHome = (t: string, d: Pick<CheckDeps, "home">) => (t.startsWith("~/") ? `${d.home?.() ?? ""}${t.slice(1)}` : t)

/** Shown when a watch's folder is (or leads into) a protected one: a run's error, and the plan's. */
export const REFUSED = "Axe doesn’t run things in Desktop, Documents, Downloads or Library"
export const PROTECTED_ERROR = `${REFUSED}. Pick a project folder.`

/**
 * The folder a watch may run in: `target` with ~ expanded and every symlink followed, or null when it is,
 * or leads into, Desktop, Documents, Downloads or Library. Each step is checked before it is looked at,
 * so nothing inside those folders is read (and macOS doesn't ask for them).
 */
export async function safeFolder(target: string, d: Pick<CheckDeps, "home">): Promise<string | null> {
  const home = d.home?.() || undefined
  const clean = cleanFolder(target, home)
  if (!clean) return null
  const refused = await protectedTest(d)
  return follow(clean.startsWith("~/") ? `${home ?? ""}${clean.slice(1)}` : clean, refused)
}

/** Whether an absolute path is in Desktop, Documents, Downloads or Library, home given as set or as its real path. */
export async function protectedTest(d: Pick<CheckDeps, "home">): Promise<(path: string) => boolean> {
  const home = d.home?.() || undefined
  const realHome = home ? await follow(home, () => false) : undefined
  return (p) => inProtected(p, home) || (!!realHome && inProtected(p, realHome))
}

/** `abs` with its symlinks followed, one folder at a time; null when `refused` says no to a step on the way. */
async function follow(abs: string, refused: (p: string) => boolean): Promise<string | null> {
  let rest = abs.split("/").filter(Boolean)
  let at = ""
  let hops = 0
  while (rest.length) {
    const name = rest.shift()!
    if (name === ".") continue
    if (name === "..") {
      at = at.slice(0, at.lastIndexOf("/"))
      continue
    }
    const next = `${at}/${name}`
    if (refused(next)) return null
    let link: string | undefined
    try {
      if ((await lstat(next)).isSymbolicLink()) link = await readlink(next)
    } catch {
      // Not there: what's left can't be a link.
      const out = posix.normalize([next, ...rest].join("/"))
      return refused(out) ? null : out
    }
    if (link === undefined) {
      at = next
      continue
    }
    if (++hops > 40) return null
    rest = [...(link.startsWith("/") ? link : `${at}/${link}`).split("/").filter(Boolean), ...rest]
    at = ""
  }
  return at || "/"
}

type Manager = "pnpm" | "npm" | "yarn" | "bun"

/** The folder's package manager, from its lockfile (npm when there's none). */
export function managerOf(dir: string, d: Pick<CheckDeps, "exists">): Manager {
  if (d.exists(`${dir}/pnpm-lock.yaml`)) return "pnpm"
  if (d.exists(`${dir}/yarn.lock`)) return "yarn"
  if (d.exists(`${dir}/bun.lockb`) || d.exists(`${dir}/bun.lock`)) return "bun"
  return "npm"
}

/** What can't be run in a folder, in plain words, or null when it can. */
export function folderProblem(dir: string, d: Pick<CheckDeps, "exists">, needs: "tests" | "packages", scripts?: Record<string, string>): string | null {
  if (!d.exists(dir)) return "That folder doesn’t exist."
  if (!d.exists(`${dir}/package.json`)) return "That folder has no package.json."
  if (needs === "tests" && !scripts?.test) return "Its package.json has no test script."
  return null
}

/* Tests in a folder */

/** The command a tests watch runs: yours, else the folder's own `test` script with its package manager. */
export function testCommand(dir: string, d: Pick<CheckDeps, "exists">, command?: string): [string, string[]] {
  if (command?.trim()) {
    const [cmd, ...args] = command.trim().split(/\s+/)
    return [cmd!, args]
  }
  const pm = managerOf(dir, d)
  return [pm, pm === "npm" ? ["test", "--silent"] : ["test"]]
}

/** Colour codes runners print even with NO_COLOR, built from a string so the regex holds no control character. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

/** The summary line a test runner prints: vitest's "Tests  3 failed | 40 passed", jest's "Tests: …", node's "# fail 1". */
export function testSummary(out: string): string | null {
  const clean = out.replace(ANSI, "")
  const lines = clean.split(/\r?\n/).map((l) => l.trim())
  const vitest = lines.findLast((l) => /^Tests\s{1,}\d/.test(l) || /^Tests:\s+\d/.test(l))
  if (vitest) return vitest.replace(/^Tests:?\s+/, "").replace(/\s*\(\d+\)\s*$/, "").replace(/\s*\|\s*/g, ", ")
  const pass = lines.findLast((l) => /^# pass \d+/.test(l))?.slice(7)
  const fail = lines.findLast((l) => /^# fail \d+/.test(l))?.slice(7)
  if (pass || fail) return `${fail ?? 0} failed, ${pass ?? 0} passed`
  return null
}

const tail = (out: string, n: number) => out.replace(ANSI, "").trimEnd().split(/\r?\n/).slice(-n).join("\n")
const took = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`)

export const testsSteps = (cmd: string, done: boolean): Step[] => [{ label: `Running ${cmd}`, state: done ? "done" : "run" }]

export async function checkTests(target: string, d: CheckDeps, o: { command?: string } = {}, onStep?: (s: Step[]) => void): Promise<Run> {
  const at = d.now()
  const dir = await safeFolder(target, d)
  if (!dir) return { at, ms: 0, status: "failed", findings: [], error: REFUSED }
  const pkg = readPackage(dir, d)
  const why = o.command ? (d.exists(dir) ? null : "That folder doesn’t exist.") : folderProblem(dir, d, "tests", pkg?.scripts)
  if (why) return { at, ms: 0, status: "failed", findings: [], error: why.replace(/\.$/, "") }
  const [cmd, args] = testCommand(dir, d, o.command)
  const shown = [cmd, ...args.filter((a) => a !== "--silent")].join(" ")
  onStep?.(testsSteps(shown, false))
  const r = await (d.run ?? d.exec)(cmd, args, { cwd: dir, timeoutMs: TESTS_TIMEOUT })
  onStep?.(testsSteps(shown, true))
  const ms = d.now() - at
  if (r.missing) return { at, ms, status: "failed", findings: [], error: `${cmd} isn’t installed` }
  const summary = testSummary(r.stdout)
  const facts: [string, string][] = [
    ["Command", shown],
    ["Result", r.code === 0 ? (summary ?? "Passed") : (summary ?? `Exit code ${r.code}`)],
    ["Took", took(ms)],
  ]
  const findings: Finding[] =
    r.code === 0
      ? []
      : [
          {
            key: "tests:failing",
            level: "problem",
            headline: `Tests fail in ${folderName(target)}`,
            line: summary ? `Tests fail: ${summary}.` : "Tests fail.",
            detail: `${shown} ${summary ? `ended with ${summary}` : `stopped with exit code ${r.code}`}.`,
            fix: "agent",
          },
        ]
  return { at, ms, status: statusOf(findings), findings, facts, ...(r.code ? { output: tail(r.stdout, 40) } : {}) }
}

function readPackage(dir: string, d: Pick<CheckDeps, "exists">): { scripts?: Record<string, string> } | null {
  if (!d.exists(`${dir}/package.json`)) return null
  try {
    return JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as { scripts?: Record<string, string> }
  } catch {
    return null
  }
}

/* Outdated packages */

/** "18.3.1" → the major, or the minor for 0.x (where a minor is breaking). */
const majorOf = (v: string): [number, number] | null => {
  const m = v.replace(/^[^\d]*/, "").match(/^(\d+)\.(\d+)/)
  if (!m) return null
  const a = Number(m[1])
  return a === 0 ? [0, Number(m[2])] : [a, 0]
}

export type Behind = { name: string; current: string; latest: string }

/** Packages whose latest is a major version past what's installed, from `npm|pnpm outdated --json`. */
export function majorsBehind(json: string): Behind[] | null {
  let data: unknown
  try {
    data = JSON.parse(json.slice(json.indexOf("{")))
  } catch {
    return json.trim() === "" ? [] : null
  }
  if (!data || typeof data !== "object") return []
  const out: Behind[] = []
  for (const [name, raw] of Object.entries(data as Record<string, unknown>)) {
    // npm gives an array when the package is installed in several places.
    const v = (Array.isArray(raw) ? raw[0] : raw) as { current?: string; latest?: string } | undefined
    if (!v?.current || !v.latest) continue
    const a = majorOf(v.current)
    const b = majorOf(v.latest)
    if (a && b && (b[0] > a[0] || (a[0] === 0 && b[0] === 0 && b[1] > a[1]))) out.push({ name, current: v.current, latest: v.latest })
  }
  return out.sort((x, y) => x.name.localeCompare(y.name))
}

export async function checkOutdated(target: string, d: CheckDeps): Promise<Run> {
  const at = d.now()
  const dir = await safeFolder(target, d)
  if (!dir) return { at, ms: 0, status: "failed", findings: [], error: REFUSED }
  const why = folderProblem(dir, d, "packages")
  if (why) return { at, ms: 0, status: "failed", findings: [], error: why.replace(/\.$/, "") }
  const pm = managerOf(dir, d)
  const workspace = pm === "pnpm" && d.exists(`${dir}/pnpm-workspace.yaml`)
  const args = pm === "pnpm" ? ["outdated", ...(workspace ? ["-r"] : []), "--format", "json"] : pm === "yarn" ? ["outdated", "--json"] : ["outdated", "--json"]
  const r = await (d.run ?? d.exec)(pm, args, { cwd: dir, timeoutMs: OUTDATED_TIMEOUT })
  const ms = d.now() - at
  if (r.missing) return { at, ms, status: "failed", findings: [], error: `${pm} isn’t installed` }
  // Both exit 1 when something is outdated; only output that isn't JSON is a failure.
  const behind = majorsBehind(r.stdout.slice(0, r.stdout.lastIndexOf("}") + 1) || r.stdout)
  if (!behind) return { at, ms, status: "failed", findings: [], error: `${pm} outdated couldn’t ask the registry` }
  const rows: CheckRow[] = behind.slice(0, 12).map((b) => ({ label: b.name, value: `${b.current} to ${b.latest}`, ok: false }))
  const findings: Finding[] = behind.length
    ? [
        {
          key: "outdated:major",
          level: "problem",
          headline: behind.length === 1 ? `${behind[0]!.name} is a major version behind` : `${behind.length} packages are a major version behind`,
          line: behind.length === 1 ? `${behind[0]!.name} ${behind[0]!.current}, latest ${behind[0]!.latest}.` : `${behind.length} packages a major version behind.`,
          detail: `${behind
            .slice(0, 4)
            .map((b) => `${b.name} ${b.current} to ${b.latest}`)
            .join(", ")}${behind.length > 4 ? `, and ${behind.length - 4} more` : ""}. A major version can change how a package works, so update them one at a time and run the tests.`,
          fix: "agent",
          value: behind.length,
        },
      ]
    : []
  return { at, ms, status: statusOf(findings), findings, rows, facts: [["Manager", pm], ["Behind a major", `${behind.length}`]], metric: behind.length }
}

/* Disk space */

const gb = (b: number) => b / 1e9
const gbWords = (b: number) => `${gb(b) >= 100 ? Math.round(gb(b)) : Math.round(gb(b) * 10) / 10} GB`

export async function checkDisk(target: string, d: CheckDeps, o: { limit?: number } = {}): Promise<Run> {
  const at = d.now()
  if (!d.disk) return { at, ms: 0, status: "failed", findings: [], error: "Free space can’t be read here" }
  const path = expandHome(target || "/", d)
  let s: { free: number; total: number }
  try {
    s = await d.disk(path)
  } catch {
    return { at, ms: 0, status: "failed", findings: [], error: "That folder doesn’t exist" }
  }
  const limit = o.limit ?? DEFAULT_LIMIT.disk
  const findings: Finding[] =
    gb(s.free) < limit
      ? [
          {
            key: "disk:low",
            level: "problem",
            headline: `Only ${gbWords(s.free)} free on this Mac`,
            line: `${gbWords(s.free)} free, under ${limit} GB.`,
            detail: `That’s under your ${limit} GB. Empty the Trash, or clear old builds and caches.`,
            fix: "none",
            value: Math.round(gb(s.free) * 10) / 10,
          },
        ]
      : []
  return {
    at,
    ms: d.now() - at,
    status: statusOf(findings),
    findings,
    facts: [
      ["Free", gbWords(s.free)],
      ["Of", gbWords(s.total)],
      ["Tell me under", `${limit} GB`],
    ],
    metric: Math.round(gb(s.free) * 10) / 10,
  }
}
