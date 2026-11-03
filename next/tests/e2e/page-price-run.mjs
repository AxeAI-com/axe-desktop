// Page changes and Price and stock end to end in the real app, against a local shop whose pricing text
// and price can change. Starter, ask, validation (not a link, 404, sign-in, no price and "Watch the page
// instead"), plan, first run, the thread, the line diff, Ignore changes like this and Undo, a reply,
// the price step chart, stock, the list's blue dot, and the notifications.
// node tests/e2e/page-price-run.mjs <out-dir> [light|dark]   (run `pnpm run build` first; needs no account)
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/page-price")
const theme = process.argv[3] === "dark" ? "dark" : "light"
mkdirSync(out, { recursive: true })

// The shop. "hang" answers after 3 s, so "Reading the page…" and "Finding the price…" can be seen.
let hang = false
let pricing = ["Wheel-thrown mugs, $38", "Free shipping on orders over $75.", "Returns within 30 days."]
let price = 48
let stock = "InStock"
const notes = ["Hand thrown in small batches.", "Glazed with food-safe glazes.", "Fired twice in our studio kiln.", "Every piece is a little different."]
const html = (title, body, head = "") => `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`
const site = createServer((req, res) => {
  const send = (status, body) => (hang ? setTimeout(() => res.writeHead(status, { "content-type": "text/html" }).end(body), 3000) : res.writeHead(status, { "content-type": "text/html" }).end(body))
  const url = req.url ?? "/"
  if (url.startsWith("/prices")) return send(404, html("Not found", "<h1>Not found</h1>"))
  if (url.startsWith("/members")) return send(200, html("Sign in", '<form><input name="email"><input type="password"><button>Sign in</button></form>'))
  if (url.startsWith("/pricing"))
    return send(200, html("Pricing, Lane Ceramics", `<h1>Pricing</h1>${notes.map((n) => `<p>${n}</p>`).join("")}${pricing.map((p) => `<p>${p}</p>`).join("")}<footer><p>Updated Oct 31, 2026</p></footer>`))
  if (url.startsWith("/about")) return send(200, html("About, North Clay", "<h1>About us</h1><p>We sell clay and glazes to potters.</p>"))
  if (url.startsWith("/stoneware-25")) {
    const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Stoneware clay, 25 lb", offers: { "@type": "Offer", price: `${price}.00`, priceCurrency: "USD", availability: `https://schema.org/${stock}` } })
    return send(200, html("Stoneware clay, 25 lb | North Clay", `<h1>Stoneware clay, 25 lb</h1><p>$${price}.00</p>`, `<script type="application/ld+json">${ld}</script>`))
  }
  send(200, html("Lane Ceramics", "<h1>Lane Ceramics</h1>"))
})
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const host = `localhost:${site.address().port}`

const notifyLog = join(mkdtempSync(join(tmpdir(), "axe-pp-notes-")), "notes.jsonl")
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_NOTIFY_LOG: notifyLog,
    AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-pp-")),
    // A page with no product data goes to the model once: the stand-in agent, never a real account.
    AXE_TEST_AGENT: `Test agent|${join(import.meta.dirname, "../fixtures/fake-agent.mjs")}`,
  },
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}-${theme}.png`) })
const log = (...a) => console.log(...a)
const noticesSoFar = () => (existsSync(notifyLog) ? readFileSync(notifyLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
await win.waitForTimeout(2500)
await win.evaluate((t) => window.axe.invoke("settings:set", { theme: t, answerer: { kind: "agent", agentId: "test-agent" } }), theme)
await win.reload()
await win.waitForTimeout(2000)
await win.keyboard.press("Escape").catch(() => {})

const main = win.getByRole("main")
const box = () => win.getByRole("textbox").last()
const watchingPage = () => win.getByRole("button", { name: /^Watching/ }).first().click()
const titleMenu = async (item) => {
  await win.locator('header button[aria-haspopup="menu"]').first().click()
  await win.getByRole("menuitem", { name: new RegExp(item) }).click()
}
const checkNow = async () => {
  const before = await main.getByTestId("watch-strip").locator("g").count().catch(() => 0)
  await titleMenu("Check now")
  await win.waitForFunction((n) => (document.querySelector('[data-testid="watch-strip"]')?.querySelectorAll("g").length ?? 0) > n, before, { timeout: 30_000 })
  await win.waitForTimeout(300)
}
const starter = async (label) => {
  // The page fades in; the old screen's box stays in the page until it's gone.
  await win.getByPlaceholder(/^(Say what to watch|Watch something else)$/).click()
  await win
    .getByTestId("catalogue")
    .getByRole("button", { name: `Add ${label}` })
    .click({ timeout: 5000 })
    .catch(async (e) => {
      await shot("fail-starter")
      throw e
    })
  await win.waitForTimeout(200)
}
const rest = async () => {
  await win.mouse.move(1300, 120)
  await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await win.waitForTimeout(300)
}

// 1. Page changes: the starter and the ask.
await watchingPage()
await win.getByText("What should Axe watch?").waitFor()
await starter("Page changes")
await shot("p01-ask")

// 2. Validation: not a link, 404, a sign-in wall, then "Reading the page…".
await box().fill("lane ceramics")
await box().press("Enter")
await win.getByText("That doesn’t look like a link.").waitFor()
await box().fill(`${host}/members`)
await box().press("Enter")
await win.getByText("That page needs a sign-in, so Axe can’t read it.").waitFor()
await box().fill(`${host}/prices`)
await box().press("Enter")
await win.getByText("That page returns Not found (404).").waitFor()
await shot("p02-invalid")
hang = true
await box().fill(`https://${host}/pricing`)
await box().press("Enter")
await win.getByText("Reading the page…").waitFor()
await shot("p03-reading")
await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 20_000 })
hang = false

