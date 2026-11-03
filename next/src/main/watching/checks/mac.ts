import { statusOf } from "@shared/watching/findings"
import { ELEMENT_LIMIT, HOG_MS } from "@shared/watching/elements"
import type { Finding, Run } from "@shared/watching/types"

import type { CheckDeps } from "./deps"
import { expandHome, protectedTest, REFUSED, safeFolder } from "./local"

// The This Mac elements: programs that ship with macOS (ps, sysctl, pmset, ioreg, lsof, tmutil,
// softwareupdate, system_profiler, networkQuality, du) and the ones you installed (docker, brew, git).
// Nothing asks for a permission at launch; nothing reads Desktop, Documents, Downloads or Library unless
// you name them. Each parser is pure and tested on real output (tests/unit/watching-elements.test.ts).

type Lim = { limit?: number }
const HOME = "/"
const failed = (at: number, error: string): Run => ({ at, ms: 0, status: "failed", findings: [], error })
const done = (at: number, d: CheckDeps, findings: Finding[], facts: [string, string][], state: string, metric?: number, more: Partial<Run> = {}): Run => ({
  at,
  ms: d.now() - at,
  status: statusOf(findings),
  findings,
  facts,
  state,
  ...(metric !== undefined ? { metric } : {}),
  ...more,
})
const gbWords = (gb: number) => (gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb >= 100 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`)
const memoOf = <T>(memo: string | undefined, fallback: T): T => {
  try {
    return memo ? (JSON.parse(memo) as T) : fallback
  } catch {
    return fallback
  }
}

/* Processes */

export type Proc = { name: string; cpu: number; memGb: number }

/** `ps -Aceo pcpu=,rss=,comm=`, one app per name (helpers add up), busiest first. */
export function parsePs(out: string): Proc[] {
  const by = new Map<string, Proc>()
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^([\d.]+)\s+(\d+)\s+(.+)$/)
    if (!m) continue
    const name = m[3]!.trim()
    const p = by.get(name) ?? { name, cpu: 0, memGb: 0 }
    p.cpu += Number(m[1])
    p.memGb += Number(m[2]) / 1024 / 1024
    by.set(name, p)
  }
  return [...by.values()].sort((a, b) => b.cpu - a.cpu || b.memGb - a.memGb)
}

/** Apps over the line since when (from the last runs), and the ones that have stayed over it for 10 minutes. */
export function hogs(procs: Proc[], since: Record<string, number>, now: number, limit: number): { since: Record<string, number>; hogs: (Proc & { forMs: number })[] } {
  const next: Record<string, number> = {}
  const out: (Proc & { forMs: number })[] = []
  for (const p of procs) {
    if (p.cpu < limit) continue
    next[p.name] = since[p.name] ?? now
    if (now - next[p.name]! >= HOG_MS) out.push({ ...p, forMs: now - next[p.name]! })
  }
  return { since: next, hogs: out }
}

const pct = (n: number) => `${Math.round(n)}%`

export async function checkProcesses(d: CheckDeps, o: Lim, memo?: string): Promise<{ run: Run; memo: string }> {
  const at = d.now()
  const r = await d.exec("/bin/ps", ["-Aceo", "pcpu=,rss=,comm="], { cwd: HOME, timeoutMs: 10_000 })
  const procs = parsePs(r.stdout)
  if (r.code || !procs.length) return { run: failed(at, "I couldn’t list the running apps"), memo: memo ?? "{}" }
  const limit = o.limit ?? ELEMENT_LIMIT.processes
  const h = hogs(procs, memoOf(memo, {}), at, limit)
  const findings: Finding[] = h.hogs.map((p) => ({
    key: `hog:${p.name}`,
    level: "problem",
    headline: `${p.name} has used ${pct(p.cpu)} CPU for ${Math.round(p.forMs / 60_000)} minutes`,
    line: `${p.name} at ${pct(p.cpu)} CPU for ${Math.round(p.forMs / 60_000)} min.`,
    detail: `Over your ${limit}% line since ${new Date(at - p.forMs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Quit it, or say it’s expected.`,
    fix: "none",
    value: Math.round(p.cpu),
  }))
  const top = procs.slice(0, 3)
  const facts = top.map((p): [string, string] => [p.name, `${pct(p.cpu)} CPU, ${gbWords(p.memGb)}`])
  return { run: done(at, d, findings, facts, `${top[0]!.name} ${pct(top[0]!.cpu)} CPU`, Math.round(top[0]!.cpu)), memo: JSON.stringify(h.since) }
}

/* Memory pressure */

export type Pressure = "Green" | "Yellow" | "Red"
/** `sysctl -n kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical. */
export const pressureOf = (level: string): Pressure | null => (({ "1": "Green", "2": "Yellow", "4": "Red" }) as Record<string, Pressure>)[level.trim()] ?? null
/** `memory_pressure -Q`: "System-wide memory free percentage: 56%". */
export const freePercent = (out: string) => {
  const m = out.match(/free percentage:\s*(\d+)%/)
  return m ? Number(m[1]) : null
}

export async function checkMemory(d: CheckDeps): Promise<Run> {
  const at = d.now()
  const [lvl, q] = await Promise.all([
    d.exec("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { cwd: HOME, timeoutMs: 5_000 }),
    d.exec("/usr/bin/memory_pressure", ["-Q"], { cwd: HOME, timeoutMs: 10_000 }),
  ])
  const p = pressureOf(lvl.stdout)
  const free = freePercent(q.stdout)
  if (!p) return failed(at, "I couldn’t read memory pressure")
  const used = free === null ? undefined : 100 - free
  const findings: Finding[] =
    p === "Red"
      ? [{ key: "pressure:red", level: "problem", headline: "Memory pressure is red", line: `Memory pressure is red${used !== undefined ? `, ${used}% used` : ""}.`, detail: "macOS is out of memory and swapping. Quit an app you aren’t using.", fix: "none" }]
      : []
  return done(at, d, findings, [["Pressure", p], ...(used !== undefined ? [["Used", `${used}%`] as [string, string]] : [])], `${p}${used !== undefined ? `, ${used}% used` : ""}`, used)
}

/* Battery */

export type Battery = { percent: number | null; charging: boolean; left: string | null; cycles: number | null; health: number | null }

/** `ioreg -rn AppleSmartBattery` and `pmset -g batt`. Health is NominalChargeCapacity over DesignCapacity, as System Settings shows it. */
export function parseBattery(ioreg: string, batt: string): Battery | null {
  if (!/InternalBattery/.test(batt)) return null
  const num = (k: string) => {
    const m = ioreg.match(new RegExp(`"${k}"\\s*=\\s*(\\d+)`))
    return m ? Number(m[1]) : null
  }
  const nominal = num("NominalChargeCapacity")
  const design = num("DesignCapacity")
  const line = batt.split("\n").find((l) => /InternalBattery/.test(l)) ?? ""
  const percent = line.match(/(\d+)%/)?.[1]
  const left = line.match(/(\d+:\d{2}) remaining/)?.[1]
  const charging = /AC Power/.test(batt) || /\b(charging|charged|finishing charge)\b/.test(line)
  return {
    percent: percent ? Number(percent) : null,
    charging,
    left: left && left !== "0:00" && !charging ? left.replace(/^(\d+):(\d+)$/, (_, h, m) => `${Number(h)}h ${Number(m)}m`) : null,
    cycles: num("CycleCount"),
    health: nominal && design ? Math.round((nominal / design) * 100) : null,
  }
}

/** `pmset -g assertions`: the apps holding the Mac awake, by name, without macOS's own. */
export function awakeApps(out: string): string[] {
  const names = new Set<string>()
  for (const l of out.split("\n")) {
    const m = l.match(/pid \d+\(([^)]+)\):.*?\b(PreventUserIdleSystemSleep|PreventSystemSleep|NoIdleSleepAssertion)\b/)
    if (m && !/^(powerd|WindowServer|coreaudiod|sharingd|bluetoothd|backupd|useractivityd|mds|mds_stores|nsurlsessiond|runningboardd)$/.test(m[1]!)) names.add(m[1]!)
  }
  return [...names]
}

export async function checkBattery(d: CheckDeps, o: Lim): Promise<Run> {
  const at = d.now()
  const [io, batt, asr] = await Promise.all([
    d.exec("/usr/sbin/ioreg", ["-rn", "AppleSmartBattery"], { cwd: HOME, timeoutMs: 10_000 }),
    d.exec("/usr/bin/pmset", ["-g", "batt"], { cwd: HOME, timeoutMs: 5_000 }),
    d.exec("/usr/bin/pmset", ["-g", "assertions"], { cwd: HOME, timeoutMs: 5_000 }),
  ])
  const b = parseBattery(io.stdout, batt.stdout)
  if (!b) return failed(at, "This Mac has no battery")
  const awake = awakeApps(asr.stdout)
  const limit = o.limit ?? ELEMENT_LIMIT.battery
  const findings: Finding[] =
    b.health !== null && b.health < limit
      ? [{ key: "battery:health", level: "problem", headline: `Battery health is ${b.health}%`, line: `Battery health ${b.health}%, under ${limit}%.`, detail: `It holds ${b.health}% of what it did new, after ${b.cycles ?? "?"} cycles. Apple replaces batteries under 80%.`, fix: "none", value: b.health }]
      : []
  const facts: [string, string][] = [
    ["Health", b.health !== null ? `${b.health}%` : "Unknown"],
    ["Cycles", b.cycles !== null ? `${b.cycles}` : "Unknown"],
    ["Charge", `${b.percent ?? "?"}%${b.charging ? ", on power" : ""}`],
    ["Left", b.left ?? (b.charging ? "On power" : "Working it out")],
    ["Awake", awake.length ? awake.join(", ") : "Nothing"],
  ]
  return done(at, d, findings, facts, `${b.health ?? "?"}% health, ${b.cycles ?? "?"} cycles`, b.health ?? undefined)
}

/* Dev servers */

export type Listener = { port: number; command: string }
/** `lsof -nP -iTCP -sTCP:LISTEN -Fcn`: one row per port, the first program on it. */
export function parseListeners(out: string): Listener[] {
  const by = new Map<number, string>()
  let cmd = ""
  for (const l of out.split("\n")) {
    if (l.startsWith("c")) cmd = l.slice(1)
    else if (l.startsWith("n")) {
      const port = Number(l.match(/:(\d+)$/)?.[1])
      if (port && !by.has(port)) by.set(port, cmd)
    }
  }
  return [...by.entries()].map(([port, command]) => ({ port, command })).sort((a, b) => a.port - b.port)
}

export const listeners = async (d: CheckDeps) => parseListeners((await d.exec("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fcn"], { cwd: HOME, timeoutMs: 10_000 })).stdout)

export async function checkPorts(target: string, d: CheckDeps): Promise<Run> {
  const at = d.now()
  const on = new Map((await listeners(d)).map((l) => [l.port, l.command]))
  const want = target.split(", ").map(Number)
  const findings: Finding[] = want
    .filter((p) => !on.has(p))
    .map((p) => ({ key: `port:${p}`, level: "problem", headline: `Nothing is listening on :${p}`, line: `:${p} stopped.`, detail: `The server on port ${p} stopped. Start it again.`, fix: "none" }))
  const up = want.length - findings.length
  return done(at, d, findings, want.map((p) => [`:${p}`, on.get(p) ?? "Stopped"]), `${up} of ${want.length} listening`, up)
}

/* Docker */

export type Container = { name: string; state: string; status: string; image: string }
export const parseContainers = (out: string): Container[] =>
  out
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as { Names: string; State: string; Status: string; Image: string })
    .map((c) => ({ name: c.Names, state: c.State, status: c.Status, image: c.Image }))

/** "32.29GB", "3.023MB", "0B" → gigabytes. */
export function sizeGb(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([kKMGT]?B)/)
  if (!m) return 0
  const n = Number(m[1])
  return n * ({ B: 1e-9, kB: 1e-6, KB: 1e-6, MB: 1e-3, GB: 1, TB: 1000 }[m[2]!] ?? 0)
}
export const dockerDisk = (out: string) =>
  out
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as { Type: string; Size: string; Reclaimable: string })
    .reduce((a, t) => ({ size: a.size + sizeGb(t.Size), reclaim: a.reclaim + sizeGb(t.Reclaimable) }), { size: 0, reclaim: 0 })

