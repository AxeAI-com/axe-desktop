import { randomUUID } from "node:crypto"

import { DEFAULT_EVERY, fixBrief, fixHeadline, nameFor, planSentence, rowLine } from "@shared/watching/copy"
import { nearRules } from "@shared/watching/diff"
import { applyRun, backUp, shouldNotify, withoutKeys } from "@shared/watching/findings"
import { fallbackAsk, nextAsk, parsePricePick, parseRead, parseReplyAnswer, PRICE_SYSTEM, pricePrompt, READ_SYSTEM, readPrompt, REPLY_SYSTEM, replyPrompt, type ReadSentence } from "@shared/watching/read"
import { CANT, readReply, TOO_OFTEN } from "@shared/watching/reply"
import { isDue, nextAt } from "@shared/watching/schedule"
import { nothingSince, noonOf, SUMMARY_DEFAULT, summaryCard, summaryDue, summaryItems, summaryNote, type SummaryAt } from "@shared/watching/summary"
import { gigabytes, inProtected, SLOW_KINDS } from "@shared/watching/more"
import { ONE_CLEAN, SLOW_ELEMENTS } from "@shared/watching/elements"
import { cleanTarget, hostOf, isSize, nearHost, urlOf } from "@shared/watching/target"
import type { Answerer } from "@shared/types"
import type { Ask, Draft, DraftError, Every, FindingAct, FixTurn, Kind, News, NotifyWhen, OpenFinding, PastFinding, ReadResult, Run, Said, Step, Watch, WatchList, WatchPatch, WatchState, WatchView } from "@shared/watching/types"

import type { AskModel } from "./model"
import { checkCustom } from "./checks/custom"

import type { CheckDeps } from "./checks/deps"
import { checkPage } from "./checks/page"
import { checkPrice, NO_PRICE } from "./checks/price"
import { checkRepo, expand, isFolder, NO_GH, repoSteps } from "./checks/repo"
import { checkSecurity, securitySteps } from "./checks/security"
import { checkUptime, probe, type UptimeDeps } from "./checks/uptime"
import { checkDisk, checkOutdated, checkTests, folderProblem, managerOf, PROTECTED_ERROR, safeFolder, testCommand, testsSteps } from "./checks/local"
import { checkDns, checkExpiry, checkHealth, checkStatus } from "./checks/web-health"
import { checkFeed, checkLinks, checkSeo, linksSteps, sitemapPages } from "./checks/web-site"
import { checkBattery, checkBrew, checkDocker, checkGitRepos, checkHogs, checkMacos, checkMemory, checkNetwork, checkPorts, checkProcesses, checkTimeMachine, findRepos, hogFolders, listeners } from "./checks/mac"
import { checkDownloads, checkEmail, checkFees, checkGlobal, checkMentions, checkPageSpeed, checkWallets } from "./checks/web-elements"
import type { Store } from "./store"

// The Watching engine: runs due watches (three at a time), folds each run into its findings,
// and says what changed. No Electron here; index.ts wires the tick, power and notifications.

export type EngineDeps = CheckDeps &
  Pick<UptimeDeps, "load" | "retryMs"> & {
    /** False while the Mac is offline: nothing runs and nothing fails. */
    online: () => boolean
    /** Something opened that should be shown now. */
    notice: (w: Watch, opened: OpenFinding[]) => void
    /** A problem that notified cleared by itself. */
    cleared?: (w: Watch, resolved: PastFinding[], latest: Run) => void
    /** The list changed. */
    changed: (list: WatchList) => void
    /** Who fixes: the watch's agent if it's ready, else the first coding agent, else Do it with an Axe model. */
    fixer?: (w: Watch) => Promise<{ agent: string; answerer: Answerer }>
    /** Starts a fix's agent session (plan mode, hidden from Recents) and gives back its chat. */
    startFix?: (o: { watch: Watch; brief: string; folder: string; answerer: Answerer; title: string }) => Promise<string>
    /** Puts a record's new value on the clipboard (Copy record). */
    copy?: (text: string) => void
    /** Sends a message into a fix's agent session ("Try again"). */
    continueFix?: (threadId: string, text: string, answerer: Answerer) => Promise<void>
    /** One structured call to a model: reading a sentence, a custom run, a reply. */
    ask?: AskModel
    /** Settings, Notifications: when the morning summary shows (default 8:00). */
    summaryAt?: () => SummaryAt
    /** The morning summary's notification. `problems`: it names a problem, so it makes a sound. */
    summary?: (body: string, problems: boolean) => void
  }

const STRIP = 120
const AT_ONCE = 3
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Changes the thread keeps. */
const KEEP_NEWS = 100
/** How long a new page or price watch shows "Checking now": its check already ran while validating. */
const FIRST_STEPS_MS = 900
/** Kinds whose validation only looks the target up: the first real run starts after Start watching. */
const RUN_AFTER_START: Kind[] = ["uptime", "security", "repo", ...SLOW_KINDS, ...SLOW_ELEMENTS]
/** Kinds whose problem clears after one clean run: a site back up, tests passing again. */
const ONE_CLEAN_RUN: Kind[] = ["uptime", "tests", "health", "status", "disk", ...ONE_CLEAN]
/** After Copy record, Axe checks hourly for a day before going back to the schedule. */
const COPIED_FOR = DAY

/** The GitHub repo a git remote points at: "git@github.com:mia/shop-web.git" → "mia/shop-web". */
export const githubOf = (remote: string) => remote.trim().match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?\/?$/i)?.[1] ?? null

/** Price over the last 30 days, oldest first: the first point, every change, and the latest. */
export function priceSeries(runs: Run[], now: number): [number, number][] {
  const pts = runs.filter((r) => r.status !== "failed" && r.metric !== undefined && r.at >= now - 30 * DAY)
  const out: [number, number][] = []
  for (const r of pts) if (!out.length || out.at(-1)![1] !== r.metric) out.push([r.at, r.metric!])
  const last = pts.at(-1)
  if (last && out.at(-1)![0] !== last.at) out.push([last.at, last.metric!])
  return out
}

