import { expect, test, type Page } from "@playwright/test"

// Watching, free text, custom watches and editing: one picture per screen of the design book
// (c-free-confirm, c-free-unclear, c-free-notarget, c-free-unreachable, w-custom, w-site-paused, e-menu,
// e-edit, e-delete, e-row-menu), in Paper and dark, served by the mock engine
// (src/renderer/src/lib/mock-watching.ts). Update on purpose: pnpm exec playwright test watching-edit --update-snapshots

const NOW = new Date("2026-10-31T14:45:00Z")

/** A watch's row on the dashboard (its main button). */
const row = (page: Page, id: string) => page.getByTestId(`row-${id}`).getByRole("button").first()

async function open(page: Page, theme: "dark" | "light", mock: string) {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}&mock=${mock}`)
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole("button", { name: /^Watching/ }).first().click()
  // The page fades in; the new chat's box stays in the page until it's gone.
  await page.getByPlaceholder(/^(Say what to watch|Watch something else)$/).waitFor()
  await page.waitForTimeout(400)
}

async function settle(page: Page) {
  await page.mouse.move(1420, 880)
  await page.waitForTimeout(300)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 5000 })
  await page.waitForTimeout(150)
}

const say = async (page: Page, text: string) => {
  const box = page.getByRole("textbox").last()
  await box.fill(text)
  await box.press("Enter")
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`watching edit ${theme}`, () => {
    test("c-free-confirm: a free sentence becomes a custom plan with Runs on", async ({ page }) => {
      await open(page, theme, "nowatches")
      await say(page, "Tell me when a seat opens in the Saturday glaze workshop at claycollective.org/workshops.")
      await expect(page.getByRole("button", { name: "Start watching" })).toBeVisible()
      await expect(page.getByText("I’ll read claycollective.org/workshops every hour and tell you when the Saturday glaze workshop has a seat. It’s full now.")).toBeVisible()
      await expect(page.getByRole("button", { name: "Runs on" })).toBeVisible()
      await expect(page.getByText("New watch").first()).toBeVisible()
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-c-free-confirm.png`)
    })

    test("c-free-unclear: the starters, never a guessed kind", async ({ page }) => {
      await open(page, theme, "nowatches")
      await say(page, "keep an eye on things for me")
      await expect(page.getByText("What should I watch?")).toBeVisible()
      await expect(page.getByTestId("watch-read").getByRole("group", { name: "Starters" })).toBeVisible()
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-c-free-unclear.png`)
      // A starter there puts its chip in the box, as on the page.
      await page.getByTestId("watch-read").getByRole("button", { name: "Page changes" }).click()
      await expect(page.getByPlaceholder("Page link, like lane-ceramics.com/pricing")).toBeVisible()
    })

    test("c-free-notarget: which site, with the chip in the box", async ({ page }) => {
      await open(page, theme, "nowatches")
      await say(page, "Tell me if my site goes down.")
      await expect(page.getByText("Which site?")).toBeVisible()
      await expect(page.getByPlaceholder("Site address, like lane-ceramics.com")).toBeFocused()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-c-free-notarget.png`)
      await say(page, "lane-ceramics.com")
      await expect(page.getByRole("button", { name: "Start watching" })).toBeVisible()
      await expect(page.getByRole("main").getByText("Tell me if my site goes down.")).toBeVisible()
    })

    test("c-free-unreachable: the close match, and the box keeps the target", async ({ page }) => {
      await open(page, theme, "nowatches")
      await say(page, "Tell me when lane-ceramics.co/pricing changes.")
      await expect(page.getByText("I couldn’t reach lane-ceramics.co. That domain doesn’t exist.")).toBeVisible()
      await expect(page.getByRole("textbox").last()).toHaveValue("lane-ceramics.co/pricing")
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-c-free-unreachable.png`)
      await page.getByRole("button", { name: "Use lane-ceramics.com/pricing" }).click()
      await expect(page.getByRole("button", { name: "Start watching" })).toBeVisible()
    })

    test("w-custom: news with the quote", async ({ page }) => {
      await open(page, theme, "watchcustom")
      await row(page, "w-custom").click()
      await expect(page.getByTestId("custom-quote")).toHaveText("“Sat 7 Nov, Glazing for stoneware, 10:00 to 13:00. 2 places left.”")
      await expect(page.getByText("Full since Oct 29")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-custom.png`)
    })

    test("e-menu, e-edit, w-site-paused", async ({ page }) => {
      await open(page, theme, "")
      await row(page, "w-site").click()
      await expect(page.getByTestId("watch-strip")).toBeVisible()
      await page.locator('header button[aria-haspopup="menu"]').first().click()
      await page.getByRole("menuitem", { name: /^Edit/ }).hover()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-e-menu.png`)
      await page.getByRole("menuitem", { name: /^Edit/ }).click()
      await expect(page.getByRole("dialog", { name: "Edit" })).toBeVisible()
      await expect(page.getByRole("menu")).toHaveCount(0)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-e-edit.png`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog", { name: "Edit" })).toHaveCount(0)
      await page.locator('header button[aria-haspopup="menu"]').first().click()
      await page.getByRole("menuitem", { name: "Pause" }).click()
      await expect(page.getByText("This watch is paused.")).toBeVisible()
      await expect(page.getByText("Paused at 2:45 pm.")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-site-paused.png`)
      await page.getByRole("button", { name: "Resume" }).click()
      await expect(page.getByText("Resumed. Checking now.")).toBeVisible()
    })

    test("e-delete: one confirm, then back to Watching", async ({ page }) => {
      await open(page, theme, "")
      await row(page, "w-site").click()
      await page.locator('header button[aria-haspopup="menu"]').first().click()
      await page.getByRole("menuitem", { name: "Delete" }).click()
      await expect(page.getByRole("alertdialog", { name: "Delete lane-ceramics.com?" })).toBeVisible()
      await expect(page.getByRole("alertdialog").getByRole("button", { name: "Delete" })).toBeFocused()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-e-delete.png`)
      await page.keyboard.press("Enter")
      await expect(row(page, "w-site")).toHaveCount(0)
      await expect(page.getByText("Watching", { exact: true }).first()).toBeVisible()
    })

    test("e-row-menu: the row's ⋯ and right-click", async ({ page }) => {
      await open(page, theme, "")
      const r = row(page, "w-page")
      await r.hover()
      await page.getByRole("button", { name: "More for lane-ceramics.com/pricing" }).click()
      await page.getByRole("menuitem", { name: "Pause" }).hover()
      await page.waitForTimeout(300)
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 5000 })
      await expect(page).toHaveScreenshot(`${theme}-e-row-menu.png`)
      await page.getByRole("menuitem", { name: "Pause" }).click()
      await expect(r).toContainText("Paused since 2:45 pm")
      await r.click({ button: "right" })
      await expect(page.getByRole("menuitem", { name: "Resume" })).toBeVisible()
    })
  })
}
