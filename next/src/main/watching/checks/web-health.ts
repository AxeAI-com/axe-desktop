import { statusOf } from "@shared/watching/findings"
import { DEFAULT_LIMIT, DOMAIN_DAYS, NO_FEED, SERVICES, serviceName } from "@shared/watching/more"
import { hostOf, urlOf } from "@shared/watching/target"
import type { CheckRow, Finding, Run } from "@shared/watching/types"

import { type CheckDeps, HEADERS, plainError, TIMEOUT } from "./deps"
import { fetchListed } from "./reach"

// Four of the More kinds, each one plain requests: a JSON health link, certificate and domain expiry
// (the certificate over TLS, the domain from public RDAP), DNS records against the last run's, and the
// public status pages of services you depend on (Statuspage's status.json).

const DAY = 86_400_000
const dayWords = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

/* Health check */

/** Every number in a JSON value, by dotted path ("db.latencyMs"). */
export function numbersIn(v: unknown, at = ""): [string, number][] {
  if (typeof v === "number" && Number.isFinite(v)) return at ? [[at, v]] : []
  if (!v || typeof v !== "object" || Array.isArray(v)) return []
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => numbersIn(x, at ? `${at}.${k}` : k))
}

/** What a health answer says about itself: ok, not ok, or nothing (no `ok` or `status` field). */
export function okOf(v: unknown): { ok: boolean; said: string } | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  if (typeof o.ok === "boolean") return { ok: o.ok, said: `"ok" is ${o.ok}` }
  const s = typeof o.status === "string" ? o.status : typeof o.health === "string" ? o.health : null
  if (s) return { ok: /^(ok|pass|passing|up|healthy|green|operational)$/i.test(s), said: `status is "${s}"` }
  return null
}

const timeLike = (path: string) => /(ms|millis|latency|duration|time)$/i.test(path.split(".").pop() ?? "")

export async function checkHealth(target: string, d: CheckDeps, o: { limit?: number; field?: string } = {}): Promise<Run> {
  const at = d.now()
  const ms = () => Math.round(d.now() - at)
  let res: Response
  let body: string
  try {
    // Redirects are followed by hand, each hop checked: never to this Mac or the local network unless it's the host you chose.
    const url = urlOf(target)
    res = await fetchListed(d, url, url, { init: { headers: { accept: "application/json" } } })
    body = await res.text()
  } catch (e) {
    return { at, ms: ms(), status: "failed", findings: [], error: plainError(e) }
  }
  const took = ms()
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    // A page that isn't JSON can't say ok: say what came back instead.
    const what = res.ok ? "It answered, but not with JSON" : `It answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`
    return { at, ms: took, status: "failed", findings: [], error: what }
  }
  const findings: Finding[] = []
  const facts: [string, string][] = []
  if (!res.ok)
    findings.push({ key: "health:status", level: "problem", headline: `${target} answers ${res.status}`, line: `Answers ${res.status}.`, detail: `It should answer 200. It said ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`, fix: "none" })
  const ok = okOf(json)
  if (ok) facts.push([ok.said.startsWith('"ok"') ? "ok" : "Status", ok.said.startsWith('"ok"') ? String(ok.ok) : ok.said.replace(/^status is "|"$/g, "")])
  if (ok && !ok.ok)
    findings.push({ key: "health:notok", level: "problem", headline: `${target} says it isn’t ok`, line: "Says it isn’t ok.", detail: `Its answer says ${ok.said}.`, fix: "none" })
  const limit = o.limit ?? DEFAULT_LIMIT.health
  const nums = numbersIn(json)
  const held = o.field ? nums.filter(([p]) => p === o.field) : nums.filter(([p]) => timeLike(p))
  if (o.field && !held.length)
    findings.push({ key: `health:missing:${o.field}`, level: "problem", headline: `${o.field} isn’t in the answer anymore`, line: `${o.field} is missing.`, fix: "none" })
  for (const [path, n] of held) {
    facts.push([path, `${Math.round(n * 10) / 10} ms`])
    if (n > limit)
      findings.push({
        key: `health:limit:${path}`,
        level: "problem",
        headline: `${path} is ${Math.round(n)} ms`,
        line: `${path} is ${Math.round(n)} ms, over ${limit} ms.`,
        detail: `That’s over your limit of ${limit} ms.`,
        fix: "none",
        value: n,
      })
  }
  facts.push(["Answered in", `${took} ms`])
  return { at, ms: took, status: statusOf(findings), findings, facts, ...(held[0] ? { metric: held[0][1] } : {}), http: `${res.status}` }
}

