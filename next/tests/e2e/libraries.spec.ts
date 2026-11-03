import { expect, test, type Page } from "@playwright/test"

// The libraries (package G): skills, agents and connectors, every page and state, light and
// dark, on the mock engine (src/renderer/src/lib/mock-libraries.ts). Same clock and settling as
// screens.spec.ts.

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light", mock = "") {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}${mock ? `&mock=${mock}` : ""}`)
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

const side = (page: Page) => page.getByRole("navigation", { name: "Chats" })
const nav = (page: Page, name: string) => side(page).getByRole("button", { name, exact: true })
// Skills, Connectors and Agents are tabs under Customize since 2026-10-24.
async function customize(page: Page, tab: "Skills" | "Connectors" | "Agents") {
  await nav(page, "Customize").click()
  if (tab !== "Skills") await page.getByRole("tablist", { name: "Customize" }).getByRole("tab", { name: tab }).click()
  await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true")
}

for (const theme of ["dark"] as const) {
  test.describe(theme, () => {
    test("skills", async ({ page }) => {
      await open(page, theme)
      await customize(page, "Skills")
      const added = page.getByRole("region", { name: "Added" })
      await expect(added.getByRole("button", { name: "Brand voice" })).toBeVisible()
      await expect(page.getByRole("region", { name: "For your work" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-skills.png`)

      await added.getByRole("button", { name: "Brand voice" }).click()
      const sheet = page.getByRole("dialog", { name: "Brand voice" })
      await expect(sheet.getByText("Short sentences. One idea each.")).toBeVisible()
      await expect(sheet.getByRole("checkbox", { name: "Claude Code" })).toHaveAttribute("aria-checked", "true")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-skill-sheet.png`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      // Off keeps it, out of the / menu.
      await added.getByRole("switch", { name: "Brand voice on" }).click()
      await expect(added.getByRole("switch", { name: "Brand voice off" })).toHaveAttribute("aria-checked", "false")

      // Find one by what you need to do, add it into Codex too.
      const search = page.getByRole("textbox", { name: "Find a skill" })
      await search.fill("deck")
      const found = page.getByRole("region", { name: "Found" })
      await found.getByRole("button", { name: "Deck outline" }).click()
      await page.getByRole("dialog").getByRole("checkbox", { name: "Codex" }).click()
      await page.getByRole("button", { name: "Add skill" }).click()
      await expect(page.getByRole("dialog").getByText("Type /deck-outline in a chat to use it.")).toBeVisible()
      await page.keyboard.press("Escape")
      await search.fill("")
      await expect(added.getByRole("button", { name: "Deck outline" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-skills-added.png`)

      // And one from the open-source libraries.
      await search.fill("brainstorm")
      await found.getByRole("button", { name: "Brainstorming" }).click()
      const fromLibrary = page.getByRole("dialog", { name: "Brainstorming" })
      await expect(fromLibrary.getByText("Ask one question at a time.")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-skills-open-source-sheet.png`)
      await fromLibrary.getByRole("button", { name: "Add skill" }).click()
      await expect(fromLibrary.getByText("Added. Type / in a chat to use it.")).toBeVisible()
      await page.keyboard.press("Escape")

      await page.getByRole("button", { name: "Write a skill" }).click()
      await page.getByRole("dialog", { name: "New skill" }).getByPlaceholder("Pricing page").fill("Weekly digest")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-skill-new.png`)
    })

    test("an agent from one sentence", async ({ page }) => {
      await open(page, theme)
      await customize(page, "Agents")
      await page.getByRole("textbox", { name: "Describe an agent" }).fill("Review my open pull requests in axe-web and tell me what to fix")
      await page.getByRole("button", { name: "Create" }).click()
      const draft = page.getByRole("region", { name: "Draft agent" })
      await expect(draft.getByRole("textbox", { name: "Agent name" })).toHaveValue("Review pull requests")
      await expect(draft.getByText("Claude Code")).toBeVisible()
      await expect(draft.getByRole("button", { name: "axe-web" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-draft.png`)
      await draft.getByRole("button", { name: "Make the agent" }).click()
      await expect(page.getByText("/review-pull-requests", { exact: true }).first()).toBeVisible()
      await expect(page.getByRole("region", { name: "Your agents" }).getByRole("button", { name: "Review pull requests" })).toBeVisible()
    })

    test("agents", async ({ page }) => {
      await open(page, theme)
      await customize(page, "Agents")
      await expect(page.getByRole("button", { name: "Support replies" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agents.png`)

      await page.getByRole("button", { name: "Support replies" }).click()
      await expect(page.getByRole("dialog", { name: "Support replies" }).getByText("Never promise refunds")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-sheet.png`)

      await page.getByRole("button", { name: "Edit" }).click()
      await expect(page.getByRole("dialog", { name: "Edit agent" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-edit.png`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      await page.getByRole("button", { name: "Writer", exact: true }).click()
      await page.getByRole("button", { name: "Start a chat" }).click()
      await expect(page.getByRole("heading", { name: "Writer" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Writer is on. Turn it off" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-chat.png`)
    })

    test("connectors", async ({ page }) => {
      await open(page, theme)
      await customize(page, "Connectors")
      await expect(page.getByRole("region", { name: "Connected" }).getByText("14 tools")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-connectors.png`)

      await page.getByRole("article", { name: "GitHub" }).getByRole("button", { name: "Connect" }).click()
      await expect(page.getByRole("dialog", { name: "Connect GitHub" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-connector-token.png`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      await page.getByRole("button", { name: "Add your own" }).click()
      await page.getByRole("dialog").getByPlaceholder("Team wiki").fill("Design system")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-connector-custom.png`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      await page.getByRole("radio", { name: "Developer" }).click()
      await expect(page.getByRole("article", { name: "Notion" })).toHaveCount(0)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-connectors-developer.png`)
    })

    test("connector sign-in", async ({ page }) => {
      await open(page, theme, "signin")
      await customize(page, "Connectors")
      await page.getByRole("article", { name: "Canva" }).getByRole("button", { name: "Connect" }).click()
      await expect(page.getByText("Waiting for your browser")).toBeVisible()
      // Clicking scrolled the card into view while the cards were still rising in; start from the top
      // so the picture never depends on how far that went.
      await page.evaluate(() => document.querySelectorAll("main *").forEach((el) => el.scrollTop > 0 && el.scrollTo(0, 0)))
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-connector-signin.png`)
      await page.getByRole("button", { name: "Cancel" }).click()
      await expect(page.getByRole("article", { name: "Canva" }).getByRole("button", { name: "Connect" })).toBeEnabled()
    })

    test("empty libraries", async ({ page }) => {
      await open(page, theme, "nolibrary")
      await customize(page, "Connectors")
      await expect(page.getByRole("region", { name: "Connected" })).toHaveCount(0)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-connectors-empty.png`)
    })

    test("in the composer", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("textbox", { name: "Message" }).fill("/")
      const menu = page.getByRole("listbox", { name: "Commands" })
      await expect(menu.getByText("/brand-voice")).toBeVisible()
      await expect(menu.getByText("/connectors")).toBeVisible()
      await page.getByRole("textbox", { name: "Message" }).fill("/b")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-slash-skills.png`)

      await page.getByRole("textbox", { name: "Message" }).fill("/conn")
      await page.keyboard.press("Enter")
      await expect(page.getByRole("tab", { name: "Connectors" })).toHaveAttribute("aria-selected", "true")

      await page.getByRole("button", { name: "New chat", exact: true }).first().click()
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await page.getByRole("menuitem", { name: "Notion" }).click()
      await page.getByRole("menuitem", { name: "Linear" }).click()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-plus-connectors.png`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Connectors on: Notion, Linear" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-connector-chip.png`)
    })
  })
}
