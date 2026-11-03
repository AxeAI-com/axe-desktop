// The agent work view in the real app with real Claude Code, in throwaway folders:
// a plan in Plan mode then Start, an edit then Undo, a rewind, and two agents at once in
// their own worktrees. Notifications go to a log (AXE_NOTIFY_LOG) instead of the screen.
// node tests/e2e/agent-work-run.mjs <out-dir>  (needs AXE_SELFTEST_COOKIE and the server on :3000)
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const NOTES = "# Trip notes\n\n- Lisbon in May\n"
const trip = mkdtempSync(join(tmpdir(), "axe-trip-"))
writeFileSync(join(trip, "notes.md"), NOTES)
const repo = mkdtempSync(join(tmpdir(), "axe-repo-"))
writeFileSync(join(repo, "README.md"), "# Demo\n")
const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.email=demo@example.com", "-c", "user.name=Demo", ...a], { encoding: "utf8" })
git("init", "-q", "-b", "main")
git("add", ".")
git("commit", "-qm", "start")
const data = mkdtempSync(join(tmpdir(), "axe-real-"))
const notifyLog = join(data, "notifications.jsonl")
// The agent list comes from the ACP registry; fetch it once so a slow CDN can't leave it empty.
// Falls back to curl, which often gets through when Node's fetch times out.
let registry = await fetch("https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json", { signal: AbortSignal.timeout(15_000) })
  .then((r) => r.text())
  .catch(() => {
    try {
      return execFileSync("curl", ["-sf", "-m", "20", "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"], { encoding: "utf8" })
    } catch {
      return ""
    }
  })
if (registry) writeFileSync(join(data, "acp-registry.json"), registry)

