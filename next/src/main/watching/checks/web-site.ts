import { statusOf } from "@shared/watching/findings"
import { urlOf } from "@shared/watching/target"
import type { CheckRow, Finding, Run, Step } from "@shared/watching/types"

import { type CheckDeps, plainError } from "./deps"
import { fetchListed, sameSite } from "./reach"

// Three More kinds about a site's files: the desktop update feed (electron-builder's latest*.yml and
// the files they name), SEO basics (robots.txt, sitemap.xml, llms.txt, noindex), and broken links
// (the pages in the sitemap, one at a time with a pause between, at most LINKS_CAP).

const mb = (b: number) => `${Math.round(b / 1_000_000)} MB`
/** The watched site's own files: redirects are followed by hand, never to this Mac or the local network. */
const get = (d: CheckDeps, url: string, init: RequestInit = {}) => fetchListed(d, url, url, { init })

/* Update feed */

/** The three feeds electron-builder writes, by system. */
export const FEEDS: [string, string][] = [
  ["latest-mac.yml", "Mac"],
  ["latest.yml", "Windows"],
  ["latest-linux.yml", "Linux"],
]

export type FeedFile = { url: string; size?: number }

/** The version and files of a latest*.yml (only the fields the updater reads; no YAML library needed). */
export function parseFeed(text: string): { version?: string; files: FeedFile[] } {
  const unquote = (v: string) => v.trim().replace(/^['"]|['"]$/g, "")
  let version: string | undefined
  let path: string | undefined
  const files: FeedFile[] = []
  for (const line of text.split(/\r?\n/)) {
    const item = line.match(/^\s*-\s*url:\s*(.+)$/)
    if (item) files.push({ url: unquote(item[1]!) })
    else if (/^\s+size:/.test(line) && files.length) files.at(-1)!.size = Number(unquote(line.split(":")[1]!))
    else if (/^version:/.test(line)) version = unquote(line.slice(8))
    else if (/^path:/.test(line)) path = unquote(line.slice(5))
  }
  if (path && !files.some((f) => f.url === path)) files.push({ url: path })
  return { ...(version ? { version } : {}), files }
}

/** One byte of the file, which proves it downloads, and its full size from Content-Range. */
async function probeFile(url: string, feed: string, d: CheckDeps): Promise<{ ok: boolean; status?: number; size?: number; why?: string }> {
  try {
    // The feed names the URL: never one on this Mac or the local network.
    const res = await fetchListed(d, url, feed, { init: { headers: { range: "bytes=0-0" } } })
    await res.body?.cancel()
    if (res.status !== 206 && res.status !== 200) return { ok: false, status: res.status, why: `${res.status}` }
    const total = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1] ?? (res.status === 200 ? res.headers.get("content-length") : null)
    return { ok: true, status: res.status, ...(total ? { size: Number(total) } : {}) }
  } catch (e) {
    return { ok: false, why: plainError(e).toLowerCase() }
  }
}

/** The feeds to read: the one named, or all three next to a folder link. */
export const feedsOf = (target: string): [string, string][] => {
  const name = target.split("/").pop() ?? ""
  if (/\.ya?ml$/i.test(name)) return [[urlOf(target), FEEDS.find(([f]) => f === name)?.[1] ?? name]]
  const base = urlOf(target).replace(/\/+$/, "")
  return FEEDS.map(([f, sys]) => [`${base}/${f}`, sys])
}

export async function checkFeed(target: string, d: CheckDeps, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const feeds = feedsOf(target)
  const findings: Finding[] = []
  const rows: CheckRow[] = []
  const facts: [string, string][] = []
  let was: Record<string, string> = {}
  try {
    was = memo ? (JSON.parse(memo) as Record<string, string>) : {}
  } catch {}
  const versions: Record<string, string> = {}
  let read = 0
  for (const [url, sys] of feeds) {
    const file = url.split("/").pop()!
    let text: string | null = null
    let why = ""
    try {
      const res = await get(d, url)
      if (res.ok) text = await res.text()
      else {
        why = `${res.status}`
        await res.body?.cancel()
      }
    } catch (e) {
      why = plainError(e).toLowerCase()
    }
    const feed = text ? parseFeed(text) : null
    if (!feed?.version) {
      const what = text ? "has no version in it" : `doesn’t load (${why})`
      rows.push({ label: file, value: text ? "No version" : `Couldn’t read it (${why})`, ok: false })
      findings.push({ key: `feed:${file}`, level: "problem", headline: `${file} ${what}`, line: `${file} ${what}.`, detail: `The ${sys} app can’t find its updates while it ${text ? "has no version" : "doesn’t load"}.`, fix: "none" })
      continue
    }
    read++
    versions[file] = feed.version
    facts.push([sys, feed.version])
    if (was[file] && was[file] !== feed.version)
      findings.push({ key: `version:${file}:${feed.version}`, level: "news", headline: `The ${sys} update is ${feed.version} now`, line: `${sys} update ${feed.version} is out.`, detail: `It was ${was[file]}.`, fix: "none" })
    for (const f of feed.files) {
      const fileUrl = new URL(f.url, url).href
      const name = f.url.split("/").pop()!
      const p = await probeFile(fileUrl, url, d)
      const wrongSize = p.ok && f.size !== undefined && p.size !== undefined && p.size !== f.size
      rows.push({ label: name, sub: sys, value: !p.ok ? `Doesn’t download (${p.why})` : wrongSize ? `${mb(p.size!)}, the feed says ${mb(f.size!)}` : `${p.size ? mb(p.size) : "Downloads"}`, ok: p.ok && !wrongSize })
      if (!p.ok)
        findings.push({ key: `file:${name}`, level: "problem", headline: `${name} doesn’t download`, line: `${name} doesn’t download (${p.why}).`, detail: `${file} names it, so ${sys} updates fail. The server said ${p.why}.`, fix: "none" })
      else if (wrongSize)
        findings.push({ key: `size:${name}`, level: "problem", headline: `${name} isn’t the size the feed says`, line: `${name} is ${mb(p.size!)}, the feed says ${mb(f.size!)}.`, detail: "The updater checks the size and the hash, so this update will fail.", fix: "none" })
    }
  }
  if (!read && feeds.length && findings.every((f) => /doesn’t load/.test(f.headline)) && rows.every((r) => /wasn’t found/.test(r.value)))
    return { run: { at, ms: d.now() - at, status: "failed", findings: [], error: "The address wasn’t found" } }
  return { run: { at, ms: d.now() - at, status: statusOf(findings), findings, rows, facts }, memo: JSON.stringify({ ...was, ...versions }) }
}

/* SEO basics */

/** Does robots.txt block everything for every crawler ("User-agent: *" then "Disallow: /")? */
export function blocksAll(robots: string): boolean {
  let star = false
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const [k, ...rest] = line.split(":")
    const v = rest.join(":").trim()
    if (/^user-agent$/i.test(k ?? "")) star = v === "*"
    else if (star && /^disallow$/i.test(k ?? "") && v === "/") return true
  }
  return false
}

