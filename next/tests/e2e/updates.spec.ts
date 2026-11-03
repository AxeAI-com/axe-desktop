import { expect, test, type Page } from "@playwright/test"

// Updates (package H): every state, light and dark, on the mock engine (src/renderer/src/lib/mock-updates.ts).
// Same clock and settling as the other specs. Nothing here reaches axeai.com.

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light", query = "") {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}${query ? `&${query}` : ""}`)
  await page.evaluate(() => document.fonts.ready)
}

async function settle(page: Page) {
  await page.mouse.move(1420, 880)
  await page.waitForTimeout(300)
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    undefined,
    { timeout: 5000 },
  )
  await page.waitForTimeout(150)
}

const side = (page: Page) => page.getByRole("navigation", { name: "Chats" })
const settings = async (page: Page) => {
  await page.getByRole("button", { name: "Account", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
}

for (const theme of ["dark"] as const) {
  test.describe(theme, () => {
    test("restart to update", async ({ page }) => {
      await open(page, theme, "update=ready")
      await expect(side(page).getByRole("button", { name: "Restart to update" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-update-ready.png`)
      await settings(page)
      await expect(page.getByText("Version 0.2.0 is ready. Restart to update.")).toBeVisible()
      await page.locator("#settings-updates").scrollIntoViewIfNeeded()
      await settle(page)
      await expect(page.locator("#settings-updates")).toHaveScreenshot(`${theme}-update-settings.png`)
    })

    for (const [state, text] of [
      ["", "Up to date. Checked 3 minutes ago."],
      ["downloading", "Downloading 0.2.0, 42%"],
      ["error", "Couldn't reach axeai.com to check for updates."],
    ] as const)
      test(`update ${state || "idle"} in settings`, async ({ page }) => {
        await open(page, theme, state ? `update=${state}` : "")
        await settings(page)
        await expect(page.getByText(text)).toBeVisible()
        await expect(side(page).getByRole("button", { name: "Restart to update" })).toHaveCount(0)
        await page.locator("#settings-updates").scrollIntoViewIfNeeded()
        await settle(page)
        await expect(page.locator("#settings-updates")).toHaveScreenshot(`${theme}-update-${state || "idle"}.png`)
      })
  })
}