const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_BASE_URL: "http://localhost:3000", AXE_SELFTEST: "1", AXE_DATA_DIR: data, AXE_NOTIFY_LOG: notifyLog },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
})
// The engine's own output, to see why if the app goes away.
app.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`))
app.on("close", () => console.log("app closed"))
const pickFolder = (dir) =>
  app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] })
  }, dir)
await pickFolder(trip)
const win = await mainWindow(app)
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (n) => win.screenshot({ path: join(out, `${n}.png`) })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const box = () => win.getByRole("textbox", { name: "Message" })
const notes = () => readFileSync(join(trip, "notes.md"), "utf8")
const results = {}
const check = (name, ok, detail = "") => {
  results[name] = ok
  log(ok ? "PASS" : "FAIL", name, detail)
}
async function until(fn, ms, what) {
  const end = Date.now() + ms
  for (;;) {
    if (await fn().catch(() => false)) return true
    if (Date.now() > end) {
      log("timed out:", what)
      return false
    }
    await win.waitForTimeout(1000)
  }
}
const idle = () => win.getByRole("button", { name: "Send" }).isVisible()

await win.waitForTimeout(2500)
const signIn = win.getByRole("button", { name: /sign in with axe/i })
if (await signIn.isVisible().catch(() => false)) {
  await signIn.click()
  await win.getByRole("heading", { name: /good (morning|afternoon|evening)/i }).waitFor({ timeout: 20_000 })
}
await win.waitForTimeout(1500)
log("signed in")

async function newAgentChat({ folder, mode, copy }) {
  await pickFolder(folder)
  await win.getByRole("button", { name: "New chat" }).first().click()
  await win.getByRole("heading", { name: /good (morning|afternoon|evening)/i }).waitFor()
  const picker = win.getByRole("button", { name: /^(Auto|Claude Code)$/ }).last()
  // The agent list loads from the registry after sign-in: open the picker until Claude Code is in it.
  for (let i = 0; i < 20 && (await picker.textContent())?.trim() !== "Claude Code"; i++) {
    await picker.click()
    const item = win.getByRole("listbox", { name: "Choose who answers" }).getByText("Claude Code", { exact: true })
    if (await item.isVisible({ timeout: 3000 }).catch(() => false)) await item.click()
    else {
      await win.keyboard.press("Escape")
      await win.waitForTimeout(1500)
    }
  }
  if (copy) {
    await win.getByRole("button", { name: "Add files, tools and connectors" }).click()
    await win.getByRole("menuitem", { name: "Work in a copy" }).click()
  }
  await win.getByRole("button", { name: /^Mode: / }).click()
  await win.getByRole("menuitemradio", { name: new RegExp(mode) }).click()
  await win.waitForTimeout(400)
}

// 1. Plan first, then Start
await newAgentChat({ folder: trip, mode: "Plan first" })
await shot("01-new-chat-plan-mode")
await box().fill("Add a line '- Book the 28 tram early' to the end of notes.md. Only that one change.")
await win.keyboard.press("Enter")
log("sent in Plan mode")
const start = win.getByRole("region", { name: "Plan" }).getByRole("button", { name: "Start" })
const planned = await until(() => start.isVisible(), 240_000, "plan card with Start")
await win.waitForTimeout(800)
await shot("02-plan-waiting")
check("plan arrives with Start, nothing changed yet", planned && notes() === NOTES)
await start.click()
log("Start")
const edited = await until(async () => notes().includes("28 tram") && (await idle()), 240_000, "edit after Start")
await win.waitForTimeout(1500)
await shot("03-plan-started-done")
check("Start lets it work: the file changed", edited, JSON.stringify(notes()))
check("mode after Start is Accept edits", await win.getByRole("button", { name: "Mode: Accept edits" }).isVisible())

// 2. Review changes, then Undo
await win.getByRole("button", { name: /^Review changes: 1 file/ }).click()
const panel = win.getByRole("complementary", { name: "Changes" })
await panel.getByText("notes.md").first().waitFor({ timeout: 10_000 })
await win.waitForTimeout(800)
await shot("04-review-changes")
await panel.getByRole("button", { name: "Undo this file" }).click()
const undone = await until(async () => notes() === NOTES, 10_000, "undo")
await win.waitForTimeout(800)
await shot("05-undone")
check("Undo restores the file from the snapshot", undone, JSON.stringify(notes()))
await win.getByRole("button", { name: "Close changes" }).click()

// 3. Rewind
await box().fill("Add a line '- Pastéis in Belém' to the end of notes.md. Only that one change.")
await win.keyboard.press("Enter")
log("second message (Accept edits)")
const second = await until(async () => notes().includes("Belém") && (await idle()), 240_000, "second edit")
await win.waitForTimeout(1500)
await shot("06-second-edit")
check("Accept edits writes without asking", second && !(await win.getByRole("region", { name: "Allow this?" }).isVisible()))
await win.getByText("Add a line '- Pastéis in Belém'", { exact: false }).last().hover()
await win.getByRole("button", { name: "Rewind to here" }).last().click()
await win.getByRole("region", { name: "Rewind" }).waitFor()
await win.waitForTimeout(800)
await shot("07-rewind-ask")
await win.getByRole("button", { name: "Rewind chat and files" }).click()
const rewound = await until(async () => notes() === NOTES, 10_000, "rewind files")
await win.waitForTimeout(1000)
await shot("08-rewound")
const back = await box().inputValue()
check("Rewind puts the file back and drops the turn", rewound && back.includes("Pastéis"), JSON.stringify(notes()))

// The chat carries on after the rewind (a fresh session with the earlier turns as context).
// A new reply (one more block of Markdown) that names the file.
const replies = () => win.locator(".md").count()
const before = await replies()
await box().fill("In one short sentence: which file did we work on in this chat?")
await win.keyboard.press("Enter")
await win.getByRole("button", { name: "Stop" }).waitFor({ timeout: 10_000 }).catch(() => {})
const carried = await until(
  async () => (await idle()) && (await replies()) > before && /notes\.md/.test(await win.locator(".md").last().innerText()),
  180_000,
  "reply after rewind",
)
await win.waitForTimeout(1000)
await shot("09-after-rewind")
check("the chat carries on after a rewind", carried)

// 4. Two agents at once, each in its own worktree
await newAgentChat({ folder: repo, mode: "Full access", copy: true })
await box().fill("Create a file one.txt containing the single word one. Nothing else.")
await win.keyboard.press("Enter")
await win.waitForTimeout(1500)
await newAgentChat({ folder: repo, mode: "Full access", copy: true })
await box().fill("Create a file two.txt containing the single word two. Nothing else.")
await win.keyboard.press("Enter")
const working = win.getByRole("navigation", { name: "Chats" }).getByRole("region", { name: "Working now" })
const both = await until(async () => (await working.locator('[title="Working"]').count()) >= 2, 30_000, "both working")
await shot("10-two-working")
check("two agents work at the same time", both)
const copies = join(data, "copies")
const done = await until(
  () =>
    Promise.resolve(
      existsSync(copies) &&
        readdirSync(copies).some((d) => existsSync(join(copies, d, "one.txt"))) &&
        readdirSync(copies).some((d) => existsSync(join(copies, d, "two.txt"))),
    ),
  240_000,
  "both files",
)
await until(async () => (await working.locator('[title="Working"]').count()) === 0, 120_000, "both finished")
await win.waitForTimeout(1500)
await shot("11-two-done")
const dirs = existsSync(copies) ? readdirSync(copies) : []
check(
  "each worked in its own worktree, the repo untouched",
  done && dirs.length === 2 && !existsSync(join(repo, "one.txt")) && !existsSync(join(repo, "two.txt")),
  `${dirs.join(", ")} | worktrees: ${git("worktree", "list").trim().split("\n").length}`,
)

// 5. Notifications (logged, since the self-test window never has focus)
const notices = existsSync(notifyLog) ? readFileSync(notifyLog, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []
log("notifications:", notices.map((n) => `${n.kind}: ${n.body}`).join(" | "))
check("a notification for the plan and for each finish", notices.some((n) => n.kind === "permission") && notices.filter((n) => n.kind === "done").length >= 4)

writeFileSync(join(out, "results.json"), JSON.stringify({ results, notices, trip, repo, data }, null, 2))
await app.close()
const failed = Object.entries(results).filter(([, ok]) => !ok)
log(failed.length ? `FAILED: ${failed.map(([n]) => n).join("; ")}` : "all passed")
process.exit(failed.length ? 1 : 0)
