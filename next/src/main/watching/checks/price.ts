import { money, NO_PRICE, PRICE_GONE, type PriceMemo, priceChange, type Stock } from "@shared/watching/price"
import type { Finding, Run } from "@shared/watching/types"

import { priceNear } from "@shared/watching/read"

import type { CheckDeps } from "./deps"
import { loadPage, textOf, unreadable } from "./page"

// Price and stock, read from what the shop already publishes for search engines: schema.org JSON-LD,
// then microdata, then Open Graph meta tags. The caller saves `memo` and passes it back as `prev`.

export type Price = PriceMemo & { name?: string }

export { money, NO_PRICE, PRICE_GONE }

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v !== "string") return null
  let s = v.replace(/[^\d.,]/g, "")
  // "1.299,00" or "48,00": the comma is the decimal point.
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".")
  else s = s.replace(/,/g, "")
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

const stockOf = (v: unknown): Stock => {
  const s = String(v ?? "").toLowerCase().replace(/^https?:\/\/schema\.org\//, "").replace(/[\s_-]/g, "")
  if (!s) return "Unknown"
  if (/outofstock|soldout|discontinued|^oos$/.test(s)) return "Out of stock"
  if (/instock|limitedavailability|onlineonly|instoreonly|available/.test(s)) return "In stock"
  return "Unknown"
}

type Node = Record<string, unknown>
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v)
const types = (n: Node) => [n["@type"]].flat().map(String)

/** Every object in a JSON-LD block, walking arrays and @graph. */
function nodes(v: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(v)) for (const x of v) nodes(x, out)
  else if (isNode(v)) {
    out.push(v)
    if (v["@graph"]) nodes(v["@graph"], out)
  }
  return out
}

function fromOffer(o: Node): Price | null {
  const price = num(o.price ?? o.lowPrice ?? (isNode(o.priceSpecification) ? o.priceSpecification.price : undefined))
  if (price === null) return null
  const currency = (o.priceCurrency ?? (isNode(o.priceSpecification) ? o.priceSpecification.priceCurrency : undefined)) as string | undefined
  return { price, currency: currency ? String(currency) : undefined, stock: stockOf(o.availability) }
}

function fromJsonLd(html: string): Price | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  const all: Node[] = []
  for (const b of blocks) {
    try {
      nodes(JSON.parse(b[1] ?? ""), all)
    } catch {
      // A broken block is skipped; another one may still have the price.
    }
  }
  for (const n of all.filter((x) => types(x).some((t) => t === "Product" || t === "ProductGroup"))) {
    for (const o of [n.offers].flat().filter(isNode)) {
      const p = fromOffer(o)
      if (p) return { ...p, ...(typeof n.name === "string" && n.name.trim() ? { name: clean(n.name) } : {}) }
    }
  }
  for (const n of all.filter((x) => types(x).some((t) => t === "Offer" || t === "AggregateOffer"))) {
    const p = fromOffer(n)
    if (p) return p
  }
  return null
}

const clean = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "’")
    .replace(/\s+/g, " ")
    .trim()

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]

