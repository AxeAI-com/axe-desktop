import type { CommandName, Commands, EventName, Events } from "@shared/api"

/** Calls the engine. The window only ever talks to it through window.axe. */
export function invoke<K extends CommandName>(
  command: K,
  ...args: Parameters<Commands[K]>
): Promise<Awaited<ReturnType<Commands[K]>>> {
  return window.axe.invoke(command, ...args)
}

export function on<K extends EventName>(event: K, listener: (payload: Events[K]) => void): () => void {
  return window.axe.on(event, listener)
}

export function platform() {
  return window.axe?.platform ?? "darwin"
}

export const isMac = () => platform() === "darwin"

/** "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export const shortcut = (key: string) => (isMac() ? `⌘${key}` : `Ctrl+${key}`)

/** Where a dropped file is on disk, or "" (pasted screenshots, the mock engine). */
export const pathOf = (file: File) => window.axe?.pathOf?.(file) ?? ""

/** The menu bar's chat (#tray, #tray-glass; ?window=tray in a plain browser): a small window, so less chrome. */
export const inTrayWindow = () =>
  typeof location !== "undefined" && (location.hash.startsWith("#tray") || new URLSearchParams(location.search).get("window") === "tray")
