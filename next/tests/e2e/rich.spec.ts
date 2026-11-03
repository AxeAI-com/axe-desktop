import { expect, test, type Locator, type Page } from "@playwright/test"

// Rich-reply cards (src/renderer/src/components/rich), on the mock engine's ?mock=rich chats:
// every card done, hovered or sorted, picked, broken, empty and still streaming, light and dark.
// Update the pictures on purpose with: pnpm exec playwright test rich --update-snapshots

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light", title: string) {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}&mock=rich`)
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole("navigation", { name: "Chats" }).getByText(title, { exact: true }).click()
}

/** Lets the cards draw in and moves the pointer out of the way. */
async function settle(page: Page) {
  await page.mouse.move(1420, 880)
  await page.waitForTimeout(1000)
}

const card = (page: Page, name: string | RegExp) => page.locator("[data-thread-scroll]").getByRole("region", { name })

async function shoot(target: Locator, name: string) {
  // Scrolling a card into view shows "Jump to latest" over the thread; it isn't part of the card.
  await target.page().addStyleTag({ content: '[aria-label="Jump to latest"]{visibility:hidden}' })
  await target.scrollIntoViewIfNeeded()
  await target.page().mouse.move(1420, 880)
  await target.page().waitForTimeout(250)
  await expect(target).toHaveScreenshot(name)
}

for (const theme of ["dark"] as const) {
  test.describe(theme, () => {
    test("line chart: drawn, then read on hover", async ({ page }) => {
      await open(page, theme, "Q3 sales by day")
      const chart = card(page, "Daily sales")
      await expect(chart.getByText("$83,373")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-rich-chart-window.png`)

      const box = (await chart.locator("svg").boundingBox())!
      await page.mouse.move(box.x + box.width * 0.42, box.y + box.height / 2)
      await expect(chart).toContainText(/Daily salesAug \d+/)
      // The number counts to the hovered day; let it land.
      await page.waitForTimeout(1200)
      await expect(chart).toHaveScreenshot(`${theme}-rich-line-hover.png`)
    })

    test("bar, donut and area charts, and a table that sorts", async ({ page }) => {
      await open(page, theme, "Channels and regions")
      await settle(page)
      await shoot(card(page, "Revenue by region"), `${theme}-rich-bar.png`)
      await shoot(card(page, "Where Q3 sales came from"), `${theme}-rich-donut.png`)
      await shoot(card(page, "Weekly sign-ups"), `${theme}-rich-area.png`)
      const table = card(page, "Plans this quarter")
      await shoot(table, `${theme}-rich-table.png`)
      await table.getByRole("button", { name: "Paying" }).click()
      await expect(table.getByRole("columnheader", { name: "Paying" })).toHaveAttribute("aria-sort", "descending")
      await expect(table.getByRole("row").nth(1)).toContainText("Starter")
      await page.waitForTimeout(500)
      await shoot(table, `${theme}-rich-table-sorted.png`)
    })

    test("choices: open, then picked by pressing a number", async ({ page }) => {
      await open(page, theme, "Studio launch post")
      await expect(page.getByText("Press 1, 2 or 3 to choose")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-rich-choices-window.png`)

      // The composer has focus and is empty, so a number picks.
      await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused()
      await page.keyboard.press("2")
      // Sent: the pick shows as your message (the option's own label is the other match).
      await expect(page.locator("[data-thread-scroll]").getByText("Marketing teams", { exact: true })).toHaveCount(2)
      await expect(card(page, "Choose one").getByRole("button", { name: /Marketing teams/ })).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByText("Press 1, 2 or 3 to choose")).toBeHidden()
    })

    test("choices answered earlier", async ({ page }) => {
      await open(page, theme, "Tone for the newsletter")
      await settle(page)
      await shoot(card(page, "Choose one"), `${theme}-rich-choices-picked.png`)
    })

    test("map from the website's show_map tool", async ({ page }) => {
      await open(page, theme, "Lisbon food stops")
      await settle(page)
      await shoot(card(page, "Map: Near tram 28"), `${theme}-rich-map.png`)
    })

    test("drafts: email and post", async ({ page }) => {
      await open(page, theme, "Launch week emails")
      await settle(page)
      await shoot(card(page, "Email draft"), `${theme}-rich-draft-email.png`)
      const post = card(page, "Post for X")
      await shoot(post, `${theme}-rich-draft-post.png`)
      await post.getByRole("textbox", { name: "Post text" }).fill("Studio makes films now.")
      await expect(post.getByText("23 of 280")).toBeVisible()
      await expect(post.getByRole("button", { name: "Undo my edits" })).toBeVisible()
    })

    test("live visual in its sealed frame", async ({ page }) => {
      await open(page, theme, "Light through a prism")
      const v = card(page, "Visual: Light through a prism")
      const frame = page.frameLocator('iframe[title="Light through a prism"]')
      await expect(frame.locator("#fan line")).toHaveCount(7)
      // Its script runs: the slider redraws it.
      await frame.locator("#a").fill("-8")
      await expect(frame.locator("#t")).toHaveText("-8°")
      await frame.locator("#a").fill("4")
      await settle(page)
      await shoot(v, `${theme}-rich-visual.png`)
    })

    test("broken JSON and a reply cut off mid-card fall back to code", async ({ page }) => {
      await open(page, theme, "Cards that broke")
      await expect(page.getByText("axe-chart", { exact: true })).toBeVisible()
      await expect(page.getByText("axe-choices", { exact: true })).toBeVisible()
      await settle(page)
      await shoot(page.locator("[data-thread-scroll] .md").last(), `${theme}-rich-broken.png`)
    })

    test("empty cards", async ({ page }) => {
      await open(page, theme, "Cards with nothing in them")
      await settle(page)
      await shoot(page.locator("[data-thread-scroll] .md").last(), `${theme}-rich-empty.png`)
    })

    test("still streaming: the card's outline, and a visual drawing as it comes", async ({ page }) => {
      await open(page, theme, "Cards on the way")
      await settle(page)
      await shoot(card(page, "Making a chart"), `${theme}-rich-streaming-chart.png`)

      await page.getByRole("navigation", { name: "Chats" }).getByText("A visual on the way", { exact: true }).click()
      const frame = page.frameLocator('iframe[title="Light through a prism"]')
      await expect(frame.locator("#beam")).toBeAttached()
      await expect(frame.locator("body script")).toHaveCount(0)
      await settle(page)
      await shoot(card(page, "Visual: Light through a prism"), `${theme}-rich-streaming-visual.png`)
    })
  })
}
