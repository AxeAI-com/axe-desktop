import { expect, test, type Page } from "@playwright/test"

// Watching, uptime and speed, page changes, price and stock: one picture per screen of the design book (docs/watching/design.html),
// in Paper and dark, served by the mock engine (src/renderer/src/lib/mock-watching.ts). The clock is
// fixed, so every time on the cards stays put. Update on purpose: pnpm exec playwright test watching --update-snapshots

const NOW = new Date("2026-10-31T14:45:00Z")

/** A watch's row on the dashboard (its main button). */
const row = (page: Page, id: string) => page.getByTestId(`row-${id}`).getByRole("button").first()

async function open(page: Page, theme: "dark" | "light", mock: string) {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}&mock=${mock}`)
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole("button", { name: /^Oversight/ }).first().click()
}

async function settle(page: Page) {
  await page.mouse.move(1420, 880)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(300)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 5000 })
  await page.waitForTimeout(150)
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`watching ${theme}`, () => {
    test("page-empty and c-uptime-ask", async ({ page }) => {
      await open(page, theme, "nowatches")
      await expect(page.getByText("What should Axe keep an eye on?")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-page-empty.png`)
      await page.getByTestId("catalogue").getByRole("button", { name: "Add Uptime and speed" }).click()
      await expect(page.getByText("Press Return to check it. Esc to go back.")).toBeVisible()
      await page.waitForTimeout(300)
      await page.mouse.move(1420, 880)
      await expect(page).toHaveScreenshot(`${theme}-c-uptime-ask.png`)
    })

    test("c-uptime-invalid keeps the address", async ({ page }) => {
      await open(page, theme, "nowatches")
      await page.getByTestId("catalogue").getByRole("button", { name: "Add Uptime and speed" }).click()
      const box = page.getByRole("textbox").last()
      await box.fill("lane-ceramcs.com")
      await box.press("Enter")
      await expect(page.getByText("lane-ceramcs.com doesn’t exist. Check the spelling.")).toBeVisible()
      await expect(box).toHaveValue("lane-ceramcs.com")
      await page.mouse.move(1420, 880)
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${theme}-c-uptime-invalid.png`)
    })

    test("c-uptime-confirm", async ({ page }) => {
      await open(page, theme, "nowatches")
      await page.getByTestId("catalogue").getByRole("button", { name: "Add Uptime and speed" }).click()
      const box = page.getByRole("textbox").last()
      await box.fill("lane-ceramics.com")
      await box.press("Enter")
      await expect(page.getByRole("button", { name: "Add check" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-c-uptime-confirm.png`)
    })

    test("w-site-quiet", async ({ page }) => {
      await open(page, theme, "")
      await row(page, "w-site").click()
      await expect(page.getByTestId("watch-strip")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-site-quiet.png`)
    })

    test("page-problem, w-site-problem and its snooze menu", async ({ page }) => {
      await open(page, theme, "watchslow")
      await expect(page.getByRole("button", { name: "Oversight, 1 problem" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-page-problem.png`)
      await row(page, "w-site").click()
      await expect(page.getByTestId("problem-slow")).toBeVisible()
      await expect(page.getByTestId("problem-slow")).toContainText("Six photos added at 2:17 pm are 6 MB each.")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-site-problem.png`)
      await page.getByRole("button", { name: "Snooze" }).click()
      await page.waitForTimeout(400)
      await expect(page).toHaveScreenshot(`${theme}-w-site-snooze.png`)
    })

    test("w-site-activity: incidents, a change and a fix as one line each, newest first", async ({ page }) => {
      await open(page, theme, "watchactivity")
      await row(page, "w-site").click()
      const a = page.getByTestId("activity")
      await expect(a).toBeVisible()
      await expect(a.getByTestId("activity-row")).toHaveText([
        "9:40 amDown for 10 min, 9:40 to 9:50 amResolved",
        "3:15 pmClaude Code fixed it: changed 3 files",
        "2:15 pmSlow for 1 h, 2:15 to 3:15 pmFixed",
        "10:45 amCertificate renewed",
        "12:45 pmDown for 21 min, 12:45 to 1:06 pmResolved",
      ])
      await expect(page.getByTestId("fix-turn")).toHaveCount(0)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-site-activity.png`)
    })

    test("w-site-down", async ({ page }) => {
      await open(page, theme, "watchdown")
      await row(page, "w-book").click()
      await expect(page.getByTestId("problem-down")).toContainText("Down for14 min")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-site-down.png`)
    })

    for (const [kind, label, good, bad, msg] of [
      ["page", "Page changes", "lane-ceramics.com/pricing", "lane-ceramics.com/prices", "That page returns Not found (404)."],
      ["price", "Price and stock", "northclay.com/stoneware-25", "northclay.com/about", "There’s no price on that page that Axe can read."],
    ] as const) {
      test(`c-${kind}-ask, invalid, confirm, running and result`, async ({ page }) => {
        await open(page, theme, "nowatches")
        await page.getByTestId("catalogue").getByRole("button", { name: `Add ${label}` }).click()
        await expect(page.getByText("Press Return to check it. Esc to go back.")).toBeVisible()
        await settle(page)
        await expect(page).toHaveScreenshot(`${theme}-c-${kind}-ask.png`)
        const box = page.getByRole("textbox").last()
        await box.fill(bad)
        await box.press("Enter")
        await expect(page.getByText(msg)).toBeVisible()
        await page.mouse.move(1420, 880)
        await page.waitForTimeout(300)
        await expect(page).toHaveScreenshot(`${theme}-c-${kind}-invalid.png`)
        await box.fill(good)
        await box.press("Enter")
        await expect(page.getByRole("button", { name: "Add check" })).toBeVisible()
        await settle(page)
        await expect(page).toHaveScreenshot(`${theme}-c-${kind}-confirm.png`)
        await page.getByRole("button", { name: "Add check" }).click()
        await expect(page.getByText("Checking now")).toBeVisible()
        await page.mouse.move(1420, 880)
        await expect(page).toHaveScreenshot(`${theme}-c-${kind}-running.png`, { mask: [page.locator('[aria-hidden="true"].animate-spin')] })
        await expect(page.getByText("Checking now")).toBeHidden()
        await settle(page)
        await expect(page).toHaveScreenshot(`${theme}-c-${kind}-result.png`)
      })
    }

    test("Check the page instead switches the kind and keeps the link", async ({ page }) => {
      await open(page, theme, "nowatches")
      await page.getByTestId("catalogue").getByRole("button", { name: "Add Price and stock" }).click()
      const box = page.getByRole("textbox").last()
      await box.fill("northclay.com/about")
      await box.press("Enter")
      await page.getByRole("button", { name: "Check the page instead" }).click()
      await expect(page.getByText("Tell me when northclay.com/about changes.")).toBeVisible()
    })

    test("the starters sit under the list, and the composer is docked", async ({ page }) => {
      await open(page, theme, "")
      await expect(page.getByPlaceholder("Add a check")).toBeVisible()
      await expect(page.getByTestId("catalogue").getByRole("button", { name: /^Add / })).toHaveCount(35)
      await page.getByTestId("catalogue").getByRole("button", { name: "Add Price and stock" }).click()
      await expect(page.getByText("Press Return to check it. Esc to go back.")).toBeVisible()
    })

    test("w-page-quiet", async ({ page }) => {
      await open(page, theme, "")
      await row(page, "w-page").click()
      await expect(page.getByRole("button", { name: "Back to Oversight" })).toBeVisible()
      await expect(page.getByText("No changes since Oct 24").filter({ visible: true })).toHaveCount(1)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-page-quiet.png`)
    })

    test("page-news, w-page-change, ignore and w-page-reply", async ({ page }) => {
      await open(page, theme, "watchpage")
      const r = row(page, "w-page")
      await expect(r).toContainText("New line: “Free shipping on orders over $50.”")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-page-news.png`)
      await r.click()
      await expect(page.getByTestId("news-page")).toContainText("The pricing page changed")
      await expect(page.getByTestId("news-page")).toContainText("New line about shipping, and the old one is gone.")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-page-change.png`)
      await page.getByRole("button", { name: "Ignore changes like this" }).click()
      await expect(page.getByText("Okay. I’ll ignore changes in that part of the page.")).toBeVisible()
      await page.getByRole("button", { name: "Undo" }).click()
      await expect(page.getByText("Undone.")).toBeVisible()
      const box = page.getByRole("textbox").last()
      await box.fill("only check this once a day, and ignore the date at the bottom")
      await box.press("Enter")
      await expect(page.getByText("Done. I’ll check every morning at 7:30 and ignore the date line at the bottom.")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-page-reply.png`)
      // Opened: the row's blue dot is gone.
      await page.getByRole("button", { name: /^Oversight/ }).first().click()
      await expect(r).toContainText("No changes since 10:05 am")
    })

    test("w-price-quiet", async ({ page }) => {
      await open(page, theme, "")
      await row(page, "w-price").click()
      await expect(page.getByText("$48, in stock, since Oct 1")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-price-quiet.png`)
    })

    test("w-price-change", async ({ page }) => {
      await open(page, theme, "watchprice")
      const r = row(page, "w-price")
      await expect(r).toContainText("Down to $42 from $45")
      await r.click()
      const card = page.getByTestId("news-price").last()
      await expect(card).toContainText("Down to $42")
      await expect(card).toContainText("Stoneware clay, 25 lb went from $45 to $42. Still in stock.")
      await expect(card).toContainText("30-day low$42.00")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-price-change.png`)
    })

    test("c-security-ask, invalid, confirm, running and result", async ({ page }) => {
      await open(page, theme, "nowatches")
      await page.getByTestId("catalogue").getByRole("button", { name: "Add Security" }).click()
      await expect(page.getByPlaceholder("Domain, like lane-ceramics.com")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-c-security-ask.png`)
      const box = page.getByRole("textbox").last()
      await box.fill("lane-ceramcs.com")
      await box.press("Enter")
      await expect(page.getByText("lane-ceramcs.com doesn’t exist. Check the spelling.")).toBeVisible()
      await page.mouse.move(1420, 880)
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${theme}-c-security-invalid.png`)
      await box.fill("https://lane-ceramics.com/pricing")
      await box.press("Enter")
      await expect(page.getByText("Every morning I’ll check lane-ceramics.com’s email records, certificate, TLS and headers, and open ports.")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-c-security-confirm.png`)
      await page.getByRole("button", { name: "Add check" }).click()
      await expect(page.getByText("Checking now")).toBeVisible()
      await page.mouse.move(1420, 880)
      await expect(page).toHaveScreenshot(`${theme}-c-security-running.png`, { mask: [page.locator('[aria-hidden="true"].animate-spin')] })
      await expect(page.getByText("One thing to fix. Everything else looks right.")).toBeVisible()
      await expect(page.getByTestId("check-rows")).toContainText("Spoofable")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-c-security-result.png`)
    })

    test("w-sec-quiet", async ({ page }) => {
      await open(page, theme, "")
      await row(page, "w-sec").click()
      await expect(page.getByText("No issues since Oct 24")).toBeVisible()
      await expect(page.getByTestId("check-rows").last()).toContainText("Protected")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-sec-quiet.png`)
    })

    test("w-sec-problem, Copy record (w-sec-fix) and the record unchanged", async ({ page }) => {
      await open(page, theme, "watchsec")
      await row(page, "w-sec").click()
      const card = page.getByTestId("problem-dmarc:none")
      await expect(card).toContainText("Anyone can send email as lane-ceramics.com")
      await expect(card).toContainText("Turn on DKIM with your mail provider. Then change this record:")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-sec-problem.png`)
      await card.getByRole("button", { name: "Copy record" }).click()
      await expect(card).toContainText("Copied. When you’ve changed it, I’ll check again. DNS can take an hour.")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-sec-fix.png`)
      await card.getByRole("button", { name: "Check now" }).click()
      await expect(card).toContainText("The record hasn’t changed yet. I’ll check again in an hour.")
    })

    test("c-repo-ask (the menu), c-repo-invalid and a repo watch, never security", async ({ page }) => {
      await open(page, theme, "nowatches")
      await page.getByTestId("catalogue").getByRole("button", { name: "Add Repo alerts" }).click()
      const menu = page.getByRole("menu", { name: "Repos and folders" })
      await expect(menu).toContainText("Your repos")
      await expect(menu).toContainText("~/Code/lane-theme")
      await expect(page.getByText("Press Return to check it. Esc to go back.")).toBeHidden()
      await page.mouse.move(1420, 880)
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${theme}-c-repo-ask.png`)
      const box = page.getByRole("textbox").last()
      await box.fill("mia/shop-api")
      await box.press("Enter")
      await expect(page.getByText("Axe can’t see mia/shop-api. Check the name, or sign in with gh auth login.")).toBeVisible()
      await page.mouse.move(1420, 880)
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${theme}-c-repo-invalid.png`)
      // Typing filters the menu; arrows and Return pick.
      await box.fill("lane")
      await expect(menu).not.toContainText("mia/shop-web")
      await box.fill("")
      await box.press("ArrowDown")
      await box.press("ArrowUp")
      await box.press("Enter")
      await expect(page.getByText("Tell me about new security alerts in shop-web.")).toBeVisible()
      await expect(page.getByText("Every morning I’ll check shop-web for new security alerts, vulnerable packages and leaked keys.")).toBeVisible()
      await expect(page.getByText(/email records/)).toBeHidden()
      await page.getByRole("button", { name: "Add check" }).click()
      await expect(page.getByText("No open alerts. 214 packages, none with known problems. No keys in the code.")).toBeVisible()
    })

    test("w-repo-quiet", async ({ page }) => {
      await open(page, theme, "")
      await row(page, "w-repo").click()
      await expect(page.getByText("No alerts since Oct 24")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-repo-quiet.png`)
    })

    test("page-problems row, w-repo-problem and the folder question", async ({ page }) => {
      await open(page, theme, "watchrepo")
      const r = row(page, "w-repo")
      await expect(r).toContainText("2 new security alerts")
      await r.click()
      const card = page.getByTestId("problem-repo")
      await expect(card).toContainText("2 new security alerts in shop-web")
      await expect(card).toContainText("Both are in packages with a fixed version out.")
      await expect(card).toContainText("Open redirect, high. Fixed in 4.19.2")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-repo-problem.png`)
      await card.getByRole("button", { name: /^Fix with / }).click()
      await expect(page.getByText("Which folder has the code for shop-web?")).toBeVisible()
      await expect(page.getByText("Shopify theme, changed today")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-w-repo-fix-folder.png`)
    })
  })

  test.describe(`watching dashboard ${theme}`, () => {
    test("dash-wide: the radar, two problems and eight live tiles, like the M-WatchCombo board", async ({ page }) => {
      await open(page, theme, "watchdash")
      await expect(page.getByTestId("dash-status")).toContainText("8 of 10 checks healthy, 2 need a look")
      await expect(page.getByTestId("dashboard")).toHaveAttribute("data-wide", "true")
      await expect(page.getByTestId("radar")).toContainText("8/10")
      await expect(page.getByTestId("radar").getByRole("button", { name: "API health, healthy, 575 ms" })).toBeVisible()
      await expect(page.getByTestId("row-d-status")).toContainText("Cloudflare outage")
      await expect(page.getByTestId("row-d-outdated")).toContainText("4 behind")
      await expect(page.getByTestId("row-d-links")).toContainText("Checking")
      await expect(page.getByTestId("row-d-health")).toContainText("Next check in 5 min")
      // Problems first: the two problems, the running check, then the healthy ones in group order.
      const order = await page.locator('[data-testid="live-grid"] > [data-testid^="row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))
      expect(order).toEqual(["row-d-status", "row-d-outdated", "row-d-links", "row-d-health", "row-d-feed", "row-d-seo", "row-d-dns", "row-d-expiry", "row-d-tests", "row-d-disk"])
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-dash-wide.png`)
    })

    test("dash-narrow: two columns, the radar a row of its own", async ({ page }) => {
      await page.setViewportSize({ width: 1180, height: 900 })
      await open(page, theme, "watchdash")
      await expect(page.getByTestId("dashboard")).not.toHaveAttribute("data-wide", "true")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-dash-narrow.png`)
    })

    test("dash-opened: Show packages, then a tile opens its chat and Esc folds it back", async ({ page }) => {
      await open(page, theme, "watchdash")
      await page.getByRole("button", { name: "Show packages" }).click()
      await expect(page.getByTestId("row-d-outdated").getByRole("table")).toContainText("electron")
      await page.getByTestId("row-d-outdated").scrollIntoViewIfNeeded()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-dash-opened.png`)
      await row(page, "d-dns").click()
      await expect(page.getByTestId("watch-strip")).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(page.getByTestId("dashboard")).toBeVisible()
      await row(page, "d-seo").click()
      await page.getByRole("button", { name: "Back to Oversight" }).click()
      await expect(page.getByTestId("dashboard")).toBeVisible()
    })

    test("dash-by-group: the order switch, remembered", async ({ page }) => {
      await open(page, theme, "watchdash")
      await page.getByRole("button", { name: "By group" }).click()
      await page.reload()
      await page.getByRole("button", { name: /^Oversight/ }).first().click()
      await expect(page.getByRole("button", { name: "By group" })).toHaveAttribute("aria-pressed", "true")
      await expect(page.locator('[data-testid="live-grid"] > [data-testid^="row-"]')).toHaveCount(10)
      const order = await page.locator('[data-testid="live-grid"] > [data-testid^="row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))
      expect(order).toEqual(["row-d-health", "row-d-links", "row-d-feed", "row-d-seo", "row-d-dns", "row-d-expiry", "row-d-status", "row-d-outdated", "row-d-tests", "row-d-disk"])
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-dash-by-group.png`)
    })
  })
}

/** Every grid cell the tiles leave empty, measured from where they really are. */
async function emptyCells(page: Page) {
  return page.getByTestId("live-grid").evaluate((grid) => {
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length
    const kids = [...grid.children] as HTMLElement[]
    const g = grid.getBoundingClientRect()
    const colW = (g.width - 16 * (cols - 1)) / cols
    const rowsTop = [...new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)))].sort((a, b) => a - b)
    const taken = new Set<string>()
    for (const k of kids) {
      const r = k.getBoundingClientRect()
      const c0 = Math.round((r.left - g.left) / (colW + 16))
      const w = Math.round((r.width + 16) / (colW + 16))
      const r0 = rowsTop.indexOf(Math.round(r.top))
      const h = rowsTop.filter((t) => t >= Math.round(r.top) && t < Math.round(r.bottom)).length
      for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) taken.add(`${y},${x}`)
    }
    return rowsTop.length * cols - taken.size
  })
}

test.describe("watching dashboard, live", () => {
  test("every old action still works: menu, Fix with Claude Code, Open status page, Details", async ({ page }) => {
    const opened: string[] = []
    page.on("console", (m) => m.text().startsWith("[mock] open") && opened.push(m.text()))
    await open(page, "dark", "watchdash")
    // Right-click: Check now, Pause, Resume.
    await page.getByTestId("row-d-dns").click({ button: "right" })
    await page.getByRole("menuitem", { name: "Pause" }).click()
    await expect(page.getByTestId("row-d-dns")).toContainText("Paused since")
    await page.getByTestId("row-d-dns").click({ button: "right" })
    await page.getByRole("menuitem", { name: "Resume" }).click()
    await expect(page.getByTestId("row-d-dns")).not.toContainText("Paused since")
    await page.getByTestId("row-d-dns").click({ button: "right" })
    await page.getByRole("menuitem", { name: "Check now" }).click()
    await expect(page.getByRole("menu")).toHaveCount(0)
    // The ⋯ on hover is the same menu.
    await page.getByTestId("row-d-disk").hover()
    await page.getByRole("button", { name: "More for This Mac’s disk" }).click()
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible()
    await page.keyboard.press("Escape")
    // Open status page goes to the provider's page.
    await page.getByRole("button", { name: "Open status page" }).click()
    await expect.poll(() => opened).toContain("[mock] open https://www.cloudflarestatus.com")
    // Details opens the watch.
    await page.getByTestId("row-d-status").getByRole("button", { name: "Details" }).click()
    await expect(page.getByRole("button", { name: "Back to Oversight" })).toBeVisible()
    await page.keyboard.press("Escape")
    // Fix with Claude Code runs in the watch's own thread.
    await page.getByRole("button", { name: /^Fix with / }).click()
    await expect(page.getByRole("button", { name: "Back to Oversight" })).toBeVisible()
  })

  test("a radar dot brings its tile into view and marks it", async ({ page }) => {
    await open(page, "dark", "watchdash")
    await page.getByTestId("dot-d-disk").click()
    await expect(page.getByTestId("row-d-disk")).toHaveAttribute("data-hi", "true")
    await expect(page.getByTestId("row-d-disk")).toBeInViewport()
    await expect(page.getByTestId("row-d-disk")).not.toHaveAttribute("data-hi", "true", { timeout: 3000 })
    // Hovering a tile lights its dot.
    await page.getByTestId("row-d-tests").hover()
    await expect(page.getByTestId("dot-d-tests")).toHaveAttribute("data-lit", "true")
  })

  test("delete leaves nine watches and no empty cell, wide and narrow", async ({ page }) => {
    await open(page, "dark", "watchdash")
    expect(await emptyCells(page)).toBe(0)
    await page.getByTestId("row-d-tests").click({ button: "right" })
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
    await expect(page.locator('[data-testid="live-grid"] > [data-testid^="row-"]')).toHaveCount(9)
    expect(await emptyCells(page)).toBe(0)
    await page.setViewportSize({ width: 1180, height: 900 })
    await expect(page.getByTestId("dashboard")).not.toHaveAttribute("data-wide", "true")
    expect(await emptyCells(page)).toBe(0)
  })

  test("Reduce Motion: no live animation runs", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await open(page, "dark", "watchdash")
    await expect(page.getByTestId("radar")).toBeVisible()
    await page.waitForTimeout(600)
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)
    expect(running).toBe(0)
    // The values stay: the countdown shows its number.
    await expect(page.getByTestId("row-d-health")).toContainText("Next check in 5 min")
  })

  test("Oversight runs no loops, and a hidden window still marks the page paused", async ({ page }) => {
    await open(page, "dark", "watchdash")
    await expect(page.getByTestId("radar")).toBeVisible()
    // Quiet Oversight (2026-11-08): no live loops (`data-loop`) on the dashboard; a checking spinner may still turn.
    const live = () => page.evaluate(() => document.getAnimations().filter((a) => a.effect instanceof KeyframeEffect && (a.effect.target as Element | null)?.closest("[data-loop]") && !(a.effect.target as Element).closest("[data-loop]")!.getAttribute("data-loop")!.startsWith("lv-spin")).map((a) => a.playState))
    expect((await live()).filter((s) => s === "running")).toEqual([])
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await expect(page.locator("html")).toHaveClass(/live-paused/)
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await expect(page.locator("html")).not.toHaveClass(/live-paused/)
  })
})
