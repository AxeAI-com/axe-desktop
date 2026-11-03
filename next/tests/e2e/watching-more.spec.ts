import { expect, test, type Page } from "@playwright/test"

// The ten More kinds on the mock engine: the More menu, draft cards that show what the first check read
// (and say plainly what it couldn't), and watches with a problem. Light and dark. Re-save on purpose with:
// pnpm exec playwright test watching-more --update-snapshots=all

const NOW = new Date("2026-10-31T14:45:00Z")

/** A watch's row on the dashboard (its main button). */
const row = (page: Page, id: string) => page.getByTestId(`row-${id}`).getByRole("button").first()

async function open(page: Page, theme: "dark" | "light", mock: string) {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}&mock=${mock}`)
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole("button", { name: /^Watching/ }).first().click()
}

async function settle(page: Page) {
  await page.mouse.move(1420, 880)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(300)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 5000 })
  await page.waitForTimeout(150)
}

async function pick(page: Page, label: string, target: string) {
  await page.getByTestId("catalogue").getByRole("button", { name: `Add ${label}` }).click()
  const box = page.getByRole("textbox").last()
  await box.fill(target)
  await box.press("Enter")
  await expect(page.getByRole("button", { name: "Start watching" })).toBeVisible()
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`watching more ${theme}`, () => {
    test("the older kinds sit in the catalogue", async ({ page }) => {
      await open(page, theme, "nowatches")
      await expect(page.getByTestId("catalogue").getByRole("button", { name: /^Add / })).toHaveCount(35)
      for (const label of ["Health check", "Update feed", "Disk space"]) await expect(page.getByRole("button", { name: `Add ${label}` })).toBeVisible()
    })

    test("update feed draft lists every file it checked", async ({ page }) => {
      await open(page, theme, "nowatches")
      await pick(page, "Update feed", "lane-ceramics.com/downloads")
      await expect(page.getByTestId("check-rows")).toContainText("Lane-0.8.0-arm64.dmg")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-more-feed-draft.png`)
    })

    test("expiry draft says what it couldn't read", async ({ page }) => {
      await open(page, theme, "nowatches")
      await pick(page, "Certificate and domain expiry", "lane-ceramics.com")
      await expect(page.getByText(/I couldn’t read everything: Domain: not in public RDAP\./)).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-more-expiry-draft.png`)
    })

    test("watches with problems: failing tests and a service outage", async ({ page }) => {
      await open(page, theme, "watchmore")
      await expect(row(page, "w-tests")).toContainText("Tests fail: 2 failed, 118 passed")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-more-list.png`)
      await row(page, "w-tests").click()
      await expect(page.getByTestId("problem-tests:failing")).toContainText("Tests fail in shop-web")
      await expect(page.getByTestId("problem-tests:failing").getByRole("button", { name: /^Fix with/ })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-more-tests-failing.png`)
    })
  })
}

test("a tests folder in Downloads is refused", async ({ page }) => {
  await open(page, "light", "nowatches")
  await page.getByTestId("catalogue").getByRole("button", { name: "Add Tests in a folder" }).click()
  const box = page.getByRole("textbox").last()
  await box.fill("~/Downloads/shop")
  await box.press("Enter")
  await expect(page.getByText("Axe doesn’t run things in Desktop, Documents, Downloads or Library. Pick a project folder.")).toBeVisible()
})
