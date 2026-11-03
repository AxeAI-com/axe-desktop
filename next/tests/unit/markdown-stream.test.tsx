// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const parsed: string[] = []
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    parsed.push(children)
    return <p>{children}</p>
  },
}))
vi.mock("remark-gfm", () => ({ default: () => {} }))
vi.mock("@/lib/bridge", () => ({ invoke: vi.fn() }))
vi.mock("@/components/ai/code-block", () => ({ CodeBlock: () => null }))
vi.mock("@/components/rich/RichBlock", () => ({ RichFence: () => null }))

import { Markdown, splitStable } from "@/components/Markdown"

afterEach(() => {
  cleanup()
  parsed.length = 0
})

describe("splitStable", () => {
  it("cuts at the last blank line outside a code fence", () => {
    const r = splitStable("One.\n\nTwo.\n\nThree grow")
    expect(r.done).toEqual(["One.\n\n", "Two.\n\n"])
    expect(r.tail).toBe("Three grow")
  })
  it("does not cut inside a fence", () => {
    const r = splitStable("Intro\n\n```js\na\n\nb\n```\n\nafter")
    expect(r.done.join("")).toBe("Intro\n\n```js\na\n\nb\n```\n\n")
    expect(r.tail).toBe("after")
  })
  it("keeps everything as the tail without a blank line", () => {
    expect(splitStable("just one line")).toEqual({ done: [], tail: "just one line" })
  })
})

describe("Markdown while streaming", () => {
  // Reduced motion: new text shows at once rather than flowing in over animation frames.
  beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: true })))
  afterEach(() => vi.unstubAllGlobals())
  it("does not parse a finished block again when the tail grows", () => {
    const { rerender } = render(<Markdown text={"First block.\n\nSecond"} streaming />)
    rerender(<Markdown text={"First block.\n\nSecond para"} streaming />)
    rerender(<Markdown text={"First block.\n\nSecond paragraph grows"} streaming />)
    expect(parsed.filter((t) => t.includes("First block.")).length).toBe(1)
    expect(parsed.filter((t) => t.startsWith("Second")).length).toBe(3)
  })
})
