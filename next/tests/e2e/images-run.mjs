// Pictures an agent makes, for real (spec 0035): the built app with the stand-in agent, which writes
// glass.svg in a throwaway folder. The reply shows the picture inline from Axe's own copy, and the folder
// holds only what the agent wrote.
// node tests/e2e/images-run.mjs <out-dir>   (pnpm run build first)
import { mkdirSync, mkdtempSync, readdirSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
if (!out) throw new Error("node tests/e2e/images-run.mjs <out-dir>")
mkdirSync(out, { recursive: true })
const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-images-run-")))
const folder = join(root, "Glass")
mkdirSync(folder)
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240">`,
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe8ff"/><stop offset="1" stop-color="#5b8def"/></linearGradient></defs>`,
  `<rect width="360" height="240" rx="24" fill="#0e1726"/>`,
  `<path d="M130 40 L230 40 L215 200 Q180 215 145 200 Z" fill="url(#g)" opacity="0.85"/>`,
  `<ellipse cx="180" cy="40" rx="50" ry="10" fill="#e8f3ff" opacity="0.9"/>`,
  `</svg>`,
].join("")
const prompt = `edit:glass.svg=${svg.replaceAll(" ", "%20")}`

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: join(root, "data"),
    AXE_TEST_AGENT: `Test agent|${join(import.meta.dirname, "../fixtures/fake-agent.mjs")}`,
  },
})
try {
  const win = await mainWindow(app)
  await win.setViewportSize({ width: 1280, height: 860 })
  await win.waitForTimeout(1500)
  const { threadId } = await win.evaluate(
    (a) => window.axe.invoke("chat:send", { threadId: null, text: a.prompt, answerer: { kind: "agent", agentId: "test-agent" }, cwd: a.cwd, mode: "full" }),
    { prompt, cwd: folder },
  )
  log("sent; chat", threadId)
  // Opens the chat the way a notification click does.
  await app.evaluate(({ BrowserWindow }, id) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("axe:event", "openThread", { threadId: id })
  }, threadId)
  const img = win.locator('img[alt="glass.svg"]')
  await img.waitFor({ timeout: 30_000 })
  const shown = await img.evaluate(async (el) => (await el.decode().catch(() => {}), { w: el.naturalWidth, h: el.naturalHeight, src: el.getAttribute("src")?.slice(0, 26) }))
  log("shown", JSON.stringify(shown))
  if (shown.w !== 360 || shown.h !== 240 || shown.src !== "data:image/svg+xml;base64,") throw new Error("the picture didn't render from Axe's copy")
  await img.scrollIntoViewIfNeeded()
  await win.waitForTimeout(300)
  await win.screenshot({ path: join(out, "mac-glass.png") })
  const files = readdirSync(folder)
  if (files.join() !== "glass.svg") throw new Error(`the folder holds ${files.join(", ")}`)
  const copies = readdirSync(join(root, "data", "agent-images"))
  log("Axe's copies:", copies.length, "chat folder(s)")
  log("PASSED")
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await app.close()
}
