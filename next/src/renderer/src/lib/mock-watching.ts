import type { Commands, Events } from "@shared/api"
import { DEFAULT_EVERY, nameFor, planSentence, rowLine } from "@shared/watching/copy"
import { nearRules, pageChange } from "@shared/watching/diff"
import { money, NO_PRICE, priceChange } from "@shared/watching/price"
import { fallbackAsk } from "@shared/watching/read"
import { CANT, readReply } from "@shared/watching/reply"
import { nothingSince, summaryCard, summaryItems } from "@shared/watching/summary"
import { cleanTarget } from "@shared/watching/target"
import type { CheckRow, Finding, FixTurn, News, Step, OpenFinding, PastFinding, RepoAlert, Run, Said, Watch, WatchList, WatchPatch, WatchView } from "@shared/watching/types"
import { evaluateUptime } from "@shared/watching/uptime"
import { ELEMENT_KINDS, type ElementKind, MORE_KINDS, type MoreKind } from "@shared/watching/types"
import { elementDraftError, elementFirstRun, elementsSample } from "./mock-watching-elements"

import { dashSample, moreFirstRun, moreSample } from "./mock-watching-more"

// The fake Watching engine for screenshot tests (?mock=…). "nowatches" starts empty; "watchslow" and
// "watchdown" put the design's slow and down problems on the uptime watch; "watchpage" and
// "watchprice" put an unread change on the page and price watches; anything else starts with the
// design's five quiet watches. Times are relative to now, so the cards read "2:41 pm"-like.

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const quiet = (at: number, metric?: number, facts?: [string, string][]): Run => ({ at, ms: metric ?? 300, status: "quiet", findings: [], metric, facts, ...(metric !== undefined ? { http: "200 OK" } : {}) })

type Item = { watch: Watch; runs: Run[]; open: OpenFinding[]; past: PastFinding[]; said: Said[]; news: News[]; unread: boolean; steps?: Step[]; fixes?: FixTurn[]; checking?: boolean }

/** The design's security check list: email records spoofable (or protected), the rest fine. */
const SEC_ROWS = (emailOk: boolean): CheckRow[] => [
  { label: "Email records", sub: "SPF, DKIM, DMARC", value: emailOk ? "Protected" : "Spoofable", ok: emailOk },
  { label: "Certificate", sub: "lane-ceramics.com", value: "74 days left", ok: true },
  { label: "TLS and headers", value: "TLS 1.3", ok: true },
  { label: "Open ports", sub: "12 checked", value: "80 and 443 only", ok: true },
]
const secRun = (at: number, findings: Finding[] = []): Run => ({ at, ms: 2400, status: findings.length ? "problem" : "quiet", findings, rows: SEC_ROWS(!findings.length), ...(findings.length ? { dmarc: "v=DMARC1; p=none" } : { dmarc: "v=DMARC1; p=quarantine; rua=mailto:dmarc@lane-ceramics.com" }) })
const DMARC: Finding = {
  key: "dmarc:none",
  level: "problem",
  headline: "Anyone can send email as lane-ceramics.com",
  past: "Anyone could send email as lane-ceramics.com",
  line: "Anyone can send email as lane-ceramics.com.",
  detail: "DMARC is set to none and there’s no DKIM record, so mail that fakes your address still gets delivered.",
  fix: "record",
  ev: { record: { name: "_dmarc.lane-ceramics.com", type: "TXT", found: "v=DMARC1; p=none", want: "v=DMARC1; p=quarantine; rua=mailto:dmarc@lane-ceramics.com", how: "Turn on DKIM with your mail provider. Then change this record:" } },
}
const REPO_FACTS: [string, string][] = [
  ["GitHub alerts", "None open"],
  ["Packages", "214, none affected"],
  ["Keys", "None found"],
]
const ALERTS: RepoAlert[] = [
  { source: "package", name: "express", version: "4.18.2", problem: "Open redirect", severity: "high", fixedIn: "4.19.2", id: "GHSA-rv95-896h-c2vc", url: "https://github.com/advisories/GHSA-rv95-896h-c2vc" },
  { source: "package", name: "semver", version: "7.5.1", problem: "Slow regex", severity: "moderate", fixedIn: "7.5.2", id: "GHSA-c2qf-rxjj-qqgw", url: "https://github.com/advisories/GHSA-c2qf-rxjj-qqgw" },
]
const alertFinding = (a: RepoAlert): Finding => ({ key: `alert:${a.name}`, level: "problem", headline: `${a.name} ${a.version}: ${a.problem}`, past: `${a.name} ${a.version}: ${a.problem}`, line: `${a.name} ${a.version}: ${a.problem}.`, fix: "agent", ev: { alert: a } })

