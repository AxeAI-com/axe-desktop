// Chat from the phone, for real (remote control step 4, docs/remote-control-SECURITY.md section 6): the
// built app with the stand-in agent, and a WebKit iPhone on axeai.com/remote, paired.
// 1. On the Mac, a chat with the agent in a throwaway folder (so the phone has a folder to work in).
// 2. On the phone: a new chat with the agent in Bypass. The Mac's banner says so at once, the reply
//    streams to the phone, the file is written, nothing asks.
// 3. The phone switches the chat to Ask and sends again: the agent asks, and the phone answers Allow.
// 4. A 300 KB file from the phone (four sealed pieces) goes with a message.
// 5. The Mac's log lists what the phone did. Stop on the banner ends it and turns phone use off.
// node tests/e2e/chat-run.mjs <out-dir> [agent id]   (same environment as link-run.mjs; pnpm run build first)
// With an agent id ("claude-code", "codex"), the real CLI answers plain-English prompts (it spends that
// CLI's usage); without one, the stand-in agent does.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron, devices, webkit } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
const agentId = process.argv[3] ?? "test-agent"
const real = agentId !== "test-agent"
const T = real ? 240_000 : 30_000
const say = real
  ? {
      seed: "Reply with one word: ok",
      first: "Create a file named hello.txt in this folder containing exactly: hi from the phone. Then reply in one short sentence.",
      second: "Create a file named second.txt in this folder containing exactly: two. Then reply in one short sentence.",
      file: "Reply with one word: ok",
    }
  : { seed: "Say hi", first: "edit:hello.txt=hi from the phone", second: "edit:second.txt=two", file: "Say hi" }
const base = process.env.AXE_BASE_URL
const apiDir = process.env.AXE_API_DIR
const apiEnv = JSON.parse(process.env.AXE_API_ENV ?? "{}")
if (!out || !base || !apiDir || !apiEnv.PORT) throw new Error("See link-run.mjs for what this needs.")
mkdirSync(out, { recursive: true })
const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-chat-run-")))
const folder = join(root, "Shop")
mkdirSync(folder)
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)
const fail = (why) => {
  console.error("FAILED:", why)
  process.exitCode = 1
}

const api = spawn(process.execPath, [join(apiDir, "../../node_modules/tsx/dist/cli.mjs"), "src/server.ts"], {
  cwd: apiDir,
  env: { ...process.env, ...apiEnv },
  stdio: ["ignore", "ignore", "inherit"],
})
for (const end = Date.now() + 30_000; Date.now() < end; ) {
  if (await fetch(`http://127.0.0.1:${apiEnv.PORT}/api/health`).then((r) => r.ok).catch(() => false)) break
  await new Promise((r) => setTimeout(r, 50))
}

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: join(root, "data"),
    AXE_DEVICE_NAME: "David's MacBook Pro",
    AXE_PHONE_ALLOW: "1",
    AXE_TEST_AGENT: `Test agent|${join(import.meta.dirname, "../fixtures/fake-agent.mjs")}`,
  },
})
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const browser = await webkit.launch()
const mac = (n) => win.screenshot({ path: join(out, `${n}.png`) })

