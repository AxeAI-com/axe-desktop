import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { statusOf } from "@shared/watching/findings"
import { alertLine } from "@shared/watching/copy"
import type { Finding, RepoAlert, Run, Step } from "@shared/watching/types"

import type { CheckDeps } from "./deps"

// Repo alerts: GitHub's open Dependabot, code scanning and secret scanning alerts (through the gh CLI,
// signed in as you) for a GitHub repo, and for a local folder the package manager's audit and a scan of
// tracked files for keys. A GitHub repo with a local clone uses both. A key is reported by file and its
// first 4 characters, never in full.

export const isFolder = (t: string) => t.startsWith("/") || t.startsWith("~")
export const expand = (t: string) => (t === "~" ? homedir() : t.startsWith("~/") ? join(homedir(), t.slice(2)) : t)

type Sev = NonNullable<RepoAlert["severity"]>
const SEVS: Sev[] = ["low", "moderate", "high", "critical"]
const sevOf = (s: string | undefined): Sev | undefined => {
  const v = (s ?? "").toLowerCase()
  if (v === "medium") return "moderate"
  return (SEVS as string[]).includes(v) ? (v as Sev) : v === "error" ? "high" : v === "warning" ? "moderate" : v === "note" ? "low" : undefined
}
const worse = (a?: Sev, b?: Sev) => (!a ? b : !b ? a : SEVS.indexOf(a) >= SEVS.indexOf(b) ? a : b)

