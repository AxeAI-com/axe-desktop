import { contextBridge, ipcRenderer, webUtils } from "electron"

import type { AxeBridge } from "@shared/api"

// The window's only door to the engine: named commands in, named events out.
// One Electron listener for every event; the window's subscriptions hang off it (dozens of them would
// each be an IPC listener otherwise, and Node warns past ten).
const listeners = new Map<string, Set<(payload: unknown) => void>>()
ipcRenderer.on("axe:event", (_, name: string, payload: unknown) => {
  for (const l of listeners.get(name) ?? []) l(payload)
})

const bridge: AxeBridge = {
  invoke: (command, ...args) => ipcRenderer.invoke("axe:invoke", command, args),
  on: (event, listener) => {
    const set = listeners.get(event) ?? new Set()
    const l = listener as (payload: unknown) => void
    set.add(l)
    listeners.set(event, set)
    return () => void set.delete(l)
  },
  platform: process.platform as AxeBridge["platform"],
  // Dropped files: where they are on disk ("" for a pasted screenshot, which has no path).
  pathOf: (file) => webUtils.getPathForFile(file),
  quiet: process.env.AXE_SELFTEST === "1" || !!process.env.AXE_SELFTEST_COOKIE,
}

contextBridge.exposeInMainWorld("axe", bridge)
