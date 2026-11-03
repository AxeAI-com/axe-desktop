import { join, resolve } from "node:path"
import { appendFileSync } from "node:fs"
import { app, BrowserWindow, Menu, nativeTheme, Notification, screen, shell } from "electron"

import { configureAccount, handleCallback, PROTOCOL } from "./axe/account"
import { setEmitter } from "./bus"
import { shutdown } from "./chat"
import { applyTheme, registerCommands } from "./commands"
import { emit, startIpc } from "./ipc"
import { createNotifier, setNotifier } from "./notify"
import { hub } from "./libraries"
import { isSelfTest, setDataDir } from "./paths"
import { startQuickBar, stopQuickBar, toggle as toggleQuickBar } from "./quickbar"
import { safeTokenStore } from "./secrets"
import { settings } from "./settings"
import { startUpdates } from "./updates"
import { keepAlive, startRemote, stopRemote } from "./remote"
import { startWatching, watchAct, stopWatching } from "./watching"
import { SUMMARY_THREAD } from "./watching/notify"
import { startOllama, stopOllama } from "./local-models"
import { activateShowsMain, startTray, stopTray } from "./tray"
import { allowOwnMicrophone } from "./voice"

// Development runs as "Axe AI Dev": its own Keychain item and menu name, apart from the installed app.
if (!app.isPackaged) app.setName("Axe AI Dev")

// The engine's files live in userData (AXE_DATA_DIR overrides it for self-tests).
setDataDir(app.getPath("userData"))
setEmitter(emit)

