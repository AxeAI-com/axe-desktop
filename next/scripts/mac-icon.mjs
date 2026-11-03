// electron-builder afterPack hook (Mac only): the app icon as macOS 26 and later want it.
//
// Since macOS 26, the Dock, Launchpad and notifications draw an app's icon from an Icon Composer asset
// catalog (Assets.car, named by CFBundleIconName). An app with only a full-bleed icon.icns gets it shrunk
// into a grey tile, or a stand-in. resources/icon.icon is the Icon Composer file (the white mark on Axe
// Blue); Xcode's actool compiles it into Assets.car plus a shaped icon.icns for older macOS, and both go
// into the bundle here, before electron-builder signs it.
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export default async function macIcon(context) {
  if (context.electronPlatformName !== "darwin") return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const resources = join(app, "Contents", "Resources")
  const out = mkdtempSync(join(tmpdir(), "axe-icon-"))
  try {
    // prettier-ignore
    execFileSync("xcrun", [
      "actool", join(context.packager.projectDir, "resources", "icon.icon"),
      "--compile", out, "--app-icon", "icon", "--include-all-app-icons",
      "--output-partial-info-plist", join(out, "partial.plist"),
      "--platform", "macosx", "--target-device", "mac", "--minimum-deployment-target", "13.0",
      "--enable-on-demand-resources", "NO", "--development-region", "en",
      "--errors", "--warnings", "--output-format", "human-readable-text",
    ], { stdio: "pipe" })
    copyFileSync(join(out, "Assets.car"), join(resources, "Assets.car"))
    copyFileSync(join(out, "icon.icns"), join(resources, "icon.icns"))
    const plist = join(app, "Contents", "Info.plist")
    execFileSync("plutil", ["-replace", "CFBundleIconName", "-string", "icon", plist])
    execFileSync("plutil", ["-replace", "CFBundleIconFile", "-string", "icon.icns", plist])
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}
