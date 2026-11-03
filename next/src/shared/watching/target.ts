import { cleanElementTarget } from "./elements"
import { cleanFolder, cleanServices } from "./more"
import { ELEMENT_KINDS, type ElementKind, type Kind } from "./types"

// Targets as people type them, cleaned to what a check needs. The fallback parser finds an address
// in free text when no model can read it; it never decides the kind.

const DOMAIN = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s"'<>)]*)?/i
const REPO = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/

/** A server on this Mac (a site you're building): kept with its port, loaded over http. */
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d{2,5})?(\/[^\s"'<>)]*)?$/i

const strip = (t: string) => t.trim().replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/[.,;:!?]+$/, "")

/** The target for a kind, or null when it isn't one. Uptime and page keep the path; security keeps only the domain. */
/** "20 GB", "below 15 GB": a size, not a folder ("/Volumes/Disk1" is a folder). */
export const isSize = (t: string) => !/^[~/]/.test(t.trim()) && /^\D*\d+(\.\d+)?\s*[tgm]?b?\s*$/i.test(t.trim())

/** `home`: the real home folder (the engine passes it), so "/Users/you/Desktop" is refused like "~/Desktop". */
export function cleanTarget(kind: Kind, raw: string, home?: string): string | null {
  const t = raw.trim()
  if ((ELEMENT_KINDS as Kind[]).includes(kind)) return cleanElementTarget(kind as ElementKind, t, home)
  if (kind === "disk") return !t || /this mac|^\/$/i.test(t) || isSize(t) ? "/" : cleanFolder(t, home)
  if (!t) return null
  if (kind === "tests" || kind === "outdated") return cleanFolder(t, home)
  if (kind === "status") return cleanServices(t)
  if (kind === "repo") {
    if (t.startsWith("~/") || t.startsWith("/")) return t
    const gh = t.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").replace(/\/$/, "")
    return REPO.test(gh) ? gh : null
  }
  const local = strip(t).match(LOCAL)
  if (local) return kind === "security" || kind === "expiry" || kind === "dns" ? null : `${local[1]!.toLowerCase()}${local[2] ?? ""}${(local[3] ?? "").replace(/\/$/, "")}`
  const m = strip(t).match(DOMAIN)
  if (!m || m.index !== 0) return null
  const host = (m[1] ?? "").toLowerCase()
  if (kind === "security" || kind === "expiry" || kind === "dns" || kind === "seo" || kind === "links") return host
  const path = (m[2] ?? "").replace(/\/$/, "")
  return host + path
}

/** The first site address in a sentence, for the fallback ("What should I watch on {target}?"). */
export function findTarget(text: string): string | null {
  for (const word of text.split(/\s+/)) {
    const t = cleanTarget("page", word)
    if (t && /\.[a-z]{2,}/i.test(t.split("/")[0] ?? "")) return t
  }
  return null
}

export const urlOf = (target: string) => (/^[a-z]+:\/\//i.test(target) ? target : LOCAL.test(target) ? `http://${target}` : `https://${target}`)
export const hostOf = (target: string) => (strip(target).split("/")[0] ?? "").toLowerCase()

/** Edit distance, stopping early once it's over `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    if (Math.min(...cur) > max) return max + 1
    prev = cur
  }
  return prev[b.length]!
}

/** A host from `known` one edit away from `host` (a typo of a site you already use), or null. */
export function nearHost(host: string, known: string[]): string | null {
  const h = host.toLowerCase()
  for (const k of new Set(known.map((x) => x.toLowerCase()).filter(Boolean))) if (k !== h && distance(h, k, 1) === 1) return k
  return null
}
