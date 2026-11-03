import { cleanFolder } from "./more"
import type { ElementKind, Every, Kind, Run } from "./types"

// The Available elements catalogue (design "Watching redesign", Elements board): eleven checks of this Mac
// and eight of the web. Every one is keyless: programs already on the Mac, or public endpoints that need no
// account. Words here, checks in main/watching/checks/mac.ts and web-elements.ts.

export const ELEMENT_LABEL: Record<ElementKind, string> = {
  processes: "Processes",
  memory: "Memory pressure",
  battery: "Battery",
  ports: "Dev servers",
  docker: "Docker",
  gitrepos: "Git repos",
  brew: "Homebrew",
  macos: "macOS updates",
  timemachine: "Time Machine",
  hogs: "Disk hogs",
  network: "Network",
  pagespeed: "Page speed",
  wallets: "Crypto wallets",
  fees: "Network fees",
  mentions: "Mentions",
  email: "Email deliverability",
  global: "Global response",
  downloads: "Desktop downloads",
}

export const ELEMENT_EVERY: Record<ElementKind, Every> = {
  processes: "5m",
  memory: "15m",
  battery: "1h",
  ports: "5m",
  docker: "1h",
  gitrepos: "1h",
  brew: "morning",
  macos: "morning",
  timemachine: "1h",
  hogs: "morning",
  network: "1h",
  pagespeed: "morning",
  wallets: "15m",
  fees: "15m",
  mentions: "1h",
  email: "morning",
  global: "1h",
  downloads: "morning",
}

/** Kinds that need nothing from you: Add goes straight to the plan. */
export const NO_INPUT: ElementKind[] = ["processes", "memory", "battery", "docker", "brew", "macos", "timemachine", "fees", "network"]

/** What the composer asks for after Add, for the kinds that need something. */
export const ELEMENT_ASK: Record<ElementKind, string> = {
  ...(Object.fromEntries(NO_INPUT.map((k) => [k, ""])) as Record<(typeof NO_INPUT)[number], string>),
  ports: "Ports to watch, like 3000, 5173",
  gitrepos: "Folder with your repos, like ~/Work",
  hogs: "Folders to measure, like ~ or ~/Work",
  pagespeed: "Page link, like lane-ceramics.com",
  wallets: "Wallet addresses, like 0x… or a Solana address",
  mentions: "Words to look for, like Lane Ceramics",
  email: "Domain you send email from, like lane-ceramics.com",
  global: "Site address, like lane-ceramics.com",
  downloads: "GitHub repo with your releases, like mia/shop-app",
}

export const ELEMENT_WHICH: Record<ElementKind, string> = {
  ...(Object.fromEntries(NO_INPUT.map((k) => [k, ""])) as Record<(typeof NO_INPUT)[number], string>),
  ports: "Which ports?",
  gitrepos: "Which folder?",
  hogs: "Which folders?",
  pagespeed: "Which page?",
  wallets: "Which addresses?",
  mentions: "What should I look for?",
  email: "Which domain?",
  global: "Which site?",
  downloads: "Which GitHub repo?",
}

/** Kinds whose first run starts after Start watching: the draft only checks the target. */
export const SLOW_ELEMENTS: ElementKind[] = ["macos", "hogs", "network", "pagespeed", "global", "gitrepos"]
/** Kinds whose problem clears after one clean run. */
export const ONE_CLEAN: ElementKind[] = ["processes", "memory", "ports", "docker", "timemachine", "network", "global", "fees", "pagespeed"]

/** Defaults for `limit`: CPU %, battery health %, Docker GB, backup hours, folder growth GB, Mbps, ms, dollars. */
export const ELEMENT_LIMIT = { processes: 80, battery: 80, timemachine: 24, hogs: 5, network: 10, global: 3000, fees: 1 } as const
/** A process over the CPU line this long is a hog. */
export const HOG_MS = 10 * 60_000

/* Targets */

const EVM = /^0x[0-9a-fA-F]{40}$/
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
export type Chain = "evm" | "solana" | "tron"
export const chainOf = (a: string): Chain | null => (EVM.test(a) ? "evm" : TRON.test(a) ? "tron" : SOLANA.test(a) ? "solana" : null)
/** Shown in names and rows: "0x12ab…9f3c". */
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

const list = (raw: string) =>
  raw
    .split(/[\s,]+|\band\b/)
    .map((x) => x.trim())
    .filter(Boolean)

