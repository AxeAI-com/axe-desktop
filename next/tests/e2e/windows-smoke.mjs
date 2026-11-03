// The real app (unpacked) on Windows: it opens, draws the sign-in screen, and the palette shows Ctrl keys.
// node tests/e2e/windows-smoke.mjs <out-dir>   (no website needed)
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
const fail = (m) => {
  console.error("FAIL:", m)
  process.exit(1)
}
const app = await electron.launch({ args: ["."], env: { ...process.env, AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-win-")) } })
const win = await mainWindow(app)
win.setDefaultTimeout(60_000)
await win.getByRole("button", { name: /sign in with axe/i }).waitFor()
await win.screenshot({ path: join(out, "1-sign-in.png") })
const platform = await win.evaluate(() => window.axe.platform)
if (platform !== "win32") fail(`platform is ${platform}`)
// The engine answers over IPC and keeps settings on disk.
const settings = await win.evaluate(() => window.axe.invoke("settings:get"))
if (!settings?.baseURL?.startsWith("https://axeai.com")) fail(`settings: ${JSON.stringify(settings)}`)
await win.evaluate(() => window.axe.invoke("settings:set", { theme: "dark" }))
const again = await win.evaluate(() => window.axe.invoke("settings:get"))
if (again.theme !== "dark") fail("settings did not save")
await win.waitForTimeout(600)
await win.screenshot({ path: join(out, "2-sign-in-dark.png") })
// Windows window controls are drawn by Electron on the right (titleBarOverlay).
const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), bounds: w.getBounds(), visible: w.isVisible() })))
console.log("windows:", JSON.stringify(size))
await app.close()
console.log("PASS: opens on Windows, sign-in screen drawn, settings saved")
