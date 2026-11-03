// The sealed link, for real (remote control step 3, docs/remote-control-SECURITY.md section 5): the built
// app and a WebKit iPhone, paired, stream events through a local axe-web; then the API is stopped and
// started again, as a deploy does. Checks the phone is back fast and got every event once, in order.
// node tests/e2e/link-run.mjs <out-dir>
//   needs: AXE_BASE_URL (local web, e.g. http://localhost:3110, proxying /api with WebSockets),
//   AXE_TOKEN / AXE_WEB_TOKEN (desktop and web sign-ins of one account), AXE_API_DIR (axe-web apps/api),
//   AXE_API_ENV (the API's env as JSON: PORT, DATABASE_URL, APP_ORIGIN…); pnpm run build first.
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron, devices, webkit } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
const base = process.env.AXE_BASE_URL
const apiDir = process.env.AXE_API_DIR
const apiEnv = JSON.parse(process.env.AXE_API_ENV ?? "{}")
if (!out || !base || !apiDir || !apiEnv.PORT) throw new Error("See the header for what this needs.")
mkdirSync(out, { recursive: true })
const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-link-run-")))
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)
const fail = (why) => {
  console.error("FAILED:", why)
  process.exitCode = 1
}
const apiURL = `http://127.0.0.1:${apiEnv.PORT}`

let api
async function startAPI() {
  api = spawn(process.execPath, [join(apiDir, "../../node_modules/tsx/dist/cli.mjs"), "src/server.ts"], {
    cwd: apiDir,
    env: { ...process.env, ...apiEnv },
    stdio: ["ignore", "ignore", "inherit"],
  })
  for (const end = Date.now() + 30_000; Date.now() < end; ) {
    if (await fetch(`${apiURL}/api/health`).then((r) => r.ok).catch(() => false)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("The API didn't start.")
}
// Like Docker on a deploy: SIGTERM (the relay closes its sockets with 1012 at once), then SIGKILL
// if long-lived streams keep the old process up.
async function stopAPI() {
  if (api.exitCode !== null) return
  const done = new Promise((r) => api.once("exit", r))
  api.kill("SIGTERM")
  const killer = setTimeout(() => api.kill("SIGKILL"), 3000)
  await done
  clearTimeout(killer)
}

await startAPI()
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: join(root, "data"),
    AXE_DEVICE_NAME: "David's MacBook Pro",
    AXE_PHONE_ALLOW: "1",
    AXE_LINK_TICKS: "200",
  },
})
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const browser = await webkit.launch()

