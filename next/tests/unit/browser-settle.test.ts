import { beforeEach, describe, expect, it, vi } from "vitest"

// A fake page: clicks run instantly; the DOM-quiet wait takes 60 ms; a "navigating" page starts a load.
const page = vi.hoisted(() => ({ navigates: false, wc: undefined as undefined | { isLoading(): boolean } }))

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  class FakeContents extends EventEmitter {
    loading = false
    isLoading() {
      return this.loading
    }
    getURL() {
      return "http://localhost/page"
    }
    loadURL() {
      return Promise.resolve()
    }
    setWindowOpenHandler() {}
    session = { setPermissionRequestHandler() {} }
    executeJavaScript(script: string): Promise<unknown> {
      if (script.includes("scrollIntoView")) {
        if (page.navigates) {
          setTimeout(() => {
            this.loading = true
            this.emit("did-start-loading")
            setTimeout(() => {
              this.loading = false
              this.emit("did-stop-loading")
            }, 400)
          }, 10)
        }
        return Promise.resolve(true)
      }
      // The quiet wait: answers after 60 ms without mutations (a navigating page never answers).
      return page.navigates ? new Promise(() => {}) : new Promise((r) => setTimeout(() => r(true), 60))
    }
  }
  class BrowserWindow {
    webContents = new FakeContents()
    constructor() {
      page.wc = this.webContents
    }
    isDestroyed() {
      return false
    }
    isVisible() {
      return true
    }
    destroy() {}
  }
  return { BrowserWindow }
})

import { OwnBrowser } from "../../src/main/doit/browser"

describe("browser click settle", () => {
  beforeEach(() => {
    page.navigates = false
  })

  it("returns well under 500 ms when the click only changes the DOM", async () => {
    const b = new OwnBrowser()
    await b.open("http://localhost/")
    const t = Date.now()
    await b.click(1)
    expect(Date.now() - t).toBeLessThan(300)
  })

  it("still waits for the load when the click navigates", async () => {
    page.navigates = true
    const b = new OwnBrowser()
    await b.open("http://localhost/")
    const t = Date.now()
    await b.click(1)
    expect(Date.now() - t).toBeGreaterThanOrEqual(400)
    expect(page.wc!.isLoading()).toBe(false)
  })
})
