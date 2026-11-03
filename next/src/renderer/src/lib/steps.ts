import type { Part } from "@shared/types"

export type StepPart = Extract<Part, { type: "reasoning" } | { type: "tool" } | { type: "source" }>
export type ToolPart = Extract<Part, { type: "tool" }>

/** A reply, cut into what it shows: a folded line of steps, words, a plan card or an error. */
export type Segment =
  | { kind: "steps"; id: string; parts: StepPart[] }
  | { kind: "text"; id: string; text: string }
  | { kind: "plan"; id: string; part: Extract<Part, { type: "plan" }> }
  | { kind: "error"; id: string; text: string }
  | { kind: "rich"; id: string; part: Extract<Part, { type: "rich" }> }

export const isStep = (p: Part): p is StepPart => p.type === "reasoning" || p.type === "tool" || p.type === "source"

/**
 * Groups a reply's parts. Every run of steps (thinking, tools, sources) between the words becomes one
 * StepGroup line, so everything before the answer folds into a single line.
 */
export function segment(parts: Part[]): Segment[] {
  const out: Segment[] = []
  for (const p of parts) {
    if (isStep(p)) {
      const last = out[out.length - 1]
      if (last?.kind === "steps") last.parts.push(p)
      else out.push({ kind: "steps", id: `g-${p.id}`, parts: [p] })
      continue
    }
    if (p.type === "text") {
      if (!p.text) continue
      const last = out[out.length - 1]
      // Text arriving in several parts reads as one answer.
      if (last?.kind === "text") last.text += p.text
      else out.push({ kind: "text", id: p.id, text: p.text })
    } else if (p.type === "plan") out.push({ kind: "plan", id: p.id, part: p })
    else if (p.type === "error") out.push({ kind: "error", id: p.id, text: p.text })
    else if (p.type === "rich") out.push({ kind: "rich", id: p.id, part: p })
  }
  return out
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const isWebSearch = (t: ToolPart) => /\bweb\b|internet|online/i.test(t.title)

type Bucket = { key: string; phrase: (n: number) => string; count: number }

/**
 * The folded line once the steps are done: "Searched the web", "Read 3 files, ran 1 command",
 * "Thought for 4s". Thinking is only named when nothing else happened, unless `withThought` (an agent
 * chat: "Thought for 3s, read 3 files, ran 1 command").
 */
export function summarize(parts: StepPart[], withThought = false): string {
  const buckets: Bucket[] = []
  const add = (key: string, phrase: (n: number) => string, by = 1) => {
    const b = buckets.find((x) => x.key === key)
    if (b) b.count += by
    else buckets.push({ key, phrase, count: by })
  }
  const touched = new Map<string, Set<string>>()
  let thought = 0
  let thoughtKnown = false
  let failed = 0
  let declined = 0

  for (const p of parts) {
    if (p.type === "reasoning") {
      if (p.seconds !== undefined) {
        thought += p.seconds
        thoughtKnown = true
      }
      continue
    }
    if (p.type === "source") {
      add("web", () => "Searched the web")
      continue
    }
    // Local models: the engine's own steps (chat.ts localAnswer, filesFor) read as what they did.
    if (p.title === "Started Ollama") {
      add("ollama", () => "Started Ollama")
      continue
    }
    if (p.title.startsWith("Left out ")) {
      add("left", (n) => `Left out ${plural(n, "file")}`)
      continue
    }
    if (p.state === "failed") failed++
    if (p.state === "declined") {
      declined++
      continue
    }
    switch (p.kind) {
      case "think":
        break
      case "search":
        if (isWebSearch(p)) add("web", () => "Searched the web")
        else add("find", () => "Searched your files")
        break
      case "fetch":
        add("fetch", (n) => `Opened ${plural(n, "page")}`)
        break
      case "read":
        add("read", (n) => `Read ${plural(n, "file")}`)
        break
      case "edit": {
        const paths = p.diff?.map((d) => d.path) ?? [p.input ?? p.id]
        const set = touched.get("edit") ?? new Set<string>()
        const before = set.size
        for (const path of paths) set.add(path)
        touched.set("edit", set)
        add("edit", (n) => `Changed ${plural(n, "file")}`, set.size - before)
        break
      }
      case "delete":
        add("delete", (n) => `Deleted ${plural(n, "file")}`)
        break
      case "move":
        add("move", (n) => `Moved ${plural(n, "file")}`)
        break
      case "execute":
        add("execute", (n) => `Ran ${plural(n, "command")}`)
        break
      default:
        add("other", (n) => `Used ${plural(n, "tool")}`)
    }
  }

  const phrases = buckets.filter((b) => b.count > 0).map((b) => b.phrase(b.count))
  if (failed) phrases.push(`${plural(failed, "step")} failed`)
  if (declined) phrases.push(`${plural(declined, "step")} not allowed`)
  if (!phrases.length) return thoughtKnown ? `Thought for ${formatSeconds(thought)}` : "Thought for a moment"
  if (withThought && thoughtKnown && thought > 0) phrases.unshift(`Thought for ${formatSeconds(thought)}`)
  return phrases.map((s, i) => (i === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1))).join(", ")
}

