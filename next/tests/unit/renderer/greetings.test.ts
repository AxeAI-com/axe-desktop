import { describe, expect, it } from "vitest"

import { dayPart, firstName, pickGreeting } from "@/lib/greetings"

describe("greetings", () => {
  const at = (h: number) => new Date(2026, 10, 8, h)

  it("splits the day into morning, afternoon and evening", () => {
    expect([4, 5, 11, 12, 16, 17, 23].map((h) => dayPart(at(h)))).toEqual(["evening", "morning", "morning", "afternoon", "afternoon", "evening", "evening"])
  })

  it("uses the first name, or none", () => {
    expect(pickGreeting(at(9), "Mia Lane")).toBe("Good morning, Mia")
    expect(pickGreeting(at(14))).toBe("Good afternoon")
    expect(pickGreeting(at(20), "  ")).toBe("Good evening")
    expect(pickGreeting(at(20), "ranger@example.com")).toBe("Good evening, Ranger")
  })

  it("capitalises the first name", () => {
    expect(firstName("jack ryan")).toBe("Jack")
    expect(firstName("")).toBeNull()
  })
})
