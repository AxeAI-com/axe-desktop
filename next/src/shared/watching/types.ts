import type { Answerer } from "../types"
import type { DiffLine } from "./diff"
import type { Stock } from "./price"

// Watching: what a watch is, what one run found, and what the window is shown.
// Design: https://claude.ai/artifact/7oQzxot9zbzQWzddF2bQ6R (architecture section).

/** Set by a starter (or by the model reading free text), never guessed from keywords. */
export type Kind = "uptime" | "page" | "price" | "security" | "repo" | "custom" | MoreKind | ElementKind
/** Kinds added with the More starters (more.ts): plain checks, no model. */
export type MoreKind = "health" | "expiry" | "dns" | "status" | "feed" | "seo" | "links" | "tests" | "outdated" | "disk"
export const MORE_KINDS: MoreKind[] = ["health", "expiry", "dns", "status", "feed", "seo", "links", "tests", "outdated", "disk"]
/** The Available elements catalogue's own kinds (elements.ts): this Mac and the web, keyless. */
export type MacElement = "processes" | "memory" | "battery" | "ports" | "docker" | "gitrepos" | "brew" | "macos" | "timemachine" | "hogs" | "network"
export type WebElement = "pagespeed" | "wallets" | "fees" | "mentions" | "email" | "global" | "downloads"
export type ElementKind = MacElement | WebElement
export const MAC_ELEMENTS: MacElement[] = ["processes", "memory", "battery", "ports", "docker", "gitrepos", "brew", "macos", "timemachine", "hogs", "network"]
export const WEB_ELEMENTS: WebElement[] = ["pagespeed", "wallets", "fees", "mentions", "email", "global", "downloads"]
export const ELEMENT_KINDS: ElementKind[] = [...MAC_ELEMENTS, ...WEB_ELEMENTS]
export const KINDS: Kind[] = ["uptime", "page", "price", "security", "repo", "custom", ...MORE_KINDS, ...ELEMENT_KINDS]

export type Every = "5m" | "15m" | "1h" | "morning"
/** "now": a notification as soon as something opens. "summary": only in the morning summary. */
export type NotifyWhen = "now" | "summary"

export type Watch = {
  id: string
  kind: Kind
  /** A site, page link, product link, domain, repo or folder, cleaned by `cleanTarget`. */
  target: string
  name: string
  every: Every
  notify: NotifyWhen
  /** Who reads free text, runs custom watches and does fixes. Plain checks never use it. */
  answerer?: Answerer
  /** Custom watches: what the model looks for, as a clause ("the Saturday glaze workshop has a seat"). */
  condition?: string
  /** The sentence you typed, when the watch came from free text: the bubble shows it. */
  asked?: string
  /** Where the code is, asked on the first fix and remembered. */
  folder?: string
  paused?: boolean
  /** When it was paused, for "Paused at 3:20 pm." */
  pausedAt?: number
  /** When the target last changed: the strip starts again from here. */
  targetAt?: number
  /** Old watches snoozed as a whole; snoozing is per finding now. */
  snoozedUntil?: number
  /** "That's expected" on slow: the load time that counts as usual from `at` on. `prev` is for Undo. */
  usual?: Usual
  /** "Tell me above 3 s": a fixed slow line instead of the one from history. */
  fixedMs?: number
  /** Finding keys you said are fine. */
  expected?: string[]
  /**
   * The number a run is held to: health, milliseconds a JSON number stays under; expiry, days left before
   * it tells you; disk, gigabytes free. Unset: the kind's default (more.ts).
   */
  limit?: number
  /** Health: the JSON number to hold to `limit` ("db.latencyMs"). Unset: every number named like a time. */
  field?: string
  /** Tests: the command to run, when it isn't the folder's own test script. */
  command?: string
  /** Price on a page with no product data: the words just before the price, picked once by the model. */
  selector?: string
  /** Page changes: what not to tell you about ("date", "text:<words>", "near:<heading line>"). */
  ignore?: string[]
  createdAt: number
  /** The first run, which the watch's first message describes. */
  first?: Run
  /** How often it checked when it started, so the first message keeps its words after a change. */
  firstEvery?: Every
}

/** quiet: nothing to say. news: something changed. problem: something is wrong. failed: Axe couldn't check. */
export type RunStatus = "quiet" | "news" | "problem" | "failed"

/** What a fix looks like: an agent changes code, you add a DNS record, or there's nothing to fix. */
export type FixKind = "agent" | "record" | "none"

export type Usual = { ms: number; at: number; prev?: Usual }

