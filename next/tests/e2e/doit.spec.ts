import { expect, test, type Page } from "@playwright/test"

// Do it in the window, on the mock engine (mock=doit): an Axe model working on this computer.
// Its steps, the card before Send, a step you said no to, the composer switch and Full access.

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light", mock = "doit") {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}&mock=${mock}`)
  await page.evaluate(() => document.fonts.ready)
}

async function settle(page: Page) {
  await page.mouse.move(1420, 880)
  await page.waitForTimeout(700)
}

const chat = (page: Page, title: string) => page.getByRole("navigation", { name: "Chats" }).getByText(title, { exact: true })
const card = (page: Page) => page.getByRole("region", { name: "Allow this?" })

for (const theme of ["dark"] as const) {
  test.describe(theme, () => {
    test("do it waits at Send", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Fill the order form").click()
      await expect(card(page)).toBeVisible()
      await expect(card(page).getByText("Click “Send order” on localhost:5203")).toBeVisible()
      await expect(page.getByText("2/3")).toBeVisible()
      await page.getByRole("button", { name: /Waiting for you/ }).click()
      await expect(page.getByText("Fill in “mia@example.com”")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-doit-waiting.png`)
    })

    test("do it finished, with a step you said no to", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Sort my shopping list").click()
      await page.getByRole("button", { name: "Changed 1 file, ran 1 command, 1 step not allowed" }).click()
      // Each step opens on its own to show what it did.
      const rows = page.locator('[data-slot="tool-group"] button[aria-expanded="false"]:not([disabled])').filter({ hasNot: page.locator("h3") })
      // Opening one changes the list, so open the first closed one until none is left.
      while ((await rows.count()) > 0) await rows.first().click()
      await expect(page.getByText("plums\npears\napples")).toBeVisible()
      await expect(page.getByText("Not allowed", { exact: true })).toBeVisible()
      await settle(page)
      await page.evaluate(() => document.querySelector("[data-thread-scroll]")?.scrollTo(0, 0))
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${theme}-doit-finished.png`)
    })

    test("composer: use this computer", async ({ page }) => {
      await open(page, theme, "")
      // On for every chat since 2026-10-24: the + menu shows it ticked, and one click turns it off.
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await expect(page.getByRole("menuitem", { name: /Do it/ })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-doit-menu.png`)
    })

    test("settings: full access", async ({ page }) => {
      await open(page, theme, "")
      await page.getByRole("button", { name: "Account", exact: true }).click()
      await page.getByRole("menuitem", { name: "Settings" }).click()
      // Memory loads after the page opens and moves what's below it; wait, then put Permissions in view.
      await expect(page.getByText("Keep answers short; tables over long lists.")).toBeVisible()
      await page.getByRole("button", { name: "Turn on", exact: true }).click()
      await expect(page.getByRole("button", { name: "Turn on full access" })).toBeVisible()
      await page.getByText("Permissions", { exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }))
      await settle(page)
      // Sections below can still grow as they load; scroll again once everything has settled.
      await page.getByText("Permissions", { exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }))
      await settle(page)
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
      await expect(page).toHaveScreenshot(`${theme}-full-access-confirm.png`)
    })
  })
}

test("a Do it run asks before Send; no keeps the form unsent, yes sends it", async ({ page }) => {
  await open(page, "dark", "")
  await page.getByRole("textbox", { name: "Message" }).fill("Fill the order form for Mia Lane and stop at Send")
  await page.keyboard.press("Enter")
  await expect(card(page)).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: "Don't allow" }).click()
  await expect(card(page)).toHaveCount(0)
  await expect(page.getByText("You said no, so I stopped before pressing Send order.")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("button", { name: /1 step not allowed/ })).toBeVisible()

  await page.getByRole("textbox", { name: "Message" }).fill("Now send it")
  await page.keyboard.press("Enter")
  await expect(card(page)).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(page.getByText("pressed Send order")).toBeVisible({ timeout: 10_000 })
})

test("Full access turns on only after the second click", async ({ page }) => {
  await open(page, "dark", "")
  await page.getByRole("button", { name: "Account", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Turn on", exact: true }).click()
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByText("Off. Axe asks before it sends", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Turn on", exact: true }).click()
  await page.getByRole("button", { name: "Turn on full access" }).click()
  await expect(page.getByText("Your Desktop, Documents, Downloads and Library still ask.", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Turn off" })).toBeVisible()
})

test("Do it shows no chip, permissions or not, and stays on from the + menu", async ({ page }) => {
  await open(page, "dark", "")
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Do it/ })).toHaveCount(0)
  await page.goto("/?theme=dark&access=granted")
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Do it/ })).toHaveCount(0)
  await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
  await expect(page.getByRole("menuitem", { name: /Do it/ })).toBeVisible()
})

test("the composer grows to eight lines with no scrollbar, the placeholder on one line", async ({ page }) => {
  // The menu bar panel has its own one-line box (tests/e2e/tray.spec.ts); a chat open there keeps this one.
  for (const url of ["/?theme=dark"]) {
    await page.goto(url)
    const box = page.getByRole("textbox", { name: "Message" })
    const size = () => box.evaluate((t: HTMLTextAreaElement) => ({ h: t.clientHeight, overflow: getComputedStyle(t).overflowY, bar: getComputedStyle(t).scrollbarWidth }))
    expect(await size()).toEqual({ h: 36, overflow: "hidden", bar: "none" })
    const lines = (n: number) => Array(n).fill("Sam's notes for the Lisbon trip.").join("\n")
    await box.fill(lines(4))
    expect(await size()).toEqual({ h: 101, overflow: "hidden", bar: "none" })
    await box.fill(lines(8))
    expect(await size()).toEqual({ h: 191, overflow: "hidden", bar: "none" })
    await box.fill(lines(20))
    expect(await size()).toEqual({ h: 192, overflow: "auto", bar: "none" })
  }
})
