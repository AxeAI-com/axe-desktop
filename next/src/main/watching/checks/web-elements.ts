import { chainOf, ELEMENT_LIMIT, shortAddress } from "@shared/watching/elements"
import { statusOf } from "@shared/watching/findings"
import { urlOf } from "@shared/watching/target"
import type { Finding, Run } from "@shared/watching/types"

import { type CheckDeps, HEADERS, plainError } from "./deps"

// The web elements. Every source is public and keyless: chains' public RPCs, Coinbase's spot price,
// Hacker News search (Algolia), Reddit's search, DNS blacklists over DNS, Globalping's free probes, GitHub's
// release API, and a hidden window on this Mac for page vitals. No account, no key, nothing billed.

const failed = (at: number, error: string): Run => ({ at, ms: 0, status: "failed", findings: [], error })
const done = (at: number, d: CheckDeps, findings: Finding[], facts: [string, string][], state: string, metric?: number): Run => ({
  at,
  ms: d.now() - at,
  status: statusOf(findings),
  findings,
  facts,
  state,
  ...(metric !== undefined ? { metric } : {}),
})
const memoOf = <T>(memo: string | undefined, fallback: T): T => {
  try {
    return memo ? (JSON.parse(memo) as T) : fallback
  } catch {
    return fallback
  }
}
const T = 15_000
const getJson = async <J>(d: CheckDeps, url: string, init: RequestInit = {}, f = d.fetch): Promise<J> => {
  const r = await f(url, { ...init, headers: { ...HEADERS, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(T) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as J
}
const rpc = <J>(d: CheckDeps, url: string, method: string, params: unknown[]) =>
  getJson<{ result?: J; error?: { message: string } }>(d, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((j) => {
    if (j.error || j.result === undefined) throw new Error(j.error?.message ?? "No result")
    return j.result
  })
export const usd = (n: number) => (n === 0 ? "$0.00" : n < 0.01 ? `$${n.toPrecision(2)}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

/* Crypto wallets */

export const RPC = { base: "https://mainnet.base.org", ethereum: "https://ethereum-rpc.publicnode.com", solana: "https://api.mainnet-beta.solana.com", tron: "https://api.trongrid.io" }
/** The stablecoin contracts, all with 6 decimals (checked against each contract's symbol() and decimals()). */
export const TOKENS = {
  base: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" },
  ethereum: { USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  solana: { USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
  tron: { USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
} as const
const CHAIN_NAME = { base: "Base", ethereum: "Ethereum", solana: "Solana", tron: "Tron" } as const
type Net = keyof typeof TOKENS
/** One balance: address, chain, token, amount. */
export type Holding = { address: string; chain: Net; token: "USDC" | "USDT"; amount: number }

/** `balanceOf(address)` as eth_call data. */
export const balanceCall = (address: string) => `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`
export const units6 = (hex: string) => Number(BigInt(hex === "0x" ? "0x0" : hex)) / 1e6

async function holdings(address: string, d: CheckDeps): Promise<Holding[]> {
  const chain = chainOf(address)
  const out: Holding[] = []
  if (chain === "evm")
    for (const net of ["base", "ethereum"] as const)
      for (const [token, contract] of Object.entries(TOKENS[net]) as ["USDC" | "USDT", string][])
        out.push({ address, chain: net, token, amount: units6(await rpc<string>(d, RPC[net], "eth_call", [{ to: contract, data: balanceCall(address) }, "latest"])) })
  if (chain === "solana")
    for (const [token, mint] of Object.entries(TOKENS.solana) as ["USDC" | "USDT", string][]) {
      const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] }>(d, RPC.solana, "getTokenAccountsByOwner", [address, { mint }, { encoding: "jsonParsed" }])
      out.push({ address, chain: "solana", token, amount: r.value.reduce((a, x) => a + (x.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0) })
    }
  if (chain === "tron") {
    const j = await getJson<{ data: { trc20?: Record<string, string>[] }[] }>(d, `${RPC.tron}/v1/accounts/${address}`)
    const raw = j.data[0]?.trc20?.find((x) => x[TOKENS.tron.USDT])?.[TOKENS.tron.USDT]
    out.push({ address, chain: "tron", token: "USDT", amount: raw ? Number(raw) / 1e6 : 0 })
  }
  return out
}

/** Balances that went up since the last run: each is a payment in. */
export function payments(now: Holding[], before: Record<string, number>): (Holding & { got: number })[] {
  return now.flatMap((h) => {
    const k = `${h.address}:${h.chain}:${h.token}`
    const was = before[k]
    return was !== undefined && h.amount - was >= 0.005 ? [{ ...h, got: h.amount - was }] : []
  })
}

export async function checkWallets(target: string, d: CheckDeps, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const all: Holding[] = []
  try {
    for (const a of target.split(", ")) all.push(...(await holdings(a, d)))
  } catch (e) {
    return { run: failed(at, `A public chain node didn’t answer (${plainError(e)})`), memo }
  }
  const before = memoOf<Record<string, number>>(memo, {})
  const findings: Finding[] = payments(all, before).map((p) => ({
    key: `pay:${p.address}:${p.chain}:${p.token}:${at}`,
    level: "news",
    headline: `Got ${usd(p.got).slice(1)} ${p.token} on ${CHAIN_NAME[p.chain]}`,
    line: `Got ${usd(p.got).slice(1)} ${p.token} on ${CHAIN_NAME[p.chain]} to ${shortAddress(p.address)}.`,
    detail: `${shortAddress(p.address)} holds ${usd(p.amount).slice(1)} ${p.token} on ${CHAIN_NAME[p.chain]} now.`,
    fix: "none",
    value: Math.round(p.got * 100) / 100,
  }))
  const sum = (t: "USDC" | "USDT") => all.filter((h) => h.token === t).reduce((a, h) => a + h.amount, 0)
  const total = sum("USDC") + sum("USDT")
  const chains = [...new Set(all.filter((h) => h.amount > 0).map((h) => CHAIN_NAME[h.chain]))]
  const facts: [string, string][] = [
    ["USDC", usd(sum("USDC"))],
    ["USDT", usd(sum("USDT"))],
    ["On", chains.length ? chains.join(", ") : "No balance yet"],
  ]
  return { run: done(at, d, findings, facts, `${usd(total)} in USDC and USDT`, Math.round(total * 100) / 100), memo: JSON.stringify(Object.fromEntries(all.map((h) => [`${h.address}:${h.chain}:${h.token}`, h.amount]))) }
}

/* Network fees */

/** Gas a USDC transfer uses on an EVM chain, and compute units a Solana one asks for by default. */
export const TRANSFER_GAS = 65_000
export const SOLANA_CU = 200_000
export const evmFee = (gasPriceHex: string, ethUsd: number) => (Number(BigInt(gasPriceHex)) * TRANSFER_GAS * ethUsd) / 1e18
/** Base fee of 5,000 lamports plus the median recent priority fee (micro-lamports per compute unit). */
export function solanaFee(prio: { prioritizationFee: number }[], solUsd: number): number {
  const fees = prio.map((p) => p.prioritizationFee).sort((a, b) => a - b)
  const median = fees.length ? fees[Math.floor(fees.length / 2)]! : 0
  return ((5000 + (median * SOLANA_CU) / 1e6) / 1e9) * solUsd
}
const spot = (d: CheckDeps, pair: string) => getJson<{ data: { amount: string } }>(d, `https://api.coinbase.com/v2/prices/${pair}/spot`).then((j) => Number(j.data.amount))

export async function checkFees(d: CheckDeps, o: { limit?: number }): Promise<Run> {
  const at = d.now()
  let fees: [string, number][]
  try {
    const [eth, sol, baseGas, ethGas, prio] = await Promise.all([
      spot(d, "ETH-USD"),
      spot(d, "SOL-USD"),
      rpc<string>(d, RPC.base, "eth_gasPrice", []),
      rpc<string>(d, RPC.ethereum, "eth_gasPrice", []),
      rpc<{ prioritizationFee: number }[]>(d, RPC.solana, "getRecentPrioritizationFees", []),
    ])
    fees = [
      ["Base", evmFee(baseGas, eth)],
      ["Solana", solanaFee(prio, sol)],
      ["Ethereum", evmFee(ethGas, eth)],
    ]
  } catch (e) {
    return failed(at, `A public chain node didn’t answer (${plainError(e)})`)
  }
  const limit = o.limit ?? ELEMENT_LIMIT.fees
  const findings: Finding[] = fees
    .filter(([, f]) => f > limit)
    .map(([c, f]) => ({ key: `high:${c}`, level: "problem", headline: `A USDC transfer on ${c} costs ${usd(f)}`, line: `${c} ${usd(f)} a transfer, over $${limit}.`, detail: `Over your $${limit}. Fees on ${c} are high right now; waiting usually helps.`, fix: "none", value: Math.round(f * 100) / 100 }))
  const facts = fees.map(([c, f]): [string, string] => [c, usd(f)])
  return done(at, d, findings, [...facts, ["Per", "USDC transfer, Base without its L1 data fee"]], fees.map(([c, f]) => `${c} ${usd(f)}`).join(", "), Math.round(fees[2]![1] * 1000) / 1000)
}

/* Mentions */

export type Post = { id: string; site: "Hacker News" | "Reddit"; title: string; url: string; at: number }
export const hnPosts = (j: { hits: { objectID: string; title?: string | null; story_title?: string | null; comment_text?: string | null; created_at_i: number }[] }): Post[] =>
  j.hits.map((h) => ({
    id: `hn:${h.objectID}`,
    site: "Hacker News",
    title: (h.title || h.story_title || h.comment_text || "").replace(/<[^>]+>/g, "").slice(0, 140),
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    at: h.created_at_i * 1000,
  }))
const xmlText = (t: string) => t.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "’")
/** Reddit's search feed (Atom): each entry's id, title, link and time. */
export const redditPosts = (xml: string): Post[] =>
  [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: `rd:${e!.match(/<id>([^<]+)<\/id>/)?.[1] ?? ""}`,
    site: "Reddit" as const,
    title: xmlText(e!.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").slice(0, 140),
    url: e!.match(/<link href="([^"]+)"/)?.[1] ?? "",
    at: Date.parse(e!.match(/<(?:published|updated)>([^<]+)</)?.[1] ?? "") || 0,
  }))

/** Why Reddit didn't answer, in plain words: it refuses many apps without an account, and some networks block it. */
async function reddit(d: CheckDeps, q: string): Promise<Post[]> {
  const f = d.netFetch ?? d.fetch
  const r = await f(`https://www.reddit.com/search.rss?q=${q}&sort=new&limit=20`, { headers: HEADERS, signal: AbortSignal.timeout(T) }).catch((e: unknown) => {
    throw new Error(/ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(String(e)) ? "blocked on this network" : plainError(e))
  })
  if (r.status === 403 || r.status === 429) throw new Error("Reddit refused; it blocks most apps without an account")
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return redditPosts(await r.text())
}

export async function checkMentions(target: string, d: CheckDeps, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const q = encodeURIComponent(`"${target}"`)
  const [hn, rd] = await Promise.allSettled([
    getJson<Parameters<typeof hnPosts>[0]>(d, `https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=(story,comment)&hitsPerPage=20`).then(hnPosts),
    reddit(d, q),
  ])
  if (hn.status === "rejected" && rd.status === "rejected") return { run: failed(at, "Neither Hacker News nor Reddit answered"), memo }
  const posts = [...(hn.status === "fulfilled" ? hn.value : []), ...(rd.status === "fulfilled" ? rd.value : [])].sort((a, b) => b.at - a.at)
  const seen = memoOf<string[] | null>(memo, null)
  // The first run only remembers what's there: old posts aren't news.
  const fresh = seen ? posts.filter((p) => !seen.includes(p.id)) : []
  const findings: Finding[] = fresh.slice(0, 5).map((p) => ({ key: `post:${p.id}`, level: "news", headline: `New on ${p.site}: “${p.title}”`, line: `${p.site}: “${p.title}”.`, detail: p.url, fix: "none" }))
  const why = (e: unknown) => (e instanceof Error && /refused|blocked|HTTP/.test(e.message) ? e.message : plainError(e))
  const latest = (site: Post["site"], r: PromiseSettledResult<Post[]>) => (r.status === "rejected" ? `Couldn’t ask: ${why(r.reason)}` : (posts.find((p) => p.site === site)?.title ?? "Nothing yet"))
  const today = posts.filter((p) => at - p.at < 86_400_000).length
  const facts: [string, string][] = [
    ["Hacker News", latest("Hacker News", hn)],
    ["Reddit", latest("Reddit", rd)],
    ["New today", `${today}`],
  ]
  const keep = [...new Set([...posts.map((p) => p.id), ...(seen ?? [])])].slice(0, 400)
  return { run: done(at, d, findings, facts, today ? `${today} new today` : "Nothing new today", today), memo: JSON.stringify(keep) }
}

/* Email deliverability */

/** Public DNS blacklists that answer anyone (an A record in 127.0.0.0/8 means listed). */
export const BLACKLISTS = [
  "zen.spamhaus.org",
  "bl.spamcop.net",
  "b.barracudacentral.org",
  "psbl.surriel.com",
  "bl.mailspike.net",
  "dnsbl-1.uceprotect.net",
  "ix.dnsbl.manitu.net",
  "dnsbl.dronebl.org",
  "all.s5h.net",
  "truncate.gbudb.net",
  "dnsbl.sorbs.net",
  "db.wpbl.info",
]
/** What a blacklist's answer means. Spamhaus answers 127.255.255.x when it refuses a public resolver. */
export function listing(answers: string[] | null): "listed" | "clean" | "refused" {
  if (answers === null) return "refused"
  if (!answers.length) return "clean"
  if (answers.some((a) => /^127\.255\.255\./.test(a) || !a.startsWith("127."))) return "refused"
  return "listed"
}
/** "1.2.3.4" → "4.3.2.1", the order blacklists are asked in. */
export const reverse = (ip: string) => ip.split(".").reverse().join(".")

export async function checkEmail(target: string, d: CheckDeps): Promise<Run> {
  const at = d.now()
  if (!d.records || !d.resolveMx) return failed(at, "DNS can’t be read here")
  const mx = await d.resolveMx(target)
  if (!mx.length) return failed(at, `${target} has no mail servers (no MX records)`)
  const ips = [...new Set((await Promise.all(mx.slice(0, 3).map((h) => d.records!(h, "A").catch(() => [])))).flat())].slice(0, 4)
  if (!ips.length) return failed(at, `${target}’s mail servers have no addresses`)
  // A list that fails or doesn't answer in 5 s counts as not asked, never as clean.
  const ask = (q: string) => Promise.race([d.records!(q, "A").catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 5000))])
  const checks = await Promise.all(ips.flatMap((ip) => BLACKLISTS.map(async (bl) => ({ ip, bl, r: listing(await ask(`${reverse(ip)}.${bl}`)) }))))
  const listed = checks.filter((c) => c.r === "listed")
  const refused = new Set(checks.filter((c) => c.r === "refused").map((c) => c.bl))
  const findings: Finding[] = listed.map((c) => ({
    key: `listed:${c.bl}:${c.ip}`,
    level: "problem",
    headline: `${c.ip} is on ${c.bl}`,
    line: `Listed on ${c.bl}.`,
    detail: `Mail from ${c.ip} (${mx[0]}) may go to spam. Ask your mail provider to request removal from ${c.bl}.`,
    fix: "none",
  }))
  const asked = BLACKLISTS.length - refused.size
  const facts: [string, string][] = [
    ["Listed", `${new Set(listed.map((c) => c.bl)).size} of ${asked}`],
    ["Mail server", mx[0]!],
    ["Addresses", ips.join(", ")],
    ["Lists", `${asked}`],
    ...(refused.size ? [["Couldn’t ask", [...refused].join(", ")] as [string, string]] : []),
  ]
  return done(at, d, findings, facts, `${new Set(listed.map((c) => c.bl)).size} of ${asked} blacklists`, listed.length)
}

