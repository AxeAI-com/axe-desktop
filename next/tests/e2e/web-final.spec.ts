import { expect, test, type Page } from "@playwright/test"

// Spec 0001: the main area uses the web's final design and the sidebar keeps today's look. Computed colours, no pictures.

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light") {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}`)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
}

const css = (page: Page, sel: string, props: string[]) =>
  page.locator(sel).first().evaluate((el, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])), props)

// The sidebar's values on master (before the web-final palette): background, text and hover colours.
const SIDEBAR = {
  dark: { nav: "rgb(31, 26, 28)", text: "rgb(237, 237, 240)", row: "rgb(228, 226, 227)", hover: "rgba(255, 255, 255, 0.05)" },
  light: { nav: "rgb(239, 237, 232)", text: "rgb(28, 27, 24)", row: "rgb(51, 49, 44)", hover: "rgb(233, 230, 223)" },
} as const

for (const theme of ["dark", "light"] as const) {
  test(`the sidebar keeps its own colours (${theme})`, async ({ page }) => {
    await open(page, theme)
    const nav = await css(page, 'nav[aria-label="Chats"]', ["background-color", "color"])
    expect(nav["background-color"]).toBe(SIDEBAR[theme].nav)
    expect(nav.color).toBe(SIDEBAR[theme].text)
    const watching = page.getByRole("button", { name: /^Oversight/ }).first()
    expect((await watching.evaluate((el) => getComputedStyle(el).color))).toBe(SIDEBAR[theme].row)
    await watching.hover()
    await page.waitForTimeout(300)
    expect((await watching.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(SIDEBAR[theme].hover)
  })
}

test("the main area is the web's final design (dark)", async ({ page }) => {
  await open(page, "dark")
  expect((await css(page, "main", ["background-color"]))["background-color"]).toBe("rgb(22, 21, 20)")

  const composer = await css(page, '[data-slot="prompt-input"]', ["background-color", "border-top-left-radius", "box-shadow", "border-top-width"])
  // Draft 3's box: #232221, radius 16, an inset 1 px hairline (white 9%), no border.
  expect(composer["background-color"]).toBe("rgb(35, 34, 33)")
  expect(composer["border-top-left-radius"]).toBe("16px")
  expect(composer["box-shadow"]).toMatch(/rgba\(255, 255, 255, 0.09\) 0px 0px 0px 1px inset$/)
  expect(composer["border-top-width"]).toBe("0px")

  // The hovered sparkle: Draft 3's faint fill (white 6%).
  const plus = page.getByRole("button", { name: "Add files, tools and connectors" })
  await plus.hover()
  await page.waitForTimeout(300)
  expect(await plus.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(255, 255, 255, 0.06)")

  // A menu (Draft 3's .cx-menu): radius 10, a hairline and one small shadow.
  await page.getByRole("button", { name: "Auto", exact: true }).click()
  const menu = page.getByRole("listbox", { name: "Choose who answers" })
  await expect(menu).toBeVisible()
  await page.waitForTimeout(400)
  const m = await menu.evaluate((el) => ({ r: getComputedStyle(el).borderTopLeftRadius, s: getComputedStyle(el).boxShadow }))
  expect(m.r).toBe("10px")
  expect(m.s).toContain("0px 0px 0px 1px")
  await page.keyboard.press("Escape")

  // A user bubble.
  await page.getByRole("navigation", { name: "Chats" }).getByText("Two days in Lisbon", { exact: true }).click()
  const bubble = page.locator(".bubble").first()
  await expect(bubble).toBeVisible()
  expect(await bubble.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(42, 41, 40)")
})
