// The Available elements in the real app, hidden (AXE_SELFTEST, AXE_HEADLESS, its own data folder): each
// element drafted and started on a real target (this Mac's processes, memory, battery, ports, Docker, the
// git repos in ~/Work, Homebrew, Software Update, Time Machine, the home folder, the network; axeai.com and
// public chain, search, DNS and probe data), then a failing case for each one that can be set up here: a CPU
// burner held for 11 minutes on the self-test clock, a server that stops, a container that stops, a clone left
// behind its remote, a folder that grows, limits no Mac or chain meets, a page whose picture shows after 5 s,
// a mail server on 127.0.0.2 (listed on every blacklist by convention), a private repo. Prints one line per
// case and saves the dashboard and the catalogue, light and dark.
// node tests/e2e/watching-elements-run.mjs [out-dir]   (run `pnpm run build` first; needs no account, needs the network)
import { execFileSync, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { deflateSync } from "node:zlib"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/watching-elements")
mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), "axe-elements-"))
const clockFile = join(tmp, "clock")
writeFileSync(clockFile, "0")

// A real 900 by 600 PNG (an SVG or a stretched pixel doesn't count as the largest paint).
const crc = (b) => {
  let c = ~0
  for (const x of b) {
    c ^= x
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(900, 0)
ihdr.writeUInt32BE(600, 4)
ihdr[8] = 8
ihdr[9] = 2
// Random pixels: Chrome leaves low-detail images (a flat colour) out of the largest paint.
const rows = Buffer.concat(Array.from({ length: 600 }, () => Buffer.concat([Buffer.from([0]), randomBytes(900 * 3)])))
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])

// A page whose only picture arrives after 5 s (LCP over 4 s), and a server for Dev servers to watch.
const site = createServer((req, res) => {
  if (req.url === "/slow.png") return void setTimeout(() => res.writeHead(200, { "content-type": "image/png" }).end(PNG), 5000)
  res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html><body style="margin:0"><img src="/slow.png" width="900" height="600"></body></html>')
})
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const port = site.address().port

// A mail server at 127.0.0.2, the address every DNS blacklist lists on purpose for tests.
const fakeNet = join(tmp, "net.json")
writeFileSync(fakeNet, JSON.stringify({ hosts: { "lane-mail.test": { mx: ["relay.lane-post.test"] }, "relay.lane-post.test": { a: ["127.0.0.2"] } } }))

// A clone that falls behind: a bare remote, the clone, and a second clone that pushes.
const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=Mia Lane", "-c", "user.email=mia@lane-ceramics.test", ...a], { cwd, stdio: "pipe" })
const repos = join(tmp, "repos")
mkdirSync(repos)
git(tmp, "init", "--bare", "-b", "main", join(tmp, "remote.git"))
git(repos, "clone", join(tmp, "remote.git"), "shop-web")
writeFileSync(join(repos, "shop-web", "a.txt"), "a")
git(join(repos, "shop-web"), "add", ".")
git(join(repos, "shop-web"), "commit", "-m", "a")
git(join(repos, "shop-web"), "push", "-u", "origin", "main")
git(tmp, "clone", join(tmp, "remote.git"), "other")

// A folder that grows.
const grow = join(tmp, "grow")
mkdirSync(join(grow, "cache"), { recursive: true })

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: join(tmp, "data"),
    AXE_BASE_URL: "http://localhost:1",
    AXE_WATCH_FAKE_NET: fakeNet,
    AXE_WATCH_CLOCK: clockFile,
    AXE_NOTIFY_LOG: join(tmp, "notes.jsonl"),
  },
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
await win.waitForTimeout(2500)

const invoke = (cmd, ...args) => win.evaluate(([c, a]) => window.axe.invoke(c, ...a), [cmd, args])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  return `${r.status}. ${bits.join(" | ")}`
}

async function settle(id, timeout = 400_000, after = 0) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await invoke("watching:get", id)
    if (v?.latest && v.latest.at > after && !v.steps && !v.checking) return v
    if (Date.now() > end) throw new Error(`${v?.name}: the run never ended`)
    await sleep(1000)
  }
}