/* Global response */

export const GLOBALPING = "https://api.globalping.io/v1/measurements"
const REGIONS = [
  ["NA", "North America"],
  ["EU", "Europe"],
  ["AS", "Asia"],
] as const
type GpResult = { probe: { continent: string; city: string; country: string }; result: { status: string; statusCode?: number; timings?: { total?: number } } }
export const regionName = (c: string) => REGIONS.find(([k]) => k === c)?.[1] ?? c

export async function checkGlobal(target: string, d: CheckDeps, o: { limit?: number }): Promise<Run> {
  const at = d.now()
  let results: GpResult[]
  try {
    const m = await getJson<{ id: string }>(d, GLOBALPING, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "http", target, locations: REGIONS.map(([continent]) => ({ continent, limit: 1 })), measurementOptions: { protocol: "HTTPS", request: { method: "GET", path: "/" } } }),
    })
    let j: { status: string; results: GpResult[] } = { status: "in-progress", results: [] }
    for (let i = 0; i < 30 && j.status === "in-progress"; i++) {
      await d.sleep(1000)
      j = await getJson(d, `${GLOBALPING}/${m.id}`)
    }
    results = j.results
  } catch (e) {
    return failed(at, /429/.test(String(e)) ? "Globalping’s free probes are busy for this hour" : `Globalping didn’t answer (${plainError(e)})`)
  }
  if (!results.length) return failed(at, "No probe answered")
  const limit = o.limit ?? ELEMENT_LIMIT.global
  const findings: Finding[] = []
  const facts: [string, string][] = []
  for (const r of results) {
    const where = regionName(r.probe.continent)
    const ms = r.result.timings?.total
    const bad = r.result.status !== "finished" || !r.result.statusCode || r.result.statusCode >= 500
    facts.push([where, bad ? `Down${r.result.statusCode ? ` (${r.result.statusCode})` : ""}, from ${r.probe.city}` : `${ms} ms from ${r.probe.city}`])
    if (bad) findings.push({ key: `down:${r.probe.continent}`, level: "problem", headline: `${target} doesn’t load from ${where}`, line: `Down from ${where}.`, detail: `A probe in ${r.probe.city}, ${r.probe.country} got ${r.result.statusCode ?? "no answer"}.`, fix: "none" })
    else if (ms !== undefined && ms > limit) findings.push({ key: `slow:${r.probe.continent}`, level: "problem", headline: `${target} takes ${(ms / 1000).toFixed(1)} s from ${where}`, line: `${(ms / 1000).toFixed(1)} s from ${where}.`, detail: `A probe in ${r.probe.city}, ${r.probe.country} took ${ms} ms, over ${limit} ms.`, fix: "none", value: ms })
  }
  const times = results.map((r) => r.result.timings?.total).filter((x): x is number => x !== undefined)
  const slowest = times.length ? Math.max(...times) : undefined
  return done(at, d, findings, facts, results.map((r) => `${regionName(r.probe.continent).replace("North America", "N. America")} ${r.result.timings?.total ?? "–"} ms`).join(", "), slowest)
}