export async function checkDocker(d: CheckDeps, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const run = d.run ?? d.exec
  const ps = await run("docker", ["ps", "-a", "--format", "{{json .}}"], { cwd: HOME, timeoutMs: 30_000 })
  if (ps.missing) return { run: failed(at, "Docker isn’t installed on this Mac") }
  if (ps.code) return { run: failed(at, /daemon|connect/i.test(ps.stdout) ? "Docker isn’t running" : "Docker didn’t answer"), memo }
  const cs = parseContainers(ps.stdout)
  const df = dockerDisk((await run("docker", ["system", "df", "--format", "{{json .}}"], { cwd: HOME, timeoutMs: 60_000 })).stdout)
  const running = cs.filter((c) => c.state === "running")
  const before = memoOf<string[]>(memo, [])
  const findings: Finding[] = cs
    .filter((c) => c.state !== "running" && before.includes(c.name))
    .map((c) => ({ key: `stopped:${c.name}`, level: "problem", headline: `${c.name} stopped`, line: `${c.name} stopped: ${c.status}.`, detail: `It was running at the last check. ${c.status}.`, fix: "none" }))
  // Every container seen running stays expected while it exists, so a stopped one stays a problem until it
  // runs again, is removed, or you say it's expected.
  const expected = [...new Set([...before.filter((n) => cs.some((c) => c.name === n)), ...running.map((c) => c.name)])]
  const facts: [string, string][] = [
    ["Running", `${running.length}`],
    ["Stopped", `${cs.length - running.length}`],
    ["Disk", gbWords(df.size)],
    ["Reclaimable", gbWords(df.reclaim)],
  ]
  return { run: done(at, d, findings, facts, `${running.length} running, ${cs.length - running.length} stopped, ${gbWords(df.size)}`, Math.round(df.size * 10) / 10), memo: JSON.stringify(expected) }
}

