// Uptime and speed end to end in the real app, against a local site that can be up, slow (six big
// photos, sent slowly) or down (502). Starter, ask, validation, plan, first run, the thread, the down and
// slow cards, snooze, That's expected, a reply, the list, the sidebar badge, and the notifications.
// node tests/e2e/uptime-run.mjs <out-dir> [light|dark]   (run `pnpm run build` first; needs no account)
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { crc32, deflateSync } from "node:zlib"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/uptime")
const theme = process.argv[3] === "dark" ? "dark" : "light"
mkdirSync(out, { recursive: true })

// The site. "hang" answers after 4 s, so the "Checking …" line can be seen.
let mode = "up"
const MB = 1024 * 1024
// Real PNGs of noise (a browser drops a file that isn't a real image), so the sizes are what's sent.
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const rows = []
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), randomBytes(w * 3))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 0 })), chunk("IEND", Buffer.alloc(0))])
}
const hero = png(280, 290)
const photo = png(1450, 1450)
const added = new Date(Date.now() - 3 * 60_000).toUTCString()
const page = (imgs) => `<!doctype html><html><head><title>Lane Ceramics</title></head><body><h1>Lane Ceramics</h1>${imgs}</body></html>`
const site = createServer((req, res) => {
  if (mode === "down") return res.writeHead(502, "Bad Gateway").end("Bad Gateway")
  if (mode === "hang") return void setTimeout(() => res.writeHead(200).end(page("")), 4000)
  if (req.url === "/hero.png") return void setTimeout(() => res.writeHead(200, { "content-type": "image/png", "content-length": hero.length }).end(hero), 700)
  if (req.url?.startsWith("/vase-")) {
    // 6 MB in 40 slices over about 3.6 s.
    res.writeHead(200, { "content-type": "image/png", "content-length": photo.length, "last-modified": added })
    let i = 0
    const step = photo.length / 40
    const t = setInterval(() => {
      res.write(photo.subarray(i * step, (i + 1) * step))
      if (++i >= 40) clearInterval(t), res.end()
    }, 90)
    return
  }
  const imgs = mode === "slow" ? `<img src="/hero.png">${["blue", "green", "white", "rust", "ash", "moss"].map((c) => `<img src="/vase-${c}.png">`).join("")}` : `<img src="/hero.png">`
  res.writeHead(200, { "content-type": "text/html" }).end(page(imgs))
})
await new Promise((r) => site.listen(0, "127.0.0.1", r))
const host = `localhost:${site.address().port}`

const notifyLog = join(mkdtempSync(join(tmpdir(), "axe-uptime-notes-")), "notes.jsonl")
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_NOTIFY_LOG: notifyLog,
    AXE_WATCH_RETRY_MS: "1500",
    AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-uptime-")),
    // Replies and sentences go to the stand-in agent, never a real account.
    AXE_TEST_AGENT: `Test agent|${join(import.meta.dirname, "../fixtures/fake-agent.mjs")}`,
  },
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}-${theme}.png`) })
const log = (...a) => console.log(...a)
const notes = () => (existsSync(notifyLog) ? readFileSync(notifyLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
await win.waitForTimeout(2500)
await win.evaluate((t) => window.axe.invoke("settings:set", { theme: t, answerer: { kind: "agent", agentId: "test-agent" } }), theme)
await win.reload()
await win.waitForTimeout(2000)
await win.keyboard.press("Escape").catch(() => {})

const main = win.getByRole("main")
const box = () => win.getByRole("textbox").last()
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

// 1. The empty page and a starter.
await win.getByRole("button", { name: /^Watching/ }).first().click()
await win.getByText("What should Axe watch?").waitFor()
await box().click()
await win.getByTestId("catalogue").getByRole("button", { name: "Add Uptime and speed" }).hover()
await shot("01-empty")
await win.getByTestId("catalogue").getByRole("button", { name: "Add Uptime and speed" }).click()
await win.waitForTimeout(200)
await shot("02-ask")

// 2. Validation: not an address, a domain that doesn't exist, a site that isn't answering, then checking.
await box().fill("lane ceramics")
await box().press("Enter")
await win.getByText("That doesn’t look like a site address.").waitFor()
await box().fill("lane-ceramcs.com")
await box().press("Enter")
await win.getByText("lane-ceramcs.com doesn’t exist. Check the spelling.").waitFor({ timeout: 20_000 })
await shot("03-invalid")
mode = "down"
await box().fill(host)
await box().press("Enter")
await win.getByText(`${host} isn’t answering right now.`).waitFor()
await shot("04-not-answering")
mode = "hang"
await box().fill(`https://${host}/`)
await box().press("Enter")
await win.getByText(`Checking ${host}…`).waitFor()
await shot("05-checking")
await win.getByRole("button", { name: "Start watching" }).waitFor({ timeout: 20_000 })
mode = "up"

