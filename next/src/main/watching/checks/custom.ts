import { CUSTOM_SYSTEM, customPrompt, parseCustom, quoteOnPage } from "@shared/watching/read"
import type { Answerer } from "@shared/types"
import type { Finding, Run } from "@shared/watching/types"

import { type AskModel, ModelUnavailable } from "../model"
import type { CheckDeps } from "./deps"
import { loadPage, textOf, unreadable } from "./page"

// Custom: load the page's text, then the watch's model reads it against your sentence once and
// answers in a fixed shape. The quote it relied on must be on the page, or the run counts as failed,
// not news. News is told once, when the answer turns true; a problem stays open while it's true.
// `prev` is the last answer ("met" or "not"), saved by the caller.

export const NO_MODEL = "This watch has no model to read the page."
export const BAD_ANSWER = "The model’s answer couldn’t be read."
export const BAD_QUOTE = "The model quoted words that aren’t on the page."

export async function checkCustom(
  target: string,
  condition: string,
  answerer: Answerer | undefined,
  prev: string | undefined,
  d: Pick<CheckDeps, "fetch" | "now">,
  ask: AskModel | undefined,
): Promise<{ run: Run; memo?: string }> {
  const at = d.now()
  const ms = () => Math.round(d.now() - at)
  const failed = (error: string): { run: Run } => ({ run: { at, ms: ms(), status: "failed", findings: [], error } })
  if (!answerer || !ask) return failed(NO_MODEL)
  const r = await loadPage(target, d)
  if (!r.ok) return failed(r.error)
  const text = r.status < 400 ? textOf(r.body) : ""
  const bad = unreadable(r, text)
  if (bad) return failed(bad)
  let reply: string
  try {
    reply = await ask(answerer, CUSTOM_SYSTEM, customPrompt(condition, text))
  } catch (e) {
    return failed(e instanceof ModelUnavailable ? e.message : BAD_ANSWER)
  }
  const a = parseCustom(reply)
  if (!a) return failed(BAD_ANSWER)
  if (!quoteOnPage(a.quote, text)) return failed(BAD_QUOTE)
  const memo = a.met ? "met" : "not"
  const base = { at, ms: ms(), quote: a.quote, ...(a.state ? { state: a.state } : {}), facts: [] as [string, string][] }
  const finding = (key: string, level: Finding["level"]): Finding => ({
    key,
    level,
    headline: a.headline,
    ...(a.detail ? { detail: a.detail } : {}),
    line: `${a.headline}.`,
    note: a.detail ?? `${a.headline}.`,
    fix: "none",
    ev: { quote: a.quote },
  })
  if (a.met && a.level === "problem") return { run: { ...base, status: "problem", findings: [finding("custom:problem", "problem")], facts: [["Found", a.headline]] }, memo }
  // News only when it turns true: "a seat opened" once, not every hour while it's open.
  if (a.met && prev === "not") return { run: { ...base, status: "news", findings: [finding(`custom:${at}`, "news")], facts: [["Found", a.headline]] }, memo }
  return { run: { ...base, status: "quiet", findings: [], facts: [["Now", a.detail ?? a.headline]] }, memo }
}
