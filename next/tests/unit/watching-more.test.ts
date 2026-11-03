import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { DEFAULT_EVERY, planSentence, rowLine, sentence } from "@shared/watching/copy"
import { cleanFolder, cleanServices, gigabytes } from "@shared/watching/more"
import { parseRead } from "@shared/watching/read"
import { cleanTarget } from "@shared/watching/target"

import type { CheckDeps } from "../../src/main/watching/checks/deps"
import { checkDisk, checkOutdated, checkTests, majorsBehind, testSummary } from "../../src/main/watching/checks/local"
import { checkDns, checkExpiry, checkHealth, checkStatus, numbersIn, okOf, registered } from "../../src/main/watching/checks/web-health"
import { blocksAll, checkFeed, checkLinks, checkSeo, feedsOf, parseFeed } from "../../src/main/watching/checks/web-site"

// The ten More kinds with fake deps: no network, no npm, no disk. Their real targets are proven in
// tests/e2e/watching-more-run.mjs.

const res = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(status === 204 ? null : body, { status, headers })
const json = (v: unknown, status = 200) => res(JSON.stringify(v), status, { "content-type": "application/json" })
const NOW = Date.parse("2026-11-01T08:00:00Z")
const DAY = 86_400_000

/** Fake deps; `web` answers by URL (a function or a fixed Response maker). */
const fake = (web: Record<string, () => Response> = {}, d: Partial<CheckDeps> = {}): CheckDeps => ({
  fetch: async (url) => {
    const hit = web[url]
    if (!hit) throw new Error(`getaddrinfo ENOTFOUND ${new URL(url).hostname}`)
    return hit()
  },
  now: () => NOW,
  sleep: async () => {},
  resolveTxt: async () => [],
  connect: async () => false,
  tls: async () => ({ days: 78, version: "TLSv1.3", valid: true }),
  exec: async () => ({ stdout: "", code: 0 }),
  exists: () => true,
  home: () => "/Users/mia",
  addresses: async () => ["93.184.216.34"],
  ...d,
})

describe("targets and words", () => {
  it("cleans each kind's target", () => {
    expect(cleanTarget("health", "https://axeai.com/api/health")).toBe("axeai.com/api/health")
    expect(cleanTarget("expiry", "https://www.axeai.com/pricing")).toBe("axeai.com")
    expect(cleanTarget("dns", "axeai.com")).toBe("axeai.com")
    expect(cleanTarget("feed", "axeai.com/downloads/desktop/latest-mac.yml")).toBe("axeai.com/downloads/desktop/latest-mac.yml")
    expect(cleanTarget("links", "https://axeai.com/")).toBe("axeai.com")
    expect(cleanTarget("tests", "~/Code/shop-web/")).toBe("~/Code/shop-web")
    expect(cleanTarget("tests", "~/Desktop/shop")).toBeNull()
    expect(cleanTarget("outdated", "~/Downloads")).toBeNull()
    expect(cleanTarget("outdated", "shop-web")).toBeNull()
    expect(cleanTarget("disk", "20 GB")).toBe("/")
    expect(cleanTarget("disk", "")).toBe("/")
    expect(cleanTarget("status", "GitHub, Cloudflare and groq")).toBe("github, cloudflare, groq")
  })
  it("services, folders and sizes", () => {
    expect(cleanServices("Infura status & PostHog")).toBe("infura, posthog")
    expect(cleanServices("status.example.com")).toBe("status.example.com")
    expect(cleanServices("my favourite thing")).toBeNull()
    for (const bad of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "[::1]", "::1", "0x7f.1", "localhost", "printer.local", "db.internal", "status"])
      expect(cleanServices(bad), bad).toBeNull()
    expect(cleanFolder("/Users/mia/Library/x", "/Users/mia")).toBeNull()
    expect(cleanFolder("/Users/mia/Code/x", "/Users/mia")).toBe("~/Code/x")
    expect(gigabytes("below 15 GB")).toBe(15)
    expect(gigabytes("1.5 TB")).toBe(1500)
  })
  it("sentences, plans and defaults", () => {
    expect(sentence("status", "github, groq")).toBe("Tell me when GitHub and Groq have a problem.")
    expect(sentence("disk", "/", undefined, 15)).toBe("Tell me when this Mac has less than 15 GB free.")
    expect(DEFAULT_EVERY.tests).toBe("morning")
    expect(planSentence("health", "axeai.com/api/health", "5m", "now", { field: "db.latencyMs", limit: 200 })).toBe(
      "I’ll read axeai.com/api/health every 5 minutes and tell you unless it says ok and db.latencyMs under 200 ms.",
    )
    const first = { at: NOW, ms: 0, status: "quiet" as const, findings: [], rows: [{ label: "Domain", value: "Not in public RDAP", ok: true }] }
    expect(planSentence("expiry", "lane.io", "morning", "now", { first })).toMatch(/I couldn’t read everything: Domain: not in public RDAP\.$/)
    expect(rowLine("disk", { ...first, rows: undefined, facts: [["Free", "382 GB"]] })).toBe("382 GB free.")
  })
  it("reads the new kinds, a limit and a field from the model", () => {
    expect(parseRead('{"kind":"health","target":"axeai.com/api/health","limit":200,"field":"db.latencyMs"}')).toEqual({ kind: "health", target: "axeai.com/api/health", limit: 200, field: "db.latencyMs" })
    expect(parseRead('{"kind":"disk","target":null,"limit":20}')).toEqual({ kind: "disk", limit: 20 })
  })
})

