// Free text, custom watches and editing, end to end in the real app. The model is the stand-in ACP agent
// (tests/fixtures/fake-agent.mjs) reached through the real one-shot path, and the sites are a local server
// behind fake DNS (AXE_WATCH_FAKE_NET; lane-ceramics.co doesn't exist). Covers: "Thinking…", the
// unclear sentence, the sentence with no target, the target it can't reach with its close match, a custom
// watch (plan with Runs on, first result, news with the quote, notification), the model that can't run,
// the chevron menu, Edit (a bad target, a schedule change), replies read by the model, pause and resume,
// the row menu, right-click and delete.
// node tests/e2e/freetext-edit-run.mjs <out-dir> [light|dark]   (run `pnpm run build` first; needs no account)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/freetext-edit")
const theme = process.argv[3] === "dark" ? "dark" : "light"
mkdirSync(out, { recursive: true })

let seats = "Fully booked."
const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
const site = createServer((req, res) => {
  const url = req.url ?? "/"
  const send = (body) => res.writeHead(200, { "content-type": "text/html" }).end(body)
  if (url.startsWith("/kit")) return send(html("Glaze kit", "<h1>Glaze kit, 8 colours</h1><p>Our price: $36.50</p><p>In stock, ships tomorrow.</p><p>Was $42.00</p>"))
  if (url.startsWith("/pricing")) return send(html("Pricing, Lane Ceramics", "<h1>Pricing</h1><p>Wheel-thrown mugs, $38</p><p>Free shipping on orders over $75.</p><footer><p>Updated Oct 31, 2026</p></footer>"))
  if (url.startsWith("/workshops"))
    return send(html("Workshops, Clay Collective", `<h1>Workshops</h1><p>Sat 7 Nov, Glazing for stoneware, 10:00 to 13:00. ${seats}</p><p>Sun 8 Nov, Throwing basics. Fully booked.</p>`))
  send(html("Lane Ceramics", "<h1>Lane Ceramics</h1><p>Hand thrown in small batches.</p>"))
})
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const local = `http://127.0.0.1:${site.address().port}`