let bad = 0
const lines = []
const log = (ok, label, t, text) => {
  if (!ok) bad++
  const line = `${ok ? "ok  " : "FAIL"} ${label} (${Math.round((Date.now() - t) / 1000)} s): ${text}`
  lines.push(line)
  console.log(line)
}

/** Drafts and starts a watch. `expect`: "quiet" (a real target that's fine), "any" (real, may find something), "problem", or "error: <words>" for a draft that must refuse. */
async function prove(label, input, expect) {
  const t = Date.now()
  const dr = await invoke("watching:draft", input)
  if ("error" in dr) return void log(expect.startsWith("error") && dr.error.includes(expect.slice(7)), label, t, `draft says: ${dr.error}`)
  if (expect.startsWith("error")) return void log(false, label, t, `draft didn't refuse: ${dr.plan}`)
  const w = await invoke("watching:create", dr)
  const v = await settle(w.id)
  const s = v.latest.status
  log(expect === "problem" ? s === "problem" : expect === "quiet" ? s === "quiet" || s === "news" : s !== "failed", label, t, said(v))
  return v
}

/** Runs a watch again (after the world changed) and checks what it says. */
async function again(label, v, expect, before) {
  const t = Date.now()
  if (before) await before()
  const at = (await invoke("watching:get", v.id)).latest.at
  await invoke("watching:checkNow", v.id)
  const n = await settle(v.id, 400_000, at)
  log(expect === "problem" ? n.latest.status === "problem" : n.latest.status !== "failed" && n.latest.status !== "problem", label, t, said(n))
  return n
}