describe("health", () => {
  const url = "https://axeai.com/api/health"
  it("ok, with its times under the limit", async () => {
    const r = await checkHealth("axeai.com/api/health", fake({ [url]: () => json({ ok: true, db: { latencyMs: 3 } }) }))
    expect(r.status).toBe("quiet")
    expect(r.facts?.slice(0, 2)).toEqual([
      ["ok", "true"],
      ["db.latencyMs", "3 ms"],
    ])
    expect(r.metric).toBe(3)
  })
  it("not ok, and a number over its limit", async () => {
    const r = await checkHealth("axeai.com/api/health", fake({ [url]: () => json({ ok: false, db: { latencyMs: 450 } }, 503) }), { limit: 200, field: "db.latencyMs" })
    expect(r.findings.map((f) => f.key)).toEqual(["health:status", "health:notok", "health:limit:db.latencyMs"])
    expect(r.findings[2]!.headline).toBe("db.latencyMs is 450 ms")
  })
  it("a page that isn't JSON fails plainly", async () => {
    const r = await checkHealth("axeai.com/api/health", fake({ [url]: () => res("<html>") }))
    expect(r).toMatchObject({ status: "failed", error: "It answered, but not with JSON" })
  })
  it("refuses a redirect to a link-local or private address", async () => {
    const asked: string[] = []
    const d = fake({ [url]: () => res("", 302, { location: "http://169.254.169.254/latest/meta-data/" }), "http://169.254.169.254/latest/meta-data/": () => json({ ok: true }) })
    const r = await checkHealth("axeai.com/api/health", { ...d, fetch: (u, i) => (asked.push(String(u)), d.fetch(u, i)) })
    expect(r).toMatchObject({ status: "failed", error: expect.stringMatching(/local or private/i) })
    expect(asked).toEqual([url])
  })
  it("checks every hop of a redirect chain, by name too", async () => {
    const asked: string[] = []
    const web = {
      [url]: () => res("", 301, { location: "https://status.axe.example/h" }),
      "https://status.axe.example/h": () => res("", 302, { location: "https://inside.axe.example/h" }),
      "https://inside.axe.example/h": () => json({ ok: true }),
    }
    const d = fake(web, { addresses: async (h) => (h === "inside.axe.example" ? ["10.0.0.7"] : ["93.184.216.34"]) })
    const r = await checkHealth("axeai.com/api/health", { ...d, fetch: (u, i) => (asked.push(`${u} ${i?.pin?.join(",") ?? "-"}`), d.fetch(u, i)) })
    expect(r).toMatchObject({ status: "failed", error: expect.stringMatching(/local or private/i) })
    // The chosen host isn't looked up (it's yours); the next hop is, and goes to the address that was checked.
    expect(asked).toEqual([`${url} -`, "https://status.axe.example/h 93.184.216.34"])
  })
  it("finds numbers and ok words", () => {
    expect(numbersIn({ a: 1, b: { c: 2, d: "x" } })).toEqual([
      ["a", 1],
      ["b.c", 2],
    ])
    expect(okOf({ status: "degraded" })).toEqual({ ok: false, said: 'status is "degraded"' })
    expect(registered("www.shop.lane.co.uk")).toBe("lane.co.uk")
  })
})

