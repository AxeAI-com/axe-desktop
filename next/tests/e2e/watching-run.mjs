// Clicks through Watching in the real app: every starter, the plan, Start watching, the watch, and a problem.
// node tests/e2e/watching-run.mjs <out-dir>   (run `pnpm run build` first; needs no account)
// A local test site serves the pages; Security and Repo alerts use real targets (example.com, this repo).
import { mkdirSync, mkdtempSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/watching")
mkdirSync(out, { recursive: true })

// The test site: a shop with a pricing page and a product. /slow sleeps; ?down answers 502.
let price = 48
let down = false
const site = createServer((req, res) => {
  if (down) return res.writeHead(502, "Bad Gateway").end("Bad Gateway")
  if (req.url?.startsWith("/product"))
    return res.writeHead(200, { "content-type": "text/html" }).end(`<html><head><title>Stoneware clay, 25 lb</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Stoneware clay, 25 lb","offers":{"@type":"Offer","price":"${price}.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head><body><h1>Stoneware clay</h1></body></html>`)
  if (req.url?.startsWith("/pricing")) return res.writeHead(200, { "content-type": "text/html" }).end("<html><head><title>Pricing, Lane Ceramics</title></head><body><p>Wheel-thrown mugs, $38</p><p>Free shipping on orders over $75.</p></body></html>")
  res.writeHead(200, { "content-type": "text/html" }).end("<html><head><title>Lane Ceramics</title></head><body><h1>Lane Ceramics</h1></body></html>")
})
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const port = site.address().port
const host = `localhost:${port}`

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_WATCH_RETRY_MS: "1500",
    AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-watching-")),
    // Replies and sentences go to the stand-in agent, never a real account.
    AXE_TEST_AGENT: `Test agent|${join(import.meta.dirname, "../fixtures/fake-agent.mjs")}`,
  },
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) })
const log = (...a) => console.log(...a)
await win.waitForTimeout(2500)
await win.evaluate(() => window.axe.invoke("settings:set", { answerer: { kind: "agent", agentId: "test-agent" } }))
await win.reload()
await win.waitForTimeout(1500)

// Signed out is fine: Watching needs no account. Close any first-run sheet.
await win.keyboard.press("Escape").catch(() => {})
await win.getByRole("button", { name: /^Watching/ }).first().click()
await win.getByText("What should Axe watch?").waitFor()
await shot("01-empty")
log("empty page ok")

const starters = [
  ["Uptime and speed", host, "uptime"],
  ["Page changes", `${host}/pricing`, "page"],
  ["Price and stock", `${host}/product`, "price"],
  ["Security", "example.com", "security"],
  ["Repo alerts", resolve(".."), "repo"],
]

let n = 2
for (const [label, target, id] of starters) {
  // On the list page the starters show when the composer has focus.
  const box = win.getByRole("textbox").last()
  await box.click()
  await win.getByTestId("catalogue").getByRole("button", { name: `Add ${label}` }).click()
  await box.fill(target)
  await shot(`${String(n++).padStart(2, "0")}-${id}-ask`)
  await box.press("Enter")
  await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 60_000 })
  await win.waitForTimeout(600)
  await shot(`${String(n++).padStart(2, "0")}-${id}-plan`)
  await win.getByRole("button", { name: "Start watching" }).click()
  await win.getByText(/^Watching\. /).waitFor()
  await win.waitForTimeout(500)
  await shot(`${String(n++).padStart(2, "0")}-${id}-watch`)
  log(`${label}: created`)
  await win.getByRole("button", { name: /^Watching/ }).first().click()
  await win.waitForTimeout(400)
}
await shot(`${String(n++).padStart(2, "0")}-list`)

// A problem: the site goes down, Check now finds it, the row and the sidebar turn orange.
down = true
const titleMenu = () => win.locator('header button[aria-haspopup="menu"]').first().click()
await win.getByRole("main").getByRole("button", { name: new RegExp(`^${host}\\b(?!/)`) }).first().click()
await titleMenu()
await win.getByRole("menuitem", { name: /Check now/ }).click()
await win.getByText(`${host} is down`).waitFor({ timeout: 30_000 })
await shot(`${String(n++).padStart(2, "0")}-uptime-down`)
log("down: problem card shows")
down = false

// A price change is news.
price = 52
await win.getByRole("button", { name: /^Watching/ }).first().click()
await win.getByRole("main").getByRole("button", { name: /^Stoneware clay, 25 lb/ }).first().click()
await titleMenu()
await win.getByRole("menuitem", { name: /Check now/ }).click()
await win.waitForTimeout(1500)
await shot(`${String(n++).padStart(2, "0")}-price-change`)

// Edit, then a reply that changes how often.
await win.keyboard.press("Meta+E")
await win.waitForTimeout(300)
await shot(`${String(n++).padStart(2, "0")}-edit`)
await win.keyboard.press("Escape")
await win.mouse.click(1200, 400)
const reply = win.getByRole("textbox").last()
await reply.fill("check every 15 minutes")
await reply.press("Enter")
await win.getByText(/^Okay\./).waitFor()
await shot(`${String(n++).padStart(2, "0")}-reply`)

// Free text: Axe finds the address and asks which kind.
await win.getByRole("button", { name: /^Watching/ }).first().click()
// The page fades in; the watch's box stays in the page until it's gone.
const box = win.getByPlaceholder("Watch something else")
await box.waitFor()
await win.waitForTimeout(400)
await box.fill("keep an eye on lane-ceramics.com for me")
await box.press("Enter")
await win
  .getByText("What should I watch on lane-ceramics.com?")
  .waitFor()
  .catch(async (e) => {
    await shot("fail-free-text")
    throw e
  })
await shot(`${String(n++).padStart(2, "0")}-free-text`)

// Dark theme: the list.
await win.evaluate(() => {
  document.documentElement.dataset.theme = "dark"
  document.documentElement.classList.add("dark")
})
await win.waitForTimeout(300)
await shot(`${String(n++).padStart(2, "0")}-list-dark`)

await app.close()
site.close()
log("done", out)
