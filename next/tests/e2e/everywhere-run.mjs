// Package E in the real app against the local server: the quick bar with the free Auto model and with
// Claude Code, Enter handing each answer to the main window, and voice through a fake microphone.
//   node tests/e2e/everywhere-run.mjs <out-dir> [quick|agent|voice ...]   (default: all three)
// Needs the server on :3000 and AXE_SELFTEST_COOKIE (axe-web scripts/dev-desktop-session.ts).
// Runs headless: nothing is put on screen, no global shortcut is registered, no sound is made, and
// the real microphone and screen are never used: the voice part plays a WAV made with `say` into the
// window's getUserMedia (Electron's fake capture device records silence on macOS).
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
const parts = process.argv.slice(3).length ? process.argv.slice(3) : ["quick", "agent", "voice"]
mkdirSync(out, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// The fake microphone: a sentence, then three seconds of quiet (so Talk hears the turn end).
const wav = join(mkdtempSync(join(tmpdir(), "axe-voice-")), "say.wav")
if (parts.includes("voice")) {
  execFileSync("say", ["-o", wav, "--data-format=LEI16@16000", "What is the capital of Portugal? [[slnc 3000]]"])
}

const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    AXE_BASE_URL: process.env.AXE_BASE_URL ?? "http://localhost:3000",
    AXE_SELFTEST_ORIGIN: process.env.AXE_SELFTEST_ORIGIN ?? "http://localhost:3000",
    AXE_SELFTEST: "1",
    AXE_HEADLESS: "1",
    AXE_DATA_DIR: mkdtempSync(join(tmpdir(), "axe-everywhere-")),
    ...(parts.includes("voice") ? { AXE_FAKE_MIC: "1" } : {}),
  },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})

// Native pickers and the clipboard are stood in for, so the run never touches yours.
const folder = mkdtempSync(join(tmpdir(), "axe-quick-agent-"))
writeFileSync(join(folder, "notes.md"), "# Trip notes\n\n- Lisbon in May\n")
await app.evaluate(({ dialog, clipboard }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  clipboard.read = async () => []
  clipboard.readText = async () => "Flights: TAP 1234 lands 09:40 at LIS. Hotel: Rua das Flores 12, check-in 15:00."
}, folder)

let failures = 0
const check = (ok, what) => {
  log(ok ? "ok  " : "FAIL", what)
  if (!ok) failures++
}

const main = await mainWindow(app)
await main.setViewportSize({ width: 1440, height: 900 })
const shotMain = (n) => main.screenshot({ path: join(out, `${n}.png`) })
await main.waitForTimeout(2500)
// The window works signed out too (agents, local models), so sign in the way the button would;
// the self-test cookie approves it. Window shortcuts (⇧⌘T for Talk) need an account.
if (!(await main.evaluate(() => window.axe.invoke("account:get")))) {
  await main.evaluate(() => window.axe.invoke("account:signIn"))
  await main.reload()
  await main.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }).waitFor({ timeout: 20000 })
}
check(!!(await main.evaluate(() => window.axe.invoke("account:get"))), "signed in")

async function quickWindow() {
  for (let i = 0; i < 50; i++) {
    const w = app.windows().find((p) => p.url().includes("#quick"))
    if (w) return w
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("no quick bar window")
}
const quick = await quickWindow()
// The bar's window changes height with its content; Electron's own capture sees its real size.
const shotQuick = async (n) => {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("#quick"))
    return (await w.webContents.capturePage()).toPNG().toString("base64")
  })
  writeFileSync(join(out, `${n}.png`), Buffer.from(png, "base64"))
}
// Opens the bar the way ⌥Space would.
const toggle = () => app.evaluate(() => globalThis.__axeToggleQuickBar())
const bar = () => quick.getByRole("dialog", { name: "Quick bar" })
const answered = () => quick.getByLabel("Ask Axe").and(quick.locator('[placeholder*="press Enter to open the chat"]')).waitFor({ timeout: 180000 })


if (parts.includes("quick")) {
  await toggle()
  await quick.waitForTimeout(600)
  check(await quick.getByLabel("Ask Axe").evaluate((el) => el === document.activeElement), "the box has focus when the bar opens")
  await shotQuick("quick-1-empty")
  await bar().getByRole("button", { name: /Add your screen/ }).click()
  await quick.getByRole("option", { name: /Add what's copied/ }).click()
  check(await bar().getByText("Copied text.txt").waitFor({ timeout: 5000 }).then(() => true, () => false), "what's copied is attached")
  await quick.getByLabel("Ask Axe").fill("From what I copied: what time does my flight land? One short sentence.")
  await shotQuick("quick-2-asking")
  await quick.keyboard.press("Enter")
  await quick.waitForTimeout(1500)
  await shotQuick("quick-3-streaming")
  await answered()
  await quick.waitForTimeout(800)
  await shotQuick("quick-4-answer")
  const text = await bar().locator(".quick-answer").last().innerText()
  log("answer:", JSON.stringify(text.slice(0, 200)))
  check(/9[:.]40/.test(text), "Auto read the copied text (the answer says 09:40)")
  // Enter on a finished answer opens it as a full chat in the main window.
  await quick.getByLabel("Ask Axe").press("Enter")
  await main.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 10000 })
  await main.waitForTimeout(1500)
  await shotMain("quick-5-in-main")
  check(await main.getByText(/what time does my flight land/i).first().isVisible(), "the main window shows the chat the bar started")
  // Esc hides the bar.
  await toggle()
  await quick.getByLabel("Ask Axe").press("Escape")
  await quick.waitForTimeout(400)
  check(!(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes("#quick") && w.isVisible()))), "Esc hides the bar")
}