describe("expiry", () => {
  const rdap = { "https://data.iana.org/rdap/dns.json": () => json({ services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] }) }
  it("reads the certificate and the domain's date from the registry", async () => {
    const r = await checkExpiry("axeai.com", fake({ ...rdap, "https://rdap.verisign.com/com/v1/domain/axeai.com": () => json({ events: [{ eventAction: "expiration", eventDate: "2027-11-07T19:31:46Z" }] }) }))
    expect(r.status).toBe("quiet")
    expect(r.rows?.map((x) => x.value)).toEqual(["Jan 18, 2027", "Nov 7, 2027"])
  })
  it("a certificate and a domain about to run out; RDAP's silence is said plainly", async () => {
    const soon = new Date(NOW + 10 * DAY).toISOString()
    const r = await checkExpiry("lane.com", fake({ ...rdap, "https://rdap.verisign.com/com/v1/domain/lane.com": () => json({ events: [{ eventAction: "expiration", eventDate: soon }] }) }, { tls: async () => ({ days: 5, version: "TLSv1.3" }) }))
    expect(r.findings.map((f) => f.key)).toEqual(["cert:expiring", "domain:expiring"])
    expect(r.findings[1]!.headline).toBe("lane.com expires in 10 days")
    const none = await checkExpiry("lane.com", fake({ ...rdap, "https://rdap.verisign.com/com/v1/domain/lane.com": () => res("", 404) }))
    expect(none.rows?.[1]).toMatchObject({ label: "Domain", value: "Not in public RDAP", ok: true })
  })
})

describe("dns", () => {
  const recs = (a: Record<string, string[]>) => fake({}, { records: async (_h, t) => a[t] ?? [] })
  it("saves the records, then tells what changed", async () => {
    const was = { A: ["1.1.1.1"], NS: ["a.ns.cloudflare.com"], MX: ["5 mx1.hostinger.com"], TXT: ["v=spf1 -all"] }
    const first = await checkDns("lane.com", recs(was))
    expect(first.run.status).toBe("quiet")
    expect(first.run.rows?.map((r) => r.label)).toEqual(["A", "NS", "MX", "TXT"])
    const next = await checkDns("lane.com", recs({ ...was, MX: ["5 mx1.zoho.com"] }), first.memo)
    expect(next.run.findings).toHaveLength(1)
    expect(next.run.findings[0]).toMatchObject({ level: "news", headline: "The MX record for lane.com changed", detail: "Added “5 mx1.zoho.com”. Removed “5 mx1.hostinger.com”." })
    const gone = await checkDns("lane.com", recs({ ...was, A: [] }), first.memo)
    expect(gone.run.findings.map((f) => f.key)).toEqual(["dns:none:A"])
  })
})

describe("status", () => {
  it("reads each Statuspage feed and says which can't be read", async () => {
    const r = await checkStatus(
      "github, cloudflare, openrouter",
      fake({
        "https://www.githubstatus.com/api/v2/status.json": () => json({ status: { indicator: "none", description: "All Systems Operational" } }),
        "https://www.cloudflarestatus.com/api/v2/status.json": () => json({ status: { indicator: "major", description: "Partial System Outage" } }),
        "https://www.cloudflarestatus.com/api/v2/incidents/unresolved.json": () => json({ incidents: [{ name: "Slow DNS in Frankfurt" }] }),
      }),
    )
    expect(r.rows?.map((x) => [x.label, x.value])).toEqual([
      ["GitHub", "Running normally"],
      ["Cloudflare", "Major outage"],
      ["OpenRouter", "Not readable: no public status feed"],
    ])
    expect(r.findings).toEqual([expect.objectContaining({ key: "status:cloudflare:major", headline: "Cloudflare reports an outage", line: "Cloudflare: Slow DNS in Frankfurt." })])
    const local = await checkStatus("127.0.0.1", fake({ "https://127.0.0.1/api/v2/status.json": () => json({ status: { indicator: "none" } }) }))
    expect(local.status).toBe("failed")
    const none = await checkStatus("openrouter", fake())
    expect(none).toMatchObject({ status: "failed", error: "I can’t read a status for OpenRouter" })
  })
})

