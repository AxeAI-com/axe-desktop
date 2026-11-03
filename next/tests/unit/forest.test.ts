import { describe, expect, it } from "vitest"

import { forestScene } from "@/components/Forest"

// The fox's forest: the same scene for the same size, filling it, with the fox on the grass.

const text = (g: ReturnType<typeof forestScene>) => g.map((r) => r.map((c) => c?.ch ?? " ").join("")).join("\n")

describe("forest", () => {
  it("fills the grid and is the same each time", () => {
    const a = forestScene(120, 40)
    expect(a).toHaveLength(40)
    expect(a.every((r) => r.length === 120)).toBe(true)
    expect(text(a)).toBe(text(forestScene(120, 40)))
  })

  it("has the moon, pines and the fox sitting on the grass", () => {
    const g = forestScene(120, 40)
    const inks = new Set(g.flat().map((c) => c?.ink))
    for (const ink of ["star", "moon", "ridge", "far", "near", "ground", "fox"]) expect(inks.has(ink as never)).toBe(true)
    const foxRows = g.map((r, i) => (r.some((c) => c?.ink === "fox") ? i : -1)).filter((i) => i >= 0)
    expect(Math.max(...foxRows)).toBe(40 - 2)
  })

  it("copes with a tiny pane", () => {
    expect(() => forestScene(8, 4)).not.toThrow()
  })
})
