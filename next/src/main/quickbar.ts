import { join } from "node:path"
import { BrowserWindow, clipboard, desktopCapturer, globalShortcut, nativeTheme, screen, shell, systemPreferences } from "electron"

import type { Attachment, QuickCapture } from "@shared/types"

import * as attachments from "./attachments"
import { emit } from "./bus"
import { isSelfTest } from "./paths"
import { onSettingsChange, settings } from "./settings"
import { stayOnAppPage } from "./ipc"

// The quick bar: a small frameless window on a global shortcut (⌥Space on a Mac, Ctrl+Space
// elsewhere), Spotlight-like. It is made once and kept hidden, so it opens instantly. It hides when
// you click away, and while a dialog it opened is up it stays.

/** Panel width plus room for its shadow on each side. */
export const WIDTH = 750 + 2 * 32
const SHADOW = 32
const MIN_HEIGHT = 52 + 2 * SHADOW
const MAX_HEIGHT = 760

let win: BrowserWindow | undefined
let registered: string | null = null
let holding = 0
let mainWindow: () => BrowserWindow | undefined = () => undefined

const headless = () => !!process.env.AXE_HEADLESS

function create(): BrowserWindow {
  const linux = process.platform === "linux"
  const w = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    // Linux compositors often can't do transparent windows; there the panel fills the window.
    transparent: !linux,
    backgroundColor: linux ? (nativeTheme.shouldUseDarkColors ? "#1f1f1e" : "#ffffff") : "#00000000",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Kept warm while hidden, so it opens at once (and follows its content while hidden in tests).
      backgroundThrottling: false,
    },
  })
  // Above full-screen apps and on every Space, like Spotlight.
  w.setAlwaysOnTop(true, "floating")
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  // Keeps the bar out of its own screenshots ("Add my screen").
  w.setContentProtection(true)
  w.on("blur", () => {
    if (!holding && !headless()) w.hide()
  })
  stayOnAppPage(w.webContents)
  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#quick`)
  else void w.loadFile(join(import.meta.dirname, "../renderer/index.html"), { hash: "quick" })
  w.on("closed", () => {
    win = undefined
  })
  return w
}

/** Makes the window ahead of time (hidden). */
export function prepare(main: () => BrowserWindow | undefined) {
  mainWindow = main
  win ??= create()
  return win
}

export const quickWindow = () => win

export function show() {
  const w = (win ??= create())
  // Centred on the screen under the pointer, as the board has it, about a ninth of the way down.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const [, h] = w.getSize()
  w.setBounds({ x: Math.round(x + (width - WIDTH) / 2), y: Math.round(y + height * 0.107) - SHADOW, width: WIDTH, height: h ?? MIN_HEIGHT })
  if (!headless()) {
    w.show()
    w.focus()
  }
  emit("quickShown", { at: Date.now() })
}

export function hide() {
  win?.hide()
}

export function toggle() {
  if (win?.isVisible() && win.isFocused()) hide()
  else show()
}

export function resize(panelHeight: number) {
  if (!win || !Number.isFinite(panelHeight)) return
  const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, panelHeight + 2 * SHADOW)))
  const b = win.getBounds()
  if (b.height !== height) win.setBounds({ ...b, height })
}

/** Hands a chat the bar started to the main window, as a full chat. */
export function openInMain(threadId: string | null) {
  hide()
  const main = mainWindow()
  if (main && !headless()) {
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
  }
  if (threadId) emit("navigate", { threadId })
}

/** "Open" on a watch the bar started: the main window shows it. */
export function openWatchInMain(id: string) {
  openInMain(null)
  emit("openWatch", { id })
}

/** Keeps the bar up while something it opened (a folder picker) has focus. */
export async function holdOpen<T>(run: () => Promise<T>): Promise<T> {
  holding++
  try {
    return await run()
  } finally {
    holding--
    if (win?.isVisible() && !headless()) win.focus()
  }
}

/** The screen under the pointer, or what's on the clipboard, saved as an attachment. */
export async function capture(what: QuickCapture): Promise<Attachment | null> {
  if (what === "clipboard") {
    for (const item of await clipboard.read()) {
      const image = item.types.find((t) => t.startsWith("image/"))
      if (!image) continue
      const blob = (await item.getType(image)) as Blob
      const ext = image.split("/")[1]?.replace("jpeg", "jpg") ?? "png"
      return attachments.fromBytes(`Copied image.${ext}`, image, new Uint8Array(await blob.arrayBuffer()))
    }
    const text = (await clipboard.readText()).trim()
    if (!text) return null
    return attachments.fromBytes("Copied text.txt", "text/plain", new TextEncoder().encode(text))
  }
  if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") === "denied") {
    void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
    throw new Error("Allow Axe AI under Screen Recording in System Settings, then try again.")
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
  // The first call on a Mac is what asks for Screen Recording, just in time.
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error("Couldn't take a screenshot. Try again.")
  return attachments.fromBytes("Screen.png", "image/png", source.thumbnail.toPNG())
}

/**
 * Registers the global shortcut, replacing the last one. Self-tests never register one, so a test
 * run can't take ⌥Space from the apps you're using. Returns false when another app holds the key.
 */
export function useShortcut(accelerator: string): boolean {
  if (isSelfTest()) return true
  if (registered === accelerator && globalShortcut.isRegistered(accelerator)) return true
  const previous = registered
  if (previous) globalShortcut.unregister(previous)
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, toggle)
  } catch {
    ok = false
  }
  if (ok) registered = accelerator
  else if (previous) {
    // Keep the one that worked.
    try {
      if (globalShortcut.register(previous, toggle)) registered = previous
    } catch {}
  }
  return ok
}

export function startQuickBar(main: () => BrowserWindow | undefined) {
  prepare(main)
  useShortcut(settings().quickBarKey)
  onSettingsChange((next, previous) => {
    if (next.quickBarKey !== previous.quickBarKey) useShortcut(next.quickBarKey)
  })
}

export function stopQuickBar() {
  if (registered) globalShortcut.unregister(registered)
  registered = null
}
