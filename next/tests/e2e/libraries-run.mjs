// The real app against the local server with the libraries: add a skill and use it from / with the free
// Auto model, connect a fake brand over OAuth (tests/fixtures/fake-mcp.mjs, nothing real is signed in to)
// and let Auto use its tools, and chat with Claude Code in a folder, which also gets the connector over ACP.
// Records a video and screenshots.
// node tests/e2e/libraries-run.mjs <out-dir>  (needs AXE_SELFTEST_COOKIE and the server on :3000; pnpm run build first)
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

import { startFakeMcp } from "../fixtures/fake-mcp.mjs"

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-libraries-run-")))
const home = join(root, "home")
mkdirSync(join(home, ".claude"), { recursive: true })
const notes = join(root, "Launch brief.md")
writeFileSync(notes, "# Spring launch\n\nLaunch day: Tuesday 12 May.\nHotel for the team offsite: Casa Amora, Lisbon.\nTone: calm, plain, no exclamation marks.\n")
const fake = await startFakeMcp()

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_BASE_URL: "http://localhost:3000",
    AXE_SELFTEST: "1",
    AXE_DATA_DIR: join(root, "data"),
    AXE_SKILLS_HOME: home,
    AXE_TEST_CONNECTOR: `Taskboard|${fake.url}`,
    AXE_TEST_SIGNIN: "fetch",
  },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})
await app.evaluate(({ dialog }) => {
  dialog.showOpenDialog = async () => ({ canceled: !globalThis.__pick, filePaths: globalThis.__pick ? [globalThis.__pick] : [] })
})
const pick = (path) => app.evaluate((_, p) => (globalThis.__pick = p), path)
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const box = () => win.getByRole("textbox", { name: "Message" })
const nav = (name) => win.getByRole("navigation", { name: "Chats" }).getByRole("button", { name, exact: true })
const lastAnswer = () => win.locator(".md").last().textContent().catch(() => "")

/** Waits for the reply to finish, answering permission cards with `allow` (a button name). */
async function waitReply(allow = /^allow/i, ms = 150_000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const ask = win.getByRole("button", { name: allow }).first()
    if (await ask.isVisible().catch(() => false)) {
      log("allowing:", await win.locator("text=/wants to|Let /").first().textContent().catch(() => "?"))
      await ask.click()
    }
    const stop = await win.getByRole("button", { name: "Stop" }).isVisible().catch(() => false)
    if (!stop && (await win.getByRole("button", { name: "Copy", exact: true }).last().isVisible().catch(() => false))) return true
    await win.waitForTimeout(1000)
  }
  return false
}

await win.waitForTimeout(2500)
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) {
  await signIn.click()
  await win.getByRole("heading", { name: /good (morning|afternoon|evening)/i }).waitFor({ timeout: 20_000 })
}
await win.waitForTimeout(1500)
log("signed in")

// 1. Skills: add Brand voice to Axe and (the test home's) Claude Code
await nav("Skills").click()
await win.getByRole("button", { name: "Brand voice" }).waitFor()
await win.waitForTimeout(800)
await shot("01-skills")
await win.getByRole("button", { name: "Brand voice" }).click()
await win.getByRole("dialog").getByRole("checkbox", { name: "Claude Code" }).waitFor()
await shot("02-skill-sheet")
await win.getByRole("button", { name: "Add skill" }).click()
await win.getByText("Type /brand-voice in a chat to use it.").waitFor()
await win.keyboard.press("Escape")
const installed = readFileSync(join(home, ".claude/skills/brand-voice/SKILL.md"), "utf8")
log("skill in the test home's ~/.claude/skills:", installed.split("\n")[1])

// 2. Use it from / with the free Auto model
await win.getByRole("button", { name: "New chat", exact: true }).first().click()
await box().fill("/bra")
await win.getByRole("listbox", { name: "Commands" }).waitFor()
await win.waitForTimeout(500)
await shot("03-slash-skill")
await win.keyboard.press("Enter")
await box().type("Rewrite this for our site: OUR NEW APP IS THE BEST AI APP EVER!!! TRY IT NOW!!!")
await win.keyboard.press("Enter")
log("skill reply finished:", await waitReply())
await win.waitForTimeout(1500)
await shot("04-skill-reply")
const skillAnswer = await lastAnswer()
log("skill answer:", JSON.stringify(skillAnswer?.slice(0, 300)), "exclamation marks:", (skillAnswer?.match(/!/g) ?? []).length)
const shown = await win.locator(".bg-bubble").last().textContent().catch(() => "")
log("user message shows:", JSON.stringify(shown?.slice(0, 120)))