/** "3000, :5173 and 8080" → "3000, 5173, 8080". */
export function cleanPorts(raw: string): string | null {
  const ports = list(raw.replace(/:/g, " "))
  if (!ports.length || !ports.every((p) => /^\d{1,5}$/.test(p) && Number(p) > 0 && Number(p) < 65536)) return null
  return [...new Set(ports.map(Number))].sort((a, b) => a - b).join(", ")
}

/** Folders for disk hogs. Desktop, Documents, Downloads and Library only when you name them yourself. */
export function cleanFolders(raw: string, home?: string): string | null {
  const parts = list(raw.replace(/\bmy home( folder)?\b/i, "~")).map((p) => (p === "~" || p === home ? "~" : p))
  if (!parts.length) return "~"
  const out: string[] = []
  for (const p of parts) {
    if (p === "~") out.push("~")
    else {
      const named = p.startsWith(`${home ?? "\0"}/`) ? `~${p.slice(home!.length)}` : p.replace(/\/+$/, "")
      if (!named.startsWith("~/") && !named.startsWith("/")) return null
      out.push(named)
    }
  }
  return [...new Set(out)].join(", ")
}

/** A GitHub repo as "owner/name", from "owner/name" or its link. */
export function cleanRepo(raw: string): string | null {
  const m = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$|\/+$/g, "")
    .match(/^([\w.-]+)\/([\w.-]+)$/)
  return m ? `${m[1]}/${m[2]}` : null
}

const host = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!

/** The target as the element keeps it, or null when it can't be watched as typed. */
export function cleanElementTarget(kind: ElementKind, raw: string, home?: string): string | null {
  const t = raw.trim()
  switch (kind) {
    case "processes":
    case "memory":
    case "battery":
    case "docker":
    case "brew":
    case "macos":
    case "timemachine":
    case "network":
    case "fees":
      return kind === "fees" ? "base, solana, ethereum" : "this-mac"
    case "ports":
      return cleanPorts(t)
    case "gitrepos":
      return cleanFolder(t || "~/Work", home)
    case "hogs":
      return cleanFolders(t, home)
    case "wallets": {
      const a = list(t)
      return a.length && a.every((x) => chainOf(x)) ? [...new Set(a)].join(", ") : null
    }
    case "mentions": {
      const w = t.replace(/^["“]|["”]$/g, "").trim()
      return w.length >= 2 && w.length <= 80 ? w : null
    }
    case "email": {
      const h = host(t.replace(/^.*@/, ""))
      return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null
    }
    case "pagespeed":
    case "global": {
      const h = host(t)
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(h) && !/^localhost(:\d+)?$/.test(h)) return null
      return kind === "global" ? h : t.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "")
    }
    case "downloads":
      return cleanRepo(t)
  }
}

/* Words */

const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)
const portsWords = (t: string) => and(t.split(", ").map((p) => `:${p}`))
const addresses = (t: string) => t.split(", ")

export function elementName(kind: ElementKind, target: string): string {
  switch (kind) {
    case "ports":
      return `Ports ${portsWords(target)}`
    case "gitrepos":
      return `Repos in ${target}`
    case "hogs":
      return target === "~" ? "Disk hogs" : `Disk hogs in ${target}`
    case "wallets":
      return addresses(target).length === 1 ? `Wallet ${shortAddress(target)}` : `${addresses(target).length} wallets`
    case "mentions":
      return `Mentions of ${target}`
    case "email":
      return `${target} email`
    case "pagespeed":
      return `${target} speed`
    case "global":
      return `${target} worldwide`
    case "downloads":
      return `${target.split("/")[1]} downloads`
    default:
      return ELEMENT_LABEL[kind]
  }
}

