// The real app with a real Ollama on this computer, signed out (no website needed): Ollama starts when a
// message needs it, Do it with a local model writes a file in a temp workspace and asks before replacing
// it, a local model calls a connector (the fake Taskboard), and quitting stops only the Ollama Axe started.
// Ollama must be installed and stopped, with the model pulled.
// node tests/e2e/local-tools-run.mjs <out-dir> [model name as the picker shows it, default "Qwen2.5 7B"]
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { startFakeMcp } from "../fixtures/fake-mcp.mjs"
import { mainWindow } from "./main-window.mjs"

const [out, modelName = "Qwen2.5 7B"] = process.argv.slice(2)
if (!out) throw new Error("Usage: node tests/e2e/local-tools-run.mjs <out-dir> [model name]")
mkdirSync(out, { recursive: true })

const up = () => fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(500) }).then((r) => r.ok, () => false)
const pids = () => {
  try {
    return execFileSync("pgrep", ["-f", "ollama serve"]).toString().trim().split("\n").filter(Boolean)
  } catch {
    return []
  }
}
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`)
  if (!ok) process.exitCode = 1
}
async function waitUntil(f, ms) {
  const end = Date.now() + ms
  while (!(await f())) {
    if (Date.now() > end) return false
    await new Promise((r) => setTimeout(r, 200))
  }
  return true
}

if (await up()) throw new Error("Ollama is running already. Quit it first: this run checks that Axe starts it.")

const fake = await startFakeMcp({ auth: false })
const root = mkdtempSync(join(tmpdir(), "axe-local-tools-"))
const workspace = join(root, "Workspace")
mkdirSync(workspace)

async function launch(name) {
  const app = await electron.launch({
    // Its own user data folder: never the installed app's.
    args: [".", `--user-data-dir=${join(root, `${name}-profile`)}`],
    env: {
      ...process.env,
      AXE_BASE_URL: "http://localhost:1",
      AXE_SELFTEST: "1",
      AXE_HEADLESS: "1",
      AXE_DATA_DIR: join(root, `${name}-data`),
      AXE_DOIT_WORKSPACE: workspace,
    },
  })
  const win = await mainWindow(app)
  win.setDefaultTimeout(240_000)
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForTimeout(2500)
  return { app, win }
}

async function pickModel(win) {
  await win.locator('button[aria-haspopup="listbox"]').last().click()
  await win.getByRole("listbox", { name: "Choose who answers" }).getByRole("option", { name: new RegExp(`^${modelName}`) }).click()
}

async function sendAndWait(win, text) {
  const t = Date.now()
  await win.getByRole("textbox", { name: "Message" }).fill(text)
  await win.keyboard.press("Enter")
  await win.getByRole("button", { name: "Stop" }).waitFor()
  await win.getByRole("button", { name: "Stop" }).waitFor({ state: "detached" })
  await win.waitForTimeout(800)
  return ((Date.now() - t) / 1000).toFixed(1)
}

const lastReply = (win) => win.evaluate(() => [...document.querySelectorAll("main")].map((m) => m.innerText).join("\n"))

/** The steps of the newest chat's last reply, as stored. */
const steps = (win) =>
  win.evaluate(async () => {
    const [t] = await window.axe.invoke("threads:list")
    const msgs = await window.axe.invoke("threads:messages", t.id)
    return msgs.at(-1).parts.filter((p) => p.type === "tool").map((p) => `${p.title} (${p.state})`)
  })

// 1. Ollama stopped: its model is still in the picker (read from disk). Picking warms it, which would
// start Ollama, so the model is chosen as a saved choice instead: sending must start it.
let { app, win } = await launch("a")
await win.locator('button[aria-haspopup="listbox"]').last().click()
await win.screenshot({ path: join(out, "1-picker-ollama-stopped.png") })
await win.keyboard.press("Escape")
const modelId = await win.evaluate(async (name) => {
  const c = await window.axe.invoke("models:get")
  const m = c.local.find((x) => x.name === name)
  await window.axe.invoke("settings:set", { answerer: { kind: "local", modelId: m.id } })
  return m.id
}, modelName)
await win.reload()
await win.waitForTimeout(2000)
check(!(await up()), `Ollama still stopped before sending (${modelId})`)
const took = await sendAndWait(win, "Make notes.txt in the workspace saying hi")
await win.screenshot({ path: join(out, "2-did-it.png") })
const did = await steps(win)
check(did[0] === "Started Ollama (done)", `steps: ${did.join(", ")} (turn took ${took} s)`)
let notes = ""
try {
  notes = readFileSync(join(workspace, "notes.txt"), "utf8")
} catch {}
check(/hi/i.test(notes), `notes.txt written in the workspace: ${JSON.stringify(notes)}`)
const axeOllama = pids()
check(axeOllama.length > 0, `Ollama running, started by Axe (pid ${axeOllama.join(", ")})`)

// 2. The same chat: replacing the file asks first; "Don't allow" leaves it alone.
writeFileSync(join(workspace, "notes.txt"), "keep me")
await win.getByRole("textbox", { name: "Message" }).fill("Write notes.txt again, saying hello this time")
await win.keyboard.press("Enter")
const asked = await win
  .getByText("Replace notes.txt")
  .first()
  .waitFor({ timeout: 180_000 })
  .then(() => true, () => false)
await win.screenshot({ path: join(out, "3-asks-first.png") })
check(asked, "asked before replacing notes.txt")
if (asked) await win.getByRole("button", { name: "Don't allow" }).first().click()
await win.getByRole("button", { name: "Stop" }).waitFor({ state: "detached" }).catch(() => {})
await win.waitForTimeout(800)
check(readFileSync(join(workspace, "notes.txt"), "utf8") === "keep me", "a no kept the file as it was")
await win.screenshot({ path: join(out, "4-declined.png") })

// 3. A connector: a new chat with the fake Taskboard on; the model calls its read tool.
const view = await win.evaluate((url) => window.axe.invoke("connectors:addCustom", { name: "Taskboard", url }), fake.url)
const id = view.connected[0].id
await win.getByRole("button", { name: "New chat" }).first().click()
await win.waitForTimeout(500)
await win.getByRole("button", { name: "Add files, tools and connectors" }).click()
// Do it off for this one, Taskboard on: the turn goes through the connector loop.
await win.getByRole("menuitem", { name: /^Do it/ }).click()
await win.getByRole("button", { name: "Add files, tools and connectors" }).click()
await win.getByRole("menuitem", { name: /^Taskboard/ }).click()
await win.keyboard.press("Escape")
const took3 = await sendAndWait(win, "What tasks are open on my Taskboard? Use the Taskboard tool.")
await win.screenshot({ path: join(out, "5-connector.png") })
const page3 = await lastReply(win)
check(fake.calls.some((c) => c.tool === "list_tasks"), `the model called Taskboard list_tasks (${took3} s): ${JSON.stringify(fake.calls)}`)
check(/Lisbon|Q3 deck/i.test(page3), "the answer uses the tool's result")
void id

// 4. Quit: Axe stops the Ollama it started.
await app.close()
check(await waitUntil(async () => !(await up()) && pids().length === 0, 10_000), "quitting Axe stopped its Ollama")

// 5. An Ollama you started stays when Axe quits.
const mine = spawn("/opt/homebrew/bin/ollama", ["serve"], { env: { ...process.env, OLLAMA_HOST: "127.0.0.1:11434" }, stdio: "ignore" })
await waitUntil(up, 15_000)
;({ app, win } = await launch("b"))
await pickModel(win)
await sendAndWait(win, "Say hi in three words.")
check(!(await steps(win)).some((x) => x.startsWith("Started Ollama")), "no start step when Ollama was already running")
await app.close()
await new Promise((r) => setTimeout(r, 2000))
check(await up(), "an Ollama you started keeps running after Axe quits")
mine.kill("SIGTERM")
await waitUntil(async () => !(await up()), 10_000)
await fake.close()
console.log(process.exitCode ? "done, with failures" : "done")