function fromMicrodata(html: string): Price | null {
  const m = html.match(/<(\w+)[^>]*itemprop=["']price["'][^>]*>([^<]*)/i)
  if (!m) return null
  const tag = m[0].slice(0, m[0].indexOf(">") + 1)
  const price = num(attr(tag, "content") ?? m[2])
  if (price === null) return null
  const cur = html.match(/<[^>]*itemprop=["']priceCurrency["'][^>]*>/i)?.[0]
  const av = html.match(/<[^>]*itemprop=["']availability["'][^>]*>/i)?.[0]
  return { price, currency: cur ? attr(cur, "content") : undefined, stock: stockOf(av ? (attr(av, "href") ?? attr(av, "content")) : "") }
}

function fromMeta(html: string): Price | null {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0])
  const meta = (...names: string[]) => {
    for (const t of metas) {
      const key = (attr(t, "property") ?? attr(t, "name") ?? "").toLowerCase()
      if (names.includes(key)) return attr(t, "content")
    }
    return undefined
  }
  const price = num(meta("og:price:amount", "product:price:amount"))
  if (price === null) return null
  return { price, currency: meta("og:price:currency", "product:price:currency"), stock: stockOf(meta("og:availability", "product:availability")) }
}

/** The price on a product page, or null when the page doesn't publish one. */
export const priceOf = (html: string): Price | null => fromJsonLd(html) ?? fromMicrodata(html) ?? fromMeta(html)

/** The product's name: from its product data, else Open Graph, else the title before " | " or " – ". */
export function productName(html: string, p: Price | null): string | undefined {
  if (p?.name) return p.name
  const micro = html.match(/<[^>]*itemprop=["']name["'][^>]*>([^<]*)/i)
  if (micro) {
    const tag = micro[0].slice(0, micro[0].indexOf(">") + 1)
    const n = clean(attr(tag, "content") ?? micro[1] ?? "")
    if (n) return n
  }
  const og = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, "property") ?? "").toLowerCase() === "og:title")
  const ogName = og ? clean(attr(og, "content") ?? "") : ""
  if (ogName) return ogName
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
  return title.split(/\s+[|–—-]\s+/)[0] || undefined
}

const readMemo = (memo: string | undefined): PriceMemo | null => {
  if (!memo) return null
  try {
    const m = JSON.parse(memo) as { price?: unknown; currency?: unknown; stock?: unknown }
    return typeof m.price === "number" ? { price: m.price, currency: typeof m.currency === "string" ? m.currency : undefined, stock: stockOf(m.stock === "Unknown" ? "" : m.stock) } : null
  } catch {
    return null
  }
}

/**
 * One price run. `prev` is what the last run saved; `missing` counts the runs in a row before this
 * one that found no price. The first miss is a run that couldn't check; the second is a problem.
 * `name` is the watch's name, used in the change's sentence.
 */
export async function checkPrice(
  target: string,
  prev: string | undefined,
  d: CheckDeps,
  o: { missing?: number; name?: string; selector?: string; pick?: (text: string) => Promise<{ near: string; name?: string } | null> } = {},
): Promise<{ run: Run; memo?: string; selector?: string }> {
  const at = d.now()
  const r = await loadPage(target, d)
  const ms = () => Math.round(d.now() - at)
  if (!r.ok) return { run: { at, ms: ms(), status: "failed", findings: [], error: r.error } }
  let p: Price | null = r.status < 400 ? priceOf(r.body) : null
  let found = "Product data"
  let selector: string | undefined
  // No product data: the saved selector, or the model picks one (at setup, and again only if it broke).
  if (!p && r.status < 400 && (o.selector || o.pick)) {
    const text = textOf(r.body)
    const saved = o.selector ? priceNear(text, o.selector) : null
    if (saved) p = saved
    else if (o.pick && !unreadable(r, text)) {
      const picked = await o.pick(text).catch(() => null)
      const fresh = picked ? priceNear(text, picked.near) : null
      if (picked && fresh) {
        p = { ...fresh, ...(picked.name ? { name: picked.name } : {}) }
        selector = picked.near
      }
    }
    if (p) found = "The page’s text"
  }
  if (!p) {
    const bad = unreadable(r, r.status < 400 ? textOf(r.body) : "")
    if (bad) return { run: { at, ms: ms(), status: "failed", findings: [], error: bad } }
    if ((o.missing ?? 0) >= 1 && prev)
      return { run: { at, ms: ms(), status: "problem", findings: [{ key: "price:missing", level: "problem", headline: PRICE_GONE, line: PRICE_GONE, note: PRICE_GONE, fix: "none" }] } }
    return { run: { at, ms: ms(), status: "failed", findings: [], error: NO_PRICE } }
  }
  const product = productName(r.body, p)
  const facts: [string, string][] = [
    ["Price", money(p.price, p.currency)],
    ["Stock", p.stock],
    ["Found in", found],
  ]
  const now: PriceMemo = { price: p.price, ...(p.currency ? { currency: p.currency } : {}), stock: p.stock }
  const memo = JSON.stringify(now)
  const before = readMemo(prev)
  const findings: Finding[] = []
  const c = before ? priceChange(o.name ?? product ?? target, before, now) : null
  if (c && before) {
    const stock = p.stock.toLowerCase().replace(/\s+/g, "-")
    findings.push({
      key: `price:${p.price}:${stock}`,
      level: "news",
      headline: c.headline,
      detail: c.body,
      line: c.line,
      note: c.line,
      fix: "none",
      ev: { from: before.price, to: p.price, ...(p.currency ? { currency: p.currency } : {}), stock: p.stock },
    })
  }
  return {
    run: { at, ms: ms(), status: findings.length ? "news" : "quiet", findings, metric: p.price, stock: p.stock, ...(p.currency ? { currency: p.currency } : {}), ...(product ? { product } : {}), facts },
    memo,
    ...(selector ? { selector } : {}),
  }
}
