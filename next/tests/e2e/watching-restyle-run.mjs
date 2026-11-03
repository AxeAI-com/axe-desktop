// New chat and an empty Watching in the real app, light and dark: the same start page (heading, cards,
// the composer docked at the bottom). node tests/e2e/watching-restyle-run.mjs <out-dir>  (after `pnpm run build`)
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = resolve(process.argv[2] ?? "test-results/watching-restyle")
mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), "axe-restyle-"))
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_DATA_DIR: join(tmp, "data"), AXE_BASE_URL: "http://localhost:1" },
})
const win = await mainWindow(app)
win.setDefaultTimeout(30_000)
await win.setViewportSize({ width: 1440, height: 900 })
const fail = (m) => {
  throw new Error(m)
}
try {
  await win.waitForTimeout(2500)
  for (const theme of ["light", "dark"]) {
    await win.evaluate((t) => window.axe.invoke("settings:set", { theme: t }), theme)
    await win.reload()
    await win.waitForTimeout(2000)
    await win.keyboard.press("Escape").catch(() => {})

    const hello = await win.getByRole("heading", { level: 1 }).first().innerText()
    if (/^Good (morning|afternoon|evening)$/.test(hello)) fail(`New chat still says ${hello}`)
    await win.waitForTimeout(500)
    await win.screenshot({ path: join(out, `new-chat-${theme}.png`) })
    console.log(`ok: New chat (${theme}) says "${hello}"`)

    await win.getByRole("button", { name: /^Watching/ }).first().click()
    await win.getByRole("heading", { name: "What should Axe watch?" }).waitFor()
    const cards = await win.getByTestId("catalogue").getByRole("button", { name: /^Add / }).count()
    if (cards !== 35) fail(`${cards} catalogue cards`)
    // The composer sits at the bottom, like a chat.
    const box = await win.getByPlaceholder("Say what to watch").boundingBox()
    if (!box || box.y < 700) fail(`the composer is at y=${box?.y}`)
    await win.waitForTimeout(500)
    await win.screenshot({ path: join(out, `watching-${theme}.png`) })
    console.log(`ok: Watching (${theme}): 35 cards, composer docked at y=${Math.round(box.y)}`)

    // A card puts its kind in the composer.
    await win.getByTestId("catalogue").getByRole("button", { name: "Add Uptime and speed" }).click()
    await win.getByPlaceholder("Site address, like lane-ceramics.com").waitFor()
    await win.keyboard.press("Escape")
    console.log(`ok: Uptime puts its kind in the composer`)
    await win.getByRole("button", { name: "New chat" }).first().click()
  }
} catch (e) {
  await win.screenshot({ path: join(out, "fail.png") }).catch(() => {})
  throw e
} finally {
  await app.close()
}
