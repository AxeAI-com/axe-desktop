import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import type { Json } from "@shared/types"

// The safety net, independent of the model (MacTask.mustConfirm on the Mac, shared/guard.ts in the
// old Windows/Linux app). Sending, posting, deleting, paying, submitting, pressing Return in chat or
// mail apps, running a command that changes things, and changing a file that's already there ask first.

export const RISKY = /\b(send|post|publish|tweet|reply|delete|remove|trash|pay|buy|purchase|order|checkout|submit|confirm|transfer|subscribe|unfollow)\b/i
const MESSAGING = ["messages", "mail", "whatsapp", "telegram", "slack", "signal", "discord", "outlook", "thunderbird", "teams", "messenger", "zalo", "spark"]

type Input = Record<string, Json | undefined>

/** What the guard knows about the element, app or file a tool points at. */
export type GuardContext = {
  /** Visible label of the element (button text, link text). */
  label?: string
  /** True when the field is a search box (submitting a search is harmless). */
  isSearch?: boolean
  /** The app or site the action happens in. */
  where?: string
  /** For write_file: the file is already there. */
  exists?: boolean
  /** For browser_click: clicking it submits a form (a submit button), whatever its label says. */
  submits?: boolean
  /** For browser_click: that form is only a search (GET, one visible search box with the query, no password). */
  searchOnly?: boolean
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : "")

/** Returns what needs the user's OK, in plain words, or undefined. */
export function mustConfirm(name: string, input: Input, ctx: GuardContext = {}): string | undefined {
  const where = ctx.where ?? (name.startsWith("browser_") ? "the page" : "the app")
  switch (name) {
    case "browser_click":
    case "click": {
      const label = ctx.label ?? ""
      if (RISKY.test(label)) return `${name === "click" ? "Press" : "Click"} “${label}” on ${where}`
      // A submit button sends the form however it's labelled ("Continue", "Complete booking"), like
      // browser_type with submit. Only a form that is plainly a search goes without asking; the
      // page's own markers (role="search", a search box somewhere in it) don't count.
      if (ctx.submits && !ctx.searchOnly) return `Click “${label || "Submit"}” on ${where} (this submits the form)`
      return undefined
    }
    case "browser_type": {
      if (input.submit !== true || ctx.isSearch) return undefined
      return `Submit “${str(input.text).slice(0, 60)}” on ${where}`
    }
    case "press_keys": {
      const keys = str(input.keys).toLowerCase().replace(/\s+/g, "")
      const app = where.toLowerCase()
      // Quitting, closing and deleting can lose work.
      if (/(cmd|command|⌘)\+(q|w|delete|backspace)$/.test(keys) || /(cmd|command|⌘)\+(opt|option|alt|⌥)\+(esc|escape)$/.test(keys))
        return `Press ${str(input.keys)} in ${where} (this closes or deletes something)`
      if (!(keys.endsWith("return") || keys.endsWith("enter"))) return undefined
      return MESSAGING.some((m) => app.includes(m)) ? `Press ${keys} in ${where} (this usually sends)` : undefined
    }
    case "run_command": {
      const command = str(input.command).trim()
      return readOnlyCommand(command) ? undefined : `Run ${command.length > 80 ? `${command.slice(0, 80)}…` : command}`
    }
    case "write_file":
      return ctx.exists ? `Replace ${basename(str(input.path))}` : undefined
    case "edit_file":
      return `Change ${basename(str(input.path))}`
    case "delete_file":
      return `Delete ${basename(str(input.path))}`
    default:
      return undefined
  }
}

/** Does this step wait for the user? Full access skips asking; ask first asks for anything risky. */
export function needsApproval(fullAccess: boolean, flaggedByModel: boolean, guardReason: string | undefined): boolean {
  if (fullAccess) return false
  return flaggedByModel || guardReason !== undefined
}

/**
 * The same, for one chat: a step that always asks (a protected folder) asks once, and once you allow it
 * the chat remembers (`allowed` holds the reasons already allowed).
 */
export function mustAsk(check: { reason?: string; always?: boolean }, fullAccess: boolean, flaggedByModel: boolean, allowed: Set<string>): boolean {
  if (check.always) return !allowed.has(check.reason ?? "")
  return needsApproval(fullAccess, flaggedByModel, check.reason)
}

