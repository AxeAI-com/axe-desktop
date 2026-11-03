// The Watching dashboard in the real app, on real targets: ten watches like an owner's (axeai.com health,
// links, update feed, SEO, DNS, expiry, six status pages, tests, packages, disk), each created through
// watching:draft and watching:create and run for real, some twice more so the strips have history. Then
// light and dark, wide and narrow, the pencil into a watch's chat, Esc back, a section collapsed across a
// reload, and the menu bar panel's Watching rows. Hidden self-test with its own data folder.
// node tests/e2e/watching-dashboard-run.mjs [out-dir]  (after `pnpm run build`)
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/watching-dashboard")
mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), "axe-dash-"))
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_DATA_DIR: join(tmp, "data"), AXE_BASE_URL: "http://localhost:1" },
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
await win.waitForTimeout(2500)

const invoke = (cmd, ...args) => win.evaluate(([c, a]) => window.axe.invoke(c, ...a), [cmd, args])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fail = (m) => {
  throw new Error(m)
}

async function settle(id, timeout = 180_000) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await invoke("watching:get", id)
    if (v?.latest && !v.steps && !v.checking) return v
    if (Date.now() > end) throw new Error(`${v?.name}: the run never ended`)
    await sleep(1000)
  }
}

const here = resolve(".")
const watches = [
  { kind: "health", target: "axeai.com/api/health", again: 5 },
  { kind: "links", target: "axeai.com" },
  { kind: "feed", target: "axeai.com/downloads/desktop", again: 1 },
  { kind: "seo", target: "axeai.com", again: 1 },
  { kind: "dns", target: "axeai.com", again: 3 },
  { kind: "expiry", target: "axeai.com", again: 2 },
  { kind: "status", target: "openrouter, groq, cloudflare, infura, posthog, github", again: 2 },
  // A short, real test command: the whole axe-web suite takes minutes and needs its database.
  { kind: "tests", target: here, command: "npx vitest run tests/unit/watching-summary.test.ts", again: 1 },
  { kind: "outdated", target: here },
  { kind: "disk", target: "20 GB", again: 3 },
]

try {
  const ids = []
  for (const { again = 0, ...input } of watches) {
    const t = Date.now()
    const dr = await invoke("watching:draft", input)
    if ("error" in dr) fail(`${input.kind}: ${dr.error}`)
    const w = await invoke("watching:create", dr)
    let v = await settle(w.id)
    for (let i = 0; i < again; i++) {
      await invoke("watching:checkNow", w.id)
      v = await settle(w.id)
    }
    ids.push(w.id)
    console.log(`ok: ${v.name} (${input.kind}), ${v.strip.length} runs, ${v.latest.status}: ${v.line} (${Math.round((Date.now() - t) / 1000)} s)`)
  }

  for (const theme of ["dark", "light"]) {
    await invoke("settings:set", { theme })
    await win.reload()
    await win.waitForTimeout(2000)
    await win.keyboard.press("Escape").catch(() => {})
    for (const [w, h, name] of [
      [1440, 1800, "wide"],
      [1180, 2300, "narrow"],
    ]) {
      await win.setViewportSize({ width: w, height: h })
      await win.getByRole("button", { name: /^Watching/ }).first().click()
      await win.getByTestId("dashboard").waitFor()
      await win.waitForTimeout(1500)
      const status = await win.getByTestId("dash-status").innerText()
      const metrics = await win.locator('[data-testid^="metric-"]').allInnerTexts()
      await win.mouse.move(w - 4, h - 4)
      await win.screenshot({ path: join(out, `dash-${theme}-${name}.png`) })
      console.log(`ok: ${theme} ${name}: ${status.replace(/\s+/g, " ")} | metrics: ${metrics.map((m) => m.replace(/\s+/g, " ")).join(" / ")}`)
    }
    await win.setViewportSize({ width: 1440, height: 900 })
  }

  // Every watch is a chat: the pencil opens it, Esc folds it back, so does the back button.
  await win.getByTestId(`row-${ids[4]}`).getByRole("button", { name: /^Open / }).click()
  await win.getByTestId("watch-strip").waitFor()
  await win.screenshot({ path: join(out, "watch-opened.png") })
  await win.keyboard.press("Escape")
  await win.getByTestId("dashboard").waitFor()
  await win.getByTestId(`row-${ids[0]}`).getByRole("button").first().click()
  await win.getByRole("button", { name: "Back to Watching" }).click()
  await win.getByTestId("dashboard").waitFor()
  console.log("ok: pencil opens the watch's chat; Esc and Back fold it into the dashboard")

  // A section folds and stays folded after a reload.
  await win.getByTestId("group-domain").getByRole("button", { name: /^Domain/ }).click()
  await win.waitForTimeout(800)
  await win.reload()
  await win.waitForTimeout(2000)
  await win.getByRole("button", { name: /^Watching/ }).first().click()
  await win.getByTestId("dashboard").waitFor()
  if (await win.getByTestId(`row-${ids[4]}`).count()) fail("Domain didn't stay folded")
  console.log(`ok: Domain stays folded: ${(await win.getByTestId("group-domain").innerText()).replace(/\s+/g, " ")}`)
  await win.getByTestId("group-domain").getByRole("button", { name: /^Domain/ }).click()

  // The menu bar panel still lists every watch.
  const tray = await app.evaluate(() => globalThis.__axeShowTray?.())
  await sleep(1500)
  const panel = app.windows().find((p) => p.url().includes("#tray"))
  if (panel) {
    const text = await panel.locator("body").innerText()
    const shown = ids.length - (await Promise.all(ids.map((id) => invoke("watching:get", id)))).filter((v) => !text.includes(v.name)).length
    await panel.screenshot({ path: join(out, "tray.png") })
    console.log(`ok: the menu bar panel lists ${shown} of ${ids.length} watches`)
  } else console.log(`skip: no tray panel window (${tray})`)
} catch (e) {
  await win.screenshot({ path: join(out, "fail.png") }).catch(() => {})
  throw e
} finally {
  await app.close()
}
