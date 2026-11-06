import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { BrowserWindow, ipcMain, type WebContents } from "electron"

import type { CommandName, Commands, EventName, Events } from "@shared/api"

type Handler<K extends CommandName> = (...args: Parameters<Commands[K]>) => ReturnType<Commands[K]> | Promise<Awaited<ReturnType<Commands[K]>>>

const handlers = new Map<CommandName, (...args: unknown[]) => unknown>()

// The app's own page: the only document allowed to call the engine (main window, tray and quick bar
// all load it, with a #hash). Any other page that ended up in one of those windows gets nothing.
const APP_PAGE = pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href

/** Is this the app's own page, in the top frame? The dev server counts during development. */
export function trustedPage(url: string | undefined, topFrame: boolean, page = APP_PAGE, devURL = process.env.ELECTRON_RENDERER_URL): boolean {
  if (!topFrame || !url) return false
  if (url.split(/[?#]/)[0] === page) return true
  if (!devURL) return false
  try {
    return new URL(url).origin === new URL(devURL).origin
  } catch {
    return false
  }
}

/** Keeps a window that holds the bridge on the app's own page: it never navigates anywhere else. */
export function stayOnAppPage(wc: WebContents) {
  wc.on("will-navigate", (e, url) => {
    if (!trustedPage(url, true)) e.preventDefault()
  })
}

/** Registers what a command does. Each engine module registers its own. */
export function handle<K extends CommandName>(command: K, fn: Handler<K>) {
  handlers.set(command, fn as (...args: unknown[]) => unknown)
}

/** Pushes an event to every window. */
export function emit<K extends EventName>(event: K, payload: Events[K]) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("axe:event", event, payload)
}

export function startIpc() {
  ipcMain.handle("axe:invoke", async (e, command: CommandName, args: unknown[]) => {
    const frame = e.senderFrame
    if (!trustedPage(frame?.url, !!frame && frame.parent === null)) throw new Error("Not allowed.")
    const fn = handlers.get(command)
    if (!fn) throw new Error(`No handler for ${command}`)
    return fn(...args)
  })
}
