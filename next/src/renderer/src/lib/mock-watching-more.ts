import { statusOf } from "@shared/watching/findings"
import type { CheckRow, Finding, MoreKind, OpenFinding, Run } from "@shared/watching/types"

// The More kinds for the mock engine: what each one's first run finds on lane-ceramics.com (the
// placeholder site), and the watches ?mock=watchmore adds: failing tests, a service outage, the update
// feed and disk space. Real runs are in tests/e2e/watching-more-run.mjs.

const run = (at: number, o: Partial<Run> = {}): Run => ({ at, ms: 600, findings: [], ...o, status: statusOf(o.findings ?? []) })

export const TESTS_FAIL: Finding = {
  key: "tests:failing",
  level: "problem",
  headline: "Tests fail in shop-web",
  line: "Tests fail: 2 failed, 118 passed.",
  detail: "pnpm test ended with 2 failed, 118 passed.",
  fix: "agent",
}

export const CLOUDFLARE: Finding = {
  key: "status:cloudflare:major",
  level: "problem",
  headline: "Cloudflare reports an outage",
  line: "Cloudflare: Slow DNS in Frankfurt.",
  detail: "Slow DNS in Frankfurt. From www.cloudflarestatus.com.",
  fix: "none",
}

const STATUS_ROWS = (cloudflareOk: boolean) => [
  { label: "GitHub", sub: "www.githubstatus.com", value: "Running normally", ok: true },
  { label: "Cloudflare", sub: "www.cloudflarestatus.com", value: cloudflareOk ? "Running normally" : "Major outage", ok: cloudflareOk },
  { label: "Groq", sub: "groqstatus.com", value: "Running normally", ok: true },
  { label: "Infura", sub: "status.infura.io", value: "Running normally", ok: true },
]

const FEED_ROWS = [
  { label: "Lane-0.8.0-arm64.dmg", sub: "Mac", value: "154 MB", ok: true },
  { label: "Lane-0.8.0-arm64-mac.zip", sub: "Mac", value: "154 MB", ok: true },
  { label: "Lane-Setup-0.8.0.exe", sub: "Windows", value: "128 MB", ok: true },
  { label: "Lane-0.8.0-x86_64.AppImage", sub: "Linux", value: "151 MB", ok: true },
]
const FEED_FACTS: [string, string][] = [
  ["Mac", "0.8.0"],
  ["Windows", "0.8.0"],
  ["Linux", "0.8.0"],
]

/** A draft's first run, as the real check would read lane-ceramics.com. */
export function moreFirstRun(kind: MoreKind, at: number): Run {
  switch (kind) {
    case "health":
      return run(at, { facts: [["ok", "true"], ["db.latencyMs", "3 ms"], ["Answered in", "240 ms"]], metric: 3 })
    case "expiry":
      // The registry keeps the domain's date to itself: the plan says so.
      return run(at, { rows: [{ label: "Certificate", sub: "78 days left", value: "Jan 18, 2027", ok: true }, { label: "Domain", sub: "lane-ceramics.com", value: "Not in public RDAP", ok: true }], facts: [["Certificate", "Jan 18, 2027"]] })
    case "dns":
      return run(at, {
        rows: [
          { label: "A", sub: "2 records", value: "104.21.31.24, 172.67.174.171", ok: true },
          { label: "NS", sub: "2 records", value: "melissa.ns.cloudflare.com, terin.ns.cloudflare.com", ok: true },
          { label: "MX", sub: "2 records", value: "10 mx2.hostinger.com, 5 mx1.hostinger.com", ok: true },
          { label: "TXT", sub: "2 records", value: "v=spf1 include:_spf.mail.hostinger.com ~all, google-site…", ok: true },
        ],
      })
    case "status":
      return run(at, { rows: STATUS_ROWS(true) })
    case "feed":
      return run(at, { rows: FEED_ROWS, facts: FEED_FACTS })
    case "seo":
      return run(at, {
        rows: [
          { label: "robots.txt", value: "Lets crawlers in", ok: true },
          { label: "sitemap.xml", value: "29 pages", ok: true },
          { label: "llms.txt", value: "28 lines", ok: true },
          { label: "Key pages", sub: "5 checked", value: "None set to noindex", ok: true },
        ],
      })
    case "links":
      return run(at, { facts: [["Pages", "29"]] })
    case "tests":
      return run(at, { facts: [["Command", "pnpm test"]] })
    case "outdated":
      return run(at, {
        findings: [{ key: "outdated:major", level: "problem", headline: "2 packages are a major version behind", line: "2 packages a major version behind.", fix: "agent", value: 2 }],
        rows: [
          { label: "express", value: "4.21.2 to 5.1.0", ok: false },
          { label: "postgres", value: "3.4.9 to 4.0.0", ok: false },
        ],
        facts: [["Manager", "pnpm"], ["Behind a major", "2"]],
      })
    case "disk":
      return run(at, { facts: [["Free", "382 GB"], ["Of", "995 GB"], ["Tell me under", "20 GB"]], metric: 382 })
  }
}