/** "express vulnerable to XSS via response.redirect()" → "XSS via response.redirect()". */
export function plainProblem(title: string, pkg?: string): string {
  let t = title.trim().replace(/\.$/, "")
  if (pkg) {
    const p = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    t = t.replace(new RegExp(`^(${p}|[\\w.@/-]*${p}[\\w.-]*)(’s|'s|:)?\\s+(is\\s+)?(vulnerable to|contains|has|allows|outputs)?\\s*(an?\\s+)?`, "i"), "")
  }
  t = t.replace(/^(vulnerable to|contains)\s+/i, "")
  // Sentence case: "Open Redirect" reads "Open redirect"; acronyms like XSS stay.
  t = t.split(" ").map((w, i) => (i && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(" ")
  return t ? t[0]!.toUpperCase() + t.slice(1) : title
}

/** "<4.19.2" → "4.19.2". Ranges that end in "<=" have no known fix version. */
const fixedFrom = (range: string | undefined) => range?.match(/<\s*(\d[\w.-]*)\s*$/)?.[1]
const newest = (vs: (string | undefined)[]) =>
  vs.filter((v): v is string => !!v).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)

/** One package's advisories folded into one alert: its worst problem, and the version that fixes them all. */
function packageAlert(name: string, version: string | undefined, advisories: { title: string; sev?: Sev; id?: string; url?: string; range?: string; fixed?: string }[], fixVia?: string): RepoAlert {
  const worst = [...advisories].sort((a, b) => SEVS.indexOf(b.sev ?? "low") - SEVS.indexOf(a.sev ?? "low"))[0]!
  const fixes = advisories.map((a) => a.fixed ?? fixedFrom(a.range))
  const fixedIn = fixes.every(Boolean) ? newest(fixes) : undefined
  const more = advisories.length - 1
  return {
    source: "package",
    name,
    ...(version ? { version } : {}),
    problem: `${plainProblem(worst.title, name)}${more ? ` and ${more} more` : ""}`,
    ...(worst.sev ? { severity: advisories.reduce<Sev | undefined>((s, a) => worse(s, a.sev), undefined) } : {}),
    ...(fixedIn ? { fixedIn } : fixVia ? { fixVia } : {}),
    ...(worst.id ? { id: worst.id } : {}),
    ...(worst.url ? { url: worst.url } : {}),
  }
}

const finding = (key: string, a: RepoAlert): Finding => ({
  key,
  level: "problem",
  headline: alertLine(a),
  past: alertLine(a),
  line: `${alertLine(a)}.`,
  fix: "agent",
  ev: { alert: a },
})

/* GitHub */

type Gh = { ok: true; data: unknown[] } | { ok: false; why: "off" | "signin" | "missing" | "unseen" | "other" }

async function gh(d: CheckDeps, path: string): Promise<Gh> {
  const r = await d.exec("gh", ["api", path], { cwd: homedir(), timeoutMs: 30_000 })
  if (r.missing) return { ok: false, why: "missing" }
  if (r.code !== 0) {
    if (/auth login|not logged|authentication/i.test(r.stdout)) return { ok: false, why: "signin" }
    // 403 and 404 come back when a kind of alert is off, or when the repo isn't yours to read.
    if (/HTTP 403|"status":\s*"403"|disabled|not enabled|no analysis|Advanced Security/i.test(r.stdout)) return { ok: false, why: "off" }
    if (/HTTP 404|Not Found/i.test(r.stdout)) return { ok: false, why: "unseen" }
    return { ok: false, why: "other" }
  }
  try {
    const parsed = JSON.parse(r.stdout) as unknown
    return { ok: true, data: Array.isArray(parsed) ? parsed : [] }
  } catch {
    return { ok: false, why: "other" }
  }
}

type DepAlert = {
  number?: number
  html_url?: string
  dependency?: { package?: { name?: string }; manifest_path?: string }
  security_advisory?: { ghsa_id?: string; summary?: string; severity?: string }
  security_vulnerability?: { severity?: string; vulnerable_version_range?: string; first_patched_version?: { identifier?: string } | null }
}
type CodeAlert = { number?: number; html_url?: string; rule?: { id?: string; description?: string; severity?: string; security_severity_level?: string }; most_recent_instance?: { location?: { path?: string } } }
type SecretAlert = { number?: number; html_url?: string; secret_type_display_name?: string; secret_type?: string }

export type GitHubResult = { alerts: [string, RepoAlert][]; fact?: string; error?: "signin" | "missing" | "unseen" | "other" }

async function fromGitHub(repo: string, d: CheckDeps, versions: (name: string) => string | undefined): Promise<GitHubResult> {
  const [dep, code, secret] = await Promise.all([
    gh(d, `repos/${repo}/dependabot/alerts?state=open&per_page=100`),
    gh(d, `repos/${repo}/code-scanning/alerts?state=open&per_page=100`),
    gh(d, `repos/${repo}/secret-scanning/alerts?state=open&per_page=100`),
  ])
  const all = [dep, code, secret]
  const bad = all.find((g): g is Extract<Gh, { ok: false }> => !g.ok && g.why !== "off")
  if (bad && !all.some((g) => g.ok)) return { alerts: [], error: bad.why as GitHubResult["error"] }
  const alerts: [string, RepoAlert][] = []
  if (dep.ok) {
    // Several alerts on one package fold into one row, like the folder's audit.
    const byPkg = new Map<string, DepAlert[]>()
    for (const a of dep.data as DepAlert[]) {
      const name = a.dependency?.package?.name ?? "A package"
      byPkg.set(name, [...(byPkg.get(name) ?? []), a])
    }
    for (const [name, list] of byPkg)
      alerts.push([
        `alert:${name}`,
        packageAlert(
          name,
          versions(name),
          list.map((a) => ({
            title: a.security_advisory?.summary ?? "Security alert",
            sev: sevOf(a.security_vulnerability?.severity ?? a.security_advisory?.severity),
            id: a.security_advisory?.ghsa_id,
            url: a.security_advisory?.ghsa_id ? `https://github.com/advisories/${a.security_advisory.ghsa_id}` : a.html_url,
            range: a.security_vulnerability?.vulnerable_version_range,
            fixed: a.security_vulnerability?.first_patched_version?.identifier,
          })),
        ),
      ])
  }
  if (code.ok)
    for (const a of code.data as CodeAlert[])
      alerts.push([
        `code:${a.number ?? a.rule?.id}`,
        {
          source: "code",
          name: a.rule?.description ?? a.rule?.id ?? "Code scanning alert",
          problem: a.most_recent_instance?.location?.path ? `In ${a.most_recent_instance.location.path}` : "Code scanning alert",
          ...(sevOf(a.rule?.security_severity_level ?? a.rule?.severity) ? { severity: sevOf(a.rule?.security_severity_level ?? a.rule?.severity) } : {}),
          ...(a.number ? { id: `#${a.number}` } : {}),
          ...(a.html_url ? { url: a.html_url } : {}),
          ...(a.most_recent_instance?.location?.path ? { file: a.most_recent_instance.location.path } : {}),
        },
      ])
  if (secret.ok)
    for (const a of secret.data as SecretAlert[])
      alerts.push([
        `secret:${a.number ?? a.secret_type}`,
        { source: "secret", name: a.secret_type_display_name ?? "A secret", problem: "GitHub found it in the repo", severity: "high", ...(a.number ? { id: `#${a.number}` } : {}), ...(a.html_url ? { url: a.html_url } : {}) },
      ])
  const n = alerts.length
  return { alerts, fact: n ? `${n} open` : "None open" }
}

/* The folder: packages */

type V2 = {
  vulnerabilities?: Record<string, { name?: string; severity?: string; via?: unknown[]; range?: string; fixAvailable?: boolean | { name?: string; version?: string } }>
  metadata?: { dependencies?: { total?: number }; totalDependencies?: number }
}
type V1Advisory = { module_name?: string; severity?: string; title?: string; patched_versions?: string; github_advisory_id?: string; url?: string; findings?: { version?: string }[] }
type Pkgs = { alerts: [string, RepoAlert][]; total?: number; fact: string; manager?: string }

/** Installed versions from package-lock.json (npm 7 and later, then npm 6). */
function lockVersions(dir: string, d: CheckDeps): (name: string) => string | undefined {
  try {
    if (!d.exists(join(dir, "package-lock.json"))) return () => undefined
    const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> }
    return (name) => lock.packages?.[`node_modules/${name}`]?.version ?? lock.dependencies?.[name]?.version
  } catch {
    return () => undefined
  }
}

