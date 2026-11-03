// Page changes: a line diff between two copies of a page's text, the parts you said to ignore, and
// the plain sentences a change is told in. Pure, no model: the first added and removed lines decide
// the words.

/** One line of the diff a card shows: context, removed, added, or "18 more lines" folded away. */
export type DiffLine = { t: "c" | "d" | "a"; s: string }

/** A run of changed lines and the unchanged line just before it (its "heading"). */
export type Hunk = { anchor: string; lines: DiffLine[] }

const CONTEXT = 2

/** Edit script by longest common subsequence. Pages are a few hundred lines, so O(n·m) is fine. */
function script(a: string[], b: string[]): DiffLine[] {
  // Trim the common start and end first, so a long page with one change stays cheap.
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  const A = a.slice(s, a.length - e)
  const B = b.slice(s, b.length - e)
  const n = A.length
  const m = B.length
  const out: DiffLine[] = a.slice(0, s).map((x) => ({ t: "c", s: x }))
  if (n * m > 4_000_000) {
    // Too big to align: everything in the middle counts as replaced.
    out.push(...A.map((x) => ({ t: "d" as const, s: x })), ...B.map((x) => ({ t: "a" as const, s: x })))
  } else {
    const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        out.push({ t: "c", s: A[i]! })
        i++
        j++
      } else if (L[i + 1]![j]! >= L[i]![j + 1]!) out.push({ t: "d", s: A[i++]! })
      else out.push({ t: "a", s: B[j++]! })
    }
    while (i < n) out.push({ t: "d", s: A[i++]! })
    while (j < m) out.push({ t: "a", s: B[j++]! })
  }
  out.push(...a.slice(a.length - e).map((x) => ({ t: "c" as const, s: x })))
  return out
}

/** The changed runs, each with the unchanged line before it ("" at the top of the page). */
export function hunks(before: string, after: string): Hunk[] {
  const lines = script(split(before), split(after))
  const out: Hunk[] = []
  let anchor = ""
  let cur: Hunk | null = null
  for (const l of lines) {
    if (l.t === "c") {
      cur = null
      anchor = l.s
    } else {
      if (!cur) {
        cur = { anchor, lines: [] }
        out.push(cur)
      }
      cur.lines.push(l)
    }
  }
  return out
}

const split = (t: string) => (t ? t.split("\n") : [])

