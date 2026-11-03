import type { Every, MoreKind, Run } from "./types"

// The words of the ten More kinds, from templates like copy.ts: health checks, certificate and domain
// expiry, DNS changes, the services you depend on, the desktop update feed, SEO basics, broken links,
// tests in a folder, outdated packages and disk space. None needs a sign-in or a model.

export const MORE_LABEL: Record<MoreKind, string> = {
  health: "Health check",
  expiry: "Certificate and domain expiry",
  dns: "DNS changes",
  status: "Services you depend on",
  feed: "Update feed",
  seo: "SEO basics",
  links: "Broken links",
  tests: "Tests in a folder",
  outdated: "Outdated packages",
  disk: "Disk space",
}

export const MORE_EVERY: Record<MoreKind, Every> = {
  health: "5m",
  expiry: "morning",
  dns: "1h",
  status: "15m",
  feed: "1h",
  seo: "morning",
  links: "morning",
  tests: "morning",
  outdated: "morning",
  disk: "1h",
}

/** What the composer asks for after a starter. */
export const MORE_ASK: Record<MoreKind, string> = {
  health: "Health link, like lane-ceramics.com/api/health",
  expiry: "Domain, like lane-ceramics.com",
  dns: "Domain, like lane-ceramics.com",
  status: "Services, like GitHub, Cloudflare, Groq, Infura",
  feed: "Update feed, like lane-ceramics.com/downloads/latest-mac.yml",
  seo: "Site address, like lane-ceramics.com",
  links: "Site address, like lane-ceramics.com",
  tests: "Folder, like ~/Code/shop-web",
  outdated: "Folder, like ~/Code/shop-web",
  disk: "Space to keep free, like 20 GB",
}

export const MORE_WHICH: Record<MoreKind, string> = {
  health: "Which health link?",
  expiry: "Which domain?",
  dns: "Which domain?",
  status: "Which services?",
  feed: "Which update feed?",
  seo: "Which site?",
  links: "Which site?",
  tests: "Which folder?",
  outdated: "Which folder?",
  disk: "How much space should stay free?",
}

/** Kinds that run first after Start watching: the draft only checks the target, since a run takes a while. */
export const SLOW_KINDS: MoreKind[] = ["tests", "links"]

/** Defaults for `limit`: health milliseconds, expiry days, disk gigabytes. */
export const DEFAULT_LIMIT = { health: 1000, expiry: 14, disk: 20 } as const
/** The domain itself gets a month: renewing one can need a card or a transfer. */
export const DOMAIN_DAYS = 30

/** Status pages with a public Statuspage feed (`/api/v2/status.json`), checked to answer. */
export const SERVICES: Record<string, { name: string; host: string }> = {
  github: { name: "GitHub", host: "www.githubstatus.com" },
  cloudflare: { name: "Cloudflare", host: "www.cloudflarestatus.com" },
  groq: { name: "Groq", host: "groqstatus.com" },
  infura: { name: "Infura", host: "status.infura.io" },
}
/** Services people name whose status pages have no feed Axe can read (checked 2026-11-01). */
export const NO_FEED: Record<string, string> = { openrouter: "OpenRouter", posthog: "PostHog", vercel: "Vercel", stripe: "Stripe" }

/** "GitHub, Cloudflare and Groq": known services by name, any other status page by host. */
export const serviceName = (id: string) => SERVICES[id]?.name ?? NO_FEED[id] ?? id

const PROTECTED_NAME = /^(Desktop|Documents|Downloads|Library)$/i

const segments = (p: string) => p.split("/").filter((x) => x && x !== ".")

/** Whether home's segments start `parts` (macOS folders ignore case). */
const startsWith = (parts: string[], home: string[]) => home.length > 0 && home.every((h, i) => parts[i]?.toLowerCase() === h.toLowerCase())

/**
 * Whether a "~/…" or absolute path is in Desktop, Documents, Downloads or Library: your home's, or any
 * user's home when `home` isn't known (the window). A path with ".." always counts, since it can't be told.
 */
export function inProtected(path: string, home?: string): boolean {
  const tilde = path === "~" || path.startsWith("~/")
  let parts = segments(tilde ? path.slice(1) : path)
  if (parts.includes("..")) return true
  if (tilde) return !!parts[0] && PROTECTED_NAME.test(parts[0])
  // The data volume's own name for the same folders.
  if (startsWith(parts, ["System", "Volumes", "Data"])) parts = parts.slice(3)
  const h = home ? segments(home) : []
  if (startsWith(parts, h) && parts.length > h.length && PROTECTED_NAME.test(parts[h.length]!)) return true
  return /^(Users|home)$/i.test(parts[0] ?? "") && parts.length >= 3 && PROTECTED_NAME.test(parts[2]!)
}

