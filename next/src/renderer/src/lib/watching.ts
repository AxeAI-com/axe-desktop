import { DEFAULT_EVERY, KIND_LABEL, nameFor, planSentence } from "@shared/watching/copy"
import { type CatalogueItem, NO_INPUT } from "@shared/watching/elements"
import { EVERY_LABEL } from "@shared/watching/schedule"
import { cleanTarget, findTarget, hostOf } from "@shared/watching/target"
import type { Answerer } from "@shared/types"
import type { Draft, DraftError, Every, FindingAct, Kind, NotifyWhen, WatchPatch, WatchView } from "@shared/watching/types"

import { invoke } from "./bridge"
import type { WatchCommand } from "./slash"
import { defaultAnswerer, getState, plainError, setState } from "./store"

// The window's side of Watching: open the pages, draft a watch from a starter, create, change and
// delete watches. The engine (src/main/watching) does the checking.

export async function loadWatching() {
  const watching = await invoke("watching:list").catch(() => null)
  if (watching) setState({ watching })
}

/** The Watching page; `kind` opens it with that starter's chip in the composer. */
export function openWatching(kind?: Kind) {
  setState({ view: { kind: "watching" }, paletteOpen: false, watchKind: kind ?? null, watchError: null, watchErrorButton: null, watchAsk: null, watchAsked: null })
  void loadWatching()
}

/**
 * Add on a catalogue card: the watch's chat. Kinds that need nothing go straight to the plan (or say why they
 * can't run here); the rest put their question in the composer. Dev servers also lists what's listening now.
 */
export function addElement(item: CatalogueItem) {
  // Custom is a sentence: the model reads it, as when you type on the page.
  if (item.kind === "custom") return void setState((s) => ({ watchKind: null, watchHint: null, watchAsk: null, watchError: null, watchErrorButton: null, watchSeed: { text: "Tell me when ", n: (s.watchSeed?.n ?? 0) + 1 } }))
  setState({ watchKind: item.kind, watchHint: item.ask ?? null, watchAsk: null, watchAsked: null, watchError: null, watchErrorButton: null })
  if ((NO_INPUT as Kind[]).includes(item.kind)) void draftWatch(item.kind, "")
  else if (item.kind === "ports") void draftWatch("ports", "")
}

export function openWatch(id: string) {
  setState({ view: { kind: "watch", id }, paletteOpen: false, watchEditing: false })
  void loadWatching()
}

export const watchById = (id: string) => getState().watching?.watches.find((w) => w.id === id)

/** The limit on checking a target before the plan shows. */
const DRAFT_LIMIT = 10_000

/** Checks the target once; on success the plan screen opens. `force`: "Watch it anyway". */
export async function draftWatch(kind: Kind, target: string, force = false) {
  const shown = (cleanTarget(kind, target) ?? target.trim()).split("/")[0] ?? target
  setState({ watchBusy: true, watchBusyTarget: shown, watchError: null, watchErrorButton: null })
  try {
    const answerer = getState().draft.answerer ?? defaultAnswerer()
    const limit = new Promise<"late">((r) => setTimeout(() => r("late"), DRAFT_LIMIT + 2_000))
    // A GitHub repo finds its local clone among the folders of recent agent chats.
    const folders = kind === "repo" ? [...new Set(getState().threads.filter((t) => t.source === "agent" && t.cwd && !t.copy).map((t) => t.cwd!))] : undefined
    const d = await Promise.race([invoke("watching:draft", { kind, target, answerer, ...(force ? { force } : {}), ...(folders ? { folders } : {}) }), limit])
    if (d === "late") return void setState({ watchError: `${shown} isn’t answering right now.`, watchErrorButton: kind === "uptime" ? { label: "Watch it anyway", kind, target, force: true } : null })
    if ("error" in d) return void setState({ watchError: d.error, watchErrorButton: d.button ?? null })
    // A target typed after "Which site?" keeps the sentence it answered as the plan's bubble.
    const asked = getState().watchAsked
    setState({ view: { kind: "newWatch", draft: asked ? { ...d, asked } : d }, watchKind: null, watchAsk: null, watchAsked: null })
  } catch (e) {
    setState({ watchError: plainError(e) })
  } finally {
    setState({ watchBusy: false, watchBusyTarget: null })
  }
}

