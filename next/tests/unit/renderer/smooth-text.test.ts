// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { advance, useSmoothText, wholeWords } from "@/lib/smooth-text"

describe("smooth streaming", () => {
  it("catches up quickly when far behind and slows near the end", () => {
    const far = advance(0, 2_000, 16) - 0
    const near = advance(1_990, 2_000, 16) - 1_990
    expect(far).toBeGreaterThan(50)
    expect(near).toBeLessThan(1)
    expect(near).toBeGreaterThan(0)
  })

  it("never passes the text received", () => {
    expect(advance(95, 100, 1_000)).toBe(100)
    expect(advance(100, 100, 16)).toBe(100)
  })

  it("shows most of a big burst within a second", () => {
    let shown = 0
    for (let t = 0; t < 1_000; t += 16) shown = advance(shown, 3_000, 16)
    expect(shown).toBeGreaterThan(2_500)
  })

  it("shows whole words only", () => {
    const text = "Plan a relaxed week in Lisbon"
    expect(wholeWords(text, 9)).toBe("Plan a")
    expect(wholeWords(text, 6)).toBe("Plan a")
    expect(wholeWords(text, 3)).toBe("")
    expect(wholeWords(text, 100)).toBe(text)
  })
})

describe("useSmoothText", () => {
  // A frame clock we drive by hand: each step is one 16 ms frame.
  let now = 0
  let queued: FrameRequestCallback[] = []
  function frames(n: number) {
    for (let i = 0; i < n; i++) {
      now += 16
      const run = queued
      queued = []
      act(() => {
        for (const cb of run) cb(now)
      })
    }
  }
  beforeEach(() => {
    now = 0
    queued = []
    vi.spyOn(performance, "now").mockImplementation(() => now)
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queued.push(cb))
    vi.stubGlobal("cancelAnimationFrame", () => undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("turns one big burst into a steady flow of whole words", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ")
    const { result, rerender } = renderHook(({ text, streaming }) => useSmoothText(text, streaming), {
      initialProps: { text: "", streaming: true },
    })
    // The provider sends everything at once.
    rerender({ text: words, streaming: true })
    expect(result.current.text).toBe("")
    const seen: number[] = []
    for (let i = 0; i < 90; i++) {
      frames(1)
      seen.push(result.current.text.length)
    }
    // It grows a little almost every frame instead of jumping to the end…
    const steps = seen.filter((n, i) => n > (seen[i - 1] ?? 0)).length
    expect(steps).toBeGreaterThan(40)
    expect(Math.max(...seen.map((n, i) => n - (seen[i - 1] ?? 0)))).toBeLessThan(words.length / 4)
    // …only ever shows whole words, and finishes.
    for (const n of seen) expect(words.slice(0, n)).toMatch(/(^|\S)$/)
    frames(60)
    expect(result.current.text).toBe(words)
  })

  it("keeps flowing after the stream ends, then settles", () => {
    const { result, rerender } = renderHook(({ text, streaming }) => useSmoothText(text, streaming), {
      initialProps: { text: "", streaming: true },
    })
    rerender({ text: "one two three four five six seven eight nine ten", streaming: false })
    expect(result.current.settled).toBe(false)
    frames(120)
    expect(result.current).toEqual({
      text: "one two three four five six seven eight nine ten",
      settled: true,
    })
  })

  it("shows text that was already there at once", () => {
    const { result } = renderHook(() => useSmoothText("A finished answer.", false))
    expect(result.current).toEqual({ text: "A finished answer.", settled: true })
  })
})