/**
 * A folder as typed: "~/Code/shop-web" or an absolute path ("~/…" when it's in `home`). Never Desktop,
 * Documents, Downloads or Library, never a path with "..", never your home itself.
 */
export function cleanFolder(raw: string, home?: string): string | null {
  const t = raw.trim()
  const tilde = t.startsWith("~/")
  if (!tilde && !t.startsWith("/")) return null
  const parts = segments(tilde ? t.slice(1) : t)
  if (!parts.length || parts.includes("..")) return null
  const h = home ? segments(home) : []
  const inHome = !tilde && startsWith(parts, h)
  if (inHome && parts.length === h.length) return null
  const out = tilde || inHome ? `~/${parts.slice(inHome ? h.length : 0).join("/")}` : `/${parts.join("/")}`
  if (inProtected(out, home) || (!tilde && inProtected(`/${parts.join("/")}`, home))) return null
  return out
}

/**
 * A dotted public hostname for a status page: never an IP literal (IPv4, IPv6 or bracketed, hex or
 * numeric forms included, so the last label must start with a letter), `localhost`, `*.local`,
 * `*.internal` or a single-label name.
 */
function publicHost(h: string): boolean {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return false
  if (!/^[a-z][a-z0-9-]*$/.test(h.split(".").pop() ?? "")) return false
  return !/(^|\.)(localhost|local|internal)$/.test(h)
}

/** Services from a list ("GitHub, Cloudflare and groq"): ids for known ones, hosts for other status pages. */
export function cleanServices(raw: string): string | null {
  const parts = raw
    .split(/,|\band\b|\s+&\s+|\n/i)
    .map((p) =>
      p
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, ""),
    )
    .filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    const word = p.replace(/\s+status$/, "").replace(/\s+/g, "")
    const known = Object.entries(SERVICES).find(([id, s]) => id === word || s.host === p || s.host.replace(/^www\./, "") === p)?.[0]
    if (known) out.push(known)
    else if (NO_FEED[word]) out.push(word)
    else if (publicHost(p)) out.push(p)
    else return null
  }
  return out.length ? [...new Set(out)].join(", ") : null
}

/** "20 GB", "20gb", "below 15 GB" → gigabytes. */
export function gigabytes(raw: string): number | null {
  const m = raw.match(/(\d+(?:\.\d+)?)\s*(t|g|m)?b?\b/i)
  if (!m) return null
  const n = Number(m[1])
  const unit = (m[2] ?? "g").toLowerCase()
  return unit === "t" ? n * 1000 : unit === "m" ? n / 1000 : n
}

/** A watch's name for these kinds. */
export function moreName(kind: MoreKind, target: string): string {
  switch (kind) {
    case "health":
      return target
    case "expiry":
      return `${target} expiry`
    case "dns":
      return `${target} DNS`
    case "status":
      return target.split(", ").map(serviceName).join(", ")
    case "feed":
      return `${target.split("/")[0]} updates`
    case "seo":
      return `${target} SEO`
    case "links":
      return `${target} links`
    case "tests":
      return `Tests in ${folderName(target)}`
    case "outdated":
      return `Packages in ${folderName(target)}`
    case "disk":
      return "This Mac’s disk"
  }
}

export const folderName = (t: string) => t.replace(/\/+$/, "").split("/").pop() || t

const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

/** The bubble: what a person would have said. */
export function moreSentence(kind: MoreKind, target: string, limit?: number): string {
  switch (kind) {
    case "health":
      return `Tell me if ${target} stops saying ok.`
    case "expiry":
      return `Tell me before ${target}’s certificate or domain runs out.`
    case "dns":
      return `Tell me when ${target}’s DNS records change.`
    case "status":
      return `Tell me when ${and(target.split(", ").map(serviceName))} ${target.includes(", ") ? "have" : "has"} a problem.`
    case "feed":
      return `Tell me if the app updates at ${target} stop downloading.`
    case "seo":
      return `Check ${target} for SEO basics.`
    case "links":
      return `Tell me about broken pages on ${target}.`
    case "tests":
      return `Run the tests in ${folderName(target)} and tell me when they fail.`
    case "outdated":
      return `Tell me when packages in ${folderName(target)} fall a major version behind.`
    case "disk":
      return `Tell me when this Mac has less than ${limit ?? DEFAULT_LIMIT.disk} GB free.`
  }
}

const fact = (r: Run | undefined, label: string) => r?.facts?.find(([a]) => a === label)?.[1]

