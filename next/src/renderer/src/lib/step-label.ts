import { diffLines } from "./diff"
import type { StepPart, ToolPart } from "./steps"

/**
 * A step in plain English: verb and object ("Searched the code for ‘unarchive’", "Read store.ts"). The raw
 * command or path never is the label; it waits inside the step, shown only when it is opened.
 */
export type StepLabel = {
  /** Finished: "Read store.ts". */
  done: string
  /** While it runs: "Reading store.ts". */
  now: string
  /** Steps that fold together when they come one after another ("Read 4 files"). */
  group?: string
  /** "+12 −3" for an edit whose line counts are known. */
  extra?: string
}

/** Imperative first words of tool titles ("Open Claude", "Click in the app") and their past and -ing forms. */
const VERBS: Record<string, [string, string]> = {
  open: ["Opened", "Opening"],
  read: ["Read", "Reading"],
  click: ["Clicked", "Clicking"],
  type: ["Typed", "Typing"],
  press: ["Pressed", "Pressing"],
  scroll: ["Scrolled", "Scrolling"],
  look: ["Looked", "Looking"],
  list: ["Listed", "Listing"],
  take: ["Took", "Taking"],
  fill: ["Filled", "Filling"],
  check: ["Checked", "Checking"],
  use: ["Used", "Using"],
  drag: ["Dragged", "Dragging"],
  wait: ["Waited", "Waiting"],
  copy: ["Copied", "Copying"],
  paste: ["Pasted", "Pasting"],
  close: ["Closed", "Closing"],
  switch: ["Switched", "Switching"],
  select: ["Selected", "Selecting"],
  save: ["Saved", "Saving"],
  send: ["Sent", "Sending"],
  get: ["Got", "Getting"],
  go: ["Went", "Going"],
  show: ["Showed", "Showing"],
  find: ["Found", "Finding"],
}

/** A title kept in its own words, with the tense fixed: "Open Claude" → "Opened Claude" / "Opening Claude". */
const KEEP = (title: string): StepLabel => {
  const m = /^(\w+)(\s.*)?$/.exec(title)
  const v = m && VERBS[m[1]!.toLowerCase()]
  return v ? { done: `${v[0]}${m[2] ?? ""}`, now: `${v[1]}${m[2] ?? ""}` } : { done: title, now: title }
}

/** Phrases for a run of steps of one group: "Read 4 files". */
export function groupPhrase(group: string, n: number): string {
  if (group.startsWith("use:")) return `Used ${group.slice(4)} ${n} times`
  switch (group) {
    case "read":
      return `Read ${n} files`
    case "edit":
      return `Edited ${n} files`
    case "code":
      return `Searched the code ${n} times`
    case "web":
      return `Searched the web ${n} times`
    case "open":
      return `Opened ${n} pages`
    case "list":
      return `Listed files ${n} times`
    case "tests":
      return `Ran the tests ${n} times`
    case "git":
      return `Checked git ${n} times`
    case "install":
      return `Installed packages ${n} times`
    default:
      return `Ran ${n} commands`
  }
}

/** "/Users/mia/app/src/store.ts:12" → "store.ts". */
export function basename(path: string): string {
  const clean = path
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/:\d+(:\d+)?$/, "")
    .replace(/\/+$/, "")
  return clean.split("/").pop() || clean
}

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const quote = (s: string) => `‘${clip(s)}’`

/** Splits a shell line into words, keeping quoted parts whole; `|`, `;`, `&&` and `||` are words of their own. */
export function shellWords(command: string): string[] {
  const out: string[] = []
  let word = ""
  let has = false
  let q: string | null = null
  const push = () => {
    if (has) out.push(word)
    word = ""
    has = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (q) {
      if (c === q) q = null
      else if (c === "\\" && q === '"' && i + 1 < command.length) word += command[++i]
      else word += c
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      has = true
    } else if (c === "\\" && i + 1 < command.length) {
      word += command[++i]
      has = true
    } else if (/\s/.test(c)) push()
    else if (c === "|" || c === ";" || c === "&") {
      push()
      const two = command.slice(i, i + 2)
      if (two === "&&" || two === "||") {
        out.push(two)
        i++
      } else if (c === "&" && command[i + 1] === ">") {
        word = "&"
        has = true
      } else out.push(c)
    } else {
      word += c
      has = true
    }
  }
  push()
  return out
}

