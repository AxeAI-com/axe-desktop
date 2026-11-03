// Ported from desktop/src/shared/apps.ts (the old Windows/Linux app): reading Linux .desktop
// files and matching an app however the user writes it ("browserclaw", "@BrowserClaw").
// Same rules as InstalledApps.swift on the Mac. No Electron imports, so unit tests run it.

/** A Linux .desktop entry, the parts Axe uses. */
export type DesktopEntry = { name: string; exec?: string; icon?: string; tryExec?: string }

/** Reads the [Desktop Entry] group. Returns undefined for entries that shouldn't show (NoDisplay, Hidden, not an app). */
export function parseDesktopEntry(text: string): DesktopEntry | undefined {
  const values: Record<string, string> = {}
  let inEntry = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]"
      continue
    }
    if (!inEntry) continue
    const eq = line.indexOf("=")
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    // Localized keys (Name[de]) are skipped: the plain one is the fallback everyone has.
    if (key.includes("[")) continue
    if (!(key in values)) values[key] = line.slice(eq + 1).trim()
  }
  if ((values.Type ?? "Application") !== "Application") return undefined
  if (values.NoDisplay === "true" || values.Hidden === "true") return undefined
  const name = values.Name
  if (!name) return undefined
  return { name, exec: values.Exec || undefined, icon: values.Icon || undefined, tryExec: values.TryExec || undefined }
}

/** Splits a command line into a program and arguments, honoring quotes. Backslash escapes only where `escapes` (not on Windows paths). */
export function splitCommandLine(exec: string, escapes = true): string[] {
  const out: string[] = []
  let cur = ""
  let quoted = false
  let started = false
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i] as string
    if (escapes && c === "\\" && i + 1 < exec.length) {
      cur += exec[++i]
      started = true
    } else if (c === '"') {
      quoted = !quoted
      started = true
    } else if (/\s/.test(c) && !quoted) {
      if (started) out.push(cur)
      cur = ""
      started = false
    } else {
      cur += c
      started = true
    }
  }
  if (started) out.push(cur)
  return out
}

/** The command for an Exec line, with %u / %f filled by `args` (or appended when there is no field code). */
export function execCommand(exec: string, args: string[] = []): string[] {
  const out: string[] = []
  let used = false
  for (const word of splitCommandLine(exec)) {
    if (/^%[fFuU]$/.test(word)) {
      if (!used) out.push(...args)
      used = true
      continue
    }
    // %i, %c, %k and the deprecated codes are dropped; %% is a literal percent.
    const cleaned = word.replace(/%[a-zA-Z]/g, "").replace(/%%/g, "%")
    if (cleaned) out.push(cleaned)
  }
  if (!used) out.push(...args)
  return out
}

/** Lowercase letters and digits only: "Browser-Claw.app" and "browser claw" both become "browserclawapp" / "browserclaw". */
export function normalized(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
}

/** The app the user means, or undefined. Exact name first, then without spaces and case, then starts with, then contains. */
export function matchApp<T extends { name: string; id?: string }>(apps: T[], query: string): T | undefined {
  const lower = query.trim().replace(/^@/, "").toLowerCase().replace(/\.(app|exe|lnk|desktop)$/, "")
  if (!lower) return undefined
  const exact = apps.find((a) => a.name.toLowerCase() === lower || a.id?.toLowerCase() === lower)
  if (exact) return exact
  const key = normalized(lower)
  if (key.length < 2) return undefined
  const same = apps.find((a) => normalized(a.name) === key)
  if (same) return same
  if (key.length < 4) return undefined
  const shortest = (list: T[]) => list.reduce<T | undefined>((best, a) => (!best || a.name.length < best.name.length ? a : best), undefined)
  const starts = shortest(apps.filter((a) => normalized(a.name).startsWith(key)))
  if (starts) return starts
  return shortest(apps.filter((a) => normalized(a.name).includes(key) || (normalized(a.name).length >= 4 && key.includes(normalized(a.name)))))
}

/** Apps for the @ list, best first: name starts with, a word starts with, then contains, then letters in order. */
export function filterApps<T extends { name: string }>(apps: T[], query: string, limit = 8): T[] {
  const q = normalized(query)
  if (!q) return [...apps].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit)
  const score = (a: T): number => {
    const n = normalized(a.name)
    if (n === q) return 0
    if (n.startsWith(q)) return 1
    if (a.name.toLowerCase().split(/[\s\-_.]+/).some((w) => normalized(w).startsWith(q))) return 2
    if (n.includes(q)) return 3
    let i = 0
    for (const c of n) if (c === q[i]) i++
    return i === q.length ? 4 : -1
  }
  return apps
    .map((a) => ({ a, s: score(a) }))
    .filter((x) => x.s >= 0)
    .sort((x, y) => x.s - y.s || x.a.name.length - y.a.name.length || x.a.name.localeCompare(y.a.name))
    .slice(0, limit)
    .map((x) => x.a)
}
