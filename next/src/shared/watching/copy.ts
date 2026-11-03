import { EVERY_LABEL } from "./schedule"
import { type PriceMemo, priceFirst, pricePlan, priceRow, priceStrip } from "./price"
import { ELEMENT_ASK, ELEMENT_EVERY, ELEMENT_LABEL, elementFirst, elementName, elementPlan, elementQuiet, elementSentence } from "./elements"
import { MORE_ASK, MORE_EVERY, MORE_LABEL, moreFirst, moreName, morePlan, moreQuiet, moreSentence } from "./more"
import type { ElementKind, Every, Finding, Kind, MoreKind, News, NotifyWhen, RepoAlert, Run } from "./types"
import { roughSeconds, seconds, uptimeLine, where } from "./uptime"

// Every sentence Watching shows that isn't the model's: written from templates, so it reads the same each time.

export const KIND_LABEL: Record<Kind, string> = {
  uptime: "Uptime and speed",
  page: "Page changes",
  price: "Price and stock",
  security: "Security",
  repo: "Repo alerts",
  custom: "Custom",
  ...MORE_LABEL,
  ...ELEMENT_LABEL,
}

export const DEFAULT_EVERY: Record<Kind, Every> = { uptime: "5m", page: "1h", price: "1h", security: "morning", repo: "morning", custom: "1h", ...MORE_EVERY, ...ELEMENT_EVERY }

const isMore = (k: Kind): k is MoreKind => k in MORE_LABEL
const isElement = (k: Kind): k is ElementKind => k in ELEMENT_LABEL

/** What the composer asks for after a starter. */
export const ASK: Record<Exclude<Kind, "custom">, string> = {
  uptime: "Site address, like lane-ceramics.com",
  page: "Page link, like lane-ceramics.com/pricing",
  price: "Product page link",
  security: "Domain, like lane-ceramics.com",
  repo: "Repo or folder, like mia/shop-web",
  ...MORE_ASK,
  ...ELEMENT_ASK,
}

/** The bubble: what a person would have said. */
export function sentence(kind: Kind, target: string, condition?: string, limit?: number): string {
  if (isMore(kind)) return moreSentence(kind, target, limit)
  if (isElement(kind)) return elementSentence(kind, target, limit)
  switch (kind) {
    case "uptime":
      return `Tell me if ${target} goes down or gets slow.`
    case "page":
      return `Tell me when ${target} changes.`
    case "price":
      return `Tell me when the price or stock changes on ${target}.`
    case "security":
      return `Check ${target} for security problems.`
    case "repo":
      return `Tell me about new security alerts in ${nameFor(kind, target)}.`
    case "custom":
      return condition ?? `Watch ${target}.`
  }
}

/** A repo's name: "mia/shop-web" and "~/Code/shop-web" are both "shop-web". */
export const repoName = (target: string) => target.replace(/\/+$/, "").split("/").pop() || target

/** A watch's name: the target, the repo's name, or "<domain> security". */
export function nameFor(kind: Kind, target: string): string {
  if (isMore(kind)) return moreName(kind, target)
  if (isElement(kind)) return elementName(kind, target)
  if (kind === "security") return `${target} security`
  if (kind === "repo") return repoName(target)
  return target
}

const often = (every: Every) => (every === "morning" ? "every morning at 7:30" : EVERY_LABEL[every].toLowerCase())

/** The folded plan under the bubble: "Watching. Every morning at 7:30, tells you right away." */
export const foldedPlan = (every: Every, notify: NotifyWhen) =>
  `Watching. ${every === "morning" ? "Every morning at 7:30" : EVERY_LABEL[every]}, ${notify === "now" ? "tells you right away" : "tells you in the morning summary"}.`

/** A price run's amount and stock, when it found them. */
export const priceOfRun = (r: Run | undefined): PriceMemo | undefined =>
  r && r.metric !== undefined && r.status !== "failed" && r.stock ? { price: r.metric, currency: r.currency, stock: r.stock } : undefined