/** The plan under the bubble, with what the first run found, or plainly what it couldn't read. */
export function morePlan(kind: MoreKind, target: string, often: string, tell: string, o: { first?: Run; limit?: number; field?: string; command?: string }): string {
  const r = o.first
  const unread = r?.rows?.filter((x) => /^Couldn’t|^Not /.test(x.value)).map((x) => `${x.label}: ${x.value.charAt(0).toLowerCase()}${x.value.slice(1)}`)
  const cant = unread?.length ? ` I couldn’t read everything: ${unread.join("; ")}.` : ""
  switch (kind) {
    case "health": {
      const field = o.field ? ` and ${o.field} under ${o.limit ?? DEFAULT_LIMIT.health} ms` : ` and its times under ${o.limit ?? DEFAULT_LIMIT.health} ms`
      return `I’ll read ${target} ${often} and ${tell} unless it says ok${field}.`
    }
    case "expiry":
      return `${often === "every morning at 7:30" ? "Every morning" : cap(often)} I’ll read ${target}’s certificate and domain dates and ${tell} ${o.limit ?? DEFAULT_LIMIT.expiry} days before the certificate runs out, ${DOMAIN_DAYS} before the domain.${cant}`
    case "dns":
      return `I’ll look up ${target}’s A, NS, MX and TXT records ${often} and ${tell} what changed.`
    case "status":
      return `I’ll read the status pages of ${and(target.split(", ").map(serviceName))} ${often} and ${tell} when one reports a problem.${cant}`
    case "feed":
      return `I’ll read the update feed ${often}, check that every file it names downloads, and ${tell} when it breaks or a new version is out.`
    case "seo":
      return `${often === "every morning at 7:30" ? "Every morning" : cap(often)} I’ll check ${target}’s robots.txt, sitemap.xml and llms.txt, and that its key pages aren’t set to noindex.`
    case "links": {
      const pages = fact(r, "Pages")
      return `I’ll load ${pages ? `the ${pages} pages` : "the pages"} in ${target}’s sitemap ${often}, one at a time, and ${tell} when one doesn’t load.`
    }
    case "tests":
      return `I’ll run ${o.command ?? fact(r, "Command") ?? "its tests"} in ${folderName(target)} ${often} and ${tell} when they start or stop failing.`
    case "outdated":
      return `I’ll ask the package registry about ${folderName(target)} ${often} and ${tell} when a package falls a major version behind.`
    case "disk":
      return `I’ll check this Mac’s free space ${often} and ${tell} when it drops below ${o.limit ?? DEFAULT_LIMIT.disk} GB.`
  }
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** The first message after a watch starts. */
export function moreFirst(kind: MoreKind, target: string, first: Run, often: string): string | null {
  const problems = first.findings.filter((f) => f.level === "problem")
  if (problems.length) return problems.length === 1 ? `${stop(problems[0]!.headline)}.` : `${problems.length} things to look at.`
  switch (kind) {
    case "health":
      return `${target} says ok. I’ll check ${often}.`
    case "expiry": {
      const c = fact(first, "Certificate")
      const dm = fact(first, "Domain")
      return `${c ? `The certificate lasts until ${c}.` : ""}${dm ? ` The domain is paid until ${dm}.` : ""} I’ll check ${often}.`.trim()
    }
    case "dns":
      return `Saved ${target}’s records. I’ll compare them ${often}.`
    case "status":
      return `All ${first.rows?.length === 1 ? "is" : `${first.rows?.length ?? 0} are`} running normally.`
    case "feed": {
      const v = first.facts?.map(([a, b]) => `${a} ${b}`).join(", ")
      return v ? `Every file downloads. ${v}.` : `Every file downloads.`
    }
    case "seo":
      return `robots.txt, sitemap.xml and llms.txt are there, and no key page is set to noindex.`
    case "links":
      return `All ${fact(first, "Pages") ?? ""} pages load.`.replace("All  pages", "Every page")
    case "tests":
      return `The tests pass${fact(first, "Took") ? ` in ${fact(first, "Took")}` : ""}.`
    case "outdated":
      return `No package is a major version behind.`
    case "disk":
      return `${fact(first, "Free") ?? "Enough space"} free. I’ll check ${often}.`
  }
}

const stop = (t: string) => t.trim().replace(/[.!?]+$/, "")

/** The row's line when nothing is wrong. */
export function moreQuiet(kind: MoreKind, latest: Run): string {
  switch (kind) {
    case "health":
      return fact(latest, "Answered in") ? `Says ok, answered in ${fact(latest, "Answered in")}.` : "Says ok."
    case "expiry":
      return fact(latest, "Certificate") ? `Certificate until ${fact(latest, "Certificate")}.` : "No changes."
    case "dns":
      return "No changes."
    case "status":
      return "All running normally."
    case "feed":
      return latest.facts?.length ? `${latest.facts.map(([a, b]) => `${a} ${b}`).join(", ")}.` : "Every file downloads."
    case "seo":
      return "No issues found."
    case "links":
      return `All ${fact(latest, "Pages") ?? ""} pages load.`.replace("All  pages", "Every page")
    case "tests":
      return "Tests pass."
    case "outdated":
      return "Nothing a major version behind."
    case "disk":
      return `${fact(latest, "Free") ?? "Enough"} free.`
  }
}
