import { z } from "zod"

import { cleanTarget, findTarget } from "./target"
import { MORE_WHICH } from "./more"
import { ELEMENT_WHICH, NO_INPUT } from "./elements"
import { type Ask, ELEMENT_KINDS, type Every, type Kind, MORE_KINDS, type NotifyWhen, type Watch, type WatchPatch } from "./types"

// What the model is asked, and how its answers are checked. Three asks, each one structured call:
// reading a sentence into a watch, a custom watch's run, and a reply to a watch. A reply that isn't
// valid JSON in the right shape counts as no answer: the deterministic fallback takes over, and it
// never maps words to a kind.

const EVERY = ["5m", "15m", "1h", "morning"] as const
const KIND_OR_UNCLEAR = ["uptime", "page", "price", "security", "repo", "custom", ...MORE_KINDS, ...ELEMENT_KINDS, "unclear"] as const

/** The first JSON object in a model's reply: bare, in a code fence, or after a line of prose. */
export function jsonIn(text: string): unknown {
  const t = text.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const body = fenced ?? t
  const start = body.indexOf("{")
  if (start < 0) return undefined
  // The last closing brace: the object can hold nested ones.
  for (let end = body.lastIndexOf("}"); end > start; end = body.lastIndexOf("}", end - 1)) {
    try {
      return JSON.parse(body.slice(start, end + 1))
    } catch {}
  }
  return undefined
}

const opt = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => v ?? undefined)

/* 1. A sentence becomes a watch */

const readSchema = z.object({
  kind: z.enum(KIND_OR_UNCLEAR),
  target: opt(z.string()),
  every: opt(z.enum(EVERY)).catch(undefined),
  notify: opt(z.enum(["now", "summary"])).catch(undefined),
  condition: opt(z.string()),
  name: opt(z.string()),
  limit: opt(z.number().positive()).catch(undefined),
  field: opt(z.string()).catch(undefined),
})

export type ReadSentence = { kind: Kind | "unclear"; target?: string; every?: Every; notify?: NotifyWhen; condition?: string; name?: string; limit?: number; field?: string }

export const READ_SYSTEM = [
  "You turn one sentence into a watch for the Axe AI app. Reply with one JSON object and nothing else.",
  `Shape: {"kind": ${KIND_OR_UNCLEAR.map((k) => `"${k}"`).join(" | ")}, "target": string | null, "every": "5m" | "15m" | "1h" | "morning" | null, "notify": "now" | "summary" | null, "condition": string | null, "name": string | null, "limit": number | null, "field": string | null}`,
  "kind: uptime = is a site up and fast. page = tell me when a page's text changes. price = a product's price or stock. security = a domain's email records, certificate, TLS, headers and ports. repo = security alerts in a GitHub repo or a code folder.",
  "health = a JSON health endpoint keeps saying ok, and a number in it stays under a limit. expiry = a domain's certificate or registration runs out. dns = a domain's DNS records change. status = services' public status pages report a problem (GitHub, Cloudflare, Groq, Infura). feed = an app update feed (latest-mac.yml) and the files it names download. seo = robots.txt, sitemap.xml, llms.txt and noindex. links = pages in a site's sitemap stop loading. tests = run a folder's tests and say when they fail. outdated = a folder's packages fall a major version behind. disk = free space on this computer.",
  "This Mac: processes = an app hogging CPU. memory = memory pressure. battery = battery health and what keeps the Mac awake. ports = local dev servers on ports that should keep listening (target: the ports). docker = Docker containers stopping. gitrepos = git repos in a folder with unpushed work or behind their remote (target: the folder). brew = Homebrew updates. macos = macOS updates. timemachine = Time Machine backups getting old. hogs = folders growing on disk (target: folders). network = Wi-Fi, internet speed, IP and VPN.",
  "Web: pagespeed = how fast a page shows (Core Web Vitals). wallets = USDC or USDT balances and payments on crypto addresses (target: the addresses). fees = Base, Solana and Ethereum transaction fees. mentions = new Hacker News or Reddit posts naming something (target: the words). email = a domain's mail servers on spam blacklists. global = a site's response time from regions around the world. downloads = download counts of a GitHub repo's releases (target: owner/repo).",
  "custom = anything else that can be read off one web page. unclear = you can't tell what to watch.",
  "target: the site, page link, product link, domain, GitHub owner/repo, folder or services, exactly as written. disk: the space to keep free, like \"20 GB\", or null. null when the sentence names none (\"my site\" is not a target).",
  'limit (health, expiry, disk only): the number said, in milliseconds (health), days (expiry) or gigabytes (disk). Otherwise null. field (health only): the JSON number named, as a dotted path like "db.latencyMs". Otherwise null.',
  "every and notify: only when the sentence says how often or when to be told. Otherwise null.",
  'condition (custom only): what to look for, as a clause that completes "tell you when …", for example "the Saturday glaze workshop has a seat". Otherwise null.',
  'name (custom only): 2 to 5 words naming what is watched, for example "Saturday glaze workshop seats". Otherwise null.',
].join("\n")