/** "Oct 24", or the time for today: when a quiet stretch began. */
export function sinceWords(t: number, now = Date.now()): string {
  const d = new Date(t)
  if (d.toDateString() === new Date(now).toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** The plan under the bubble. Price names the product and its price from the first run. */
export function planSentence(
  kind: Kind,
  target: string,
  every: Every,
  notify: NotifyWhen,
  extra?: { name?: string; first?: Run; condition?: string; limit?: number; field?: string; command?: string },
): string {
  const tell = notify === "now" ? "tell you" : "put it in your morning summary"
  if (isMore(kind)) return morePlan(kind, target, often(every), tell, extra ?? {})
  if (isElement(kind)) return elementPlan(kind, target, often(every), tell, extra ?? {})
  switch (kind) {
    case "uptime":
      return `I’ll load ${target} ${often(every)} and ${tell} if it goes down or gets much slower than usual.`
    case "page":
      return `I’ll read this page ${often(every)} and ${tell} what changed, in one line.`
    case "price":
      return pricePlan(extra?.name ?? target, priceOfRun(extra?.first), often(every), tell)
    case "security":
      return `${every === "morning" ? "Every morning" : EVERY_LABEL[every]} I’ll check ${target}’s email records, certificate, TLS and headers, and open ports.`
    case "repo":
      return `${every === "morning" ? "Every morning" : EVERY_LABEL[every]} I’ll check ${nameFor(kind, target)} for new security alerts, vulnerable packages and leaked keys.`
    case "custom": {
      const now = customNow(extra?.first)
      return `I’ll read ${target} ${often(every)} and ${tell} when ${extra?.condition ?? "your sentence comes true"}.${now ? ` ${now}` : ""}`
    }
  }
}

/** How a custom watch stands, from the model's answer: "It’s full now." or its own sentence. */
export function customNow(r: Run | undefined): string {
  if (!r || r.status === "failed") return ""
  if (r.state && !/\s/.test(r.state)) return `It’s ${r.state.toLowerCase()} now.`
  const said = r.facts?.find(([a]) => a === "Now" || a === "Found")?.[1]
  return said ? `${stop(said)}.` : ""
}

/** The first message after a watch starts: the first result, in Axe's voice. */
export function firstMessage(kind: Kind, target: string, first: Run, every: Every): string {
  const fact = (label: string) => first.facts?.find(([a]) => a === label)?.[1]
  const problems = first.findings.filter((f) => f.level === "problem").length
  if (first.status === "failed") return `I couldn’t check ${target} yet. ${first.error ? `${stop(first.error)}. ` : ""}I’ll try again ${often(every)}.`
  if (isMore(kind)) return moreFirst(kind, target, first, often(every)) ?? `I’ll check ${often(every)}.`
  if (isElement(kind)) return elementFirst(kind, first, often(every))
  switch (kind) {
    case "uptime":
      if (first.status === "quiet" && first.metric !== undefined)
        return `${target} is up and loads in ${seconds(first.metric)}. I’ll check ${often(every)} and stay quiet unless that changes.`
      break
    case "page": {
      const words = fact("Words")
      if (words) return `Saved a copy of the page: ${words} ${words === "1" ? "word" : "words"}. I’ll compare it ${often(every)}.`
      break
    }
    case "price": {
      const p = priceOfRun(first)
      if (p) return priceFirst(p, often(every))
      break
    }
    case "security": {
      const fine = first.rows?.some((r) => r.ok) ?? true
      if (problems) return `${problems === 1 ? "One thing" : `${problems} things`} to fix.${fine ? " Everything else looks right." : ""}`
      return `Everything looks right. I’ll check ${often(every)}.`
    }
    case "custom": {
      const now = customNow(first)
      if (now) return `${now} I’ll check ${often(every)}.`
      break
    }
    case "repo": {
      if (problems) return `${problems === 1 ? "One thing" : `${problems} things`} to fix.`
      const gh = fact("GitHub alerts")
      const pk = fact("Packages")?.match(/^(\d+),/)?.[1]
      const keys = fact("Keys")
      const parts = [
        gh === "None open" ? "No open alerts." : "",
        pk ? `${pk} ${pk === "1" ? "package" : "packages"}, none with known problems.` : "",
        keys === "None found" ? "No keys in the code." : "",
      ].filter(Boolean)
      return parts.length ? parts.join(" ") : `No open alerts. I’ll check ${often(every)}.`
    }
  }
  return `I’ll check ${often(every)} and stay quiet unless something changes.`
}

const stop = (t: string) => t.trim().replace(/[.!?]+$/, "")

/**
 * The watch row's one line: the latest fact, never a verdict. `unread`: a change you haven't seen,
 * told in its own line. `since`: when page's quiet stretch began ("No changes since Oct 24.").
 */
export function rowLine(kind: Kind, latest: Run | undefined, ctx: { unread?: News; since?: number; now?: number } = {}): string {
  if (kind === "uptime") return uptimeLine(latest)
  if (!latest) return "Not checked yet."
  if (latest.status === "failed") {
    // "Claude Code isn’t signed in, so this can’t run." says it all.
    if (latest.error && /can’t run\.$/.test(latest.error)) return latest.error
    return latest.error ? `Couldn’t check. ${stop(latest.error)}.` : "Couldn’t check."
  }
  const problems = latest.findings.filter((f) => f.level === "problem")
  if (kind === "repo" && problems.length > 1) return `${problems.length} new security alerts.`
  if (problems.length > 1) return `${stop(problems[0]!.headline)}, and ${problems.length - 1} more.`
  if (problems.length === 1) return problems[0]!.line ?? `${stop(problems[0]!.headline)}.`
  if (ctx.unread) return ctx.unread.line ?? ctx.unread.detail ?? `${stop(ctx.unread.headline)}.`
  switch (kind) {
    case "page":
      return ctx.since !== undefined ? `No changes since ${sinceWords(ctx.since, ctx.now)}.` : "No changes."
    case "price": {
      const p = priceOfRun(latest)
      return p ? priceRow(p) : "No changes."
    }
    case "security":
      return "No issues found."
    case "repo":
      return "No open alerts."
    case "custom":
      return latest.state ? `${stop(latest.state)}.` : "No changes."
    default:
      return isMore(kind) ? moreQuiet(kind, latest) : isElement(kind) ? elementQuiet(latest) : "No changes."
  }
}

/** What Axe says after "That's expected". */
export const expectedSay = (target: string, key: string, ms?: number) =>
  key === "slow" && ms ? `Okay. I’ll treat about ${roughSeconds(ms)} as usual for ${where(target)} now.` : "Okay. I won’t tell you about this one again."

/** A closed problem, folded to one line: "Down from 3:05 to 3:19 pm", "2:41 pm. lane-ceramics.com was slow, 4.1 s." */
export function foldedLine(
  f: { key: string; headline: string; past?: string; openedAt: number; closedAt?: number; value?: number },
  target: string,
  how: "cleared" | "expected" | "open" | "fixed",
): string {
  const t = (x: number) => new Date(x).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()
  // Security and repo findings read in the past once they're gone: "7:30 am. Anyone could send email as …".
  if (f.past && how !== "open" && f.key !== "slow" && f.key !== "down") return `${t(f.openedAt)}. ${stop(f.past)}.`
  if (how === "fixed" && f.key !== "slow") return `${t(f.openedAt)}. ${stop(f.headline)}.`
  if (how === "cleared" && f.closedAt) {
    const a = t(f.openedAt)
    const b = t(f.closedAt)
    const same = a.slice(-2) === b.slice(-2)
    const what = f.key === "down" ? "Down" : f.key === "slow" ? "Slow" : f.headline
    return `${what} from ${same ? a.slice(0, -3) : a} to ${b}`
  }
  if (f.key === "slow") return `${t(f.openedAt)}. ${target} ${how === "open" ? "is" : "was"} slow${f.value ? `, ${seconds(f.value)}` : ""}.`
  if (how === "open" && f.past) return `${t(f.openedAt)}. ${stop(f.headline)}.`
  return `${t(f.openedAt)}. ${f.headline.replace(/\.$/, "")}.`
}

/** The strip's label: "No changes since Oct 24", "$48, in stock, since Oct 1", "Quiet since Oct 24". */
export function stripWords(kind: Kind, since: number, price?: PriceMemo, state?: string): string {
  const w = sinceWords(since)
  if (kind === "page") return `No changes since ${w}`
  if (kind === "price" && price) return priceStrip(price, w)
  if (kind === "security") return `No issues since ${w}`
  if (kind === "repo") return `No alerts since ${w}`
  if (kind === "custom" && state) return `${stop(state)} since ${w}`
  return `Quiet since ${w}`
}

/* Security and repo alerts */

const DAY_FMT = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })

