export type Line = { sign: "+" | "-" | " "; text: string }

/** A plain line diff: what was there, and what is there now. Good enough for the few lines a step shows. */
export function diffLines(before: string | undefined, after: string): Line[] {
  // A file's final newline isn't a line of its own.
  const lines = (t: string) => t.replace(/\n$/, "").split("\n")
  const a = before ? lines(before) : []
  const b = lines(after)
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const out: Line[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ sign: " ", text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ sign: "-", text: a[i++]! })
    else out.push({ sign: "+", text: b[j++]! })
  }
  while (i < n) out.push({ sign: "-", text: a[i++]! })
  while (j < m) out.push({ sign: "+", text: b[j++]! })
  return out
}

/** One file of a unified diff an answer printed (`git diff`): its path, counts and lines. */
export type DiffFile = { path: string; added: number; removed: number; lines: (Line | { hunk: string })[] }

/** A code block that is a unified diff: fenced as diff or patch, or plain text that reads like one. */
export function isUnifiedDiff(lang: string, text: string): boolean {
  if (lang === "diff" || lang === "patch") return true
  if (lang && lang !== "text" && lang !== "txt") return false
  return /^(diff --git |--- a\/|@@ -\d)/m.test(text) && /^@@ /m.test(text)
}

/** Splits a unified diff into files; headers (index, ---, +++) are dropped, hunks keep their @@ line. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  const start = (path: string) => {
    file = { path, added: 0, removed: 0, lines: [] }
    files.push(file)
  }
  for (const raw of text.replace(/\n$/, "").split("\n")) {
    const git = raw.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (git) {
      start(git[2]!)
      continue
    }
    if (/^(index |new file mode|deleted file mode|similarity index|rename (from|to) |\\ No newline)/.test(raw)) continue
    if (raw.startsWith("--- ")) continue
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).replace(/^b\//, "")
      if (!file || file.lines.length) start(path === "/dev/null" ? "(deleted)" : path)
      continue
    }
    if (!file) start("")
    const f = file!
    if (raw.startsWith("@@")) f.lines.push({ hunk: raw.replace(/^@@[^@]*@@\s?/, "") })
    else if (raw.startsWith("+")) {
      f.added++
      f.lines.push({ sign: "+", text: raw.slice(1) })
    } else if (raw.startsWith("-")) {
      f.removed++
      f.lines.push({ sign: "-", text: raw.slice(1) })
    } else f.lines.push({ sign: " ", text: raw.startsWith(" ") ? raw.slice(1) : raw })
  }
  return files
}
