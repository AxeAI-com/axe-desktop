import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto"
import { createReadStream } from "node:fs"

// Signed releases for the updater, ported from the old app (../desktop/src/main/update-sig.ts).
//
// The feed (latest.yml, latest-linux.yml, latest-mac.yml) and the builds come from the same server, so
// the SHA-512s in the feed alone can't tell a real release from a planted one. Without paid signing
// certificates, each release also carries an Ed25519 signature over the platform, the version and every
// file's SHA-512, made with a key only the release Mac holds (~/.axe-signing/imperium-update-ed25519.pem,
// the same key as the old app). The app downloads an update only when that signature checks out
// against the public key below, then holds the download to those SHA-512s.
//
// The signed text starts "axe-desktop-release v1", so a signature for the old app (Axe Imperium) can
// never pass for this one. No Electron imports: scripts/sign-update.ts uses this file too.

/** The public half of ~/.axe-signing/imperium-update-ed25519.pem. */
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHtZVLZk3EETs8iJPpk7x8Ey0Pn2TNOY2ti0pXfOBftM=
-----END PUBLIC KEY-----
`

/** Where the feeds, builds and signatures live (package.json build.publish.url). */
export const UPDATE_FEED = "https://axeai.com/downloads/desktop"

export type ReleasePlatform = "mac" | "win" | "linux"
export type ReleaseFile = { url: string; sha512: string; size?: number }
export type ReleaseInfo = { version: string; files?: ReleaseFile[] }

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/

/** The feed electron-builder writes for each system. */
export const FEED_FILE: Record<ReleasePlatform, string> = { mac: "latest-mac.yml", win: "latest.yml", linux: "latest-linux.yml" }

export const platformOf = (p: string): ReleasePlatform => (p === "darwin" ? "mac" : p === "win32" ? "win" : "linux")

/** "Axe-AI-0.2.0-mac.sig", next to the builds; undefined for a version that isn't one. */
export function signatureFileName(platform: ReleasePlatform, version: string): string | undefined {
  return VERSION.test(version) ? `Axe-AI-${version}-${platform}.sig` : undefined
}

/** The exact text that is signed: platform, version and each file with its SHA-512. */
export function releaseStatement(platform: ReleasePlatform, info: ReleaseInfo): string | undefined {
  const files = info.files ?? []
  if (!VERSION.test(info.version) || files.length === 0) return undefined
  if (files.some((f) => !f.url || !f.sha512 || /\s/.test(f.url) || /\s/.test(f.sha512))) return undefined
  const lines = files.map((f) => `${f.url} ${f.sha512}`).sort()
  return ["axe-desktop-release v1", platform, info.version, ...lines].join("\n") + "\n"
}

/** Base64 Ed25519 signature of the release (used by the release build). */
export function signRelease(platform: ReleasePlatform, info: ReleaseInfo, privateKeyPem: string): string {
  const statement = releaseStatement(platform, info)
  if (!statement) throw new Error(`Nothing to sign for ${platform} ${info.version}`)
  return sign(null, Buffer.from(statement), createPrivateKey(privateKeyPem)).toString("base64")
}

/** True only when `signature` is ours for exactly this version and these files. */
export function verifyRelease(platform: ReleasePlatform, info: ReleaseInfo, signature: string, publicKeyPem = UPDATE_PUBLIC_KEY): boolean {
  const statement = releaseStatement(platform, info)
  if (!statement) return false
  try {
    const sig = Buffer.from(signature.trim(), "base64")
    if (sig.length !== 64) return false
    return verify(null, Buffer.from(statement), createPublicKey(publicKeyPem), sig)
  } catch {
    return false
  }
}

/** Fetches the release's signature from the feed and checks it. */
export async function releaseIsSigned(
  platform: ReleasePlatform,
  info: ReleaseInfo,
  o: { feed?: string; publicKey?: string; fetch?: typeof fetch } = {},
): Promise<boolean> {
  const name = signatureFileName(platform, info.version)
  if (!name) return false
  try {
    const res = await (o.fetch ?? fetch)(`${o.feed ?? UPDATE_FEED}/${name}`, { headers: { "Cache-Control": "no-cache" } })
    if (!res.ok) return false
    return verifyRelease(platform, info, await res.text(), o.publicKey)
  } catch {
    return false
  }
}

/** The version and files of an electron-builder latest*.yml. */
export function parseFeed(yml: string): ReleaseInfo {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(yml)?.[1] ?? ""
  const files: ReleaseFile[] = []
  let current: Partial<ReleaseFile> | undefined
  let inFiles = false
  const flush = () => {
    if (current?.url && current.sha512) files.push(current as ReleaseFile)
  }
  for (const line of yml.split(/\r?\n/)) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true
      continue
    }
    if (inFiles && /^\S/.test(line)) inFiles = false
    if (!inFiles) continue
    const item = /^\s*-\s+url:\s*(.+?)\s*$/.exec(line)
    if (item) {
      flush()
      current = { url: unquote(item[1]!) }
      continue
    }
    const sha = /^\s+sha512:\s*(.+?)\s*$/.exec(line)
    if (sha && current) current.sha512 = unquote(sha[1]!)
    const size = /^\s+size:\s*(\d+)\s*$/.exec(line)
    if (size && current) current.size = Number(size[1])
  }
  flush()
  return { version, files }
}

const unquote = (s: string) => s.replace(/^['"]|['"]$/g, "")

/** True when `next` is a later version than `current` (semver; a pre-release sorts before its release). */
export function isNewer(next: string, current: string): boolean {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/.exec(v.trim())
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4]?.split(".") } : undefined
  }
  const a = parse(next)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i]! > b.nums[i]!
  if (!a.pre && !b.pre) return false
  if (!a.pre) return true
  if (!b.pre) return false
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return false
    if (y === undefined) return true
    if (x === y) continue
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) return Number(x) > Number(y)
    if (nx !== ny) return !nx
    return x > y
  }
  return false
}

/** The Mac build for this computer: the zip for its chip, else a universal one. */
export function macFile(info: ReleaseInfo, arch: string): ReleaseFile | undefined {
  const zips = (info.files ?? []).filter((f) => f.url.endsWith(".zip"))
  const other = arch === "arm64" ? /x64|x86_64|intel/i : /arm64/i
  const mine = new RegExp(arch === "arm64" ? "arm64" : "x64|x86_64", "i")
  return zips.find((f) => mine.test(f.url)) ?? zips.find((f) => /universal/i.test(f.url)) ?? zips.find((f) => !other.test(f.url))
}

/** Base64 SHA-512 of a file, as electron-builder writes it in the feed. */
export function sha512File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha512")
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("base64")))
      .on("error", reject)
  })
}