/** One alert as a finding's headline: "express: Open redirect", "A key in config/dev.env". */
export function alertLine(a: RepoAlert): string {
  if (a.source === "key") return `A key in ${a.file ?? a.name}`
  if (a.source === "secret") return `GitHub found ${/^[aeiou]/i.test(a.name) ? "an" : "a"} ${a.name}`
  if (a.source === "code") return a.name
  return `${a.name}${a.version ? ` ${a.version}` : ""}: ${a.problem}`
}

/** The small line of an alert row: "Open redirect, high. Fixed in 4.19.2". */
export function alertDetail(a: RepoAlert): string {
  if (a.source === "key") return `${a.problem}, starts ${a.id ?? "…"}.${a.committedAt ? ` Committed ${DAY_FMT(a.committedAt)}` : ""}`
  const sev = a.severity ? `, ${a.severity}` : ""
  const fix = a.fixedIn ? `. Fixed in ${a.fixedIn}` : a.fixVia ? (a.fixVia === "npm audit fix" ? ". npm audit fix fixes it" : `. Fixed by ${a.fixVia}`) : a.source === "package" ? ". No fix yet" : ""
  return `${a.problem}${sev}${fix}`
}

/** A repo card's headline: "2 new security alerts in shop-web". */
export const repoHeadline = (n: number, name: string) => (n === 1 ? `A new security alert in ${name}` : `${n} new security alerts in ${name}`)

