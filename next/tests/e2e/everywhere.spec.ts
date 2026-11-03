import { expect, test, type Page } from "@playwright/test"

// Package E on the mock engine: the quick bar (?window=quick, drawn on a stand-in desktop), voice
// (dictation and Talk), and the palette and Settings that reach them. Light and dark.
// Voice states are set through window.__axeVoice (the mock build only), so no microphone is needed.

const NOW = new Date("2026-10-22T19:30:00Z")

async function open(page: Page, theme: "dark" | "light", query = "") {
  await page.clock.setFixedTime(NOW)
  await page.goto(`/?theme=${theme}${query ? `&${query}` : ""}`)
  await page.evaluate(() => document.fonts.ready)
}

/** The main window, signed in and ready for keys. */
async function ready(page: Page) {
  await expect(page.getByRole("heading", { name: "Let's untangle it" })).toBeVisible()
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

const voice = (page: Page, state: unknown) =>
  page.evaluate((s) => (window as unknown as { __axeVoice: (s: unknown) => void }).__axeVoice(s), state)

const LEVELS = [0.05, 0.1, 0.2, 0.42, 0.6, 0.52, 0.7, 0.38, 0.25, 0.46, 0.66, 0.8, 0.58, 0.4, 0.3, 0.22, 0.5, 0.62, 0.44, 0.28, 0.18, 0.34, 0.56, 0.72, 0.6, 0.41, 0.3, 0.2, 0.12, 0.08]
const TALK = { open: true, level: 0, heard: "", reply: "", spokenUpTo: 0, beat: 0 }

for (const theme of ["dark"] as const) {
  test.describe(theme, () => {
    test("quick bar: empty, who answers, add", async ({ page }) => {
      await open(page, theme, "window=quick")
      const bar = page.getByRole("dialog", { name: "Quick bar" })
      await expect(bar.getByLabel("Ask Axe")).toBeFocused()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-empty.png`)

      await bar.getByRole("button", { name: /Who answers/ }).click()
      await expect(page.getByRole("listbox", { name: "Who answers" }).getByText("Claude Code")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-who.png`)
      await page.keyboard.press("Escape")

      await bar.getByLabel("Ask Axe").fill("What's on my screen, in one line?")
      await bar.getByRole("button", { name: /Add your screen/ }).click()
      await page.getByRole("option", { name: /Add my screen/ }).click()
      await bar.getByRole("button", { name: /Add your screen/ }).click()
      await page.getByRole("option", { name: /Add what's copied/ }).click()
      await expect(bar.getByText("Copied text.txt")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-attached.png`)
    })

    test("quick bar: picking an agent", async ({ page }) => {
      await open(page, theme, "window=quick")
      const bar = page.getByRole("dialog", { name: "Quick bar" })
      await bar.getByRole("button", { name: /Who answers/ }).click()
      await page.getByRole("option", { name: /Claude Code/ }).click()
      await expect(bar.getByRole("button", { name: "Who answers: Claude Code" })).toBeVisible()
      await expect(bar.getByLabel("Ask Axe")).toHaveAttribute("placeholder", "What should Claude Code do?")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-agent.png`)
    })

    test("quick bar: a live answer", async ({ page }) => {
      await open(page, theme, "window=quick&mock=live&thread=t-notes")
      await expect(page.getByText("Searching the web")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-live.png`)
    })

    test("quick bar: a finished answer", async ({ page }) => {
      await open(page, theme, "window=quick&thread=t-lisbon")
      await expect(page.getByRole("table")).toBeVisible()
      await expect(page.getByLabel("Ask Axe")).toHaveAttribute("placeholder", /press Enter to open the chat/)
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-answer.png`)
    })

    test("quick bar: an agent waiting for you", async ({ page }) => {
      await open(page, theme, "window=quick&thread=t-upload")
      await expect(page.getByText("Claude Code, in axe-web")).toBeVisible()
      await expect(page.getByRole("button", { name: "Allow once" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-permission.png`)
    })

    test("quick bar: dictating", async ({ page }) => {
      await open(page, theme, "window=quick")
      await voice(page, { dictation: { phase: "listening", target: "quick", startedAt: NOW.getTime() - 7000, levels: LEVELS } })
      await expect(page.getByRole("button", { name: "Write it down" })).toBeVisible()
      await expect(page.getByText("0:07")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-dictating.png`)
    })

    test("quick bar: signed out", async ({ page }) => {
      await open(page, theme, "window=quick&mock=signedout")
      // Signed out it works the same, with a CLI agent answering.
      await expect(page.getByRole("dialog", { name: "Quick bar" }).getByRole("textbox")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-quick-signed-out.png`)
    })

    test("dictation in the composer", async ({ page }) => {
      await open(page, theme)
      await expect(page.getByRole("heading", { name: "Let's untangle it" })).toBeVisible()
      await voice(page, { dictation: { phase: "listening", target: "composer", startedAt: NOW.getTime() - 12_000, levels: LEVELS } })
      await expect(page.getByRole("button", { name: "Stop dictating" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-dictate-listening.png`)

      await voice(page, { dictation: { phase: "writing", target: "composer" } })
      await expect(page.getByText("Writing it down")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-dictate-writing.png`)

      await voice(page, { dictation: { phase: "error", target: "composer", message: "Axe can't hear you. Allow the microphone in System Settings.", settings: true } })
      await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-dictate-denied.png`)
    })

    test("dictation in a chat writes into the box", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium")
      await open(page, theme)
      await page.getByRole("navigation", { name: "Chats" }).getByText("Two days in Lisbon", { exact: true }).click()
      await expect(page.getByRole("table")).toBeVisible()
      await settle(page)
      await page.getByLabel("Message").fill("Also")
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("axe:dictated", { detail: { target: "composer", text: "add a rainy-day plan" } })))
      await expect(page.getByLabel("Message")).toHaveValue("Also add a rainy-day plan")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-dictate-done.png`)
    })

    test("Talk to Axe", async ({ page }) => {
      await open(page, theme)
      await page.getByRole("navigation", { name: "Chats" }).getByText("Two days in Lisbon", { exact: true }).click()
      await expect(page.getByRole("table")).toBeVisible()

      await voice(page, { talk: { ...TALK, phase: "hearing", level: 0.55 } })
      await expect(page.getByRole("dialog", { name: "Talk to Axe" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-talk-listening.png`)

      await voice(page, { talk: { ...TALK, phase: "thinking", heard: "What if it rains on the second day?" } })
      await expect(page.getByText("Thinking")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-talk-thinking.png`)

      const reply =
        "Swap the viewpoint for the tile museum in the morning, then take the covered tram to Belém. The pastry shop has seats inside, so lunch stays dry."
      await voice(page, { talk: { ...TALK, phase: "speaking", heard: "What if it rains on the second day?", reply, spokenUpTo: 62, beat: 9 } })
      await expect(page.getByText("Speaking")).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-talk-speaking.png`)

      await voice(page, { talk: { ...TALK, phase: "muted", heard: "What if it rains on the second day?", reply, spokenUpTo: reply.length } })
      await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-talk-muted.png`)

      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog", { name: "Talk to Axe" })).toBeHidden()
    })

    test("Talk without a microphone", async ({ page }) => {
      await open(page, theme)
      await voice(page, { talk: { ...TALK, phase: "error", message: "Axe can't hear you. Allow the microphone in System Settings.", settings: true } })
      await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-talk-denied.png`)
    })

    test("the palette reaches every action", async ({ page }) => {
      await open(page, theme)
      await ready(page)
      await page.keyboard.press("Meta+k")
      const box = page.getByLabel("Search chats and actions")
      await expect(box).toBeFocused()
      await expect(page.getByRole("option", { name: /Open the quick bar/ })).toContainText("⌥Space")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-palette-start.png`)

      await box.fill("voice")
      await expect(page.getByRole("option", { name: /Talk to Axe/ })).toContainText("⇧⌘T")
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-palette-voice.png`)

      await box.fill("claude")
      await expect(page.getByRole("option", { name: /New chat with Claude Code/ })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-palette-agents.png`)

      await box.fill("quick bar and")
      await page.keyboard.press("Enter")
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
      await expect(page.getByRole("button", { name: /Quick bar shortcut: ⌥Space/ })).toBeInViewport()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-settings-voice.png`)
    })

    test("changing the quick bar key", async ({ page }) => {
      await open(page, theme)
      await ready(page)
      await page.keyboard.press("Meta+,")
      const key = page.getByRole("button", { name: /Quick bar shortcut/ })
      await key.scrollIntoViewIfNeeded()
      await key.click()
      await expect(page.getByRole("button", { name: "Press the new shortcut" })).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${theme}-settings-recording.png`)
      await page.keyboard.press("Control+Shift+K")
      await expect(page.getByRole("button", { name: /Quick bar shortcut: ⌃⇧K/ })).toBeVisible()
      await page.keyboard.press("Meta+k")
      await expect(page.getByRole("option", { name: /Open the quick bar/ })).toContainText("⌃⇧K")
    })
  })
}

test("Windows and Linux show Ctrl keys and Ctrl+Space", async ({ page }) => {
  await open(page, "dark", "platform=win32")
  await ready(page)
  await page.keyboard.press("Control+k")
  await expect(page.getByRole("option", { name: /Open the quick bar/ })).toContainText("Ctrl+Space")
  await expect(page.getByRole("option", { name: /Dictate/ })).toContainText("Ctrl+D")
  await expect(page.getByRole("option", { name: /Talk to Axe/ })).toContainText("Ctrl+Shift+T")
})

test("reduced motion: the bar and the orb only fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await open(page, "dark", "window=quick")
  const transform = await page.getByRole("dialog", { name: "Quick bar" }).evaluate((el) => getComputedStyle(el).transform)
  expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true)
})
