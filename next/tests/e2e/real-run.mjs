// One-off check of the real app: real engine, real local server, a fresh test user.
// node tests/e2e/real-run.mjs <out-dir>  (needs AXE_SELFTEST_COOKIE and the server on :3000)
// node tests/e2e/real-run.mjs <out-dir> rich   asks for a chart and a choice, and picks one (rich replies)
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
const app = await electron.launch({
  // Root in a Linux container has no Chromium sandbox.
  args: [
    ".",
    // Root in a Linux container has no Chromium sandbox, and the virtual screen (xvfb) has no GPU.
    ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ...(process.platform === "linux" && process.env.DISPLAY?.startsWith(":9") ? ["--disable-gpu"] : []),
  ],
  env: { ...process.env, AXE_BASE_URL: process.env.AXE_BASE_URL ?? "http://localhost:3000", AXE_SELFTEST: "1", AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-real-")) },
  // Recording blocks painting under Linux's virtual screen (xvfb); screenshots are enough there.
  ...(process.platform === "linux" ? {} : { recordVideo: { dir: out, size: { width: 1440, height: 900 } } }),
})
const win = await mainWindow(app)
// Fail with a message instead of waiting forever when something never shows up.
win.setDefaultTimeout(60_000)
// Under Linux's virtual screen (xvfb) resizing from the test breaks the X connection and the window closes;
// there the window already opens at the screen's size.
if (process.platform !== "linux") await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, n + ".png") })
await win.waitForTimeout(2500)
await shot("1-start")
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) { await signIn.click(); await win.waitForTimeout(4000) }
await shot("2-new-chat")
if (process.argv[3] === "rich") {
  await richRun()
  await app.close()
  console.log("done")
  process.exit(0)
}
const box = win.getByPlaceholder(/how can i help/i)
await box.click()
await box.fill("In one sentence, what is Lisbon known for? Then a 3-row markdown table of its best viewpoints with a column for the best time to go.")
await win.keyboard.press("Enter")
await win.waitForTimeout(1200)
await shot("3-working")
await win.locator("table").first().waitFor({ timeout: 90000 }).catch(() => {})
await win.waitForTimeout(2500)
await shot("4-reply")
const steps = win.getByRole("button", { name: /thought|searched|read|ran|used/i }).first()
if (await steps.isVisible().catch(() => false)) { await steps.click(); await win.waitForTimeout(600); await shot("5-steps-open") }
await win.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
await win.waitForTimeout(500)
await shot("6-palette")
await win.keyboard.press("Escape")
await app.close()
console.log("done")

async function richRun() {
  const box = win.getByPlaceholder(/how can i help/i)
  await box.click()
  await box.fill(
    "My shop's sales this week: Mon 12, Tue 18, Wed 15, Thu 22, Fri 30, Sat 41, Sun 37. Chart them, then ask me to choose whether next week's plan should aim for growth or for steady sales.",
  )
  await win.keyboard.press("Enter")
  await win.waitForTimeout(1500)
  await shot("3-working")
  const choices = win.getByRole("region", { name: "Choose one" })
  const chart = win.locator("section.rich-card svg[role=img]").first()
  await Promise.all([chart.waitFor({ timeout: 120000 }), choices.waitFor({ timeout: 120000 })]).catch((e) => console.log("missing card:", e.message))
  await win.waitForTimeout(1500)
  await shot("4-chart-and-choice")
  console.log("chart:", await chart.isVisible().catch(() => false), "choices:", await choices.isVisible().catch(() => false))
  if (await chart.isVisible().catch(() => false)) {
    await chart.scrollIntoViewIfNeeded()
    const b = await chart.boundingBox()
    if (b) await win.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2)
    await win.waitForTimeout(700)
    await shot("5-chart-hover")
  }
  if (await choices.isVisible().catch(() => false)) {
    await choices.scrollIntoViewIfNeeded()
    const first = choices.getByRole("button").first()
    console.log("picking:", (await first.innerText()).split("\n").join(" "))
    await first.click()
    await win.waitForTimeout(1500)
    await shot("6-picked")
    await win.getByRole("button", { name: "Try again" }).last().waitFor({ timeout: 120000 }).catch(() => {})
    await win.waitForTimeout(2000)
    const jump = win.getByRole("button", { name: "Jump to latest" })
    if (await jump.isVisible().catch(() => false)) await jump.click()
    await win.waitForTimeout(800)
    await shot("7-follow-up")
  }
  // Reopened from the server: the first message shows without the card hint the app sent with it.
  const title = (await win.locator('[aria-current="page"]').first().innerText()).trim()
  await win.getByRole("button", { name: "New chat" }).first().click()
  await win.waitForTimeout(800)
  await win.getByRole("navigation", { name: "Chats" }).getByText(title, { exact: true }).first().click()
  await win.waitForTimeout(2500)
  await win.locator("[data-thread-scroll]").evaluate((el) => el.scrollTo(0, 0))
  await win.waitForTimeout(600)
  await shot("8-reopened")
  const first = await win.locator("[data-thread-scroll] .ml-auto").first().innerText()
  console.log("first message after reload:", JSON.stringify(first))
  const md = await win.locator(".md").allInnerTexts()
  console.log("reply text:", md.join("\n---\n").slice(0, 600))
}
