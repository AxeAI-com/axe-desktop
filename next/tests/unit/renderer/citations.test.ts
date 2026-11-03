import { describe, expect, it } from "vitest"

import { linkCitations } from "@/lib/citations"

const sources = [
  { id: "cb4ab4a1ba49", url: "https://www.timeout.com/lisbon", title: "Time Out" },
  { id: "5140c9596a24", url: "https://visitlisboa.com/x", title: "Visit Lisboa" },
]

describe("citations", () => {
  it("turns source ids into numbered chips", () => {
    expect(linkCitations("Sunset is best【cb4ab4a1ba49】.", sources, false)).toBe(
      'Sunset is best [1](https://www.timeout.com/lisbon "cite:1").',
    )
  })
  it("drops brackets that match no source", () => {
    expect(linkCitations("Old【ffffffffffff】 city", sources, false)).toBe("Old city")
  })
  it("hides an unfinished bracket while streaming", () => {
    expect(linkCitations("Quiet early【5140c95", sources, true)).toBe("Quiet early")
  })
  it("shows the same source twice in a row once", () => {
    expect(linkCitations("A【5140c9596a24】【5140c9596a24†L3】", sources, false)).toBe('A [2](https://visitlisboa.com/x "cite:2")')
  })
})
