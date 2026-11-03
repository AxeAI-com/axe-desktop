import { BrowserWindow, ipcMain } from "electron"

import type { CommandName, Commands, EventName, Events } from "@shared/api"

type Handler<K extends CommandName> = (...args: Parameters<Commands[K]>) => ReturnType<Commands[K]> | Promise<Awaited<ReturnType<Commands[K]>>>

const handlers = new Map<CommandName, (...args: unknown[]) => unknown>()

/** Registers what a command does. Each engine module registers its own. */
export function handle<K extends CommandName>(command: K, fn: Handler<K>) {
  handlers.set(command, fn as (...args: unknown[]) => unknown)
}

/** Pushes an event to every window. */
export function emit<K extends EventName>(event: K, payload: Events[K]) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("axe:event", event, payload)
}

export function startIpc() {
  ipcMain.handle("axe:invoke", async (_e, command: CommandName, args: unknown[]) => {
    const fn = handlers.get(command)
    if (!fn) throw new Error(`No handler for ${command}`)
    return fn(...args)
  })
}
