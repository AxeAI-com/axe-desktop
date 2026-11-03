import { isIP } from "node:net"

import { type CheckDeps, HEADERS, TIMEOUT } from "./deps"

// URLs a watched site hands us (sitemap pages, child sitemaps, update feed files) are fetched only
// when they belong to that site, or at least to the public internet: never this Mac, the local
// network or link-local addresses (169.254.169.254), checked again on every redirect.

const bare = (h: string) => h.toLowerCase().replace(/^\[|\]$/g, "").replace(/^www\./, "")

/** Same site: the same host, or one a subdomain of the other (www ignored). */
export function sameSite(url: string, base: string): boolean {
  try {
    const a = bare(new URL(url).hostname)
    const b = bare(new URL(base).hostname)
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
  } catch {
    return false
  }
}

/** An IPv6 address as its eight 16-bit groups (a dotted IPv4 tail included), or null. */
function groups6(ip: string): number[] | null {
  let a = ip
  const v4 = a.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const [w, x, y, z] = v4[1]!.split(".").map(Number) as [number, number, number, number]
    a = `${a.slice(0, -v4[1]!.length)}${((w << 8) | x).toString(16)}:${((y << 8) | z).toString(16)}`
  }
  const [head, tail, ...more] = a.split("::")
  if (more.length) return null
  const part = (p: string | undefined) => (p ? p.split(":").map((g) => Number.parseInt(g, 16)) : [])
  const h = part(head)
  const t = part(tail)
  const fill = tail === undefined ? 0 : 8 - h.length - t.length
  const out = [...h, ...Array(Math.max(0, fill)).fill(0), ...t]
  return out.length === 8 && out.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? out : null
}

function private4(ip: string): boolean {
  const [x, y] = ip.split(".").map(Number) as [number, number]
  return x === 0 || x === 10 || x === 127 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224
}

/**
 * Loopback, private, link-local, carrier-grade NAT, multicast and unspecified addresses, IPv4 and IPv6,
 * with IPv4 inside IPv6 (::ffff:7f00:1, ::127.0.0.1, 64:ff9b::/96) unwrapped first.
 */
export function privateAddress(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "")
  if (isIP(a) === 4) return private4(a)
  if (isIP(a) !== 6) return false
  const g = groups6(a)
  if (!g) return true
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0)
  const inner = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return zero(0, 8) || (zero(0, 7) && g[7] === 1) || private4(inner)
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return private4(inner)
  return (g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0 || (g[0]! & 0xff00) === 0xff00
}

const localName = (h: string) => h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")

/**
 * Whether a URL from the site may be fetched, and where to: http(s), and off this Mac and the local
 * network unless it's the watched host itself. `base` null: no host is exempt (a status page you named,
 * not a site you chose). "refused", or "not found" when the lookup fails or finds nothing (never let
 * through). `pin`: the vetted addresses the request may connect to (all public), so the name can't
 * resolve somewhere else between the check and the fetch.
 */
export async function vet(url: string, base: string | null, d: Pick<CheckDeps, "addresses">): Promise<{ pin?: string[] } | "refused" | "not found"> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return "refused"
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "refused"
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  // The host you chose to watch (a dev server on this Mac included).
  try {
    if (base !== null && host === new URL(base).hostname.toLowerCase().replace(/^\[|\]$/g, "")) return {}
  } catch {}
  if (localName(host)) return "refused"
  if (isIP(host)) return privateAddress(host) ? "refused" : {}
  const ips = d.addresses ? await d.addresses(host).catch(() => []) : []
  if (!ips.length) return "not found"
  if (ips.some(privateAddress)) return "refused"
  return { pin: ips }
}

export const reachable = async (url: string, base: string | null, d: Pick<CheckDeps, "addresses">) => typeof (await vet(url, base, d)) === "object"

/**
 * GET a URL the site listed, following at most five redirects by hand so each hop is checked, and each
 * request pinned to the addresses that were checked.
 * `site`: the URL must also be on the watched site (sitemap pages, child sitemaps).
 * `strict`: the first host is checked too (the watched host isn't exempt).
 */
export async function fetchListed(d: CheckDeps, url: string, base: string, o: { site?: boolean; strict?: boolean; init?: RequestInit } = {}): Promise<Response> {
  if (o.site && !sameSite(url, base)) throw new Error("not on the watched site")
  let at = url
  for (let hop = 0; hop <= 5; hop++) {
    const ok = await vet(at, o.strict ? null : base, d)
    if (ok === "not found") throw new Error(`getaddrinfo ENOTFOUND ${new URL(at).hostname}`)
    if (ok === "refused") throw new Error("refused: a local or private address")
    const res = await d.fetch(at, { ...o.init, ...ok, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT), headers: { ...HEADERS, ...(o.init?.headers as Record<string, string> | undefined) } })
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
    if (!next) return res
    await res.body?.cancel()
    at = new URL(next, at).href
  }
  throw new Error("too many redirects")
}
