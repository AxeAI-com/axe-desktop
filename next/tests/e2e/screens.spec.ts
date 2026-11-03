import { expect, test, type Page } from "@playwright/test"

// Screens of the window at 1440×900, served with the mock engine (src/renderer/src/lib/mock-bridge.ts).
// The clock is fixed at 19:30, so the greeting (lib/greetings picks by day), the chat sections and the live seconds never move.
// Update the pictures on purpose with: pnpm exec playwright test --update-snapshots

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light", mock = "") {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}${mock ? `&mock=${mock}` : ""}`)
  await page.evaluate(() => document.fonts.ready)
}

/** Moves the pointer out of the way and waits until entrances and fades have finished. */
async function settle(page: Page) {
  await page.mouse.move(1420, 880)
  await page.waitForTimeout(300)
  // Infinite loops (the working dots) never finish; everything else must.
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
    undefined,
    { timeout: 5000 },
  )
  await page.waitForTimeout(150)
}

const chat = (page: Page, title: string) => page.getByRole("navigation", { name: "Chats" }).getByText(title, { exact: true })

/** Plain chat on the mock engine: computer use is on by default, and its mock answers differently. */
async function plainChat(page: Page) {
  await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
  await page.getByRole("menuitem", { name: /Do it/ }).click()
}