/* Certificate and domain expiry */

const SECOND_LEVEL = /\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/

/** The registered domain: "www.shop.lane-ceramics.co.uk" → "lane-ceramics.co.uk". */
export function registered(host: string): string {
  const parts = host.split(".")
  return parts.slice(SECOND_LEVEL.test(host) ? -3 : -2).join(".")
}

/** IANA's list of each top-level domain's RDAP server, read once a day. */
let bootstrap: { at: number; services: [string[], string[]][] } | undefined

async function rdapBase(tld: string, d: CheckDeps): Promise<string | undefined> {
  if (!bootstrap || d.now() - bootstrap.at > DAY) {
    try {
      const res = await fetchListed(d, "https://data.iana.org/rdap/dns.json", "https://data.iana.org/", { strict: true })
      const j = (await res.json()) as { services?: [string[], string[]][] }
      if (j.services?.length) bootstrap = { at: d.now(), services: j.services }
    } catch {}
  }
  return bootstrap?.services.find(([tlds]) => tlds.includes(tld))?.[1][0]
}

/** The domain's expiry from public RDAP (the registry's own server, else rdap.org), or why there's none. */
async function rdapExpiry(domain: string, d: CheckDeps): Promise<{ at: number } | { why: string }> {
  const base = await rdapBase(domain.split(".").pop() ?? "", d)
  const urls = [...(base ? [`${base.replace(/\/?$/, "/")}domain/${domain}`] : []), `https://rdap.org/domain/${domain}`]
  let why = "Not in public RDAP"
  for (const url of urls) {
    try {
      const res = await fetchListed(d, url, url, { strict: true, init: { headers: { accept: "application/rdap+json" } } })
      if (res.status === 404) return { why: "Not in public RDAP" }
      if (!res.ok) {
        why = `Couldn’t read RDAP (${res.status})`
        continue
      }
      const j = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] }
      const e = j.events?.find((x) => x.eventAction === "expiration")?.eventDate
      const t = e ? Date.parse(e) : Number.NaN
      return Number.isFinite(t) ? { at: t } : { why: "Not published by the registry" }
    } catch (e) {
      why = `Couldn’t read RDAP: ${plainError(e).toLowerCase()}`
    }
  }
  return { why }
}

export async function checkExpiry(domain: string, d: CheckDeps, o: { limit?: number } = {}): Promise<Run> {
  const at = d.now()
  const host = hostOf(domain)
  const reg = registered(host)
  const [tls, exp] = await Promise.all([d.tls(host, TIMEOUT).catch(() => ({ days: null, version: null })), rdapExpiry(reg, d)])
  const findings: Finding[] = []
  const rows: CheckRow[] = []
  const facts: [string, string][] = []
  const certLimit = o.limit ?? DEFAULT_LIMIT.expiry
  if (tls.days === null) {
    rows.push({ label: "Certificate", value: "Couldn’t read it", ok: false })
    findings.push({ key: "cert:none", level: "problem", headline: `${host} has no certificate Axe can read`, line: "No certificate answered.", detail: "Nothing answered on port 443, so browsers can’t open it securely.", fix: "none" })
  } else {
    const ends = at + tls.days * DAY
    rows.push({ label: "Certificate", sub: `${tls.days} days left`, value: dayWords(ends), ok: tls.days >= certLimit })
    facts.push(["Certificate", dayWords(ends)])
    if (tls.days < certLimit)
      findings.push({
        key: "cert:expiring",
        level: "problem",
        headline: tls.days < 0 ? `The certificate for ${host} has run out` : `The certificate for ${host} runs out in ${tls.days} ${tls.days === 1 ? "day" : "days"}`,
        line: tls.days < 0 ? "The certificate has run out." : `Certificate runs out in ${tls.days} days.`,
        detail: `It ends ${dayWords(ends)}. Most hosts renew it by themselves a month ahead, so this one isn’t renewing.`,
        fix: "none",
        value: tls.days,
      })
  }
  if ("at" in exp) {
    const days = Math.floor((exp.at - at) / DAY)
    rows.push({ label: "Domain", sub: `${reg}, ${days} days left`, value: dayWords(exp.at), ok: days >= DOMAIN_DAYS })
    facts.push(["Domain", dayWords(exp.at)])
    if (days < DOMAIN_DAYS)
      findings.push({
        key: "domain:expiring",
        level: "problem",
        headline: days < 0 ? `${reg} has expired` : `${reg} expires in ${days} ${days === 1 ? "day" : "days"}`,
        line: days < 0 ? `${reg} has expired.` : `${reg} expires in ${days} days.`,
        detail: `It’s paid until ${dayWords(exp.at)}. Renew it with your registrar, or turn on auto-renew.`,
        fix: "none",
        value: days,
      })
  } else rows.push({ label: "Domain", sub: reg, value: exp.why, ok: true })
  if (tls.days === null && !("at" in exp) && d.resolves && !(await d.resolves(host))) return { at, ms: d.now() - at, status: "failed", findings: [], error: "The address wasn’t found" }
  return { at, ms: d.now() - at, status: statusOf(findings), findings, rows, facts, ...(tls.days !== null ? { metric: tls.days } : {}) }
}

