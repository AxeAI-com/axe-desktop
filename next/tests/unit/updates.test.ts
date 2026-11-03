import { execFileSync } from "node:child_process"
import { createHash, generateKeyPairSync } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { UpdateState } from "@shared/types"

import { cannotInstall, startInstall } from "../../src/main/updates/mac"
import { isNewer, macFile, parseFeed, releaseStatement, signatureFileName, signRelease, UPDATE_PUBLIC_KEY, verifyRelease } from "../../src/main/updates/sig"
import { type ElectronUpdater, supportReason, UNSIGNED_UPDATE, Updater, type UpdaterOptions } from "../../src/main/updates/updater"

// Updates (package H): versions, release signatures, and the whole Mac path against a local feed
// (a temp HTTP server with a fake latest-mac.yml, a zipped stand-in app and its signature), down to the
// swap after "Restart to update". No network, no real app replaced.

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  return { pub: publicKey.export({ type: "spki", format: "pem" }).toString(), priv: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }
}

describe("versions", () => {
  it("compares like semver", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true)
    expect(isNewer("0.1.10", "0.1.9")).toBe(true)
    expect(isNewer("1.0.0", "0.9.9")).toBe(true)
    expect(isNewer("0.1.0", "0.1.0")).toBe(false)
    expect(isNewer("0.1.0", "0.2.0")).toBe(false)
    expect(isNewer("0.2.0", "0.2.0-beta.3")).toBe(true)
    expect(isNewer("0.2.0-beta.3", "0.2.0")).toBe(false)
    expect(isNewer("0.2.0-beta.10", "0.2.0-beta.9")).toBe(true)
    expect(isNewer("garbage", "0.1.0")).toBe(false)
  })

  it("picks the Mac zip for this chip", () => {
    const info = { version: "0.2.0", files: [
      { url: "Axe-AI-0.2.0-arm64-mac.zip", sha512: "a" },
      { url: "Axe-AI-0.2.0-mac.zip", sha512: "b" },
      { url: "Axe-AI-0.2.0-arm64.dmg", sha512: "c" },
    ] }
    expect(macFile(info, "arm64")?.url).toBe("Axe-AI-0.2.0-arm64-mac.zip")
    expect(macFile(info, "x64")?.url).toBe("Axe-AI-0.2.0-mac.zip")
    expect(macFile({ version: "0.2.0", files: [{ url: "Axe-AI-0.2.0-universal-mac.zip", sha512: "u" }] }, "x64")?.url).toBe("Axe-AI-0.2.0-universal-mac.zip")
  })

  it("says why a copy can't update itself", () => {
    expect(supportReason({ packaged: false, platform: "darwin" })).toMatch(/development build/)
    expect(supportReason({ packaged: true, platform: "win32" })).toBeUndefined()
    expect(supportReason({ packaged: true, platform: "linux", appImage: "/x.AppImage" })).toBeUndefined()
    expect(supportReason({ packaged: true, platform: "linux", packageType: "deb" })).toBeUndefined()
    expect(supportReason({ packaged: true, platform: "linux" })).toMatch(/AppImage or the \.deb/)
    expect(cannotInstall("/Volumes/Axe AI/Axe AI.app")).toMatch(/Applications/)
    expect(cannotInstall("/private/var/folders/x/AppTranslocation/y/Axe AI.app")).toMatch(/Applications/)
  })
})

