import { appendFileSync, readFileSync } from "node:fs"

import { clipboard, net, powerMonitor } from "electron"

import { emit } from "../bus"
import { handle } from "../ipc"
import { notify } from "../notify"
import { dataPath, isSelfTest } from "../paths"
import type { FindingAct, Watch } from "@shared/watching/types"

import { send as chatSend } from "../chat"
import { settings } from "../settings"
import { localAgents } from "../agents/registry"
import type { Answerer } from "@shared/types"
import { SUMMARY_DEFAULT } from "@shared/watching/summary"
import { realDeps, withFakeGh, withFakeNet } from "./checks/deps"
import { RETRY_MS } from "./checks/uptime"
import { askModel } from "./ask"
import { createEngine, type Engine } from "./engine"
import { fullLoad, vitals } from "./load"
import { backUpNotice, summaryNotice, watchNotice } from "./notify"
import { folderSuggestions, githubRepos, recentFolders } from "./folders"
import { createStore } from "./store"
import { fromWindow, patchFromWindow } from "./window-input"

// Wires the Watching engine into the app: the watching:* commands, a 30 s tick while awake,
// and one catch-up tick after the Mac wakes. Missed times are skipped, never replayed.

const TICK_MS = 30_000

/**
 * Self-tests can move the engine's clock (AXE_WATCH_CLOCK: a file holding an offset in ms, read on each
 * call) and tick faster (AXE_WATCH_TICK_MS), to reach the night and the morning summary. Real runs never read either.
 */
function testClock(): { now?: () => number; tickMs: number } {
  if (!isSelfTest()) return { tickMs: TICK_MS }
  const file = process.env.AXE_WATCH_CLOCK
  const tick = Number(process.env.AXE_WATCH_TICK_MS)
  const offset = () => {
    try {
      return Number(readFileSync(file!, "utf8")) || 0
    } catch {
      return 0
    }
  }
  return { ...(file ? { now: () => Date.now() + offset() } : {}), tickMs: Number.isFinite(tick) && tick >= 500 ? tick : TICK_MS }
}

let engine: Engine | null = null
let timer: ReturnType<typeof setInterval> | null = null

/**
 * Who fixes: the watch's own agent if it's ready, else the first ready coding agent, else Do it with
 * your Axe model (the one picked last, else the first one).
 */
async function fixer(w: Watch): Promise<{ agent: string; answerer: Answerer }> {
  const ready = (await localAgents().catch(() => [])).filter((a) => a.state === "ready")
  const own = w.answerer?.kind === "agent" ? ready.find((a) => a.id === (w.answerer as { agentId: string }).agentId) : undefined
  const agent = own ?? ready[0]
  if (agent) return { agent: agent.name, answerer: { kind: "agent", agentId: agent.id } }
  const last = settings().answerer
  const modelId = w.answerer?.kind === "axe" ? w.answerer.modelId : last?.kind === "axe" ? last.modelId : "auto"
  return { agent: "Do it", answerer: { kind: "axe", modelId } }
}

const watchNotify = () => settings().watchNotify !== false

const fixLabel = async (w: Watch) => `Fix with ${(await fixer(w)).agent}`

