import { expect, test, type Page } from "@playwright/test"

// Model and effort for CLI agents (?agentoptions: Claude Code and Codex have sent their lists, with
// their own names). Light and dark, 1440×900. Re-save on purpose with:
// pnpm exec playwright test agent-options --update-snapshots=all

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light") {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}&mock=agentwork&agentoptions`)
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

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test("model and effort for a new Claude Code chat", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("button", { name: "Auto", exact: true }).click()
      await page.getByRole("listbox", { name: "Choose who answers" }).getByText("Claude Code", { exact: true }).click()
      await page.getByRole("button", { name: "Model and effort: Default" }).click()
      const menu = page.getByRole("menu", { name: "Model and effort" })
      await expect(menu.getByRole("menuitemradio", { name: "Default (recommended)" })).toHaveAttribute("aria-checked", "true")
      await expect(menu.getByText("Effort", { exact: true })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-options-menu.png`)

      // A model keeps the menu open for the effort; the effort closes it.
      await menu.getByRole("menuitemradio", { name: "Haiku 5.5" }).click()
      await expect(menu.getByRole("menuitemradio", { name: "Haiku 5.5" })).toHaveAttribute("aria-checked", "true")
      await menu.getByRole("menuitemradio", { name: "Low" }).click()
      await expect(menu).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Model and effort: Haiku 5.5, Low effort" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-options-picked.png`)
    })
  })
}

test("Codex shows its own list, and Axe models show none", async ({ page }) => {
  await open(page, "light")
  await page.getByRole("button", { name: "Auto", exact: true }).click()
  await page.getByRole("listbox", { name: "Choose who answers" }).getByText("Codex", { exact: true }).click()
  await page.getByRole("button", { name: "Model and effort: 5.6 Luna, Medium effort" }).click()
  await expect(page.getByRole("menu", { name: "Model and effort" }).getByText("Reasoning effort")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Codex", exact: true }).click()
  await page.getByRole("listbox", { name: "Choose who answers" }).getByText("Auto", { exact: true }).first().click()
  await expect(page.getByRole("button", { name: /^Model and effort/ })).toHaveCount(0)
})