/** How long a sentence may take: the model's read (a CLI agent starts up first) and the target's check. */
const READ_LIMIT = 75_000

/** Hosts you've written about in chats, so a typo's close match can be offered. */
const knownHosts = () => [...new Set(getState().threads.slice(0, 200).map((t) => findTarget(t.title ?? "")).filter((x): x is string => !!x).map(hostOf))]

let reads = 0

/**
 * Free text on the Watching page goes once to the picked model. It comes back as a plan, a question
 * (what to watch, or which site), or why the target can't be watched. With no answer in time, the
 * fallback finds an address and asks what to watch on it.
 */
export async function readFreeText(text: string, answerer: Answerer) {
  const n = ++reads
  setState({ watchAsk: { text, reading: true }, watchKind: null, watchError: null, watchErrorButton: null, watchAsked: null })
  const folders = [...new Set(getState().threads.filter((t) => t.source === "agent" && t.cwd && !t.copy).map((t) => t.cwd!))]
  const limit = new Promise<"late">((r) => setTimeout(() => r("late"), READ_LIMIT))
  const r = await Promise.race([invoke("watching:read", { text, answerer, folders, known: knownHosts() }), limit]).catch(() => "late" as const)
  // A newer sentence, or you left the page.
  if (n !== reads || getState().watchAsk?.text !== text) return
  if (r === "late") {
    const target = findTarget(text)
    return void setState({ watchAsk: { text, question: target ? `What should I watch on ${target}?` : "What should I watch?", ...(target ? { target } : {}) } })
  }
  if ("plan" in r) return void setState({ view: { kind: "newWatch", draft: r }, watchAsk: null, watchKind: null })
  if ("error" in r) {
    const e = r as DraftError & { kind?: Kind; target?: string }
    // The composer keeps the kind and your target so you can fix a typo.
    setState((s) => ({ watchAsk: { text, error: e.error, ...(e.button ? { button: e.button } : {}), kind: e.kind }, watchKind: e.kind ?? null, watchSeed: e.target ? { text: e.target, n: (s.watchSeed?.n ?? 0) + 1 } : s.watchSeed }))
    return
  }
  if (r.ask === "target") return void setState({ watchAsk: { text, question: r.question, kind: r.kind }, watchKind: r.kind ?? null, watchAsked: text })
  setState({ watchAsk: { text, question: r.question, ...(r.target ? { target: r.target } : {}) } })
}

/** The plan's dropdowns rewrite the plan sentence. */
export function changeDraft(d: Draft, patch: { every?: Every; notify?: NotifyWhen }) {
  const next = { ...d, ...patch }
  next.plan = planSentence(next.kind, next.target, next.every, next.notify, { name: next.name, first: next.first, condition: next.condition })
  setState({ view: { kind: "newWatch", draft: next } })
}

export async function startWatch(d: Draft) {
  const v = await invoke("watching:create", d)
  setState((s) => ({ watching: { ...s.watching, watches: [...(s.watching?.watches ?? []).filter((w) => w.id !== v.id), v] } }))
  openWatch(v.id)
}

/** Edit, Rename, Pause and Resume. A new target that can't be watched comes back as its error. */
export async function updateWatch(id: string, patch: WatchPatch): Promise<WatchView | DraftError | null> {
  const v = await invoke("watching:update", id, patch)
  if (v && !("error" in v)) replace(v)
  return v
}

/** Pause or Resume from the chevron menu, the row's menu or the paused bar. */
export const setPaused = (id: string, paused: boolean) => updateWatch(id, { paused })

export async function deleteWatch(id: string) {
  const watching = await invoke("watching:delete", id)
  setState({ watching })
  openWatching()
}

export async function checkNow(id: string) {
  setState({ watchChecking: id })
  try {
    const v = await invoke("watching:checkNow", id)
    if (v) replace(v)
  } finally {
    setState({ watchChecking: null })
  }
}

