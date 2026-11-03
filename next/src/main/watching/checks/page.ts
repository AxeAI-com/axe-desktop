import { createHash } from "node:crypto"

import { pageChange, wordCount } from "@shared/watching/diff"
import { urlOf } from "@shared/watching/target"
import type { Finding, Run } from "@shared/watching/types"

import { type CheckDeps, HEADERS, plainError, TIMEOUT } from "./deps"

// Page changes: load the page, keep its text, and say which lines changed. The caller saves `text`
// and passes it back as `prev` next time. The ignore rules come from the watch.

export type Loaded = { ok: true; status: number; statusText: string; body: string; url: string } | { ok: false; error: string }

/** Loads a page's HTML; never throws. */
export async function loadPage(target: string, d: Pick<CheckDeps, "fetch">): Promise<Loaded> {
  try {
    const res = await d.fetch(urlOf(target), { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT), headers: HEADERS })
    return { ok: true, status: res.status, statusText: res.statusText, body: await res.text(), url: res.url || urlOf(target) }
  } catch (e) {
    return { ok: false, error: plainError(e) }
  }
}

const REASON: Record<number, string> = { 404: "Not found", 410: "Gone", 500: "Server error", 502: "Bad gateway", 503: "Unavailable" }

/** "That page returns Not found (404)." for an HTTP error. */
export const httpError = (status: number, statusText: string) => {
  const why = REASON[status] ?? (statusText ? statusText[0]!.toUpperCase() + statusText.slice(1).toLowerCase() : "an error")
  return `That page returns ${why} (${status}).`
}

export const SIGN_IN = "That page needs a sign-in, so Axe can’t read it."
export const NO_TEXT = "That page has no text Axe can read."

/** A page Axe can't read as it is: an HTTP error, a sign-in wall, or no text. Null when it's fine. */
export function unreadable(r: Extract<Loaded, { ok: true }>, text: string): string | null {
  if (r.status === 401 || r.status === 403) return SIGN_IN
  if (r.status >= 400) return httpError(r.status, r.statusText)
  const path = (() => {
    try {
      return new URL(r.url).pathname
    } catch {
      return ""
    }
  })()
  const words = wordCount(text)
  // A login form with little else on it, or a redirect to a sign-in page.
  if (/\/(log-?in|sign-?in|auth|session|account\/login)\b/i.test(path) || (/<input[^>]+type=["']?password/i.test(r.body) && words < 200)) return SIGN_IN
  if (!words) return NO_TEXT
  return null
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "’")

/** The page's visible text, one line per block. */
export const textOf = (html: string) =>
  decode(
    html
      .replace(/<(script|style|noscript|head|title)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")

const titleOf = (html: string) => {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return t ? decode(t).replace(/\s+/g, " ").trim() : ""
}

export async function checkPage(target: string, prev: string | undefined, d: CheckDeps, ignore: string[] = []): Promise<{ run: Run; text?: string }> {
  const at = d.now()
  const r = await loadPage(target, d)
  const ms = () => Math.round(d.now() - at)
  if (!r.ok) return { run: { at, ms: ms(), status: "failed", findings: [], error: r.error } }
  const text = r.status < 400 ? textOf(r.body) : ""
  const bad = unreadable(r, text)
  if (bad) return { run: { at, ms: ms(), status: "failed", findings: [], error: bad } }
  const words = wordCount(text)
  const facts: [string, string][] = [
    ["Words", words.toLocaleString("en-US")],
    ["Title", titleOf(r.body) || "None"],
  ]
  if (prev === undefined) return { run: { at, ms: ms(), status: "quiet", findings: [], facts: [...facts, ["Last changed", "Unknown"]] }, text }
  const c = pageChange(target, prev, text, ignore)
  if (!c) return { run: { at, ms: ms(), status: "quiet", findings: [], facts }, text }
  const sha = createHash("sha256").update(text).digest("hex").slice(0, 10)
  const f: Finding = {
    key: `page:${sha}`,
    level: "news",
    headline: c.headline,
    detail: c.body,
    line: c.line,
    note: c.line,
    fix: "none",
    ev: { diff: c.diff, added: c.added, removed: c.removed, words: c.words, anchors: c.anchors },
  }
  return { run: { at, ms: ms(), status: "news", findings: [f], facts }, text }
}
