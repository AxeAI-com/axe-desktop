// Builds the Mac helpers (universal: arm64 and x86_64) on a Mac: native/hands/main.swift into
// resources/axe-hands (Do it reading other apps) and native/speech/main.swift into
// resources/axe-speech (speech to text on the Mac itself). Other systems and Macs without the Swift
// compiler skip them; Do it then reads no other apps, and voice uses axeai.com.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

const root = join(dirname(new URL(import.meta.url).pathname), "..")

if (process.platform !== "darwin") process.exit(0)
try {
  execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" })
} catch {
  console.warn("build-hands: no Swift compiler; skipping (Do it won't read other apps, and voice uses axeai.com, in this build).")
  process.exit(0)
}
for (const [name, out] of [
  ["hands", "axe-hands"],
  ["speech", "axe-speech"],
]) {
  const src = join(root, `native/${name}/main.swift`)
  const file = join(root, "resources", out)
  if (existsSync(file) && statSync(file).mtimeMs > statSync(src).mtimeMs) continue
  mkdirSync(dirname(file), { recursive: true })
  const parts = []
  for (const arch of ["arm64", "x86_64"]) {
    const part = `${file}-${arch}`
    execFileSync("xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos13`, src, "-o", part], { stdio: "inherit" })
    parts.push(part)
  }
  execFileSync("lipo", ["-create", ...parts, "-output", file])
  for (const p of parts) execFileSync("rm", ["-f", p])
  console.log(`build-hands: resources/${out}`)
}
