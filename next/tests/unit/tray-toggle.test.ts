import { describe, expect, it } from "vitest"

import { ACTIVATE_AFTER_PRESS_MS, CLICK_AFTER_HIDE_MS, panelType, trayClick, trayLogic } from "../../src/main/tray-toggle"

describe("menu bar icon click", () => {
  it("closes an open panel", () => expect(trayClick(true, 10_000)).toBe("hide"))
  it("treats the click right after a blur-hide as the close", () => expect(trayClick(false, 40)).toBe("none"))
  it("opens a panel that was closed a while ago", () => expect(trayClick(false, CLICK_AFTER_HIDE_MS + 1)).toBe("show"))
})

describe("the panel window", () => {
  it("is a non-activating panel on the Mac, so showing it never activates Axe", () => expect(panelType("darwin")).toBe("panel"))
  it("is a normal window elsewhere", () => {
    expect(panelType("win32")).toBeUndefined()
    expect(panelType("linux")).toBeUndefined()
  })
})

// A fake clock and the same calls tray.ts makes: press (mouse-down), click, blur (hide), activate.
function setup() {
  let t = 10_000
  const logic = trayLogic(() => t)
  const wait = (ms: number) => (t += ms)
  const click = () => {
    const action = logic.click()
    if (action === "show") logic.shown()
    if (action === "hide") logic.hidden()
    return action
  }
  return { logic, wait, click }
}

describe("click, blur, click", () => {
  it("opens, then the second click only closes", () => {
    const { logic, wait, click } = setup()
    logic.press()
    expect(click()).toBe("show")
    wait(2000)
    logic.press()
    expect(click()).toBe("hide")
    expect(logic.visible).toBe(false)
  })

  it("closes once when the press blurs the panel before the click arrives", () => {
    const { logic, wait, click } = setup()
    expect(click()).toBe("show")
    wait(2000)
    logic.press()
    expect(logic.hidden()).toBe(true) // blur on mouse-down
    wait(80)
    expect(click()).toBe("none") // the click that already closed it, not a reopen
    expect(logic.visible).toBe(false)
  })

  it("opens again on a later click", () => {
    const { logic, wait, click } = setup()
    click()
    wait(1000)
    logic.hidden()
    wait(CLICK_AFTER_HIDE_MS + 50)
    expect(click()).toBe("show")
  })

  it("hiding twice counts once", () => {
    const { logic, click } = setup()
    click()
    expect(logic.hidden()).toBe(true)
    expect(logic.hidden()).toBe(false)
  })
})

describe("macOS activate around a click on the icon", () => {
  it("never shows the main window for activate during the open click", () => {
    const { logic, wait, click } = setup()
    logic.press()
    wait(20)
    expect(logic.activateShowsMain()).toBe(false)
    click()
    wait(30)
    expect(logic.activateShowsMain()).toBe(false)
  })

  it("never shows the main window for activate during the closing click", () => {
    const { logic, wait, click } = setup()
    click()
    wait(3000)
    logic.press()
    logic.hidden()
    wait(60)
    click()
    wait(100)
    expect(logic.activateShowsMain()).toBe(false)
  })

  it("shows it for a Dock click a moment later", () => {
    const { logic, wait, click } = setup()
    logic.press()
    click()
    wait(ACTIVATE_AFTER_PRESS_MS + 1)
    expect(logic.activateShowsMain()).toBe(true)
  })

  it("shows it when the icon was never pressed", () => expect(setup().logic.activateShowsMain()).toBe(true))
})
