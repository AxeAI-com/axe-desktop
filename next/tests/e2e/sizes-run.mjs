// The real app at real window sizes, for side-by-side checks against Claude.
// node tests/e2e/sizes-run.mjs <out-dir>  (needs AXE_SELFTEST_COOKIE and the website on :3000)
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
const SIZES = [
  { name: "1440x788", width: 1440, height: 788 }, // the owner's 2048 × 858 screen, after the menu bar
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
]
const PROMPT =
  "Plan a relaxed day in Lisbon with trams. Use one short intro sentence, a heading, 3 bullets, a 3-row table with Stop, Time and Notes, a 2-line Swift code block listing the stops, and one closing sentence. No web search."
const folder = mkdtempSync(join(tmpdir(), "axe-sizes-work-"))
writeFileSync(join(folder, "notes.md"), "# Trip notes\n\n- Lisbon in May\n")

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_BASE_URL: process.env.AXE_BASE_URL ?? "http://localhost:3000", AXE_SELFTEST: "1", AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-sizes-")) },
})
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, folder)
const win = await mainWindow(app)
// The page's viewport, emulated (resizing a hidden window does not always take).
const size = (w, h) => win.setViewportSize({ width: w, height: h }).then(() => win.waitForTimeout(500))
// Through the palette, the way a person switches it.
const theme = async (t) => {
  await win.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await win.keyboard.type(`Switch to ${t} theme`)
  await win.waitForTimeout(200)
  await win.keyboard.press("Enter")
  await win.waitForTimeout(500)
}
const shot = async (n) => {
  for (const s of SIZES) {
    await size(s.width, s.height)
    await win.screenshot({ path: join(out, `${n}-${s.name}.png`) })
  }
}
await size(1440, 900)
await win.waitForTimeout(2500)
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) { await signIn.click(); await win.waitForTimeout(4000) }

for (const t of ["dark", "light"]) {
  await theme(t)
  await win.getByRole("button", { name: "New chat" }).first().click()
  await win.waitForTimeout(800)
  await shot(`${t}-1-new`)
}
// A real Axe answer (free Auto), the same prompt as the Claude capture.
await theme("dark")
await size(1440, 900)
await win.getByRole("textbox", { name: "Message" }).fill(PROMPT)
await win.keyboard.press("Enter")
await win.getByRole("button", { name: "Copy", exact: true }).last().waitFor({ timeout: 120000 }).catch(() => {})
await win.waitForTimeout(1500)
for (const t of ["dark", "light"]) {
  await theme(t)
  await shot(`${t}-2-answer`)
}
// The model picker over the new-chat screen.
await theme("dark")
await win.getByRole("button", { name: "New chat" }).first().click()
await win.waitForTimeout(600)
await size(1440, 788)
await win.getByRole("button", { name: /^Auto/ }).first().click()
await win.waitForTimeout(500)
await win.screenshot({ path: join(out, "dark-3-picker-1440x788.png") })
// A real Claude Code chat: edits a file, steps open.
await win.getByText("Claude Code", { exact: true }).first().click()
await win.waitForTimeout(800)
await win.getByRole("textbox", { name: "Message" }).fill("Add a line '- Book the 28 tram early' to notes.md, then tell me in one sentence what you changed.")
await win.keyboard.press("Enter")
for (let i = 0; i < 150; i++) {
  const allow = win.getByRole("region", { name: "Allow this?" }).getByRole("button").first()
  if (await allow.isVisible().catch(() => false)) await allow.click()
  if (await win.getByRole("button", { name: "Copy", exact: true }).last().isVisible().catch(() => false)) break
  await win.waitForTimeout(1000)
}
await win.waitForTimeout(1500)
const steps = win.locator("[data-slot=tool-group] header button").first()
if (await steps.isVisible().catch(() => false)) { await steps.click(); await win.waitForTimeout(700) }
for (const t of ["dark", "light"]) {
  await theme(t)
  await shot(`${t}-4-agent`)
}
await app.close()
console.log("done")