/* Git repos */

/** `unpublished`: the branch has never been pushed (no upstream, but the repo has a remote). */
export type RepoState = { repo: string; branch: string; dirty: number; ahead: number; behind: number; upstream?: string; unpublished?: boolean }

/** `git status --porcelain=v1 -b`: the branch line and the changed files. */
export function parseGitStatus(repo: string, out: string): RepoState {
  const lines = out.split("\n").filter(Boolean)
  const head = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : ""
  const branch = head.split("...")[0]!.replace(/^No commits yet on /, "")
  const upstream = head.match(/\.\.\.(\S+)/)?.[1]
  return { repo, branch, dirty: lines.length, ahead: Number(head.match(/ahead (\d+)/)?.[1] ?? 0), behind: Number(head.match(/behind (\d+)/)?.[1] ?? 0), ...(upstream ? { upstream } : {}) }
}

/**
 * Folders with a .git, two levels down at most, never into node_modules, hidden folders or links.
 * Nothing when `root` is (or leads into) Desktop, Documents, Downloads or Library, and from a root above
 * home (/Users) the walk skips those folders without looking inside.
 */
export async function findRepos(root: string, d: CheckDeps, max = 40): Promise<string[]> {
  const start = await safeFolder(root, d)
  if (!start) return []
  const refused = await protectedTest(d)
  const { readdirSync } = await import("node:fs")
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (out.length >= max || refused(dir)) return
    if (d.exists(`${dir}/.git`)) return void out.push(dir)
    if (depth >= 2) return
    let names: string[] = []
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => e.name)
        .sort()
    } catch {}
    for (const n of names) walk(`${dir}/${n}`, depth + 1)
  }
  walk(start, 0)
  return out
}