if (parts.includes("agent")) {
  await toggle()
  await quick.waitForTimeout(500)
  if (await bar().getByRole("button", { name: "New question" }).isVisible().catch(() => false)) await bar().getByRole("button", { name: "New question" }).click()
  await bar().getByRole("button", { name: /Who answers/ }).click()
  await quick.getByRole("option", { name: /Claude Code/ }).click()
  await quick.waitForTimeout(600)
  await shotQuick("agent-1-picked")
  await quick.getByLabel("Ask Axe").fill("Add a line '- Book the 28 tram early' to notes.md, then tell me in one sentence what you changed.")
  await quick.keyboard.press("Enter")
  await quick.waitForTimeout(4000)
  await shotQuick("agent-2-working")
  for (let i = 0; i < 150; i++) {
    const allow = bar().getByRole("button", { name: /^allow/i }).first()
    if (await allow.isVisible().catch(() => false)) {
      await shotQuick("agent-3-permission")
      await allow.click()
    }
    if (readFileSync(join(folder, "notes.md"), "utf8").includes("28 tram")) break
    await quick.waitForTimeout(1000)
  }
  await answered()
  await quick.waitForTimeout(800)
  await shotQuick("agent-4-answer")
  check(readFileSync(join(folder, "notes.md"), "utf8").includes("28 tram"), "Claude Code edited notes.md from the bar")
  check(await bar().getByText(/Claude Code, in axe-quick-agent-/).isVisible(), "the bar says who answered and where")
  await quick.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter")
  await main.waitForTimeout(2500)
  await shotMain("agent-5-in-main")
  check(await main.getByText(/Book the 28 tram early/).first().isVisible(), "the agent chat opened in the main window")
}

if (parts.includes("voice")) {
  await main.keyboard.press(process.platform === "darwin" ? "Meta+N" : "Control+N")
  await main.waitForTimeout(800)
  // The "microphone": each getUserMedia plays the recording from the start, into the stream only.
  await main.evaluate((b64) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext()
      await ctx.resume()
      const buf = await ctx.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const dest = ctx.createMediaStreamDestination()
      src.connect(dest)
      src.start()
      return dest.stream
    }
  }, readFileSync(wav).toString("base64"))
  // Dictate: the button, a few seconds of the WAV, then write it down.
  await main.getByRole("button", { name: "Dictate" }).first().click()
  await main.getByRole("button", { name: "Write it down" }).waitFor({ timeout: 10000 })
  await main.waitForTimeout(3500)
  await shotMain("voice-1-dictating")
  await main.getByRole("button", { name: "Write it down" }).click()
  await main.waitForFunction(() => /portugal/i.test(document.querySelector("textarea")?.value ?? ""), undefined, { timeout: 30000 }).catch(() => {})
  const said = await main.locator("textarea").first().inputValue()
  log("dictated:", JSON.stringify(said))
  check(/capital of portugal/i.test(said), "dictation wrote the words into the composer")
  // macOS 26 and later write speech down on the Mac itself (axe-speech); elsewhere axeai.com does.
  const onDevice = await main.evaluate(() => window.axe.invoke("voice:onDevice"))
  log("speech to text:", onDevice ? "on this Mac" : "axeai.com")
  await shotMain("voice-2-dictated")
  await main.locator("textarea").first().fill("")

  // Talk: hear the turn, ask Auto, read the answer (silently in tests), listen again.
  await main.keyboard.press(process.platform === "darwin" ? "Meta+Shift+T" : "Control+Shift+T")
  const talk = main.getByRole("dialog", { name: "Talk to Axe" })
  await talk.waitFor({ timeout: 10000 })
  await talk.getByText("Listening", { exact: true }).waitFor({ timeout: 10000 })
  await shotMain("voice-3-talk-listening")
  await talk.getByText("Thinking", { exact: true }).waitFor({ timeout: 40000 })
  await shotMain("voice-4-talk-thinking")
  await talk.getByText("Speaking", { exact: true }).waitFor({ timeout: 120000 })
  await main.waitForTimeout(1200)
  await shotMain("voice-5-talk-speaking")
  const reply = await talk.innerText()
  log("talk:", JSON.stringify(reply.slice(0, 240)))
  check(/lisbon/i.test(reply), "Talk heard the question and Auto answered (Lisbon)")
  const voices = await main.evaluate(
    () =>
      new Promise((done) => {
        if (speechSynthesis.getVoices().length) return done(speechSynthesis.getVoices().length)
        speechSynthesis.addEventListener("voiceschanged", () => done(speechSynthesis.getVoices().length), { once: true })
        setTimeout(() => done(speechSynthesis.getVoices().length), 3000)
      }),
  )
  log("system voices available:", voices)
  await main.keyboard.press("Escape")
  await main.waitForTimeout(800)
  await shotMain("voice-6-talk-ended")
  check(await main.getByText(/capital of Portugal/i).first().isVisible(), "the Talk turn is in the chat")
}

await app.close()
log(failures ? `${failures} check(s) failed` : "all checks passed", "folder:", folder, existsSync(folder))
process.exit(failures ? 1 : 0)