/** A command's words without its redirections: `cat a.md 2>/dev/null` → [cat, a.md], never "Read null". */
function withoutRedirects(words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    // A bare operator ("2>", ">>", "<") takes the next word; "2>&1" and "2>/dev/null" stand alone.
    // A word that only starts with "<" stays: it may be a quoted pattern ("<div").
    if (/^((\d*|&)>>?|<)$/.test(w)) i++
    else if (!/^(\d*|&)>>?\S/.test(w)) out.push(w)
  }
  return out
}

/** The simple commands of a shell line, each as its words: `cd . && grep x src | head` → [[cd, .], [grep, x, src], [head]]. */
function commands(command: string): string[][] {
  const out: string[][] = [[]]
  for (const w of shellWords(command)) {
    if (w === "|" || w === ";" || w === "&&" || w === "||" || w === "&") out.push([])
    else out[out.length - 1]!.push(w)
  }
  return out
    .map((c) => {
      // Leading "VAR=1", "sudo", "time", "env", "(" belong to the command, not its name.
      const words = withoutRedirects(c.map((w) => w.replace(/^\(+|\)+$/g, "")).filter(Boolean))
      let i = 0
      while (i < words.length && (/^\w+=/.test(words[i]!) || /^(sudo|time|env|exec|nohup)$/.test(words[i]!) || (words[i] === "command" && !/^-[vV]$/.test(words[i + 1] ?? "")))) i++
      return words.slice(i)
    })
    .filter((c) => c.length && c[0])
}

const SKIP = /^(cd|export|set|source|\.|true|echo|printf|sleep|unset|alias|pushd|popd|command|which|type|test|\[)$/
const SEARCH = /^(grep|egrep|fgrep|rg|ag|ack|find|fd|mdfind|git-grep)$/
// Flags of grep and rg that take the next word as their value.
const VALUE_FLAGS = /^-(e|f|m|A|B|C|g|t|T|-glob|-type|-max-count|-context|-after-context|-before-context|-regexp|-include|-exclude|-exclude-dir)$/

/** What a search command looks for: grep's or rg's first pattern, find's -name. */
function searchPattern(c: string[]): string | undefined {
  const [name, ...args] = c
  if (name === "find") {
    const at = args.findIndex((a) => /^-i?(name|path|regex)$/.test(a))
    return at >= 0 ? args[at + 1] : undefined
  }
  if (name === "mdfind") return args.filter((a) => !a.startsWith("-")).join(" ") || undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === "-e" || a === "--regexp") return args[i + 1]
    if (a.startsWith("--regexp=")) return a.slice(9)
    if (a === "--") return args[i + 1]
    if (VALUE_FLAGS.test(a)) {
      i++
      continue
    }
    if (a.startsWith("-") || a.startsWith(">") || /^\d?>/.test(a)) continue
    return a
  }
  return undefined
}

const isTestRun = (c: string[]) => {
  const [n = "", a = "", b = ""] = c
  if (/^(vitest|jest|pytest|mocha|ava|tap|phpunit|rspec)$/.test(n)) return true
  if (/^(npm|pnpm|yarn|bun)$/.test(n) && (a === "test" || a === "t" || ((a === "run" || a === "exec" || a === "-r" || a === "--filter") && /^test|test$|vitest|jest|playwright/.test(b)) || /^test(:|$)/.test(a))) return true
  if (/^(npx|pnpx|bunx)$/.test(n) && /^(vitest|jest|playwright|mocha)$/.test(a)) return true
  if ((n === "go" || n === "cargo" || n === "swift" || n === "deno" || n === "bun") && a === "test") return true
  if (n === "python" || n === "python3") return (a === "-m" && /^(pytest|unittest)$/.test(b))
  if (n === "playwright" && a === "test") return true
  if (n === "make" && /^test/.test(a)) return true
  return c.includes("vitest") || c.includes("jest") || c.includes("pytest")
}