/* DNS changes */

export const DNS_TYPES = ["A", "NS", "MX", "TXT"] as const
type Records = Record<(typeof DNS_TYPES)[number], string[]>

const short = (v: string) => (v.length > 60 ? `${v.slice(0, 57)}…` : v)

export async function checkDns(domain: string, d: CheckDeps, memo?: string): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const host = hostOf(domain)
  if (!d.records) return { run: { at, ms: 0, status: "failed", findings: [], error: "DNS lookups aren’t available here" } }
  let got: string[][]
  try {
    got = await Promise.all(DNS_TYPES.map(async (t) => [...new Set(await d.records!(host, t))].sort()))
  } catch {
    // A failed lookup isn't "no records": the run fails and the last records stay the baseline.
    return { run: { at, ms: d.now() - at, status: "failed", findings: [], error: "The DNS lookup failed. I’ll try again at the next check" }, memo }
  }
  const now = Object.fromEntries(DNS_TYPES.map((t, i) => [t, got[i]!])) as Records
  if (!now.A.length && !now.NS.length) {
    const exists = d.resolves ? await d.resolves(host) : false
    if (!exists) return { run: { at, ms: d.now() - at, status: "failed", findings: [], error: "The address wasn’t found" } }
  }
  const rows: CheckRow[] = DNS_TYPES.map((t) => ({ label: t, sub: `${now[t].length} ${now[t].length === 1 ? "record" : "records"}`, value: now[t].length ? short(now[t].join(", ")) : "None", ok: true }))
  let before: Records | undefined
  try {
    before = memo ? (JSON.parse(memo) as Records) : undefined
  } catch {}
  const findings: Finding[] = []
  for (const t of DNS_TYPES) {
    if (!before) break
    const was = new Set(before[t] ?? [])
    const is = new Set(now[t])
    const added = now[t].filter((x) => !was.has(x))
    const removed = (before[t] ?? []).filter((x) => !is.has(x))
    if (!added.length && !removed.length) continue
    const words = [added.length ? `Added ${and(added.map((x) => `“${short(x)}”`))}.` : "", removed.length ? `Removed ${and(removed.map((x) => `“${short(x)}”`))}.` : ""].filter(Boolean).join(" ")
    if (!now[t].length && (t === "NS" || t === "A")) continue
    findings.push({
      key: `dns:${t}:${at}`,
      level: "news",
      headline: `The ${t} ${now[t].length === 1 && was.size <= 1 ? "record" : "records"} for ${host} changed`,
      line: `${t} changed. ${words}`,
      detail: words,
      fix: "none",
    })
  }
  // No name servers or no address: a problem for as long as it lasts, not a one-off change.
  for (const t of ["NS", "A"] as const)
    if (!now[t].length && (before?.[t]?.length ?? 1))
      findings.push({ key: `dns:none:${t}`, level: "problem", headline: `${host} has no ${t} records`, line: `No ${t} records.`, detail: t === "NS" ? "Without name servers nothing can find the domain." : "Without an address the site can’t load.", fix: "none" })
  // While A or NS records are missing the last ones stay the baseline, so the problem stays open until they're back.
  const keep: Records = { ...now, A: now.A.length ? now.A : (before?.A ?? []), NS: now.NS.length ? now.NS : (before?.NS ?? []) }
  return { run: { at, ms: d.now() - at, status: statusOf(findings), findings, rows }, memo: JSON.stringify(keep) }
}

