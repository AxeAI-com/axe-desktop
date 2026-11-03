// Checks a signed release folder before it goes anywhere (used by scripts/release).
//
//   node scripts/release-check.ts <dir> <version>              every feed's files are there, sizes and SHA-512s match,
//                                                               and each .sig checks out against the app's public key
//   node scripts/release-check.ts <dir> <version> --manifest    the same, then prints "<hex sha512>  <file>" for every
//                                                               file (builds, sigs, feeds) for `sha512sum -c` on the server
//
// Prints one line and exits 1 on the first problem.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { FEED_FILE, parseFeed, type ReleasePlatform, sha512File, signatureFileName, verifyRelease } from "../src/main/updates/sig.ts"

const [dir, version, flag] = process.argv.slice(2)
if (!dir || !version) {
  console.error("usage: node scripts/release-check.ts <dir> <version> [--manifest]")
  process.exit(2)
}
const fail = (why: string): never => {
  console.error(why)
  process.exit(1)
}

const files = new Set<string>()
for (const platform of Object.keys(FEED_FILE) as ReleasePlatform[]) {
  const feed = FEED_FILE[platform]
  if (!existsSync(join(dir, feed))) continue
  const info = parseFeed(readFileSync(join(dir, feed), "utf8"))
  if (info.version !== version) fail(`${feed} says ${info.version}, not ${version}`)
  if (!info.files?.length) fail(`${feed} lists no files`)
  for (const f of info.files ?? []) {
    const path = join(dir, f.url)
    if (!existsSync(path)) fail(`${feed} lists ${f.url}, which isn't in ${dir}`)
    if (f.size !== undefined && statSync(path).size !== f.size) fail(`${f.url}: size doesn't match ${feed}`)
    if ((await sha512File(path)) !== f.sha512) fail(`${f.url}: SHA-512 doesn't match ${feed}`)
    files.add(f.url)
    if (existsSync(`${path}.blockmap`)) files.add(`${f.url}.blockmap`)
  }
  const sig = signatureFileName(platform, version) as string
  if (!existsSync(join(dir, sig))) fail(`${sig} is missing; run sign:release`)
  if (!verifyRelease(platform, info, readFileSync(join(dir, sig), "utf8"))) fail(`${sig} doesn't check out against the app's key`)
  files.add(sig)
  files.add(feed)
}
if (files.size === 0) fail(`No latest-mac.yml, latest.yml or latest-linux.yml in ${dir}`)
// Installers the feeds don't list (the .deb) still ship and still need to be checked on the server.
for (const name of readdirSync(dir)) if (name.endsWith(".deb") && name.includes(version)) files.add(name)

if (flag === "--manifest") {
  for (const name of [...files].sort()) {
    const hex = Buffer.from(await sha512File(join(dir, name)), "base64").toString("hex")
    console.log(`${hex}  ${name}`)
  }
}
