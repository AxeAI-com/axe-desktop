import { join } from "node:path"
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, shell, Tray, type Rectangle } from "electron"

import { emit } from "./bus"
import { handle, stayOnAppPage } from "./ipc"
import { isSelfTest } from "./paths"
import { panelType, trayLogic } from "./tray-toggle"

// Axe in the menu bar (the tray on Windows and Linux), from launch to quit. A click drops the chat
// out of the icon as a flat glass panel: your watches, recent chats and a one-line box to ask from;
// a chat opens in the panel itself, with the model you used last.

const WIDTH = 630
const HEIGHT = 720
const GAP = 6

let tray: Tray | undefined
let win: BrowserWindow | undefined
let mainWindow: () => void = () => {}
const logic = trayLogic()

const icon = (name: string) => nativeImage.createFromPath(join(import.meta.dirname, `../../resources/${name}.png`))

function image() {
  // The Mac tints a template image to match the menu bar, whatever the wallpaper.
  if (process.platform === "darwin") return icon("trayTemplate")
  return icon(nativeTheme.shouldUseDarkColors ? "tray-dark" : "tray-light")
}

function create(): BrowserWindow {
  const mac = process.platform === "darwin"
  const windows = process.platform === "win32"
  const w = new BrowserWindow({
    // The Mac: a non-activating panel, so opening and closing it never activates Axe or raises its main window.
    type: panelType(process.platform),
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Flat: no shadow, no border. Glass from the system where it has it, a plain panel elsewhere.
    hasShadow: false,
    ...(mac ? { vibrancy: "popover" as const, visualEffectState: "active" as const, backgroundColor: "#00000000", roundedCorners: true } : {}),
    ...(windows ? { backgroundMaterial: "acrylic" as const, backgroundColor: "#00000000" } : {}),
    ...(!mac && !windows ? { backgroundColor: nativeTheme.shouldUseDarkColors ? "#0c0f13" : "#ffffff" } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  w.setAlwaysOnTop(true, "pop-up-menu")
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.on("blur", () => {
    if (!process.env.AXE_HEADLESS) hide()
  })
  stayOnAppPage(w.webContents)
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })
  const hash = mac || windows ? "tray-glass" : "tray"
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void w.loadFile(join(import.meta.dirname, "../renderer/index.html"), { hash })
  w.on("closed", () => {
    win = undefined
  })
  return w
}

/** Under the icon (Mac, Linux top bars), or above it when the bar is at the bottom (Windows). */
export function placeUnder(icon: Rectangle, area: Rectangle, size = { width: WIDTH, height: HEIGHT }): { x: number; y: number } {
  const known = icon.width > 0 && icon.height > 0
  const cx = known ? icon.x + icon.width / 2 : area.x + area.width - size.width / 2 - GAP
  const x = Math.round(Math.min(area.x + area.width - size.width - GAP, Math.max(area.x + GAP, cx - size.width / 2)))
  const below = !known || icon.y < area.y + area.height / 2
  const y = below ? (known ? icon.y + icon.height + GAP : area.y + GAP) : icon.y - size.height - GAP
  return { x, y: Math.round(Math.max(area.y, y)) }
}

export function show() {
  const w = (win ??= create())
  const bounds = tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }
  const display = bounds.width ? screen.getDisplayMatching(bounds) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y } = placeUnder(bounds, display.workArea)
  w.setBounds({ x, y, width: WIDTH, height: HEIGHT })
  if (!process.env.AXE_HEADLESS) {
    w.show()
    w.focus()
  }
  logic.shown()
  emit("trayShown", { at: Date.now() })
}

// Only the panel hides. No app.hide(): Axe was never activated by the panel, so the app you were in still
// has focus, and hiding the whole app would bring a visible main window back with the next show.
export function hide() {
  if (!logic.hidden()) return
  win?.hide()
}

function toggle() {
  const action = logic.click()
  if (action === "hide") hide()
  else if (action === "show") show()
}

/** macOS `activate` (a Dock click): the main window comes up, unless it was a press on the icon just now. */
export function activateShowsMain() {
  return logic.activateShowsMain()
}

function menu() {
  return Menu.buildFromTemplate([
    { label: "Ask Axe", click: show },
    { label: "Open Axe AI", click: () => mainWindow() },
    { type: "separator" },
    { label: "Quit Axe AI", click: () => app.quit() },
  ])
}

function handlers() {
  handle("tray:hide", () => hide())
  handle("tray:openInMain", (threadId) => {
    hide()
    mainWindow()
    if (threadId) emit("navigate", { threadId })
  })
  handle("tray:open", (where) => {
    hide()
    mainWindow()
    if (where === "watching") emit("openWatching", {})
    else if (where === "settings") emit("openSettings", {})
    else emit("openWatch", { id: where.watch })
  })
}

export function startTray(showMain: () => void) {
  mainWindow = showMain
  if (isSelfTest() || process.env.AXE_HEADLESS) {
    // Self-tests get the panel without the icon: a hidden window they open and drive themselves.
    // __axeTrayClick runs the icon's own press and click handlers (tests/e2e/tray-toggle-run.mjs).
    if (isSelfTest()) {
      handlers()
      Object.assign(globalThis, {
        __axeShowTray: show,
        __axeTrayClick: () => {
          logic.press()
          toggle()
          return logic.visible
        },
      })
    }
    return
  }
  tray = new Tray(image())
  tray.setToolTip("Axe AI")
  if (process.platform === "linux") {
    // Many Linux bars only open a tray icon's menu, so the chat is its first item.
    tray.setContextMenu(menu())
  } else {
    tray.on("mouse-down", () => logic.press())
    tray.on("click", toggle)
    tray.on("right-click", () => {
      logic.press()
      tray?.popUpContextMenu(menu())
    })
  }
  nativeTheme.on("updated", () => tray?.setImage(image()))
  // Made ahead of time (hidden), so the first click opens at once.
  win = create()
  handlers()
}

export function stopTray() {
  tray?.destroy()
  tray = undefined
}