/** A line that's only a date or a "last updated" note: what changes on every load. */
const DATE =
  /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{0,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b|\b(?:last\s+)?updated\b/i

/**
 * What a page watch ignores. Rules are "date" (date lines), "text:<words>" (lines with those words)
 * and "near:<line>" (changes right after that line, from "Ignore changes like this").
 */
export function ignoredLine(line: string, rules: string[]): boolean {
  for (const r of rules) {
    if (r === "date" && line.length <= 80 && DATE.test(line)) return true
    if (r.startsWith("text:") && line.toLowerCase().includes(r.slice(5).toLowerCase())) return true
  }
  return false
}

/** The text with ignored lines taken out, so they never count as a change. */
export const keptText = (text: string, rules: string[] | undefined) => (rules?.length ? split(text).filter((l) => !ignoredLine(l, rules)).join("\n") : text)

/** A change Axe tells you about: what the card, the row and the notification show. */
export type PageChange = {
  headline: string
  /** The card's sentence: "New line about shipping, and the old one is gone." */
  body: string
  /** The row's line and the notification: "New line: “Free shipping on orders over $50.”" */
  line: string
  /** The card's diff: two lines of context around each change. */
  diff: DiffLine[]
  added: number
  removed: number
  words: [number, number]
  /** The headings of the changed parts, for "Ignore changes like this". */
  anchors: string[]
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const STOP = new Set(
  "the and for with that this from your our you are was were have has will now new old all any can not but its into over under more less than then them they their about just only also each".split(" "),
)
const words = (s: string) => s.toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.filter((w) => !STOP.has(w)) ?? []

/** The word an added and a removed line share, longest first: "shipping". */
function topic(added: string, removed: string): string | null {
  const r = new Set(words(removed))
  const shared = [...new Set(words(added))].filter((w) => r.has(w))
  shared.sort((x, y) => y.length - x.length)
  return shared[0] ?? null
}

const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`

/** "The pricing page changed": named after the path's last part, "The home page" at the root. */
export function pageHeadline(target: string): string {
  const path = target.replace(/^[a-z]+:\/\//i, "").split(/[?#]/)[0]!.split("/").slice(1).filter(Boolean)
  const last = path.at(-1)
  if (!last) return "The home page changed"
  const name = decodeURIComponent(last)
    .replace(/\.[a-z]{2,5}$/i, "")
    .replace(/[-_+]+/g, " ")
    .trim()
    .toLowerCase()
  return name && /[a-z]/.test(name) ? `The ${name} page changed` : `${target} changed`
}

/**
 * What changed between two copies, or null when nothing you care about did. `rules` are the
 * watch's ignore rules: ignored lines and changes near an ignored heading don't count.
 */
export function pageChange(target: string, before: string, after: string, rules: string[] = []): PageChange | null {
  const a = keptText(before, rules)
  const b = keptText(after, rules)
  if (a === b) return null
  const near = new Set(rules.filter((r) => r.startsWith("near:")).map((r) => r.slice(5)))
  const all = hunks(a, b)
  const kept = all.filter((h) => !near.has(h.anchor))
  if (!kept.length) return null
  const add = kept.flatMap((h) => h.lines.filter((l) => l.t === "a").map((l) => l.s))
  const del = kept.flatMap((h) => h.lines.filter((l) => l.t === "d").map((l) => l.s))
  let body: string
  if (add.length && del.length) {
    const t = topic(add[0]!, del[0]!)
    body = t ? `New line about ${t}, and the old one is gone.` : add.length === 1 && del.length === 1 ? "One line was replaced." : `${lines(add.length)} added and ${lines(del.length)} removed.`
  } else if (add.length) body = add.length === 1 ? "A line was added." : `${lines(add.length)} were added.`
  else body = del.length === 1 ? "A line was removed." : `${lines(del.length)} were removed.`
  const line = add.length ? `New line: “${short(add[0]!)}”` : `Line removed: “${short(del[0]!)}”`
  return {
    headline: pageHeadline(target),
    body,
    line,
    diff: withContext(a, b, near),
    added: add.length,
    removed: del.length,
    words: [wordCount(before), wordCount(after)],
    anchors: [...new Set(kept.map((h) => h.anchor))],
  }
}

/** The diff with two lines of context around each kept change, and "…" between far-apart ones. */
function withContext(a: string, b: string, near: Set<string>): DiffLine[] {
  const all = script(split(a), split(b))
  // Changes right after an ignored heading show as context, not as change.
  let anchor = ""
  const marked = all.map((l) => {
    if (l.t === "c") {
      anchor = l.s
      return l
    }
    return near.has(anchor) ? null : l
  })
  const keep = new Set<number>()
  marked.forEach((l, i) => {
    if (!l || l.t === "c") return
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(all.length - 1, i + CONTEXT); k++) keep.add(k)
  })
  const out: DiffLine[] = []
  let last = -1
  for (let i = 0; i < all.length; i++) {
    if (!keep.has(i)) continue
    if (last >= 0 && i > last + 1) out.push({ t: "c", s: "…" })
    const l = marked[i]
    // An ignored change keeps only its new text, as context.
    if (!l) {
      if (all[i]!.t === "a") out.push({ t: "c", s: all[i]!.s })
    } else out.push(l)
    last = i
  }
  return out
}

/** The changed part's heading, from a diff: what "Ignore changes like this" remembers. */
export const nearRules = (anchors: string[]) => anchors.map((a) => `near:${a}`)
