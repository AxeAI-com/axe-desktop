import { execFile, spawn } from "node:child_process"
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"

import { type ReleaseFile, sha512File } from "./sig"

// Updates on the Mac without Squirrel.Mac. electron-updater's Mac path hands the zip to Squirrel,
// which only installs into an app signed with a Developer ID; our builds are unsigned for now. So, like
// the Swift app's UpdateCheck: download the zip, hold it to the signed SHA-512, unpack it with ditto,
// check it is Axe AI at the version the feed named, and swap the bundle with a small script once the
// app has quit. No Electron here, so unit tests run all of it.

const run = promisify(execFile)

export const BUNDLE_ID = "com.axeai.desktop"

/** The .app this copy runs from (…/Axe AI.app/Contents/MacOS/Axe AI). */
export const bundleOf = (execPath: string) => dirname(dirname(dirname(execPath)))

/** Why this bundle can't replace itself, or undefined when it can. */
export function cannotInstall(bundle: string): string | undefined {
  if (!bundle.endsWith(".app")) return "This copy isn't an app bundle."
  if (bundle.startsWith("/Volumes/")) return "Move Axe AI to Applications to get updates."
  if (bundle.includes("/AppTranslocation/")) return "Move Axe AI to Applications to get updates."
  try {
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
  } catch {
    return "Axe AI can't write to the folder it's in, so it can't update itself."
  }
  return undefined
}

/** Downloads `file` from `feed` into `dir`, reporting 0–100. Removes it again unless its SHA-512 matches. */
export async function downloadVerified(feed: string, file: ReleaseFile, dir: string, progress: (percent: number) => void, fetchImpl: typeof fetch = fetch): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const name = file.url.split("/").pop()!
  const path = join(dir, name)
  if (existsSync(path) && (await sha512File(path)) === file.sha512) {
    progress(100)
    return path
  }
  const url = /^https?:\/\//.test(file.url) ? file.url : `${feed}/${file.url.split("/").map(encodeURIComponent).join("/")}`
  const res = await fetchImpl(url, { headers: { "Cache-Control": "no-cache" } })
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`)
  const total = Number(res.headers.get("content-length")) || file.size || 0
  let got = 0
  let last = -1
  const body = Readable.fromWeb(res.body as never)
  body.on("data", (d: Buffer) => {
    got += d.length
    const p = total ? Math.min(99, Math.floor((got / total) * 100)) : 0
    if (p !== last) progress((last = p))
  })
  await pipeline(body, createWriteStream(path))
  if ((await sha512File(path)) !== file.sha512) {
    rmSync(path, { force: true })
    throw new Error("The download didn't match the release, so it was thrown away.")
  }
  progress(100)
  return path
}

const plist = async (app: string, key: string) => (await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")])).stdout.trim()

/** Unpacks the zip next to it and returns the one app inside, checked to be Axe AI at `version`. */
export async function unpack(zip: string, version: string): Promise<string> {
  const out = `${zip}.unpacked`
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  await run("/usr/bin/ditto", ["-x", "-k", zip, out])
  const apps = readdirSync(out).filter((n) => n.endsWith(".app"))
  if (apps.length !== 1) throw new Error("The update didn't hold exactly one app.")
  const app = join(out, apps[0]!)
  if ((await plist(app, "CFBundleIdentifier")) !== BUNDLE_ID) throw new Error("The update isn't Axe AI.")
  if ((await plist(app, "CFBundleShortVersionString")) !== version) throw new Error("The update isn't the version it said it was.")
  return app
}

/**
 * Waits for the app (pid) to quit, puts the new bundle in place of the old one (the old one comes back
 * if anything fails), and opens it again when asked. Arguments: pid, new app, target, relaunch (1/0), and how many
 * seconds to wait for the app to quit (60). If it is still running then, nothing is swapped.
 */
export const INSTALL_SCRIPT = `#!/bin/bash
pid="$1"; src="$2"; target="$3"; relaunch="$4"; wait="\${5:-60}"
for _ in $(seq 1 $((wait * 5))); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
# Still running: never pull the app out from under itself. The download stays for the next quit.
if kill -0 "$pid" 2>/dev/null; then echo "Axe AI was still running, so the update waits for the next quit." >&2; exit 1; fi
new="$target.new"; old="$target.old"
rm -rf "$new" "$old"
/usr/bin/ditto "$src" "$new" || { rm -rf "$new"; exit 1; }
/usr/bin/xattr -dr com.apple.quarantine "$new" 2>/dev/null
if mv "$target" "$old" && mv "$new" "$target"; then
  rm -rf "$old" "$src"
else
  rm -rf "$new"; [ -d "$old" ] && [ ! -d "$target" ] && mv "$old" "$target"
  exit 1
fi
[ "$relaunch" = "1" ] && /usr/bin/open "$target"
exit 0
`

/** Starts the swap in the background; it carries on after this process quits. */
export function startInstall(o: { dir: string; app: string; target: string; pid: number; relaunch: boolean; waitSeconds?: number }) {
  const script = join(o.dir, "install.sh")
  writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 })
  // What went wrong, if anything, lands in install.log next to the script.
  const log = openSync(join(o.dir, "install.log"), "w")
  const child = spawn("/bin/bash", [script, String(o.pid), o.app, o.target, o.relaunch ? "1" : "0", String(o.waitSeconds ?? 60)], {
    detached: true,
    stdio: ["ignore", log, log],
  })
  child.unref()
  return child
}