const tmp = mkdtempSync(join(tmpdir(), "axe-fe-"))
const fakeNet = join(tmp, "net.json")
writeFileSync(fakeNet, JSON.stringify({ hosts: { "lane-ceramics.com": { http: local }, "claycollective.org": { http: local }, "lane-ceramics.co": { missing: true } } }))
const notifyLog = join(tmp, "notes.jsonl")
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_NOTIFY_LOG: notifyLog,
    AXE_WATCH_FAKE_NET: fakeNet,
    AXE_DATA_DIR: join(tmp, "data"),
    // Nothing on :1, so the app runs signed out and the test agent answers.
    AXE_BASE_URL: "http://localhost:1",
    AXE_TEST_AGENT: `Test agent|${join(import.meta.dirname, "../fixtures/fake-agent.mjs")}`,
  },
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}-${theme}.png`) })
const log = (...a) => console.log(...a)
const notices = () => (existsSync(notifyLog) ? readFileSync(notifyLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
const fail = async (why) => {
  await shot("fail")
  throw new Error(why)
}
await win.waitForTimeout(2500)
await win.evaluate((t) => window.axe.invoke("settings:set", { theme: t, answerer: { kind: "agent", agentId: "test-agent" } }), theme)
await win.reload()
await win.waitForTimeout(2000)
await win.keyboard.press("Escape").catch(() => {})

const main = win.getByRole("main")
const box = () => win.getByRole("textbox").last()
const watchingPage = async () => {
  await win.getByRole("button", { name: /^Watching/ }).first().click()
  await win.waitForTimeout(400)
}
const say = async (text) => {
  await box().click()
  await box().fill(text)
  await box().press("Enter")
}
const titleMenu = async (item) => {
  await win.locator('header button[aria-haspopup="menu"]').first().click()
  if (item) await win.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click()
}
const rest = async () => {
  await win.mouse.move(1300, 120)
  await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await win.waitForTimeout(300)
}
const strips = () => main.getByTestId("watch-strip").locator("g").count().catch(() => 0)
const checkNow = async () => {
  const before = await strips()
  await titleMenu("Check now")
  await win.waitForFunction((n) => (document.querySelector('[data-testid="watch-strip"]')?.querySelectorAll("g").length ?? 0) > n, before, { timeout: 30_000 })
  await win.waitForTimeout(300)
}

try {
  // 1. A sentence the model can't place: "Thinking…", then the question with the starters.
  await watchingPage()
  await win.getByText("What should Axe watch?").waitFor()
  await say("keep an eye on things for me")
  await main.getByText("Thinking…").waitFor()
  await shot("f01-reading")
  await main.getByText("What should I watch?").waitFor({ timeout: 60_000 })
  await rest()
  await shot("f02-unclear")
  if (!(await win.getByText("New watch").first().isVisible())) await fail("the title isn't New watch")

  // 2. A kind with no target: "Which site?" and the Uptime chip in the box.
  await say("Tell me if my site goes down.")
  await main.getByText("Which site?").waitFor({ timeout: 60_000 })
  await win.getByPlaceholder("Site address, like lane-ceramics.com").waitFor()
  await shot("f03-notarget")
  await say("lane-ceramics.com")
  await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 30_000 })
  if (!(await main.getByText("Tell me if my site goes down.").isVisible())) await fail("the plan's bubble isn't the typed sentence")
  log("no-target plan:", (await main.innerText()).split("\n").slice(0, 4).join(" | "))
  await win.getByRole("button", { name: "Start watching" }).click()
  await main.getByText(/is up and loads in/).waitFor({ timeout: 30_000 })

  // 3. A target it can't reach: the close match from your watches, and the box keeps the chip and target.
  await watchingPage()
  await say("Tell me when lane-ceramics.co/pricing changes.")
  await main.getByText("I couldn’t reach lane-ceramics.co. That domain doesn’t exist.").waitFor({ timeout: 60_000 })
  await rest()
  await shot("f04-unreachable")
  const kept = await box().inputValue()
  if (kept !== "lane-ceramics.co/pricing") await fail(`the box should keep the target, has "${kept}"`)
  await main.getByRole("button", { name: "Use lane-ceramics.com/pricing" }).click()
  await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 30_000 })
  await win.getByRole("button", { name: "Start watching" }).click()
  await main.getByText(/^Saved a copy of the page/).waitFor({ timeout: 30_000 })
  const pageId = await win.evaluate(() => window.axe.invoke("watching:list").then((l) => l.watches.find((w) => w.kind === "page").id))

  // 4. A free sentence becomes a custom watch: the plan with Runs on, the first result, then news.
  await watchingPage()
  await say("Tell me when a seat opens in the Saturday glaze workshop at claycollective.org/workshops.")
  await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 60_000 })
  await rest()
  await shot("f05-custom-plan")
  log("custom plan:", (await main.innerText()).replace(/\n/g, " | "))
  await win.getByRole("button", { name: "Start watching" }).click()
  await main.getByText(/^It’s full now\. I’ll check every hour\./).waitFor({ timeout: 30_000 })
  await checkNow()
  seats = "2 places left."
  await checkNow()
  await main.getByTestId("custom-quote").waitFor()
  await rest()
  await shot("f06-custom-news")
  log("custom card:", (await main.getByTestId("news-custom").innerText()).replace(/\n/g, " | "))
  log("custom notice:", JSON.stringify(notices().at(-1)))
  if (!notices().some((n) => /seats are free/.test(`${n.title} ${n.body}`))) await fail("no notification for the custom news")

  // 4b. A product page with no product data: the model picks where the price is, once.
  await watchingPage()
  await box().click()
  await win.getByTestId("catalogue").getByRole("button", { name: "Add Price and stock" }).click()
  await say("lane-ceramics.com/kit")
  await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 60_000 })
  await main.getByText("Glaze kit, 8 colours is $36.50 and in stock. I’ll check every hour and tell you when either changes.").waitFor()
  await rest()
  await shot("f08-price-picked")
  await win.getByRole("button", { name: "Start watching" }).click()
  await main.getByText("The page’s text").waitFor({ timeout: 30_000 })
  log("picked price:", (await main.innerText()).split("\n").slice(0, 12).join(" | "))
  await watchingPage()
  await main.getByRole("button", { name: /^Saturday glaze workshop seats/ }).click()
  await main.getByTestId("custom-quote").waitFor()

  // 5. The model can't run: one line, with the picker to choose another.
  const customId = await win.evaluate(() => window.axe.invoke("watching:list").then((l) => l.watches.find((w) => w.kind === "custom").id))
  await win.evaluate((id) => window.axe.invoke("watching:update", id, { answerer: { kind: "agent", agentId: "gone-agent" } }), customId)
  await checkNow()
  await main.getByTestId("model-missing").waitFor()
  await rest()
  await shot("f07-model-missing")
  log("model missing:", await main.getByTestId("model-missing").innerText())
  await main.getByTestId("model-missing").getByRole("button").click()
  const list = win.getByRole("listbox", { name: "Choose who answers" })
  // With real agents installed, the stand-in waits behind "More agents".
  if (!(await list.getByRole("option", { name: /Test agent/ }).isVisible())) await list.getByText("More agents").click()
  await list.getByRole("option", { name: /Test agent/ }).click()
  await main.getByTestId("model-missing").waitFor({ state: "detached", timeout: 30_000 })

  // 6. The chevron menu and Edit on the page watch: a domain that doesn't exist, then a new schedule.
  await win.evaluate((id) => window.axe.invoke("watching:list").then(() => id), pageId)
  await win.getByRole("navigation").getByText("lane-ceramics.com/pricing").first().click().catch(async () => {
    await watchingPage()
    await main.getByText("lane-ceramics.com/pricing").first().click()
  })
  await main.getByText(/^Saved a copy of the page/).waitFor()
  await titleMenu()
  await win.getByRole("menuitem", { name: /^Edit/ }).hover()
  await shot("e01-menu")
  await win.getByRole("menuitem", { name: /^Edit/ }).click()
  const edit = win.getByRole("dialog", { name: "Edit" })
  await edit.waitFor()
  await win.getByRole("menu").waitFor({ state: "detached" })
  await shot("e02-edit")
  await edit.getByRole("textbox", { name: "Watching" }).fill("lane-ceramics.co/pricing")
  await edit.getByRole("textbox", { name: "Watching" }).press("Enter")
  await edit.getByText("lane-ceramics.co doesn’t exist. Check the spelling.").waitFor()
  await win.waitForTimeout(300)
  await shot("e03-edit-error")
  await edit.getByRole("textbox", { name: "Watching" }).fill("lane-ceramics.com/pricing")
  await edit.getByRole("button", { name: "How often" }).click()
  await win.getByRole("option", { name: "Every 15 minutes" }).click()
  await win.keyboard.press("Escape")
  await edit.waitFor({ state: "detached" })
  const every = await win.evaluate((id) => window.axe.invoke("watching:get", id).then((w) => w.every), pageId)
  if (every !== "15m") await fail(`Edit didn't save How often: ${every}`)
  if (!(await main.getByText("Watching. Every 15 minutes, tells you right away.").isVisible())) await fail("the folded plan didn't follow Edit")

  // 7. Replies read by the model: a change with Undo, a question, and one it can't do.
  await say("only check this once a day, and ignore the date at the bottom")
  await main.getByText("Thinking…").waitFor()
  await main.getByText("Done. I’ll check every morning at 7:30 and ignore the date line at the bottom.").waitFor({ timeout: 60_000 })
  await rest()
  await shot("e04-reply")
  await say("what changed last week?")
  await main.getByText("Nothing changed last week. The last change was today.").waitFor({ timeout: 60_000 })
  await say("check every minute")
  await main.getByText("I can’t check more often than every 5 minutes.").waitFor({ timeout: 60_000 })
  await rest()
  await shot("e05-replies")

  // 8. Pause from the chevron menu: the box gives way to Resume. Resume checks straight away.
  await titleMenu("Pause")
  await main.getByText(/^Paused at /).waitFor()
  await win.getByText("This watch is paused.").waitFor()
  await rest()
  await shot("e06-paused")
  const before = await strips()
  await win.getByRole("button", { name: "Resume" }).click()
  await main.getByText("Resumed. Checking now.").waitFor()
  await win.waitForFunction((n) => (document.querySelector('[data-testid="watch-strip"]')?.querySelectorAll("g").length ?? 0) > n, before, { timeout: 30_000 })

  // 9. The list: the row's ⋯ menu pauses a watch; right-click opens the same menu; Delete confirms.
  await watchingPage()
  const row = main.getByRole("button", { name: /^lane-ceramics\.com\/pricing/ }).first()
  await row.hover()
  await main.getByRole("button", { name: "More for lane-ceramics.com/pricing" }).click()
  await win.getByRole("menuitem", { name: "Pause" }).hover()
  await shot("e07-row-menu")
  await win.getByRole("menuitem", { name: "Pause" }).click()
  await main.getByText(/^Paused since /).waitFor()
  await rest()
  await shot("e08-list-paused")
  await main.getByRole("button", { name: /^lane-ceramics\.com\/pricing/ }).first().click({ button: "right" })
  await win.getByRole("menuitem", { name: "Resume" }).waitFor()
  await win.keyboard.press("Escape")
  await main.getByRole("button", { name: /^Saturday glaze workshop seats/ }).click({ button: "right" })
  await win.getByRole("menuitem", { name: "Delete" }).click()
  await win.getByRole("alertdialog").waitFor()
  await shot("e09-delete")
  await win.keyboard.press("Escape")
  await win.getByRole("alertdialog").waitFor({ state: "detached" })
  await main.getByRole("button", { name: /^Saturday glaze workshop seats/ }).click({ button: "right" })
  await win.getByRole("menuitem", { name: "Delete" }).click()
  await win.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await main.getByRole("button", { name: /^Saturday glaze workshop seats/ }).waitFor({ state: "detached" })

  // 10. Delete from the chevron menu: back to Watching, the row is gone.
  await main.getByRole("button", { name: /^lane-ceramics\.com\/pricing/ }).first().click()
  await titleMenu("Delete")
  await win.getByRole("alertdialog").getByRole("button", { name: "Delete" }).press("Enter")
  await win.getByRole("alertdialog").waitFor({ state: "detached" })
  await main.getByRole("button", { name: /^lane-ceramics\.com\/pricing/ }).waitFor({ state: "detached" })
  await rest()
  await shot("e10-after-delete")
  log("list after deletes:", (await main.innerText()).replace(/\n/g, " | "))
  log("OK")
} catch (e) {
  await shot("fail").catch(() => {})
  log("main at failure:", await main.innerText().catch(() => "?"))
  throw e
} finally {
  await app.close()
  site.close()
}