const isInstall = ([n = "", a = "", b = ""]: string[]) =>
  (/^(npm|pnpm|yarn|bun)$/.test(n) && /^(install|i|add|ci)$/.test(a)) ||
  (n === "yarn" && !a) ||
  (/^(pip|pip3|brew|gem|apt|apt-get|poetry|composer)$/.test(n) && /^(install|add)$/.test(a)) ||
  (n === "uv" && (a === "add" || (a === "pip" && b === "install") || a === "sync")) ||
  (n === "cargo" && (a === "add" || a === "install")) ||
  (n === "go" && (a === "get" || a === "install"))

/** A shell command in plain words, by what it mostly does. */
export function commandStep(command: string): StepLabel {
  const all = commands(command.trim().replace(/^`|`$/g, ""))
  if (all.some(isTestRun)) return { done: "Ran the tests", now: "Running the tests", group: "tests" }
  if (all.some(isInstall)) return { done: "Installed packages", now: "Installing packages", group: "install" }
  const main = all.find((c) => !SKIP.test(c[0]!)) ?? all[0]
  const [name = "", sub = ""] = main ?? []
  if (SEARCH.test(name) || (name === "git" && sub === "grep")) {
    const pattern = searchPattern(name === "git" ? main!.slice(1) : main!)
    const what = pattern ? ` for ${quote(pattern)}` : ""
    return { done: `Searched the code${what}`, now: `Searching the code${what}`, group: "code" }
  }
  if (/^(ls|tree|eza|exa|du)$/.test(name)) return { done: "Listed files", now: "Listing files", group: "list" }
  if (name === "git" || name === "gh") {
    if (/^(status|diff)$/.test(sub)) return { done: "Checked git status", now: "Checking git status", group: "git" }
    if (/^(log|show|blame|reflog|shortlog)$/.test(sub)) return { done: "Checked git history", now: "Checking git history", group: "git" }
  }
  if (/^(cat|head|tail|less|more|bat|nl)$/.test(name) || (name === "sed" && main!.includes("-n"))) {
    const file = main!
      .slice(1)
      .filter((w) => !w.startsWith("-") && !/^\d+(,\d+)?p?$/.test(w))
      .at(-1)
    if (file) return { done: `Read ${basename(file)}`, now: `Reading ${basename(file)}`, group: "read" }
  }
  if (name === "curl" || name === "wget") {
    const site = hostOf(main!.find((w) => /^https?:\/\//.test(w)) ?? "")
    if (site) return { done: `Opened ${site}`, now: `Opening ${site}`, group: "open" }
  }
  return { done: "Ran a command", now: "Running a command", group: "command" }
}

/** "https://www.axeai.com/pricing" → "axeai.com"; null when it isn't a link. */
export function hostOf(text: string): string | null {
  const link = text.match(/https?:\/\/[^\s"'<>)\]`]+/)
  if (!link) return null
  try {
    return new URL(link[0]).host.replace(/^www\./, "")
  } catch {
    return null
  }
}

const KNOWN: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gmail: "Gmail",
  hubspot: "HubSpot",
  posthog: "PostHog",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  paypal: "PayPal",
  clickup: "ClickUp",
  figma: "Figma",
  mcp: "MCP",
  ai: "AI",
  api: "API",
}

/** "mcp__claude_ai_Google_Drive__search" → "Google Drive". */
export function connectorName(server: string): string {
  const words = server
    .replace(/^claude_ai_/i, "")
    .replace(/^plugin_[^_]+_/i, "")
    .split(/[_\-\s.]+/)
    .filter(Boolean)
  return words.map((w) => KNOWN[w.toLowerCase()] ?? (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ")
}

/** A connector's tool: "mcp__gmail__search" or "gmail - search (MCP)"; the connector's name, else null. */
function mcpServer(title: string): string | null {
  const m = /^mcp__(.+?)__/.exec(title) ?? /^(.+?)\s+-\s+.+\(MCP\)\s*$/.exec(title)
  return m ? connectorName(m[1]!) : null
}

// Words that look like a path or a file name, not a sentence.
const PATHLIKE = /^[^\s]+$/
const isPath = (s: string) => !!s && PATHLIKE.test(s) && /[/.]/.test(s)
const firstLine = (s?: string) => (s ?? "").split("\n").find((l) => l.trim())?.trim() ?? ""
const untick = (s: string) => s.replace(/`/g, "").trim()

/** The object of a titled step: "Read /a/b/store.ts (1 - 40)" → "/a/b/store.ts". */
function objectOf(title: string, verbs: RegExp): string {
  return untick(title)
    .replace(verbs, "")
    .replace(/\s*\(\d+\s*-\s*\d+\)\s*$/, "")
    .replace(/\s*\(from line \d+\)\s*$/i, "")
    .trim()
}

const isShell = (title: string, kind: ToolPart["kind"]) =>
  /^(cd|for|if|while|export|sudo|npm|pnpm|npx|yarn|bun|node|deno|git|gh|ls|cat|head|tail|less|sed|awk|grep|egrep|rg|ag|find|fd|wc|sort|echo|printf|mkdir|rm|mv|cp|touch|chmod|curl|wget|bash|sh|zsh|python3?|pip3?|pytest|vitest|jest|uv|make|cargo|go|swift|xcodebuild|docker|kubectl|ps|kill|pkill|open|osascript|mdfind|which|command|env|tree|du|df|lsof|ssh|scp|tar|zip|unzip|brew)\b/.test(untick(title)) ||
  /(&&|\|\||\s\|\s|2>|>\/dev\/null|;\s)/.test(title) ||
  (kind === "execute" && title.startsWith("`"))

/** A tool step in plain English. Titles an engine already wrote in words ("Ran the test 10 times") stay. */
export function toolStep(p: ToolPart): StepLabel {
  const title = p.title.trim()
  const server = mcpServer(title)
  if (server) return { done: `Used ${server}`, now: `Using ${server}`, group: `use:${server}` }
  if (isShell(title, p.kind)) return commandStep(untick(title))
  if (p.kind === "execute" && p.input && /^(Run|Running|Ran|Terminal|Bash|Shell|Command)$/i.test(title)) return commandStep(p.input)

  switch (p.kind) {
    case "read": {
      const fromTitle = /^(Read|Reading|View|Open)\s+/i.test(title) ? objectOf(title, /^(Read|Reading|View|Open)\s+/i) : ""
      const input = firstLine(p.input)
      const path = isPath(input) ? input : isPath(fromTitle) || (fromTitle && PATHLIKE.test(fromTitle)) ? fromTitle : ""
      if (!path) return KEEP(title)
      const name = basename(path)
      return { done: `Read ${name}`, now: `Reading ${name}`, group: "read" }
    }
    case "edit": {
      const paths = [...new Set(p.diff?.map((d) => d.path) ?? [])]
      if (paths.length > 1) return { done: `Edited ${paths.length} files`, now: `Editing ${paths.length} files`, group: "edit", extra: lineCounts(p) }
      const fromTitle = /^(Edit|Edited|Editing|Write|Wrote|Writing|Create|Created|Update|Updated|MultiEdit)\s+/i.test(title) ? objectOf(title, /^\S+\s+/) : ""
      const path = paths[0] ?? (PATHLIKE.test(fromTitle) && fromTitle ? fromTitle : PATHLIKE.test(firstLine(p.input)) ? firstLine(p.input) : "")
      if (!path) return KEEP(title)
      const name = basename(path)
      return { done: `Edited ${name}`, now: `Editing ${name}`, group: "edit", extra: lineCounts(p) }
    }
    case "delete":
    case "move": {
      const verb = p.kind === "delete" ? ["Deleted", "Deleting"] : ["Moved", "Moving"]
      const raw = objectOf(title, /^\S+\s+/)
      const path = PATHLIKE.test(raw) && /^(Delete|Deleted|Remove|Move|Moved|Rename)\b/i.test(title) ? raw : PATHLIKE.test(firstLine(p.input)) ? firstLine(p.input) : ""
      return path ? { done: `${verb[0]} ${basename(path)}`, now: `${verb[1]} ${basename(path)}` } : KEEP(title)
    }
    case "search": {
      // "Look for apps like “claude”" looks for apps, not code.
      if (/\bapps?\b/i.test(title)) return KEEP(title)
      const web = /\bweb\b|internet|online/i.test(title)
      const words = untick(title)
      const quoted = /[“"‘'](.+?)[”"’']/.exec(words)?.[1]
      if (web) {
        const q = quoted ?? (p.input && !/^https?:/.test(p.input) ? firstLine(p.input) : "")
        const what = q ? ` for ${quote(q)}` : ""
        return { done: `Searched the web${what}`, now: `Searching the web${what}`, group: "web" }
      }
      const pattern = quoted ?? (/^(Find|Search|Searched|Searching|Grep|Glob)\s+/i.test(words) ? objectOf(words, /^\S+\s+(for\s+)?/i) : "")
      const what = pattern && !/\s(in|files)\b/.test(pattern) ? ` for ${quote(pattern)}` : ""
      return { done: `Searched the code${what}`, now: `Searching the code${what}`, group: "code" }
    }
    case "fetch": {
      const site = hostOf(p.input ?? "") ?? hostOf(title)
      if (site) return { done: `Opened ${site}`, now: `Opening ${site}`, group: "open" }
      // A CLI's web search: its title is the query in quotes.
      const q = /^[“"](.+)[”"]$/.exec(untick(title))?.[1]
      if (q) return { done: `Searched the web for ${quote(q)}`, now: `Searching the web for ${quote(q)}`, group: "web" }
      return KEEP(title)
    }
    default:
      return KEEP(title)
  }
}

/** "+12 −3" from an edit's diff; undefined when nothing is known. */
function lineCounts(p: ToolPart): string | undefined {
  if (!p.diff?.length) return undefined
  let added = 0
  let removed = 0
  for (const d of p.diff)
    for (const l of diffLines(d.before, d.after)) {
      if (l.sign === "+") added++
      else if (l.sign === "-") removed++
    }
  return added || removed ? `+${added} −${removed}` : undefined
}

/** Any step: tools as above, thinking as "Thought for 4s". */
export function stepLabel(p: Exclude<StepPart, { type: "source" }>, seconds: (s: number) => string): StepLabel {
  if (p.type === "reasoning") {
    const done = p.seconds !== undefined ? `Thought for ${seconds(p.seconds)}` : "Thought"
    return { done, now: "Thinking" }
  }
  return toolStep(p)
}

/** Consecutive items with the same group fold into one run; items with no group stand alone. */
export function groupRuns<T>(items: T[], groupOf: (t: T) => string | undefined): { group?: string; items: T[] }[] {
  const out: { group?: string; items: T[] }[] = []
  for (const it of items) {
    const g = groupOf(it)
    const last = out[out.length - 1]
    if (g && last?.group === g) last.items.push(it)
    else out.push({ group: g, items: [it] })
  }
  return out
}
