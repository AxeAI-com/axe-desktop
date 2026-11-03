import { existsSync } from "node:fs"
import { join } from "node:path"

import type { UpdateState } from "@shared/types"

import { cannotInstall, downloadVerified, startInstall, unpack } from "./mac"
import { FEED_FILE, isNewer, macFile, parseFeed, type ReleaseInfo, type ReleasePlatform, releaseIsSigned } from "./sig"

// The app keeps itself current. Every six hours (and when you ask) it reads the feed for this system,
// and only when the release's signature is ours does anything download. On the Mac this file downloads
// and unpacks the zip itself (mac.ts); on Windows and Linux electron-updater downloads and installs the
// NSIS installer, AppImage or .deb, held to the signed SHA-512s. Once it's ready the window shows
// "Restart to update"; quitting installs it too. No Electron imports: index.ts passes what it needs.

export const UNSIGNED_UPDATE = "The update isn't signed by Axe AI, so it wasn't installed."
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000
export const FIRST_CHECK_MS = 10_000

/** The part of electron-updater's autoUpdater this uses (Windows and Linux). */
export type ElectronUpdater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableDifferentialDownload: boolean
  setFeedURL(options: { provider: "generic"; url: string }): void
  on(event: string, fn: (arg: never) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export type UpdaterOptions = {
  version: string
  platform: NodeJS.Platform
  arch: string
  feed: string
  publicKey?: string
  /** Where downloads wait (the Mac's zip and unpacked app). */
  cacheDir: string
  /** Mac: the bundle to replace. */
  bundle?: string
  /** Why this copy can't update itself (a dev build, a .deb we can't see, …), if it can't. */
  unsupported?: string
  onState: (s: UpdateState) => void
  /** Quits the app (after the Mac swap has started, or for electron-updater's own install). */
  quit: () => void
  pid?: number
  /** Mac: install at once when the update was already downloaded before this launch (a just-opened app). */
  installCachedOnLaunch?: boolean
  /** Says a version is ready (a notification), once per version. */
  onReady?: (version: string) => void
  fetch?: typeof fetch
  electronUpdater?: () => Promise<ElectronUpdater>
}

export class Updater {
  private state: UpdateState = { status: "idle" }
  private timer: ReturnType<typeof setInterval> | undefined
  private first: ReturnType<typeof setTimeout> | undefined
  /** Mac: the unpacked app waiting to go in. */
  private staged: string | undefined
  private installed = false
  private eu: ElectronUpdater | undefined
  private readonly target: ReleasePlatform

  constructor(private readonly o: UpdaterOptions) {
    this.target = o.platform === "darwin" ? "mac" : o.platform === "win32" ? "win" : "linux"
    const reason = o.unsupported ?? (this.target === "mac" && o.bundle ? cannotInstall(o.bundle) : undefined)
    if (reason) this.state = { status: "unsupported", reason }
  }

  get current() {
    return this.state
  }

  private set(next: UpdateState) {
    this.state = next
    this.o.onState(next)
  }

  /** Checks shortly after launch, then every six hours. */
  start(firstMs = FIRST_CHECK_MS, everyMs = UPDATE_INTERVAL_MS) {
    if (this.state.status === "unsupported") return
    this.first = setTimeout(() => void this.check(), firstMs)
    this.timer = setInterval(() => void this.check(), everyMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
  }

  async check(): Promise<UpdateState> {
    const s = this.state.status
    if (s === "unsupported" || s === "ready" || s === "downloading" || s === "checking") return this.state
    this.set({ status: "checking" })
    try {
      if (this.target === "mac") await this.checkMac()
      else await this.checkWithElectronUpdater()
    } catch (e) {
      if ((this.state as UpdateState).status !== "ready") this.set({ status: "error", message: plain(e) })
    }
    return this.state
  }

  private async feedInfo(): Promise<ReleaseInfo> {
    const res = await (this.o.fetch ?? fetch)(`${this.o.feed}/${FEED_FILE[this.target]}`, { headers: { "Cache-Control": "no-cache" } })
    if (!res.ok) throw new Error(res.status === 404 ? "No release is published for this system yet." : `Couldn't read the update feed (${res.status}).`)
    return parseFeed(await res.text())
  }

  private signed(info: ReleaseInfo) {
    return releaseIsSigned(this.target, info, { feed: this.o.feed, publicKey: this.o.publicKey, fetch: this.o.fetch })
  }

  private async checkMac() {
    const info = await this.feedInfo()
    if (!isNewer(info.version, this.o.version)) return this.set({ status: "idle", checkedAt: Date.now() })
    const file = macFile(info, this.o.arch)
    if (!file) throw new Error("There's no Mac build in this release.")
    if (!(await this.signed(info))) throw new Error(UNSIGNED_UPDATE)
    // Downloaded on an earlier run and never installed (the app is rarely quit on a Mac): this launch puts it in.
    const cached = existsSync(join(this.o.cacheDir, file.url.split("/").pop()!))
    this.set({ status: "downloading", version: info.version, percent: 0 })
    const zip = await downloadVerified(this.o.feed, file, this.o.cacheDir, (percent) => {
      if (this.state.status === "downloading" && this.state.percent !== percent) this.set({ ...this.state, percent })
    }, this.o.fetch)
    this.staged = await unpack(zip, info.version)
    this.set({ status: "ready", version: info.version })
    if (cached && this.o.installCachedOnLaunch) this.install(true)
    else this.o.onReady?.(info.version)
  }

  private async checkWithElectronUpdater() {
    const eu = await this.electronUpdater()
    await eu.checkForUpdates()
    // The rest arrives as events (wired once in electronUpdater()); no event means nothing new.
    if (this.state.status === "checking") this.set({ status: "idle", checkedAt: Date.now() })
  }

  private async electronUpdater(): Promise<ElectronUpdater> {
    if (this.eu) return this.eu
    if (!this.o.electronUpdater) throw new Error("Updates aren't set up on this system.")
    const eu = await this.o.electronUpdater()
    // Nothing downloads until the release signature is checked (below).
    eu.autoDownload = false
    // A differential download is rebuilt from blockmaps; take the whole file, held to the signed SHA-512.
    eu.disableDifferentialDownload = true
    eu.autoInstallOnAppQuit = true
    eu.setFeedURL({ provider: "generic", url: this.o.feed })
    eu.on("update-available", ((info: ReleaseInfo) => void this.verifiedDownload(info)) as (a: never) => void)
    eu.on("update-not-available", (() => this.set({ status: "idle", checkedAt: Date.now() })) as (a: never) => void)
    eu.on("download-progress", ((p: { percent: number }) => {
      if (this.state.status === "downloading") this.set({ ...this.state, percent: Math.round(p.percent) })
    }) as (a: never) => void)
    eu.on("update-downloaded", ((info: { version: string }) => {
      this.set({ status: "ready", version: info.version })
      this.o.onReady?.(info.version)
    }) as (a: never) => void)
    eu.on("error", ((e: unknown) => {
      if (this.state.status !== "ready") this.set({ status: "error", message: plain(e) })
    }) as (a: never) => void)
    this.eu = eu
    return eu
  }

  /** Windows and Linux: downloads `info` only if its release signature is ours. */
  private async verifiedDownload(info: ReleaseInfo) {
    if (this.state.status === "downloading" || this.state.status === "ready") return
    if (!isNewer(info.version, this.o.version)) return this.set({ status: "idle", checkedAt: Date.now() })
    this.set({ status: "downloading", version: info.version, percent: 0 })
    if (!(await this.signed(info))) return this.set({ status: "error", message: UNSIGNED_UPDATE })
    try {
      await this.eu!.downloadUpdate()
    } catch (e) {
      if ((this.state as UpdateState).status !== "ready") this.set({ status: "error", message: plain(e) })
    }
  }

  /** "Restart to update": installs the ready version and opens it again. */
  install(relaunch = true) {
    if (this.state.status !== "ready" || this.installed) return false
    this.installed = true
    this.stop()
    if (this.target === "mac") {
      startInstall({ dir: this.o.cacheDir, app: this.staged!, target: this.o.bundle!, pid: this.o.pid ?? process.pid, relaunch })
      this.o.quit()
    } else {
      // Silent on Windows (no installer window), then run the new version.
      this.eu?.quitAndInstall(true, relaunch)
    }
    return true
  }

  /** Quitting with an update ready installs it (Windows and Linux: electron-updater does this itself). */
  installOnQuit() {
    if (this.target === "mac" && this.state.status === "ready" && !this.installed) {
      this.installed = true
      startInstall({ dir: this.o.cacheDir, app: this.staged!, target: this.o.bundle!, pid: this.o.pid ?? process.pid, relaunch: false })
    }
  }
}

/** Can this copy update itself on Windows and Linux? The installer, the AppImage and the .deb can. */
export function supportReason(o: { packaged: boolean; platform: string; appImage?: string; packageType?: string }): string | undefined {
  if (!o.packaged) return "This is a development build, so it doesn't update itself."
  if (o.platform === "darwin" || o.platform === "win32") return undefined
  if (o.appImage) return undefined
  if (o.packageType === "deb" || o.packageType === "rpm") return undefined
  return "This copy wasn't installed from the AppImage or the .deb, so it can't update itself."
}

export const cacheDirFor = (userData: string) => join(userData, "updates")

export function plain(e: unknown): string {
  const m = String((e as Error)?.message ?? e)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|net::/i.test(m)) return "Couldn't reach axeai.com to check for updates."
  return (m.split("\n")[0] ?? m).slice(0, 200)
}
