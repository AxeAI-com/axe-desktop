// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { StepGroup } from "@/components/StepGroup"
import type { StepPart } from "@/lib/steps"

beforeAll(() => {
  // jsdom has no matchMedia; motion asks it about reduced motion.
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
})

afterEach(cleanup)

const parts: StepPart[] = [
  { type: "reasoning", id: "r", text: "Look first.", done: true, seconds: 3 },
  { type: "tool", id: "a", title: "Read upload.test.ts", kind: "read", state: "done", input: "test/upload.test.ts" },
  { type: "tool", id: "b", title: "Read save.ts", kind: "read", state: "done", input: "src/uploads/save.ts" },
  { type: "tool", id: "c", title: "Ran the test 10 times", kind: "execute", state: "done", input: "pnpm test upload", output: "8 passed" },
]

describe("StepGroup", () => {
  it("folds finished steps into one line that opens the list", () => {
    render(<StepGroup parts={parts} live={false} />)
    const line = screen.getByRole("button", { name: /Read 2 files, ran 1 command/ })
    expect(line.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("pnpm test upload")).toBeNull()

    fireEvent.click(line)
    expect(line.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Thought for 3s")).toBeTruthy()
    // Two reads in a row are one row; it opens to the paths they read.
    fireEvent.click(screen.getByRole("button", { name: /^Read 2 files$/ }))
    expect(screen.getByText("test/upload.test.ts")).toBeTruthy()
    // The raw command and what it printed wait inside the step.
    expect(screen.queryByText("pnpm test upload")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^Ran the test 10 times/ }))
    expect(screen.getByText("pnpm test upload")).toBeTruthy()
    expect(screen.getByText("8 passed")).toBeTruthy()
  })

  it("names a raw shell step in plain English and keeps the command inside", () => {
    const cmd = `cd . && grep -rniE "unarchive|restore" src | head; echo done`
    render(<StepGroup parts={[{ type: "tool", id: "s", title: cmd, kind: "execute", state: "done" }]} live={false} cwd="/p" />)
    fireEvent.click(screen.getByRole("button", { name: "Ran 1 command" }))
    fireEvent.click(screen.getByRole("button", { name: /^Searched the code for ‘unarchive\|restore’/ }))
    expect(screen.getByText(cmd)).toBeTruthy()
  })

  it("shows one live line for the current step, and the seconds only after 10", () => {
    const live: StepPart[] = [...parts.slice(0, 2), { type: "tool", id: "d", title: "pnpm test", kind: "execute", state: "running" }]
    const { unmount } = render(<StepGroup parts={live} live startedAt={Date.now() - 4200} />)
    expect(screen.getByRole("status").textContent).toBe("Running the tests…")
    expect(screen.getByRole("button", { name: "Read 1 file" })).toBeTruthy()
    unmount()
    render(<StepGroup parts={live} live startedAt={Date.now() - 12200} />)
    expect(screen.getByText("12s")).toBeTruthy()
  })

  it("says it is waiting when a permission is pending", () => {
    const { container } = render(<StepGroup parts={parts} live waiting startedAt={Date.now()} />)
    expect(screen.getByText("Waiting for you")).toBeTruthy()
    expect(screen.queryByRole("status")).toBeNull()
    expect(container.querySelector(".steps-waiting")).toBeTruthy()
  })

  it("waiting on a card: no spinner on another step, and the asked step gives way to the card", () => {
    const work: StepPart[] = [
      { type: "tool", id: "w1", title: "Write src/cart.js", kind: "edit", state: "running", input: "src/cart.js" },
      { type: "tool", id: "w2", title: "Edit src/stock.js", kind: "edit", state: "running", input: "src/stock.js" },
    ]
    render(<StepGroup parts={work} live waiting compact cwd="/p" asked={["w1"]} />)
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByText("Write src/cart.js")).toBeNull()
    expect(screen.getByText("Editing stock.js")).toBeTruthy()
  })

  it("has nothing to open for thinking without words", () => {
    render(<StepGroup parts={[{ type: "reasoning", id: "r", text: "", done: true, seconds: 2 }]} live={false} />)
    expect(screen.getByText("Thought for 2s")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("relativeTo", () => {
  it("shows paths inside the chat's folder relative to it", async () => {
    const { relativeTo } = await import("@/components/StepGroup")
    const cwd = "/var/folders/9d/T/work"
    expect(relativeTo("Edit /private/var/folders/9d/T/work/notes.md", cwd)).toBe("Edit notes.md")
    expect(relativeTo("Read /var/folders/9d/T/work/src/a.ts", cwd)).toBe("Read src/a.ts")
    expect(relativeTo("ls /var/folders/9d/T/work", cwd)).toBe("ls .")
    expect(relativeTo("Read /etc/hosts", cwd)).toBe("Read /etc/hosts")
    expect(relativeTo("Read /x/notes.md", undefined)).toBe("Read /x/notes.md")
  })
})
