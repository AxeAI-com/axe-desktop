import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Run, SummaryState, Watch, WatchState } from "@shared/watching/types"

// Watches live under <data>/watching/: watches.json (every watch and its state, written atomically)
// and <id>/runs.jsonl (append-only, trimmed to the last 5,000 runs or 90 days).

const VERSION = 1
const KEEP_RUNS = 5000
const KEEP_MS = 90 * 86_400_000

type File = { version: number; watches: Watch[]; state: Record<string, WatchState>; summary?: SummaryState }

export type Store = ReturnType<typeof createStore>

export function createStore(dir: string) {
  const file = join(dir, "watches.json")
  let data: File = load()

  function load(): File {
    try {
      const f = JSON.parse(readFileSync(file, "utf8")) as File
      if (f.version === VERSION && Array.isArray(f.watches)) return { ...f, state: f.state ?? {} }
    } catch {}
    return { version: VERSION, watches: [], state: {} }
  }

  function save() {
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, file)
  }

  const runsFile = (id: string) => join(dir, id, "runs.jsonl")
  const blank = (): WatchState => ({ open: [], failedStreak: 0 })

  return {
    list: (): Watch[] => data.watches,
    get: (id: string): Watch | undefined => data.watches.find((w) => w.id === id),
    state: (id: string): WatchState => data.state[id] ?? blank(),

    put(w: Watch) {
      const i = data.watches.findIndex((x) => x.id === w.id)
      if (i < 0) data.watches.push(w)
      else data.watches[i] = w
      save()
    },

    setState(id: string, s: WatchState) {
      data.state[id] = s
      save()
    },

    /** The morning summary: when the last one went out, and the card on top of Watching. */
    summary: (): SummaryState => data.summary ?? {},

    setSummary(next: SummaryState) {
      data.summary = next
      save()
    },

    remove(id: string) {
      data.watches = data.watches.filter((w) => w.id !== id)
      delete data.state[id]
      save()
      rmSync(join(dir, id), { recursive: true, force: true })
    },

    appendRun(id: string, run: Run) {
      mkdirSync(join(dir, id), { recursive: true })
      appendFileSync(runsFile(id), `${JSON.stringify(run)}\n`)
      const all = this.runs(id)
      if (all.length > KEEP_RUNS * 1.1 || (all[0] && all[0].at < run.at - KEEP_MS * 1.1)) {
        const kept = all.filter((r) => r.at >= run.at - KEEP_MS).slice(-KEEP_RUNS)
        writeFileSync(runsFile(id), kept.map((r) => JSON.stringify(r)).join("\n") + "\n")
      }
    },

    /** Runs oldest first; `last` keeps only the newest ones. */
    runs(id: string, last?: number): Run[] {
      const f = runsFile(id)
      if (!existsSync(f)) return []
      const out: Run[] = []
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (!line) continue
        try {
          out.push(JSON.parse(line) as Run)
        } catch {}
      }
      return last ? out.slice(-last) : out
    },

    /** The page or price a check compares against next time. */
    memo(id: string): string | undefined {
      try {
        return readFileSync(join(dir, id, "memo.txt"), "utf8")
      } catch {
        return undefined
      }
    },

    setMemo(id: string, text: string) {
      mkdirSync(join(dir, id), { recursive: true })
      writeFileSync(join(dir, id, "memo.txt"), text)
    },

    /** A new target: the next run saves a fresh copy instead of comparing. */
    clearMemo(id: string) {
      rmSync(join(dir, id, "memo.txt"), { force: true })
    },

    /** Re-reads the file (tests). */
    reload() {
      data = load()
    },
  }
}
