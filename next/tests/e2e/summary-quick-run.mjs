// Watching v3 steps 7 and 8 in the real app: the night, the morning summary (notification and card),
// /summary, the / commands with @, the + menu's Watch section, @ watches, the offline banner, the quick
// bar's /watch, and Settings, Notifications. The engine's clock is moved through a file (AXE_WATCH_CLOCK,
// self-tests only) so the run goes from 2:50 am to 8:00 am in a minute. Sites are a local server behind
// fake DNS; the model is the stand-in ACP agent. Nothing shows on screen (AXE_HEADLESS).
// node tests/e2e/summary-quick-run.mjs <out-dir> [light|dark]   (run `pnpm run build` first; needs no account)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/summary-quick")
const theme = process.argv[3] === "dark" ? "dark" : "light"
mkdirSync(out, { recursive: true })

let down = false
let pricing = "Free shipping on orders over $75."
const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
const site = createServer((req, res) => {
  const url = req.url ?? "/"
  if (url.startsWith("/pricing")) return res.writeHead(200, { "content-type": "text/html" }).end(html("Pricing, Lane Ceramics", `<h1>Pricing</h1><p>Wheel-thrown mugs, $38</p><p>${pricing}</p>`))
  // studio-booking.com lives under /sb and stays up; lane-ceramics.com's home page can go down.
  if (down && !url.startsWith("/sb")) return res.writeHead(502, "Bad Gateway").end("Bad Gateway")
  res.writeHead(200, { "content-type": "text/html" }).end(html("Lane Ceramics", "<h1>Lane Ceramics</h1><p>Hand thrown in small batches.</p>"))
})
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const local = `http://127.0.0.1:${site.address().port}`

const tmp = mkdtempSync(join(tmpdir(), "axe-sq-"))
const fakeNet = join(tmp, "net.json")
writeFileSync(fakeNet, JSON.stringify({ hosts: { "lane-ceramics.com": { http: local }, "studio-booking.com": { http: `${local}/sb` } } }))
const notifyLog = join(tmp, "notes.jsonl")
const clockFile = join(tmp, "clock")
// The engine's "now": today at h:m, whatever the real time is.
const at = (h, m = 0, s = 0) => new Date(new Date().setHours(h, m, s, 0)).getTime()
const setClock = (t) => writeFileSync(clockFile, String(t - Date.now()))
setClock(at(2, 50))

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_NOTIFY_LOG: notifyLog,
    AXE_WATCH_FAKE_NET: fakeNet,
    AXE_WATCH_CLOCK: clockFile,
    AXE_WATCH_TICK_MS: "1000",
    AXE_WATCH_RETRY_MS: "300",
    AXE_DATA_DIR: join(tmp, "data"),
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
const until = async (what, fn, ms = 30_000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}
let failures = 0
const check = (ok, what) => {
  log(ok ? "ok  " : "FAIL", what)
  if (!ok) failures++
}

await win.waitForTimeout(2500)
await win.evaluate((t) => window.axe.invoke("settings:set", { theme: t, answerer: { kind: "agent", agentId: "test-agent" }, summaryAt: "8:00" }), theme)
await win.reload()
await win.waitForTimeout(2000)
await win.keyboard.press("Escape").catch(() => {})

const main = win.getByRole("main")
const box = () => win.getByRole("textbox").last()
const list = () => win.evaluate(() => window.axe.invoke("watching:list"))
const rest = async () => {
  await win.mouse.move(1300, 120)
  await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await win.waitForTimeout(300)
}
const create = (kind, target) =>
  win.evaluate(
    async ([kind, target]) => {
      const d = await window.axe.invoke("watching:draft", { kind, target, force: true })
      if ("error" in d) throw new Error(d.error)
      return (await window.axe.invoke("watching:create", d)).id
    },
    [kind, target],
  )

async function quickWindow() {
  for (let i = 0; i < 50; i++) {
    const w = app.windows().find((p) => p.url().includes("#quick"))
    if (w) return w
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("no quick bar window")
}
const shotQuick = async (n) => {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("#quick"))
    return (await w.webContents.capturePage()).toPNG().toString("base64")
  })
  writeFileSync(join(out, `${n}-${theme}.png`), Buffer.from(png, "base64"))
}

