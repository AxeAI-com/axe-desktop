// Real Do it runs in the real app, only on targets this script makes: a local order form it serves
// itself (counting every real submission), and a throwaway workspace folder. Headless; free Auto model
// (or AXE_FAKE_BRAIN=1 for the fixed plan).
// node tests/e2e/doit-run.mjs <out-dir>  (needs AXE_SELFTEST_COOKIE and the server on :3000)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2] ?? "test-results/do-it"
mkdirSync(out, { recursive: true })
const log = []
const note = (line) => {
  log.push(line)
  console.log(line)
}

// The form, and how many times it was really sent.
const sent = []
const page = readFileSync(join(import.meta.dirname, "../fixtures/doit-form.html"))
const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/send") {
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      sent.push(JSON.parse(body))
      res.end("{}")
    })
    return
  }
  res.writeHead(200, { "Content-Type": "text/html" })
  res.end(page)
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const formURL = `http://127.0.0.1:${server.address().port}/form.html`
const workspace = mkdtempSync(join(tmpdir(), "axe-doit-workspace-"))

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_BASE_URL: "http://localhost:3000",
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-real-")),
    AXE_DOIT_WORKSPACE: workspace,
    AXE_DOIT_FORM_URL: formURL,
  },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})
// The app's own output, for when something goes wrong.
const appLog = []
app.process().stderr?.on("data", (d) => appLog.push(String(d)))
app.process().stdout?.on("data", (d) => appLog.push(String(d)))
app.process().on("exit", (code, signal) => appLog.push(`app exited: ${code} ${signal}`))
process.on("exit", () => writeFileSync(join(out, "app.log"), appLog.join("")))
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) })
const card = win.getByRole("region", { name: "Allow this?" })
const stopButton = win.getByRole("button", { name: "Stop", exact: true })
const fail = async (why) => {
  note(`FAIL: ${why}`)
  await shot("fail")
  await app.close()
  server.close()
  writeFileSync(join(out, "run.log"), log.join("\n"))
  process.exit(1)
}

async function finished(ms = 180_000) {
  await win.waitForTimeout(800)
  await stopButton.waitFor({ state: "hidden", timeout: ms }).catch(() => {})
}

async function useComputer() {
  await win.getByRole("button", { name: "Add files, tools and connectors" }).first().click()
  await win.getByRole("menuitem", { name: /Do it/ }).click()
}

async function send(text) {
  const box = win.getByRole("textbox", { name: "Message" })
  await box.click()
  await box.fill(text)
  await win.keyboard.press("Enter")
}

await win.waitForTimeout(2500)
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) {
  await signIn.click()
  await win.waitForTimeout(4000)
}

await useComputer()
await shot("1-composer")

// DOIT_ONLY=computer runs only part 4.
if (process.env.DOIT_ONLY !== "computer") {
// 1. The form: fill it and stop at Send. Say no once: nothing is sent.
await send(`Open ${formURL} in your browser and fill in the order form: name Mia Lane, email mia@example.com, note "Two boxes of figs". Then press Send order.`)
await card.waitFor({ timeout: 240_000 }).catch(() => fail("no approval card before Send"))
await win.getByRole("button", { name: /Waiting for you/ }).click().catch(() => {})
await win.waitForTimeout(600)
await shot("2-asks-before-send")
note(`card: ${await card.locator("div").first().innerText()}`)
if (sent.length) await fail(`the form was sent before the OK (${sent.length})`)
await win.getByRole("button", { name: "Don't allow" }).click()
await finished()
await win.waitForTimeout(1000)
await shot("3-said-no")
if (sent.length) await fail("the form was sent after Don't allow")
note("said no: nothing sent")

// 2. Allow it once.
await send("Okay, I've changed my mind. Press Send order now.")
await card.waitFor({ timeout: 240_000 }).catch(() => fail("no approval card the second time"))
await shot("4-asks-again")
await win.getByRole("button", { name: "Allow", exact: true }).click()
await finished()
await win.waitForTimeout(1000)
await shot("5-sent")
if (sent.length !== 1) await fail(`expected one submission, got ${sent.length}`)
note(`sent once: ${JSON.stringify(sent[0])}`)

// 3. Terminal and files in the throwaway workspace.
await win.getByRole("button", { name: "New chat" }).first().click()
await win.waitForTimeout(500)
await send(
  "In your workspace folder, write a file shopping.txt with apples, pears and plums on separate lines. Then run a shell command that sorts it in reverse order into sorted.txt and prints sorted.txt. Then tell me what it printed.",
)
for (let i = 0; i < 3; i++) {
  const asked = await card.waitFor({ timeout: 120_000 }).then(() => true, () => false)
  if (!asked) break
  note(`card: ${await card.locator("div").first().innerText()}`)
  await shot(`6-terminal-asks-${i + 1}`)
  await win.getByRole("button", { name: "Allow", exact: true }).click()
  await win.waitForTimeout(800)
  if (existsSync(join(workspace, "sorted.txt"))) break
}
await finished()
const summary = win.getByRole("button", { name: /ran|changed|read|used/i }).last()
if (await summary.isVisible().catch(() => false)) await summary.click()
await win.waitForTimeout(800)
await shot("7-terminal-done")
const sorted = existsSync(join(workspace, "sorted.txt")) ? readFileSync(join(workspace, "sorted.txt"), "utf8") : null
note(`shopping.txt: ${JSON.stringify(existsSync(join(workspace, "shopping.txt")) ? readFileSync(join(workspace, "shopping.txt"), "utf8") : null)}`)
note(`sorted.txt: ${JSON.stringify(sorted)}`)
if (!sorted || !/plums[\s\S]*pears[\s\S]*apples/.test(sorted)) await fail("sorted.txt isn't the list in reverse")

}

// 4. Computer use on the Mac, on a window of this app made for the test: shown off-screen without
// focus, see-through and click-through (it covers nothing), holding the same form. Read it, type into it, and try Send (it must ask).
if (process.platform === "darwin") {
  const before = sent.length
  await app.evaluate(async ({ app, BrowserWindow }, url) => {
    // Chromium shows web pages to Accessibility only once something asks; ask for the test.
    app.setAccessibilitySupportEnabled(true)
    const w = new BrowserWindow({ x: -3000, y: -3000, width: 640, height: 640, show: false, title: "Axe test form", focusable: false })
    await w.loadURL(url)
    // See-through and click-through too, in case macOS pulls it back on screen.
    w.setOpacity(0)
    w.setIgnoreMouseEvents(true)
    w.showInactive()
  }, formURL)
  const pid = app.process().pid
  await win.getByRole("button", { name: "New chat" }).first().click()
  await win.waitForTimeout(500)
  await send(
    `This is a test of the read_screen tools on this app's own test window. Call read_screen with app "pid:${pid}". Then use type_text to put "Sam" in the "Your name" field, and click the "Send order" button. Don't use the browser tools.`,
  )
  const asked = await card.waitFor({ timeout: 180_000 }).then(() => true, () => false)
  await win.getByRole("button", { name: /Waiting for you/ }).click().catch(() => {})
  await win.waitForTimeout(600)
  await shot("8-computer-use-asks")
  if (asked) {
    note(`card: ${await card.locator("div").first().innerText()}`)
    await win.getByRole("button", { name: "Don't allow" }).click()
  }
  await finished(120_000)
  await win.waitForTimeout(800)
  await shot("9-computer-use-done")
  note(`computer use: asked=${asked}, sent during it=${sent.length - before}`)
  if (sent.length !== before) await fail("the test window's form was sent")
}

await app.close()
server.close()
writeFileSync(join(out, "run.log"), log.join("\n"))
console.log("done")
