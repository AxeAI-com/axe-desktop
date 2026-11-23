import { describe, expect, it } from "vitest"

import { deviceName } from "../../src/main/remote/phones"

describe("deviceName", () => {
  it("names browsers saved as a phone before 2026-11-15 as browsers on a computer", () => {
    expect(deviceName({ name: "Ranger's phone", agent: "Chrome on phone" })).toEqual({
      name: "Chrome on Ranger's computer",
      agent: "Chrome on a computer",
    })
    expect(deviceName({ name: "phone", agent: "Safari on phone" })).toEqual({ name: "Safari on a computer", agent: "Safari on a computer" })
  })

  it("leaves real phones and newer names alone", () => {
    expect(deviceName({ name: "Ranger's iPhone", agent: "Safari on iPhone" })).toEqual({ name: "Ranger's iPhone", agent: "Safari on iPhone" })
    expect(deviceName({ name: "Chrome on Ranger's Mac", agent: "Chrome on Mac" })).toEqual({ name: "Chrome on Ranger's Mac", agent: "Chrome on Mac" })
  })
})