/** ?mock=watchmore: four More watches, two with a problem from this morning. */
export function moreSample(T: number, HOUR: number, DAY: number) {
  const at = T - 2 * HOUR
  const open = (f: Finding): OpenFinding => ({ ...f, openedAt: at, lastSeenAt: at, notified: true })
  const daily = (n: number, mk: (t: number) => Run) => Array.from({ length: n }, (_, i) => mk(T - (n - i) * DAY))
  const hourly = (n: number, mk: (t: number) => Run) => Array.from({ length: n }, (_, i) => mk(T - (n - i) * HOUR))
  const passing = (t: number) => run(t, { facts: [["Command", "pnpm test"], ["Result", "120 passed"], ["Took", "41 s"]] })
  const failing = run(at, { findings: [TESTS_FAIL], facts: [["Command", "pnpm test"], ["Result", "2 failed, 118 passed"], ["Took", "44 s"]], output: "FAIL tests/cart.test.ts > applies the gift wrap discount\nExpected 38, received 42" })
  return [
    { kind: "tests" as const, id: "w-tests", target: "~/Code/shop-web", every: "morning" as const, folder: "~/Code/shop-web", runs: [...daily(6, passing), failing], open: [open(TESTS_FAIL)] },
    {
      kind: "status" as const,
      id: "w-status",
      target: "github, cloudflare, groq, infura",
      every: "15m" as const,
      runs: [...hourly(24, (t) => run(t, { rows: STATUS_ROWS(true) })), run(at, { findings: [CLOUDFLARE], rows: STATUS_ROWS(false) })],
      open: [open(CLOUDFLARE)],
    },
    { kind: "feed" as const, id: "w-feed", target: "lane-ceramics.com/downloads", every: "1h" as const, runs: hourly(24, (t) => run(t, { rows: FEED_ROWS, facts: FEED_FACTS })), open: [] },
    { kind: "disk" as const, id: "w-disk", target: "/", every: "1h" as const, runs: hourly(24, (t) => moreFirstRun("disk", t)), open: [] },
  ]
}

/**
 * ?mock=watchdash: ten watches like a real owner's on axeai.com, for the dashboard. Two need a look (packages a
 * major behind, a Cloudflare outage) and the links check is running. Values are the ones a real run read on
 * 2026-11-01 (tests/e2e/watching-more-run.mjs).
 */
