import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App, QuickApp, TrayApp } from "./App"
import "./styles.css"

async function boot() {
  // Outside Electron (a plain browser, tests) there is no preload: stand in a fake engine.
  if (!window.axe) {
    const { installMockBridge } = await import("./lib/mock-bridge")
    installMockBridge()
  }
  // The quick bar's window loads the same page at #quick (?window=quick in a plain browser).
  const which = location.hash.slice(1) || new URLSearchParams(location.search).get("window")
  // The menu bar's chat loads at #tray, or #tray-glass where its window is system glass.
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      {which === "quick" ? <QuickApp /> : which === "tray" || which === "tray-glass" ? <TrayApp glass={which === "tray-glass"} /> : <App />}
    </StrictMode>,
  )
}

void boot()