// Commands that only look. Anything else (or anything that writes with > or runs a second program
// through xargs, -exec, -delete…) asks first.
const LOOK = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "echo", "printf", "grep", "rg", "find", "which", "whoami", "date", "uname",
  "du", "df", "file", "stat", "tree", "sort", "uniq", "cut", "diff", "basename", "dirname", "realpath", "true", "env",
  "node", "python3", "python", "npm", "pnpm", "git", "ps", "uptime", "hostname", "sw_vers", "dir", "type", "where",
])
// PowerShell, where Do it runs commands on Windows: cmdlets and aliases that only read (matched without case).
const PS_LOOK = new Set([
  "get-childitem", "gci", "get-content", "gc", "get-location", "gl", "get-item", "gi", "get-itemproperty", "get-process",
  "gps", "get-date", "get-command", "gcm", "get-host", "get-computerinfo", "select-string", "sls", "select-object",
  "select", "measure-object", "measure", "sort-object", "where-object", "where", "?", "foreach-object", "%",
  "format-table", "ft", "format-list", "fl", "test-path", "resolve-path", "split-path", "join-path", "write-output",
  "out-string", "get-filehash", "compare-object",
])
const VERSION_ONLY = new Set(["node", "python3", "python", "npm", "pnpm"])
const GIT_LOOK = new Set(["status", "log", "diff", "show", "branch", "remote", "rev-parse", "ls-files", "blame"])

// Commands that only read in general but have options that run another program or write a file
// (`sort --compress-program=sh`, `rg --pre=prog`, `sort -o out`). For these only the options listed
// here count as read-only; anything else, including GNU's abbreviated long options, asks first.
type Options = { short: string; shortValue: string; long: Set<string>; longValue: Set<string> }
const SAFE_OPTIONS: Record<string, Options> = {
  sort: {
    short: "bdfghiMnRrsuVcCmz",
    shortValue: "ktS",
    long: new Set(["ignore-leading-blanks", "dictionary-order", "ignore-case", "general-numeric-sort", "human-numeric-sort", "ignore-nonprinting", "month-sort", "numeric-sort", "random-sort", "reverse", "version-sort", "stable", "unique", "check", "merge", "zero-terminated", "debug", "help", "version"]),
    longValue: new Set(["key", "field-separator", "buffer-size", "parallel", "sort", "check"]),
  },
  rg: {
    short: "iSsFxwvclnNoqHIL0abUuph",
    shortValue: "efgtTmABCjMErd",
    long: new Set(["ignore-case", "smart-case", "case-sensitive", "fixed-strings", "word-regexp", "line-regexp", "invert-match", "count", "count-matches", "files-with-matches", "files-without-match", "files", "line-number", "no-line-number", "only-matching", "quiet", "hidden", "no-hidden", "no-ignore", "no-ignore-vcs", "no-ignore-parent", "no-ignore-dot", "no-ignore-global", "no-ignore-exclude", "no-ignore-files", "follow", "no-follow", "heading", "no-heading", "with-filename", "no-filename", "vimgrep", "json", "no-json", "stats", "multiline", "multiline-dotall", "pcre2", "no-pcre2", "trim", "null", "null-data", "column", "no-column", "no-messages", "binary", "no-binary", "text", "no-text", "type-list", "debug", "trace", "help", "version", "unrestricted", "glob-case-insensitive", "ignore-file-case-insensitive", "byte-offset", "passthru", "crlf", "no-config", "one-file-system", "invert-match", "pretty", "no-unicode", "unicode", "word-regexp", "files-without-match", "include-zero", "max-columns-preview", "no-require-git", "block-buffered", "line-buffered", "no-mmap", "mmap", "no-crlf", "auto-hybrid-regex"]),
    longValue: new Set(["regexp", "file", "glob", "iglob", "type", "type-not", "type-add", "type-clear", "max-count", "after-context", "before-context", "context", "threads", "max-depth", "maxdepth", "max-filesize", "max-columns", "sort", "sortr", "color", "colors", "encoding", "replace", "context-separator", "field-match-separator", "field-context-separator", "path-separator", "ignore-file", "engine", "dfa-size-limit", "regex-size-limit", "generate"]),
  },
}

/** True when every option is on the command's safe list. Values that follow an option are skipped. */
function onlySafeOptions(args: string[], o: Options): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === "--") return true
    if (!a.startsWith("-") || a === "-") continue
    if (a.startsWith("--")) {
      const [name, value] = [a.slice(2).split("=")[0]!, a.includes("=")]
      if (o.longValue.has(name)) {
        if (!value && !o.long.has(name)) i++
        continue
      }
      if (o.long.has(name) && !value) continue
      return false
    }
    for (let j = 1; j < a.length; j++) {
      const c = a[j]!
      if (o.shortValue.includes(c)) {
        if (j === a.length - 1) i++
        break
      }
      if (!o.short.includes(c)) return false
    }
  }
  return true
}

