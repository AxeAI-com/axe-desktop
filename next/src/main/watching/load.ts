import { BrowserWindow, type Session, session } from "electron"

import type { PageFile } from "@shared/watching/types"
import type { FullLoad } from "@shared/watching/uptime"

// The full page load for uptime and speed: a hidden window on an in-memory session that's wiped after
// every load (so no cookies carry over), timed to the load event, at most `timeoutMs`. The files come
// from the network log, so cross-site images count too.

const KEEP = 12
/** Per hidden window: its files, the requests in flight (id to start time), and when each counted one ended. */
type Log = { files: Map<string, PageFile>; open: Map<number, number>; lastDone: number; cutoff: number }
const logs = new Map<number, Log>()
/**
 * Requests that start up to this long after the load event still count (images a script adds). Later
 * ones (polling, sockets, analytics) don't, so a busy page isn't timed as slow.
 */
const GRACE_MS = 300
let shared: Session | null = null

function loadSession(): Session {
  if (shared) return shared
  const ses = session.fromPartition("watch-load", { cache: false })
  const logOf = (id: number | undefined) => (id !== undefined ? logs.get(id) : undefined)
  const done = (log: Log, id: number) => {
    const began = log.open.get(id)
    log.open.delete(id)
    if (began !== undefined && began <= log.cutoff) log.lastDone = Math.max(log.lastDone, Date.now())
  }
  ses.webRequest.onBeforeRequest((d, cb) => {
    logOf(d.webContentsId)?.open.set(d.id, Date.now())
    cb({})
  })
  ses.webRequest.onErrorOccurred((d) => {
    const log = logOf(d.webContentsId)
    if (log) done(log, d.id)
  })
  ses.webRequest.onCompleted((d) => {
    const log = logOf(d.webContentsId)
    if (!log) return
    done(log, d.id)
    const files = log.files
    if (d.resourceType === "mainFrame" || d.fromCache || d.statusCode >= 400) return
    const h = Object.fromEntries(Object.entries(d.responseHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v[0]]))
    const bytes = Number(h["content-length"] ?? 0)
    if (!bytes) return
    const modified = h["last-modified"] ? Date.parse(h["last-modified"]) : Number.NaN
    files.set(d.url, { name: nameOf(d.url), url: d.url, bytes, ...(Number.isFinite(modified) ? { modified } : {}) })
  })
  shared = ses
  return ses
}

const nameOf = (url: string) => {
  try {
    const u = new URL(url)
    return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? u.hostname)
  } catch {
    return url
  }
}

export async function fullLoad(url: string, timeoutMs: number): Promise<FullLoad | null> {
  const ses = loadSession()
  const log: Log = { files: new Map(), open: new Map(), lastDone: 0, cutoff: Number.POSITIVE_INFINITY }
  const files = log.files
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    paintWhenInitiallyHidden: true,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, images: true },
  })
  const id = win.webContents.id
  logs.set(id, log)
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  const start = Date.now()
  try {
    const loaded = new Promise<boolean>((resolve) => {
      win.webContents.once("did-finish-load", () => resolve(true))
      win.webContents.once("did-fail-load", (_e, code, _desc, _url, main) => main !== false && code !== -3 && resolve(false))
      setTimeout(() => resolve(true), timeoutMs)
    })
    void win.loadURL(url).catch(() => {})
    if (!(await loaded)) return null
    // The load event can come before big images finish (a hidden window doesn't wait to paint them):
    // wait for every request that started by then, plus a moment, to end.
    const loadedAt = Date.now()
    log.cutoff = loadedAt + GRACE_MS
    const pending = () => [...log.open.values()].some((t) => t <= log.cutoff)
    while (Date.now() - start < timeoutMs && (Date.now() < log.cutoff || pending())) await new Promise((r) => setTimeout(r, 50))
    const ms = Math.min(timeoutMs, Math.max(loadedAt, log.lastDone) - start)
    // Sizes the network log missed (no Content-Length): the page's own resource timing.
    const timing = (await win.webContents
      .executeJavaScript("performance.getEntriesByType('resource').map(e => [e.name, e.encodedBodySize || e.transferSize || 0])", true)
      .catch(() => [])) as [string, number][]
    for (const [u, b] of timing) if (b > 0 && !files.has(u)) files.set(u, { name: nameOf(u), url: u, bytes: b })
    return { ms, files: [...files.values()].sort((a, b) => b.bytes - a.bytes).slice(0, KEEP) }
  } finally {
    logs.delete(id)
    win.destroy()
    if (!logs.size) void ses.clearStorageData().catch(() => {})
  }
}

/** Lab vitals from one load in a hidden window: LCP, CLS, first paint and the server's first byte, in ms. */
export type Vitals = { lcp: number | null; cls: number; fcp: number | null; ttfb: number | null }

const VITALS_JS = `new Promise((done) => {
  const out = { lcp: null, cls: 0, fcp: null, ttfb: null }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) out.lcp = e.renderTime || e.loadTime || e.startTime }).observe({ type: "largest-contentful-paint", buffered: true }) } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value }).observe({ type: "layout-shift", buffered: true }) } catch {}
  const nav = performance.getEntriesByType("navigation")[0]
  if (nav) out.ttfb = nav.responseStart
  const fcp = performance.getEntriesByName("first-contentful-paint")[0]
  if (fcp) out.fcp = fcp.startTime
  setTimeout(() => done(out), 200)
})`

/**
 * Loads the page as a visitor's first visit (no cache, no cookies) and reads its Core Web Vitals once it
 * settles. INP needs a real visitor's taps, so it isn't measured.
 */
export async function vitals(url: string, timeoutMs: number): Promise<Vitals | null> {
  const ses = loadSession()
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    paintWhenInitiallyHidden: true,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, images: true },
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  try {
    const loaded = new Promise<boolean>((resolve) => {
      win.webContents.once("did-finish-load", () => resolve(true))
      win.webContents.once("did-fail-load", (_e, code, _desc, _url, main) => main !== false && code !== -3 && resolve(false))
      setTimeout(() => resolve(false), timeoutMs)
    })
    void win.loadURL(url).catch(() => {})
    if (!(await loaded)) return null
    // Late images and fonts still move the LCP and the layout: let the page settle.
    await new Promise((r) => setTimeout(r, 3000))
    return ((await win.webContents.executeJavaScript(VITALS_JS, true).catch(() => null)) as Vitals | null) ?? null
  } finally {
    win.destroy()
    void ses.clearStorageData().catch(() => {})
  }
}
