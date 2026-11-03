import type { FileChange } from "@shared/types"

import { diffLines, type Line } from "./diff"

// Review changes: a file's diff with line numbers, and the +/− counts the title bar shows.

/** Past this many line pairs the diff isn't drawn (the plain diff is quadratic). */
const MAX_CELLS = 4_000_000

export type NumberedLine = Line & { old?: number; now?: number }

export type FileDiff = { lines: NumberedLine[] | null; added: number; removed: number }

const cache = new WeakMap<FileChange, FileDiff>()

const count = (s: string | null) => (s ? s.replace(/\n$/, "").split("\n").length : 0)

/** The diff of one changed file. `lines` is null for binary files and ones too big to draw. */
export function fileDiff(f: FileChange): FileDiff {
  const hit = cache.get(f)
  if (hit) return hit
  let out: FileDiff
  if (f.binary) out = { lines: null, added: 0, removed: 0 }
  else if (count(f.before) * count(f.after) > MAX_CELLS) out = { lines: null, added: count(f.after), removed: count(f.before) }
  else {
    // diffLines treats a file's final newline as the end of its last line.
    const raw = diffLines(f.before ?? undefined, f.after ?? "")
    const lines = f.after === null ? raw.filter((l) => !(l.sign === "+" && l.text === "")) : raw
    let old = 0
    let now = 0
    const numbered = lines.map((l): NumberedLine => (l.sign === "-" ? { ...l, old: ++old } : l.sign === "+" ? { ...l, now: ++now } : { ...l, old: ++old, now: ++now }))
    out = { lines: numbered, added: numbered.filter((l) => l.sign === "+").length, removed: numbered.filter((l) => l.sign === "-").length }
  }
  cache.set(f, out)
  return out
}

/** Every file's counts together. */
export function totals(files: FileChange[]): { files: number; added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const f of files) {
    const d = fileDiff(f)
    added += d.added
    removed += d.removed
  }
  return { files: files.length, added, removed }
}

/** Only the changed lines and a few around them; long unchanged runs fold to a marker. */
export function hunks(lines: NumberedLine[], around = 3): (NumberedLine | { fold: number })[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (l.sign === " ") return
    for (let j = Math.max(0, i - around); j <= Math.min(lines.length - 1, i + around); j++) keep[j] = true
  })
  const out: (NumberedLine | { fold: number })[] = []
  let skipped = 0
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ fold: skipped })
      skipped = 0
      out.push(l)
    } else skipped++
  })
  if (skipped) out.push({ fold: skipped })
  return out
}
