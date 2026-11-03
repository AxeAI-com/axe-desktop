import { expect, test, type Page } from "@playwright/test"

// The agent work view on the mock engine (?mock=agentwork): permission modes, plan first, review
// changes, several agents at once (Working now), and a new chat in its own copy.
// Light and dark, 1440×900. Re-save on purpose with: pnpm exec playwright test agent-work --update-snapshots=all

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light") {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}&mock=agentwork`)
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

const nav = (page: Page) => page.getByRole("navigation", { name: "Chats" })
const chat = (page: Page, title: string) => nav(page).getByText(title, { exact: true })

for (const theme of ["dark"] as const) {
  test.describe(theme, () => {
    test("work marks in the sidebar", async ({ page }) => {
      await open(page, theme)
      // Each chat row carries its own mark since 2026-10-24; no separate "Working now" block.
      const row = (title: string) => nav(page).getByRole("button").filter({ hasText: title })
      await expect(row("Make uploads resumable").getByRole("img", { name: "Needs you" })).toBeVisible()
      await expect(row("Fix the flaky upload test").getByRole("img", { name: "Working" })).toBeVisible()
      await expect(row("Tidy the docs folder").getByRole("img", { name: "Done" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-working-now.png`)
    })

    test("plan first: waiting for Start, the whole plan, then the live to-do list", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Make uploads resumable").click()
      const plan = page.getByRole("region", { name: "Plan" })
      await expect(plan.getByRole("button", { name: "Start" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Mode: Plan first" })).toBeVisible()
      await expect(page.getByPlaceholder("Say what to change in the plan")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-plan.png`)

      await plan.getByRole("button", { name: "Show the whole plan" }).click()
      await expect(plan.getByRole("heading", { name: "Why not retry the test" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-plan-whole.png`)
      await plan.getByRole("button", { name: "Show the steps" }).click()

      await plan.getByRole("button", { name: "Start" }).click()
      await expect(page.getByRole("button", { name: "Mode: Accept edits" })).toBeVisible()
      await expect(plan.getByText("4/4")).toBeVisible({ timeout: 8000 })
      await expect(plan.getByRole("button", { name: "Start" })).toHaveCount(0)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-plan-started.png`)
    })

    test("permission modes", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Fix the daily upload count").click()
      await page.getByRole("button", { name: "Mode: Accept edits" }).click()
      const menu = page.getByRole("menu", { name: "How much it may do" })
      await expect(menu.getByRole("menuitemradio", { name: /Accept edits/ })).toHaveAttribute("aria-checked", "true")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-modes.png`)

      await menu.getByRole("menuitemradio", { name: /Full access/ }).click()
      await expect(page.getByRole("button", { name: "Mode: Full access" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-full-access.png`)
    })

    test("review changes", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Fix the daily upload count").click()
      await page.getByRole("button", { name: "Review changes: 4 files" }).click()
      const panel = page.getByRole("complementary", { name: "Changes" })
      // Its width springs open from script, which settle() can't see: wait for the full width.
      await expect.poll(() => panel.evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(440)
      await panel.getByRole("button", { name: /test\/upload\.test\.ts/ }).click()
      await expect(panel.getByText("const count = await waitFor(() => dailyCount(),")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-changes.png`)

      await panel.getByRole("button", { name: /big\.bin/ }).click()
      await expect(panel.getByText("This file isn't text")).toBeVisible()
      await panel.getByRole("listitem").filter({ hasText: "big.bin" }).getByRole("button", { name: "Undo this file" }).click()
      await expect(panel.getByRole("button", { name: /big\.bin/ })).toHaveCount(0)
      await expect(panel.getByText("3 files", { exact: true })).toBeVisible()
      await panel.getByRole("button", { name: "Keep all" }).click()
      await expect(panel.getByText("Nothing changed yet")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-changes-empty.png`)
    })

    test("a new agent chat in its own copy, in Plan mode", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("button", { name: "Auto", exact: true }).click()
      await page.getByRole("listbox", { name: "Choose who answers" }).getByText("Claude Code", { exact: true }).click()
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await page.getByRole("menuitem", { name: "Work in a copy" }).click()
      await page.getByRole("button", { name: "Mode: Ask before changes" }).click()
      await page.getByRole("menuitemradio", { name: /Plan first/ }).click()
      await expect(page.getByRole("button", { name: "Mode: Plan first" })).toBeVisible()
      await expect(page.getByText("worktree", { exact: true })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-new-copy.png`)
    })
  })
}