export function elementSentence(kind: ElementKind, target: string, limit?: number): string {
  switch (kind) {
    case "processes":
      return `Tell me when an app uses over ${limit ?? ELEMENT_LIMIT.processes}% CPU for 10 minutes.`
    case "memory":
      return "Tell me when memory pressure turns red."
    case "battery":
      return `Tell me about the battery, and when its health drops under ${limit ?? ELEMENT_LIMIT.battery}%.`
    case "ports":
      return `Tell me when ${portsWords(target)} stop${target.includes(",") ? "" : "s"} listening.`
    case "docker":
      return "Tell me when a Docker container stops."
    case "gitrepos":
      return `Tell me when a repo in ${target} falls behind its remote.`
    case "brew":
      return "Tell me when Homebrew packages have updates."
    case "macos":
      return "Tell me when a macOS update is out."
    case "timemachine":
      return `Tell me when the last Time Machine backup is over ${limit ?? ELEMENT_LIMIT.timemachine} hours old.`
    case "hogs":
      return `Tell me when a folder${target === "~" ? "" : ` in ${target}`} grows by more than ${limit ?? ELEMENT_LIMIT.hogs} GB.`
    case "network":
      return `Tell me when the download speed drops under ${limit ?? ELEMENT_LIMIT.network} Mbps.`
    case "pagespeed":
      return `Tell me when ${target} gets slow to show.`
    case "wallets":
      return `Tell me about USDC and USDT payments to ${and(addresses(target).map(shortAddress))}.`
    case "fees":
      return `Tell me when a USDC transfer costs over $${limit ?? ELEMENT_LIMIT.fees} on Base, Solana or Ethereum.`
    case "mentions":
      return `Tell me about new posts that mention ${target}.`
    case "email":
      return `Tell me if ${target}’s mail servers land on a spam blacklist.`
    case "global":
      return `Tell me when ${target} is slow or down somewhere in the world.`
    case "downloads":
      return `Tell me how often ${target}’s releases are downloaded.`
  }
}

const fact = (r: Run | undefined, label: string) => r?.facts?.find(([a]) => a === label)?.[1]
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const daily = (often: string) => (often === "every morning at 7:30" ? "Every morning" : cap(often))

export function elementPlan(kind: ElementKind, target: string, often: string, tell: string, o: { first?: Run; limit?: number }): string {
  switch (kind) {
    case "processes":
      return `I’ll look at the top apps ${often} and ${tell} when one stays over ${o.limit ?? ELEMENT_LIMIT.processes}% CPU for 10 minutes.`
    case "memory":
      return `I’ll read macOS’s memory pressure ${often} and ${tell} when it turns red.`
    case "battery":
      return `I’ll read the battery’s health, cycles and time left ${often}, see what keeps the Mac awake, and ${tell} when health drops under ${o.limit ?? ELEMENT_LIMIT.battery}%.`
    case "ports":
      return `I’ll check ${portsWords(target)} ${often} and ${tell} when one stops listening.`
    case "docker":
      return `I’ll list your containers and Docker’s disk use ${often} and ${tell} when a running container stops.`
    case "gitrepos":
      return `${daily(often)} I’ll look at the repos in ${target} for uncommitted and unpushed work, ask each remote what’s new without fetching, and ${tell} when one falls behind.`
    case "brew":
      return `${daily(often)} I’ll ask Homebrew what’s outdated, against its last update, and ${tell} when new updates show up.`
    case "macos":
      return `${daily(often)} I’ll ask Software Update what’s pending and ${tell} when a new update is out.`
    case "timemachine":
      return `I’ll read Time Machine’s last backup ${often} and ${tell} when it’s over ${o.limit ?? ELEMENT_LIMIT.timemachine} hours old.`
    case "hogs":
      return `${daily(often)} I’ll measure ${target === "~" ? "the folders in your home folder, skipping Desktop, Documents, Downloads and Library," : target} and ${tell} when one grows by more than ${o.limit ?? ELEMENT_LIMIT.hogs} GB.`
    case "network":
      return `I’ll check Wi-Fi, your IP address and VPN ${often}, test the speed once a day with macOS’s own test, and ${tell} when it drops under ${o.limit ?? ELEMENT_LIMIT.network} Mbps.`
    case "pagespeed":
      return `${daily(often)} I’ll load ${target} in a hidden window on this Mac, time when it shows (LCP) and how much it shifts (CLS), and ${tell} when either gets poor.`
    case "wallets":
      return `I’ll read the USDC and USDT balances of ${and(addresses(target).map(shortAddress))} from public chain data ${often} and ${tell} when a payment comes in.`
    case "fees":
      return `I’ll read what a USDC transfer costs on Base, Solana and Ethereum ${often} and ${tell} when one is over $${o.limit ?? ELEMENT_LIMIT.fees}.`
    case "mentions":
      return `I’ll search Hacker News and Reddit for “${target}” ${often} and ${tell} about each new post.`
    case "email":
      return `${daily(often)} I’ll look up ${target}’s mail servers on ${fact(o.first, "Lists") ?? "public"} spam blacklists and ${tell} when one is listed.`
    case "global":
      return `I’ll load ${target} from three regions ${often} with Globalping’s free probes and ${tell} when one is down or over ${(o.limit ?? ELEMENT_LIMIT.global) / 1000} s.`
    case "downloads":
      return `${daily(often)} I’ll read the download counts of ${target}’s GitHub releases and keep the trend.`
  }
}

