import { describe, expect, it } from "vitest"

import { mustAsk } from "../../src/main/doit/guard"

describe("mustAsk", () => {
  it("Full access skips risky steps", () => {
    expect(mustAsk({ reason: "Send the email" }, true, true, new Set())).toBe(false)
    expect(mustAsk({ reason: "Send the email" }, false, true, new Set())).toBe(true)
  })

  it("asks for a protected folder once per chat, even in Full access", () => {
    const allowed = new Set<string>()
    const check = { reason: "Use your Documents folder", always: true }
    expect(mustAsk(check, true, false, allowed)).toBe(true)
    allowed.add(check.reason)
    expect(mustAsk(check, true, false, allowed)).toBe(false)
    expect(mustAsk({ reason: "Use your Desktop folder", always: true }, true, false, allowed)).toBe(true)
  })
})