describe("update feed", () => {
  const MAC = "version: 0.8.0\nfiles:\n  - url: Axe-0.8.0-arm64.dmg\n    sha512: x\n    size: 100\n  - url: Axe-0.8.0-arm64-mac.zip\n    size: 90\npath: Axe-0.8.0-arm64.dmg\n"
  const base = "https://lane.com/dl"
  const file = (size: number, status = 206) => () => res("x", status, status === 206 ? { "content-range": `bytes 0-0/${size}` } : {})
  it("parses electron-builder's yml", () => {
    expect(parseFeed(MAC)).toEqual({ version: "0.8.0", files: [{ url: "Axe-0.8.0-arm64.dmg", size: 100 }, { url: "Axe-0.8.0-arm64-mac.zip", size: 90 }] })
    expect(feedsOf("lane.com/dl").map(([u]) => u.split("/").pop())).toEqual(["latest-mac.yml", "latest.yml", "latest-linux.yml"])
  })
  it("every file downloads; then a new version is news and a missing file a problem", async () => {
    const web = { [`${base}/latest-mac.yml`]: () => res(MAC), [`${base}/Axe-0.8.0-arm64.dmg`]: file(100), [`${base}/Axe-0.8.0-arm64-mac.zip`]: file(90) }
    const first = await checkFeed("lane.com/dl/latest-mac.yml", fake(web))
    expect(first.run.status).toBe("quiet")
    expect(first.run.facts).toEqual([["Mac", "0.8.0"]])
    const next = await checkFeed("lane.com/dl/latest-mac.yml", fake({ [`${base}/latest-mac.yml`]: () => res(MAC.replaceAll("0.8.0", "0.8.1")), [`${base}/Axe-0.8.1-arm64.dmg`]: file(100), [`${base}/Axe-0.8.1-arm64-mac.zip`]: () => res("", 404) }), first.memo)
    expect(next.run.findings.map((f) => [f.key, f.level])).toEqual([
      ["version:latest-mac.yml:0.8.1", "news"],
      ["file:Axe-0.8.1-arm64-mac.zip", "problem"],
    ])
    expect(next.run.findings[1]!.line).toBe("Axe-0.8.1-arm64-mac.zip doesn’t download (404).")
  })
})

describe("seo and links", () => {
  const site = (o: { robots?: string; noindex?: boolean; llms?: boolean; broken?: boolean } = {}) => ({
    "https://lane.com/robots.txt": () => res(o.robots ?? "User-agent: *\nAllow: /\n", 200, { "content-type": "text/plain" }),
    "https://lane.com/llms.txt": () => (o.llms === false ? res("<!doctype html>", 404, { "content-type": "text/html" }) : res("# Lane\n", 200, { "content-type": "text/plain" })),
    "https://lane.com/sitemap.xml": () => res("<urlset><url><loc>https://lane.com/</loc></url><url><loc>https://lane.com/shop</loc></url></urlset>"),
    "https://lane.com/": () => res(o.noindex ? '<meta name="robots" content="noindex">' : "<p>Home</p>"),
    "https://lane.com/shop": () => res("<p>Shop</p>", o.broken ? 500 : 200),
  })
  it("all there", async () => {
    const r = await checkSeo("lane.com", fake(site()))
    expect(r.status).toBe("quiet")
    expect(r.rows?.map((x) => x.value)).toEqual(["Lets crawlers in", "2 pages", "1 line", "None set to noindex"])
  })
  it("blocks everything, no llms.txt, the home page noindex", async () => {
    expect(blocksAll("User-agent: Googlebot\nDisallow: /\n")).toBe(false)
    const r = await checkSeo("lane.com", fake(site({ robots: "User-agent: *\nDisallow: /", llms: false, noindex: true })))
    expect(r.findings.map((f) => f.key)).toEqual(["seo:blockall", "seo:llms", "seo:noindex:/"])
    expect(r.findings[2]!.headline).toBe("The home page is set to noindex")
  })
  it("links: every page in the sitemap, a broken one is a problem", async () => {
    const steps: string[] = []
    const r = await checkLinks("lane.com", fake(site({ broken: true })), (s) => steps.push(s.at(-1)!.label))
    expect(r.findings).toEqual([expect.objectContaining({ key: "link:/shop", headline: "/shop doesn’t load", line: "/shop doesn’t load (500)." })])
    expect(r.facts?.slice(0, 2)).toEqual([
      ["Pages", "2"],
      ["Broken", "1"],
    ])
    expect(steps.at(-1)).toBe("Loading 2 pages, 2 done")
  })
})

