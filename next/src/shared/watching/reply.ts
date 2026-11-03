import { planSentence } from "./copy"
import type { Every, Watch, WatchPatch } from "./types"

// A reply to a watch that changes it, read with plain rules (no model): how often, when to tell you,
// pause and resume, a fixed slow line for uptime, and what a page watch ignores. Null when it isn't
// a change Axe knows. `undo`: the change can be undone from the thread.

const EVERY_WORDS: [RegExp, Every][] = [
  [/\b(5|five) ?min/i, "5m"],
  [/\b(15|fifteen) ?min/i, "15m"],
  [/\b(every|once an?) hour|\bhourly\b/i, "1h"],
  [/\bmorning\b|\bdaily\b|\bonce a day\b|\bevery day\b/i, "morning"],
]

const ABOVE = /\b(?:above|over|more than|slower than|longer than)\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|ms)\b/i

const EVERY_WORDS_SAY: Record<Every, string> = { "5m": "every 5 minutes", "15m": "every 15 minutes", "1h": "every hour", morning: "every morning at 7:30" }

/** "ignore the date at the bottom", "ignore lines about opening hours": a page watch's ignore rule. */
function ignoreRule(t: string): { rule: string; say: string } | null {
  const m = t.match(/\bignore\s+(.+?)\s*[.!]?$/i)
  if (!m) return null
  const rest = m[1]!.trim()
  if (/\b(dates?|updated|timestamps?|time stamps?)\b/i.test(rest)) {
    const where = /\b(bottom|footer|end)\b/i.test(rest) ? " at the bottom" : /\b(top|header)\b/i.test(rest) ? " at the top" : ""
    return { rule: "date", say: `ignore the date line${where}` }
  }
  const quoted = rest.match(/[“"']([^”"']{2,60})[”"']/)?.[1]
  const words = (
    quoted ??
    rest
      .replace(/^(the|any|all)\s+/i, "")
      .replace(/^(lines?|changes?|text|parts?|bits?)\s+(with|about|containing|that mention|mentioning|to|in|on)\s+/i, "")
      .replace(/\s+(lines?|parts?|section|bits?|changes?)$/i, "")
  ).trim()
  if (words.length < 2 || words.length > 60) return null
  return { rule: `text:${words}`, say: `ignore lines with “${words}”` }
}

export function readReply(w: Pick<Watch, "kind" | "target" | "every" | "notify" | "ignore">, text: string): { patch: WatchPatch; say: string; undo?: boolean } | null {
  const t = text.trim()
  if (/^(pause|stop)\b/i.test(t)) return { patch: { paused: true }, say: "Paused. Say resume to start it again." }
  if (/^(resume|start|unpause)\b/i.test(t)) return { patch: { paused: false }, say: "Resumed. Checking now." }
  // A page watch can also ignore part of the page, alone or with a new schedule:
  // "only check this once a day, and ignore the date at the bottom".
  const ig = w.kind === "page" ? ignoreRule(t) : null
  if (ig) {
    const before = t.slice(0, t.search(/\bignore\b/i))
    const every = EVERY_WORDS.find(([re]) => re.test(before))?.[1]
    const patch: WatchPatch = { ignore: [...new Set([...(w.ignore ?? []), ig.rule])], ...(every ? { every } : {}) }
    const parts = [...(every ? [`check ${EVERY_WORDS_SAY[every]}`] : []), ig.say]
    return { patch, say: `Done. I’ll ${parts.join(" and ")}.`, undo: true }
  }
  const above = w.kind === "uptime" ? t.match(ABOVE) : null
  if (above) {
    const n = Number(above[1])
    const ms = /^ms$/i.test(above[2]!) ? n : n * 1000
    if (ms >= 100 && ms <= 60_000) return { patch: { fixedMs: ms }, say: `Okay. I’ll tell you when it takes more than ${+(ms / 1000).toFixed(1)} s to load.`, undo: true }
  }
  if (/\bonly\b.*\bmorning\b|\bsummary\b/i.test(t)) return { patch: { notify: "summary" }, say: "Okay. I’ll only tell you in the morning summary.", undo: true }
  if (/\bright away\b|\bimmediately\b|\bat once\b/i.test(t)) return { patch: { notify: "now" }, say: "Okay. I’ll tell you right away.", undo: true }
  for (const [re, every] of EVERY_WORDS) if (re.test(t)) return { patch: { every }, say: `Okay. ${planSentence(w.kind, w.target, every, w.notify)}`, undo: true }
  return null
}

/** "every minute", "every 30 seconds", "every 2 min": more often than Axe checks. */
export const TOO_OFTEN = /\bevery\s+(?:(?:[1-4]|one|a|two|three|four)\s*)?(?:min(?:ute)?s?|mins?)\b|\bevery\s+(?:\d+\s*)?(?:sec(?:ond)?s?)\b|\bevery\s+minute\b/i

/** What Axe says to a reply it can't act on. */
export const CANT = "I can change how often it checks, when it tells you, or pause it. For anything else, start a chat."
