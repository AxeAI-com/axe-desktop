// The built-in terminal in the real app: an agent whose sign-in lapsed shows Sign in, which opens a real
// shell in the terminal panel. Run after `pnpm run build`.
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/terminal")
mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), "axe-term-"))
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: join(tmp, "data"),
    AXE_BASE_URL: "http://localhost:1",
    AXE_TEST_AGENT: `Test agent|${join(import.meta.dirname, "../fixtures/fake-agent.mjs")}`,
  },
})
// Agent chats work in a folder; answer the native picker with a throwaway one.
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, tmp)
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
const rows = () => win.locator(".xterm-rows").innerText()
try {
  await win.waitForTimeout(2500)
  await win.evaluate(() => window.axe.invoke("settings:set", { answerer: { kind: "agent", agentId: "test-agent" } }))
  await win.reload()
  await win.waitForTimeout(2000)
  await win.keyboard.press("Escape").catch(() => {})

  // 1. A lapsed sign-in shows Sign in, which opens the terminal. (⌘J needs an Axe sign-in; this run is signed out.)
  await win.getByRole("button", { name: /choose a folder/i }).click()
  await win.waitForTimeout(500)
  const box = win.getByPlaceholder(/ask anything|reply|how can i help/i).first()
  await box.click()
  await box.fill("signed-out")
  await win.keyboard.press("Enter")
  const signIn = win.getByRole("button", { name: "Sign in", exact: true })
  await signIn.waitFor()
  await win.screenshot({ path: join(out, "1-sign-in.png") })
  await signIn.click()
  await win.getByRole("region", { name: "Terminal" }).waitFor()
  await win.locator(".xterm").waitFor()
  console.log("ok: Sign in opens the terminal")

  // 2. It's a real shell: what you type runs.
  await win.waitForTimeout(1500)
  await win.locator(".xterm").click()
  await win.keyboard.type("echo axe-$((40+2))\n")
  for (let i = 0; i < 50 && !(await rows()).includes("axe-42"); i++) await win.waitForTimeout(200)
  if (!(await rows()).includes("axe-42")) throw new Error(`The shell didn't answer: ${await rows()}`)
  await win.screenshot({ path: join(out, "2-terminal.png") })
  console.log("ok: shell runs commands")

  // 3. Close ends it.
  await win.getByRole("button", { name: "Close the terminal" }).click()
  await win.getByRole("region", { name: "Terminal" }).waitFor({ state: "detached" })
  console.log("ok: close")
} catch (e) {
  await win.screenshot({ path: join(out, "fail.png") }).catch(() => {})
  throw e
} finally {
  await app.close()
}
