import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"

import type { UpdateState } from "@shared/types"

import { emit } from "../bus"
import { notify } from "../notify"
import { isSelfTest } from "../paths"
import { bundleOf } from "./mac"
import { UPDATE_FEED, UPDATE_PUBLIC_KEY } from "./sig"
import { cacheDirFor, type ElectronUpdater, supportReason, Updater } from "./updater"

// Wires the updater (updater.ts) to Electron. Self-tests point it at a local feed with their own key
// and a stand-in bundle to replace (AXE_UPDATE_FEED, AXE_UPDATE_PUBLIC_KEY, AXE_UPDATE_TARGET), so the
// whole path (check, signature, download, Restart to update, the swap) runs without the network.

let updater: Updater | undefined
let beforeInstall: () => void = () => {}

/** "deb" or "rpm" for Linux packages: electron-builder writes it next to the app. */
function packageType(): string | undefined {
  const file = join(process.resourcesPath ?? "", "package-type")
  try {
    return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined
  } catch {
    return undefined
  }
}

const readKey = (v: string) => (v.includes("BEGIN PUBLIC KEY") ? v : readFileSync(v, "utf8"))

export function startUpdates(onBeforeInstall: () => void) {
  beforeInstall = onBeforeInstall
  // Test hooks never apply to a packaged app, whatever its environment says.
  const test = isSelfTest() && !app.isPackaged && !!process.env.AXE_UPDATE_FEED
  const bundle = test ? process.env.AXE_UPDATE_TARGET : process.platform === "darwin" ? bundleOf(process.execPath) : undefined
  updater = new Updater({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    feed: test ? process.env.AXE_UPDATE_FEED! : UPDATE_FEED,
    publicKey: test && process.env.AXE_UPDATE_PUBLIC_KEY ? readKey(process.env.AXE_UPDATE_PUBLIC_KEY) : UPDATE_PUBLIC_KEY,
    cacheDir: cacheDirFor(app.getPath("userData")),
    bundle,
    unsupported: test ? undefined : supportReason({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE, packageType: packageType() }),
    onState: (s) => emit("update", s),
    // The first check after a launch puts in an update that downloaded earlier, before you start working.
    installCachedOnLaunch: app.isPackaged,
    onReady: (version) => notify({ threadId: "", kind: "done", title: "Axe AI update ready", body: `Version ${version} is ready. Restart Axe AI to update; it also updates the next time you open it.` }),
    quit: () => {
      beforeInstall()
      app.quit()
    },
    electronUpdater: async () => (await import("electron-updater")).autoUpdater as unknown as ElectronUpdater,
  })
  const first = Number(process.env.AXE_UPDATE_FIRST_CHECK_MS)
  updater.start(test && first >= 0 ? first : undefined)
  app.on("will-quit", () => updater?.installOnQuit())
}

export const updateState = (): UpdateState => updater?.current ?? { status: "idle" }
export const checkForUpdates = () => updater?.check() ?? Promise.resolve(updateState())
export function installUpdate() {
  if (process.platform !== "darwin") beforeInstall()
  updater?.install(!(isSelfTest() && !app.isPackaged && process.env.AXE_UPDATE_NO_RELAUNCH))
}