for (const theme of ["dark"] as const) {
  test.describe(theme, () => {
    test("signed out", async ({ page }) => {
      // No wall: the whole app works with CLI agents, and signing in is one row in the sidebar.
      await open(page, theme, "signedout")
      await expect(page.getByRole("button", { name: "Sign in to Axe AI", exact: true })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-signed-out.png`)

      await page.getByRole("button", { name: "Sign in to Axe AI", exact: true }).click()
      await expect(page.getByText("Finish signing in in your browser")).toBeVisible()
    })

    test("the fox and its forest", async ({ page }) => {
      await open(page, theme, "signedout")
      const fox = page.getByRole("button", { name: "Fox: show the forest" })
      await fox.hover()
      await settle(page)
      await expect(fox).toHaveScreenshot(`${theme}-fox-hover.png`)
      await fox.click()
      await expect(page.getByRole("button", { name: "Fox: leave the forest" })).toBeVisible()
      await page.waitForTimeout(700)
      await page.mouse.move(5, 5)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-forest.png`)
      // Click again: back to the chat.
      await page.getByRole("button", { name: "Fox: leave the forest" }).click()
      await expect(page.getByRole("button", { name: "Fox: show the forest" })).toBeVisible()
    })

    test("@ folders, apps and chats", async ({ page }) => {
      await open(page, theme)
      const box = page.getByRole("textbox", { name: "Message" })
      await box.click()
      await box.pressSequentially("Compare with @")
      const menu = page.getByRole("listbox", { name: "Mention" })
      await expect(menu.getByText("Folders")).toBeVisible()
      await expect(menu.getByText("Apps")).toBeVisible()
      await expect(menu.getByText("Chats")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-mention-menu.png`)

      // An app goes in as words.
      await box.pressSequentially("saf")
      await page.keyboard.press("Enter")
      await expect(box).toHaveValue("Compare with @Safari ")

      // A chat comes along as a file.
      await box.pressSequentially("and @lisbon")
      await expect(menu.getByRole("option", { name: /Two days in Lisbon/ })).toBeVisible()
      await page.keyboard.press("Enter")
      await expect(box).toHaveValue("Compare with @Safari and ")
      await expect(page.getByRole("img", { name: /Two days in Lisbon/ }).or(page.getByText("Two days in Lisbon.md"))).toBeVisible()
    })

    test("account photo", async ({ page }) => {
      await open(page, theme, "photo")
      const account = page.getByRole("button", { name: "Account" })
      await expect(account.locator("img")).toBeVisible()
      await settle(page)
      await expect(account).toHaveScreenshot(`${theme}-account-photo.png`)
    })

    test("new chat", async ({ page }) => {
      await open(page, theme)
      await expect(page.getByRole("heading", { name: "Let's untangle it" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-new-chat.png`)

      // A card starts its feature: Research turns research on and starts the line.
      await page.getByRole("button", { name: /Research with sources/ }).click()
      await expect(page.getByRole("button", { name: "Research is on. Turn it off" })).toBeVisible()
      await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("Research ")
    })

    test("model picker", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("button", { name: "Auto", exact: true }).click()
      const list = page.getByRole("listbox", { name: "Choose who answers" })
      await expect(list.getByText("On this computer", { exact: true })).toBeVisible()
      await expect(list.getByText("More agents")).toBeVisible()
      await page.waitForTimeout(500)
      await expect(page).toHaveScreenshot(`${theme}-model-picker.png`)
    })

    test("finished reply", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Two days in Lisbon").click()
      await expect(page.getByRole("table")).toBeVisible()
      await expect(page.getByRole("heading", { name: "Searched the web" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-reply.png`)
    })

    test("live reply", async ({ page }) => {
      await open(page, theme, "live")
      await chat(page, "Compare three note apps").click()
      await expect(page.getByText("Searching the web")).toBeVisible()
      await expect(page.getByText("4s", { exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-live-reply.png`)
    })

    test("agent reply with steps and a permission", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Fix the flaky upload test").click()
      await expect(page.getByRole("region", { name: "Allow this?" })).toBeVisible()
      await expect(page.getByRole("region", { name: "Plan" })).toBeVisible()
      await expect(page.getByText("Ran the test 10 times")).toBeVisible()
      await settle(page)
      // Back to the top of the reply, where the steps open.
      await page.evaluate(() => document.querySelector("[data-thread-scroll]")?.scrollTo(0, 0))
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${theme}-agent-steps.png`)
      await page.evaluate(() => {
        const el = document.querySelector("[data-thread-scroll]")
        el?.scrollTo(0, el.scrollHeight)
      })
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${theme}-agent-permission.png`)
    })

    test("sidebar menu", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Two days in Lisbon").hover()
      await page.getByRole("button", { name: "More for Two days in Lisbon", exact: true }).click()
      await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible()
      await page.waitForTimeout(500)
      await expect(page).toHaveScreenshot(`${theme}-sidebar-menu.png`)
    })

    test("command palette", async ({ page }) => {
      await open(page, theme)
      await expect(page.getByRole("heading", { name: "Let's untangle it" })).toBeVisible()
      await page.keyboard.press("ControlOrMeta+k")
      await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-command-palette.png`)
    })

    test("research: live, finished, asks first", async ({ page }) => {
      await open(page, theme, "research")
      await chat(page, "Pricing for short films").click()
      await expect(page.getByRole("region", { name: "Research in progress" })).toBeVisible()
      await expect(page.getByRole("heading", { name: "Per-minute pricing" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-research-live.png`)

      await chat(page, "How creators price short films").click()
      await expect(page.getByRole("heading", { name: "What to charge first" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-research-report.png`)
      await page.evaluate(() => document.querySelector("[data-thread-scroll]")?.scrollTo(0, 0))
      await page.getByRole("button", { name: /Researched for/ }).click()
      await expect(page.getByText("Read 4 of 4 pages")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-research-steps.png`)

      await chat(page, "Rates for wedding films").click()
      await expect(page.getByRole("region", { name: "Run research?" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-research-approval.png`)
    })

    test("research switched on", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await page.getByRole("menuitem", { name: "Research" }).click()
      await expect(page.getByRole("button", { name: "Research is on. Turn it off" })).toBeVisible()
      await expect(page.getByPlaceholder("What should Axe research?")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-research-on.png`)
    })

    test("slash menu", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("textbox", { name: "Message" }).fill("/")
      await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-slash-axe.png`)

      await chat(page, "Fix the flaky upload test").click()
      await page.getByPlaceholder("Reply").fill("/")
      await expect(page.getByText("Commands from Claude Code")).toBeVisible()
      await expect(page.getByText("Skills from Claude Code")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-slash-agent.png`)
    })

    test("usage ring", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Two days in Lisbon").click()
      await page.getByRole("button", { name: "3% of context used" }).click()
      await expect(page.getByText("1,240 credits left")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-usage-axe.png`)

      await chat(page, "Fix the flaky upload test").click()
      await page.getByRole("button", { name: "42% of context used" }).click()
      await expect(page.getByText(/cost \$0\.42 so far/)).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-usage-agent.png`)
    })

    test("agent instructions in the + menu", async ({ page }) => {
      await open(page, theme)
      await chat(page, "Fix the flaky upload test").click()
      await expect(page.getByPlaceholder("Reply")).toBeVisible()
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await expect(page.getByRole("menuitem", { name: "Open CLAUDE.md" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-agent-instructions.png`)
    })

    test("memory", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("button", { name: "Account", exact: true }).click()
      await page.getByRole("menuitem", { name: "Settings" }).click()
      await expect(page.getByText("Keep answers short; tables over long lists.")).toBeVisible()
      // The account menu fades out over the list; clicking through it makes Playwright scroll the page.
      await expect(page.getByRole("menuitem", { name: "Settings" })).toHaveCount(0)
      await page.getByText("Prices in US dollars, dates as 22 Oct 2026.").hover()
      await page.getByRole("button", { name: "Edit Prices in US dollars, dates as 22 Oct 2026." }).click()
      await expect(page.getByRole("textbox", { name: "Edit memory" })).toBeFocused()
      // Clicking may scroll the page by a varying amount; the edit box is in view from the top.
      await page.evaluate(() => document.querySelectorAll("main *").forEach((el) => el.scrollTop && (el.scrollTop = 0)))
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-memory-editing.png`)

      await open(page, theme, "nomemory")
      await page.getByRole("button", { name: "Account", exact: true }).click()
      await page.getByRole("menuitem", { name: "Settings" }).click()
      await expect(page.getByText("Nothing yet.", { exact: false })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-memory-empty.png`)
    })

    test("settings", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("button", { name: "Account", exact: true }).click()
      await page.getByRole("menuitem", { name: "Settings" }).click()
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
      await expect(page.getByText("CLIs on this computer")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-settings.png`)
    })

    test("files waiting in the composer", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await page.getByRole("menuitem", { name: "Add files or photos" }).click()
      await expect(page.getByRole("img", { name: "Lisbon tram.jpg" })).toBeVisible()
      await expect(page.getByText("PDF, 408 KB")).toBeVisible()
      await page.getByRole("textbox", { name: "Message" }).fill("Plan our first day from these")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-composer-files.png`)
    })

    test("a sent message with files", async ({ page }) => {
      await open(page, theme)
      await plainChat(page)
      await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
      await page.getByRole("menuitem", { name: "Add files or photos" }).click()
      await page.getByRole("textbox", { name: "Message" }).fill("Plan our first day from these")
      await page.keyboard.press("Enter")
      await expect(page.getByRole("img", { name: "Lisbon tram.jpg" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Add files, tools and connectors" })).toBeVisible()
      // The finished reply, so the picture never depends on how far the stream got.
      await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole("img", { name: "Lisbon tram.jpg" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-sent-files.png`)
    })
  })
}