describe("release signatures", () => {
  const yml = `version: 0.2.0
files:
  - url: Axe-AI-0.2.0-arm64-mac.zip
    sha512: AAAA==
    size: 120
  - url: Axe-AI-0.2.0-mac.zip
    sha512: BBBB==
    size: 130
path: Axe-AI-0.2.0-arm64-mac.zip
sha512: AAAA==
`
  const info = parseFeed(yml)
  const k = keys()

  it("reads electron-builder's feed", () => {
    expect(info).toEqual({ version: "0.2.0", files: [{ url: "Axe-AI-0.2.0-arm64-mac.zip", sha512: "AAAA==", size: 120 }, { url: "Axe-AI-0.2.0-mac.zip", sha512: "BBBB==", size: 130 }] })
    expect(signatureFileName("mac", "0.2.0")).toBe("Axe-AI-0.2.0-mac.sig")
    expect(signatureFileName("mac", "../x")).toBeUndefined()
  })

  it("accepts our signature and nothing else", () => {
    const sig = signRelease("mac", info, k.priv)
    expect(verifyRelease("mac", info, sig, k.pub)).toBe(true)
    expect(verifyRelease("win", info, sig, k.pub)).toBe(false)
    expect(verifyRelease("mac", { ...info, version: "0.2.1" }, sig, k.pub)).toBe(false)
    expect(verifyRelease("mac", { ...info, files: [{ url: "Axe-AI-0.2.0-arm64-mac.zip", sha512: "EVIL==" }, info.files![1]!] }, sig, k.pub)).toBe(false)
    expect(verifyRelease("mac", info, sig, keys().pub)).toBe(false)
    expect(verifyRelease("mac", info, "not base64 at all")).toBe(false)
    // The app's own key is a real Ed25519 public key.
    expect(verifyRelease("mac", info, sig, UPDATE_PUBLIC_KEY)).toBe(false)
  })

  it("can't be passed off as an old Axe Imperium release", () => {
    expect(releaseStatement("mac", info)).toMatch(/^axe-desktop-release v1\n/)
  })
})

// ---------- The Mac path, end to end on a local feed ----------

const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-updates-")))
const feedDir = join(root, "feed")
const k = keys()
let server: Server
let feed = ""
const served: string[] = []