const GIT_ENV = ["-c", "credential.helper=", "-c", "core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=8"]

/**
 * One repo: its status, and whether the remote moved past what this clone knows. `git ls-remote` asks the
 * remote without fetching, so nothing in the repo changes.
 */
async function repoState(dir: string, d: CheckDeps): Promise<RepoState | null> {
  const git = (args: string[], timeoutMs = 10_000) => (d.run ?? d.exec)("git", [...GIT_ENV, "-C", dir, ...args], { cwd: dir, timeoutMs })
  const st = await git(["status", "--porcelain=v1", "-b"])
  if (st.code) return null
  const s = parseGitStatus(dir, st.stdout)
  if (!s.upstream) {
    const remotes = await git(["remote"])
    return remotes.stdout.trim() && s.branch && !/HEAD/.test(s.branch) ? { ...s, unpublished: true } : s
  }
  const [remote, ...rest] = s.upstream.split("/")
  const ls = await git(["ls-remote", "--heads", remote!, rest.join("/")], 15_000)
  const theirs = ls.code ? "" : (ls.stdout.trim().split(/\s/)[0] ?? "")
  if (!/^[0-9a-f]{40}$/.test(theirs)) return s
  const known = await git(["merge-base", "--is-ancestor", theirs, "HEAD"])
  if (known.code === 0) return s
  // Not in this clone: new commits on the remote. How many isn't known without fetching.
  return { ...s, behind: Math.max(s.behind, 1) }
}