/** Page links in a sitemap (or the child sitemaps of a sitemap index). */
export const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"))

const noindexIn = (res: Response, html: string) =>
  /noindex/i.test(res.headers.get("x-robots-tag") ?? "") || /<meta[^>]+name=["']?(robots|googlebot)["']?[^>]+content=["'][^"']*noindex/i.test(html) || /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']?robots/i.test(html)

const pathOf = (u: string) => {
  try {
    return new URL(u).pathname
  } catch {
    return u
  }
}

/** The sitemap's page links, following one level of sitemap index; null when there's no sitemap. */
export async function sitemapPages(base: string, d: CheckDeps): Promise<{ pages: string[] } | { why: string }> {
  try {
    const res = await get(d, `${base}/sitemap.xml`)
    if (!res.ok) return (await res.body?.cancel(), { why: `${res.status}` })
    const xml = await res.text()
    if (!/<(urlset|sitemapindex)\b/.test(xml)) return { why: "not a sitemap" }
    // Only the site's own links: a sitemap can list anything.
    const own = (us: string[]) => us.filter((u) => sameSite(u, base))
    let pages = own(locs(xml))
    if (/<sitemapindex\b/.test(xml)) {
      const kids = await Promise.all(pages.slice(0, 5).map((u) => fetchListed(d, u, base, { site: true }).then((r) => (r.ok ? r.text() : "")).catch(() => "")))
      pages = own(kids.flatMap(locs))
    }
    return { pages: [...new Set(pages)] }
  } catch (e) {
    return { why: plainError(e).toLowerCase() }
  }
}

export async function checkSeo(target: string, d: CheckDeps): Promise<Run> {
  const at = d.now()
  const base = urlOf(target).replace(/\/+$/, "")
  const findings: Finding[] = []
  const rows: CheckRow[] = []
  const text = async (path: string) => {
    try {
      const res = await get(d, `${base}${path}`)
      const body = await res.text()
      return { status: res.status, body, type: res.headers.get("content-type") ?? "" }
    } catch (e) {
      return { status: 0, body: "", type: "", why: plainError(e).toLowerCase() }
    }
  }
  const [robots, llms, sitemap] = await Promise.all([text("/robots.txt"), text("/llms.txt"), sitemapPages(base, d)])
  if (robots.status === 0 && "why" in sitemap && /wasn’t found/.test(sitemap.why)) return { at, ms: d.now() - at, status: "failed", findings: [], error: "The address wasn’t found" }
  if (robots.status !== 200 || /text\/html/i.test(robots.type)) {
    rows.push({ label: "robots.txt", value: `Not there (${robots.status || "no answer"})`, ok: false })
    findings.push({ key: "seo:robots", level: "problem", headline: `${target} has no robots.txt`, line: "No robots.txt.", detail: "Crawlers look for it first. Without it they guess, and the sitemap isn’t announced.", fix: "agent" })
  } else if (blocksAll(robots.body)) {
    rows.push({ label: "robots.txt", value: "Blocks every crawler", ok: false })
    findings.push({ key: "seo:blockall", level: "problem", headline: `robots.txt blocks every search engine from ${target}`, line: "robots.txt blocks every crawler.", detail: "It says “User-agent: *” then “Disallow: /”, so nothing on the site can be indexed.", fix: "agent" })
  } else rows.push({ label: "robots.txt", value: "Lets crawlers in", ok: true })
  let pages: string[] = []
  if ("why" in sitemap) {
    rows.push({ label: "sitemap.xml", value: `Not there (${sitemap.why})`, ok: false })
    findings.push({ key: "seo:sitemap", level: "problem", headline: `${target} has no sitemap.xml`, line: "No sitemap.xml.", detail: "Search engines find new pages slower without one.", fix: "agent" })
  } else {
    pages = sitemap.pages
    rows.push({ label: "sitemap.xml", value: `${pages.length} ${pages.length === 1 ? "page" : "pages"}`, ok: pages.length > 0 })
    if (!pages.length) findings.push({ key: "seo:sitemap", level: "problem", headline: `${target}’s sitemap.xml lists no pages`, line: "sitemap.xml is empty.", fix: "agent" })
  }
  if (llms.status !== 200 || !llms.body.trim() || /text\/html/i.test(llms.type) || /^\s*<!doctype/i.test(llms.body)) {
    rows.push({ label: "llms.txt", value: `Not there (${llms.status || "no answer"})`, ok: false })
    findings.push({ key: "seo:llms", level: "problem", headline: `${target} has no llms.txt`, line: "No llms.txt.", detail: "AI search tools read it to describe the site.", fix: "agent" })
  } else {
    const n = llms.body.split("\n").filter((l) => l.trim()).length
    rows.push({ label: "llms.txt", value: `${n} ${n === 1 ? "line" : "lines"}`, ok: true })
  }
  // Key pages: the home page and the first four in the sitemap.
  const key = [...new Set([`${base}/`, ...pages.slice(0, 4)])]
  const marked: string[] = []
  for (const u of key) {
    try {
      const res = await fetchListed(d, u, base, { site: true })
      const html = await res.text()
      if (res.ok && noindexIn(res, html)) marked.push(u)
    } catch {}
  }
  for (const u of marked)
    findings.push({ key: `seo:noindex:${pathOf(u)}`, level: "problem", headline: `${pathOf(u) === "/" ? "The home page" : pathOf(u)} is set to noindex`, line: `${pathOf(u)} is set to noindex.`, detail: "Search engines will drop it. It says noindex in a robots meta tag or the X-Robots-Tag header.", fix: "agent" })
  rows.push({ label: "Key pages", sub: `${key.length} checked`, value: marked.length ? `${marked.length} set to noindex` : "None set to noindex", ok: !marked.length })
  return { at, ms: d.now() - at, status: statusOf(findings), findings, rows }
}

/* Broken links */

export const LINKS_CAP = 50
export const LINKS_PAUSE_MS = 300

export const linksSteps = (n: number, done: number): Step[] => [
  { label: "Reading the sitemap", state: n ? "done" : "run" },
  { label: n ? `Loading ${n} pages, ${done} done` : "Loading its pages", state: n ? (done < n ? "run" : "done") : "todo" },
]

export async function checkLinks(target: string, d: CheckDeps, onStep?: (s: Step[]) => void): Promise<Run> {
  const at = d.now()
  const base = urlOf(target).replace(/\/+$/, "")
  onStep?.(linksSteps(0, 0))
  const sm = await sitemapPages(base, d)
  if ("why" in sm) return { at, ms: d.now() - at, status: "failed", findings: [], error: /wasn’t found/.test(sm.why) ? "The address wasn’t found" : `I couldn’t read ${target}/sitemap.xml (${sm.why})` }
  const pages = sm.pages.slice(0, LINKS_CAP)
  const findings: Finding[] = []
  let slowest = { ms: 0, url: "" }
  for (const [i, u] of pages.entries()) {
    onStep?.(linksSteps(pages.length, i))
    if (i) await d.sleep(LINKS_PAUSE_MS)
    const t = d.now()
    let why = ""
    try {
      const res = await fetchListed(d, u, base, { site: true })
      await res.body?.cancel()
      if (res.status >= 400) why = `${res.status}`
    } catch (e) {
      // A page on this Mac or the local network isn't fetched, so it isn't reported either.
      if (/^refused/.test((e as Error).message)) continue
      why = plainError(e).toLowerCase()
    }
    const took = d.now() - t
    if (took > slowest.ms) slowest = { ms: took, url: u }
    if (why)
      findings.push({ key: `link:${pathOf(u)}`, level: "problem", headline: `${pathOf(u)} doesn’t load`, line: `${pathOf(u)} doesn’t load (${why}).`, detail: `It’s in the sitemap, but it answered ${why}. Fix the page or take it out of the sitemap.`, fix: "agent" })
  }
  onStep?.(linksSteps(pages.length, pages.length))
  const facts: [string, string][] = [
    ["Pages", `${pages.length}`],
    ["Broken", `${findings.length}`],
    ...(slowest.url ? ([["Slowest", `${pathOf(slowest.url)}, ${(slowest.ms / 1000).toFixed(1)} s`]] as [string, string][]) : []),
  ]
  if (sm.pages.length > LINKS_CAP) facts.push(["Not checked", `${sm.pages.length - LINKS_CAP} past the first ${LINKS_CAP}`])
  return { at, ms: d.now() - at, status: statusOf(findings), findings, facts }
}