/* Page speed */

/** Google's lines: LCP good under 2.5 s, poor over 4 s; CLS good under 0.1, poor over 0.25. */
export const LCP_POOR = 4000
export const CLS_POOR = 0.25
export const rate = (lcp: number | null, cls: number) => (lcp === null ? "Unknown" : lcp > LCP_POOR || cls > CLS_POOR ? "Poor" : lcp > 2500 || cls > 0.1 ? "Needs work" : "Good")

export async function checkPageSpeed(target: string, d: CheckDeps): Promise<Run> {
  const at = d.now()
  if (!d.vitals) return failed(at, "Page speed needs the app’s hidden window")
  const v = await d.vitals(urlOf(target), 30_000).catch(() => null)
  if (!v) return failed(at, `${target} didn’t load`)
  const findings: Finding[] = []
  if (v.lcp !== null && v.lcp > LCP_POOR)
    findings.push({ key: "lcp", level: "problem", headline: `${target} takes ${(v.lcp / 1000).toFixed(1)} s to show`, line: `LCP ${(v.lcp / 1000).toFixed(1)} s, over 4 s.`, detail: "Its biggest picture or text block shows late. Google calls over 4 s poor.", fix: "agent", value: Math.round(v.lcp) })
  if (v.cls > CLS_POOR)
    findings.push({ key: "cls", level: "problem", headline: `${target} jumps around while it loads`, line: `CLS ${v.cls.toFixed(2)}, over 0.25.`, detail: "Things move after they show. Give images and ads a fixed size.", fix: "agent", value: Math.round(v.cls * 100) / 100 })
  const facts: [string, string][] = [
    ["LCP", v.lcp !== null ? `${(v.lcp / 1000).toFixed(1)} s` : "Not reported"],
    ["CLS", v.cls.toFixed(2)],
    ["First byte", v.ttfb !== null ? `${Math.round(v.ttfb)} ms` : "Unknown"],
    ["Rating", rate(v.lcp, v.cls)],
  ]
  return done(at, d, findings, facts, `LCP ${v.lcp !== null ? `${(v.lcp / 1000).toFixed(1)} s` : "–"}, CLS ${v.cls.toFixed(2)}`, v.lcp !== null ? Math.round(v.lcp) : undefined)
}

