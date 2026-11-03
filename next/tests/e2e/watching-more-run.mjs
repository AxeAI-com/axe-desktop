// The ten More kinds in the real app: each one drafted and started on its real target (axeai.com, the
// status pages, this repo, axe-web, this Mac's disk), then a failing case for each on targets made here:
// a local site (health not ok and slow, a feed naming a file that 404s, SEO blocked, a sitemap page that
// 500s, a status page in an outage, a domain about to expire) reached through AXE_WATCH_FAKE_NET, fake DNS
// that changes between runs, a folder whose tests fail, a folder with an old major, and a disk limit no
// Mac meets. Prints one line per case and saves the list and a problem watch, light and dark.
// node tests/e2e/watching-more-run.mjs [out-dir]   (run `pnpm run build` first; needs no account, needs the network)
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/watching-more")
mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), "axe-more-"))
const DAY = 86_400_000

// The local site behind lane-ceramics.test (and rdap.org, for its domain's date).
const html = (body, head = "") => `<!doctype html><html><head><title>Lane Ceramics</title>${head}</head><body>${body}</body></html>`
const site = createServer((req, res) => {
  const url = req.url ?? "/"
  const json = (code, v) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(v))
  if (url === "/api/health") return void setTimeout(() => json(200, { ok: false, db: { latencyMs: 2400 }, version: "1.4.2" }), 1200)
  if (url === "/downloads/latest-mac.yml")
    return void res
      .writeHead(200, { "content-type": "text/yaml" })
      .end("version: 0.9.0\nfiles:\n  - url: Lane-0.9.0-arm64.zip\n    size: 12\n  - url: Lane-0.9.0-arm64.dmg\n    size: 12\npath: Lane-0.9.0-arm64.zip\n")
  if (url === "/downloads/Lane-0.9.0-arm64.zip") return void res.writeHead(206, { "content-range": "bytes 0-0/12", "content-length": 1 }).end("x")
  if (url === "/robots.txt") return void res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /\n")
  if (url === "/sitemap.xml") {
    const locs = ["/", "/shop", "/about", "/journal"].map((p) => `<url><loc>https://lane-ceramics.test${p}</loc></url>`).join("")
    return void res.writeHead(200, { "content-type": "application/xml" }).end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>`)
  }
  if (url === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(html("<h1>Lane Ceramics</h1>", '<meta name="robots" content="noindex">'))
  if (url === "/shop" || url === "/about") return void res.writeHead(200, { "content-type": "text/html" }).end(html(`<h1>${url}</h1>`))
  if (url === "/journal") return void res.writeHead(500, { "content-type": "text/html" }).end(html("Internal Server Error"))
  if (url === "/api/v2/status.json") return json(200, { status: { indicator: "major", description: "Partial System Outage" } })
  if (url === "/api/v2/incidents/unresolved.json") return json(200, { incidents: [{ name: "Checkout API errors" }] })
  if (url === "/domain/lane-ceramics.test") return json(200, { events: [{ eventAction: "expiration", eventDate: new Date(Date.now() + 12 * DAY).toISOString() }] })
  res.writeHead(404, { "content-type": "text/plain" }).end("Not found")
})
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const http = `http://127.0.0.1:${site.address().port}`

// Fake DNS, TLS and web for lane-ceramics.test; the file is read on every call, so DNS can change mid-run.
const fakeNet = join(tmp, "net.json")
const net = (a, ns) =>
  writeFileSync(
    fakeNet,
    JSON.stringify({
      hosts: {
        "lane-ceramics.test": { http, tls: { days: 5, version: "TLSv1.3" }, a, ns, mx: ["mx1.lane-mail.net"], txt: { "lane-ceramics.test": ["v=spf1 include:lane-mail.net -all"] } },
        "rdap.org": { http },
      },
    }),
  )
net(["203.0.113.7"], ["ns1.lane-dns.net", "ns2.lane-dns.net"])

// A folder whose tests fail, and one with a package a major version behind.
const failing = join(tmp, "shop-tests")
mkdirSync(failing)
writeFileSync(join(failing, "package.json"), JSON.stringify({ name: "shop-tests", private: true, scripts: { test: "node run.mjs" } }))
writeFileSync(join(failing, "run.mjs"), 'console.log("not ok 4 - cart total includes tax")\nconsole.log("# pass 3")\nconsole.log("# fail 1")\nprocess.exit(1)\n')
const old = join(tmp, "shop-old")
mkdirSync(old)
writeFileSync(join(old, "package.json"), JSON.stringify({ name: "shop-old", private: true, dependencies: { "is-number": "6.0.0" } }))
let oldReady = true
try {
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--silent"], { cwd: old, stdio: "ignore", timeout: 120_000 })
} catch {
  oldReady = false
}

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: join(tmp, "data"),
    AXE_BASE_URL: "http://localhost:1",
    AXE_WATCH_FAKE_NET: fakeNet,
    AXE_NOTIFY_LOG: join(tmp, "notes.jsonl"),
  },
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
await win.waitForTimeout(2500)

const invoke = (cmd, ...args) => win.evaluate(([c, a]) => window.axe.invoke(c, ...a), [cmd, args])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** What a run found, on one line. */
function said(v) {
  const r = v.latest
  if (!r) return "no run"
  const bits = []
  if (r.error) bits.push(`error: ${r.error}`)
  const problems = r.findings.filter((f) => f.level === "problem").map((f) => f.headline)
  const news = r.findings.filter((f) => f.level === "news").map((f) => f.headline)
  if (problems.length) bits.push(`problems: ${problems.join("; ")}`)
  if (news.length) bits.push(`news: ${news.join("; ")}`)
  if (r.facts?.length) bits.push(r.facts.map(([a, b]) => `${a} ${b}`).join(", "))
  if (r.rows?.length) bits.push(r.rows.map((x) => `${x.label}: ${x.value}`).join(", "))
  return `${r.status}. ${bits.join(" | ")}`
}

async function settle(id, timeout = 120_000) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await invoke("watching:get", id)
    if (v?.latest && !v.steps) return v
    if (Date.now() > end) throw new Error(`${v?.name}: the first run never ended`)
    await sleep(1000)
  }
}