/** The ignore rules Undo puts back, or the patch's other old values. */
const undoOf = (w: Watch, patch: WatchPatch): WatchPatch => Object.fromEntries(Object.keys(patch).map((k) => [k, w[k as keyof WatchPatch]])) as WatchPatch

export type DraftInput = {
  kind: Kind
  target: string
  answerer?: Answerer
  force?: boolean
  folders?: string[]
  every?: Every
  notify?: NotifyWhen
  /** Custom: what the model looks for, and the name it gave. */
  condition?: string
  name?: string
  /** The sentence you typed, when the draft came from free text. */
  asked?: string
  limit?: number
  field?: string
  command?: string
}

export function createEngine(store: Store, d: EngineDeps) {
  /** The real home folder, so targets are checked against it ("/Users/you/Desktop" like "~/Desktop"). */
  const home = () => d.home?.() || undefined
  const running = new Set<string>()
  /** Live steps of a run, for a new watch's "Checking now". */
  const steps = new Map<string, Step[]>()
  /** First runs started by create(), so tests can wait for them. */
  const firsts = new Set<Promise<unknown>>()

  /** One run of a watch's check. Page and price compare against what the last run saved (`memo`). */
  async function check(
    w: Pick<Watch, "kind" | "target" | "usual" | "fixedMs" | "ignore" | "folder" | "condition" | "answerer" | "selector" | "limit" | "field" | "command"> & { name?: string },
    history: Run[],
    memo?: string,
    onStep?: (s: Step[]) => void,
    s?: WatchState,
  ): Promise<{ run: Run; memo?: string; selector?: string }> {
    switch (w.kind) {
      case "uptime":
        return { run: await checkUptime(w.target, history, w, d, onStep) }
      case "page": {
        const r = await checkPage(w.target, memo, d, w.ignore)
        return { run: r.run, memo: r.text }
      }
      case "price": {
        const answerer = w.answerer
        const pick = answerer && d.ask ? (text: string) => d.ask!(answerer, PRICE_SYSTEM, pricePrompt(text)).then((x) => parsePricePick(x, text)) : undefined
        return checkPrice(w.target, memo, d, { missing: s?.noPrice ?? 0, name: w.name, selector: w.selector, pick })
      }
      case "security":
        return { run: await checkSecurity(w.target, d, onStep) }
      case "repo":
        return { run: await checkRepo(w.target, d, w.folder, onStep) }
      case "custom":
        return checkCustom(w.target, w.condition ?? "", w.answerer, memo, d, d.ask)
      case "health":
        return { run: await checkHealth(w.target, d, w) }
      case "expiry":
        return { run: await checkExpiry(w.target, d, w) }
      case "dns":
        return checkDns(w.target, d, memo)
      case "status":
        return { run: await checkStatus(w.target, d) }
      case "feed":
        return checkFeed(w.target, d, memo)
      case "seo":
        return { run: await checkSeo(w.target, d) }
      case "links":
        return { run: await checkLinks(w.target, d, onStep) }
      case "tests":
        return { run: await checkTests(w.target, d, w, onStep) }
      case "outdated":
        return { run: await checkOutdated(w.target, d) }
      case "disk":
        return { run: await checkDisk(w.target, d, w) }
      case "processes":
        return checkProcesses(d, w, memo)
      case "memory":
        return { run: await checkMemory(d) }
      case "battery":
        return { run: await checkBattery(d, w) }
      case "ports":
        return { run: await checkPorts(w.target, d) }
      case "docker":
        return checkDocker(d, memo)
      case "gitrepos":
        return { run: await checkGitRepos(w.target, d) }
      case "brew":
        return checkBrew(d, memo)
      case "macos":
        return checkMacos(d, memo)
      case "timemachine":
        return { run: await checkTimeMachine(d, w) }
      case "hogs":
        return checkHogs(w.target, d, w, memo)
      case "network":
        return checkNetwork(d, w, memo)
      case "pagespeed":
        return { run: await checkPageSpeed(w.target, d) }
      case "wallets":
        return checkWallets(w.target, d, memo)
      case "fees":
        return { run: await checkFees(d, w) }
      case "mentions":
        return checkMentions(w.target, d, memo)
      case "email":
        return { run: await checkEmail(w.target, d) }
      case "global":
        return { run: await checkGlobal(w.target, d, w) }
      case "downloads":
        return checkDownloads(w.target, d, memo)
    }
  }

  function view(w: Watch): WatchView {
    const s = store.state(w.id)
    const all = store.runs(w.id)
    // A new target starts the strip again; the runs before it stay in the history file.
    const runs = all.filter((r) => !w.targetAt || r.at >= w.targetAt).slice(-STRIP)
    const news = s.news ?? []
    const lastNews = news.findLast((n) => !n.ignored)
    const since = lastNews?.at ?? w.first?.at ?? w.createdAt
    return {
      ...w,
      latest: s.latest,
      open: s.open,
      failedStreak: s.failedStreak,
      nextAt: nextAt(w, s.lastAt, d.now()),
      strip: runs.map((r) => ({ at: r.at, status: r.status, metric: r.metric, ms: r.ms, ...(r.http ? { http: r.http } : {}), ...(r.stock ? { stock: r.stock } : {}), ...(r.state ? { state: r.state } : {}) })),
      line: rowLine(w.kind, s.latest, { since, now: d.now(), ...(s.unread && lastNews ? { unread: lastNews } : {}) }),
      past: s.past ?? [],
      said: s.said ?? [],
      news,
      unread: !!s.unread && !!lastNews,
      ...(w.kind === "price" ? { prices: priceSeries(all, d.now()) } : {}),
      ...(steps.has(w.id) ? { steps: steps.get(w.id) } : {}),
      ...(running.has(w.id) ? { checking: true } : {}),
      fixes: s.fixes ?? [],
    }
  }

  /** Problems first (newest first), then the rest by name. Quiet rows keep their place. */
  function list(): WatchList {
    const views = store.list().map(view)
    const problemAt = (v: WatchView) => Math.max(0, ...v.open.filter((f) => f.level === "problem").map((f) => f.openedAt))
    views.sort((a, b) => problemAt(b) - problemAt(a) || a.name.localeCompare(b.name))
    const card = shownCard()
    return { watches: views, ...(card ? { summary: { at: card.at, text: card.text } } : {}) }
  }

  /** The summary card while it shows: not closed, and before its noon. */
  function shownCard() {
    const c = store.summary().card
    return c && !c.closed && d.now() < c.until ? c : undefined
  }
  /** Whether the card showed at the last tick, so its going at noon reaches the window. */
  let cardWas = !!shownCard()

  /** Where the next summary starts: the last one, else a day back. */
  const summarySince = (now: number) => store.summary().lastAt ?? now - DAY

  /**
   * The morning summary, once a day at its time (until noon, if the Mac was asleep then). With nothing to
   * say there's no card and no notification. Either way the next one starts from here.
   */
  function summaryTick() {
    const now = d.now()
    const at = d.summaryAt?.() ?? SUMMARY_DEFAULT
    const sum = store.summary()
    if (summaryDue(at, now, sum.lastAt)) {
      const since = summarySince(now)
      const items = summaryItems(list().watches, since, now)
      const text = summaryCard(items, since, now)
      const note = summaryNote(items, since, now)
      store.setSummary({ lastAt: now, from: since, ...(text ? { card: { at: now, text, until: noonOf(now) } } : {}) })
      if (note) d.summary?.(note, items.problems.length > 0)
      if (text) d.changed(list())
    }
    const shown = !!shownCard()
    if (shown !== cardWas) {
      cardWas = shown
      d.changed(list())
    }
  }

  /**
   * /summary: this morning's summary told again with what came since (at most the last day), as the card,
   * now. It doesn't move where the next one starts, and it stays until you close it.
   */
  function summaryNow(): WatchList {
    const now = d.now()
    const sum = store.summary()
    const since = Math.max(sum.from ?? sum.lastAt ?? 0, now - DAY)
    const items = summaryItems(list().watches, since, now)
    const text = summaryCard(items, since, now) ?? nothingSince(since, now)
    const until = new Date(now)
    until.setHours(23, 59, 59, 999)
    store.setSummary({ ...store.summary(), card: { at: now, text, until: Math.max(noonOf(now), until.getTime()) } })
    cardWas = true
    const l = list()
    d.changed(l)
    return l
  }

  /** × on the card. */
  function summaryClose(): WatchList {
    const sum = store.summary()
    if (sum.card) store.setSummary({ ...sum, card: { ...sum.card, closed: true } })
    cardWas = false
    const l = list()
    d.changed(l)
    return l
  }

  async function runOne(id: string): Promise<WatchView | null> {
    const w = store.get(id)
    if (!w || running.has(id)) return w ? view(w) : null
    running.add(id)
    // The window shows it checking while it runs.
    d.changed(list())
    const history = store.runs(id, 200)
    // The first run sets the baseline: it can open a problem, but it never notifies (you're looking at it).
    const first = history.length === 0
    try {
      const onStep = first
        ? (s: Step[]) => {
            steps.set(id, s)
            d.changed(list())
          }
        : undefined
      const { run: raw, memo, selector } = await check(w, history, store.memo(id), onStep, store.state(id))
      // Deleted or changed while it ran: drop the result.
      let now = store.get(id)
      if (!now || now.target !== w.target) return now ? view(now) : null
      // The Mac went offline while it ran: what it saw says nothing about the target, so nothing is kept.
      if (!d.online()) return view(now)
      // The price's selector broke and the model picked a new one.
      if (selector && selector !== now.selector) store.put((now = { ...now, selector }))
      const run = withoutKeys(raw, now.expected)
      store.appendRun(id, run)
      if (memo !== undefined) store.setMemo(id, memo)
      const applied = applyRun(store.state(id), run, w.target, ONE_CLEAN_RUN.includes(w.kind) ? 1 : 2)
      const { opened, resolved } = applied
      const state = verifyFixes(withNews(applied.state, run), run)
      const tell = !first && shouldNotify(now, opened, d.now())
      if (tell) for (const f of state.open) if (opened.some((o) => o.key === f.key)) f.notified = true
      store.setState(id, state)
      if (first && !now.first) store.put({ ...now, first: run })
      if (tell) d.notice(now, opened)
      const back = backUp(now, resolved)
      if (back.length) d.cleared?.(now, back, run)
      return view(store.get(id) ?? now)
    } finally {
      running.delete(id)
      steps.delete(id)
      d.changed(list())
    }
  }

  /**
   * A run after your fix: a kept agent fix, or a record you copied. What the run no longer sees closes
   * as fixed straight away (no waiting for a second clean run, and no notification: you did it). A kept
   * fix the run still sees says "Still …".
   */
  function verifyFixes(s: WatchState, run: Run): WatchState {
    if (run.status === "failed") return s
    const seen = new Set(run.findings.map((f) => f.key))
    const kept = (s.fixes ?? []).filter((f) => f.state === "kept" && !f.result)
    const fixing = new Set(kept.flatMap((f) => f.keys))
    const gone = s.open.filter((f) => !seen.has(f.key) && (fixing.has(f.key) || (f.copiedAt && f.copiedAt <= run.at)))
    // Findings the clean-run rule already closed this run count as fixed too, when a fix was waiting on them.
    const closedNow = (s.past ?? []).filter((p) => p.closedAt === run.at && p.how === "cleared" && (fixing.has(p.key) || p.copiedAt))
    if (!kept.length && !gone.length && !closedNow.length) return s
    const fixed: PastFinding[] = gone.map((f) => ({ ...f, closedAt: run.at, how: "fixed" }))
    const past = [...(s.past ?? []).map((p) => (closedNow.includes(p) ? { ...p, how: "fixed" as const } : p)), ...fixed].slice(-50)
    const fixes = (s.fixes ?? []).map((f): FixTurn => {
      if (f.state !== "kept" || f.result) return f
      const still = f.keys.some((k) => seen.has(k))
      return { ...f, result: still ? "still" : "fixed", checkedAt: run.at }
    })
    return { ...s, open: s.open.filter((f) => !gone.includes(f)), past, fixes }
  }

  /** Keeps a run's changes in the thread, marks them unread, and counts runs with no price. */
  function withNews(s: WatchState, run: Run): WatchState {
    const fresh: News[] = run.findings.filter((f) => f.level === "news").map((f) => ({ ...f, at: run.at, ...(run.facts ? { facts: run.facts } : {}) }))
    const noPrice = run.status === "failed" && run.error === NO_PRICE ? (s.noPrice ?? 0) + 1 : run.findings.some((f) => f.key === "price:missing") ? (s.noPrice ?? 0) + 1 : 0
    const next: WatchState = { ...s, noPrice }
    if (!fresh.length) return next
    return { ...next, news: [...(s.news ?? []), ...fresh].slice(-KEEP_NEWS), unread: true }
  }

  /** A record you copied in the last day: Axe checks again every hour, as the card says. */
  function copiedDue(w: Watch, now: number) {
    if (w.paused) return false
    const s = store.state(w.id)
    const copied = s.open.some((f) => f.copiedAt && now - f.copiedAt < COPIED_FOR)
    return copied && now - (s.lastAt ?? 0) >= HOUR
  }

  /**
   * Runs every due watch, three at a time (offline: none), then the morning summary when it's due, so a
   * summary after the Mac wakes includes the catch-up runs.
   */
  async function tick() {
    if (d.online()) {
      const now = d.now()
      const due = store.list().filter((w) => !running.has(w.id) && (isDue(w, store.state(w.id).lastAt, now) || copiedDue(w, now)))
      for (let i = 0; i < due.length; i += AT_ONCE) await Promise.all(due.slice(i, i + AT_ONCE).map((w) => runOne(w.id)))
    }
    summaryTick()
  }


  /**
   * Validates a target before the plan shows. Uptime only checks that the site answers (the timed
   * first run starts after Start watching); the other kinds run their check once, and that run is the first.
   * `force`: "Watch it anyway" on a site that isn't answering.
   */
  async function draft(input: DraftInput): Promise<Draft | DraftError> {
    // Disk: "20 GB" is the limit, and the target is this Mac.
    if (input.kind === "disk" && input.limit === undefined && isSize(input.target) && gigabytes(input.target)) input = { ...input, limit: gigabytes(input.target)! }
    // Dev servers with no ports named: say which ones are listening, so you can pick.
    if (input.kind === "ports" && !input.target.trim()) {
      const on = (await listeners(d)).slice(0, 10)
      return { error: on.length ? `Which ports? Listening now: ${on.map((l) => `${l.port} (${l.command})`).join(", ")}.` : "Nothing is listening on this Mac right now. Name the ports your servers use, like 3000, 5173." }
    }
    const target = cleanTarget(input.kind, input.target, home())
    if (!target)
      return {
        error:
          input.kind === "repo"
            ? "That doesn’t look like a repo or folder."
            : input.kind === "tests" || input.kind === "outdated"
              ? inProtected(input.target.trim(), home())
                ? PROTECTED_ERROR
                : "That doesn’t look like a folder. Start it with ~/ or /."
              : input.kind === "ports"
                ? "Name the ports, like 3000, 5173."
                : input.kind === "wallets"
                  ? "Give 0x… (Base and Ethereum), Solana or Tron addresses, separated by commas."
                  : input.kind === "downloads"
                    ? "Download counts are public only for GitHub releases. Give the repo, like mia/shop-app. For your own server, watch the update feed instead."
                    : input.kind === "mentions"
                      ? "Give two to eighty characters to look for."
                      : input.kind === "hogs" || input.kind === "gitrepos"
                        ? "That doesn’t look like a folder. Start it with ~/ or /."
                        : input.kind === "status"
                ? "Name the services, like GitHub, Cloudflare, Groq or Infura, or a status page’s address."
                : input.kind === "page" || input.kind === "price" || input.kind === "custom" || input.kind === "health" || input.kind === "feed"
                  ? "That doesn’t look like a link."
                  : "That doesn’t look like a site address.",
      }
    const every = input.every ?? DEFAULT_EVERY[input.kind]
    const notify = input.notify ?? "now"
    const make = (first: Run, memo?: string, t = target, folder?: string): Draft => {
      const name = (input.kind === "price" && first.product) || (input.kind === "custom" && input.name) || nameFor(input.kind, t)
      return {
        kind: input.kind,
        target: t,
        name,
        every,
        notify,
        answerer: input.answerer,
        ...(input.condition ? { condition: input.condition } : {}),
        ...(input.asked ? { asked: input.asked } : {}),
        plan: planSentence(input.kind, t, every, notify, { name, first, condition: input.condition, limit: input.limit, field: input.field, command: input.command }),
        first,
        memo,
        ...(folder ? { folder } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.field ? { field: input.field } : {}),
        ...(input.command ? { command: input.command } : {}),
      }
    }
    if (input.kind === "tests" || input.kind === "outdated") {
      // The folder is the target, and fixes start there without asking.
      const dir = await safeFolder(target, d)
      if (!dir) return { error: PROTECTED_ERROR }
      let scripts: Record<string, string> | undefined
      try {
        scripts = d.exists(`${dir}/package.json`) ? (JSON.parse((await import("node:fs")).readFileSync(`${dir}/package.json`, "utf8")) as { scripts?: Record<string, string> }).scripts : undefined
      } catch {}
      const why = input.command ? (d.exists(dir) ? null : "That folder doesn’t exist.") : folderProblem(dir, d, input.kind === "tests" ? "tests" : "packages", scripts)
      if (why) return { error: why }
      if (input.kind === "tests") {
        const [cmd, args] = testCommand(dir, d, input.command)
        const command = [cmd, ...args.filter((a) => a !== "--silent")].join(" ")
        return make({ at: d.now(), ms: 0, status: "quiet", findings: [], facts: [["Command", command]] }, undefined, target, target)
      }
      const { run } = await check({ kind: "outdated", target }, [])
      if (run.status === "failed") return { error: `${run.error ?? `I couldn’t ask ${managerOf(dir, d)} about it`}.` }
      return make(run, undefined, target, target)
    }
    if (input.kind === "links") {
      const sm = await sitemapPages(urlOf(target).replace(/\/+$/, ""), d)
      if ("why" in sm) return { error: /wasn’t found/.test(sm.why) ? `${target} doesn’t exist. Check the spelling.` : `I couldn’t read ${target}/sitemap.xml (${sm.why}), so there are no pages to check.` }
      return make({ at: d.now(), ms: 0, status: "quiet", findings: [], facts: [["Pages", `${Math.min(sm.pages.length, 50)}`]] })
    }
    if (input.kind === "security") {
      const at = d.now()
      if (d.resolves && !(await d.resolves(target))) return { error: `${target} doesn’t exist. Check the spelling.` }
      return make({ at, ms: 0, status: "quiet", findings: [] })
    }
    if (input.kind === "repo") {
      const at = d.now()
      const r = await repoTarget(target, input.folders ?? [])
      if ("error" in r) return r
      return make({ at, ms: 0, status: "quiet", findings: [] }, undefined, r.target, r.folder)
    }
    if ((SLOW_ELEMENTS as Kind[]).includes(input.kind)) {
      // These take a while (a speed test, a scan, probes around the world): the first run starts after Start watching.
      const at = d.now()
      if (input.kind === "pagespeed" || input.kind === "global") {
        const p = await probe(target, d)
        if (!p.ok && p.error === "dns") return { error: `${target.split("/")[0]} doesn’t exist. Check the spelling.` }
        if (input.kind === "global" && /^localhost|^127\./.test(target)) return { error: "Probes around the world can’t reach a server on this Mac. Give a public site." }
      }
      if (input.kind === "gitrepos") {
        const dir = await safeFolder(target, d)
        if (!dir) return { error: PROTECTED_ERROR }
        if (!d.exists(dir)) return { error: "That folder doesn’t exist." }
        const n = (await findRepos(dir, d)).length
        if (!n) return { error: `There are no git repos in ${target}.` }
        return make({ at, ms: 0, status: "quiet", findings: [], facts: [["Repos", `${n}`]] })
      }
      if (input.kind === "hogs" && !(await hogFolders(target, d).catch(() => [])).some((p) => d.exists(p))) return { error: "None of those folders exist." }
      return make({ at, ms: 0, status: "quiet", findings: [] })
    }
    if (input.kind === "uptime") {
      const at = d.now()
      const p = await probe(target, d)
      if (!p.ok && p.error === "dns") return { error: `${target.split("/")[0]} doesn’t exist. Check the spelling.` }
      if ((!p.ok || p.status >= 500) && !input.force)
        return { error: `${target.split("/")[0]} isn’t answering right now.`, button: { label: "Watch it anyway", kind: "uptime", target, force: true } }
      return make({ at, ms: p.ok ? p.ms : 0, status: "quiet", findings: [] })
    }
    const { run: first, memo, selector } = await check({ kind: input.kind, target, condition: input.condition, answerer: input.answerer, limit: input.limit, field: input.field, command: input.command }, [])
    const said = `${first.error ?? ""} ${first.findings[0]?.detail ?? ""}`
    if (/wasn’t found/.test(said)) return { error: `${target.split("/")[0]} doesn’t exist. Check the spelling.` }
    // A page with no price Axe can read can still be watched for changes: your click, not a guess.
    if (first.error === NO_PRICE) return { error: NO_PRICE, button: { label: "Watch the page instead", kind: "page", target } }
    if (first.status === "failed") return { error: first.error ?? "I couldn’t check that." }
    return { ...make(first, memo), ...(selector ? { selector } : {}) }
  }

  /**
   * A sentence typed on the Watching page. It goes once to the picked model, which says the kind, the
   * target and anything else it was told; then the target is validated like a starter's. No model, or a
   * reply that doesn't validate: the fallback finds an address and asks what to watch on it.
   */
  async function read(input: { text: string; answerer?: Answerer; folders?: string[]; known?: string[] }): Promise<ReadResult> {
    const text = input.text.trim()
    let r: ReadSentence | null = null
    if (input.answerer && d.ask) r = parseRead(await d.ask(input.answerer, READ_SYSTEM, readPrompt(text)).catch(() => ""))
    if (!r) return fallbackAsk(text)
    const ask = nextAsk(r)
    if (ask) return ask
    const kind = r.kind as Kind
    const target = r.target ?? ""
    const res = await draft({ kind, target, answerer: input.answerer, folders: input.folders, every: r.every, notify: r.notify, condition: r.condition, name: r.name, asked: text, limit: r.limit, field: r.field })
    if (!("error" in res)) return res
    return { ...unreachable(kind, cleanTarget(kind, target, home()) ?? target, res, input.known ?? []), kind, target }
  }

  /**
   * Why a typed target can't be watched, said in the thread: "I couldn’t reach lane-ceramics.co. That
   * domain doesn’t exist." with the close match from your own watches and chats, one edit away.
   */
  function unreachable(kind: Kind, target: string, e: DraftError, known: string[]): DraftError {
    const host = hostOf(target)
    if (/doesn’t exist\. Check the spelling\.$/.test(e.error)) {
      const near = nearHost(host, [...store.list().map((w) => hostOf(w.target)), ...known])
      const fixed = near ? target.replace(host, near) : null
      return { error: `I couldn’t reach ${host}. That domain doesn’t exist.`, ...(fixed ? { button: { label: `Use ${fixed}`, kind, target: fixed } } : {}) }
    }
    if (/isn’t answering right now\.$/.test(e.error) && !e.button) return { error: `${e.error} Try again in a minute.` }
    return e
  }

  /**
   * Where a repo watch looks. A folder must be a git repo; when its remote is a GitHub repo you can
   * see, the watch uses both. "owner/repo" needs gh to see it, and finds its local clone among `folders`.
   */
  async function repoTarget(target: string, folders: string[]): Promise<{ target: string; folder?: string } | DraftError> {
    const gitRemote = async (dir: string) => {
      const r = await d.exec("git", ["remote", "get-url", "origin"], { cwd: dir, timeoutMs: 5_000 })
      return r.code === 0 ? githubOf(r.stdout) : null
    }
    const canSee = async (repo: string) => {
      const r = await d.exec("gh", ["api", `repos/${repo}`, "--jq", ".full_name"], { cwd: expand("~"), timeoutMs: 15_000 })
      return r.missing ? "missing" : r.code === 0 ? "yes" : "no"
    }
    if (isFolder(target)) {
      const dir = expand(target)
      if (!d.exists(dir)) return { error: "That folder doesn’t exist." }
      if (!d.exists(`${dir}/.git`)) return { error: "That folder isn’t a git repo." }
      const repo = await gitRemote(dir)
      if (repo && (await canSee(repo)) === "yes") return { target: repo, folder: target }
      return { target }
    }
    const seen = await canSee(target)
    if (seen === "missing") return { error: `${NO_GH}. Axe can still check the folder.` }
    if (seen === "no") return { error: `Axe can’t see ${target}. Check the name, or sign in with gh auth login.` }
    for (const f of folders) {
      if (!d.exists(expand(f))) continue
      if ((await gitRemote(expand(f)))?.toLowerCase() === target.toLowerCase()) return { target, folder: f }
    }
    return { target }
  }

  function create(dr: Draft): WatchView {
    const w: Watch = {
      id: randomUUID(),
      kind: dr.kind,
      target: dr.target,
      name: dr.name,
      every: dr.every,
      firstEvery: dr.every,
      notify: dr.notify,
      answerer: dr.answerer,
      condition: dr.condition,
      ...(dr.asked ? { asked: dr.asked } : {}),
      ...(dr.selector ? { selector: dr.selector } : {}),
      ...(dr.limit !== undefined ? { limit: dr.limit } : {}),
      ...(dr.field ? { field: dr.field } : {}),
      ...(dr.command ? { command: dr.command } : {}),
      createdAt: d.now(),
      ...(dr.folder ? { folder: dr.folder } : {}),
    }
    if (RUN_AFTER_START.includes(dr.kind)) {
      // The first real run starts now; the screen shows its steps.
      store.put(w)
      steps.set(
        w.id,
        dr.kind === "security"
          ? securitySteps(new Set())
          : dr.kind === "tests"
            ? testsSteps(dr.first.facts?.[0]?.[1] ?? "the tests", false)
            : dr.kind === "links"
              ? linksSteps(0, 0)
          : dr.kind === "repo"
            ? repoSteps({ github: !isFolder(w.target), folder: !!w.folder || isFolder(w.target) }, 0)
            : [
                { label: `Loading ${w.target}`, state: "run" },
                { label: "Timing the page", state: "todo" },
              ],
      )
      const p = runOne(w.id).finally(() => firsts.delete(p))
      firsts.add(p)
    } else {
      store.put({ ...w, first: dr.first })
      store.appendRun(w.id, dr.first)
      if (dr.memo !== undefined) store.setMemo(w.id, dr.memo)
      store.setState(w.id, applyRun({ open: [], failedStreak: 0 }, dr.first, w.target).state)
      // The validating check was the first run; "Checking now" shows while its copy is saved.
      const label = dr.kind === "page" ? "Saving its text" : dr.kind === "price" ? "Finding the price" : dr.kind === "custom" ? "Reading it" : null
      if (label) {
        steps.set(w.id, [
          { label: "Loading the page", state: "done" },
          { label, state: "run" },
        ])
        const p: Promise<void> = d.sleep(FIRST_STEPS_MS).then(() => {
          steps.delete(w.id)
          firsts.delete(p)
          d.changed(list())
        })
        firsts.add(p)
      }
    }
    d.changed(list())
    return view(store.get(w.id)!)
  }

  /** Puts a change on the watch. Pausing keeps when; resuming runs once straight away. */
  function apply(w: Watch, patch: WatchPatch): { next: Watch; resumed: boolean; retarget: boolean } {
    const next: Watch = { ...w, ...patch }
    let retarget = false
    if (patch.target !== undefined) {
      const t = cleanTarget(w.kind, patch.target, home())
      next.target = t ?? w.target
      // A new target starts fresh: history stays, the open findings, baseline and saved copy go.
      if (t && t !== w.target) {
        retarget = true
        next.targetAt = d.now()
        if (w.kind !== "custom" && next.name === nameFor(w.kind, w.target)) next.name = (w.kind === "price" ? undefined : nameFor(w.kind, t)) ?? next.name
        store.setState(w.id, { ...store.state(w.id), open: [], failedStreak: 0, unread: false, noPrice: 0 })
        store.clearMemo(w.id)
        delete next.usual
      }
    }
    if (patch.paused === true && !w.paused) next.pausedAt = d.now()
    const resumed = patch.paused === false && !!w.paused
    if (resumed) delete next.pausedAt
    store.put(next)
    return { next, resumed, retarget }
  }

  /**
   * Edit, the chevron menu and the row menu. A new target is validated as when creating and starts
   * fresh with a run; Resume says so in the thread and runs once straight away.
   */
  async function update(id: string, patch: WatchPatch): Promise<WatchView | DraftError | null> {
    const w = store.get(id)
    if (!w) return null
    if (patch.target !== undefined && cleanTarget(w.kind, patch.target, home()) !== w.target) {
      const ok = await draft({ kind: w.kind, target: patch.target, answerer: w.answerer, condition: w.condition, name: w.name, force: true, folders: w.folder ? [w.folder] : [], limit: w.limit, field: w.field, command: w.command })
      if ("error" in ok) return ok
    }
    const { resumed, retarget } = apply(w, patch)
    if (resumed) say(id, { you: "", axe: "Resumed. Checking now." })
    d.changed(list())
    if (resumed || retarget) void runOne(id)
    return view(store.get(id)!)
  }

  function remove(id: string): WatchList {
    store.remove(id)
    const l = list()
    d.changed(l)
    return l
  }

  const say = (id: string, s: Omit<Said, "at">) => {
    const st = store.state(id)
    // Two answers in the same millisecond would share an Undo key.
    const at = Math.max(d.now(), (st.said?.at(-1)?.at ?? 0) + 1)
    store.setState(id, { ...st, said: [...(st.said ?? []), { at, ...s }].slice(-200) })
  }

  /** "Ignore changes like this" on a page change: its part of the page stops counting. */
  function ignore(id: string, newsAt: number): WatchView | null {
    const w = store.get(id)
    const s = store.state(id)
    const n = s.news?.find((x) => x.at === newsAt)
    if (!w || !n) return w ? view(w) : null
    const rules = [...new Set([...(w.ignore ?? []), ...nearRules(n.ev?.anchors?.length ? n.ev.anchors : [""])])]
    store.put({ ...w, ignore: rules })
    store.setState(id, { ...s, news: s.news!.map((x) => (x === n ? { ...x, ignored: true } : x)), unread: false })
    say(id, { you: "", axe: "Okay. I’ll ignore changes in that part of the page.", undo: { ignore: w.ignore ?? [] }, undoNews: newsAt })
    return view(store.get(id)!)
  }

  /** Undo on something Axe said: the watch goes back, and an ignored change shows again. */
  function undo(id: string, saidAt: number): WatchView | null {
    const w = store.get(id)
    const s = store.state(id)
    const said = s.said?.find((x) => x.at === saidAt)
    if (!w || !said?.undo || said.undone) return w ? view(w) : null
    store.put({ ...w, ...said.undo })
    store.setState(id, {
      ...s,
      said: s.said!.map((x) => (x === said ? { ...x, undone: true } : x)),
      news: said.undoNews !== undefined ? s.news?.map((x) => (x.at === said.undoNews ? { ...x, ignored: false } : x)) : s.news,
    })
    return view(store.get(id)!)
  }

  /** You opened the watch: its changes are read. */
  function seen(id: string): WatchView | null {
    const w = store.get(id)
    if (!w) return null
    const s = store.state(id)
    if (s.unread) {
      store.setState(id, { ...s, unread: false })
      d.changed(list())
    }
    return view(w)
  }

  /**
   * A finding's card. "That's expected" closes it: for slow, the usual moves up to the load time now;
   * for anything else, its key stops counting. Undo puts it back. Snoozing keeps it open but quiet.
   */
  function act(id: string, key: string, a: FindingAct): WatchView | null {
    const w = store.get(id)
    if (!w) return null
    const s = store.state(id)
    const now = d.now()
    if (a === "ignore" || a === "undo") {
      const v = a === "ignore" ? ignore(id, Number(key)) : undo(id, Number(key))
      d.changed(list())
      return v
    }
    if (a === "copied") {
      const want = s.open.find((f) => f.key === key)?.ev?.record?.want
      if (want) d.copy?.(want)
      store.setState(id, { ...s, open: s.open.map((f) => (f.key === key ? { ...f, copiedAt: now } : f)) })
      d.changed(list())
      return view(store.get(id)!)
    }
    if (a === "expected") {
      const f = s.open.find((x) => x.key === key)
      if (!f) return view(w)
      const past: PastFinding = { ...f, closedAt: now, how: "expected" }
      if (key === "slow") {
        const ms = s.latest?.metric ?? f.value ?? 0
        store.put({ ...w, usual: { ms, at: now, ...(w.usual ? { prev: w.usual } : {}) } })
      } else store.put({ ...w, expected: [...new Set([...(w.expected ?? []), key])] })
      store.setState(id, { ...s, open: s.open.filter((x) => x.key !== key), past: [...(s.past ?? []), past] })
    } else if (a === "unexpected") {
      const i = (s.past ?? []).findLastIndex((x) => x.key === key && x.how === "expected")
      if (i < 0) return view(w)
      const { closedAt: _c, how: _h, ...f } = s.past![i]!
      if (key === "slow") store.put({ ...w, usual: w.usual?.prev })
      else store.put({ ...w, expected: (w.expected ?? []).filter((k) => k !== key) })
      store.setState(id, { ...s, open: [...s.open.filter((x) => x.key !== key), f], past: s.past!.filter((_, j) => j !== i) })
    } else {
      const until = a === "snooze1h" ? now + HOUR : a === "snoozeWeek" ? now + 7 * 24 * HOUR : a === "snoozeDay" ? nineTomorrow(now) : undefined
      store.setState(id, { ...s, open: s.open.map((f) => (f.key === key ? { ...f, snoozedUntil: until } : f)) })
    }
    d.changed(list())
    return view(store.get(id)!)
  }

  /** What the model is told about a watch when you reply to it. */
  function context(w: Watch) {
    const v = view(w)
    const t = (x: number) => new Date(x).toISOString().slice(0, 16).replace("T", " ")
    const recent = [
      ...v.news.slice(-10).map((n) => `${t(n.at)} ${n.headline}`),
      ...v.past.slice(-10).map((f) => `${t(f.openedAt)} to ${t(f.closedAt)} ${f.headline}`),
      ...v.open.map((f) => `${t(f.openedAt)} open: ${f.headline}`),
    ]
    return { kind: w.kind, target: w.target, name: w.name, every: w.every, notify: w.notify, paused: w.paused, condition: w.condition, ignore: w.ignore, fixedMs: w.fixedMs, latest: v.line, recent }
  }

  /**
   * A reply in the thread. It goes to the watch's model with the watch as context, which answers with a
   * change or a plain answer. With no model (or no valid answer), a few plain phrases still work.
   * Both stay in the thread; a change has Undo.
   */
  async function reply(id: string, text: string): Promise<WatchView | null> {
    const w = store.get(id)
    if (!w) return null
    const change = (patch: WatchPatch, axe: string, undo = true) => {
      const before = store.get(id) ?? w
      const { resumed } = apply(before, patch)
      say(id, { you: text, axe, ...(undo && !("paused" in patch) ? { undo: undoOf(before, patch) } : {}) })
      if (resumed) void runOne(id)
    }
    const plain = readReply(w, text)
    // "every minute": the one thing no model can change.
    if (TOO_OFTEN.test(text)) say(id, { you: text, axe: "I can’t check more often than every 5 minutes." })
    else {
      const answer = w.answerer && d.ask ? await d.ask(w.answerer, REPLY_SYSTEM, replyPrompt(context(w), text)).then((x) => parseReplyAnswer(x, w), () => null) : null
      if (answer?.patch) change(answer.patch, answer.say)
      else if (answer && !plain) say(id, { you: text, axe: answer.say })
      else if (plain) change(plain.patch, plain.say, !!plain.undo)
      else say(id, { you: text, axe: CANT })
    }
    d.changed(list())
    return view(store.get(id)!)
  }

  const setFixes = (id: string, fn: (fixes: FixTurn[]) => FixTurn[]) => {
    const st = store.state(id)
    store.setState(id, { ...st, fixes: fn(st.fixes ?? []).slice(-50) })
  }

  /**
   * "Fix with …": asks which folder has the code the first time (the thread shows the question), then
   * starts the agent in plan mode with a brief built from the evidence. The folder is remembered.
   */
  async function fix(id: string, keys: string[], folder?: string): Promise<WatchView | null> {
    const w = store.get(id)
    if (!w || !d.fixer || !d.startFix) return w ? view(w) : null
    const s = store.state(id)
    const findings = s.open.filter((f) => keys.includes(f.key))
    if (!findings.length) return view(w)
    const who = await d.fixer(w)
    const code = folder ?? w.folder ?? (w.kind === "repo" && isFolder(w.target) ? w.target : undefined)
    const asking = (s.fixes ?? []).findLast((f) => f.state === "asking")
    const at = asking?.at ?? Math.max(d.now(), (s.fixes?.at(-1)?.at ?? 0) + 1)
    const headline = fixHeadline(w.kind, w.name, findings)
    if (!code) {
      if (!asking) setFixes(id, (fx) => [...fx, { at, keys, headline, agent: who.agent, answerer: who.answerer, state: "asking" }])
      d.changed(list())
      return view(store.get(id)!)
    }
    if (folder && folder !== w.folder) store.put({ ...w, folder })
    const turn: FixTurn = { at, keys, headline, agent: who.agent, answerer: who.answerer, folder: code, state: "working" }
    setFixes(id, (fx) => [...fx.filter((f) => f.at !== at), turn])
    d.changed(list())
    try {
      const threadId = await d.startFix({ watch: store.get(id)!, brief: fixBrief(w, findings, s.latest), folder: expand(code), answerer: who.answerer, title: headline })
      setFixes(id, (fx) => fx.map((f) => (f.at === at ? { ...f, threadId } : f)))
    } catch (e) {
      // It couldn't start (the agent isn't signed in, say): the problem card comes back with its buttons.
      setFixes(id, (fx) => fx.filter((f) => f.at !== at))
      say(id, { you: "", axe: `${who.agent} couldn’t start. ${e instanceof Error ? e.message : ""}`.trim() })
    }
    d.changed(list())
    return view(store.get(id)!)
  }

  /** Keep all or Undo all on a fix's changes. Repo fixes re-run the folder checks straight away. */
  async function fixDone(id: string, at: number, how: "kept" | "undone", files?: number): Promise<WatchView | null> {
    const w = store.get(id)
    if (!w) return null
    setFixes(id, (fx) => fx.map((f) => (f.at === at ? { ...f, state: how, endedAt: d.now(), ...(files !== undefined ? { files } : {}), result: undefined } : f)))
    d.changed(list())
    if (how === "kept" && w.kind === "repo") return runOne(id)
    return view(store.get(id)!)
  }

  /** "Try again": the same agent session gets the new numbers. */
  async function fixAgain(id: string, at: number): Promise<WatchView | null> {
    const w = store.get(id)
    const s = store.state(id)
    const turn = s.fixes?.find((f) => f.at === at)
    if (!w || !turn?.threadId || !d.continueFix) return w ? view(w) : null
    const still = s.open.filter((f) => turn.keys.includes(f.key))
    const brief = [`That didn’t fix it. ${fixHeadline(w.kind, w.name, still.length ? still : [{ headline: turn.headline }])}.`, fixBrief(w, still, s.latest).split("\n").slice(1).join("\n")].join("\n")
    setFixes(id, (fx) => fx.map((f) => (f.at === at ? { ...f, state: "working", result: undefined, endedAt: undefined } : f)))
    d.changed(list())
    await d.continueFix(turn.threadId, brief.trim(), turn.answerer)
    return view(store.get(id)!)
  }

  /** Resolves once every first run that create() started has finished. */
  const settled = async () => {
    while (firsts.size) await Promise.all([...firsts])
  }

  return { settled, list, get: (id: string) => (store.get(id) ? view(store.get(id)!) : null), runs: (id: string) => store.runs(id), tick, runOne, draft, read, create, update, remove, act, reply, seen, fix, fixDone, fixAgain, summaryNow, summaryClose }
}

/** "Until tomorrow": 9:00 am the next day, local time. */
export function nineTomorrow(now: number) {
  const t = new Date(now)
  t.setDate(t.getDate() + 1)
  t.setHours(9, 0, 0, 0)
  return t.getTime()
}

export type Engine = ReturnType<typeof createEngine>
