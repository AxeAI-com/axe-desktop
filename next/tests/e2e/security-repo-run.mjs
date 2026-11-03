// Security, then Repo alerts, end to end in the real app, with the fix handoff and re-verify.
// Security runs against lane-ceramics.com with its DNS, ports and TLS from a fake-net file
// (AXE_WATCH_FAKE_NET, self-tests only) and its pages from a local server that can send weak headers.
// Repo alerts: the Repo starter's menu, a GitHub repo through a gh stand-in (AXE_WATCH_GH, so no real
// account shows), then a real temp repo with an old express that real Claude Code fixes in the watch's
// thread; Keep all re-checks it straight away and it turns fixed.
// node tests/e2e/security-repo-run.mjs <out-dir> [light|dark] [--no-fix]   (run `pnpm run build` first)
import { execFileSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/security-repo")
const theme = process.argv[3] === "dark" ? "dark" : "light"
const doFix = !process.argv.includes("--no-fix")
mkdirSync(out, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const results = {}
const check = (name, ok, detail = "") => {
  results[name] = !!ok
  log(ok ? "PASS" : "FAIL", name, detail)
}

// lane-ceramics.com's site: good headers, until `weak` drops HSTS.
let weak = false
const GOOD = {
  "strict-transport-security": "max-age=63072000",
  "content-security-policy": "default-src 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
}
const site = createServer((_req, res) => {
  const h = { ...GOOD, "content-type": "text/html" }
  if (weak) delete h["strict-transport-security"]
  res.writeHead(200, h).end("<!doctype html><title>Lane Ceramics</title><h1>Lane Ceramics</h1>")
})
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const tmp = mkdtempSync(join(tmpdir(), "axe-secrepo-"))
const fakeNet = join(tmp, "net.json")
const net = (dmarc) =>
  writeFileSync(
    fakeNet,
    JSON.stringify({
      hosts: {
        "lane-ceramics.com": {
          txt: { "lane-ceramics.com": ["v=spf1 include:_spf.google.com ~all"], "_dmarc.lane-ceramics.com": [dmarc] },
          mx: ["aspmx.l.google.com"],
          ports: [80, 443],
          tls: { days: 74, version: "TLSv1.3" },
          http: `http://127.0.0.1:${site.address().port}`,
          slow: 400,
        },
      },
    }),
  )
net("v=DMARC1; p=none")

// gh: mia's repos, and Dependabot alerts on mia/shop-web (express and semver, as in the design).
const ghAlerts = JSON.stringify([
  { number: 1, dependency: { package: { name: "express" } }, security_advisory: { ghsa_id: "GHSA-rv95-896h-c2vc", summary: "Open redirect", severity: "high" }, security_vulnerability: { severity: "high", first_patched_version: { identifier: "4.19.2" } } },
  { number: 2, dependency: { package: { name: "semver" } }, security_advisory: { ghsa_id: "GHSA-c2qf-rxjj-qqgw", summary: "Slow regex", severity: "medium" }, security_vulnerability: { severity: "medium", first_patched_version: { identifier: "7.5.2" } } },
])
const gh = join(tmp, "gh")
writeFileSync(
  gh,
  `#!/bin/sh
case "$*" in
  "repo list"*) printf 'mia/shop-web\\nmia/lane-theme\\n' ;;
  "api repos/mia/shop-web --jq"*) echo mia/shop-web ;;
  "api repos/mia/shop-web/dependabot/alerts"*) cat <<'JSON'
${ghAlerts}
JSON
  ;;
  "api repos/mia/shop-web/"*) echo 'gh: Advanced Security must be enabled for this repository (HTTP 403)' >&2; exit 1 ;;
  *) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
esac
`,
)
chmodSync(gh, 0o755)

// The real temp repo: express 4.18.2 with its lockfile, committed.
const code = join(tmp, "code", "shop-web")
mkdirSync(join(tmp, "code"), { recursive: true })
cpSync(resolve("tests/fixtures/old-express"), code, { recursive: true })
const git = (...a) => execFileSync("git", ["-C", code, "-c", "user.email=demo@example.com", "-c", "user.name=Demo", ...a], { encoding: "utf8" })
git("init", "-q", "-b", "main")
git("add", ".")
git("commit", "-qm", "start")

const data = mkdtempSync(join(tmpdir(), "axe-secrepo-data-"))
const notifyLog = join(data, "notes.jsonl")
const clipLog = join(data, "clipboard.txt")
// The agent list comes from the ACP registry; fetch it once so a slow CDN can't leave it empty.
const registry = await fetch("https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json", { signal: AbortSignal.timeout(15_000) })
  .then((r) => r.text())
  .catch(() => {
    try {
      return execFileSync("curl", ["-sf", "-m", "20", "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"], { encoding: "utf8" })
    } catch {
      return ""
    }
  })
if (registry) writeFileSync(join(data, "acp-registry.json"), registry)

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_NOTIFY_LOG: notifyLog, AXE_CLIPBOARD_LOG: clipLog, AXE_WATCH_FAKE_NET: fakeNet, AXE_WATCH_GH: gh, AXE_DATA_DIR: data },
})
app.process().stderr?.on("data", (d) => process.env.AXE_E2E_VERBOSE && process.stderr.write(`[app] ${d}`))
await app.evaluate(({ dialog }, d) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] })
}, code)
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}-${theme}.png`) })
const notices = () => (existsSync(notifyLog) ? readFileSync(notifyLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
await win.waitForTimeout(2500)
// Claude Code answers (the watch's model), so "Fix with Claude Code" is the label.
const catalog = await win.evaluate(() => window.axe.invoke("models:refresh"))
const claude = catalog.agents.find((a) => /claude/i.test(a.name) && a.state === "ready")
log("agents:", catalog.agents.map((a) => `${a.name}:${a.state}`).join(", "))
await win.evaluate(([t, a]) => window.axe.invoke("settings:set", { theme: t, ...(a ? { answerer: { kind: "agent", agentId: a } } : {}) }), [theme, claude?.id])
await win.reload()
await win.waitForTimeout(2000)
await win.keyboard.press("Escape").catch(() => {})

const main = win.getByRole("main")
const box = () => win.getByRole("textbox").last()
const watchingPage = () => win.getByRole("button", { name: /^Watching/ }).first().click()
const titleMenu = async (item) => {
  await win.locator('header button[aria-haspopup="menu"]').first().click()
  await win.getByRole("menuitem", { name: new RegExp(item) }).click()
}
const ticks = () => win.evaluate(() => document.querySelector('[data-testid="watch-strip"]')?.querySelectorAll("g").length ?? 0)
const checkNow = async () => {
  const before = await ticks()
  await titleMenu("Check now")
  await win.waitForFunction((n) => (document.querySelector('[data-testid="watch-strip"]')?.querySelectorAll("g").length ?? 0) > n || (n === 0 && !!document.querySelector('[data-testid="watch-strip"]')), before, { timeout: 60_000 })
  await win.waitForTimeout(400)
}
const starter = async (label) => {
  await win.getByPlaceholder(/^(Say what to watch|Watch something else)$/).click()
  await win.getByTestId("catalogue").getByRole("button", { name: `Add ${label}` }).click({ timeout: 5000 })
  await win.waitForTimeout(200)
}
const rest = async () => {
  await win.mouse.move(1300, 120)
  await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await win.waitForTimeout(300)
}

try {
  /* Security */
  await watchingPage()
  await win.getByText("What should Axe watch?").waitFor()
  await starter("Security")
  check("security chip and placeholder", (await win.getByPlaceholder("Domain, like lane-ceramics.com").count()) === 1)
  await shot("sec-01-ask")

  await box().fill("lane-ceramcs.com")
  await box().press("Enter")
  await win.getByText("lane-ceramcs.com doesn’t exist. Check the spelling.").waitFor()
  await rest()
  await shot("sec-02-invalid")

  await box().fill("https://lane-ceramics.com/pricing")
  await box().press("Enter")
  await win.getByRole("button", { name: "Start watching" }).waitFor()
  check("security plan", await main.getByText("Every morning I’ll check lane-ceramics.com’s email records, certificate, TLS and headers, and open ports.").isVisible())
  check("security bubble", await main.getByText("Check lane-ceramics.com for security problems.").isVisible())
  await rest()
  await shot("sec-03-plan")

  await win.getByRole("button", { name: "Start watching" }).click()
  await win.getByText("Checking now").waitFor()
  await win.waitForTimeout(500)
  await shot("sec-04-first-run")
  check("security steps", (await main.innerText()).includes("Open ports"))
  await main.getByText("One thing to fix. Everything else looks right.").waitFor({ timeout: 30_000 })
  await rest()
  await shot("sec-05-first-result")
  const first = await main.innerText()
  check("security folded plan", first.includes("Watching. Every morning at 7:30, tells you right away."))
  check("security rows", ["Email records", "Spoofable", "74 days left", "TLS 1.3", "80 and 443 only"].every((t) => first.includes(t)), first.split("\n").slice(0, 30).join(" | "))
  check("security problem card", first.includes("Anyone can send email as lane-ceramics.com") && first.includes('_dmarc.lane-ceramics.com TXT "v=DMARC1; p=none"'))
  check("first run doesn't notify", notices().length === 0)
  // The sidebar counts it on Watching's badge; watches never list themselves there.
  check("sidebar badge counts the problem", await win.getByRole("button", { name: /^Watching, 1 problem/ }).first().isVisible())

  await checkNow()
  await rest()
  await shot("sec-06-problem")

  await main.getByRole("button", { name: "Copy record" }).click()
  await main.getByText("Copied. When you’ve changed it, I’ll check again. DNS can take an hour.").waitFor()
  const clip = existsSync(clipLog) ? readFileSync(clipLog, "utf8").trim() : ""
  check("copy record copies the new value", clip === "v=DMARC1; p=quarantine; rua=mailto:dmarc@lane-ceramics.com")
  await rest()
  await shot("sec-07-copied")

  await main.getByRole("button", { name: "Check now" }).click()
  await main.getByText("The record hasn’t changed yet. I’ll check again in an hour.").waitFor({ timeout: 30_000 })
  await rest()
  await shot("sec-08-unchanged")

  net("v=DMARC1; p=quarantine; rua=mailto:dmarc@lane-ceramics.com")
  await main.getByRole("button", { name: "Check now" }).click()
  await main.getByTestId("fixed-card").waitFor({ timeout: 30_000 })
  await rest()
  await shot("sec-09-fixed")
  const fixedText = await main.innerText()
  check("security fixed", fixedText.includes("Mail that fakes lane-ceramics.com now goes to spam.") && /Anyone could send email as lane-ceramics\.com\./.test(fixedText), fixedText.split("\n").slice(-14).join(" | "))
  check("fixed doesn't notify", notices().length === 0)

  weak = true
  await checkNow()
  await main.getByTestId("problem-header:hsts").waitFor({ timeout: 30_000 })
  await rest()
  await shot("sec-10-header")
  check("header finding is an agent fix", await main.getByTestId("problem-header:hsts").getByRole("button", { name: /^Fix with / }).isVisible())
  const n = notices().at(-1)
  check("header notice", n?.body === "lane-ceramics.com sends no HSTS header." && n?.actions?.[0]?.id === "fix", JSON.stringify(n))
  weak = false

  /* Repo alerts: the starter makes a repo watch, never security */
  await watchingPage()
  await starter("Repo alerts")
  check("repo chip, never security", (await win.getByPlaceholder("Repo or folder, like mia/shop-web").count()) === 1 && (await win.getByPlaceholder("Domain, like lane-ceramics.com").count()) === 0)
  await win.getByRole("menu", { name: "Repos and folders" }).waitFor()
  await win.waitForTimeout(300)
  await shot("repo-01-menu")
  const menuText = await win.getByRole("menu", { name: "Repos and folders" }).innerText()
  check("repo menu", menuText.includes("Your repos") && menuText.includes("mia/shop-web") && menuText.includes("Choose folder…"), menuText.replace(/\n/g, " | "))

  await box().fill("mia/shop-api")
  await box().press("Enter")
  await win.getByText("Axe can’t see mia/shop-api. Check the name, or sign in with gh auth login.").waitFor()
  await rest()
  await shot("repo-02-invalid")

  // Arrows and Return pick from the menu.
  await box().fill("")
  await box().click()
  await win.getByRole("menu", { name: "Repos and folders" }).waitFor()
  await box().press("Enter")
  await win.getByRole("button", { name: "Start watching" }).waitFor()
  check("repo plan", await main.getByText("Every morning I’ll check shop-web for new security alerts, vulnerable packages and leaked keys.").isVisible())
  check("repo bubble", await main.getByText("Tell me about new security alerts in shop-web.").isVisible())
  check("title says New watch", (await win.locator("header").first().innerText()).includes("New watch"))
  await rest()
  await shot("repo-03-plan")
  await win.getByRole("button", { name: "Start watching" }).click()
  await main.getByTestId("problem-repo").waitFor({ timeout: 30_000 })
  await rest()
  await shot("repo-04-problem")
  const card = await main.getByTestId("problem-repo").innerText()
  check("repo card", card.includes("2 new security alerts in shop-web") && card.includes("Both are in packages with a fixed version out.") && card.includes("Open redirect, high. Fixed in 4.19.2") && card.includes("GHSA-rv95-896h-c2vc"), card.replace(/\n/g, " | "))
  check("watch is repo kind", (await win.evaluate(() => window.axe.invoke("watching:list"))).watches.some((w) => w.kind === "repo" && w.target === "mia/shop-web"))

  // Fix with Claude Code asks which folder has the code, once.
  await main.getByRole("button", { name: /^Fix with / }).click()
  await main.getByText("Which folder has the code for shop-web?").waitFor()
  await rest()
  await shot("repo-05-which-folder")
  await main.getByRole("button", { name: "Choose folder…" }).click()
  await main.getByText(/ in .*shop-web$/).first().waitFor()
  log("fix started")
  await win.waitForTimeout(800)
  await shot("repo-06-fix-started")
  // The folder's real audit now drives the alerts: stop this one here, the real fix follows on a folder watch.
  await win.evaluate(async () => {
    const list = await window.axe.invoke("watching:list")
    const w = list.watches.find((x) => x.kind === "repo")
    const t = w?.fixes.at(-1)?.threadId
    if (t) await window.axe.invoke("chat:stop", t)
  })

  /* The real fix: a folder watch on the temp repo, fixed by Claude Code */
  await watchingPage()
  await starter("Repo alerts")
  await win.getByRole("menu", { name: "Repos and folders" }).waitFor()
  await win.getByRole("menuitem", { name: "Choose folder…" }).click()
  await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 30_000 })
  await win.getByRole("button", { name: "Start watching" }).click()
  await win.getByText("Checking now").waitFor()
  await shot("repo-07-first-run")
  await main.getByTestId("problem-repo").waitFor({ timeout: 90_000 })
  await rest()
  await shot("repo-08-folder-problem")
  const fcard = await main.getByTestId("problem-repo").innerText()
  check("folder audit card", /\d+ new security alerts in shop-web/.test(fcard) && fcard.includes("express 4.18.2"), fcard.replace(/\n/g, " | "))

  if (doFix && claude) {
    await main.getByRole("button", { name: "Fix with Claude Code" }).click()
    // Plan mode: the plan card's Start.
    const start = main.getByTestId("fix-turn").getByRole("button", { name: "Start", exact: true })
    await start.waitFor({ timeout: 300_000 })
    await rest()
    await shot("repo-09-fix-plan")
    check("fix composer talks to the agent", (await win.getByPlaceholder("Reply to Claude Code").count()) === 1)
    await start.click()
    // Answer the agent's questions (edits and npm install) until its files are ready to keep.
    const keep = main.getByRole("button", { name: "Keep all" })
    for (let i = 0; i < 120 && !(await keep.isVisible().catch(() => false)); i++) {
      const allow = main.getByRole("button", { name: /^(Allow|Always allow|Yes|Allow once)/ }).first()
      if (await allow.isVisible().catch(() => false)) await allow.click().catch(() => {})
      await win.waitForTimeout(2500)
    }
    await rest()
    await shot("repo-10-fix-changes")
    check("agent changed files", await keep.isVisible())
    await keep.click()
    await main.getByTestId("fixed-card").waitFor({ timeout: 120_000 })
    await rest()
    await shot("repo-11-fixed")
    const done = await main.innerText()
    check("repo fixed after keep", done.includes("No open alerts in shop-web.") && done.includes("Kept"), done.split("\n").slice(-16).join(" | "))
    const pkg = readFileSync(join(code, "package.json"), "utf8")
    check("express updated in the repo", !/"express":\s*"4\.18\.2"/.test(pkg), pkg.match(/"express":\s*"[^"]+"/)?.[0])
    check("agent didn't commit", git("log", "--oneline").trim().split("\n").length === 1)
  } else log("skipped the real fix", doFix ? "(Claude Code isn't ready)" : "(--no-fix)")

  // The list and the sidebar.
  await watchingPage()
  await win.waitForTimeout(600)
  await rest()
  await shot("list-security-repo")
  const threads = await win.evaluate(() => window.axe.invoke("threads:list"))
  const sidebar = await win.locator("aside").first().innerText().catch(() => "")
  check("fix sessions stay out of Recents", threads.filter((t) => t.watchId).every((t) => !sidebar.includes(t.title)), threads.filter((t) => t.watchId).map((t) => t.title).join(", "))
} catch (e) {
  await shot("fail").catch(() => {})
  log("ERROR", e.message.split("\n")[0])
  results.error = false
} finally {
  await app.close().catch(() => {})
  site.close()
}
const failed = Object.entries(results).filter(([, v]) => !v)
log(`${Object.keys(results).length - failed.length} passed, ${failed.length} failed${failed.length ? `: ${failed.map(([k]) => k).join(", ")}` : ""}`)
process.exit(failed.length ? 1 : 0)