const SITE_FACTS: [string, string][] = [
  ["Status", "200 OK"],
  ["Loads in", "0.9 s"],
  ["Largest file", "hero.jpg, 240 KB"],
]

/** The design's pricing page: 412 words, then the shipping line changes and gift wrap is added. */
const FILLER = Array.from({ length: 39 }, (_, i) => `Studio note ${i + 1}: hand thrown and glazed in small batches.`)
const PRICING_BEFORE = ["Pricing", ...FILLER.slice(0, 20), "Wheel-thrown mugs, $38", "Free shipping on orders over $75.", "Returns within 30 days.", ...FILLER.slice(20), "Questions? Write to us at hello@lane-ceramics.com any time."].join("\n")
const PRICING_AFTER = PRICING_BEFORE.replace("Free shipping on orders over $75.", "Free shipping on orders over $50.\nGift wrap is now free.")
const PAGE_FACTS: [string, string][] = [
  ["Words", "412"],
  ["Title", "Pricing, Lane Ceramics"],
  ["Last changed", "Unknown"],
]
const PRICE_FACTS = (p: number): [string, string][] => [
  ["Price", money(p, "USD")],
  ["Stock", "In stock"],
  ["Found in", "Product data"],
]
const priceRun = (at: number, p: number, findings: Finding[] = []): Run => ({ at, ms: 400, status: findings.length ? "news" : "quiet", findings, metric: p, stock: "In stock", currency: "USD", product: "Stoneware clay, 25 lb", facts: PRICE_FACTS(p) })

function pageNews(at: number): News {
  const c = pageChange("lane-ceramics.com/pricing", PRICING_BEFORE, PRICING_AFTER)!
  return { key: "page:mock", level: "news", headline: c.headline, detail: c.body, line: c.line, note: c.line, fix: "none", ev: { diff: c.diff, added: c.added, removed: c.removed, words: c.words, anchors: c.anchors }, at }
}

function priceNews(at: number, from: number, to: number): News {
  const c = priceChange("Stoneware clay, 25 lb", { price: from, currency: "USD", stock: "In stock" }, { price: to, currency: "USD", stock: "In stock" })!
  return { key: `price:${to}:in-stock`, level: "news", headline: c.headline, detail: c.body, line: c.line, note: c.line, fix: "none", ev: { from, to, currency: "USD", stock: "In stock" }, at, facts: PRICE_FACTS(to) }
}