export function startWatching() {
  const retry = Number(process.env.AXE_WATCH_RETRY_MS)
  // Self-tests can give hosts their own DNS, ports and TLS (see withFakeNet); real runs never read the file.
  const fake = isSelfTest() ? process.env.AXE_WATCH_FAKE_NET : undefined
  const fakeGh = isSelfTest() ? process.env.AXE_WATCH_GH : undefined
  const netDeps = fake ? withFakeNet(realDeps, fake) : realDeps
  const clock = testClock()
  const withGh = fakeGh ? withFakeGh(netDeps, fakeGh) : netDeps
  const deps = clock.now ? { ...withGh, now: clock.now } : withGh
  const e = createEngine(createStore(dataPath("watching")), {
    ...deps,
    load: fullLoad,
    vitals,
    netFetch: (url, init) => net.fetch(url, init as RequestInit),
    retryMs: Number.isFinite(retry) && retry > 0 ? retry : RETRY_MS,
    online: () => net.isOnline(),
    // Settings, Notifications, Watches: Off keeps every watch notice (and the summary's) away.
    notice: (w, opened) =>
      void (async () => {
        if (!watchNotify()) return
        const n = watchNotice(w, opened, opened.some((f) => f.fix === "agent") ? await fixLabel(w) : undefined)
        if (n) notify(n)
      })(),
    cleared: (w, resolved, latest) => {
      const n = watchNotify() ? backUpNotice(w, resolved, latest) : null
      if (n) notify(n)
    },
    summaryAt: () => settings().summaryAt ?? SUMMARY_DEFAULT,
    summary: (body, problems) => {
      if (watchNotify()) notify(summaryNotice(body, problems))
    },
    changed: (list) => emit("watching", list),
    fixer,
    // Self-tests log the copy instead of touching the clipboard of whoever runs them.
    copy: (text) => (isSelfTest() && process.env.AXE_CLIPBOARD_LOG ? appendFileSync(process.env.AXE_CLIPBOARD_LOG, `${text}\n`) : clipboard.writeText(text)),
    // The fix is an agent turn in plan mode: the plan card (Start) and the changes (Keep all, Undo all)
    // show in the watch's thread. Do it works on this computer with your Axe model.
    startFix: async ({ watch, brief, folder, answerer, title }) => {
      const agent = answerer.kind === "agent"
      const { threadId } = await chatSend({
        threadId: null,
        text: brief,
        title,
        answerer,
        cwd: folder,
        watchId: watch.id,
        keepDefaults: true,
        ...(agent ? { mode: "plan" as const } : { doIt: true }),
      })
      return threadId
    },
    ask: askModel,
    continueFix: async (threadId, text, answerer) => {
      await chatSend({ threadId, text, answerer, keepDefaults: true, ...(answerer.kind === "axe" ? { doIt: true } : {}) })
    },
  })
  engine = e

  handle("watching:list", () => e.list())
  handle("watching:get", (id) => e.get(id))
  handle("watching:runs", (id) => e.runs(id))
  // The window never names a command to run (only an edit of a saved watch keeps its own).
  handle("watching:draft", ({ command: _command, ...input }: Parameters<Engine["draft"]>[0]) => e.draft(input))
  handle("watching:read", (input) => e.read(input))
  handle("watching:create", (draft) => e.create(fromWindow(draft)))
  handle("watching:update", (id, patch) => e.update(String(id), patchFromWindow(patch)))
  handle("watching:delete", (id) => e.remove(id))
  handle("watching:checkNow", (id) => e.runOne(id))
  handle("watching:act", (id, key, act) => e.act(id, key, act))
  handle("watching:reply", (id, text) => e.reply(id, text))
  handle("watching:seen", (id) => e.seen(id))
  handle("watching:fix", (id, keys, folder) => e.fix(id, keys, folder))
  handle("watching:fixDone", (id, at, how, files) => e.fixDone(id, at, how, files))
  handle("watching:fixAgain", (id, at) => e.fixAgain(id, at))
  handle("watching:summary", () => e.summaryNow())
  handle("watching:summaryClose", () => e.summaryClose())
  handle("watching:repos", async () => ({ repos: await githubRepos(deps), folders: recentFolders() }))
  handle("watching:folders", async (id) => {
    const w = e.get(id)
    return w ? folderSuggestions(w.target, deps) : []
  })

  const tick = () => void e.tick().catch(() => {})
  timer = setInterval(tick, clock.tickMs)
  powerMonitor.on("resume", tick)
  tick()
}

export function stopWatching() {
  if (timer) clearInterval(timer)
  timer = null
  engine = null
}

/** A watch that isn't paused: on Windows and Linux the app stays in the tray for it. */
export const watchesActive = () => !!engine?.list().watches.some((w) => !w.paused)

/** When each watch checks next, so keep-awake can wake the computer for the first one (Windows). */
export const watchesNext = () => (engine?.list().watches ?? []).map((w) => ({ enabled: !w.paused, ...(w.nextAt ? { nextRun: new Date(w.nextAt).toISOString() } : {}) }))

/** A notification's Snooze 1 hour. */
export const watchAct = (id: string, key: string, act: FindingAct) => engine?.act(id, key, act) ?? null

