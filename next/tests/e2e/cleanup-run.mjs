// The real app after Watching v3 removed routines: no trace of them, and the Watching composer is the
// chat's own with only the model picker under the box, even with a CLI agent picked.
// node tests/e2e/cleanup-run.mjs <out-dir>   (run `pnpm run build` first; needs no account)
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/cleanup")
mkdirSync(out, { recursive: true })
const fail = (why) => {
  console.error(`FAIL: ${why}`)
  process.exitCode = 1
}

// A local site to watch, so the @ menu has a watch to list.
const site = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html><head><title>Lane Ceramics</title></head><body>Lane</body></html>"))
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const host = `localhost:${site.address().port}`

const data = mkdtempSync(join(tmpdir(), "axe-cleanup-"))
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: data,
    AXE_TEST_AGENT: `Test agent|${join(import.meta.dirname, "../fixtures/fake-agent.mjs")}`,
  },
})
const errors = []
app.process().stderr?.on("data", (d) => {
  const s = String(d)
  // runs:get is asked on purpose below, to prove it's gone.
  if (/error|TypeError|ReferenceError|Cannot find/i.test(s) && !/DevTools|Autofill|GPU|ERR_FILE_NOT_FOUND|No handler for runs:get|^\s+at /.test(s)) errors.push(s.trim())
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
win.on("pageerror", (e) => errors.push(`page: ${e.message}`))
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) })
await win.waitForTimeout(2500)
await win.keyboard.press("Escape").catch(() => {})

// 1. No routine anywhere: the sidebar, the palette, the bridge.
const body = await win.locator("body").innerText()
if (/Scheduled|routine/i.test(body)) fail("the window still mentions Scheduled or routines")
await win.getByRole("button", { name: /^Search and commands/ }).click()
await win.getByRole("dialog", { name: "Command palette" }).waitFor()
for (const q of ["routine", "schedul", "run now"]) {
  await win.keyboard.type(q)
  await win.waitForTimeout(250)
  const text = await win.getByRole("dialog", { name: "Command palette" }).innerText()
  if (/routine|scheduled|run .* now/i.test(text.replace(/Search chats or type a command|Nothing matches .*/g, ""))) fail(`the palette finds "${q}": ${text}`)
  await win.getByRole("dialog", { name: "Command palette" }).getByRole("textbox").fill("")
}
await win.keyboard.press("Escape")
const bridge = await win.evaluate(async () => {
  const tryIt = async (c) => {
    try {
      await window.axe.invoke(c)
      return "answered"
    } catch (e) {
      return String(e)
    }
  }
  return { runs: await tryIt("runs:get"), power: await window.axe.invoke("power:get"), remote: await window.axe.invoke("remote:get") }
})
if (bridge.runs === "answered") fail("runs:get still answers")
if (!bridge.power?.keepAwake || typeof bridge.remote?.enabled !== "boolean") fail(`keep-awake or remote control is broken: ${JSON.stringify(bridge)}`)
if (readdirSync(data).includes("runs.json")) fail("the app still writes runs.json")
console.log("no routines: sidebar, palette, bridge and data dir ok")

// 2. A watch, so @ has one to list.
await win.getByRole("button", { name: /^Watching/ }).first().click()
await win.getByText("What should Axe watch?").waitFor()
const box = win.getByRole("textbox").last()
await box.click()
await win.getByTestId("catalogue").getByRole("button", { name: "Add Uptime and speed" }).click()
await box.fill(host)
await box.press("Enter")
await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 60_000 })
await win.getByRole("button", { name: "Start watching" }).click()
await win.getByText(/^Watching\. /).waitFor()
await win.getByRole("button", { name: /^Watching/ }).first().click()
await win.waitForTimeout(500)

// 3. The Watching composer with a CLI agent picked: no folder chip, no mode menu. Light and dark.
const toolbarText = async () => (await modelBtn().locator("xpath=..").innerText()).trim()
const modelBtn = () => win.getByRole("main").locator('button[aria-haspopup="listbox"]').last()
const pickAgent = async () => {
  if (/Test agent/.test(await modelBtn().innerText())) return
  await modelBtn().click()
  await win.getByRole("option", { name: /Test agent/ }).first().click()
  await win.waitForTimeout(300)
}
await pickAgent()
if (!/Test agent/.test(await modelBtn().innerText())) fail("the Watching composer didn't take the CLI agent")
for (const theme of ["light", "dark"]) {
  await win.evaluate((t) => window.axe.invoke("settings:set", { theme: t }), theme)
  await win.waitForTimeout(500)
  const t = await toolbarText()
  if (/Choose a folder|Ask first|Accept edits|Plan|Bypass|Edit automatically/i.test(t)) fail(`the Watching toolbar shows agent controls (${theme}): ${t}`)
  await win.mouse.move(1420, 880)
  await shot(`watching-composer-agent-${theme}`)
}
console.log("Watching composer: only the model picker under the box, light and dark")

// 4. @ on Watching: Watches first.
await box.click()
await box.fill("@")
await win.getByRole("listbox", { name: "Mention" }).waitFor()
const groupsOn = async () => (await win.getByRole("listbox", { name: "Mention" }).innerText()).split("\n").filter((l, i, all) => ["Watches", "Folders", "Apps", "Chats"].includes(l) && all.indexOf(l) === i)
const onWatching = await groupsOn()
if (onWatching[0] !== "Watches") fail(`@ on Watching starts with ${onWatching[0]}`)
// The starters are cards in the page (under the list), never a row over the @ menu.
await win.waitForTimeout(400)
await shot("watching-mention-dark")
await box.fill("")

// 5. @ in a chat: Watches after Folders (a fresh data dir has no folders yet; tests/unit/mentions.test.ts
// checks the order with both).
await win.getByRole("button", { name: /^New chat/ }).first().click()
await win.waitForTimeout(500)
const chatBox = win.getByRole("textbox").last()
await chatBox.click()
await chatBox.fill("Compare with @")
await win.getByRole("listbox", { name: "Mention" }).waitFor()
const inChat = await groupsOn()
const fi = inChat.indexOf("Folders")
const wi = inChat.indexOf("Watches")
if (wi < 0 || (fi >= 0 && wi < fi)) fail(`@ in a chat: ${inChat.join(", ")}`)
if (!(await win.getByText(/Good (morning|afternoon|evening)/).isVisible())) fail("the @ check in a chat didn't run in a new chat")
await win.waitForTimeout(400)
await shot("chat-mention-dark")
console.log(`@ groups: Watching ${onWatching.join(", ")}; chat ${inChat.join(", ")}`)

await win.evaluate(() => window.axe.invoke("settings:set", { theme: "system" }))
await app.close()
site.close()
if (errors.length) fail(`errors while running:\n${errors.join("\n")}`)
console.log(process.exitCode ? "cleanup run FAILED" : `cleanup run ok, screenshots in ${out}`)