const results = []
let bad = 0
/** Drafts and starts a watch; `expect` is "quiet" for a real target or "problem" for a failing case. */
async function prove(label, input, expect, after) {
  const t = Date.now()
  const dr = await invoke("watching:draft", input)
  if ("error" in dr) {
    bad++
    return void console.log(`FAIL ${label}: draft said ${dr.error}`)
  }
  const w = await invoke("watching:create", dr)
  let v = await settle(w.id)
  if (after) v = await after(v)
  const status = v.latest.status
  const ok = expect === "problem" ? status === "problem" : status !== "failed" && status !== "problem" ? true : expect === "any" && status !== "failed"
  if (!ok) bad++
  const line = `${ok ? "ok  " : "FAIL"} ${label} (${Math.round((Date.now() - t) / 1000)} s): ${said(v)}`
  results.push(line)
  console.log(line)
  return v
}

try {
  // Real targets. Status and outdated can honestly find a problem today (an outage, a package behind),
  // so they only have to read their target.
  await prove("health axeai.com/api/health", { kind: "health", target: "axeai.com/api/health" }, "quiet")
  await prove("expiry axeai.com", { kind: "expiry", target: "axeai.com" }, "quiet")
  await prove("dns axeai.com", { kind: "dns", target: "axeai.com" }, "quiet")
  await prove("status github, cloudflare, groq, infura", { kind: "status", target: "github, cloudflare, groq, infura" }, "any")
  await prove("feed axeai.com/downloads/desktop", { kind: "feed", target: "axeai.com/downloads/desktop" }, "quiet")
  await prove("seo axeai.com", { kind: "seo", target: "axeai.com" }, "any")
  await prove("links axeai.com", { kind: "links", target: "axeai.com" }, "quiet")
  await prove("tests axe-mac/next", { kind: "tests", target: "~/Work/axe-business/axe-mac/next", command: "npx vitest run tests/unit/watching-summary.test.ts" }, "quiet")
  await prove("outdated axe-web", { kind: "outdated", target: "~/Work/axe-business/axe-web" }, "any")
  await prove("disk 20 GB", { kind: "disk", target: "20 GB" }, "quiet")

  // Failing cases.
  const health = await prove("health failing", { kind: "health", target: "lane-ceramics.test/api/health" }, "problem")
  await prove("expiry failing", { kind: "expiry", target: "lane-ceramics.test" }, "problem")
  await prove("dns failing", { kind: "dns", target: "lane-ceramics.test" }, "problem", async (v) => {
    // The address moves and the name servers go: news for A, a problem for NS.
    net(["203.0.113.9"], [])
    await invoke("watching:checkNow", v.id)
    return settle(v.id)
  })
  await prove("status failing", { kind: "status", target: "github, status.lane-ceramics.test" }, "problem")
  await prove("feed failing", { kind: "feed", target: "lane-ceramics.test/downloads/latest-mac.yml" }, "problem")
  await prove("seo failing", { kind: "seo", target: "lane-ceramics.test" }, "problem")
  await prove("links failing", { kind: "links", target: "lane-ceramics.test" }, "problem")
  await prove("tests failing", { kind: "tests", target: failing }, "problem")
  if (oldReady) await prove("outdated failing", { kind: "outdated", target: old }, "problem")
  else console.log("skip outdated failing: npm install of is-number@6 needs the registry and it didn't answer")
  await prove("disk failing", { kind: "disk", target: "100000 GB" }, "problem")

  // The list and one problem watch, light and dark.
  for (const theme of ["light", "dark"]) {
    await invoke("settings:set", { theme })
    await win.reload()
    await win.waitForTimeout(2000)
    await win.keyboard.press("Escape").catch(() => {})
    await win.getByRole("button", { name: /^Watching/ }).first().click()
    const main = win.getByRole("main")
    await main.getByText(health.name, { exact: true }).first().waitFor()
    await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    await win.waitForTimeout(600)
    await win.screenshot({ path: join(out, `list-${theme}.png`) })
    await main.getByText(health.name, { exact: true }).first().click()
    await main.getByText("lane-ceramics.test/api/health says it isn’t ok", { exact: false }).first().waitFor()
    await win.waitForTimeout(600)
    await win.screenshot({ path: join(out, `health-problem-${theme}.png`) })
  }
} catch (e) {
  await win.screenshot({ path: join(out, "fail.png") }).catch(() => {})
  throw e
} finally {
  await app.close()
  site.close()
}
console.log(bad ? `${bad} failed` : "all passed", out)
if (bad) process.exitCode = 1