test("a sent message streams a reply and the chat menu renames it", async ({ page }) => {
  await open(page, "dark")
  await plainChat(page)
  await page.getByRole("textbox", { name: "Message" }).fill("How should I run a weekly review?")
  await page.keyboard.press("Enter")
  await expect(page.getByText("How should I run a weekly review?").last()).toBeVisible()
  await expect(page.getByRole("code").or(page.locator("pre code")).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: /searched the web/i })).toBeVisible()

  await page.getByRole("main").getByRole("button", { name: "How should I run a weekly review?", exact: true }).click()
  await page.getByRole("menuitem", { name: "Rename" }).click()
  await page.getByRole("textbox", { name: "Chat name" }).fill("Weekly review")
  await page.keyboard.press("Enter")
  await expect(chat(page, "Weekly review")).toBeVisible()
})

test("answering a permission lets the agent finish", async ({ page }) => {
  await open(page, "dark")
  await chat(page, "Fix the flaky upload test").click()
  await page.getByRole("button", { name: "Allow once" }).click()
  await expect(page.getByRole("region", { name: "Allow this?" })).toHaveCount(0)
  await expect(page.getByText("50 runs in a row")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText("4/4")).toBeVisible()
})

test("the sidebar resizes, collapses and filters", async ({ page }) => {
  await open(page, "dark")
  const nav = page.getByRole("navigation", { name: "Chats" })
  await expect(nav).toHaveCSS("width", "300px")
  const handle = page.getByRole("separator", { name: "Resize the sidebar" })
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 3, box.y + 400)
  await page.mouse.down()
  await page.mouse.move(box.x + 103, box.y + 400, { steps: 4 })
  await page.mouse.up()
  await expect(nav).toHaveCSS("width", "400px")

  // Search opens the palette over the page, like axeai.com's sidebar.
  await page.getByRole("button", { name: /^Search and commands/ }).click()
  await page.getByLabel("Search chats and actions").fill("lisbon")
  await expect(page.getByRole("option", { name: /Two days in Lisbon/ })).toBeVisible()
  await expect(page.getByRole("option", { name: /Gift ideas for Sam/ })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Hide sidebar" }).click()
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible()
})

