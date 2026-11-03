import { describe, expect, it } from "vitest"

import { siteOf } from "../../src/renderer/src/lib/steps"

// The site a step is about, for its favicon in the thinking steps.
describe("siteOf", () => {
  it("reads a link", () => {
    expect(siteOf("Open page", '{"url":"https://www.axeai.com/pricing"}')).toBe("axeai.com")
  })

  it("reads a bare domain", () => {
    expect(siteOf("Opening github.com/anthropics/claude-code")).toBe("github.com")
    expect(siteOf("Searched docs.stripe.com")).toBe("docs.stripe.com")
  })

  it("leaves files, emails and plain words alone", () => {
    expect(siteOf("Read notes.md", "src/main/tray.ts")).toBeNull()
    expect(siteOf("Email mia@example.com")).toBeNull()
    expect(siteOf("Run the tests")).toBeNull()
  })
})
