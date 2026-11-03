// Signs a release for the updater (see src/main/updates/sig.ts).
//
//   node scripts/sign-update.ts <dist> [private key .pem]   (default ~/.axe-signing/imperium-update-ed25519.pem)
//
// Reads latest-mac.yml, latest.yml (Windows) and latest-linux.yml, writes Axe-AI-<version>-<mac|win|linux>.sig
// next to them, and checks each against the public key built into the app, so a wrong key fails the build
// instead of every update. Never prints the key.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { FEED_FILE, parseFeed, type ReleasePlatform, signatureFileName, signRelease, verifyRelease } from "../src/main/updates/sig.ts"

const [dir, keyArg] = process.argv.slice(2)
if (!dir) {
  console.error("usage: node scripts/sign-update.ts <dist> [private key .pem]")
  process.exit(2)
}
const keyPath = keyArg ?? process.env.AXE_UPDATE_KEY ?? join(homedir(), ".axe-signing/imperium-update-ed25519.pem")
if (!existsSync(keyPath)) throw new Error(`No signing key at ${keyPath}. Releases are signed on the release Mac.`)
const key = readFileSync(keyPath, "utf8")
let signed = 0
for (const platform of Object.keys(FEED_FILE) as ReleasePlatform[]) {
  const path = join(dir, FEED_FILE[platform])
  if (!existsSync(path)) continue
  const info = parseFeed(readFileSync(path, "utf8"))
  for (const f of info.files ?? []) if (!existsSync(join(dir, f.url))) throw new Error(`${FEED_FILE[platform]} lists ${f.url}, which isn't in ${dir}`)
  const name = signatureFileName(platform, info.version)
  if (!name) throw new Error(`${FEED_FILE[platform]}: bad version ${info.version}`)
  const sig = signRelease(platform, info, key)
  if (!verifyRelease(platform, info, sig)) throw new Error("This key doesn't match UPDATE_PUBLIC_KEY in src/main/updates/sig.ts")
  writeFileSync(join(dir, name), `${sig}\n`)
  console.log(`Signed ${FEED_FILE[platform]} (${info.version}, ${info.files?.length} files) -> ${name}`)
  signed++
}
if (signed === 0) throw new Error(`No latest-mac.yml, latest.yml or latest-linux.yml in ${dir}`)