/** One thing a run found. The key is stable across runs, so a finding opens once and resolves once. */
export type Finding = {
  key: string
  level: "problem" | "news"
  /** The card's headline: "lane-ceramics.com is slow". */
  headline: string
  /** The card's body. */
  detail?: string
  /** The row's line: "Slow: the home page takes 4.1 s." */
  line?: string
  /** The notification's body: "Slow: the home page takes 4.1 s, up from 1.2 s." */
  note?: string
  fix: FixKind
  /** The number when it opened (load time in ms for slow). */
  value?: number
  /** What the card draws: the usual and the line it crossed, and when the files changed. */
  ev?: Evidence
  /** The headline once it's gone, for the folded line: "Anyone could send email as lane-ceramics.com". */
  past?: string
}

export type Evidence = {
  usualMs?: number
  limitMs?: number
  eventAt?: number
  eventLabel?: string
  status?: string
  /** Page: the line diff with context, its counts, the word counts before and after, and the changed parts' headings. */
  diff?: DiffLine[]
  added?: number
  removed?: number
  words?: [number, number]
  anchors?: string[]
  /** Price: the amounts before and after, and the stock now. */
  from?: number
  to?: number
  currency?: string
  stock?: Stock
  /** Security, record fixes: the DNS record as found and the value that fixes it. */
  record?: DnsRecord
  /** Repo: the alert or leaked key this finding is. */
  alert?: RepoAlert
  /** Custom: the page's words the model relied on, checked to be on the page. */
  quote?: string
}

/** A DNS record a record fix changes. `found` is missing when there's no record yet. */
export type DnsRecord = { name: string; type: "TXT"; found?: string; want: string; /** What to do first, or how: "Turn on DKIM with your mail provider. Then change this record:". */ how: string }

/**
 * One repo alert: a package with a known problem (Dependabot or the folder's audit), a code scanning
 * alert, a GitHub secret alert, or a key found in the folder. A key never carries more than its first 4 characters.
 */
export type RepoAlert = {
  source: "package" | "code" | "secret" | "key"
  /** Package name, rule, secret type or file. */
  name: string
  version?: string
  /** "Open redirect", "Looks like a Stripe secret". */
  problem: string
  severity?: "low" | "moderate" | "high" | "critical"
  fixedIn?: string
  /** A package with no fixed version of its own that updating another one fixes: "express 4.22.3". */
  fixVia?: string
  /** GHSA id (packages) or GitHub's alert number. */
  id?: string
  url?: string
  file?: string
  /** Keys: when the file was last committed. */
  committedAt?: number
}

/** One row of a security run's check list: "Email records, SPF, DKIM, DMARC: Spoofable". */
export type CheckRow = { label: string; sub?: string; value: string; ok: boolean }

/** A file the full page load fetched. */
export type PageFile = { name: string; url: string; bytes: number; modified?: number }

export type Run = {
  at: number
  /** How long the run took. */
  ms: number
  status: RunStatus
  findings: Finding[]
  /** The number the strip draws: load time in ms for uptime, the price for price. */
  metric?: number
  /** Label and value pairs shown under the first result and the latest one. */
  facts?: [string, string][]
  /** Why a failed run couldn't check, in plain words. */
  error?: string
  /** Uptime: the status line, "200 OK" or "502 Bad Gateway". */
  http?: string
  /** Uptime: the largest files of the full load, biggest first. */
  files?: PageFile[]
  /** Price: the stock and the currency of `metric`. */
  stock?: Stock
  currency?: string
  /** Custom: how things stand in a few words ("Full"), and the page's words the model relied on. */
  state?: string
  quote?: string
  /** Price: the product's name as the page gives it. */
  product?: string
  /** Security: the check list (email records, certificate, TLS and headers, open ports). */
  rows?: CheckRow[]
  /** Security: the DMARC record as found, for the fixed card. */
  dmarc?: string
  /** Repo: every alert this run saw, open or not, so a fixed card can list what went. */
  alerts?: RepoAlert[]
  /** Tests: the last lines the command printed, for the fix's brief. */
  output?: string
}

/** A finding while it stays open. */
export type OpenFinding = Finding & {
  openedAt: number
  lastSeenAt: number
  expected?: boolean
  /** A notification went out for it, so clearing by itself sends "back up". */
  notified?: boolean
  snoozedUntil?: number
  /** Clean runs in a row since it was last seen (most kinds resolve after two). */
  clean?: number
  /** Record fixes: when you pressed Copy record. Axe checks hourly for a day after. */
  copiedAt?: number
}

/**
 * A problem that closed: it cleared by itself, you said it's expected, or a run after your fix (a kept
 * agent change or a copied record) showed it gone.
 */
export type PastFinding = OpenFinding & { closedAt: number; how: "cleared" | "expected" | "fixed" }

/**
 * A fix turn in a watch's thread: "Fix with Claude Code". The agent's chat is its own session (`threadId`),
 * hidden from Recents; the watch keeps a pointer to it. asking: Axe asked which folder has the code.
 * working: the agent plans or works. kept, undone: what you did with its changes. A kept fix is verified
 * by the next run (straight away for a repo folder): `result` says what it found.
 */
