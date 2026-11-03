// One-off check of attachments in the real app: a photo and a text file to a free Axe model, then a
// text file to Claude Code. node tests/e2e/attach-run.mjs <out-dir> <image>  (needs AXE_SELFTEST_COOKIE, server on :3000)
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const [out, image] = process.argv.slice(2)
const work = mkdtempSync(join(tmpdir(), "axe-attach-"))
const photo = join(work, basename(image))
copyFileSync(image, photo)
const note = join(work, "packing list.txt")
writeFileSync(note, "Packing list\n- comfortable shoes\n- light jacket\n- sunglasses\n")

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_BASE_URL: "http://localhost:3000", AXE_SELFTEST: "1", AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-real-")) },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})
// Native dialogs: the file picker returns the photo and the note; the folder picker the work folder.
await app.evaluate(({ dialog }, { files, folder }) => {
  dialog.showOpenDialog = async (_w, o) => ({ canceled: false, filePaths: (o ?? _w)?.properties?.includes("openDirectory") ? [folder] : files })
}, { files: [photo, note], folder: work })
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, n + ".png") })
await win.waitForTimeout(2500)
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) { await signIn.click(); await win.waitForTimeout(4000) }

const attach = async () => {
  await win.getByRole("button", { name: "Add files, tools and connectors" }).click()
  await win.getByRole("menuitem", { name: "Add files or photos" }).click()
  await win.waitForTimeout(800)
}
// 1. Axe, free model: what is in the picture, and the note's first item.
await attach()
await shot("1-axe-files")
await win.getByRole("textbox", { name: "Message" }).fill("In one sentence, what is in the picture? Then tell me the first item on the packing list.")
await win.keyboard.press("Enter")
await win.getByRole("button", { name: "Copy", exact: true }).last().waitFor({ timeout: 120000 }).catch(() => {})
await win.waitForTimeout(1500)
await shot("2-axe-reply")
console.log("axe reply:", (await win.locator(".md").last().innerText().catch(() => "")).slice(0, 300))

// 2. Claude Code: reads the note from where it is.
await win.keyboard.press(process.platform === "darwin" ? "Meta+N" : "Control+N").catch(() => {})
await win.getByRole("button", { name: "New chat" }).click()
await win.waitForTimeout(800)
await win.getByRole("button", { name: /^Auto/ }).first().click()
await win.getByText("Claude Code", { exact: true }).first().click()
await win.waitForTimeout(800)
await attach()
await win.getByRole("textbox", { name: "Message" }).fill("Read the attached packing list and tell me, in one sentence, the last item on it. Don't change any files.")
await win.keyboard.press("Enter")
for (let i = 0; i < 120; i++) {
  const allow = win.getByRole("region", { name: "Allow this?" }).getByRole("button").first()
  if (await allow.isVisible().catch(() => false)) await allow.click()
  if (await win.getByRole("button", { name: "Copy", exact: true }).last().isVisible().catch(() => false)) break
  await win.waitForTimeout(1000)
}
await win.waitForTimeout(1500)
await shot("3-agent-reply")
console.log("agent reply:", (await win.locator(".md").last().innerText().catch(() => "")).slice(0, 300))
await app.close()
console.log("done")