const short = (dir: string, root: string) => dir.slice(root.length + 1) || dir.split("/").pop()!

export async function checkGitRepos(target: string, d: CheckDeps): Promise<Run> {
  const at = d.now()
  const root = await safeFolder(target, d)
  if (!root) return failed(at, REFUSED)
  if (!d.exists(root)) return failed(at, "That folder doesn’t exist")
  const dirs = await findRepos(root, d)
  if (!dirs.length) return failed(at, `There are no git repos in ${target}`)
  const states: RepoState[] = []
  for (let i = 0; i < dirs.length; i += 4) states.push(...(await Promise.all(dirs.slice(i, i + 4).map((r) => repoState(r, d)))).filter((s): s is RepoState => !!s))
  const behind = states.filter((s) => s.behind > 0)
  const findings: Finding[] = behind.map((s) => ({
    key: `behind:${short(s.repo, root)}`,
    level: "problem",
    headline: `${short(s.repo, root)} is behind its remote`,
    line: `${short(s.repo, root)} is behind ${s.upstream}.`,
    detail: `${s.upstream} has commits this clone doesn’t. Pull before you work on ${s.branch}.`,
    fix: "none",
  }))
  const dirty = states.filter((s) => s.dirty)
  const ahead = states.filter((s) => s.ahead || s.unpublished)
  const rows = [...states]
    .filter((s) => s.dirty || s.ahead || s.behind || s.unpublished)
    .sort((a, b) => b.behind - a.behind || b.dirty - a.dirty || b.ahead - a.ahead)
    .slice(0, 6)
    .map((s): [string, string] => [short(s.repo, root), [s.dirty ? `${s.dirty} uncommitted` : "", s.ahead ? `${s.ahead} unpushed` : "", s.unpublished ? `${s.branch} not pushed` : "", s.behind ? "behind" : ""].filter(Boolean).join(", ")])
  const state = `${states.length} repos, ${dirty.length} uncommitted, ${ahead.length} unpushed, ${behind.length} behind`
  return done(at, d, findings, rows.length ? rows : [["Repos", `${states.length}, all clean`]], state, behind.length)
}

/* Homebrew */

export type Outdated = { name: string; from: string; to: string }
/** `brew outdated --json=v2`, with whatever brew printed to stderr before or after the JSON. */
export function parseBrew(out: string): Outdated[] | null {
  const start = out.indexOf("{")
  let json = ""
  for (let end = out.lastIndexOf("}"); start >= 0 && end > start; end = out.lastIndexOf("}", end - 1)) {
    try {
      JSON.parse(out.slice(start, end + 1))
      json = out.slice(start, end + 1)
      break
    } catch {}
  }
  try {
    const j = JSON.parse(json) as { formulae?: { name: string; installed_versions: string[]; current_version: string }[]; casks?: { name: string; installed_versions: string[]; current_version: string }[] }
    return [...(j.formulae ?? []), ...(j.casks ?? [])].map((p) => ({ name: p.name, from: p.installed_versions.at(-1) ?? "", to: p.current_version }))
  } catch {
    return null
  }
}

export async function checkBrew(d: CheckDeps, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const run = d.run ?? d.exec
  // Against Homebrew's last update: auto-update would change your Homebrew while Axe only looks.
  const r = await run("/usr/bin/env", ["HOMEBREW_NO_AUTO_UPDATE=1", "brew", "outdated", "--json=v2"], { cwd: HOME, timeoutMs: 120_000 })
  if (r.missing || /brew: No such file|command not found/.test(r.stdout)) return { run: failed(at, "Homebrew isn’t installed on this Mac") }
  const list = parseBrew(r.stdout)
  if (!list) return { run: failed(at, "Homebrew didn’t answer"), memo }
  const before = memoOf<string[] | null>(memo, null)
  const fresh = before ? list.filter((p) => !before.includes(`${p.name}@${p.to}`)) : []
  const findings: Finding[] = fresh.length
    ? [{ key: `brew:${at}`, level: "news", headline: `${fresh.length} new Homebrew update${fresh.length === 1 ? "" : "s"}`, line: `New: ${fresh.slice(0, 3).map((p) => `${p.name} ${p.to}`).join(", ")}${fresh.length > 3 ? ` and ${fresh.length - 3} more` : ""}.`, fix: "none" }]
    : []
  const facts = list.slice(0, 5).map((p): [string, string] => [p.name, `${p.from} to ${p.to}`])
  return { run: done(at, d, findings, [["Outdated", `${list.length}`], ...facts], `${list.length} outdated`, list.length), memo: JSON.stringify(list.map((p) => `${p.name}@${p.to}`)) }
}

