// The menu bar icon's click handler in the real app, with nothing on screen: a headless self-test
// (AXE_SELFTEST, AXE_HEADLESS, its own data folder) runs the icon's own press and click handlers through
// __axeTrayClick in the main process, fires macOS's `activate` the way a press on the icon can, and checks
// the main window never shows or takes focus. No real menu bar icon, no mouse or keyboard events.
// node tests/e2e/tray-toggle-run.mjs [rounds]   (run `pnpm run build` first)
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const rounds = Number(process.argv[2] ?? 3)
const tmp = mkdtempSync(join(tmpdir(), "axe-traytoggle-"))
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_DATA_DIR: join(tmp, "data"), AXE_BASE_URL: "http://localhost:1" },
})
let failures = 0
const check = (ok, what) => {
  console.log(ok ? "ok  " : "FAIL", what)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  const main = await mainWindow(app)
  await main.waitForTimeout(2000)
  // Watch the main window: any show or focus is a failure.
  await app.evaluate(({ BrowserWindow }) => {
    const log = (globalThis.__mainLog = [])
    const w = BrowserWindow.getAllWindows().find((w) => !/#(tray|quick)/.test(w.webContents.getURL()))
    for (const ev of ["show", "focus"]) w.on(ev, () => log.push(ev))
  })
  const state = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) => !/#(tray|quick)/.test(w.webContents.getURL()))
      return { visible: w.isVisible(), focused: w.isFocused(), log: globalThis.__mainLog.slice() }
    })
  const click = () => app.evaluate(() => globalThis.__axeTrayClick())
  const activate = () => app.evaluate(({ app }) => app.emit("activate", {}, false))

  const shows = () => app.evaluate(() => globalThis.__axeMainShows ?? 0)
  let s0 = await state()
  check(!s0.visible && (await shows()) === 0, "the main window starts hidden (headless)")
  for (let i = 1; i <= rounds; i++) {
    check((await click()) === true, `round ${i}: the first click opens the panel`)
    await activate()
    let s = await state()
    check(!s.visible && !s.focused && (await shows()) === 0, `round ${i}: activate during the open click does not ask for the main window`)
    await sleep(700)
    check((await click()) === false, `round ${i}: the second click closes the panel`)
    await activate()
    s = await state()
    check(!s.visible && !s.focused && s.log.length === 0 && (await shows()) === 0, `round ${i}: the close leaves the main window hidden and unfocused (${s.log.join(",") || "no events"})`)
    await sleep(700)
  }
  // The probe works: a Dock-style activate with no press on the icon does ask for the main window.
  await sleep(700)
  await activate()
  check((await shows()) === 1, `a Dock click (activate, no press on the icon) still opens the main window (${await shows()} request)`)
  s0 = await state()
  check(!s0.visible, "headless: even then nothing is put on screen")
} catch (e) {
  console.log("FAIL", e.message)
  failures++
} finally {
  await app.close()
}
console.log(failures ? `${failures} failed` : "all passed")
process.exit(failures ? 1 : 0)
