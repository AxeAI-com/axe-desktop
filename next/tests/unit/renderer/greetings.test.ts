import { describe, expect, it } from "vitest"

import { dayPart, fill, GREETINGS, pickGreeting } from "@/lib/greetings"

describe("greetings", () => {
  it("has fifty short lines with no emoji or middle dots", () => {
    expect(GREETINGS).toHaveLength(50)
    expect(new Set(GREETINGS.map((g) => g.text)).size).toBe(50)
    for (const { text } of GREETINGS) {
      expect(text.length).toBeLessThanOrEqual(32)
      expect(text).not.toMatch(/·|\p{Extended_Pictographic}/u)
    }
  })

  it("puts in the first name, or drops it cleanly", () => {
    expect(fill("Welcome back, {name}", "Mia Lane")).toBe("Welcome back, Mia")
    expect(fill("Welcome back, {name}")).toBe("Welcome back")
    expect(fill("Early start, {name}?")).toBe("Early start?")
    expect(fill("Ask me anything", "Mia")).toBe("Ask me anything")
  })

  it("stays the same all through one part of the day", () => {
    const a = pickGreeting(new Date(2026, 9, 22, 19, 0), "Mia Lane")
    expect(pickGreeting(new Date(2026, 9, 22, 19, 59), "Mia Lane")).toBe(a)
    expect(pickGreeting(new Date(2026, 9, 22, 21, 30), "Mia Lane")).toBe(a)
  })

  it("only uses a time-of-day line at that time of day", () => {
    const at = (h: number) => new Date(2026, 9, 22, h)
    expect([dayPart(at(8)), dayPart(at(14)), dayPart(at(19)), dayPart(at(2))]).toEqual(["morning", "afternoon", "evening", "night"])
    for (let d = 1; d <= 60; d++) {
      for (const h of [8, 14, 19, 2]) {
        const now = new Date(2026, 9, d, h)
        const text = pickGreeting(now)
        const g = GREETINGS.find((x) => fill(x.text) === text)!
        expect(g).toBeDefined()
        if (g.when) expect(g.when).toBe(dayPart(now))
      }
    }
  })

  it("changes from day to day", () => {
    const days = new Set(Array.from({ length: 30 }, (_, d) => pickGreeting(new Date(2026, 9, d + 1, 10))))
    expect(days.size).toBeGreaterThan(10)
  })
})
