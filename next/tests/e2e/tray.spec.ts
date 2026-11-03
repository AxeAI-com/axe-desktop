import { expect, test, type Page } from "@playwright/test"

// The menu bar panel (design: "Menu bar panel redesign", native, 630 by 720) on the mock engine, light
// and dark: watches with their state, one opened inline, no watches yet, the last three chats, and a
// chat open in the panel. The clock is fixed so the times stay put.

const NOW = new Date("2026-10-31T14:45:00Z")

async function open(page: Page, theme: "light" | "dark", mock = "") {
  await page.clock.setFixedTime(NOW)
  await page.setViewportSize({ width: 630, height: 720 })
  await page.goto(`/?theme=${theme}&window=tray${mock ? `&mock=${mock}` : ""}`)
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible()
}

async function settle(page: Page) {
  await page.mouse.move(620, 6)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(300)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 5000 })
  await page.waitForTimeout(150)
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`tray ${theme}`, () => {
    test("home: watching, recent chats, the box and the footer", async ({ page }) => {
      await open(page, theme, "watchsec")
      const watching = page.getByRole("region", { name: "Watching" })
      await expect(watching.getByRole("button").first()).toBeVisible()
      const recents = page.getByRole("region", { name: "Recent chats" }).getByRole("button")
      await expect(recents).toHaveCount(3)
      await expect(page.getByRole("button", { name: "Open Axe AI" })).toBeVisible()
      await expect(page.getByRole("button", { name: /Settings…/ })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-tray-home.png`)
    })

    test("a watch opens inline", async ({ page }) => {
      await open(page, theme, "watchsec")
      const row = page.getByRole("region", { name: "Watching" }).getByRole("button", { expanded: false }).first()
      await row.click()
      await expect(page.getByRole("button", { name: "Check now" })).toBeVisible()
      await expect(page.getByRole("img", { name: "Recent checks" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-tray-watch-open.png`)
    })

    test("no watches yet", async ({ page }) => {
      await open(page, theme, "nowatches")
      await expect(page.getByText("No watches yet")).toBeVisible()
      await expect(page.getByRole("button", { name: "Start a watch" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-tray-empty.png`)
    })

    test("a recent chat opens in the panel", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("region", { name: "Recent chats" }).getByRole("button").first().click()
      await expect(page.getByRole("button", { name: "Back" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-tray-chat.png`)
      await page.getByRole("button", { name: "Back" }).click()
      await expect(page.getByRole("region", { name: "Recent chats" })).toBeVisible()
    })
  })
}