// 3. The plan, Start, the first run and its result.
await win.waitForTimeout(300)
await shot("06-plan")
await win.getByRole("button", { name: "Start watching" }).click()
await win.getByText("Checking now").waitFor()
await shot("07-first-run")
await win.getByText(/is up and loads in/).waitFor()
await win.waitForTimeout(300)
await shot("08-first-result")
log("created:", await main.innerText().then((t) => t.split("\n").slice(0, 8).join(" | ")))

// 4. A few quiet runs build the usual; the strip shows them, with a tooltip on hover.
for (let i = 0; i < 4; i++) await checkNow()
const ticks = main.getByTestId("watch-strip").locator("g")
await ticks.last().hover()
await win.waitForTimeout(200)
await shot("09-quiet-strip")

// 5. Down: 502 twice, a retry apart. A notice; the card, sidebar and badge.
mode = "down"
await checkNow()
await main.getByText(`${host} is down`).waitFor()
await win.mouse.move(1300, 120)
await shot("10-down")
log("down notice:", JSON.stringify(notes().at(-1)))

// 6. Back up: the card folds, and "Back up after N min." goes out.
mode = "up"
await checkNow()
await main.getByText(/^Down from /).waitFor()
await shot("11-back-up")
log("back up notice:", JSON.stringify(notes().at(-1)))

// 7. Slow: six big photos; two slow runs open it.
mode = "slow"
await checkNow()
await checkNow()
await main.getByText(`${host} is slow`).waitFor({ timeout: 8000 }).catch(async (e) => {
  const l = await win.evaluate(() => window.axe.invoke("watching:list"))
  log(JSON.stringify(l.watches[0].strip.map((t) => [t.status, t.metric])), JSON.stringify(l.watches[0].latest?.files?.slice(0, 3)))
  await shot("fail-slow")
  throw e
})
await win.mouse.move(1300, 120)
await shot("12-slow")
log("slow notice:", JSON.stringify(notes().at(-1)))
log("slow card:", await main.getByTestId("problem-slow").innerText())

// 8. Snooze: the menu, then the snoozed line and Undo.
await main.getByRole("button", { name: "Snooze" }).click()
await win.waitForTimeout(250)
await shot("13-snooze-menu")
await win.getByRole("menuitem", { name: "Until tomorrow" }).click()
await main.getByText(/^Snoozed until tomorrow, 9:00 am\./).waitFor()
await shot("14-snoozed")
await main.getByRole("button", { name: "Undo" }).click()
await main.getByTestId("problem-slow").waitFor()

// 9. That's expected: the card folds, Axe says what changed, Undo brings it back.
await main.getByRole("button", { name: "That’s expected" }).click()
await main.getByText(/as usual for the home page now\./).waitFor()
await shot("15-expected")
await main.getByRole("button", { name: "Undo" }).click()
await main.getByTestId("problem-slow").waitFor()

// 10. A reply that changes the watch.
await box().fill("tell me above 3 s")
await box().press("Enter")
await main.getByText("Okay. I’ll tell you when it takes more than 3 s to load.").waitFor()
await shot("16-reply")

// 11. The list: the problem row on top, the sidebar row and the badge.
await win.getByRole("button", { name: /^Watching/ }).first().click()
await main.getByText("Slow: the home page takes", { exact: false }).first().waitFor()
await win.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
await win.waitForTimeout(600)
await shot("17-list-problem")
log("sidebar:", await win.getByRole("button", { name: /^Watching, / }).first().getAttribute("aria-label"))

const all = notes()
log("notices:", all.length, all.map((n) => `${n.title}: ${n.body} [${(n.actions ?? []).map((a) => a.text).join(", ")}]`).join(" / "))
await app.close()
site.close()
log("done", out)
