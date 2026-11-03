// The menu bar panel's open/close decisions, kept free of Electron so they can be unit tested.

/** How long after the panel hid a click on the icon still counts as the click that hid it. */
export const CLICK_AFTER_HIDE_MS = 250

/** How long after a press on the icon an `activate` from macOS is that press, not a Dock click. */
export const ACTIVATE_AFTER_PRESS_MS = 600

/**
 * A click on the menu bar icon. Pressing the icon can blur the panel, which already hid it, before the
 * click arrives: that click means close, not open again.
 */
export function trayClick(visible: boolean, msSinceHide: number): "hide" | "show" | "none" {
  if (visible) return "hide"
  return msSinceHide > CLICK_AFTER_HIDE_MS ? "show" : "none"
}

/**
 * The panel's window type. On the Mac it is a non-activating panel (NSWindowStyleMaskNonactivatingPanel):
 * Electron's show() and focus() then make it key without activating Axe. A normal window activates the
 * app, which raises every Axe window (the main one too) and, when the panel hides again, hands key to
 * the main window. With a panel Axe never becomes active, so the app you were in keeps focus.
 */
export function panelType(platform: NodeJS.Platform): "panel" | undefined {
  return platform === "darwin" ? "panel" : undefined
}

/**
 * The panel's state through presses, clicks, blurs and macOS `activate` events. One object, so the
 * whole click → blur → click sequence is one thing to test.
 */
export function trayLogic(now: () => number = Date.now) {
  let visible = false
  let hiddenAt = -Infinity
  let pressedAt = -Infinity
  return {
    get visible() {
      return visible
    },
    /** The icon was pressed (mouse-down), before its click. */
    press() {
      pressedAt = now()
    },
    /** The icon was clicked: what to do with the panel. */
    click(): "hide" | "show" | "none" {
      pressedAt = now()
      return trayClick(visible, now() - hiddenAt)
    },
    shown() {
      visible = true
    },
    hidden() {
      if (!visible) return false
      visible = false
      hiddenAt = now()
      return true
    },
    /**
     * macOS sent `activate` (applicationShouldHandleReopen): show the main window only when it came
     * from the Dock or Finder, not from a press on the menu bar icon a moment ago.
     */
    activateShowsMain(): boolean {
      return now() - pressedAt > ACTIVATE_AFTER_PRESS_MS
    },
  }
}
