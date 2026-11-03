// One-off check of a real CLI agent in the real app: Claude Code works in a throwaway folder.
// node tests/e2e/agent-run.mjs <out-dir> [agent name]  (needs AXE_SELFTEST_COOKIE and the server on :3000)
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
const agentName = process.argv[3] ?? "Claude Code"
const folder = mkdtempSync(join(tmpdir(), "axe-agent-work-"))
writeFileSync(join(folder, "notes.md"), "# Trip notes\n\n- Lisbon in May\n")

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_BASE_URL: "http://localhost:3000", AXE_SELFTEST: "1", AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-real-")) },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})
// The folder picker is a native dialog; answer it with the throwaway folder.
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, folder)
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, n + ".png") })
await win.waitForTimeout(2500)
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) { await signIn.click(); await win.waitForTimeout(4000) }

// Pick the agent in the model picker.
await win.getByRole("button", { name: /model|auto|choose/i }).last().click().catch(() => {})
await win.waitForTimeout(500)
await shot("1-picker")
await win.getByText(agentName, { exact: true }).first().click()
await win.waitForTimeout(800)
await shot("2-agent-picked")

const box = win.getByPlaceholder(/how can i help|reply|ask|should .* do/i).first()
await box.click()
await box.fill("Add a line '- Book the 28 tram early' to notes.md, then tell me in one sentence what you changed.")
await win.keyboard.press("Enter")
await win.waitForTimeout(3000)
await shot("3-working")

// Answer any permission card with the first allow option.
for (let i = 0; i < 90; i++) {
  const allow = win.getByRole("region", { name: "Allow this?" }).getByRole("button").first()
  if (await allow.isVisible().catch(() => false)) { await shot("4-permission"); await allow.click() }
  if (readFileSync(join(folder, "notes.md"), "utf8").includes("28 tram")) break
  await win.waitForTimeout(1000)
}
// Wait for the reply to finish (copy button shows once done).
await win.getByRole("button", { name: "Copy" }).last().waitFor({ timeout: 120000 }).catch(() => {})
await win.waitForTimeout(1500)
await shot("5-reply")
const steps = win.getByRole("button", { name: /edited|read|ran|thought|used|wrote/i }).first()
if (await steps.isVisible().catch(() => false)) { await steps.click(); await win.waitForTimeout(700); await shot("6-steps-open") }
console.log("file:", JSON.stringify(readFileSync(join(folder, "notes.md"), "utf8")))
console.log("folder:", folder, existsSync(folder))
await app.close()
console.log("done")