/* Desktop downloads */

type Release = { tag_name: string; published_at: string; draft: boolean; assets: { name: string; download_count: number }[] }
export const releaseTotal = (rs: Release[]) => rs.reduce((a, r) => a + r.assets.reduce((b, x) => b + x.download_count, 0), 0)
/** Downloads in the last week from the history of totals ([at, total], oldest first), or since the first one. */
export function weekly(history: [number, number][], now: number): { n: number; since: number } | null {
  if (history.length < 2) return null
  const last = history.at(-1)!
  const from = history.findLast(([t]) => now - t >= 7 * 86_400_000) ?? history[0]!
  return { n: last[1] - from[1], since: from[0] }
}

export async function checkDownloads(target: string, d: CheckDeps, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  let rs: Release[]
  try {
    rs = (await getJson<Release[]>(d, `https://api.github.com/repos/${target}/releases?per_page=50`, { headers: { accept: "application/vnd.github+json" } })).filter((r) => !r.draft)
  } catch (e) {
    const m = String(e)
    return { run: failed(at, /404/.test(m) ? `${target} doesn’t exist on GitHub, or it’s private` : /403|429/.test(m) ? "GitHub’s free API limit is used up for this hour" : `GitHub didn’t answer (${plainError(e)})`), memo }
  }
  if (!rs.length) return { run: failed(at, `${target} has no releases`), memo }
  const total = releaseTotal(rs)
  const prev = memoOf<{ h: [number, number][]; tag?: string }>(memo, { h: [] })
  const h: [number, number][] = [...prev.h, [at, total] as [number, number]].slice(-90)
  const w = weekly(h, at)
  const latest = rs[0]!
  const findings: Finding[] =
    prev.tag && prev.tag !== latest.tag_name ? [{ key: `release:${latest.tag_name}`, level: "news", headline: `${latest.tag_name} is out`, line: `New release ${latest.tag_name}.`, fix: "none" }] : []
  const facts: [string, string][] = [
    ["All time", total.toLocaleString("en-US")],
    ["Latest", `${latest.tag_name}, ${releaseTotal([latest]).toLocaleString("en-US")}`],
    ["This week", w ? `${w.n.toLocaleString("en-US")}${at - w.since < 7 * 86_400_000 - 3_600_000 ? ` since ${new Date(w.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}` : "From the next check"],
  ]
  return { run: done(at, d, findings, facts, w ? `${w.n.toLocaleString("en-US")} downloads this week` : `${total.toLocaleString("en-US")} downloads in all`, total), memo: JSON.stringify({ h, tag: latest.tag_name }) }
}