/** The first message after a watch starts. */
export function elementFirst(kind: ElementKind, first: Run, often: string): string {
  const problems = first.findings.filter((f) => f.level === "problem")
  if (problems.length) return problems.length === 1 ? `${problems[0]!.headline.replace(/\.$/, "")}.` : `${problems.length} things to look at.`
  const now = first.state ? `${first.state.replace(/\.$/, "")}. ` : ""
  return `${now}I’ll check ${often}${kind === "mentions" || kind === "wallets" ? " and tell you about anything new" : ""}.`
}

/** The row's line when nothing is wrong. */
export const elementQuiet = (latest: Run) => (latest.state ? `${latest.state.replace(/\.$/, "")}.` : "Checked.")

/* The catalogue */

export type CatalogueGroup = "mac" | "web" | "more"
export type CatalogueItem = {
  id: string
  /** The kind Add drafts. Competitor pages is Page changes with its own question. */
  kind: Kind
  label: string
  note: string
  group: CatalogueGroup
  recommended?: boolean
  /** The composer's question, when it isn't the kind's own. */
  ask?: string
}

export const CATALOGUE: CatalogueItem[] = [
  { id: "processes", kind: "processes", label: "Processes", group: "mac", recommended: true, note: "Top apps by CPU and memory. Alerts when one hogs CPU for 10+ minutes." },
  { id: "memory", kind: "memory", label: "Memory pressure", group: "mac", note: "Whether memory pressure is green, yellow or red." },
  { id: "battery", kind: "battery", label: "Battery", group: "mac", note: "Health, cycles, time left, and what keeps the Mac awake." },
  { id: "ports", kind: "ports", label: "Dev servers", group: "mac", recommended: true, note: "Local ports listening. Alerts if one you pick stops." },
  { id: "docker", kind: "docker", label: "Docker", group: "mac", note: "Containers running or stopped, and their disk use." },
  { id: "gitrepos", kind: "gitrepos", label: "Git repos", group: "mac", recommended: true, note: "Repos in a folder with uncommitted or unpushed work, or behind their remote." },
  { id: "brew", kind: "brew", label: "Homebrew", group: "mac", note: "Outdated packages. Homebrew doesn’t mark security fixes." },
  { id: "macos", kind: "macos", label: "macOS updates", group: "mac", note: "Pending system updates." },
  { id: "timemachine", kind: "timemachine", label: "Time Machine", group: "mac", recommended: true, note: "Last backup time. Alerts if it is more than a day old." },
  { id: "hogs", kind: "hogs", label: "Disk hogs", group: "mac", note: "Biggest growing folders. Never Library or Documents unless you pick them." },
  { id: "network", kind: "network", label: "Network", group: "mac", note: "Wi-Fi strength, speed, IP address and VPN." },
  { id: "pagespeed", kind: "pagespeed", label: "Page speed", group: "web", recommended: true, note: "LCP and CLS, measured in a hidden window on this Mac, with a trend." },
  { id: "wallets", kind: "wallets", label: "Crypto wallets", group: "web", recommended: true, note: "USDC and USDT on addresses you give, from public chain data. New payments." },
  { id: "fees", kind: "fees", label: "Network fees", group: "web", note: "What a USDC transfer costs on Base, Solana and Ethereum right now." },
  { id: "mentions", kind: "mentions", label: "Mentions", group: "web", recommended: true, note: "New Hacker News and Reddit posts that mention words you pick." },
  { id: "email", kind: "email", label: "Email deliverability", group: "web", note: "Whether your mail servers are on any spam blacklists." },
  { id: "global", kind: "global", label: "Global response", group: "web", note: "Response time from three regions, on Globalping’s free probes." },
  { id: "competitor", kind: "page", label: "Competitor pages", group: "web", note: "Pricing or changelog changes on sites you name.", ask: "Competitor page, like rival-shop.com/pricing" },
  { id: "downloads", kind: "downloads", label: "Desktop downloads", group: "web", note: "Download counts of your GitHub releases. Your own server’s logs aren’t public." },
]
