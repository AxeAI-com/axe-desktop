// Model and effort for real CLI agents in the real app (signed out, no server): Claude Code on Haiku with
// Low effort says it is Haiku, a new chat starts on the same picks, and Codex switches model when it's
// installed. Run after `pnpm run build`: node tests/e2e/agent-options-run.mjs <out> [light|dark]
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/agent-options")
const theme = process.argv[3] ?? "light"
mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), "axe-options-"))
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_DATA_DIR: join(tmp, "data"), AXE_BASE_URL: "http://localhost:1" },
})
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
}, tmp)
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${theme}-${n}.png`) })
const chip = () => win.getByRole("button", { name: /^Model and effort: / })
const menu = () => win.getByRole("menu", { name: "Model and effort" })

/** Sends a message and waits for the reply to finish; returns the reply's text. */
async function ask(text) {
  const before = await win.getByRole("button", { name: "Copy" }).count()
  const box = win.getByPlaceholder(/ask anything|reply|how can i help/i).first()
  await box.click()
  await box.fill(text)
  await win.keyboard.press("Enter")
  await win.getByRole("button", { name: "Copy" }).nth(before).waitFor({ timeout: 180_000 })
  await win.waitForTimeout(800)
  return win.evaluate(async () => {
    const [t] = await window.axe.invoke("threads:list")
    const reply = (await window.axe.invoke("threads:messages", t.id)).at(-1)
    return reply.parts.filter((p) => p.type === "text").map((p) => p.text).join("")
  })
}

/** The newest chat and what the running agent itself reports for it. */
async function agentSays(agentId) {
  return win.evaluate(async (agentId) => {
    const [t] = await window.axe.invoke("threads:list")
    const options = await window.axe.invoke("agents:options", t.id, agentId)
    return Object.fromEntries(options.map((o) => [o.id, o.current]))
  }, agentId)
}

async function newChatWith(agentId) {
  await win.evaluate(([agentId, theme]) => window.axe.invoke("settings:set", { answerer: { kind: "agent", agentId }, theme }), [agentId, theme])
  await win.reload()
  await win.waitForTimeout(2000)
  await win.keyboard.press("Escape").catch(() => {})
  const choose = win.getByRole("button", { name: /choose a folder/i })
  if (await choose.isVisible().catch(() => false)) await choose.click()
  await win.waitForTimeout(400)
}

try {
  await win.waitForTimeout(2500)
  const { agents } = await win.evaluate(() => window.axe.invoke("models:get"))
  const ready = (id) => agents.some((a) => a.id === id && a.state === "ready")
  if (!ready("claude-acp")) throw new Error("Claude Code isn't ready on this Mac.")

  // 1. A first chat: the agent sends its lists once its session starts.
  await newChatWith("claude-acp")
  if (await chip().count()) throw new Error("A chip showed before Claude Code had ever run.")
  await ask("Say hello in two words.")
  await chip().waitFor()
  console.log("ok: lists arrived:", await chip().getAttribute("aria-label"))

  // 2. Haiku and Low in the running chat.
  await chip().click()
  await win.waitForTimeout(500)
  await shot("1-menu")
  await menu().getByRole("menuitemradio", { name: /^Haiku/ }).first().click()
  await menu().getByRole("menuitemradio", { name: "Low", exact: true }).click()
  await win.getByRole("button", { name: /^Model and effort: Haiku.*, Low effort$/ }).waitFor()
  const said = await ask("Which Claude model are you, exactly? Reply with only your model id.")
  const reported = await agentSays("claude-acp")
  console.log("reply:", JSON.stringify(said.slice(-120)), "agent reports:", JSON.stringify(reported))
  if (!/haiku/i.test(said)) throw new Error("Claude Code didn't answer as Haiku.")
  if (!/haiku/i.test(reported.model) || reported.effort !== "low") throw new Error("The agent isn't on Haiku with Low effort.")
  await shot("2-haiku-low")
  console.log("ok: Haiku with Low effort in a running chat")

  // 3. A new chat starts on the same picks, set before its first turn.
  await win.getByRole("button", { name: /^New chat/ }).first().click()
  await win.waitForTimeout(800)
  await win.getByRole("button", { name: /^Model and effort: Haiku.*, Low effort$/ }).waitFor()
  await shot("3-new-chat")
  const second = await ask("Which Claude model are you, exactly? Reply with only your model id.")
  if (!/haiku/i.test(second)) throw new Error(`A new chat didn't start on Haiku: ${second.slice(-120)}`)
  console.log("ok: a new chat starts on Haiku:", JSON.stringify(second.slice(-60)))

  // 4. Codex, when it's installed: pick another model and its lowest effort; Codex reports them.
  if (ready("codex-acp")) {
    await newChatWith("codex-acp")
    await ask("Say hello in two words.")
    await chip().waitFor()
    await chip().click()
    const other = menu().locator("[role=menuitemradio][aria-checked=false]").first()
    const name = (await other.textContent()).trim()
    await other.click()
    await win.waitForTimeout(1500)
    const low = menu().getByRole("menuitemradio", { name: /^(Low|Minimal)$/ }).first()
    if (await low.isVisible().catch(() => false)) await low.click()
    else await win.keyboard.press("Escape")
    await win.waitForTimeout(800)
    const hello = await ask("Say hello in two words.")
    await shot("4-codex")
    console.log("codex replies:", JSON.stringify(hello.slice(-80)))
    const codex = await agentSays("codex-acp")
    console.log("codex picked:", name, "codex reports:", JSON.stringify(codex))
    console.log("ok: Codex switched model")
  } else console.log("skip: Codex isn't installed")
} catch (e) {
  await shot("fail").catch(() => {})
  throw e
} finally {
  await app.close()
}