/** A finding's card: That's expected, Snooze, and their Undo. */
export async function actOn(id: string, key: string, act: FindingAct) {
  const v = await invoke("watching:act", id, key, act)
  if (v) replace(v)
}

/** The same act on several findings: a repo's alerts are one card. */
export async function actOnAll(id: string, keys: string[], act: FindingAct) {
  for (const k of keys) await actOn(id, k, act)
}

/** "Fix with …": Axe asks for the code folder the first time, then starts the agent in the watch's thread. */
export async function fixWatch(id: string, keys: string[], folder?: string) {
  const v = await invoke("watching:fix", id, keys, folder)
  if (v) replace(v)
}

/** Keep all or Undo all on a fix's changes; a kept repo fix re-checks straight away. */
export async function fixDone(id: string, at: number, how: "kept" | "undone", files?: number) {
  if (how === "kept") setState({ watchChecking: id })
  try {
    const v = await invoke("watching:fixDone", id, at, how, files)
    if (v) replace(v)
  } finally {
    if (how === "kept") setState({ watchChecking: null })
  }
}

/** "Try again" after a fix didn't hold: the same agent session gets the new numbers. */
export async function fixAgain(id: string, at: number) {
  const v = await invoke("watching:fixAgain", id, at)
  if (v) replace(v)
}

/** /summary: the morning summary card now. */
export async function showSummary() {
  const watching = await invoke("watching:summary")
  setState({ watching })
  openWatching()
}

/** × on the summary card. */
export async function closeSummary() {
  setState((s) => ({ watching: s.watching ? { watches: s.watching.watches } : s.watching }))
  setState({ watching: await invoke("watching:summaryClose") })
}

/** /check, /pause or /resume on one watch. */
export async function commandWatch(cmd: "check" | "pause" | "resume", id: string) {
  if (cmd === "check") return checkNow(id)
  await setPaused(id, cmd === "pause")
}

/** The watches a message names with @, longest names first so "@a.com security" isn't read as "@a.com". */
export function namedWatches(text: string, watches: WatchView[]): WatchView[] {
  let rest = text
  const out: WatchView[] = []
  for (const w of [...watches].sort((a, b) => b.name.length - a.name.length)) {
    const tag = `@${w.name}`
    if (!rest.includes(tag)) continue
    out.push(w)
    rest = rest.split(tag).join(" ")
  }
  return out.sort((a, b) => text.indexOf(`@${a.name}`) - text.indexOf(`@${b.name}`))
}

/** "a", "a and b", "a, b and c". */
const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

const DONE: Record<"check" | "pause" | "resume", (names: string) => string> = {
  check: (n) => `Checked ${n}.`,
  pause: (n) => `Paused ${n}.`,
  resume: (n) => `Started ${n} again.`,
}

/**
 * A Watching command typed and sent: /summary shows the card; /check, /pause and /resume act on the watch
 * whose thread this is, else on the watches named with @, and answer once under the composer.
 */
export async function runWatchCommand(cmd: WatchCommand, rest: string, watchId?: string) {
  if (cmd === "summary") return showSummary()
  const all = getState().watching?.watches ?? []
  const targets = watchId ? all.filter((w) => w.id === watchId) : namedWatches(rest, all)
  if (!targets.length) return void setState({ watchError: all.length ? "Pick a watch with @." : "There are no watches yet.", watchNote: null })
  await Promise.all(targets.map((w) => commandWatch(cmd, w.id)))
  if (!watchId) setState({ watchNote: DONE[cmd](and(targets.map((w) => w.name))), watchError: null })
}

/**
 * "Pause @a and @b until Monday": the same reply goes to each watch's thread, and Axe answers once,
 * under the composer.
 */
export async function replyToMany(targets: WatchView[], text: string) {
  setState({ watchNote: null, watchError: null })
  const said = await Promise.all(
    targets.map(async (w) => {
      const v = await invoke("watching:reply", w.id, text)
      if (v) replace(v)
      return v?.said.at(-1)?.axe ?? ""
    }),
  )
  const same = said.every((x) => x === said[0])
  setState({ watchNote: same ? said[0] || null : targets.map((w, i) => `${w.name}: ${said[i]}`).join(" ") })
}