/** Whether a group is still working: a tool running, thinking not done, or the reply still on this group. */
export function isLiveGroup(parts: StepPart[], replyLive: boolean, isLastSegment: boolean): boolean {
  if (!replyLive) return false
  if (parts.some((p) => (p.type === "tool" && p.state === "running") || (p.type === "reasoning" && !p.done))) return true
  return isLastSegment
}

/** The step shown while working: the newest running tool, else "Thinking". */
export function liveLabel(parts: StepPart[]): string {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!
    if (p.type === "tool" && p.state === "running") return isShellCommand(p.title) ? commandLabel(p.title, false) : p.title
    if (p.type === "reasoning" && !p.done) return "Thinking"
  }
  return "Thinking"
}

export function formatSeconds(s: number): string {
  const n = Math.max(0, Math.round(s))
  if (n < 60) return `${n}s`
  const m = Math.floor(n / 60)
  const r = n % 60
  return r ? `${m}m ${r}s` : `${m}m`
}

/** Plain text of a reply, for Copy. */
export function replyText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim()
}

// Web addresses that read as sites, not files ("notes.md" is a file, though .md is a country).
const SITE_ENDINGS = new Set("com org net io ai dev app co me so xyz gov edu info biz tv gg sh fm uk de fr es it nl se no dk fi pl in jp cn kr vn sg au nz ca us br mx ch at be ie pt ru ua tr za".split(" "))

/** The website a step is about ("axeai.com"), from a link or a bare domain in its words; else null. */
export function siteOf(...texts: (string | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue
    const link = text.match(/https?:\/\/[^\s"'<>)\]]+/)
    if (link) {
      try {
        return new URL(link[0]).hostname.replace(/^www\./, "")
      } catch {}
    }
    for (const m of text.matchAll(/(?<![\w@./-])((?:[a-z0-9-]+\.)+([a-z]{2,}))(?![\w-])/gi)) {
      const [, domain = "", ending = ""] = m
      if (SITE_ENDINGS.has(ending.toLowerCase())) return domain.toLowerCase().replace(/^www\./, "")
    }
  }
  return null
}

const SHELL_START = /^(cd|for|if|while|export|sudo|npm|pnpm|npx|yarn|bun|node|deno|git|gh|ls|cat|head|tail|less|sed|awk|grep|rg|find|fd|wc|sort|echo|printf|mkdir|rm|mv|cp|touch|chmod|curl|wget|bash|sh|zsh|python3?|pip3?|uv|make|cargo|go|swift|xcodebuild|docker|kubectl|ps|kill|pkill|open|osascript|mdfind|which|command|env|tree|du|df|lsof|ssh|scp|tar|zip|unzip)\b/

/** Whether a step's title is a raw shell command (CLIs name their shell steps by the command). */
export function isShellCommand(title: string): boolean {
  const t = title.trim()
  return SHELL_START.test(t) || t.includes("\n") || /(&&|\|\||\s\|\s|2>|>\/dev\/null|;\s)/.test(t) || (t.length > 80 && /[|&;<>$`]/.test(t))
}

/** A shell command in a few plain words ("Searching files"), by what it mostly does. */
export function commandLabel(command: string, done: boolean): string {
  const words = command.replace(/^cd\s+\S+\s*(&&|;)\s*/, "").trim()
  const [now, past] =
    /\b(grep|rg|find|fd|mdfind|ag)\b/.test(words) ? ["Searching files", "Searched files"]
    : /^(ls|tree|du)\b/.test(words) ? ["Looking at files", "Looked at files"]
    : /^(cat|head|tail|less|sed -n|wc)\b/.test(words) ? ["Reading a file", "Read a file"]
    : /^(git|gh)\b/.test(words) ? ["Using git", "Used git"]
    : /^(npm|pnpm|npx|yarn|bun|make|cargo|go|swift|xcodebuild)\b/.test(words) && /\btest|vitest|jest|playwright\b/.test(words) ? ["Running tests", "Ran tests"]
    : /^(npm|pnpm|npx|yarn|bun|make|cargo|go|swift|xcodebuild)\b/.test(words) ? ["Running a script", "Ran a script"]
    : /^(curl|wget)\b/.test(words) ? ["Fetching a page", "Fetched a page"]
    : /^(ps|lsof|osascript)\b/.test(words) ? ["Checking this computer", "Checked this computer"]
    : ["Running a command", "Ran a command"]
  return done ? past : now
}