/** A repo card's body, from what the alerts are and whether a fixed version is out. */
export function repoBody(alerts: RepoAlert[]): string {
  const pk = alerts.filter((a) => a.source === "package")
  const keys = alerts.filter((a) => a.source === "key")
  const other = alerts.length - pk.length - keys.length
  const out: string[] = []
  if (pk.length) {
    const fixed = pk.filter((a) => a.fixedIn || a.fixVia).length
    if (fixed === pk.length) out.push(pk.length === 1 ? "It’s in a package with a fixed version out." : pk.length === 2 ? "Both are in packages with a fixed version out." : `All ${pk.length} are in packages with a fixed version out.`)
    else if (!fixed) out.push("No fixed version yet. I’ll tell you when there is one.")
    else out.push(`${fixed} of ${pk.length} packages have a fixed version out.`)
  }
  if (keys.length === 1) {
    const k = keys[0]!
    out.push(`A key that ${k.problem.replace(/^Looks/, "looks")} is in ${k.file ?? k.name}${k.committedAt ? `, committed ${DAY_FMT(k.committedAt)}` : ""}.`)
  } else if (keys.length > 1) out.push(`${keys.length} keys are in tracked files.`)
  if (other) out.push(other === 1 ? "GitHub has one more alert on the code." : `GitHub has ${other} more alerts on the code.`)
  return out.join(" ")
}

/** The fix headline: a repo's alerts as one, anything else its own headline. */
export function fixHeadline(kind: Kind, name: string, findings: Pick<Finding, "headline">[]): string {
  if (kind === "repo") return repoHeadline(findings.length, name)
  return stop(findings[0]?.headline ?? "")
}

/**
 * The brief a fix starts from, built from the evidence and never by a model: the problem, the numbers,
 * the files, and the one rule.
 */