/** A stand-in Axe AI.app: just an Info.plist with an id and a version. */
function fakeApp(dir: string, version: string, id = "com.axeai.desktop") {
  const app = join(dir, "Axe AI.app")
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true })
  writeFileSync(
    join(app, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`,
  )
  writeFileSync(join(app, "Contents/MacOS/Axe AI"), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
  return app
}

const version = (app: string) => execFileSync("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", join(app, "Contents/Info.plist")]).toString().trim()

/** Publishes a release into the feed folder, like the release build does. */
function publish(v: string, o: { id?: string; sign?: boolean; corrupt?: boolean } = {}) {
  const build = mkdtempSync(join(root, "build-"))
  fakeApp(build, v, o.id)
  const zip = `Axe-AI-${v}-${process.arch === "arm64" ? "arm64-" : ""}mac.zip`
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", join(build, "Axe AI.app"), join(feedDir, zip)])
  const bytes = readFileSync(join(feedDir, zip))
  const sha512 = createHash("sha512").update(bytes).digest("base64")
  if (o.corrupt) writeFileSync(join(feedDir, zip), Buffer.concat([bytes, Buffer.from("tampered")]))
  writeFileSync(join(feedDir, "latest-mac.yml"), `version: ${v}\nfiles:\n  - url: ${zip}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${zip}\nsha512: ${sha512}\nreleaseDate: '2026-10-23T10:00:00.000Z'\n`)
  const sig = join(feedDir, `Axe-AI-${v}-mac.sig`)
  if (o.sign !== false) writeFileSync(sig, signRelease("mac", parseFeed(readFileSync(join(feedDir, "latest-mac.yml"), "utf8")), k.priv))
  else if (existsSync(sig)) writeFileSync(sig, "")
  return zip
}

function macUpdater(name: string, current = "0.1.0", extra: Partial<UpdaterOptions> = {}) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const target = existsSync(join(dir, "Axe AI.app")) ? join(dir, "Axe AI.app") : fakeApp(dir, current)
  const states: UpdateState[] = []
  let quit = 0
  const u = new Updater({
    version: current,
    platform: "darwin",
    arch: process.arch,
    feed,
    publicKey: k.pub,
    cacheDir: join(dir, "cache"),
    bundle: target,
    onState: (s) => states.push(s),
    quit: () => quit++,
    // A process that has already exited, so the swap starts at once.
    pid: 999_999,
    ...extra,
  })
  return { u, target, states, quits: () => quit, cache: join(dir, "cache") }
}

async function waitFor(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe.runIf(process.platform === "darwin")("Mac updates on a local feed", () => {
  beforeAll(async () => {
    mkdirSync(feedDir, { recursive: true })
    server = createServer((req, res) => {
      const name = decodeURIComponent((req.url ?? "/").split("?")[0]!.slice(1))
      served.push(name)
      const path = join(feedDir, name)
      if (!name || name.includes("..") || !existsSync(path)) return void res.writeHead(404).end()
      const body = readFileSync(path)
      res.writeHead(200, { "Content-Length": body.length }).end(body)
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    feed = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => server?.close())

  it("finds nothing new when the feed has this version", async () => {
    publish("0.1.0")
    const { u, states } = macUpdater("same")
    expect((await u.check()).status).toBe("idle")
    expect(states.map((s) => s.status)).toEqual(["checking", "idle"])
  })

  it("downloads, checks and installs a signed release on Restart to update", async () => {
    const zip = publish("0.2.0")
    served.length = 0
    const { u, target, states, quits, cache } = macUpdater("signed")
    const s = await u.check()
    expect(s).toEqual({ status: "ready", version: "0.2.0" })
    expect(states[0]).toEqual({ status: "checking" })
    expect(states.some((x) => x.status === "downloading" && x.percent === 100)).toBe(true)
    // The signature was read before the build.
    expect(served.indexOf("Axe-AI-0.2.0-mac.sig")).toBeLessThan(served.indexOf(zip))
    // Checking again doesn't download again.
    expect((await u.check()).status).toBe("ready")
    expect(version(target)).toBe("0.1.0")

    expect(u.install(false)).toBe(true)
    expect(quits()).toBe(1)
    await waitFor(() => version(target) === "0.2.0")
    expect(existsSync(`${target}.old`)).toBe(false)
    expect(existsSync(`${target}.new`)).toBe(false)
    expect(readFileSync(join(cache, "install.log"), "utf8")).toBe("")
    // A second press does nothing.
    expect(u.install(false)).toBe(false)
  })

  it("refuses a release that isn't signed by us, before downloading it", async () => {
    const zip = publish("0.3.0", { sign: false })
    served.length = 0
    const { u, target } = macUpdater("unsigned")
    expect(await u.check()).toEqual({ status: "error", message: UNSIGNED_UPDATE })
    expect(served).not.toContain(zip)
    expect(version(target)).toBe("0.1.0")
    expect(u.install(false)).toBe(false)
  })

  it("throws away a download that doesn't match the signed fingerprint", async () => {
    const zip = publish("0.4.0", { corrupt: true })
    const { u, cache } = macUpdater("corrupt")
    expect(await u.check()).toEqual({ status: "error", message: "The download didn't match the release, so it was thrown away." })
    expect(existsSync(join(cache, zip))).toBe(false)
  })

  it("won't install another app, even signed", async () => {
    publish("0.5.0", { id: "com.example.other" })
    const { u } = macUpdater("other")
    expect(await u.check()).toEqual({ status: "error", message: "The update isn't Axe AI." })
  })

  it("never swaps the app while it is still running", async () => {
    const dir = mkdtempSync(join(root, "busy-"))
    const target = fakeApp(join(dir, "installed"), "0.1.0")
    const staged = fakeApp(join(dir, "staged"), "0.9.0")
    // This test's own process stands in for an app that won't quit.
    const child = startInstall({ dir, app: staged, target, pid: process.pid, relaunch: false, waitSeconds: 1 })
    const code = await new Promise<number | null>((r) => child.on("exit", r))
    expect(code).toBe(1)
    expect(version(target)).toBe("0.1.0")
    expect(existsSync(staged)).toBe(true)
    expect(readFileSync(join(dir, "install.log"), "utf8")).toMatch(/still running/)
  })

  it("tells you once it's ready, and a later launch installs what it downloaded before", async () => {
    publish("0.7.0")
    const ready: string[] = []
    const first = macUpdater("next-launch", "0.1.0", { onReady: (v) => ready.push(v), installCachedOnLaunch: true })
    // Downloaded on this run: it waits for Restart to update and says so.
    expect((await first.u.check()).status).toBe("ready")
    expect(ready).toEqual(["0.7.0"])
    expect(first.quits()).toBe(0)
    // The app was left running, then opened again: the first check finds the download and puts it in.
    const again = macUpdater("next-launch", "0.1.0", { installCachedOnLaunch: true })
    await again.u.check()
    expect(again.quits()).toBe(1)
    await waitFor(() => version(again.target) === "0.7.0")
  })

  it("installs a ready update when you quit", async () => {
    publish("0.6.0")
    const { u, target } = macUpdater("on-quit")
    expect((await u.check()).status).toBe("ready")
    u.installOnQuit()
    await waitFor(() => version(target) === "0.6.0")
  })
})

// ---------- Windows and Linux: electron-updater, gated on the signature ----------

describe("Windows and Linux", () => {
  function fakeEU() {
    const handlers: Record<string, (a: unknown) => void> = {}
    const calls: string[] = []
    const eu: ElectronUpdater = {
      autoDownload: true,
      autoInstallOnAppQuit: false,
      disableDifferentialDownload: false,
      setFeedURL: (o) => void calls.push(`feed ${o.url}`),
      on: (e, fn) => (handlers[e] = fn as (a: unknown) => void),
      checkForUpdates: async () => {
        calls.push("check")
        handlers["update-available"]?.(release)
        return null
      },
      downloadUpdate: async () => {
        calls.push("download")
        handlers["update-downloaded"]?.({ version: release.version })
        return []
      },
      quitAndInstall: (silent, run) => void calls.push(`install ${silent} ${run}`),
    }
    return { eu, calls }
  }
  const release = { version: "0.2.0", files: [{ url: "Axe-AI-Setup-0.2.0.exe", sha512: "WIN==" }] }
  const k = keys()

  async function run(signature: string) {
    const { eu, calls } = fakeEU()
    const states: UpdateState[] = []
    const u = new Updater({
      version: "0.1.0",
      platform: "win32",
      arch: "x64",
      feed: "https://example.test/downloads/desktop",
      publicKey: k.pub,
      cacheDir: root,
      onState: (s) => states.push(s),
      quit: () => {},
      fetch: (async (url: string) => (String(url).endsWith("Axe-AI-0.2.0-win.sig") ? new Response(signature) : new Response("", { status: 404 }))) as typeof fetch,
      electronUpdater: async () => eu,
    })
    await u.check()
    await waitFor(() => ["ready", "error"].includes(u.current.status))
    return { u, eu, calls, states }
  }

  it("downloads only after the signature checks out, then installs silently", async () => {
    const { u, eu, calls } = await run(signRelease("win", release, k.priv))
    expect(eu.autoDownload).toBe(false)
    expect(eu.disableDifferentialDownload).toBe(true)
    expect(calls).toEqual(["feed https://example.test/downloads/desktop", "check", "download"])
    expect(u.current).toEqual({ status: "ready", version: "0.2.0" })
    u.install(true)
    expect(calls.at(-1)).toBe("install true true")
  })

  it("never downloads an unsigned release", async () => {
    const { u, calls } = await run("")
    expect(calls).not.toContain("download")
    expect(u.current).toEqual({ status: "error", message: UNSIGNED_UPDATE })
  })
})