/** npm 7+ `npm audit --json`. */
export function readNpmAudit(out: string, versions: (name: string) => string | undefined): Pkgs | null {
  let a: V2
  try {
    a = JSON.parse(out || "{}") as V2
  } catch {
    return null
  }
  if (!a.vulnerabilities && !a.metadata) return null
  const alerts: [string, RepoAlert][] = []
  for (const [key, v] of Object.entries(a.vulnerabilities ?? {})) {
    const name = v.name ?? key
    const own = (v.via ?? []).filter((x): x is { title?: string; url?: string; severity?: string; range?: string } => typeof x === "object" && x !== null)
    if (!own.length) continue
    const fa = v.fixAvailable
    const fixVia = typeof fa === "object" && fa?.name && fa.name !== name ? `${fa.name} ${fa.version ?? ""}`.trim() : fa === true ? "npm audit fix" : undefined
    alerts.push([
      `alert:${name}`,
      packageAlert(
        name,
        versions(name),
        own.map((x) => ({ title: x.title ?? "Security alert", sev: sevOf(x.severity ?? v.severity), id: x.url?.match(/GHSA-[\w-]+/)?.[0], url: x.url, range: x.range, ...(typeof fa === "object" && fa?.name === name ? { fixed: fa.version } : {}) })),
        fixVia,
      ),
    ])
  }
  const total = a.metadata?.dependencies?.total
  return { alerts, ...(total !== undefined ? { total } : {}), fact: "" }
}

/** npm 6, pnpm and Yarn 1: advisories keyed by id. */
function readAdvisories(list: V1Advisory[], total: number | undefined): Pkgs {
  const byPkg = new Map<string, V1Advisory[]>()
  for (const a of list) if (a.module_name) byPkg.set(a.module_name, [...(byPkg.get(a.module_name) ?? []), a])
  const alerts: [string, RepoAlert][] = [...byPkg].map(([name, as]) => [
    `alert:${name}`,
    packageAlert(
      name,
      as[0]?.findings?.[0]?.version,
      as.map((a) => ({ title: a.title ?? "Security alert", sev: sevOf(a.severity), id: a.github_advisory_id, url: a.url, fixed: a.patched_versions?.match(/^>=\s*(\d[\w.-]*)$/)?.[1] })),
    ),
  ])
  return { alerts, ...(total !== undefined ? { total } : {}), fact: "" }
}

