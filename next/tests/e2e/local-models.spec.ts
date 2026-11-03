import { expect, test, type Page } from "@playwright/test"

// Local models on the mock engine (?mock=local): Ollama stopped and started from Settings, getting a model
// with its progress, a model that uses tools in the composer (Do it and connectors in the + menu), one
// that can only chat, and "Loading model" right after picking one. The app is dark only, like the other specs.

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: string, extra = "") {
  await page.clock.setFixedTime(NOW)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto(`/?theme=${theme}&mock=local${extra}`)
  await page.evaluate(() => document.fonts.ready)
}

async function settle(page: Page) {
  await page.mouse.move(1420, 880)
  await page.waitForTimeout(400)
}

async function settingsModels(page: Page) {
  await page.getByRole("button", { name: "Auto", exact: true }).click()
  await page.getByRole("listbox", { name: "Choose who answers" }).getByText("Add a model server").click()
  const section = page.locator("#settings-models")
  await section.scrollIntoViewIfNeeded()
  return section
}

async function pick(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Auto", exact: true }).click()
  await page.getByRole("listbox", { name: "Choose who answers" }).getByRole("option", { name }).click()
}

for (const theme of ["dark"]) {
  test.describe(theme, () => {
    test("Ollama stopped: Start Ollama, then its models, the start-on-open switch and Get a model", async ({ page }) => {
      await open(page, theme, "&ollama=stopped")
      const section = await settingsModels(page)
      await expect(section.getByText("Not running. Axe starts it when you send to one of its models.")).toBeVisible()
      await settle(page)
      await expect(section).toHaveScreenshot(`ollama-stopped-${theme}.png`)
      await section.getByRole("button", { name: "Start Ollama", exact: true }).click()
      await expect(section.getByText("Qwen3 1.7B, Qwen3 4B")).toBeVisible()
      await expect(section.getByRole("button", { name: "Start Ollama", exact: true })).toHaveCount(0)
      await section.getByRole("switch", { name: "Start Ollama when Axe opens" }).click()
      await expect(section.getByRole("switch", { name: "Start Ollama when Axe opens" })).toHaveAttribute("aria-checked", "true")
      await settle(page)
      await expect(section).toHaveScreenshot(`ollama-running-${theme}.png`)
    })

    test("get a model: progress while it downloads, then it's in the list", async ({ page }) => {
      await open(page, theme, "&pullms=1500")
      const section = await settingsModels(page)
      await section.getByRole("button", { name: "qwen2.5:7b" }).click()
      await expect(section.getByText("qwen2.5:7b: Downloading, 0.8 GB of 4.7 GB")).toBeVisible()
      await settle(page)
      await expect(section).toHaveScreenshot(`ollama-pulling-${theme}.png`)
      await expect(section.getByText("Qwen3 1.7B, Qwen3 4B, QWEN2.5 7B")).toBeVisible({ timeout: 10_000 })
      await expect(section.getByRole("progressbar")).toHaveCount(0)
    })

    test("a local model that uses tools: Do it and connectors in the + menu", async ({ page }) => {
      await open(page, theme)
      await pick(page, /^Qwen3 4B Ollama/)
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await expect(page.getByRole("menuitem", { name: /^Do it/ })).toBeEnabled()
      await expect(page.getByRole("menuitem", { name: /Search the web/ })).toHaveCount(0)
      await settle(page)
      await expect(page).toHaveScreenshot(`local-tools-menu-${theme}.png`)
    })

    test("a local model that can only chat: Do it and connectors greyed, with a plain note", async ({ page }) => {
      await open(page, theme, "&chatonly=1")
      await pick(page, /^Qwen3 4B Ollama/)
      await expect(page.getByText("This model can only chat")).toBeVisible()
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await expect(page.getByRole("menuitem", { name: /^Do it/ })).toBeDisabled()
      await expect(page.getByRole("menuitem", { name: /^Do it/ })).toContainText("Not with this model")
      await settle(page)
      await expect(page).toHaveScreenshot(`local-chat-only-${theme}.png`)
    })

    test("loading a model right after picking it", async ({ page }) => {
      await open(page, theme, "&warmms=60000")
      await pick(page, /^Qwen3 1.7B Ollama/)
      await expect(page.getByRole("status").filter({ hasText: "Loading model" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`local-loading-${theme}.png`)
    })
  })
}