/* macOS updates */

export type Update = { label: string; title: string; size?: string; restart: boolean }
/** `softwareupdate -l`: "* Label: …" then "\tTitle: …, Version: …, Size: …KiB, Recommended: YES, Action: restart,". */
export function parseUpdates(out: string): Update[] {
  const lines = out.split("\n")
  const out2: Update[] = []
  lines.forEach((l, i) => {
    const m = l.match(/^\s*\*\s*Label:\s*(.+)$/)
    if (!m) return
    const info = lines[i + 1] ?? ""
    const title = info.match(/Title:\s*([^,]+)/)?.[1]?.trim() ?? m[1]!.trim()
    const version = info.match(/Version:\s*([^,]+)/)?.[1]?.trim()
    const kib = Number(info.match(/Size:\s*(\d+)\s*KiB/)?.[1] ?? 0)
    out2.push({ label: m[1]!.trim(), title: version && !title.includes(version) ? `${title} ${version}` : title, ...(kib ? { size: kib > 1024 * 1024 ? `${Math.round((kib / 1024 / 1024) * 10) / 10} GB` : `${Math.round(kib / 1024)} MB` } : {}), restart: /Action:\s*restart/i.test(info) })
  })
  return out2
}

export async function checkMacos(d: CheckDeps, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const r = await d.exec("/usr/sbin/softwareupdate", ["-l"], { cwd: HOME, timeoutMs: 120_000 })
  const ups = parseUpdates(r.stdout)
  if (!ups.length && !/No new software available/i.test(r.stdout)) return { run: failed(at, "Software Update didn’t answer"), memo }
  const before = memoOf<string[] | null>(memo, null)
  const fresh = before ? ups.filter((u) => !before.includes(u.label)) : []
  const findings: Finding[] = fresh.map((u) => ({ key: `update:${u.label}`, level: "news", headline: `${u.title} is out`, line: `${u.title} is out${u.size ? `, ${u.size}` : ""}.`, detail: u.restart ? "It needs a restart." : undefined, fix: "none" }))
  const facts = ups.map((u): [string, string] => [u.title, [u.size, u.restart ? "restart" : ""].filter(Boolean).join(", ") || "Ready"])
  return { run: done(at, d, findings, facts.length ? facts : [["Updates", "None"]], ups.length ? `${ups.length} pending: ${ups[0]!.title}` : "Up to date", ups.length), memo: JSON.stringify(ups.map((u) => u.label)) }
}

/* Time Machine */

/** "/Volumes/…/2026-11-01-083012.backup" → its time; `tmutil latestbackup` prints a path or an error. */
export function backupTime(out: string): number | null {
  const m = out.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/)
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime() : null
}

export async function checkTimeMachine(d: CheckDeps, o: Lim): Promise<Run> {
  const at = d.now()
  const dest = await d.exec("/usr/bin/tmutil", ["destinationinfo"], { cwd: HOME, timeoutMs: 15_000 })
  if (/No destinations configured/i.test(dest.stdout)) return failed(at, "Time Machine has no backup disk set up")
  const r = await d.exec("/usr/bin/tmutil", ["latestbackup"], { cwd: HOME, timeoutMs: 30_000 })
  const t = backupTime(r.stdout)
  if (t === null)
    return failed(at, /Full Disk Access|not permitted|Operation not/i.test(r.stdout) ? "macOS needs Full Disk Access for Axe AI to read backups" : "I couldn’t read the last backup. The backup disk may not be connected")
  const hours = (at - t) / 3_600_000
  const limit = o.limit ?? ELEMENT_LIMIT.timemachine
  const agoWords = hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min ago` : hours < 48 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} days ago`
  const findings: Finding[] =
    hours > limit ? [{ key: "backup:old", level: "problem", headline: `The last backup was ${agoWords}`, line: `Last backup ${agoWords}.`, detail: "Connect the backup disk, or back up now from the Time Machine menu.", fix: "none", value: Math.round(hours) }] : []
  return done(at, d, findings, [["Last backup", new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })]], `Last backup ${agoWords}`, Math.round(hours * 10) / 10)
}