// One copy of the app: sign-in links reach the running one.
if (!isSelfTest() && !app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// axedesktop:// opens this app. During development Electron needs the script path too.
// Self-tests sign in without the browser, so they leave the system's handler alone.
if (!isSelfTest()) {
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
  else app.setAsDefaultProtocolClient(PROTOCOL)
}

// The chat window. Axe's own browser (doit/browser.ts) and the quick bar are other windows, never this one.
let mainWindow: BrowserWindow | undefined

function showMain() {
  // Closed while chats or watches ran in the background (Windows and Linux): open it again.
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : app.isReady() ? createWindow() : undefined
  if (!win) return
  // Self-tests count the times it was asked for (tests/e2e/tray-toggle-run.mjs); headless ones never put it on screen.
  if (isSelfTest()) Object.assign(globalThis, { __axeMainShows: ((globalThis as { __axeMainShows?: number }).__axeMainShows ?? 0) + 1 })
  if (process.env.AXE_HEADLESS) return
  if (win.isMinimized()) win.restore()
  win.show()
  // macOS keeps the app behind the browser (after sign-in) unless the app itself comes forward.
  if (process.platform === "darwin") app.focus({ steal: true })
  win.focus()
}

function handleLink(url: string | undefined) {
  if (!url?.startsWith(`${PROTOCOL}://`)) return
  handleCallback(url)
  showMain()
}

// Windows and Linux start a second copy with the link in argv; macOS sends open-url.
app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`))
  if (link) handleLink(link)
  else showMain()
})
app.on("open-url", (e, url) => {
  e.preventDefault()
  handleLink(url)
})

/** 1440 × 900, or less so the whole window (the message box at its bottom too) fits the screen it opens on. */
export function windowSize(workArea: { width: number; height: number }) {
  return {
    width: Math.max(900, Math.min(1440, workArea.width - 80)),
    height: Math.max(560, Math.min(900, workArea.height - 40)),
  }
}

/** AXE_DEMO_BOUNDS="x,y,width,height": demo recordings put the window there (a virtual screen) and never focus it. */
export function demoBounds(value = process.env.AXE_DEMO_BOUNDS) {
  const n = value?.split(",").map(Number)
  if (!n || n.length !== 4 || n.some((v) => !Number.isFinite(v))) return undefined
  return { x: n[0], y: n[1], width: n[2], height: n[3] }
}

function createWindow() {
  const mac = process.platform === "darwin"
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const size = windowSize(area)
  const demo = demoBounds()
  const win = new BrowserWindow({
    ...size,
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + (area.height - size.height) / 2),
    ...demo,
    minWidth: 900,
    minHeight: 560,
    // Windows and Linux show this in the taskbar; the Mac uses the app bundle's icon.
    icon: join(import.meta.dirname, "../../resources/icon.png"),
    show: false,
    // Mac: warm glass behind the sidebar (the renderer paints the main column solid); elsewhere solid dark.
    ...(mac ? { vibrancy: "under-window" as const, visualEffectState: "active" as const, backgroundColor: "#00000000" } : { backgroundColor: nativeTheme.shouldUseDarkColors ? "#151517" : "#fafaf9" }),
    // Mac: the traffic lights sit inside the sidebar's top row, like the board.
    titleBarStyle: mac ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 20, y: 26 },
    titleBarOverlay: mac ? false : { color: "#00000000", symbolColor: "#898781", height: 48 },
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A demo window is never in front, so it must keep painting at full speed.
      backgroundThrottling: !demo,
    },
  })
  // AXE_HEADLESS: self-tests drive the window without putting it on screen.
  if (!process.env.AXE_HEADLESS) win.once("ready-to-show", () => (demo ? win.showInactive() : win.show()))
  // Right-click: Copy on selected text, Cut, Copy and Paste in a field.
  win.webContents.on("context-menu", (_e, p) => {
    const items: Electron.MenuItemConstructorOptions[] = p.isEditable
      ? [{ role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy }, { role: "paste", enabled: p.editFlags.canPaste }, { type: "separator" }, { role: "selectAll" }]
      : p.selectionText.trim()
        ? [{ role: "copy" }]
        : []
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"))
  mainWindow = win
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = undefined
    // Closing the chat window on Windows and Linux quits: the hidden quick bar and Axe's browser
    // window would otherwise keep the app running with no way back to it. While a chat works or a
    // watch waits for its next check, it stays in the tray instead (remote/index.ts).
    if (process.platform !== "darwin" && !keepAlive()) app.quit()
  })
  return win
}

// Notifications while the window isn't in front. Self-tests write them to AXE_NOTIFY_LOG
// instead of putting them on screen, and count every window as unfocused.
const shown = new Set<Notification>()
setNotifier(
  createNotifier({
    focused: () => !process.env.AXE_NOTIFY_LOG && BrowserWindow.getAllWindows().some((w) => w.isFocused()),
    supported: () => !!process.env.AXE_NOTIFY_LOG || Notification.isSupported(),
    show: (n, onClick, onAction) => {
      if (process.env.AXE_NOTIFY_LOG) {
        appendFileSync(process.env.AXE_NOTIFY_LOG, `${JSON.stringify(n)}\n`)
        return
      }
      // Test runs start inside the stock Electron app, so a real notification would come from "Electron"
      // with Electron's icon and land in the user's Notification Centre. They stay quiet.
      if (isSelfTest()) return
      // A watch's problem offers its own buttons (macOS shows them on hover).
      const actions = n.actions ?? []
      const note = new Notification({
        title: n.title,
        body: n.body,
        silent: !!n.silent,
        ...(onAction && actions.length ? { actions: actions.map((a) => ({ type: "button" as const, text: a.text })) } : {}),
      })
      shown.add(note)
      note.on("click", () => {
        shown.delete(note)
        onClick()
      })
      note.on("action", (_e, index) => {
        shown.delete(note)
        const a = actions[index]
        if (a && onAction) onAction(a.id)
        else onClick()
      })
      note.on("close", () => shown.delete(note))
      note.show()
    },
    open: (threadId) => {
      showMain()
      if (!threadId) return /* an app notice (an update): bringing the window up is enough */
      if (threadId === SUMMARY_THREAD) emit("openWatching", {})
      else if (threadId.startsWith("watch:")) emit("openWatch", { id: threadId.slice(6) })
      else emit("openThread", { threadId })
    },
    fix: (findingId, threadId) => {
      showMain()
      emit("openWatch", { id: threadId.slice(6), fix: findingId })
    },
    snooze: (findingId, threadId) => void watchAct(threadId.slice(6), findingId, "snooze1h"),
  }),
)

void app.whenReady().then(() => {
  // safeStorage can only decrypt the saved session once the app is ready.
  configureAccount({ store: safeTokenStore, openExternal: (url) => void shell.openExternal(url) })
  applyTheme(settings().theme)
  allowOwnMicrophone()
  registerCommands()
  startWatching()
  startRemote({ showMain })
  startIpc()
  startUpdates(() => {})
  // Dev runs: the rounded icon release builds get from resources/icon.icon (the square one looks wrong).
  if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, "../../resources/icon-mac.png"))
  createWindow()
  startQuickBar(() => mainWindow)
  startTray(showMain)
  // "Start Ollama when Axe opens" (Settings): quietly, and only when it's here and not running.
  if (settings().startOllama) void startOllama().catch(() => {})
  // Self-tests open the bar the way the shortcut would (they never register one).
  if (isSelfTest()) Object.assign(globalThis, { __axeToggleQuickBar: toggleQuickBar })
  app.on("activate", () => {
    // A press on the menu bar icon is not a Dock click: the panel alone answers it.
    if (!activateShowsMain()) return
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    else showMain()
  })
})

app.on("before-quit", () => {
  stopTray()
  stopRemote()
  stopWatching()
  shutdown()
  // Only an Ollama Axe started; one you started keeps running.
  stopOllama()
  void hub().closeAll()
  void import("./terminal").then((m) => m.closeAll())
  // Do it's browser window, the Mac hands helper and the MCP server, if they were started.
  void import("./doit/browser").then((m) => m.browser.close())
  void import("./doit/computer").then((m) => m.hands.stop())
  void import("./doit/mcp").then((m) => m.stop())
})
app.on("will-quit", () => stopQuickBar())

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !keepAlive()) app.quit()
})
