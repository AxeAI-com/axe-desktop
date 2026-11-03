import { urlOf } from "@shared/watching/target"
import type { Run, Step, Usual } from "@shared/watching/types"
import { evaluateUptime, type FullLoad, type Probe } from "@shared/watching/uptime"

// Uptime and speed: a GET with timing, then the full page in a hidden, cookie-free window (at most
// 15 s) for the load time and the largest files. A failure is retried once a minute later, so one
// dropped connection isn't "down".

export type UptimeDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** The full load; missing in tests and before the app is ready, when the GET's time is used. */
  load?: (url: string, timeoutMs: number) => Promise<FullLoad | null>
  /** How long before the second try. A minute; e2e runs shorten it. */
  retryMs?: number
}

const TIMEOUT = 10_000
export const LOAD_TIMEOUT = 15_000
export const RETRY_MS = 60_000
const HEADERS = { "user-agent": "AxeAI-watch/1" }

/** Why there was no answer, in the probe's terms. */
export function probeError(e: unknown): { error: "dns" | "noanswer"; text: string } {
  const m = e instanceof Error ? `${e.name} ${e.message} ${e.cause instanceof Error ? e.cause.message : ""}` : String(e)
  if (/ENOTFOUND|EAI_AGAIN|ENODATA|EAI_NONAME/.test(m)) return { error: "dns", text: "The address wasn’t found" }
  if (/timeout|aborted/i.test(m)) return { error: "noanswer", text: "No answer in 10 s" }
  if (/ECONNREFUSED/.test(m)) return { error: "noanswer", text: "The connection was refused" }
  if (/certificate|CERT_/i.test(m)) return { error: "noanswer", text: "Its certificate isn’t valid" }
  return { error: "noanswer", text: "It didn’t answer" }
}

export async function probe(target: string, d: Pick<UptimeDeps, "fetch" | "now">, timeoutMs = TIMEOUT): Promise<Probe> {
  const start = d.now()
  try {
    const res = await d.fetch(urlOf(target), { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: HEADERS })
    const body = await res.arrayBuffer()
    return { ok: true, status: res.status, statusText: res.statusText || undefined, ms: Math.round(d.now() - start), bytes: body.byteLength }
  } catch (e) {
    return { ok: false, ...probeError(e) }
  }
}

const bad = (p: Probe) => !p.ok || p.status >= 400

/** The steps a new watch shows while its first run works. */
export const uptimeSteps = (target: string, at: 0 | 1 | 2): Step[] => [
  { label: `Loading ${target}`, state: at > 0 ? "done" : "run" },
  { label: "Timing the page", state: at > 1 ? "done" : at === 1 ? "run" : "todo" },
]

export async function checkUptime(
  target: string,
  history: Run[],
  w: { usual?: Usual; fixedMs?: number },
  d: UptimeDeps,
  onStep?: (steps: Step[]) => void,
): Promise<Run> {
  const at = d.now()
  onStep?.(uptimeSteps(target, 0))
  let p = await probe(target, d)
  if (bad(p)) {
    await d.sleep(d.retryMs ?? RETRY_MS)
    p = await probe(target, d)
  }
  onStep?.(uptimeSteps(target, 1))
  const load = !bad(p) && d.load ? await d.load(urlOf(target), LOAD_TIMEOUT).catch(() => null) : null
  onStep?.(uptimeSteps(target, 2))
  return evaluateUptime(target, { probe: p, load }, history, w, at, Math.round(d.now() - at))
}