/* Disk hogs */

const PROTECTED = new Set(["Desktop", "Documents", "Downloads", "Library", "Movies", "Music", "Pictures", ".Trash"])
/** `du -sk` lines: size in KB, tab, path. */
export const parseDu = (out: string) =>
  out
    .split("\n")
    .map((l) => l.match(/^(\d+)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ path: m[2]!, gb: Number(m[1]) / 1024 / 1024 }))

/** The folders measured: your home's own folders (skipping the protected ones) when the target is "~", else the ones you named. */
export async function hogFolders(target: string, d: CheckDeps): Promise<string[]> {
  const home = d.home?.() ?? ""
  const { readdirSync } = await import("node:fs")
  // "~" anywhere in the list is home's own folders, never the protected ones: those only when named.
  const ownFolders = () =>
    readdirSync(home, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !PROTECTED.has(e.name))
      .map((e) => `${home}/${e.name}`)
  return [...new Set(target.split(", ").flatMap((t) => (t === "~" ? ownFolders() : [expandHome(t, d)])))]
}

export async function checkHogs(target: string, d: CheckDeps, o: Lim, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const dirs = (await hogFolders(target, d).catch(() => [])).filter((p) => d.exists(p))
  if (!dirs.length) return { run: failed(at, "None of those folders exist"), memo }
  // One du per folder, so one slow folder can't hide the rest.
  const sizes: { path: string; gb: number }[] = []
  for (const p of dirs) sizes.push(...parseDu((await d.exec("/usr/bin/du", ["-sk", p], { cwd: HOME, timeoutMs: 120_000 })).stdout))
  if (!sizes.length) return { run: failed(at, "I couldn’t measure those folders"), memo }
  const home = d.home?.() ?? ""
  const named = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p)
  const before = memoOf<Record<string, number>>(memo, {})
  const limit = o.limit ?? ELEMENT_LIMIT.hogs
  sizes.sort((a, b) => b.gb - a.gb)
  const findings: Finding[] = sizes
    .filter((s) => before[s.path] !== undefined && s.gb - before[s.path]! > limit)
    .map((s) => ({ key: `grew:${s.path}`, level: "problem", headline: `${named(s.path)} grew ${gbWords(s.gb - before[s.path]!)}`, line: `${named(s.path)} grew ${gbWords(s.gb - before[s.path]!)} to ${gbWords(s.gb)}.`, detail: `It’s ${gbWords(s.gb)} now, up from ${gbWords(before[s.path]!)} at the last check.`, fix: "none" }))
  const facts = sizes.slice(0, 5).map((s): [string, string] => [named(s.path), `${gbWords(s.gb)}${before[s.path] !== undefined && s.gb - before[s.path]! > 0.05 ? `, up ${gbWords(s.gb - before[s.path]!)}` : ""}`])
  return { run: done(at, d, findings, facts, `${named(sizes[0]!.path)} ${gbWords(sizes[0]!.gb)}`, Math.round(sizes[0]!.gb * 10) / 10), memo: JSON.stringify(Object.fromEntries(sizes.map((s) => [s.path, Math.round(s.gb * 1000) / 1000]))) }
}

/* Network */