export const readPrompt = (text: string) => `The sentence:\n${text}`

/** The model's reading of a sentence, or null when it isn't valid. */
export function parseRead(reply: string): ReadSentence | null {
  const r = readSchema.safeParse(jsonIn(reply))
  if (!r.success) return null
  const v = r.data
  const target = v.target?.trim() || undefined
  // A custom watch needs a page and something to look for.
  if (v.kind === "custom" && !v.condition?.trim()) return { kind: "unclear", ...(target ? { target } : {}) }
  return {
    kind: v.kind,
    ...(target ? { target } : {}),
    ...(v.every ? { every: v.every } : {}),
    ...(v.notify ? { notify: v.notify } : {}),
    ...(v.limit ? { limit: v.limit } : {}),
    ...(v.field?.trim() ? { field: v.field.trim() } : {}),
    ...(v.kind === "custom" ? { condition: v.condition!.trim().replace(/[.!?]+$/, ""), ...(v.name?.trim() ? { name: shortName(v.name) } : {}) } : {}),
  }
}

/** 2 to 5 words, no end stop. */
const shortName = (n: string) => n.trim().replace(/[.!?]+$/, "").split(/\s+/).slice(0, 6).join(" ")

/** "Which site?": what a sentence with a kind but no target is asked. */
export const WHICH: Record<Kind, string> = {
  uptime: "Which site?",
  page: "Which page?",
  price: "Which product page?",
  security: "Which domain?",
  repo: "Which repo?",
  custom: "Which page?",
  ...MORE_WHICH,
  ...ELEMENT_WHICH,
}

/**
 * No model, or its reply didn't validate: find the first address with the chat's parser and ask what
 * to watch on it. Never a kind from words.
 */
export function fallbackAsk(text: string): Ask {
  const target = findTarget(text)
  return target ? { ask: "kind", question: `What should I watch on ${target}?`, target } : { ask: "kind", question: "What should I watch?" }
}

/** What the model's reading asks next: the kind, the target, or nothing (it's ready to validate). */
export function nextAsk(r: ReadSentence): Ask | null {
  if (r.kind === "unclear") return r.target ? { ask: "kind", question: `What should I watch on ${r.target}?`, target: r.target } : { ask: "kind", question: "What should I watch?" }
  if (!r.target && r.kind !== "disk" && !(NO_INPUT as Kind[]).includes(r.kind) && r.kind !== "gitrepos" && r.kind !== "hogs") return { ask: "target", question: WHICH[r.kind], kind: r.kind }
  // A target the kind can't use ("my shop" for a site) is no target.
  if (!cleanTarget(r.kind, r.target ?? "")) return { ask: "target", question: WHICH[r.kind], kind: r.kind }
  return null
}

/* 2. A custom watch's run */

const customSchema = z.object({
  met: z.boolean(),
  level: opt(z.enum(["news", "problem"])).catch(undefined),
  headline: z.string().min(1),
  detail: opt(z.string()),
  quote: z.string().min(1),
  state: opt(z.string()),
})