function sample(scenario: string | null, T: number): Item[] {
  const w = (id: string, kind: Watch["kind"], target: string, every: Watch["every"], age = 7 * DAY): Watch => ({ id, kind, target, name: nameFor(kind, target), every, firstEvery: every, notify: "now", createdAt: T - age })
  const strip = (n: number, step: number, metric?: (i: number) => number, facts?: [string, string][]) =>
    Array.from({ length: n }, (_, i) => quiet(T - (n - i) * step, metric?.(i), metric ? (facts ?? SITE_FACTS) : facts))
  const item = (watch: Watch, runs: Run[]): Item => ({ watch: { ...watch, first: runs[0] }, runs, open: [], past: [], said: [], news: [], unread: false })
  const site = item(w("w-site", "uptime", "lane-ceramics.com", "5m"), strip(80, 5 * MIN, (i) => 1050 + ((i * 37) % 300)))
  // Page: the first copy on Oct 24, hourly since. Price: $48 since Oct 1.
  const pageRuns = strip(150, HOUR)
  pageRuns[0] = { ...quiet(T - 7 * DAY), facts: PAGE_FACTS }
  const page = item(w("w-page", "page", "lane-ceramics.com/pricing", "1h"), pageRuns)
  const priceRuns = Array.from({ length: 30 * 24 }, (_, i) => priceRun(T - 30 * DAY + i * HOUR + 15 * MIN, 48))
  const price = item({ ...w("w-price", "price", "northclay.com/stoneware-25", "1h", 30 * DAY), name: "Stoneware clay, 25 lb" }, priceRuns)
  const secRuns = Array.from({ length: 7 }, (_, i) => secRun(T - (7 - i) * DAY))
  const sec = item(w("w-sec", "security", "lane-ceramics.com", "morning"), secRuns)
  const repoRuns = strip(7, DAY, undefined, REPO_FACTS)
  const repo = item({ ...w("w-repo", "repo", "mia/shop-web", "morning"), folder: "~/Code/shop-web" }, repoRuns)
  if (scenario === "watchelements")
    return elementsSample(T, HOUR).map((m) => {
      const x = item(w(m.id, m.kind, m.target, m.every, 14 * DAY), m.runs)
      x.open = m.open
      return x
    })
  if (scenario === "watchdash")
    return dashSample(T, HOUR, DAY).map((m) => {
      const x = item({ ...w(m.id, m.kind, m.target, m.every, 14 * DAY), ...("folder" in m ? { folder: m.folder } : {}) }, m.runs)
      x.open = m.open
      if ("checking" in m) x.checking = m.checking
      return x
    })
  const out = [site, sec, page, price, repo]
  if (scenario === "watchmore")
    for (const m of moreSample(T, HOUR, DAY)) {
      const x = item({ ...w(m.id, m.kind, m.target, m.every), ...("folder" in m ? { folder: m.folder } : {}) }, m.runs)
      x.open = m.open
      out.push(x)
    }
  if (scenario === "watchcustom") {
    // Full since Oct 29; a seat opened at 11:00 am today (T is 2:45 pm).
    const opened = T - 3 * HOUR - 45 * MIN
    const condition = "the Saturday glaze workshop has a seat"
    const asked = "Tell me when a seat opens in the Saturday glaze workshop at claycollective.org/workshops."
    const full = (at: number): Run => ({ ...quiet(at), state: "Full", quote: "Sat 7 Nov, Glazing for stoneware, 10:00 to 13:00. Fully booked.", facts: [["Now", "All 8 seats are taken."]] })
    const quote = "Sat 7 Nov, Glazing for stoneware, 10:00 to 13:00. 2 places left."
    const n: News = { key: `custom:${opened}`, level: "news", headline: "A seat opened in the Saturday glaze workshop", detail: "2 of 8 seats are free now.", line: "A seat opened in the Saturday glaze workshop.", note: "2 of 8 seats are free now.", fix: "none", ev: { quote }, at: opened }
    const runs = Array.from({ length: 48 }, (_, i) => full(opened - (48 - i) * HOUR))
    runs.push({ ...quiet(opened), status: "news", findings: [n], state: "2 seats free", quote })
    const custom: Item = {
      watch: { id: "w-custom", kind: "custom", target: "claycollective.org/workshops", name: "Saturday glaze workshop seats", every: "1h", firstEvery: "1h", notify: "now", createdAt: runs[0]!.at, condition, asked, answerer: { kind: "agent", agentId: "claude-acp" }, first: runs[0] },
      runs,
      open: [],
      past: [],
      said: [],
      news: [n],
      unread: true,
    }
    out.push(custom)
  }
  if (scenario === "watchsec") {
    // This morning at 7:30 the check found DMARC set to none.
    const at = T - 2 * HOUR
    sec.runs = [...sec.runs.slice(1), secRun(at, [DMARC])]
    sec.open = [{ ...DMARC, openedAt: at, lastSeenAt: at, notified: true }]
  }
  if (scenario === "watchrepo") {
    const at = T - 2 * HOUR
    const fs = ALERTS.map(alertFinding)
    repo.runs = [...repo.runs.slice(1), { at, ms: 3000, status: "problem", findings: fs, facts: [["GitHub alerts", "2 open"], ["Packages", "214, 2 affected"], ["Keys", "None found"]], alerts: ALERTS }]
    repo.open = fs.map((f) => ({ ...f, openedAt: at, lastSeenAt: at, notified: true }))
  }

  if (scenario === "watchpage") {
    // The pricing page changed at 10:05 am (4 h 40 min ago); you haven't opened it yet.
    const at = T - 4 * HOUR - 40 * MIN
    const n = pageNews(at)
    page.runs = [...page.runs.filter((r) => r.at < at), { at, ms: 300, status: "news", findings: [n], facts: [["Words", "417"]] }]
    page.news = [n]
    page.unread = true
  }
  if (scenario === "watchprice") {
    // $48 since Oct 1, $45 from Oct 19, $42 since 9:00 am today.
    const at45 = T - 30 * DAY + Math.round(0.62 * 30 * DAY)
    const at42 = T - 5 * HOUR - 45 * MIN
    price.runs = price.runs.filter((r) => r.at <= at42 + 30 * MIN).map((r) => {
      const p = r.at >= at42 ? 42 : r.at >= at45 ? 45 : 48
      return priceRun(r.at, p)
    })
    const first45 = price.runs.findIndex((r) => r.metric === 45)
    const first42 = price.runs.findIndex((r) => r.metric === 42)
    const n45 = priceNews(price.runs[first45]!.at, 48, 45)
    const n42 = priceNews(price.runs[first42]!.at, 45, 42)
    price.runs[first45] = priceRun(n45.at, 45, [n45])
    price.runs[first42] = priceRun(n42.at, 42, [n42])
    price.news = [n45, n42]
    price.unread = true
  }
  if (scenario === "watchslow") {
    // Six photos land, then two slow runs open the problem; the cards show the evidence.
    const files = [{ name: "hero.jpg", url: "https://lane-ceramics.com/hero.jpg", bytes: 240 * 1024 }]
    const big = Array.from({ length: 6 }, (_, i) => ({ name: i ? `vase-${i}.png` : "vase-blue.png", url: `https://lane-ceramics.com/vase-${i}.png`, bytes: (i ? 6.0 : 6.2) * 1024 * 1024 }))
    const history: Run[] = site.runs.slice(0, -5).map((r) => ({ ...r, files }))
    let open: OpenFinding | undefined
    for (const [i, ms] of [3900, 4000, 4200, 4100, 4100].entries()) {
      const at = T + (i + 1) * 5 * MIN - 25 * MIN
      const p = { ok: true as const, status: 200, statusText: "OK", ms: 120, bytes: 18_000 }
      const run = evaluateUptime("lane-ceramics.com", { probe: p, load: { ms, files: big.map((f) => ({ ...f, modified: T - 28 * MIN })) } }, history, {}, at, ms)
      history.push(run)
      const f = run.findings[0]
      if (f && !open) open = { ...f, openedAt: at, lastSeenAt: at, notified: true }
    }
    site.runs = history
    if (open) site.open = [open]
  }
  if (scenario === "watchdown") {
    const book = item({ ...w("w-book", "uptime", "studio-booking.com", "5m"), createdAt: T - 11 * DAY }, strip(96, 5 * MIN, (i) => 560 + ((i * 23) % 90)))
    const down = (at: number): Run => evaluateUptime("studio-booking.com", { probe: { ok: true, status: 502, statusText: "Bad Gateway", ms: 40 } }, [], {}, at, 60_000)
    book.runs = [...book.runs.slice(3), down(T - 14 * MIN), down(T - 9 * MIN), down(T - 4 * MIN)]
    const f = book.runs.at(-3)!.findings[0]!
    book.open = [{ ...f, openedAt: T - 14 * MIN, lastSeenAt: T - 4 * MIN, notified: true }]
    out.unshift(book)
  }
  if (scenario === "watchsummary") {
    // The design's morning: slow at 3:12 am, the pricing page at 5:05, the price at 6:00, security at 7:30.
    const today = (h: number, m: number) => new Date(new Date(T).setHours(h, m, 0, 0)).getTime()
    const slowAt = today(3, 12)
    const slow: Finding = { key: "slow", level: "problem", headline: "lane-ceramics.com is slow", line: "Slow: the home page takes 4.1 s.", note: "Slow: the home page takes 4.1 s, up from 1.2 s.", fix: "agent", value: 4100, ev: { usualMs: 1200, limitMs: 2400 } }
    site.runs = [...site.runs.slice(0, -1), { ...quiet(T - 3 * MIN, 4100, SITE_FACTS), status: "problem", findings: [slow] }]
    site.open = [{ ...slow, openedAt: slowAt, lastSeenAt: T - 3 * MIN, notified: true }]
    const secAt = today(7, 30)
    sec.runs = [...sec.runs.slice(1), secRun(secAt, [DMARC])]
    sec.open = [{ ...DMARC, openedAt: secAt, lastSeenAt: secAt, notified: true }]
    const n = pageNews(today(5, 5))
    page.runs = [...page.runs.filter((r) => r.at < n.at), { at: n.at, ms: 300, status: "news", findings: [n], facts: [["Words", "417"]] }]
    page.news = [n]
    page.unread = true
    const p = priceNews(today(6, 0), 45, 42)
    price.runs = [...price.runs.filter((r) => r.at < p.at).map((r) => priceRun(r.at, 45)), priceRun(p.at, 42, [p])]
    price.news = [p]
    price.unread = true
  }
  return out
}

