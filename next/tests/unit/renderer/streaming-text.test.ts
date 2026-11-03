import { describe, expect, it } from "vitest"

import { holdPartialTable } from "../../../src/renderer/src/lib/streaming-text"

describe("holdPartialTable", () => {
  it("holds a table back until its header and separator are complete", () => {
    expect(holdPartialTable("Intro\n\n| Step | Time | Tip |")).toBe("Intro")
    expect(holdPartialTable("Intro\n\n| Step | Time | Tip |\n| --- |")).toBe("Intro")
    expect(holdPartialTable("Intro\n\n| Step | Time | Tip |\n| --- | --- | --- |")).toBe("Intro")
    const ready = "Intro\n\n| Step | Time | Tip |\n| --- | --- | --- |\n| Look"
    expect(holdPartialTable(ready)).toBe(ready)
  })

  it("leaves text without a trailing table alone", () => {
    expect(holdPartialTable("Just words")).toBe("Just words")
    const done = "| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter"
    expect(holdPartialTable(done)).toBe(done)
  })
})

describe("dropThinkTags", () => {
  it("removes thinking written into the answer and stray tags", async () => {
    const { dropThinkTags } = await import("../../../src/renderer/src/lib/streaming-text")
    expect(dropThinkTags("<think>plan it</think>Lisbon by tram.")).toBe("Lisbon by tram.")
    expect(dropThinkTags("from morning to sunset. </think>")).toBe("from morning to sunset. ")
    expect(dropThinkTags("<think>still thinking")).toBe("")
    expect(dropThinkTags("a < b and b > c")).toBe("a < b and b > c")
  })
})