// 3. Connect the fake Taskboard over OAuth
await nav("Connectors").click()
await win.getByRole("article", { name: "Taskboard" }).waitFor()
await shot("05-connectors")
await win.getByRole("article", { name: "Taskboard" }).getByRole("button", { name: "Connect" }).click()
await win.getByRole("region", { name: "Connected" }).getByText("2 tools").waitFor({ timeout: 30_000 })
await win.waitForTimeout(600)
await shot("06-connected")
log("connected Taskboard over OAuth")

// 4. Auto uses the connector, asking before it adds a task
await win.getByRole("button", { name: "New chat", exact: true }).first().click()
await win.getByRole("button", { name: "Add files, tools and connectors" }).click()
await win.getByRole("menuitem", { name: "Taskboard" }).click()
await win.keyboard.press("Escape")
await win.getByRole("button", { name: "Connectors on: Taskboard" }).waitFor()
await box().fill("What's still open on my Taskboard? Then add a task called 'Call David about the deck'.")
await shot("07-connector-on")
await win.keyboard.press("Enter")
let asked = false
const t0 = Date.now()
while (Date.now() - t0 < 150_000) {
  const card = win.getByRole("button", { name: "Allow once" }).first()
  if (await card.isVisible().catch(() => false)) {
    asked = true
    await win.waitForTimeout(500)
    await shot("08-connector-asks")
    await card.click()
  }
  const stop = await win.getByRole("button", { name: "Stop" }).isVisible().catch(() => false)
  if (!stop && (await win.getByRole("button", { name: "Copy", exact: true }).last().isVisible().catch(() => false))) break
  await win.waitForTimeout(1000)
}
await win.waitForTimeout(1500)
await shot("09-connector-reply")
log("asked first:", asked, "MCP calls:", JSON.stringify(fake.calls), "answer:", JSON.stringify((await lastAnswer())?.slice(0, 300)))

// 5. Claude Code in a folder: reads the brief there and gets the connector over ACP
// A new chat, and the folder picker answers with the folder that holds the brief.
await win.getByRole("button", { name: "New chat", exact: true }).first().click()
await pick(root)
// The CLI list comes from the ACP registry; open the picker again until Claude Code is in it.
for (let i = 0; ; i++) {
  await win.getByRole("button", { name: /^Auto/ }).first().click()
  const claude = win.getByRole("listbox", { name: "Choose who answers" }).getByText("Claude Code", { exact: true }).first()
  if (await claude.waitFor({ timeout: 10_000 }).then(() => true, () => false)) {
    await claude.click()
    break
  }
  if (i === 5) throw new Error("Claude Code never showed in the picker")
  await win.keyboard.press("Escape")
}
await win.getByRole("button", { name: /^Claude Code/ }).first().waitFor()
await win.waitForTimeout(800)
await box().fill(
  "Read the launch brief in this folder and tell me the hotel for the offsite. Then use the taskboard MCP tool list_tasks and tell me how many tasks are open.",
)
await shot("10-claude-code")
await win.keyboard.press("Enter")
log("claude code finished:", await waitReply(/^(allow|always allow)/i, 240_000))
await win.waitForTimeout(2000)
await shot("11-claude-reply")
log("claude code answer:", JSON.stringify((await lastAnswer())?.slice(0, 400)))
log("MCP calls after Claude Code:", JSON.stringify(fake.calls))
await pick(null)

// 6. An agent from the library
await nav("Agents").click()
await win.getByRole("button", { name: "Writer", exact: true }).click()
await win.getByRole("button", { name: "Start a chat" }).click()
await box().fill("One line for a launch post about the Axe AI desktop app.")
await win.waitForTimeout(400)
await shot("12-agent-start")
await win.keyboard.press("Enter")
log("writer finished:", await waitReply())
await win.waitForTimeout(1500)
await shot("13-agent-reply")
log("writer answer:", JSON.stringify((await lastAnswer())?.slice(0, 300)))

await app.close()
await fake.close()
console.log("done")
