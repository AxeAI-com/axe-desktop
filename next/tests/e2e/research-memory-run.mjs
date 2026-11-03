// The real app against the local server: memory, a research run on the free Auto model, the usage
// ring, and a real Claude Code chat for the / menu and its CLAUDE.md.
// node tests/e2e/research-memory-run.mjs <out-dir>  (needs AXE_SELFTEST_COOKIE and the server on :3000)
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const folder = mkdtempSync(join(tmpdir(), "axe-skills-work-"))
writeFileSync(join(folder, "CLAUDE.md"), "# Trip notes\n\nKeep replies to one sentence.\n")
mkdirSync(join(folder, ".claude/skills/trip-notes"), { recursive: true })
writeFileSync(join(folder, ".claude/skills/trip-notes/SKILL.md"), "---\nname: trip-notes\ndescription: Turn a trip plan into tidy notes\n---\n\nWrite notes.\n")

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_BASE_URL: "http://localhost:3000", AXE_SELFTEST: "1", AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-real-")) },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})
await app.evaluate(({ dialog, shell }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  // Opening CLAUDE.md would start the owner's editor; note it instead.
  shell.openPath = async (p) => ((globalThis.__opened = p), "")
}, folder)
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const box = () => win.getByRole("textbox", { name: "Message" })

await win.waitForTimeout(2500)
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) {
  await signIn.click()
  await win.getByRole("heading", { name: /good (morning|afternoon|evening)/i }).waitFor({ timeout: 20_000 })
}
await win.waitForTimeout(2000)
log("signed in")

// 1. Memory
await win.getByRole("button", { name: "Account", exact: true }).click()
await win.getByRole("menuitem", { name: "Settings" }).click()
await win.getByRole("heading", { name: "Settings" }).waitFor()
await win.screenshot({ path: join(out, "00-settings.png") })
const add = win.getByRole("textbox", { name: "Something to remember" })
await add.fill("I run a small video studio called Northlight Films.")
await win.keyboard.press("Enter")
await add.fill("Prices in US dollars.")
await win.keyboard.press("Enter")
await win.getByText("Prices in US dollars.").waitFor()
await win.waitForTimeout(600)
await shot("01-memory")
log("memory saved")

// 2. Research on the free Auto model
await win.getByRole("button", { name: "New chat" }).first().click()
await win.getByRole("heading", { name: /good (morning|afternoon|evening)/i }).waitFor()
await win.getByRole("button", { name: "Add files, tools and connectors" }).click()
await win.getByRole("menuitem", { name: "Research" }).click()
await win.waitForTimeout(400)
await shot("02-research-on")
await box().fill("How do freelance video editors usually price a 60-second promo film? Keep the report short.")
await win.keyboard.press("Enter")
const live = win.getByRole("region", { name: "Research in progress" })
await live.waitFor({ timeout: 30_000 })
await win.waitForTimeout(1500)
await shot("03-research-planning")
let shots = 0
let sections = 0
const started = Date.now()
for (;;) {
  const done = await win.getByRole("button", { name: /Researched for|Research stopped/ }).isVisible().catch(() => false)
  const failed = await win.getByRole("alert").isVisible().catch(() => false)
  if (done || failed || Date.now() - started > 240_000) break
  const n = await win.getByRole("article", { name: "Research report" }).locator("h2").count().catch(() => 0)
  if (n > sections && shots < 4) {
    sections = n
    await shot(`04-research-building-${++shots}`)
    log("sections", n)
  } else if (shots === 0 && Date.now() - started > 8000) {
    await shot(`04-research-building-${++shots}`)
  }
  await win.waitForTimeout(1500)
}
await win.waitForTimeout(1500)
const failed = await win.getByRole("alert").textContent().catch(() => null)
log("research finished", failed ? `with error: ${failed}` : "", Math.round((Date.now() - started) / 1000), "s")
await win.evaluate(() => document.querySelector("[data-thread-scroll]")?.scrollTo(0, 0))
await win.waitForTimeout(500)
await shot("05-research-top")
await win.evaluate(() => {
  const el = document.querySelector("[data-thread-scroll]")
  el?.scrollTo(0, el.scrollHeight)
})
await win.waitForTimeout(500)
await shot("06-research-report")
const cites = await win.getByRole("article", { name: "Research report" }).locator("a.cite").count().catch(() => 0)
const sources = await win.getByRole("article", { name: "Research report" }).locator("footer li").count().catch(() => 0)
log("citation chips", cites, "sources", sources)
const ring = win.getByRole("button", { name: /context used|tokens in context/ })
if (await ring.isVisible().catch(() => false)) {
  await ring.click()
  await win.waitForTimeout(500)
  await shot("07-usage-axe")
  log("ring", await ring.getAttribute("aria-label"))
  await win.keyboard.press("Escape")
}