try {
  await win.waitForTimeout(2000)
  await win.evaluate(() => window.axe.invoke("phones:setEnabled", true))
  let code = null
  for (let i = 0; i < 50 && !code; i++) {
    code = await win.evaluate(() => window.axe.invoke("phones:code"))
    if (!code) await win.waitForTimeout(100)
  }
  if (!code) throw new Error("no QR")
  const ctx = await browser.newContext({ ...devices["iPhone 15"] })
  await ctx.addCookies([{ name: "axeai_session", value: process.env.AXE_WEB_TOKEN, url: base }])
  const phone = await ctx.newPage()
  await phone.goto(code.link)
  await phone.getByText("Connected to David's MacBook Pro").waitFor({ timeout: 20_000 })
  log("paired")

  // The phone opens the sealed link to its Mac and keeps every event it gets.
  await phone.evaluate(async () => {
    const { user } = await (await fetch("/api/auth/session")).json()
    const { pairedMacs } = await import("/src/features/remote/phone-keys.ts")
    const { openMacLink } = await import("/src/features/remote/mac-link.ts")
    const [mac] = await pairedMacs(user.id)
    // Every message on the phone's sockets, for the report if something fails.
    window.__wslog = []
    const Native = window.WebSocket
    window.WebSocket = class extends Native {
      constructor(url) {
        super(url)
        this.addEventListener("message", (e) => window.__wslog.push(`in ${String(e.data).slice(0, 60)}`))
        this.addEventListener("close", (e) => window.__wslog.push(`close ${e.code}`))
      }
      send(d) {
        window.__wslog.push(`out ${String(d).slice(0, 60)}`)
        super.send(d)
      }
    }
    window.__ticks = []
    window.__resets = 0
    window.__link = await openMacLink(mac, {
      onEvent: (e) => window.__ticks.push({ id: e.id, at: Date.now() }),
      onReset: () => window.__resets++,
    })
  })
  const ticks = () => phone.evaluate(() => window.__ticks)
  for (let i = 0; i < 100 && (await ticks()).length < 10; i++) await phone.waitForTimeout(100)
  if ((await ticks()).length < 10) {
    const v = await win.evaluate(() => window.axe.invoke("phones:get"))
    const probe = await phone.evaluate(async () => {
      const { phones } = await (await fetch("/api/remote/phones")).json()
      const id = phones[0].id
      const r = await fetch("/api/remote/ws-ticket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: id, mac: phones[0].macKey }) })
      const body = await r.text()
      if (!r.ok) return `ticket ${r.status} ${body}`
      const { ticket } = JSON.parse(body)
      return await new Promise((res) => {
        const ws = new WebSocket(`${location.origin.replace("http", "ws")}/api/relay/phone`)
        ws.onopen = () => ws.send(JSON.stringify({ t: "auth", ticket }))
        ws.onmessage = (e) => res(`message ${e.data}`)
        ws.onclose = (e) => res(`closed ${e.code}`)
        setTimeout(() => res("silent"), 3000)
      })
    }).catch((e) => `probe error ${e.message}`)
    console.log("probe:", probe)
    console.log("phone sockets:", (await phone.evaluate(() => window.__wslog)).slice(0, 12).join("\n  "))
    throw new Error(`no events on the phone: phone link ${await phone.evaluate(() => window.__link.state)}, Mac sees ${JSON.stringify(v.phones.map((p) => p.connected))}`)
  }
  log("streaming:", (await ticks()).length, "events")

  await win.keyboard.press("Meta+Comma")
  await win.getByText(/Connected now\./).waitFor({ timeout: 10_000 })
  await win.locator("#settings-phones").scrollIntoViewIfNeeded()
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(out, "1-mac-phone-connected.png") })

  // A deploy: the API stops (sockets close with 1012) and a new one starts.
  const before = (await ticks()).length
  const t0 = Date.now()
  await stopAPI()
  const down = Date.now()
  await startAPI()
  const up = Date.now()
  log(`API down ${up - down} ms (stop took ${down - t0} ms)`)
  const resumed = async () => (await ticks()).filter((t) => t.at > up).length > 0
  for (let i = 0; i < 250 && !(await resumed()); i++) await phone.waitForTimeout(20)
  const first = (await ticks()).find((t) => t.at > up)
  if (!first) throw new Error("the phone never came back")
  const back = first.at - up
  log(`phone streaming again ${back} ms after the new API was up`)
  if (back > 2000) fail(`took ${back} ms to come back`)

  await phone.waitForTimeout(1500)
  const all = await ticks()
  const ids = all.map((t) => t.id)
  const gaps = ids.filter((id, i) => i > 0 && id !== ids[i - 1] + 1)
  log(`${all.length} events (${all.length - before} after the deploy), ids ${ids[0]} to ${ids.at(-1)}, resets ${await phone.evaluate(() => window.__resets)}`)
  if (gaps.length) fail(`events out of order or missing near ${gaps.slice(0, 5).join(", ")}`)

  // Remove on the Mac: the phone's session ends.
  await win.evaluate(async () => {
    const v = await window.axe.invoke("phones:get")
    await window.axe.invoke("phones:remove", v.phones[0].id)
  })
  await win.getByText("No phones yet").waitFor({ timeout: 10_000 })
  const stateAfter = await phone.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 1500))
    return window.__link.state
  })
  if (stateAfter === "online") fail("the removed phone is still online")
  log("removed on the Mac; phone is", stateAfter)
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
  await win.screenshot({ path: join(out, "failure.png") }).catch(() => {})
} finally {
  await browser.close()
  await app.close()
  await stopAPI().catch(() => {})
}
if (!process.exitCode) log("PASSED")