let burner
try {
  // This Mac, real.
  await prove("processes", { kind: "processes", target: "" }, "any")
  await prove("memory", { kind: "memory", target: "" }, "quiet")
  await prove("battery", { kind: "battery", target: "" }, "quiet")
  const ports = await prove(`ports :${port}`, { kind: "ports", target: `${port}` }, "quiet")
  await prove("docker", { kind: "docker", target: "" }, "any")
  await prove("gitrepos ~/Work/axe-business", { kind: "gitrepos", target: "~/Work/axe-business" }, "any")
  await prove("brew", { kind: "brew", target: "" }, "quiet")
  await prove("macos", { kind: "macos", target: "" }, "quiet")
  await prove("timemachine (this Mac has no backup disk)", { kind: "timemachine", target: "" }, "error: Time Machine has no backup disk set up")
  await prove("hogs ~", { kind: "hogs", target: "~" }, "quiet")
  await prove("network", { kind: "network", target: "" }, "quiet")
  // Web, real.
  await prove("pagespeed axeai.com", { kind: "pagespeed", target: "axeai.com" }, "any")
  await prove("wallets (public EVM, Tron and Solana addresses)", { kind: "wallets", target: "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE, TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL, 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }, "quiet")
  await prove("fees", { kind: "fees", target: "" }, "quiet")
  await prove("mentions Axe AI", { kind: "mentions", target: "Axe AI" }, "quiet")
  await prove("email axeai.com", { kind: "email", target: "axeai.com" }, "quiet")
  await prove("global axeai.com", { kind: "global", target: "axeai.com" }, "any")
  await prove("competitor page axeai.com/pricing", { kind: "page", target: "axeai.com/pricing" }, "quiet")
  await prove("downloads electron/electron", { kind: "downloads", target: "electron/electron" }, "quiet")

  // Failing cases, set up here.
  burner = spawn("/usr/bin/yes", [], { stdio: "ignore" })
  await sleep(4000)
  const hog = await prove("processes, a CPU burner (first sight)", { kind: "processes", target: "", limit: 50 }, "any")
  await again("processes, the burner 11 minutes later", hog, "problem", async () => writeFileSync(clockFile, String(11 * 60_000)))
  burner.kill()
  burner = undefined
  writeFileSync(clockFile, "0")
  await prove("battery under a 90% health line", { kind: "battery", target: "", limit: 90 }, "problem")
  await again(`ports :${port} after its server stops`, ports, "problem", () => new Promise((r) => site.close(r)))
  let docker = false
  try {
    execFileSync("docker", ["run", "-d", "--name", "axe-el-test", "alpine:3.20", "sleep", "600"], { stdio: "ignore", timeout: 120_000 })
    docker = true
    const dv = await prove("docker with axe-el-test running", { kind: "docker", target: "" }, "any")
    await again("docker after axe-el-test stops", dv, "problem", async () => execFileSync("docker", ["stop", "-t", "1", "axe-el-test"], { stdio: "ignore" }))
  } catch (e) {
    log(false, "docker failing case", Date.now(), `couldn't start a container: ${e.message.split("\n")[0]}`)
  } finally {
    if (docker) execFileSync("docker", ["rm", "-f", "axe-el-test"], { stdio: "ignore" })
  }
  await prove("gitrepos, a clone behind its remote", { kind: "gitrepos", target: repos }, "quiet").then((v) =>
    again("gitrepos after another clone pushes", v, "problem", async () => {
      writeFileSync(join(tmp, "other", "b.txt"), "b")
      git(join(tmp, "other"), "add", ".")
      git(join(tmp, "other"), "commit", "-m", "b")
      git(join(tmp, "other"), "push")
    }),
  )
  const gv = await prove("hogs, a folder that grows", { kind: "hogs", target: grow, limit: 0.003 }, "quiet")
  await again("hogs after 8 MB lands in it", gv, "problem", async () => writeFileSync(join(grow, "cache", "big.bin"), Buffer.alloc(8_000_000, 1)))
  await prove("network under 100000 Mbps", { kind: "network", target: "", limit: 100000 }, "problem")
  await prove("pagespeed, a page whose picture shows after 5 s", { kind: "pagespeed", target: await slowSite() }, "problem")
  await prove("wallets, not an address", { kind: "wallets", target: "lane-ceramics.com" }, "error: Give 0x")
  await prove("fees over $0.000001", { kind: "fees", target: "", limit: 0.000001 }, "problem")
  await prove("email, a mail server on 127.0.0.2", { kind: "email", target: "lane-mail.test" }, "problem")
  await prove("global over 1 ms", { kind: "global", target: "axeai.com", limit: 1 }, "problem")
  await prove("downloads, a private repo", { kind: "downloads", target: "AxeAI-com/axe-mac" }, "error: doesn’t exist on GitHub, or it’s private")

  // The dashboard and the catalogue, light and dark.
  for (const theme of ["light", "dark"]) {
    await invoke("settings:set", { theme })
    await win.reload()
    await win.waitForTimeout(2000)
    await win.keyboard.press("Escape").catch(() => {})
    await win.getByRole("button", { name: /^Watching/ }).first().click()
    await win.getByTestId("dashboard").waitFor()
    await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    await win.waitForTimeout(800)
    await win.screenshot({ path: join(out, `dashboard-${theme}.png`) })
    await win.getByTestId("group-mac").evaluate((el) => el.scrollIntoView({ block: "start" }))
    await win.waitForTimeout(500)
    await win.screenshot({ path: join(out, `mac-${theme}.png`) })
    await win.getByRole("heading", { name: "Available elements" }).evaluate((el) => el.scrollIntoView({ block: "start" }))
    await win.waitForTimeout(500)
    await win.screenshot({ path: join(out, `catalogue-${theme}.png`) })
  }
  // Add from the catalogue in the real window: Memory pressure goes straight to its plan.
  await win.getByTestId("catalogue").getByRole("button", { name: "Add Memory pressure" }).click()
  await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 30_000 })
  await win.screenshot({ path: join(out, "add-memory-dark.png") })
  log(true, "Add Memory pressure opens its plan in the real window", Date.now(), "Start watching shows")
} catch (e) {
  await win.screenshot({ path: join(out, "fail.png") }).catch(() => {})
  throw e
} finally {
  burner?.kill()
  await app.close()
  site.close()
}

/** A second slow-picture server (the first one was stopped for Dev servers). */
async function slowSite() {
  const s = createServer((req, res) => {
    if (req.url === "/slow.png") return void setTimeout(() => res.writeHead(200, { "content-type": "image/png" }).end(PNG), 5000)
    res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html><body style="margin:0"><img src="/slow.png" width="900" height="600"></body></html>')
  })
  await new Promise((r) => s.listen(0, "127.0.0.1", r))
  return `localhost:${s.address().port}`
}

writeFileSync(join(out, "results.txt"), `${lines.join("\n")}\n`)
console.log(bad ? `${bad} failed` : "all passed", out)
process.exit(bad ? 1 : 0)