/* Services you depend on */

type Indicator = "none" | "minor" | "major" | "critical" | "maintenance"
const WORDS: Record<Indicator, string> = { none: "Running normally", minor: "Minor problem", major: "Major outage", critical: "Critical outage", maintenance: "Under maintenance" }

/** One service's Statuspage feed: its indicator, what it says, and its open incidents' names. */
async function statusOf1(id: string, d: CheckDeps): Promise<{ id: string; host: string; indicator?: Indicator; said?: string; incidents: string[]; why?: string }> {
  const host = SERVICES[id]?.host ?? id
  if (NO_FEED[id]) return { id, host, incidents: [], why: "No public status feed" }
  // A status page you named (not one of SERVICES) is checked from its first hop: never this Mac or the local network.
  const get = (url: string, accept?: string) => fetchListed(d, url, url, { strict: !SERVICES[id], init: accept ? { headers: { accept } } : {} })
  try {
    const res = await get(`https://${host}/api/v2/status.json`, "application/json")
    const j = (await res.json().catch(() => null)) as { status?: { indicator?: string; description?: string } } | null
    const ind = j?.status?.indicator as Indicator | undefined
    if (!res.ok || !ind || !(ind in WORDS)) return { id, host, incidents: [], why: "No public status feed" }
    let incidents: string[] = []
    if (ind !== "none") {
      const u = await get(`https://${host}/api/v2/incidents/unresolved.json`).catch(() => null)
      const uj = (await u?.json().catch(() => null)) as { incidents?: { name?: string }[] } | null
      incidents = (uj?.incidents ?? []).map((x) => x.name ?? "").filter(Boolean).slice(0, 3)
    }
    return { id, host, indicator: ind, said: j!.status!.description, incidents }
  } catch (e) {
    return { id, host, incidents: [], why: `Couldn’t read it: ${plainError(e).toLowerCase()}` }
  }
}

export async function checkStatus(target: string, d: CheckDeps): Promise<Run> {
  const at = d.now()
  const ids = target.split(",").map((x) => x.trim()).filter(Boolean)
  const all = await Promise.all(ids.map((id) => statusOf1(id, d)))
  const rows: CheckRow[] = all.map((s) => ({ label: serviceName(s.id), sub: s.host, value: s.why ? (s.why.startsWith("No") ? "Not readable: no public status feed" : s.why) : (WORDS[s.indicator!] ?? s.said ?? ""), ok: !s.why && (s.indicator === "none" || s.indicator === "maintenance") }))
  if (all.every((s) => s.why)) return { at, ms: d.now() - at, status: "failed", findings: [], rows, error: `I can’t read a status for ${and(all.map((s) => serviceName(s.id)))}` }
  const findings: Finding[] = all
    .filter((s) => s.indicator && s.indicator !== "none")
    .map((s) => {
      const name = serviceName(s.id)
      const maint = s.indicator === "maintenance"
      const what = s.incidents.length ? s.incidents.join("; ") : (s.said ?? WORDS[s.indicator!])
      return {
        key: `status:${s.id}:${s.indicator}`,
        level: maint ? ("news" as const) : ("problem" as const),
        headline: maint ? `${name} is under maintenance` : `${name} reports ${s.indicator === "minor" ? "a problem" : "an outage"}`,
        line: `${name}: ${what}.`.replace(/\.\.$/, "."),
        detail: `${what}. From ${s.host}.`.replace(/\.\. /, ". "),
        fix: "none" as const,
      }
    })
  return { at, ms: d.now() - at, status: statusOf(findings), findings, rows }
}