/** A watch as a chat attachment: what it is, its latest result and its open problems. */
export function watchMarkdown(w: WatchView): string {
  const out = [`# ${w.name}`, "", `- Kind: ${KIND_LABEL[w.kind]}`, `- Target: ${w.target}`, `- Checks: ${w.every === "morning" ? "Every morning at 7:30" : EVERY_LABEL[w.every]}${w.paused ? " (paused)" : ""}`]
  if (w.condition) out.push(`- Looks for: ${w.condition}`)
  if (w.latest) {
    out.push("", `## Latest result, ${new Date(w.latest.at).toLocaleString("en-US")}`, "", w.line)
    for (const [k, v] of w.latest.facts ?? []) out.push(`- ${k}: ${v}`)
    if (w.latest.error) out.push(`- Couldn’t check: ${w.latest.error}`)
  }
  const open = w.open.filter((f) => f.level === "problem")
  out.push("", "## Open problems", "")
  if (!open.length) out.push("None.")
  for (const f of open) {
    out.push(`- ${f.headline}, since ${new Date(f.openedAt).toLocaleString("en-US")}${f.expected ? " (marked expected)" : ""}`)
    if (f.detail) out.push(`  ${f.detail}`)
    if (f.ev?.record) out.push(`  Record ${f.ev.record.name} (${f.ev.record.type}). Found: ${f.ev.record.found ?? "none"}. Should be: ${f.ev.record.want}`)
    if (f.ev?.alert) out.push(`  ${f.ev.alert.name}${f.ev.alert.version ? ` ${f.ev.alert.version}` : ""}: ${f.ev.alert.problem}${f.ev.alert.fixedIn ? `, fixed in ${f.ev.alert.fixedIn}` : ""}`)
  }
  const recent = w.news.filter((n) => !n.ignored).slice(-3)
  if (recent.length) {
    out.push("", "## Recent changes", "")
    for (const n of recent) out.push(`- ${new Date(n.at).toLocaleString("en-US")}: ${n.line ?? n.headline}`)
  }
  return `${out.join("\n")}\n`
}

/** A reply in a watch's thread; Axe's answer is kept in the thread. */
export async function replyTo(id: string, text: string) {
  const v = await invoke("watching:reply", id, text)
  if (v) replace(v)
}

/** Undo shows only for what you did in this session ("id:time" of Axe's answer). */
export const undoable = new Set<string>()

const lastSaid = (v: WatchView | null) => {
  const s = v?.said.at(-1)
  if (v && s?.undo && !s.undone) undoable.add(`${v.id}:${s.at}`)
}

/** A reply in a watch's thread, with Undo on the change it made. The bubble shows while the model reads it. */
export async function replyWithUndo(id: string, text: string) {
  setState((s) => ({ watchReplying: { ...s.watchReplying, [id]: text } }))
  try {
    const v = await invoke("watching:reply", id, text)
    lastSaid(v)
    if (v) replace(v)
  } finally {
    setState((s) => {
      const { [id]: _, ...rest } = s.watchReplying
      return { watchReplying: rest }
    })
  }
}

/** "Ignore changes like this" on a page change. */
export async function ignoreChange(id: string, newsAt: number) {
  const v = await invoke("watching:act", id, String(newsAt), "ignore")
  lastSaid(v)
  if (v) replace(v)
}

/** Undo on Axe's answer: the watch goes back to how it was. */
export async function undoSaid(id: string, saidAt: number) {
  undoable.delete(`${id}:${saidAt}`)
  const v = await invoke("watching:act", id, String(saidAt), "undo")
  if (v) replace(v)
}

/** You opened the watch: its changes are read. */
export async function markSeen(id: string) {
  const v = await invoke("watching:seen", id)
  if (v) replace(v)
}

function replace(v: WatchView) {
  setState((s) => ({ watching: { ...s.watching, watches: (s.watching?.watches ?? []).map((w) => (w.id === v.id ? v : w)) } }))
}

export { readReply } from "@shared/watching/reply"

export const draftFor = (kind: Kind, target: string) => ({ kind, target, name: nameFor(kind, target), every: DEFAULT_EVERY[kind] })