export type CustomRead = { met: boolean; level: "news" | "problem"; headline: string; detail?: string; quote: string; state?: string }

export const CUSTOM_SYSTEM = [
  "You read one web page's text for the Axe AI app and say whether something is true. Reply with one JSON object and nothing else.",
  'Shape: {"met": boolean, "level": "news" | "problem", "headline": string, "detail": string, "quote": string, "state": string}',
  "met: true when the page shows what you are told to look for.",
  'level: "problem" only when what you look for is something wrong (an error, an outage). Otherwise "news".',
  'headline: one short sentence saying what you found, for example "A seat opened in the Saturday glaze workshop" or "The workshop is still full". No end stop.',
  'detail: one short sentence with the numbers, for example "2 of 8 seats are free now."',
  "quote: the words on the page your answer is based on, copied exactly, at most 200 characters.",
  'state: one to three words for how things stand, for example "Full" or "2 seats free".',
].join("\n")

export const customPrompt = (condition: string, text: string) => `Look for: ${condition}\n\nThe page's text:\n${text.slice(0, 30_000)}`

export function parseCustom(reply: string): CustomRead | null {
  const r = customSchema.safeParse(jsonIn(reply))
  if (!r.success) return null
  const v = r.data
  return {
    met: v.met,
    level: v.level ?? "news",
    headline: v.headline.trim().replace(/[.!?]+$/, ""),
    ...(v.detail?.trim() ? { detail: v.detail.trim() } : {}),
    quote: v.quote.trim().replace(/^[“"']+|[”"']+$/g, ""),
    ...(v.state?.trim() ? { state: v.state.trim().replace(/[.!?]+$/, "") } : {}),
  }
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()

/** Is the model's quote on the page? Spaces, case and curly quotes don't count. */
export const quoteOnPage = (quote: string, text: string) => quote.trim().length > 0 && squash(text).includes(squash(quote))

/* 3. A price on a page with no product data */

const priceSchema = z.object({ near: z.string().min(2), price: z.number().positive(), currency: opt(z.string()), name: opt(z.string()) })

export const PRICE_SYSTEM = [
  "You find a product's price in one web page's text for the Axe AI app. The page has no product data. Reply with one JSON object and nothing else.",
  'Shape: {"near": string, "price": number, "currency": "USD" | "EUR" | "GBP" | string | null, "name": string | null}',
  "near: the 2 to 8 words just before the product's own price, copied exactly from the page (not a crossed-out price, not another product).",
  "price: the amount as a number. name: the product's name as the page gives it.",
].join("\n")

export const pricePrompt = (text: string) => `The page's text:\n${text.slice(0, 30_000)}`

const MONEY = /^\s*[:\-–]?\s*([$€£])?\s?(\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(USD|EUR|GBP|CAD|AUD)?/i
const SYMBOL_CODE: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" }

/**
 * The price that follows `near` in a page's text (Axe's saved selector for a page with no product data),
 * with the stock from the words around it. Null when the words or the amount aren't there anymore.
 */
export function priceNear(text: string, near: string): { price: number; currency?: string; stock: "In stock" | "Out of stock" | "Unknown" } | null {
  const flat = text.replace(/\s+/g, " ")
  const i = flat.toLowerCase().indexOf(near.replace(/\s+/g, " ").trim().toLowerCase())
  if (i < 0) return null
  const after = flat.slice(i + near.trim().length, i + near.trim().length + 80)
  const m = after.match(MONEY)
  if (!m) return null
  let s = m[2]!.replace(/\s/g, "")
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".")
  else s = s.replace(/,/g, "")
  const price = Number.parseFloat(s)
  if (!Number.isFinite(price) || price <= 0) return null
  const around = flat.slice(Math.max(0, i - 200), i + 300).toLowerCase()
  const stock = /out of stock|sold out|unavailable|notify me when/.test(around) ? "Out of stock" : /in stock|add to cart|add to basket|buy now/.test(around) ? "In stock" : "Unknown"
  const currency = m[3]?.toUpperCase() ?? (m[1] ? SYMBOL_CODE[m[1]] : undefined)
  return { price, ...(currency ? { currency } : {}), stock }
}

/** The model's pick, kept only when the page really shows that amount after those words. */
export function parsePricePick(reply: string, text: string): { near: string; name?: string } | null {
  const r = priceSchema.safeParse(jsonIn(reply))
  if (!r.success) return null
  const found = priceNear(text, r.data.near)
  if (!found || Math.abs(found.price - r.data.price) > 0.005) return null
  return { near: r.data.near.replace(/\s+/g, " ").trim(), ...(r.data.name?.trim() ? { name: r.data.name.trim() } : {}) }
}

/* 4. A reply to a watch */

const replySchema = z.object({
  patch: z
    .object({
      every: opt(z.enum(EVERY)).catch(undefined),
      notify: opt(z.enum(["now", "summary"])).catch(undefined),
      paused: opt(z.boolean()),
      fixedSeconds: opt(z.number().positive()),
      ignore: opt(z.array(z.string())),
      condition: opt(z.string()),
      name: opt(z.string()),
    })
    .nullish(),
  say: z.string().min(1),
})

export const REPLY_SYSTEM = [
  "You look after one watch in the Axe AI app. The user replied in its thread. Reply with one JSON object and nothing else.",
  'Shape: {"patch": {"every": "5m" | "15m" | "1h" | "morning", "notify": "now" | "summary", "paused": boolean, "fixedSeconds": number, "ignore": string[], "condition": string, "name": string} | null, "say": string}',
  "patch: only the fields the reply changes. null when the reply is a question or isn't a change.",
  'every: how often it checks. "morning" is every morning at 7:30. Nothing runs more often than every 5 minutes: if asked, patch is null and say is exactly "I can’t check more often than every 5 minutes."',
  'notify: "now" tells right away, "summary" only in the morning summary. paused: stop or start it.',
  "fixedSeconds (uptime only): tell when the page takes more than this many seconds to load.",
  'ignore (page only): words whose lines should not count as a change. "date" ignores date lines.',
  "condition (custom only): the new thing to look for, as a clause that completes \"tell you when …\".",
  'say: plain and short. For a change, start with "Done." or "Okay." and say what changes. For a question, answer it from the watch\'s history in one or two sentences.',
].join("\n")

export type WatchContext = Pick<Watch, "kind" | "target" | "name" | "every" | "notify" | "paused" | "condition" | "ignore" | "fixedMs"> & {
  latest?: string
  recent?: string[]
}

export const replyPrompt = (w: WatchContext, text: string) => `The watch:\n${JSON.stringify(w)}\n\nThe reply:\n${text}`

export type ReplyRead = { patch: WatchPatch | null; say: string }

/** The model's answer to a reply, as a patch Axe can apply, or null when it isn't valid. */
export function parseReplyAnswer(reply: string, w: Pick<Watch, "kind" | "ignore">): ReplyRead | null {
  const r = replySchema.safeParse(jsonIn(reply))
  if (!r.success) return null
  const p = r.data.patch
  const say = r.data.say.trim()
  if (!p) return { patch: null, say }
  const patch: WatchPatch = {}
  if (p.every) patch.every = p.every
  if (p.notify) patch.notify = p.notify
  if (p.paused !== undefined) patch.paused = p.paused
  if (w.kind === "uptime" && p.fixedSeconds && p.fixedSeconds >= 0.1 && p.fixedSeconds <= 60) patch.fixedMs = Math.round(p.fixedSeconds * 1000)
  if (w.kind === "page" && p.ignore?.length) {
    const rules = p.ignore.map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 60).map((x) => (/^dates?$/i.test(x) ? "date" : `text:${x}`))
    if (rules.length) patch.ignore = [...new Set([...(w.ignore ?? []), ...rules])]
  }
  if (w.kind === "custom" && p.condition?.trim()) patch.condition = p.condition.trim().replace(/[.!?]+$/, "")
  if (p.name?.trim()) patch.name = shortName(p.name)
  return { patch: Object.keys(patch).length ? patch : null, say }
}