try {
  // 1. Two watches at 2:50 am, their first runs done.
  const siteId = await create("uptime", "lane-ceramics.com")
  const pageId = await create("page", "lane-ceramics.com/pricing")
  await until("first runs", async () => (await list()).watches.every((w) => w.latest))

  // 2. 3:12 am: the site goes down. The overdue watch runs on the next tick and notifies.
  down = true
  setClock(at(3, 12))
  const downNote = await until("the down notification", () => notices().find((n) => n.title === "lane-ceramics.com" && /^Down/.test(n.body)))
  check(downNote.body === "Down. It returns 502 Bad Gateway.", `night problem notified: ${downNote.body}`)

  // 3. 5:05 am: the pricing page changes; the hourly watch is overdue and finds it.
  pricing = "Free shipping on orders over $50."
  setClock(at(5, 5))
  await until("the page change", async () => (await list()).watches.find((w) => w.id === pageId)?.unread)

  // 4. 8:00 am: the summary, once.
  setClock(at(7, 59, 50))
  await win.waitForTimeout(1500)
  check(!notices().some((n) => n.title === "Good morning"), "no summary before 8:00")
  setClock(at(8, 0, 5))
  const sum = await until("the morning summary", () => notices().find((n) => n.title === "Good morning"))
  check(sum.body === "1 problem overnight: lane-ceramics.com is down. The pricing page changed.", `summary notification: ${sum.body}`)
  check(sum.silent === false && sum.threadId === "watching:summary", "it makes a sound (a problem) and opens Watching")
  await win.waitForTimeout(2500)
  check(notices().filter((n) => n.title === "Good morning").length === 1, "only one summary")

  // 5. The card on top of Watching.
  await win.getByRole("button", { name: /^Watching/ }).first().click()
  const card = main.getByLabel("Morning summary")
  await card.waitFor()
  const cardText = await card.innerText()
  check(cardText.includes("Good morning") && cardText.includes("Overnight, lane-ceramics.com went down at 3:12 am and the pricing page changed."), `card: ${cardText.replace(/\n/g, " | ")}`)
  await rest()
  await shot("sum-01-card")

  // 6. × closes it; /summary brings it back.
  await card.getByRole("button", { name: "Close summary" }).click()
  await card.waitFor({ state: "detached" })
  check(!(await list()).summary, "closed in the engine too")
  await box().click()
  await box().fill("/")
  await win.getByRole("listbox", { name: "Commands" }).waitFor()
  const cmds = await win.getByRole("listbox", { name: "Commands" }).innerText()
  check(/Watching[\s\S]*\/check[\s\S]*Check a watch now[\s\S]*\/pause[\s\S]*\/resume[\s\S]*\/summary[\s\S]*Show the morning summary now/.test(cmds), "the / menu lists Watching's four commands")
  check(!/\/write|\/research/.test(cmds), "and nothing of the chat's own starters")
  await win.waitForTimeout(450)
  await shot("sum-02-slash")
  await box().fill("/su")
  await box().press("Enter")
  await card.waitFor()
  check((await box().inputValue()) === "", "/summary leaves the box empty")
  check((await card.innerText()).includes("Overnight, lane-ceramics.com went down at 3:12 am"), `/summary tells this morning's again: ${(await card.innerText()).replace(/\n/g, " | ")}`)

  // 7. /pause asks for a watch with @, then answers once under the box; /resume the same.
  await box().fill("/pa")
  await box().press("Enter")
  check((await box().inputValue()) === "/pause @", "picking /pause puts /pause @ in the box")
  const mention = win.getByRole("listbox").filter({ hasText: "Watches" })
  await mention.waitFor()
  await win.waitForTimeout(450)
  await shot("sum-03-pause-mention")
  await box().press("Enter")
  check(/^\/pause @lane-ceramics\.com/.test(await box().inputValue()), `the watch goes in: ${await box().inputValue()}`)
  await box().press("Enter")
  const note = main.getByRole("status").filter({ hasText: /^Paused / })
  await win.getByText(/^Paused lane-ceramics\.com/).waitFor()
  await rest()
  await shot("sum-04-paused")
  const paused = (await list()).watches.filter((w) => w.paused).map((w) => w.name)
  check(paused.length === 1, `one watch paused: ${paused}`)
  await box().click()
  await box().fill(`/resume @${paused[0]} `)
  await box().press("Enter")
  await win.getByText(`Started ${paused[0]} again.`).waitFor()
  check(!(await list()).watches.some((w) => w.paused), "resumed")
  void note

  // 8. The + menu's Watch section.
  await box().click()
  await win.getByRole("button", { name: "Add files, tools and connectors" }).last().click()
  const plus = win.getByRole("dialog", { name: "Add" }).or(win.locator('[aria-label="Add"]')).last()
  await plus.waitFor()
  const plusText = await plus.innerText()
  check(/Add files or photos[\s\S]*Watch[\s\S]*Uptime and speed[\s\S]*Page changes[\s\S]*Price and stock[\s\S]*Security[\s\S]*Repo alerts/.test(plusText), "+ menu has the Watch section")
  await win.waitForTimeout(450)
  await shot("sum-05-plus")
  await win.keyboard.press("Escape")

  // 9. @ lists watches first on Watching.
  await box().click()
  await box().fill("Check @lane")
  await mention.waitFor()
  const mText = await mention.innerText()
  check(mText.trim().startsWith("Watches"), "Watches come first")
  await win.waitForTimeout(450)
  await shot("sum-06-mention")
  await box().fill("")

  // 10. Offline: the banner after 30 s; gone when it's back.
  await rest()
  // The window's network goes away the way Chromium sees it (navigator.onLine and the offline event).
  const cdp = await win.context().newCDPSession(win)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await win.waitForTimeout(5000)
  check(!(await main.getByText("This Mac is offline.", { exact: false }).isVisible()), "no banner in the first 30 s")
  await main.getByText("This Mac is offline. Watches pick up again when it’s back.").waitFor({ timeout: 40_000 })
  await shot("sum-07-offline")
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await main.getByText("This Mac is offline.", { exact: false }).waitFor({ state: "detached", timeout: 10_000 })
  check(true, "the banner goes when the network is back")

  // 11. Settings, Notifications.
  await win.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", metaKey: true, bubbles: true })))
  await win.waitForTimeout(600)
  if (!(await win.getByRole("heading", { name: "Notifications" }).isVisible().catch(() => false))) {
    await win.getByRole("button", { name: /Settings/ }).first().click().catch(() => {})
  }
  const nset = win.locator("#settings-notifications")
  await nset.waitFor()
  await nset.scrollIntoViewIfNeeded()
  check(/Watches[\s\S]*On[\s\S]*Morning summary[\s\S]*8:00 am/.test(await nset.innerText()), "Settings, Notifications: Watches On, Morning summary 8:00 am")
  await shot("sum-08-settings")

  // 11b. In a chat: @ a watch attaches its evidence; the + menu's Watch item opens Watching with the chip.
  await win.getByRole("button", { name: /^New chat/ }).first().click()
  await win.waitForTimeout(500)
  await box().click()
  await box().fill("Why is @lane")
  await win.getByRole("listbox").filter({ hasText: "Watches" }).waitFor()
  await win.getByRole("option", { name: /^lane-ceramics\.com Uptime and speed/ }).click()
  await win.getByTitle("lane-ceramics.com.md").waitFor()
  check(/@lane-ceramics\.com/.test(await box().inputValue()), "the watch's name goes in the box, and its evidence is attached")
  await win.waitForTimeout(400)
  await shot("sum-09-chat-mention")
  await box().fill("")
  await win.getByRole("button", { name: "Remove lane-ceramics.com.md" }).click()
  await win.getByRole("button", { name: "Add files, tools and connectors" }).last().click()
  await win.locator('[aria-label="Add"]').last().getByText("Security", { exact: true }).click()
  await win.getByPlaceholder("Domain, like lane-ceramics.com").first().waitFor()
  check(true, "the chat's + menu Security opens Watching with the Security chip")
  await win.keyboard.press("Escape")

  // 12. The quick bar: /wa, the Watch chip, a sentence, the plan, Start watching, Open.
  const quick = await quickWindow()
  await app.evaluate(() => globalThis.__axeToggleQuickBar())
  await quick.waitForTimeout(700)
  const ask = quick.getByLabel("Ask Axe")
  await ask.fill("/wa")
  await quick.getByRole("listbox", { name: "Commands" }).waitFor()
  const qs = await quick.getByRole("listbox", { name: "Commands" }).innerText()
  check(/^Watch\s+Check something on a schedule/.test(qs.trim()), `quick / menu: ${qs.replace(/\n/g, " | ")}`)
  await shotQuick("quick-01-slash")
  await ask.press("Enter")
  await quick.getByText("Watch", { exact: true }).first().waitFor()
  check((await ask.getAttribute("placeholder")) === "Say what to watch", "the Watch chip, and the box asks what to watch")
  await ask.fill("tell me if studio-booking.com goes down")
  await shotQuick("quick-02-typed")
  await ask.press("Enter")
  await quick.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 60_000 })
  const plan = await quick.getByRole("dialog", { name: "Quick bar" }).innerText()
  check(/studio-booking\.com[\s\S]*Up now, (under )?\d+\.\d s\. I’ll check every 5 minutes and tell you right away if it goes down or gets much slower\.[\s\S]*Change it later in Watching\./.test(plan), `inline plan: ${plan.replace(/\n/g, " | ")}`)
  await shotQuick("quick-03-plan")
  await ask.press("Enter")
  await quick.getByText("Watching studio-booking.com").waitFor({ timeout: 30_000 })
  check(/Up, (under )?\d+\.\d s\. You’ll hear only if something’s wrong\.[\s\S]*Closes in a moment/.test(await quick.getByRole("dialog", { name: "Quick bar" }).innerText()), "started, closes in a moment")
  await shotQuick("quick-04-started")
  check((await list()).watches.some((w) => w.name === "studio-booking.com"), "the watch exists")
  await quick.getByRole("button", { name: "Open" }).click()
  await main.getByText("studio-booking.com").first().waitFor()
  check(true, "Open shows the watch in the main window")

  // 13. A plain sentence in the bar stays a normal question (no chip, no plan).
  await app.evaluate(() => globalThis.__axeToggleQuickBar())
  await quick.waitForTimeout(500)
  check((await ask.getAttribute("placeholder")) !== "Say what to watch", "the bar opens without the chip after a watch started")

  void siteId
  log(failures ? `FAILED ${failures}` : "OK")
  if (failures) process.exitCode = 1
} catch (e) {
  await shot("fail").catch(() => {})
  log("main at failure:", (await main.innerText().catch(() => "?")).slice(0, 2000))
  log("notices:", JSON.stringify(notices()))
  throw e
} finally {
  await app.close()
  site.close()
}
