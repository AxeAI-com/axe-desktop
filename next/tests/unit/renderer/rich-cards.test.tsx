// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { pickTicks, smoothPath } from "@/components/rich/Chart"
import { ChoicesCard } from "@/components/rich/Choices"
import { project } from "@/components/rich/MapCard"
import { RichFence } from "@/components/rich/RichBlock"
import { formatValue, niceStep, RichContext } from "@/components/rich/shared"
import { numberOf, sortRows, TableCard } from "@/components/rich/Table"

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

describe("numbers", () => {
  it("formats values short and long", () => {
    expect(formatValue(1234.5, "$")).toBe("$1,235")
    expect(formatValue(3.14159)).toBe("3.14")
    expect(formatValue(-42.25, "", "%")).toBe("−42.3%")
    expect(formatValue(1_250_000, "$", "", true)).toBe("$1.3M")
  })

  it("picks nice axis steps", () => {
    expect(niceStep(100)).toBe(25)
    expect(niceStep(7)).toBe(2)
    expect(niceStep(0.9)).toBe(0.25)
  })

  it("prints every x label when they fit, else evenly with both ends", () => {
    expect(pickTicks(4, 6)).toEqual([0, 1, 2, 3])
    expect(pickTicks(30, 4)).toEqual([0, 10, 20, 29])
    expect(pickTicks(12, 7)).toEqual([0, 2, 4, 6, 8, 11])
  })

  it("draws a smooth path through every point", () => {
    expect(smoothPath([[0, 10], [10, 0]])).toBe("M0 10 C5 10 5 0 10 0")
    expect(smoothPath([])).toBe("")
  })

  it("fits places into the map box, keeping their shape; one place sits in the middle", () => {
    const pts = project([{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }], 300, 200, 20)
    expect(pts[0]![0]).toBeCloseTo(20)
    expect(pts[1]![0]).toBeCloseTo(280)
    expect(pts[0]![1]).toBeCloseTo(100)
    expect(project([{ lat: 51.5, lon: -0.1 }], 300, 200)).toEqual([[150, 100]])
  })
})

describe("tables", () => {
  it("reads numbers out of money and percents", () => {
    expect(numberOf("$1,200")).toBe(1200)
    expect(numberOf("45%")).toBe(45)
    expect(numberOf("−3.5")).toBe(-3.5)
    expect(numberOf("Pro")).toBeUndefined()
  })

  it("sorts numbers by value, words naturally, blanks last", () => {
    const rows = [["b", "$20"], ["a10", ""], ["a2", "$3"]]
    expect(sortRows(rows, 1, -1).map((r) => r[0])).toEqual(["b", "a2", "a10"])
    expect(sortRows(rows, 0, 1).map((r) => r[0])).toEqual(["a2", "a10", "b"])
  })

  it("sorts when a column's name is clicked, and says so", () => {
    render(<TableCard table={{ kind: "table", columns: ["Plan", "Price"], rows: [["Plus", 10], ["Pro", 20], ["Starter", 5]] }} />)
    fireEvent.click(screen.getByRole("button", { name: "Price" }))
    expect(screen.getByRole("columnheader", { name: "Price" }).getAttribute("aria-sort")).toBe("descending")
    expect(screen.getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual(["Pro20", "Plus10", "Starter5"])
    fireEvent.click(screen.getByRole("button", { name: "Price" }))
    expect(screen.getAllByRole("row")[1]!.textContent).toBe("Starter5")
  })
})

describe("choices", () => {
  const choices = { kind: "choices" as const, question: "Who first?", options: [{ label: "Creators", recommended: true }, { label: "Teams", detail: "Many versions" }] }

  it("sends the picked option as the next message, by click or by number", () => {
    const choose = vi.fn()
    render(
      <RichContext.Provider value={{ canAnswer: true, choose }}>
        <ChoicesCard choices={choices} />
      </RichContext.Provider>,
    )
    expect(screen.getByText("Recommended")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Teams/ }))
    expect(choose).toHaveBeenLastCalledWith("Teams")
    fireEvent.keyDown(window, { key: "1" })
    expect(choose).toHaveBeenLastCalledWith("Creators")
    expect(screen.getByText("Press 1 or 2 to choose")).toBeTruthy()
  })

  it("shows the answer and locks once picked", () => {
    const choose = vi.fn()
    render(
      <RichContext.Provider value={{ canAnswer: true, answeredWith: "teams", choose }}>
        <ChoicesCard choices={choices} />
      </RichContext.Provider>,
    )
    const teams = screen.getByRole("button", { name: /Teams/ })
    expect(teams.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(teams)
    fireEvent.keyDown(window, { key: "1" })
    expect(choose).not.toHaveBeenCalled()
    expect(screen.queryByText(/to choose/)).toBeNull()
  })
})

describe("a block in a reply", () => {
  it("shows its outline while streaming, the card when done, and code when broken", () => {
    const { rerender } = render(<RichFence type="choices" lang="axe-choices" raw='{"options":["A"' closed={false} streaming />)
    expect(screen.getByRole("region", { name: "Writing your options" })).toBeTruthy()
    rerender(<RichFence type="choices" lang="axe-choices" raw='{"options":["A","B"]}' closed streaming={false} />)
    expect(screen.getByRole("region", { name: "Choose one" })).toBeTruthy()
    rerender(<RichFence type="choices" lang="axe-choices" raw='{"options":["A",' closed streaming={false} />)
    expect(screen.getByText("axe-choices")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy()
  })

  it("falls back to code when the reply ended inside the block", () => {
    render(<RichFence type="chart" lang="axe-chart" raw='{"type":"bar"' closed={false} streaming={false} />)
    expect(screen.getByText("axe-chart")).toBeTruthy()
  })
})
