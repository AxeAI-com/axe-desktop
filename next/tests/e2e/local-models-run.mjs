// One-off check of the real app with a real local model server running (Ollama, LM Studio or llama.cpp):
// signed out, it picks the model by name, chats with it, builds a board from a sentence, and lets the board's
// model write its summary box.
// node tests/e2e/local-models-run.mjs <out-dir> <model name as the picker shows it>
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const [out, modelName] = process.argv.slice(2)
if (!out || !modelName) throw new Error("Usage: node tests/e2e/local-models-run.mjs <out-dir> <model name>")
const app = await electron.launch({
  args: ["."],
  // Nothing on :1, so the app runs signed out.
  env: { ...process.env, AXE_BASE_URL: "http://localhost:1", AXE_SELFTEST: "1", AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-local-")) },
})
const win = await mainWindow(app)
win.setDefaultTimeout(180_000)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) })
const time = async (label, f) => {
  const t = Date.now()
  await f()
  console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`)
}
await win.waitForTimeout(2500)

// The picker: the model is under On this computer.
await win.locator('button[aria-haspopup="listbox"]').last().click()
const list = win.getByRole("listbox", { name: "Choose who answers" })
await list.getByRole("option", { name: new RegExp(modelName) }).click()
await shot("1-picked")

await time("chat reply", async () => {
  await win.getByRole("textbox", { name: "Message" }).fill("In two sentences: what should a small team check every morning on their website?")
  await win.keyboard.press("Enter")
  await win.getByRole("button", { name: "Stop" }).waitFor()
  await win.getByRole("button", { name: "Stop" }).waitFor({ state: "detached" })
  await win.waitForTimeout(1500)
})
await shot("2-chat")

await time("board built", async () => {
  await win.getByRole("button", { name: "Dashboard", exact: true }).click()
  await win.getByRole("button", { name: "New board" }).click()
  await win.getByRole("dialog", { name: "New board" }).getByRole("textbox", { name: "What should this board watch?" }).fill("Watch axeai.com: is it up, how fast, its certificate, and a short summary")
  await win.getByRole("dialog", { name: "New board" }).getByRole("button", { name: "Build" }).click()
  // The model names the board; it's the first one under Boards.
  await win.getByRole("navigation", { name: "Chats" }).getByText("Make a board").waitFor({ state: "detached", timeout: 120_000 }).catch(() => {})
})
await shot("3-dashboard")
// The model names the board: open the newest one under Boards.
const boardName = await win.evaluate(() => {
  const all = [...document.querySelectorAll("nav[aria-label=Chats] *")].filter((e) => e.children.length === 0 && e.textContent?.trim())
  const i = all.findIndex((e) => e.textContent?.trim() === "Boards")
  return all.slice(i + 1).find((e) => e.textContent?.trim() !== "Make a board")?.textContent?.trim() ?? ""
})
console.log("board:", boardName)
await win.getByRole("navigation", { name: "Chats" }).getByText(boardName, { exact: true }).first().click()
await win.waitForTimeout(1000)
const chip = win.getByRole("button", { name: /^Checks with / })
console.log("chip:", await chip.getAttribute("aria-label"))
// The model may leave the summary box out; add one and check the board, as its schedule would.
await time("summary written", async () => {
  const note = await win.evaluate(async () => {
    const api = window.axe
    const page = (await api.invoke("pages:get")).pages[0]
    await api.invoke("pages:addPanel", page.id, "summary", "board")
    const view = await api.invoke("pages:refresh", page.id)
    const box = view.pages[0].panels.find((p) => p.source.kind === "summary")
    return view.live[box.id]?.readings.at(-1)?.note
  })
  console.log("summary:", note)
})
await shot("4-board")
await chip.click()
await shot("5-board-model-menu")
await app.close()
console.log("done")