// 3. Memory reaches a new chat
await win.getByRole("button", { name: "New chat" }).first().click()
await win.getByRole("heading", { name: /good (morning|afternoon|evening)/i }).waitFor()
await win.getByRole("button", { name: "Research is on. Turn it off" }).click()
await box().fill("In one short sentence: what is the name of my business?")
await win.keyboard.press("Enter")
await win.getByRole("button", { name: "Copy", exact: true }).last().waitFor({ timeout: 90_000 }).catch(() => {})
await win.waitForTimeout(1000)
await shot("08-memory-used")
const answer = await win.locator(".md").last().textContent().catch(() => "")
log("memory answer:", JSON.stringify(answer))

// 4. Claude Code: its / commands, skills and CLAUDE.md
await win.getByRole("button", { name: "New chat" }).first().click()
await win.getByRole("heading", { name: /good (morning|afternoon|evening)/i }).waitFor()
await win.getByRole("button", { name: /^Auto/ }).first().click()
await win.getByText("Claude Code", { exact: true }).first().click()
await win.waitForTimeout(800)
await box().fill("/")
await win.waitForTimeout(800)
await shot("09-slash-before-start")
await box().fill("Reply with just the word: ready")
await win.keyboard.press("Enter")
for (let i = 0; i < 120; i++) {
  const allow = win.getByRole("region", { name: "Allow this?" }).getByRole("button").first()
  if (await allow.isVisible().catch(() => false)) await allow.click()
  if (await win.getByRole("button", { name: "Copy", exact: true }).last().isVisible().catch(() => false)) break
  await win.waitForTimeout(1000)
}
await win.waitForTimeout(2500)
await shot("10-claude-reply")
const docked = win.getByPlaceholder(/Reply to Claude Code/)
await docked.fill("/")
await win.getByRole("listbox", { name: "Commands" }).waitFor()
await win.waitForTimeout(600)
await shot("11-slash-claude-code")
const groups = await win.getByRole("listbox", { name: "Commands" }).locator("div.px-2\\.5.pt-2").allTextContents()
const names = await win.getByRole("option").allTextContents()
log("groups", groups, "options", names.length, names.slice(0, 12).map((n) => n.split(/\s{2,}|(?<=\S)(?=[A-Z])/)[0]))
await docked.fill("/comp")
await win.waitForTimeout(400)
await shot("12-slash-filtered")
await win.keyboard.press("Enter")
log("picked:", JSON.stringify(await docked.inputValue()))
await docked.fill("")
await win.getByRole("button", { name: "Add files, tools and connectors" }).click()
await win.getByRole("menuitem", { name: "Open CLAUDE.md" }).waitFor({ timeout: 5000 })
await win.waitForTimeout(400)
await shot("13-claude-md")
await win.getByRole("menuitem", { name: "Open CLAUDE.md" }).click()
await win.waitForTimeout(500)
log("opened:", await app.evaluate(() => globalThis.__opened))
const agentRing = win.getByRole("button", { name: /context used|tokens in context|Usage/ })
await agentRing.click()
await win.waitForTimeout(500)
await shot("14-usage-claude-code")
log("agent ring", await agentRing.getAttribute("aria-label"))
await app.close()
console.log("done")