try {
  await win.waitForTimeout(2000)
  // 1. A chat on the Mac in a throwaway folder.
  const name = (await win.evaluate(() => window.axe.invoke("models:get"))).agents.find((x) => x.id === agentId)?.name
  if (!name) throw new Error(`${agentId} isn't ready on this computer`)
  log(`agent: ${name}`)
  await win.evaluate(
    (a) => window.axe.invoke("chat:send", { threadId: null, text: a.seed, answerer: { kind: "agent", agentId: a.id }, cwd: a.cwd, mode: "full" }),
    { seed: say.seed, id: agentId, cwd: folder },
  )
  await win.evaluate(() => window.axe.invoke("phones:setEnabled", true))
  let code = null
  for (let i = 0; i < 50 && !code; i++) {
    code = await win.evaluate(() => window.axe.invoke("phones:code"))
    if (!code) await win.waitForTimeout(100)
  }
  const ctx = await browser.newContext({ ...devices["iPhone 15"] })
  await ctx.addCookies([{ name: "axeai_session", value: process.env.AXE_WEB_TOKEN, url: base }])
  const phone = await ctx.newPage()
  await phone.goto(code.link)
  await phone.getByText("Connected to David's MacBook Pro").waitFor({ timeout: 20_000 })
  await phone.getByRole("link", { name: "Done" }).click()
  await phone.getByText("On David's MacBook Pro", { exact: true }).waitFor({ timeout: 20_000 })
  log("phone on /remote, connected")

  // 2. A new chat in Bypass from the phone.
  await phone.getByLabel("Who answers", { exact: true }).selectOption({ label: name })
  await phone.getByPlaceholder(`Reply to ${name}`).waitFor()
  await phone.getByLabel("Mode", { exact: true }).selectOption("full")
  await phone.getByLabel("Message", { exact: true }).fill(say.first)
  await phone.getByRole("button", { name: "Send" }).click()
  await win.getByText(/David's iPhone: Started .* in Bypass/).waitFor({ timeout: 15_000 })
  await mac("1-mac-bypass-banner")
  log("Mac banner shows Bypass from the phone")
  await phone.getByRole("button", { name: "Send" }).waitFor({ timeout: T })
  await phone.waitForTimeout(400)
  await phone.screenshot({ path: join(out, "2-phone-chat-bypass.png") })
  if (!existsSync(join(folder, "hello.txt"))) throw new Error(`the agent didn't write hello.txt in the chat's folder: ${(await phone.getByRole("log", { name: "Messages" }).innerText()).slice(-300)}`)
  if (await phone.getByText(/needs your OK/).isVisible()) fail("Bypass asked for an answer")
  log("reply streamed to the phone; file written; nothing asked")

  // 3. Ask mode: the agent waits for an answer on the Mac.
  await phone.getByLabel("Mode", { exact: true }).selectOption("ask")
  await phone.getByLabel("Message", { exact: true }).fill(say.second)
  await phone.getByRole("button", { name: "Send" }).click()
  await phone.getByText(/needs your OK/).waitFor({ timeout: T })
  await phone.screenshot({ path: join(out, "3-phone-waiting.png") })
  if (existsSync(join(folder, "second.txt"))) fail("Ask mode wrote without asking")
  log("Ask mode: the agent asks on the phone")
  await phone.getByRole("button", { name: /^(Allow|Yes)/ }).first().click()
  await phone.getByRole("button", { name: "Send" }).waitFor({ timeout: T })
  if (!existsSync(join(folder, "second.txt"))) fail("Allow from the phone didn't let the agent write second.txt")
  if (await phone.getByText(/needs your OK/).isVisible()) fail("the question stayed on the phone after answering")
  log("answered Allow from the phone; the agent went on")

  // 4. A file from the phone.
  const big = Buffer.alloc(300 * 1024, 7)
  await phone.getByLabel("Attach files", { exact: true }).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: big })
  await phone.getByRole("button", { name: "Remove notes.txt" }).waitFor()
  await phone.getByLabel("Message", { exact: true }).fill(say.file)
  await phone.getByRole("button", { name: "Send" }).click()
  const dir = join(root, "data", "attachments")
  const findFile = () => (existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith("notes.txt")) : undefined)
  for (let i = 0; i < 100 && !findFile(); i++) await phone.waitForTimeout(100)
  const savedFile = findFile()
  if (!savedFile || statSync(join(dir, savedFile)).size !== big.length) fail("the file didn't arrive whole on the Mac")
  await phone.waitForTimeout(500)
  await phone.screenshot({ path: join(out, "4-phone-after-file.png") })
  log("a 300 KB file went from the phone to the Mac in pieces")

  // 5. The log, then Stop.
  await win.keyboard.press("Meta+Comma")
  await win.getByText("What the phone did").waitFor({ timeout: 10_000 })
  await win.locator("#settings-phone-log").scrollIntoViewIfNeeded()
  await win.waitForTimeout(400)
  await mac("5-mac-log")
  const lines = await win.locator("#settings-phone-log").innerText()
  for (const want of ["Connected", "in Bypass", "Switched", "to Ask", "Allowed", "Sent a message with a file"])
    if (!lines.includes(want)) fail(`the log doesn't say "${want}"`)
  await win.getByRole("status").getByRole("button", { name: "Stop" }).click()
  await phone.getByText(/is offline|Connecting to/).waitFor({ timeout: 15_000 })
  const enabled = await win.evaluate(async () => (await window.axe.invoke("phones:get")).enabled)
  if (enabled) fail("Stop left phone use on")
  await phone.screenshot({ path: join(out, "6-phone-after-stop.png") })
  log("Stop on the Mac: phone cut off, phone use off")
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
  await mac("failure").catch(() => {})
} finally {
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 5000))])
  await within(browser.close())
  await within(app.close())
  api.kill("SIGKILL")
}
if (!process.exitCode) log("PASSED")