export type Wifi = { signal?: number; noise?: number; rate?: number; phy?: string; channel?: string }
/** `system_profiler SPAirPortDataType -json`: the network the Mac is on now. */
export function parseWifi(json: string): Wifi | null {
  try {
    const ifs = (JSON.parse(json) as { SPAirPortDataType: { spairport_airport_interfaces?: { spairport_current_network_information?: Record<string, string | number> }[] }[] }).SPAirPortDataType[0]?.spairport_airport_interfaces ?? []
    const cur = ifs.find((i) => i.spairport_current_network_information)?.spairport_current_network_information
    if (!cur) return null
    const sn = String(cur.spairport_signal_noise ?? "").match(/(-?\d+) dBm \/ (-?\d+) dBm/)
    return { ...(sn ? { signal: Number(sn[1]), noise: Number(sn[2]) } : {}), ...(cur.spairport_network_rate ? { rate: Number(cur.spairport_network_rate) } : {}), ...(cur.spairport_network_phymode ? { phy: String(cur.spairport_network_phymode) } : {}), ...(cur.spairport_network_channel ? { channel: String(cur.spairport_network_channel) } : {}) }
  } catch {
    return null
  }
}
/** `scutil --nc list`: the connected VPNs by name. Plus Tailscale-style utun addresses from `ifconfig`. */
export const vpnsOf = (nc: string) => [...nc.matchAll(/\(Connected\).*?"([^"]+)"/g)].map((m) => m[1]!)
/** `networkQuality -c`: download Mbps. */
export function downloadMbps(json: string): number | null {
  try {
    const j = JSON.parse(json) as { dl_throughput?: number }
    return j.dl_throughput ? Math.round(j.dl_throughput / 1e6) : null
  } catch {
    return null
  }
}
const bars = (dbm: number) => (dbm >= -55 ? "Excellent" : dbm >= -67 ? "Good" : dbm >= -75 ? "Fair" : "Weak")
const DAY = 86_400_000

export async function checkNetwork(d: CheckDeps, o: Lim, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const ex = (cmd: string, args: string[], timeoutMs = 15_000) => d.exec(cmd, args, { cwd: HOME, timeoutMs })
  const route = await ex("/sbin/route", ["-n", "get", "default"])
  const iface = route.stdout.match(/interface:\s*(\S+)/)?.[1]
  if (!iface) return { run: failed(at, "This Mac isn’t on a network"), memo }
  const [ip, nc, prof] = await Promise.all([ex("/usr/sbin/ipconfig", ["getifaddr", iface]), ex("/usr/sbin/scutil", ["--nc", "list"]), ex("/usr/sbin/system_profiler", ["SPAirPortDataType", "-json"], 30_000)])
  const wifi = parseWifi(prof.stdout)
  const vpns = vpnsOf(nc.stdout)
  let pub: string | null = null
  try {
    const r = await d.fetch("https://api.ipify.org", { signal: AbortSignal.timeout(10_000) })
    pub = r.ok ? (await r.text()).trim() : null
  } catch {}
  // The speed test moves real data, so it runs once a day; the other checks keep its last answer.
  const last = memoOf<{ mbps?: number; at?: number }>(memo, {})
  let speed = last
  if (!last.at || at - last.at >= DAY) {
    const nq = await ex("/usr/bin/networkQuality", ["-c", "-M", "20"], 60_000)
    const mbps = downloadMbps(nq.stdout)
    if (mbps !== null) speed = { mbps, at }
  }
  const limit = o.limit ?? ELEMENT_LIMIT.network
  const findings: Finding[] =
    speed.mbps !== undefined && speed.at === at && speed.mbps < limit
      ? [{ key: "speed:low", level: "problem", headline: `Download speed is ${speed.mbps} Mbps`, line: `${speed.mbps} Mbps, under ${limit}.`, detail: `macOS’s own speed test measured ${speed.mbps} Mbps down, under your ${limit} Mbps.`, fix: "none", value: speed.mbps }]
      : []
  const facts: [string, string][] = [
    ["Connection", wifi ? `Wi-Fi, ${wifi.signal !== undefined ? `${bars(wifi.signal)} (${wifi.signal} dBm)` : "connected"}` : iface.startsWith("en") ? "Ethernet" : iface],
    ...(wifi?.rate ? [["Link", `${wifi.rate} Mbps${wifi.phy ? `, ${wifi.phy}` : ""}`] as [string, string]] : []),
    ["Speed", speed.mbps !== undefined ? `${speed.mbps} Mbps down` : "Not measured yet"],
    ["Local IP", ip.stdout.trim() || "None"],
    ["Public IP", pub ?? "Couldn’t ask"],
    ["VPN", vpns.length ? vpns.join(", ") : "Off"],
  ]
  return {
    run: done(at, d, findings, facts, `${speed.mbps !== undefined ? `${speed.mbps} Mbps` : wifi ? "Wi-Fi" : "Online"}, VPN ${vpns.length ? vpns.join(", ") : "off"}`, speed.mbps),
    memo: JSON.stringify(speed),
  }
}
