// The menu bar panel in the real app: a self-test opens the panel's window (hidden, no menu bar icon),
// screenshots it in light and dark, and follows "Start a watch" and "Settings…" into the main window.
// Its own data folder, no account, nothing on screen (AXE_HEADLESS).
// node tests/e2e/tray-run.mjs <out-dir>   (run `pnpm run build` first)
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/tray-run")
mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), "axe-tray-"))

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_DATA_DIR: join(tmp, "data"), AXE_BASE_URL: "http://localhost:1" },
})
let failures = 0
const check = (ok, what) => {
  console.log(ok ? "ok  " : "FAIL", what)
  if (!ok) failures++
}
try {
  const main = await mainWindow(app)
  main.setDefaultTimeout(30_000)
  await main.waitForTimeout(2000)

  await app.evaluate(() => globalThis.__axeShowTray())
  const until = async (fn, ms = 20_000) => {
    const end = Date.now() + ms
    for (;;) {
      const v = fn()
      if (v) return v
      if (Date.now() > end) throw new Error("timed out")
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  const tray = await until(() => app.windows().find((w) => /#tray/.test(w.url())))
  tray.setDefaultTimeout(30_000)
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getBounds()).find((b) => b.width === 630))
  check(size?.width === 630 && size?.height === 720, `the panel is 630 by 720 (${size?.width} by ${size?.height})`)
  await tray.getByRole("textbox", { name: "Message" }).waitFor()

  for (const theme of ["light", "dark"]) {
    await main.evaluate((t) => window.axe.invoke("settings:set", { theme: t }), theme)
    await tray.reload()
    await tray.getByText("No watches yet").waitFor()
    await tray.waitForTimeout(500)
    // The window is system glass; an offscreen capture has no glass behind it, so stand in the popover colour.
    await tray.addStyleTag({ content: "html.tray-glass, html.tray-glass body { background: var(--pop) !important }" })
    await tray.screenshot({ path: join(out, `tray-${theme}.png`) })
    check(await tray.getByRole("button", { name: "Settings…" }).isVisible(), `${theme}: header, Watching, box and footer show`)
  }

  await tray.getByRole("button", { name: "Start a watch" }).click()
  await main.getByText("What should Axe watch?").waitFor()
  check(true, "Start a watch opens Watching in the main window")
  await app.evaluate(() => globalThis.__axeShowTray())
  await tray.getByRole("button", { name: /Settings…/ }).click()
  await main.getByText("What should Axe watch?").waitFor({ state: "detached" })
  await main.waitForTimeout(600)
  check(!(await main.getByText("Say what to watch").count()), "Settings… opens Settings in the main window")
  await main.screenshot({ path: join(out, "main-after-settings.png") })
} catch (e) {
  console.log("FAIL", e.message)
  failures++
} finally {
  await app.close()
}
console.log(failures ? `${failures} failed` : "all passed", out)
process.exit(failures ? 1 : 0)