export function dashSample(T: number, HOUR: number, DAY: number) {
  const at = T - 3 * HOUR - 18 * 60_000
  const open = (f: Finding): OpenFinding => ({ ...f, openedAt: at, lastSeenAt: T - 20 * 60_000, notified: true })
  const ago = 39 * 60_000
  const hourly = (n: number, mk: (t: number, i: number) => Run, last = ago) => Array.from({ length: n }, (_, i) => mk(T - last - (n - 1 - i) * HOUR, i))
  const outdated: Finding = { key: "outdated:major", level: "problem", headline: "4 packages are a major version behind", line: "4 packages a major version behind.", fix: "agent", value: 4 }
  const cloudflare: Finding = {
    key: "status:cloudflare:major",
    level: "problem",
    headline: "Cloudflare reports an outage",
    line: "Cloudflare: Partial System Outage.",
    detail: "Partial System Outage. From www.cloudflarestatus.com.",
    fix: "none",
  }
  const services = (cfOk: boolean): CheckRow[] => [
    { label: "OpenRouter", value: "Not readable: no public status feed", ok: false },
    { label: "Groq", sub: "groqstatus.com", value: "Running normally", ok: true },
    { label: "Cloudflare", sub: "www.cloudflarestatus.com", value: cfOk ? "Running normally" : "Partial System Outage", ok: cfOk },
    { label: "Infura", sub: "status.infura.io", value: "Running normally", ok: true },
    { label: "PostHog", value: "Not readable: no public status feed", ok: false },
    { label: "GitHub", sub: "www.githubstatus.com", value: "Running normally", ok: true },
  ]
  const PKGS = [
    { label: "electron", value: "38.4.0 to 39.1.0", ok: false },
    { label: "vite", value: "6.3.5 to 7.1.2", ok: false },
    { label: "@biomejs/biome", value: "1.9.4 to 2.2.0", ok: false },
    { label: "electron-builder", value: "25.1.8 to 26.0.12", ok: false },
  ]
  const cert = Date.UTC(2027, 0, 18)
  const certDays = Math.floor((cert - T) / DAY)
  const ms = [552, 571, 560, 604, 566, 583, 548, 612, 575, 590, 562, 598, 587]
  return [
    {
      kind: "health" as const,
      id: "d-health",
      target: "axeai.com/api/health",
      every: "5m" as const,
      runs: hourly(24, (t, i) => run(t, { ms: ms[(i + 11) % ms.length]!, facts: [["ok", "true"], ["db.latencyMs", "1 ms"], ["Answered in", `${ms[(i + 11) % ms.length]} ms`]], metric: 1, http: "200" }), 0),
      open: [],
    },
    { kind: "links" as const, id: "d-links", target: "axeai.com", every: "1h" as const, runs: hourly(23, (t) => run(t, { facts: [["Pages", "29"], ["Load", "29"]] })), open: [], checking: true },
    { kind: "feed" as const, id: "d-feed", target: "axeai.com/download", every: "1h" as const, runs: hourly(24, (t) => run(t, { rows: [{ label: "Axe-AI-0.8.0-arm64.dmg", sub: "Mac", value: "154 MB", ok: true }], facts: [["Mac", "0.8.0"]] })), open: [] },
    { kind: "seo" as const, id: "d-seo", target: "axeai.com", every: "morning" as const, runs: hourly(24, (t) => run(t, { rows: [{ label: "sitemap.xml", value: "29 pages", ok: true }] })), open: [] },
    { kind: "dns" as const, id: "d-dns", target: "axeai.com", every: "1h" as const, runs: hourly(24, (t) => moreFirstRun("dns", t)), open: [] },
    {
      kind: "expiry" as const,
      id: "d-expiry",
      target: "axeai.com",
      every: "morning" as const,
      runs: hourly(24, (t) => run(t, { rows: [{ label: "Certificate", sub: `${certDays} days left`, value: "Jan 18, 2027", ok: true }, { label: "Domain", sub: "axeai.com, 370 days left", value: "Nov 7, 2027", ok: true }], facts: [["Certificate", "Jan 18, 2027"], ["Domain", "Nov 7, 2027"]], metric: certDays })),
      open: [],
    },
    {
      kind: "status" as const,
      id: "d-status",
      target: "openrouter, groq, cloudflare, infura, posthog, github",
      every: "15m" as const,
      runs: [...hourly(21, (t) => run(t, { rows: services(true) }), 4 * HOUR), ...hourly(3, (t) => run(t, { findings: [cloudflare], rows: services(false) }), 20 * 60_000)],
      open: [open(cloudflare)],
    },
    { kind: "tests" as const, id: "d-tests", target: "~/Work/axe-business/axe-web", every: "morning" as const, folder: "~/Work/axe-business/axe-web", runs: hourly(24, (t) => run(t, { facts: [["Command", "pnpm test"], ["Result", "412 passed"], ["Took", "48 s"]] })), open: [] },
    {
      kind: "outdated" as const,
      id: "d-outdated",
      target: "~/Work/axe-business/axe-mac/next",
      every: "morning" as const,
      folder: "~/Work/axe-business/axe-mac/next",
      runs: [...hourly(21, (t) => run(t, { facts: [["Manager", "pnpm"], ["Behind a major", "0"]], metric: 0 }), 4 * HOUR), ...hourly(3, (t) => run(t, { findings: [outdated], rows: PKGS, facts: [["Manager", "pnpm"], ["Behind a major", "4"]], metric: 4 }))],
      open: [open(outdated)],
    },
    { kind: "disk" as const, id: "d-disk", target: "/", every: "1h" as const, runs: hourly(24, (t) => run(t, { facts: [["Free", "382 GB"], ["Of", "994 GB"], ["Tell me under", "20 GB"]], metric: 382 })), open: [] },
  ]
}
