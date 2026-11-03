// The real built app, headless, for package H (updates).
// node tests/e2e/updates-run.mjs <out-dir>
//
// A local feed (a temp HTTP server with latest-mac.yml, a zipped stand-in "Axe AI.app" at 0.2.0 and its
// signature, made with a test key) and a stand-in app at 0.1.0 to replace. The app checks the feed,
// checks the signature, downloads, shows "Restart to update"; clicking it quits the app and the stand-in
// becomes 0.2.0. Then a feed with a bad signature: an error, nothing downloaded. No network.
import { execFileSync } from "node:child_process"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"
import { mainWindow } from "./main-window.mjs"

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const root = mkdtempSync(join(tmpdir(), "axe-h-run-"))
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAILED: ${what}`)
  console.log(`ok  ${what}`)
}

async function launch(name, env) {
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, AXE_BASE_URL: process.env.AXE_BASE_URL ?? "http://localhost:3000", AXE_SELFTEST: "1", AXE_HEADLESS: "1", AXE_DATA_DIR: join(root, `data-${name}`), ...env },
    recordVideo: { dir: join(out, name), size: { width: 1440, height: 900 } },
  })
  const win = await mainWindow(app)
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForTimeout(2000)
  const signIn = win.getByRole("button", { name: /sign in with axe/i })
  if (await signIn.isVisible().catch(() => false)) {
    await signIn.click()
    await win.getByRole("button", { name: "Account", exact: true }).waitFor({ timeout: 20000 })
  }
  return { app, win, shot: (n) => win.screenshot({ path: join(out, `${name}-${n}.png`) }) }
}

// ---------- Updates on a local feed ----------

const plistVersion = (app) => execFileSync("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", join(app, "Contents/Info.plist")]).toString().trim()

function fakeApp(dir, version) {
  const app = join(dir, "Axe AI.app")
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true })
  writeFileSync(
    join(app, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.axeai.desktop</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`,
  )
  return app
}

async function updates() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const pub = join(root, "test-update-key.pem")
  writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }))
  const feedDir = join(root, "feed")
  mkdirSync(feedDir, { recursive: true })
  const served = []
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.split("?")[0].slice(1))
    served.push(name)
    const path = join(feedDir, name)
    if (!name || name.includes("..") || !existsSync(path)) return void res.writeHead(404).end()
    res.writeHead(200).end(readFileSync(path))
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const feed = `http://127.0.0.1:${server.address().port}`

  const publish = (v, signed = true) => {
    const build = mkdtempSync(join(root, "build-"))
    fakeApp(build, v)
    const zip = `Axe-AI-${v}-${process.arch === "arm64" ? "arm64-" : ""}mac.zip`
    execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", join(build, "Axe AI.app"), join(feedDir, zip)])
    const sha512 = createHash("sha512").update(readFileSync(join(feedDir, zip))).digest("base64")
    writeFileSync(join(feedDir, "latest-mac.yml"), `version: ${v}\nfiles:\n  - url: ${zip}\n    sha512: ${sha512}\npath: ${zip}\nsha512: ${sha512}\n`)
    const statement = ["axe-desktop-release v1", "mac", v, `${zip} ${sha512}`].join("\n") + "\n"
    writeFileSync(join(feedDir, `Axe-AI-${v}-mac.sig`), signed ? sign(null, Buffer.from(statement), privateKey).toString("base64") : "")
    return zip
  }

  // 1. A signed 0.2.0: Restart to update replaces the stand-in.
  publish("0.2.0")
  const target = fakeApp(mkdtempSync(join(root, "installed-")), "0.1.0")
  const env = { AXE_UPDATE_FEED: feed, AXE_UPDATE_PUBLIC_KEY: pub, AXE_UPDATE_TARGET: target, AXE_UPDATE_FIRST_CHECK_MS: "500", AXE_UPDATE_NO_RELAUNCH: "1" }
  const a = await launch("update", env)
  const pill = a.win.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "Restart to update" })
  await pill.waitFor({ timeout: 30000 })
  await a.shot("1-ready")
  ok(served.includes("Axe-AI-0.2.0-mac.sig") && served.some((n) => n.endsWith(".zip")), "checked the signature and downloaded the build from the local feed")
  await a.win.getByRole("button", { name: "Account", exact: true }).click()
  await a.win.getByRole("menuitem", { name: "Settings" }).click()
  await a.win.getByText("Version 0.2.0 is ready. Restart to update.").waitFor()
  await a.win.locator("#settings-updates").scrollIntoViewIfNeeded()
  await a.win.waitForTimeout(400)
  await a.shot("2-settings")
  ok(plistVersion(target) === "0.1.0", "nothing replaced before Restart to update")
  const closed = new Promise((r) => a.app.process().once("exit", r))
  await pill.click()
  await closed
  ok(true, "the app quit on Restart to update")
  for (let i = 0; i < 100 && plistVersion(target) !== "0.2.0"; i++) await new Promise((r) => setTimeout(r, 100))
  ok(plistVersion(target) === "0.2.0", "the installed app is now 0.2.0")

  // 2. A 0.3.0 with a bad signature: an error, and the build is never fetched.
  const zip = publish("0.3.0", false)
  served.length = 0
  const b = await launch("update-unsigned", { ...env, AXE_UPDATE_TARGET: fakeApp(mkdtempSync(join(root, "installed-")), "0.1.0") })
  await b.win.getByRole("button", { name: "Account", exact: true }).click()
  await b.win.getByRole("menuitem", { name: "Settings" }).click()
  await b.win.getByText("The update isn't signed by Axe AI, so it wasn't installed.").waitFor({ timeout: 30000 })
  await b.win.locator("#settings-updates").scrollIntoViewIfNeeded()
  await b.win.waitForTimeout(400)
  await b.shot("1-refused")
  ok(!served.includes(zip), "an unsigned build is never downloaded")
  ok((await b.win.getByRole("button", { name: "Restart to update" }).count()) === 0, "no Restart to update for it")
  await b.app.close()
  server.close()
}

if (process.platform === "darwin") await updates()
else console.log("skip updates: the local-feed run swaps a Mac bundle")
console.log("done")
