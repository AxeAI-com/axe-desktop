// Claude Code (or another CLI agent) using Axe's own browser over MCP, in the real app, headless.
// Only on targets this script makes: a local order form it serves and counts, and a temp folder.
// The agent fills the form; Send must ask in the chat; a no sends nothing.
// node tests/e2e/doit-agent-run.mjs <out-dir> [agent name]  (needs AXE_SELFTEST_COOKIE and the server on :3000)
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2] ?? "test-results/do-it/agent"
const agentName = process.argv[3] ?? "Claude Code"
mkdirSync(out, { recursive: true })
const log = []
const note = (line) => {
  log.push(line)
  console.log(line)
}

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
const folder = mkdtempSync(join(tmpdir(), "axe-agent-work-"))

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_BASE_URL: "http://localhost:3000", AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-real-")) },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, folder)
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) })
const card = win.getByRole("region", { name: "Allow this?" })
await win.waitForTimeout(2500)
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) {
  await signIn.click()
  await win.waitForTimeout(4000)
}

await win.getByRole("button", { name: /model|auto|choose/i }).last().click().catch(() => {})
await win.waitForTimeout(500)
await win.getByText(agentName, { exact: true }).first().click()
await win.waitForTimeout(800)

const box = win.getByRole("textbox", { name: "Message" })
await box.click()
await box.fill(
  `Use the axe MCP tools (Axe's own browser, not curl or any other way): browser_open ${formURL}, fill in name Jack, email jack@example.com, note "One box of figs" with browser_type, then press "Send order" with browser_click.`,
)
await win.keyboard.press("Enter")

// Allow the agent's own questions, but answer Axe's question before Send with no.
let askedBeforeSend = false
for (let i = 0; i < 240 && !askedBeforeSend; i++) {
  if (await card.isVisible().catch(() => false)) {
    const title = await card.locator("div").first().innerText()
    note(`card: ${title}`)
    if (/send order/i.test(title)) {
      askedBeforeSend = true
      await win.getByRole("button", { name: /Waiting for you/ }).click().catch(() => {})
      await win.waitForTimeout(500)
      await shot("1-agent-asks-before-send")
      if (sent.length) note(`FAIL: sent before the OK (${sent.length})`)
      await card.getByRole("button", { name: "Don't allow" }).click()
    } else await card.getByRole("button", { name: /^allow/i }).first().click()
  }
  await win.waitForTimeout(1000)
}
await win.getByRole("button", { name: "Copy" }).last().waitFor({ timeout: 180_000 }).catch(() => {})
await win.waitForTimeout(1500)
const steps = win.getByRole("button", { name: /opened|used|edited|not allowed|thought/i }).first()
if (await steps.isVisible().catch(() => false)) await steps.click()
await win.waitForTimeout(700)
await shot("2-agent-done")
note(`asked before Send: ${askedBeforeSend}; submissions: ${sent.length}`)
await app.close()
server.close()
writeFileSync(join(out, "run.log"), log.join("\n"))
process.exit(askedBeforeSend && sent.length === 0 ? 0 : 1)