async function packages(dir: string, d: CheckDeps): Promise<Pkgs> {
  const has = (f: string) => d.exists(join(dir, f))
  if (has("package-lock.json")) {
    const r = await d.exec("npm", ["audit", "--json"], { cwd: dir, timeoutMs: 60_000 })
    if (r.missing) return { alerts: [], fact: "npm isn’t installed" }
    const p = readNpmAudit(r.stdout, lockVersions(dir, d))
    return p ? { ...p, manager: "npm" } : { alerts: [], fact: "npm audit couldn’t run" }
  }
  if (has("pnpm-lock.yaml")) {
    const r = await d.exec("pnpm", ["audit", "--json"], { cwd: dir, timeoutMs: 60_000 })
    if (r.missing) return { alerts: [], fact: "pnpm isn’t installed" }
    try {
      const a = JSON.parse(r.stdout || "{}") as { advisories?: Record<string, V1Advisory>; metadata?: { totalDependencies?: number } }
      return { ...readAdvisories(Object.values(a.advisories ?? {}), a.metadata?.totalDependencies), manager: "pnpm" }
    } catch {
      return { alerts: [], fact: "pnpm audit couldn’t run" }
    }
  }
  if (has("yarn.lock")) {
    if (has(".yarnrc.yml")) return { alerts: [], fact: "Yarn 2 and later aren’t checked" }
    const r = await d.exec("yarn", ["audit", "--json"], { cwd: dir, timeoutMs: 60_000 })
    if (r.missing) return { alerts: [], fact: "Yarn isn’t installed" }
    const list: V1Advisory[] = []
    let total: number | undefined
    for (const line of r.stdout.split("\n")) {
      try {
        const j = JSON.parse(line) as { type?: string; data?: { advisory?: V1Advisory; totalDependencies?: number } }
        if (j.type === "auditAdvisory" && j.data?.advisory) list.push(j.data.advisory)
        if (j.type === "auditSummary") total = j.data?.totalDependencies
      } catch {}
    }
    return { ...readAdvisories(list, total), manager: "yarn" }
  }
  return { alerts: [], fact: has("package.json") ? "No lockfile" : "No packages" }
}

/* The folder: keys */

const KEYS: [string, string][] = [
  ["AKIA[0-9A-Z]{16}", "an AWS access key"],
  ["sk_(live|test)_[0-9A-Za-z]{20,}", "a Stripe secret"],
  ["sk-ant-[A-Za-z0-9_-]{20,}", "an Anthropic key"],
  ["sk-(proj-)?[A-Za-z0-9_-]{32,}", "an OpenAI key"],
  ["gh[pousr]_[A-Za-z0-9]{36}", "a GitHub token"],
  ["xox[abprs]-[A-Za-z0-9-]{10,}", "a Slack token"],
  ["AIza[0-9A-Za-z_-]{35}", "a Google API key"],
  ["-----BEGIN ([A-Z]+ )?PRIVATE KEY-----", "a private key"],
]
const SKIP = /(^|\/)(node_modules|vendor|dist|build)\/|\.(lock|min\.js|map)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/