export type FixTurn = {
  at: number
  /** The findings it fixes. */
  keys: string[]
  /** The headline the fix started from: "2 new security alerts in shop-web". */
  headline: string
  /** "Claude Code", or "Do it". */
  agent: string
  answerer: Answerer
  threadId?: string
  folder?: string
  state: "asking" | "working" | "kept" | "undone"
  /** Files the agent changed, when you kept them. */
  files?: number
  endedAt?: number
  result?: "fixed" | "still"
  /** When the run that decided `result` happened. */
  checkedAt?: number
}

/** A reply in a watch's thread (or a button you pressed) and what Axe said back. */
export type Said = {
  at: number
  /** Your words; empty when Axe answers a button ("Ignore changes like this"). */
  you: string
  axe: string
  /** What Undo puts back. */
  undo?: WatchPatch
  /** The news item an ignore came from, shown again on Undo. */
  undoNews?: number
  undone?: boolean
}

/** A change Axe told you about (page or price), kept in the thread. */
export type News = Finding & { at: number; facts?: [string, string][]; ignored?: boolean }

/** What the store keeps per watch between runs. */
export type WatchState = {
  open: OpenFinding[]
  failedStreak: number
  lastAt?: number
  latest?: Run
  past?: PastFinding[]
  said?: Said[]
  /** Changes, oldest first. */
  news?: News[]
  /** A change you haven't opened the watch to see yet: the row's blue dot. */
  unread?: boolean
  /** Price: runs in a row that found no price. */
  noPrice?: number
  /** Fix turns, oldest first. */
  fixes?: FixTurn[]
}

/** `ms`: how long the run took (health draws its answer time from it). */
export type StripTick = { at: number; status: RunStatus; metric?: number; ms?: number; http?: string; stock?: Stock; state?: string }

/** One step of a run in progress, for the live list on a new watch. */
export type Step = { label: string; state: "done" | "run" | "todo" }

export type WatchView = Watch & {
  latest?: Run
  open: OpenFinding[]
  failedStreak: number
  /** When the next scheduled run is due; null while paused. */
  nextAt: number | null
  /** The last runs, oldest first, for the tick strip. */
  strip: StripTick[]
  /** The row's one line: the latest fact, never a verdict. */
  line: string
  past: PastFinding[]
  said: Said[]
  news: News[]
  unread: boolean
  /** Price: the last 30 days, oldest first, for the step chart. */
  prices?: [number, number][]
  /** Set while a first run is in progress. */
  steps?: Step[]
  /** Set while any run of it is in progress: the dashboard's "Checking" sweep. */
  checking?: boolean
  fixes: FixTurn[]
}

/** The morning summary card on top of Watching: from its time until you close it, or until noon. */
export type SummaryCard = { at: number; text: string; until: number; closed?: boolean }

/** What the store keeps for the morning summary. `lastAt`: when the last one was made; the next covers from there. */
export type SummaryState = { lastAt?: number; /** Where the last summary started, so /summary can tell it again with what came since. */ from?: number; card?: SummaryCard }

export type WatchList = { watches: WatchView[]; /** The morning summary card, while it shows. */ summary?: { at: number; text: string } }

/** What setting up a watch shows before Start watching: the first run already happened. */
export type Draft = {
  kind: Kind
  target: string
  name: string
  every: Every
  notify: NotifyWhen
  answerer?: Answerer
  condition?: string
  /** The sentence you typed, when it came from free text. */
  asked?: string
  /** The plan sentence, rewritten when a dropdown changes. */
  plan: string
  first: Run
  /** What the first run saved to compare against (page text, price). */
  memo?: string
  /** Repo: the local clone of a GitHub repo, or the folder itself. */
  folder?: string
  /** Price with no product data: the model's saved selector. */
  selector?: string
  limit?: number
  field?: string
  command?: string
}

/** Axe needs one more thing before it can make a draft. */
export type Ask = { ask: "target" | "kind"; question: string; target?: string; kind?: Kind }
/** The target can't be watched as typed; the line under the composer says why. */
export type DraftError = { error: string; button?: { label: string; kind: Kind; target: string; force?: boolean } }

export type WatchPatch = Partial<Pick<Watch, "target" | "every" | "notify" | "answerer" | "name" | "paused" | "snoozedUntil" | "folder" | "condition" | "fixedMs" | "ignore" | "limit">>

/** What a sentence typed on the Watching page became: a plan, a question, or why the target can't be watched. */
export type ReadResult = Draft | Ask | (DraftError & { kind?: Kind; target?: string })

/**
 * What you can do to one finding from its card or notification. "ignore" ("Ignore changes like this")
 * takes a news item's time as its key, and "undo" a reply's time.
 */
export type FindingAct = "copied" | "expected" | "unexpected" | "snooze1h" | "snoozeDay" | "snoozeWeek" | "unsnooze" | "ignore" | "undo"