type Names =
  | "watching:list"
  | "watching:get"
  | "watching:runs"
  | "watching:draft"
  | "watching:read"
  | "watching:create"
  | "watching:update"
  | "watching:delete"
  | "watching:checkNow"
  | "watching:act"
  | "watching:reply"
  | "watching:seen"
  | "watching:fix"
  | "watching:fixDone"
  | "watching:fixAgain"
  | "watching:repos"
  | "watching:folders"
  | "watching:summary"
  | "watching:summaryClose"

/** Price over the last 30 days: the first point, each change and the latest. */
function series(runs: Run[], now: number): [number, number][] {
  const pts = runs.filter((r) => r.status !== "failed" && r.metric !== undefined && r.at >= now - 30 * DAY)
  const out: [number, number][] = []
  for (const r of pts) if (!out.length || out.at(-1)![1] !== r.metric) out.push([r.at, r.metric!])
  const last = pts.at(-1)
  if (last && out.at(-1)![0] !== last.at) out.push([last.at, last.metric!])
  return out
}

export function mockWatching(scenario: string | null, emit: <K extends keyof Events>(e: K, p: Events[K]) => void) {
  const T = Date.now()
  let items = scenario === "nowatches" ? [] : sample(scenario, T)
  let seq = 0

  const view = ({ watch, runs, open, past, said, news, unread, steps, fixes, checking }: Item): WatchView => {
    const latest = runs.at(-1)
    const lastNews = news.findLast((n) => !n.ignored)
    const since = lastNews?.at ?? watch.first?.at ?? watch.createdAt
    return {
      ...watch,
      latest,
      open,
      failedStreak: 0,
      nextAt: watch.paused ? null : T + 5 * MIN,
      strip: runs.slice(-120).map((r) => ({ at: r.at, status: r.status, metric: r.metric, ms: r.ms, ...(r.http ? { http: r.http } : {}), ...(r.stock ? { stock: r.stock } : {}), ...(r.state ? { state: r.state } : {}) })),
      line: rowLine(watch.kind, latest, { since, ...(unread && lastNews ? { unread: lastNews } : {}) }),
      past,
      said,
      news,
      unread: unread && !!lastNews,
      ...(watch.kind === "price" ? { prices: series(runs, T) } : {}),
      ...(steps ? { steps } : {}),
      ...(checking ? { checking } : {}),
      fixes: fixes ?? [],
    }
  }
  const problemAt = (v: WatchView) => Math.max(0, ...v.open.map((f) => f.openedAt))
  const sorted = () => items.map(view).sort((a, b) => problemAt(b) - problemAt(a) || a.name.localeCompare(b.name))
  // The morning summary as the real engine writes it: at 8:00 today, covering the day before.
  const eight = new Date(new Date(T).setHours(8, 0, 0, 0)).getTime()
  const summaryText = (now: number) => {
    const items = summaryItems(sorted(), now - DAY, now)
    return summaryCard(items, now - DAY, now) ?? nothingSince(now - DAY, now)
  }
  let summary: { at: number; text: string } | null = scenario === "watchsummary" ? { at: eight, text: summaryText(eight) } : null
  const list = (): WatchList => ({ watches: sorted(), ...(summary ? { summary } : {}) })
  const changed = () => {
    const l = list()
    emit("watching", l)
    return l
  }
  const find = (id: string) => items.find((x) => x.watch.id === id)
  const say = (x: Item, s: Omit<Said, "at">) => {
    x.said = [...x.said, { at: Math.max(Date.now(), (x.said.at(-1)?.at ?? 0) + 1), ...s }]
  }

  const handlers: { [K in Names]: (...a: Parameters<Commands[K]>) => Awaited<ReturnType<Commands[K]>> } = {
    "watching:list": list,
    "watching:get": (id) => {
      const x = find(id)
      return x ? view(x) : null
    },
    "watching:runs": (id) => find(id)?.runs ?? [],
    "watching:draft": ({ kind, target, answerer }) => {
      if ((ELEMENT_KINDS as string[]).includes(kind)) {
        const e = elementDraftError(kind as ElementKind, target)
        if (e) return e
        const t = cleanTarget(kind, target)!
        const first = elementFirstRun(kind as ElementKind, T)
        const name = nameFor(kind, t)
        const every = DEFAULT_EVERY[kind]
        return { kind, target: t, name, every, notify: "now", answerer, plan: planSentence(kind, t, every, "now", { name, first }), first }
      }
      const t = cleanTarget(kind, target)
      if (!t && (kind === "tests" || kind === "outdated") && /^~\/(Desktop|Documents|Downloads|Library)\b/.test(target.trim())) return { error: "Axe doesn’t run things in Desktop, Documents, Downloads or Library. Pick a project folder." }
      if (!t) return { error: kind === "page" || kind === "price" ? "That doesn’t look like a link." : "That doesn’t look like a site address." }
      if (t.startsWith("lane-ceramcs")) return { error: `${t.split("/")[0]} doesn’t exist. Check the spelling.` }
      if (kind === "page" && t.endsWith("/prices")) return { error: "That page returns Not found (404)." }
      if (kind === "price" && t.endsWith("/about")) return { error: NO_PRICE, button: { label: "Watch the page instead", kind: "page", target: t } }
      if (kind === "repo" && t === "mia/shop-api") return { error: "Axe can’t see mia/shop-api. Check the name, or sign in with gh auth login." }
      const every = DEFAULT_EVERY[kind]
      if ((MORE_KINDS as string[]).includes(kind)) {
        const first = moreFirstRun(kind as MoreKind, T)
        const name = nameFor(kind, t)
        return { kind, target: t, name, every, notify: "now", answerer, plan: planSentence(kind, t, every, "now", { name, first }), first, ...(kind === "tests" || kind === "outdated" ? { folder: t } : {}) }
      }
      const first =
        kind === "uptime" ? quiet(T, 900, SITE_FACTS) : kind === "page" ? { ...quiet(T), facts: PAGE_FACTS } : kind === "price" ? priceRun(T, 48) : quiet(T)
      const name = kind === "price" ? "Stoneware clay, 25 lb" : nameFor(kind, t)
      return { kind, target: t, name, every, notify: "now", answerer, plan: planSentence(kind, t, every, "now", { name, first }), first }
    },
    // The design's free-text screens: a custom sentence, an unclear one, one with no target, a typo.
    "watching:read": ({ text, answerer }) => {
      const t = text.trim()
      if (/glaze workshop/i.test(t)) {
        const first: Run = { ...quiet(T), state: "Full", facts: [["Now", "All 8 seats are taken."]] }
        const condition = "the Saturday glaze workshop has a seat"
        return { kind: "custom", target: "claycollective.org/workshops", name: "Saturday glaze workshop seats", every: "1h", notify: "now", answerer, condition, asked: t, first, plan: planSentence("custom", "claycollective.org/workshops", "1h", "now", { first, condition }) }
      }
      if (/my site/i.test(t)) return { ask: "target", question: "Which site?", kind: "uptime" }
      if (/lane-ceramics\.co\//.test(t))
        return { error: "I couldn’t reach lane-ceramics.co. That domain doesn’t exist.", button: { label: "Use lane-ceramics.com/pricing", kind: "page", target: "lane-ceramics.com/pricing" }, kind: "page", target: "lane-ceramics.co/pricing" }
      return fallbackAsk(t)
    },
    "watching:create": (d) => {
      const x: Item = {
        watch: { id: `w-new-${++seq}`, kind: d.kind, target: d.target, name: d.name, every: d.every, firstEvery: d.every, notify: d.notify, answerer: d.answerer, createdAt: T, first: d.first },
        runs: [d.first],
        open: [],
        past: [],
        said: [],
        news: [],
        unread: false,
      }
      // Security: the four checks tick off, then the design's first result (one thing to fix, not notified).
      if (d.kind === "security" || d.kind === "repo") {
        x.runs = []
        x.watch.first = undefined
        x.steps =
          d.kind === "security"
            ? [
                { label: "Email records", state: "done" },
                { label: "Certificate", state: "done" },
                { label: "TLS and headers", state: "run" },
                { label: "Open ports", state: "run" },
              ]
            : [
                { label: "GitHub alerts", state: "done" },
                { label: "Packages", state: "run" },
                { label: "Leaked keys", state: "todo" },
              ]
        setTimeout(() => {
          const first: Run = d.kind === "security" ? secRun(T, [DMARC]) : { ...quiet(T), facts: REPO_FACTS }
          x.runs = [first]
          x.watch = { ...x.watch, first }
          if (d.kind === "security") x.open = [{ ...DMARC, openedAt: T, lastSeenAt: T }]
          x.steps = undefined
          changed()
        }, 1500)
      }
      // Page and price: "Checking now" shows while the first copy is saved (?mockhold keeps it).
      const label = d.kind === "page" ? "Saving its text" : d.kind === "price" ? "Finding the price" : null
      if (label) {
        x.steps = [
          { label: "Loading the page", state: "done" },
          { label, state: "run" },
        ]
        setTimeout(() => {
          x.steps = undefined
          changed()
        }, 1500)
      }
      items = [...items, x]
      changed()
      return view(x)
    },
    "watching:update": (id, patch) => {
      const x = find(id)
      if (!x) return null
      if (patch.target && cleanTarget(x.watch.kind, patch.target)?.startsWith("lane-ceramcs")) return { error: `${cleanTarget(x.watch.kind, patch.target)!.split("/")[0]} doesn’t exist. Check the spelling.` }
      if (patch.paused === true && !x.watch.paused) x.watch = { ...x.watch, pausedAt: Date.now() }
      if (patch.paused === false && x.watch.paused) say(x, { you: "", axe: "Resumed. Checking now." })
      x.watch = { ...x.watch, ...patch }
      changed()
      return view(x)
    },
    "watching:delete": (id) => {
      items = items.filter((x) => x.watch.id !== id)
      return changed()
    },
    "watching:checkNow": (id) => {
      const x = find(id)
      if (!x) return null
      const now = Date.now()
      const k = x.watch.kind
      // A security check after Copy record still sees the old record: "The record hasn't changed yet."
      // (The test clock stands still, so "after" is a millisecond on.)
      if (k === "security" && x.open.length) x.open = x.open.map((o) => ({ ...o, lastSeenAt: Math.max(now, (o.copiedAt ?? 0) + 1) }))
      x.runs = [...x.runs, k === "price" ? priceRun(now, x.runs.at(-1)?.metric ?? 48) : k === "security" ? secRun(now, x.open.length ? [DMARC] : []) : quiet(now, k === "uptime" ? 900 : undefined)]
      changed()
      return view(x)
    },
    "watching:act": (id, key, act) => {
      const x = find(id)
      if (!x) return null
      const f = x.open.find((o) => o.key === key)
      if (act === "ignore") {
        const n = x.news.find((o) => o.at === Number(key))
        if (n) {
          const before = x.watch.ignore ?? []
          x.watch = { ...x.watch, ignore: [...new Set([...before, ...nearRules(n.ev?.anchors?.length ? n.ev.anchors : [""])])] }
          x.news = x.news.map((o) => (o === n ? { ...o, ignored: true } : o))
          say(x, { you: "", axe: "Okay. I’ll ignore changes in that part of the page.", undo: { ignore: before }, undoNews: n.at })
        }
      } else if (act === "undo") {
        const s = x.said.find((o) => o.at === Number(key))
        if (s?.undo && !s.undone) {
          x.watch = { ...x.watch, ...s.undo }
          x.said = x.said.map((o) => (o === s ? { ...o, undone: true } : o))
          if (s.undoNews !== undefined) x.news = x.news.map((o) => (o.at === s.undoNews ? { ...o, ignored: false } : o))
        }
      } else if (act === "copied" && f) {
        x.open = x.open.map((o) => (o.key === key ? { ...o, copiedAt: Date.now() } : o))
      } else if (act === "expected" && f) {
        x.open = x.open.filter((o) => o.key !== key)
        x.past = [...x.past, { ...f, closedAt: Date.now(), how: "expected" }]
        if (key === "slow") x.watch = { ...x.watch, usual: { ms: x.runs.at(-1)?.metric ?? 0, at: Date.now() } }
      } else if (act === "unexpected") {
        const p = x.past.findLast((o) => o.key === key && o.how === "expected")
        if (p) {
          x.past = x.past.filter((o) => o !== p)
          x.open = [...x.open, p]
        }
      } else if (f) {
        const until = act === "unsnooze" ? undefined : Date.now() + (act === "snooze1h" ? HOUR : act === "snoozeDay" ? DAY : 7 * DAY)
        x.open = x.open.map((o) => (o.key === key ? { ...o, snoozedUntil: until } : o))
      }
      changed()
      return view(x)
    },
    "watching:reply": (id, text) => {
      const x = find(id)
      if (!x) return null
      const r = readReply(x.watch, text)
      if (r) {
        const undo = Object.fromEntries(Object.keys(r.patch).map((k) => [k, x.watch[k as keyof WatchPatch]])) as WatchPatch
        x.watch = { ...x.watch, ...r.patch }
        say(x, { you: text, axe: r.say, ...(r.undo ? { undo } : {}) })
      } else say(x, { you: text, axe: CANT })
      changed()
      return view(x)
    },
    // Screenshot tests stop at the folder question: a fix needs a real agent.
    "watching:fix": (id, keys) => {
      const x = find(id)
      if (!x) return null
      const headline = x.watch.kind === "repo" ? `${keys.length} new security alerts in ${x.watch.name}` : (x.open.find((f) => keys.includes(f.key))?.headline ?? "")
      x.fixes = [...(x.fixes ?? []), { at: Date.now(), keys, headline, agent: "Claude Code", answerer: { kind: "agent", agentId: "claude" }, state: "asking" }]
      changed()
      return view(x)
    },
    "watching:fixDone": (id) => {
      const x = find(id)
      return x ? view(x) : null
    },
    "watching:fixAgain": (id) => {
      const x = find(id)
      return x ? view(x) : null
    },
    "watching:repos": () => ({ repos: ["mia/shop-web", "mia/lane-theme"], folders: ["~/Code/shop-web", "~/Code/lane-theme"] }),
    "watching:folders": () => [
      { path: "~/Code/lane-theme", about: "Shopify theme, changed today" },
      { path: "~/Code/shop-web", about: "Node app, changed yesterday" },
    ],
    "watching:summary": () => {
      summary = { at: Date.now(), text: summaryText(Date.now()) }
      return changed()
    },
    "watching:summaryClose": () => {
      summary = null
      return changed()
    },
    "watching:seen": (id) => {
      const x = find(id)
      if (!x) return null
      if (x.unread) {
        x.unread = false
        changed()
      }
      return view(x)
    },
  }
  return { handlers }
}