/** Possible keys in tracked files: file, what it looks like, its first 4 characters and when the file was committed. */
async function keys(dir: string, d: CheckDeps): Promise<{ alerts: [string, RepoAlert][]; fact: string }> {
  const r = await d.exec("git", ["grep", "-nIoE", ...KEYS.flatMap(([p]) => ["-e", p])], { cwd: dir, timeoutMs: 15_000 })
  const seen = new Map<string, RepoAlert>()
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/^(.+?):(\d+):(.+)$/)
    if (!m || SKIP.test(m[1]!)) continue
    const [, file, , hit] = m as unknown as [string, string, string, string]
    const what = KEYS.find(([p]) => new RegExp(`^${p}`).test(hit))?.[1] ?? "a key"
    const key = `key:${file}:${what}`
    if (!seen.has(key)) seen.set(key, { source: "key", name: file, file, problem: `Looks like ${what}`, severity: "high", id: hit.slice(0, 4) })
  }
  const found = [...seen].slice(0, 20)
  await Promise.all(
    found.map(async ([, a]) => {
      const log = await d.exec("git", ["log", "-1", "--format=%ct", "--", a.file!], { cwd: dir, timeoutMs: 5_000 })
      const t = Number(log.stdout.trim()) * 1000
      if (t > 0) a.committedAt = t
    }),
  )
  return { alerts: found, fact: found.length ? `${found.length} found` : "None found" }
}

/** The steps a repo run shows on a new watch: the sources this watch has. */
export const repoSteps = (sources: { github: boolean; folder: boolean }, at: number): Step[] => {
  const labels = [...(sources.github ? ["GitHub alerts"] : []), ...(sources.folder ? ["Packages", "Leaked keys"] : [])]
  return labels.map((label, i) => ({ label, state: i < at ? "done" : i === at ? "run" : "todo" }))
}

export const SIGNED_OUT = "GitHub CLI isn’t signed in. Run gh auth login"
export const NO_GH = "Install the GitHub CLI to read GitHub alerts"

/**
 * One repo run. `target` is "owner/repo" or a folder; `folder` is the repo's local clone when there is one.
 * The facts show only the sources this watch has.
 */
export async function checkRepo(target: string, d: CheckDeps, folder?: string, onStep?: (steps: Step[]) => void): Promise<Run> {
  const at = d.now()
  const ms = () => Math.round(d.now() - at)
  const github = !isFolder(target)
  const dir = isFolder(target) ? expand(target) : folder ? expand(folder) : undefined
  if (dir && !d.exists(dir)) return { at, ms: ms(), status: "failed", findings: [], error: "That folder doesn’t exist" }
  const sources = { github, folder: !!dir }
  let step = 0
  onStep?.(repoSteps(sources, step))
  const next = () => onStep?.(repoSteps(sources, ++step))
  const versions = dir ? lockVersions(dir, d) : () => undefined
  const facts: [string, string][] = []
  const all = new Map<string, RepoAlert>()
  if (github) {
    const g = await fromGitHub(target, d, versions)
    next()
    if (g.error && !dir) {
      const error = g.error === "missing" ? NO_GH : g.error === "signin" ? SIGNED_OUT : g.error === "unseen" ? `Axe can’t see ${target}` : "GitHub didn’t answer"
      return { at, ms: ms(), status: "failed", findings: [], error }
    }
    facts.push(["GitHub alerts", g.error === "signin" ? "Not signed in" : g.error === "missing" ? "No GitHub CLI" : g.error ? "Couldn’t read" : (g.fact ?? "None open")])
    for (const [k, a] of g.alerts) all.set(k, a)
  }
  if (dir) {
    const [p, k] = await Promise.all([packages(dir, d).finally(next), keys(dir, d)])
    next()
    const affected = new Set(p.alerts.map(([, a]) => a.name)).size
    facts.push(["Packages", p.fact || (p.total !== undefined ? `${p.total}, ${affected ? `${affected} affected` : "none affected"}` : affected ? `${affected} affected` : "None affected")])
    facts.push(["Keys", k.fact])
    // The local clone is the code you have: once its audit runs, a GitHub package alert it doesn't
    // confirm is already fixed here (GitHub closes it after you push). Its rows have the installed version.
    if (p.manager) for (const [key, a] of [...all]) if (a.source === "package" && !p.alerts.some(([k]) => k === key)) all.delete(key)
    for (const [key, a] of [...p.alerts, ...k.alerts]) all.set(key, a)
  }
  const alerts = [...all.values()]
  const findings = [...all].map(([k, a]) => finding(k, a))
  return { at, ms: ms(), status: statusOf(findings), findings, facts, alerts }
}
