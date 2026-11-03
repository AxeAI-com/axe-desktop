// Pairing a phone, for real (remote control step 2, docs/remote-control-SECURITY.md): the built app
// signed in to a local axe-web, and a WebKit iPhone on the same account.
// 1. Settings, Use from your phone: turn it on, a QR appears.
// 2. An Android phone scans it with the page's own camera (a fake camera showing the Mac's QR); the Mac
//    asks "Connect David's Android phone?" and gets Not me. The phone hears no.
// 3. An iPhone opens the next QR's link (what its Camera app does); the Mac asks; Allow. The phone says
//    Connected; the Mac lists it.
// 4. The same QR again, from a third phone: the code was used, nothing reaches the Mac.
// 5. Remove on axeai.com: the Mac drops the phone at once.
// node tests/e2e/phone-pair-run.mjs <out-dir>
//   needs AXE_BASE_URL (the local web, e.g. http://localhost:3110), AXE_TOKEN (a desktop sign-in) and
//   AXE_WEB_TOKEN (a web sign-in of the same account); pnpm run build first.
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, _electron as electron, devices, webkit } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
const base = process.env.AXE_BASE_URL
if (!out || !base || !process.env.AXE_TOKEN || !process.env.AXE_WEB_TOKEN) throw new Error("See the header for what this needs.")
mkdirSync(out, { recursive: true })
const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-phone-pair-")))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const fail = (why) => {
  console.error("FAILED:", why)
  process.exitCode = 1
}

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_DATA_DIR: join(root, "data"), AXE_DEVICE_NAME: "David's MacBook Pro" },
})
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const mac = (n) => win.screenshot({ path: join(out, `${n}.png`) })

const browser = await webkit.launch()
let android
const phoneContext = async () => {
  const ctx = await browser.newContext({ ...devices["iPhone 15"] })
  await ctx.addCookies([{ name: "axeai_session", value: process.env.AXE_WEB_TOKEN, url: base }])
  return ctx
}

try {
  await win.waitForTimeout(2500)
  await win.keyboard.press("Meta+Comma")
  const toggle = win.getByRole("switch", { name: "Let my phone use this Mac" })
  await toggle.waitFor({ timeout: 20_000 })
  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  await win.getByText("Scan with your phone").waitFor()
  await win.locator("#settings-phone").scrollIntoViewIfNeeded()
  await mac("1-mac-settings-qr")
  log("QR shown")

  // 2. The page's camera reads the QR off the Mac's screen.
  const png = join(root, "qr.png")
  const y4m = join(root, "qr.y4m")
  await win.getByRole("img", { name: "Pairing code for this Mac" }).screenshot({ path: png })
  execFileSync("ffmpeg", ["-loglevel", "error", "-loop", "1", "-i", png, "-t", "3", "-vf", "scale=480:480,pad=640:480:80:0:white", "-pix_fmt", "yuv420p", y4m])
  android = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] })
  const actx = await android.newContext({ ...devices["Pixel 7"], permissions: ["camera"] })
  await actx.addCookies([{ name: "axeai_session", value: process.env.AXE_WEB_TOKEN, url: base }])
  const scanner = await actx.newPage()
  await scanner.goto(`${base}/connect`)
  await scanner.getByText("Point at the code on your Mac").waitFor({ timeout: 20_000 })
  await scanner.screenshot({ path: join(out, "2a-phone-scanning.png") })
  await scanner.getByText("Allow on your Mac").waitFor({ timeout: 20_000 })
  const asked = win.getByRole("alertdialog")
  await asked.waitFor({ timeout: 20_000 })
  const first = await asked.getByText(/^Connect /).textContent()
  if (first !== "Connect David's Android phone?") fail(`dialog says ${first}`)
  await asked.getByRole("button", { name: "Not me" }).click()
  await scanner.getByText("Your Mac said no. Scan again if that was you.").waitFor({ timeout: 20_000 })
  await scanner.screenshot({ path: join(out, "2b-phone-declined.png") })
  await android.close()
  log("scanned with the camera; Not me answered no")

  // 3. The next QR, opened as a link.
  await win.waitForTimeout(600)
  const code = await win.evaluate(() => window.axe.invoke("phones:code"))
  if (!code?.link?.startsWith(`${base}/connect#`)) fail(`QR link is ${code?.link}`)
  const phone = await (await phoneContext()).newPage()
  await phone.goto(code.link)
  await phone.getByText("Allow on your Mac").waitFor({ timeout: 20_000 })
  if (phone.url().includes("#")) fail("the secret stayed in the address bar")
  await phone.screenshot({ path: join(out, "2-phone-waiting.png") })
  log("phone waits for the Mac")

  const ask = win.getByRole("alertdialog")
  await ask.waitFor({ timeout: 20_000 })
  const title = await ask.getByText(/^Connect /).textContent()
  if (title !== "Connect David's iPhone?") fail(`dialog says ${title}`)
  await win.waitForTimeout(500)
  await mac("3-mac-allow")
  await ask.getByRole("button", { name: "Allow" }).click()
  log("allowed on the Mac")

  await phone.getByText("Connected to David's MacBook Pro").waitFor({ timeout: 20_000 })
  await phone.screenshot({ path: join(out, "4-phone-connected.png") })
  await win.getByText("David's iPhone", { exact: true }).waitFor()
  await win.locator("#settings-phones").scrollIntoViewIfNeeded()
  await win.waitForTimeout(500)
  await mac("5-mac-phones")
  log("paired")

  // The same QR from another phone: used once already.
  const second = await (await phoneContext()).newPage()
  await second.goto(code.link)
  await second.getByText("Not connected").waitFor({ timeout: 30_000 })
  await second.screenshot({ path: join(out, "6-second-phone-refused.png") })
  if (await ask.isVisible()) fail("a used code reached the Mac's dialog")
  log("used code refused:", await second.getByText(/didn't work|didn't answer/).textContent())

  // Remove on axeai.com.
  const removed = await phone.evaluate(async () => {
    const { phones } = await (await fetch("/api/remote/phones")).json()
    const res = await fetch(`/api/remote/phones/${phones[0].id}`, { method: "DELETE", headers: { origin: location.origin } })
    return res.status
  })
  if (removed !== 200) fail(`remove answered ${removed}`)
  await win.getByText("No phones yet").waitFor({ timeout: 10_000 })
  await mac("7-mac-after-remove")
  log("removed on axeai.com, gone from the Mac")
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
  await mac("failure").catch(() => {})
} finally {
  await android?.close().catch(() => {})
  await browser.close()
  await app.close()
}
if (!process.exitCode) log("PASSED")