describe("tests, packages and disk", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "axe-more-")))
  mkdirSync(join(dir, "shop"))
  writeFileSync(join(dir, "shop/package.json"), JSON.stringify({ scripts: { test: "vitest run" } }))
  writeFileSync(join(dir, "shop/pnpm-lock.yaml"), "")
  const real = (d: Partial<CheckDeps>) => fake({}, { exists: (p) => existsSync(p), ...d })

  it("reads test runners' summaries", () => {
    expect(testSummary("\n Test Files  2 passed (2)\n      Tests  3 failed | 40 passed (43)\n")).toBe("3 failed, 40 passed")
    expect(testSummary("Tests:       1 failed, 9 passed, 10 total")).toBe("1 failed, 9 passed, 10 total")
    expect(testSummary("# pass 4\n# fail 1")).toBe("1 failed, 4 passed")
  })
  it("runs the folder's own test script and tells when it fails", async () => {
    const ran: string[] = []
    const pass = await checkTests(join(dir, "shop"), real({ run: async (c, a) => (ran.push([c, ...a].join(" ")), { stdout: "Tests  12 passed (12)", code: 0 }) }))
    expect(ran).toEqual(["pnpm test"])
    expect(pass.facts?.[1]).toEqual(["Result", "12 passed"])
    const fail = await checkTests(join(dir, "shop"), real({ run: async () => ({ stdout: "boom\nTests  1 failed | 11 passed (12)", code: 1 }) }))
    expect(fail.findings[0]).toMatchObject({ key: "tests:failing", line: "Tests fail: 1 failed, 11 passed.", fix: "agent" })
    expect(fail.output).toContain("boom")
    expect(await checkTests(join(dir, "none"), real({}))).toMatchObject({ status: "failed", error: "That folder doesn’t exist" })
  })
  it("packages a major version behind, from npm and pnpm", async () => {
    expect(majorsBehind(JSON.stringify({ react: { current: "18.3.1", latest: "19.2.0" }, zod: { current: "4.1.0", latest: "4.2.0" }, katex: { current: "0.18.1", latest: "0.19.0" } }))?.map((b) => b.name)).toEqual(["katex", "react"])
    expect(majorsBehind("not json")).toBeNull()
    const r = await checkOutdated(join(dir, "shop"), real({ run: async () => ({ stdout: JSON.stringify({ react: { current: "18.3.1", latest: "19.2.0" } }), code: 1 }) }))
    expect(r.findings[0]).toMatchObject({ key: "outdated:major", headline: "react is a major version behind", fix: "agent" })
    expect(r.rows).toEqual([{ label: "react", value: "18.3.1 to 19.2.0", ok: false }])
  })
  it("disk space under the limit", async () => {
    const d = fake({}, { disk: async () => ({ free: 12e9, total: 500e9 }) })
    expect((await checkDisk("/", d)).findings[0]).toMatchObject({ key: "disk:low", headline: "Only 12 GB free on this Mac" })
    expect((await checkDisk("/", d, { limit: 10 })).status).toBe("quiet")
  })
})