export function fixBrief(w: { kind: Kind; target: string; name: string }, findings: Finding[], latest?: Run): string {
  const lines: string[] = [`${fixHeadline(w.kind, w.name, findings)}.`]
  for (const f of findings) {
    if (w.kind !== "repo" && f.detail) lines.push(f.detail)
    const a = f.ev?.alert
    if (a) lines.push(`- ${a.source === "package" ? `${a.name}${a.version ? ` ${a.version}` : ""}` : (a.file ?? a.name)}: ${alertDetail(a)}${a.url ? ` (${a.url})` : ""}`)
  }
  if (w.kind === "security") lines.push(`Site: ${w.target}`)
  if (w.kind === "uptime") {
    for (const [k, v] of latest?.facts ?? []) lines.push(`${k}: ${v}`)
    const files = (latest?.files ?? []).slice(0, 8)
    if (files.length) lines.push("Largest files:", ...files.map((x) => `- ${x.name}: ${Math.round(x.bytes / 1024)} KB (${x.url})`))
    lines.push(`Site: ${w.target}`)
  }
  if (w.kind === "repo") lines.push("", "Update only what these alerts need, then run the tests if there are any.")
  if (w.kind === "tests") {
    for (const [k, v] of latest?.facts ?? []) lines.push(`${k}: ${v}`)
    if (latest?.output) lines.push("", "The last lines it printed:", "```", latest.output, "```")
    lines.push("", "Find why the tests fail and fix the code (or the test, if the test is wrong). Run the tests again before you stop.")
  }
  if (w.kind === "outdated") {
    for (const r of latest?.rows ?? []) lines.push(`- ${r.label}: ${r.value}`)
    lines.push("", "Update these one at a time to their latest major version, read each one’s changelog for breaking changes, and run the tests after each.")
  }
  if (w.kind === "seo" || w.kind === "links") lines.push(`Site: ${w.target}`)
  lines.push("", "Make the smallest change that fixes this. Don’t commit or deploy.")
  return lines.join("\n")
}

/** The fixed card's headline: what's true now. */
export function fixedLine(kind: Kind, target: string, keys: string[], latest?: Run, left = 0): string {
  const host = target
  if (kind === "repo") return left ? `${left} ${left === 1 ? "alert" : "alerts"} left in ${repoName(target)}.` : `No open alerts in ${repoName(target)}.`
  const key = keys[0] ?? ""
  if (key === "slow") return latest?.metric ? `The home page loads in ${seconds(latest.metric)} again.` : "It loads at its usual speed again."
  if (key === "dmarc:none") {
    const p = latest?.dmarc?.match(/\bp=(\w+)/i)?.[1]?.toLowerCase()
    return p === "reject" ? `Mail that fakes ${host} is now rejected.` : p === "quarantine" ? `Mail that fakes ${host} now goes to spam.` : `${host} has a DMARC record now.`
  }
  if (key === "spf:none") return `${host} now says which servers send its email.`
  if (key === "header:hsts") return `${host} sends an HSTS header now.`
  if (key === "header:missing") return `${host} sends its security headers now.`
  if (key === "tls:old") return "TLS 1.0 is off now."
  if (key.startsWith("port:")) return `Port ${key.slice(5)} is closed now.`
  if (key.startsWith("cert:")) return `The certificate for ${host} is renewed.`
  return "It’s gone now."
}

/**
 * The quick bar's compact plan, with the kind's defaults: "Up now, 0.9 s. I’ll check every 5 minutes and
 * tell you right away if it goes down or gets much slower." Other kinds use their plan sentence.
 */
/** The time the validating check measured: the full load when it ran one, else how long the site took to answer. */
const upMs = (r: Run) => (r.status === "failed" || (r.metric === undefined && !(r.ms > 0)) ? undefined : (r.metric ?? r.ms))

export function quickPlan(d: { kind: Kind; every: Every; notify: NotifyWhen; plan: string; first: Run }): string {
  if (d.kind !== "uptime") return d.plan
  const ms = upMs(d.first)
  const up = ms !== undefined ? `Up now, ${seconds(ms)}. ` : ""
  return `${up}I’ll check ${often(d.every)} and ${d.notify === "now" ? "tell you right away" : "put it in your morning summary"} if it goes down or gets much slower.`
}

/** The quick bar after Start watching: "Up, 0.9 s. You’ll hear only if something’s wrong." */
export function quickStarted(d: { kind: Kind; first: Run }): string {
  if (d.kind === "uptime") {
    const ms = upMs(d.first)
    return `${ms !== undefined ? `Up, ${seconds(ms)}. ` : ""}You’ll hear only if something’s wrong.`
  }
  if (d.kind === "page") return "You’ll hear when it changes."
  if (d.kind === "price") return "You’ll hear when the price or stock changes."
  if (d.kind === "custom") return "You’ll hear when it comes true."
  return "You’ll hear only if something’s wrong."
}