test("a pasted screenshot joins the files and can be removed", async ({ page }) => {
  await open(page, "dark")
  const box = page.getByRole("textbox", { name: "Message" })
  await box.click()
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "Screenshot.png", { type: "image/png" }))
    document.querySelector("textarea")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(page.getByRole("img", { name: "Screenshot.png" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled()
  await page.getByRole("img", { name: "Screenshot.png" }).hover()
  await page.getByRole("button", { name: "Remove Screenshot.png" }).click()
  await expect(page.getByRole("img", { name: "Screenshot.png" })).toHaveCount(0)
  // Nothing left to send: the send button steps aside for the mic.
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0)
})

test("keyboard shortcuts: attach, move between chats, copy, and the palette lists them", async ({ page }) => {
  await open(page, "dark")
  await expect(page.getByRole("heading", { name: "Let's untangle it" })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+u")
  await expect(page.getByRole("img", { name: "Lisbon tram.jpg" })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+u")
  await expect(page.getByRole("img", { name: "Lisbon tram.jpg" })).toHaveCount(1)
  await expect(page.getByRole("img", { name: "Lisbon tram.jpg" })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+Alt+ArrowDown")
  await expect(page.getByRole("main").getByRole("button", { name: "Launch posts for Studio" })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+Alt+ArrowDown")
  await expect(page.getByRole("main").getByRole("button", { name: "Two days in Lisbon" })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+Alt+ArrowUp")
  await expect(page.getByRole("main").getByRole("button", { name: "Launch posts for Studio" })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+k")
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await page.keyboard.type("copy")
  await expect(palette.getByText("Copy the last reply")).toBeVisible()
  await expect(palette.getByText("⇧⌘C")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press("ControlOrMeta+l")
  await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused()
})

test("a research run builds its report live", async ({ page }) => {
  await open(page, "dark")
  await page.getByRole("button", { name: "Add files, tools and connectors" }).click()
  await page.getByRole("menuitem", { name: "Research" }).click()
  await page.getByRole("textbox", { name: "Message" }).fill("How do creators price short films?")
  await page.keyboard.press("Enter")
  const live = page.getByRole("region", { name: "Research in progress" })
  await expect(live).toBeVisible()
  await expect(live.getByText("Planned 3 searches")).toBeVisible()
  await expect(live.getByText("Searched for “video studio day rate brand work”")).toBeVisible()
  // Sections appear one by one while it writes.
  await expect(page.getByRole("heading", { name: "Per-minute pricing" })).toBeVisible({ timeout: 15_000 })
  await expect(live).toBeVisible()
  await expect(page.getByRole("heading", { name: "What to charge first" })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("button", { name: /Researched for/ })).toBeVisible()
  await expect(live).toHaveCount(0)
  // Citations are numbered chips that match the source list.
  const report = page.getByRole("article", { name: "Research report" })
  await expect(report.locator("a.cite").first()).toHaveText("1")
  await expect(report.getByText("Usage rights, explained")).toBeVisible()
})

test("approving a paid model's research runs it; cancelling says nothing was charged", async ({ page }) => {
  await open(page, "dark", "research")
  await chat(page, "Rates for wedding films").click()
  await page.getByRole("button", { name: "Run research" }).click()
  await expect(page.getByRole("region", { name: "Run research?" })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Research in progress" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "What to charge first" })).toBeVisible({ timeout: 20_000 })

  await open(page, "dark", "research")
  await chat(page, "Rates for wedding films").click()
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByText("Research cancelled. Nothing was charged.")).toBeVisible()
})

test("the / menu walks with the arrows and inserts the command", async ({ page }) => {
  await open(page, "dark")
  await chat(page, "Fix the flaky upload test").click()
  const box = page.getByPlaceholder("Reply")
  await box.fill("/")
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("option", { name: /\/init/ })).toHaveAttribute("aria-selected", "true")
  await box.fill("/comp")
  await expect(page.getByRole("option")).toHaveCount(1)
  await page.keyboard.press("Enter")
  await expect(box).toHaveValue("/compact ")
  await expect(page.getByRole("listbox", { name: "Commands" })).toHaveCount(0)

  // Escape closes it without sending; an Axe starter writes words, /research switches research on.
  await box.fill("/")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox", { name: "Commands" })).toHaveCount(0)
  await page.getByRole("button", { name: "New chat" }).first().click()
  await expect(page.getByRole("heading", { name: "Let's untangle it" })).toBeVisible()
  await page.getByRole("textbox", { name: "Message" }).fill("/res")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Research is on. Turn it off" })).toBeVisible()
  await page.getByRole("textbox", { name: "Message" }).fill("/wri")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("Help me write ")
})

test("memory: add, edit and forget", async ({ page }) => {
  await open(page, "dark")
  await page.getByRole("button", { name: "Account", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  const add = page.getByRole("textbox", { name: "Something to remember" })
  await add.fill("My city is Lisbon.")
  await page.keyboard.press("Enter")
  await expect(page.getByText("My city is Lisbon.")).toBeVisible()
  await expect(add).toHaveValue("")

  await page.getByText("My city is Lisbon.").hover()
  await page.getByRole("button", { name: "Edit My city is Lisbon." }).click()
  await page.getByRole("textbox", { name: "Edit memory" }).fill("My city is Porto.")
  await page.keyboard.press("Enter")
  await expect(page.getByText("My city is Porto.")).toBeVisible()

  await page.getByText("My city is Porto.").hover()
  await page.getByRole("button", { name: "Forget My city is Porto." }).click()
  await expect(page.getByText("My city is Porto.")).toHaveCount(0)
})

test("reduced motion stops the loops", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await open(page, "dark", "live")
  await chat(page, "Compare three note apps").click()
  await expect(page.getByText("Searching the web")).toBeVisible()
  const loops = await page.evaluate(() =>
    // Pasta UI's live text and icon, and the step line while it works.
    [...document.querySelectorAll(".agent-text-shimmer, .steps-live h3, [data-slot=thinking-shimmer] svg, .dots > i")].map(
      (el) => getComputedStyle(el).animationName,
    ),
  )
  expect(loops.length).toBeGreaterThan(0)
  expect(new Set(loops)).toEqual(new Set(["none"]))
})
