import { expect, test, type Page } from "@playwright/test"

// Available elements (design "Watching redesign", Elements board): the catalogue on the empty page and under
// the dashboard, Add starting each kind's chat, and one dashboard card per element, light and dark, on the mock
// engine (?mock=nowatches, ?mock=watchelements). Update on purpose: pnpm exec playwright test watching-elements --update-snapshots

const NOW = new Date("2026-11-02T14:45:00Z")

async function open(page: Page, theme: "dark" | "light", mock: string) {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}&mock=${mock}`)
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole("button", { name: /^Watching/ }).first().click()
}

async function settle(page: Page, top = true) {
  if (top) await page.evaluate(() => document.querySelectorAll(".scroll").forEach((el) => el.scrollTo(0, 0)))
  await page.mouse.move(1420, 10)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(300)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 5000 })
  await page.waitForTimeout(150)
}

const add = (page: Page, label: string) => page.getByTestId("catalogue").getByRole("button", { name: `Add ${label}` })

for (const theme of ["light", "dark"] as const) {
  test.describe(`available elements ${theme}`, () => {
    test("el-catalogue: This Mac 11, Web 8, the older kinds after", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 2400 })
      await open(page, theme, "nowatches")
      await expect(page.getByRole("heading", { name: "This Mac" })).toBeVisible()
      await expect(page.locator("#el-mac + span")).toHaveText("11")
      await expect(page.locator("#el-web + span")).toHaveText("8")
      await expect(page.getByTestId("catalogue").getByRole("button", { name: /^Add / })).toHaveCount(35)
      await expect(page.getByTestId("catalogue").getByText("Recommended")).toHaveCount(7)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-el-catalogue.png`, { fullPage: true })
    })

    test("el-add: a kind that needs nothing goes straight to its plan", async ({ page }) => {
      await open(page, theme, "nowatches")
      await add(page, "Memory pressure").click()
      await expect(page.getByText("Tell me when memory pressure turns red.")).toBeVisible()
      await expect(page.getByRole("button", { name: "Start watching" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-el-add-memory.png`)
      await page.getByRole("button", { name: "Start watching" }).click()
      await expect(page.getByText("Green, 36% used").first()).toBeVisible()
    })

    test("el-ask: Dev servers lists what's listening, Crypto wallets asks for addresses", async ({ page }) => {
      await open(page, theme, "nowatches")
      await add(page, "Dev servers").click()
      await expect(page.getByText("Which ports? Listening now: 3000 (node), 4870 (node), 5173 (node), 5432 (postgres).")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-el-ask-ports.png`)
      const box = page.getByRole("textbox").last()
      await box.fill("3000, 5173")
      await box.press("Enter")
      await expect(page.getByText("Tell me when :3000 and :5173 stop listening.")).toBeVisible()
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: /^Watching/ }).first().click()
      await add(page, "Crypto wallets").click()
      await expect(page.getByPlaceholder("Wallet addresses, like 0x… or a Solana address")).toBeVisible()
      await add(page, "Competitor pages").click()
      await expect(page.getByPlaceholder("Competitor page, like rival-shop.com/pricing")).toBeVisible()
    })

    test("el-dash: every element as a card in its group", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 2000 })
      await open(page, theme, "watchelements")
      await expect(page.getByTestId("group-mac").getByTestId(/^row-e-/)).toHaveCount(11)
      await expect(page.getByTestId("group-web").getByTestId(/^row-e-/)).toHaveCount(4)
      await expect(page.getByTestId("group-site")).toContainText("LCP 1.4 s")
      await expect(page.getByTestId("group-domain")).toContainText("0 of 11 blacklists")
      await expect(page.getByTestId("dash-status")).toContainText("16 of 18 healthy, 2 need a look")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-el-dash.png`)
    })

    test("el-dash-catalogue: the catalogue under the dashboard", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await open(page, theme, "watchelements")
      await settle(page)
      await page.getByRole("heading", { name: "Available elements" }).evaluate((el) => el.scrollIntoView({ block: "start" }))
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${theme}-el-dash-catalogue.png`)
    })
  })
}