/** A shell word as the shell passes it on: quotes and backslash escapes removed. */
const unquote = (w: string) => w.replace(/\\(.)/g, "$1").replace(/['"]/g, "")

/** True for a command that only reads: `ls -la`, `git status`, `grep foo *.ts | wc -l`. */
export function readOnlyCommand(command: string): boolean {
  if (!command.trim()) return false
  if (/[`$]\(|`|>|<\(|\bsudo\b/.test(command)) return false
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean).map(unquote)
    const [first, ...args] = words
    if (!first) continue
    // "(Get-ChildItem).Count": the command inside PowerShell's brackets.
    const cmd = first.replace(/^\(+/, "").replace(/\).*$/, "")
    if (PS_LOOK.has(cmd.toLowerCase())) continue
    if (!LOOK.has(cmd)) return false
    if (VERSION_ONLY.has(cmd) && !(args.length === 1 && /^(-v|--version|-V)$/.test(args[0]!))) return false
    if (cmd === "git" && !GIT_LOOK.has(args.find((a) => !a.startsWith("-")) ?? "")) return false
    if (cmd === "find" && args.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fls)/.test(a))) return false
    if (cmd === "env" && args.length > 0) return false
    const safe = SAFE_OPTIONS[cmd]
    if (safe && !onlySafeOptions(args, safe)) return false
    // Read-only commands that can still write a file through their own options or operands.
    if (cmd === "tree" && args.some((a) => /^-[a-zA-Z]*o/.test(a))) return false
    if (cmd === "uniq" && args.filter((a) => !a.startsWith("-")).length > 1) return false
    if (cmd === "git" && args.some((a) => /^--output(=|$)/.test(a))) return false
  }
  return true
}

// Folders Axe never touches unless you asked: they hold your own things (Desktop, Documents,
// Downloads) or every app's private data (Library).
export const PROTECTED = ["Desktop", "Documents", "Downloads", "Library"] as const

export const expandHome = (p: string, home = homedir()) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p)

/** The Mac's and Windows' usual disks ignore case: ~/documents is ~/Documents. */
export const CASE_INSENSITIVE = process.platform === "darwin" || process.platform === "win32"

/**
 * The path with symlinks resolved: the nearest part of it that exists goes through realpath, the
 * rest (not created yet) is added back as written.
 */
export function realish(path: string): string {
  const rest: string[] = []
  let p = resolve(path)
  for (;;) {
    try {
      return rest.length ? join(realpathSync.native(p), ...rest.reverse()) : realpathSync.native(p)
    } catch {
      const up = dirname(p)
      if (up === p) return resolve(path)
      rest.push(basename(p))
      p = up
    }
  }
}

function topUnder(home: string, full: string, fold: boolean): string | undefined {
  const rel = fold ? relative(home.toLowerCase(), full.toLowerCase()) : relative(home, full)
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined
  return rel.split(sep)[0]
}

/**
 * The protected folder this path is in, if any. Compared without case where the disk ignores it,
 * and both as written and with symlinks resolved, so ~/documents/x and a link into ~/Documents count.
 */
export function protectedFolder(path: string, home = homedir(), fold = CASE_INSENSITIVE): (typeof PROTECTED)[number] | undefined {
  const full = resolve(expandHome(path, home))
  // Where it really is first: a link at ~/Library/x pointing into ~/Documents is about Documents.
  for (const [h, p] of [[realish(home), realish(full)], [home, full]] as const) {
    const top = topUnder(h, p, fold)
    const hit = top && PROTECTED.find((f) => (fold ? f.toLowerCase() === top.toLowerCase() : f === top))
    if (hit) return hit
  }
  return undefined
}

/** Did the user name this folder in what they wrote? "my downloads", "~/Documents/notes.txt". */
export function userNamed(folder: string, userText: string): boolean {
  const word = folder.toLowerCase()
  return new RegExp(`\\b${word}\\b`, "i").test(userText)
}

export function shortPath(p: string, home = homedir()): string {
  const full = resolve(expandHome(p, home))
  return full.startsWith(home + sep) ? `~${full.slice(home.length)}` : full
}