// 3. The plan, Start, Checking now, the first result.
await rest()
await shot("p04-plan")
await win.getByRole("button", { name: "Start watching" }).click()
await win.getByText("Checking now").waitFor()
await win.waitForTimeout(250)
await shot("p05-first-run")
await win.getByText(/^Saved a copy of the page: /).waitFor()
await rest()
await shot("p06-first-result")
log("page created:", await main.innerText().then((t) => t.split("\n").slice(0, 10).join(" | ")))

// 4. Quiet runs only add ticks.
for (let i = 0; i < 3; i++) await checkNow()
await rest()
await shot("p07-quiet")

// 5. The text changes: news in blue, with the line diff. One notice.
pricing = ["Wheel-thrown mugs, $38", "Free shipping on orders over $50.", "Gift wrap is now free.", "Returns within 30 days."]
await checkNow()
await main.getByTestId("news-page").waitFor()
await rest()
await shot("p08-change")
log("page card:", (await main.getByTestId("news-page").innerText()).replace(/\n/g, " | "))
log("page notice:", JSON.stringify(noticesSoFar().at(-1)))

// 6. Ignore changes like this, its Undo, then a reply that changes the watch.
await main.getByRole("button", { name: "Ignore changes like this" }).click()
await main.getByText("Okay. I’ll ignore changes in that part of the page.").waitFor()
await rest()
await shot("p09-ignored")
await main.getByRole("button", { name: "Undo" }).click()
await main.getByText("Undone.").waitFor()
await box().fill("only check this once a day, and ignore the date at the bottom")
await box().press("Enter")
await main.getByText("Done. I’ll check every morning at 7:30 and ignore the date line at the bottom.").waitFor()
await rest()
await shot("p10-reply")

// 7. Price and stock: the starter, no price ("Watch the page instead"), "Finding the price…".
await watchingPage()
await starter("Price and stock")
await shot("q01-ask")
await box().fill(`${host}/about`)
await box().press("Enter")
await win.getByText("There’s no price on that page that Axe can read.").waitFor()
await win.getByRole("button", { name: "Watch the page instead" }).waitFor()
await rest()
await shot("q02-no-price")
hang = true
await box().fill(`${host}/stoneware-25`)
await box().press("Enter")
await win.getByText("Finding the price…").waitFor()
await shot("q03-finding")
await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 20_000 })
hang = false
await rest()
await shot("q04-plan")
log("price plan:", await main.innerText().then((t) => t.split("\n").slice(0, 4).join(" | ")))
await win.getByRole("button", { name: "Start watching" }).click()
await win.getByText("Checking now").waitFor()
await win.waitForTimeout(250)
await shot("q05-first-run")
await win.getByText(/^\$48, in stock\. /).waitFor()
await rest()
await shot("q06-first-result")
await checkNow()
await checkNow()
await rest()
await shot("q07-quiet")

// 8. The price drops twice: the latest is a card with the step chart, the earlier one folds.
price = 45
await checkNow()
price = 42
await checkNow()
await main.getByTestId("news-price").getByText("Down to $42", { exact: true }).waitFor()
await rest()
await shot("q08-change")
log("price card:", (await main.getByTestId("news-price").innerText()).replace(/\n/g, " | "))

// 9. Out of stock, then back in stock.
stock = "OutOfStock"
await checkNow()
await main.getByTestId("news-price").getByText("Out of stock", { exact: true }).first().waitFor()
await rest()
await shot("q09-out-of-stock")
stock = "InStock"
await checkNow()
await main.getByTestId("news-price").getByText("Back in stock", { exact: true }).waitFor()

// 10. The list: a change you haven't seen has a blue dot and its line.
await watchingPage()
pricing = [...pricing, "Gift cards are here."]
const list = await win.evaluate(() => window.axe.invoke("watching:list"))
const pageWatch = list.watches.find((w) => w.kind === "page")
await win.evaluate((id) => window.axe.invoke("watching:checkNow", id), pageWatch.id)
await main.getByText("New line: “Gift cards are here.”").waitFor()
await rest()
await shot("r01-list-news")
await main.getByRole("button", { name: new RegExp(`^${host}/pricing`) }).click()
await main.getByTestId("news-page").waitFor()
await watchingPage()
await main.getByRole("button", { name: new RegExp(`^${host}/pricing No changes since `) }).waitFor()
log("after opening:", await main.innerText().then((t) => t.split("\n").slice(0, 12).join(" | ")))

const all = noticesSoFar()
log("notices:", all.length, all.map((n) => `${n.title}: ${n.body} [silent ${!!n.silent}]`).join(" / "))
await app.close()
site.close()
log("done", out)
