import type { SessionConfigOption } from "@agentclientprotocol/sdk"

import type { AgentChoice, AgentOption } from "@shared/types"

import { dataPath, readJSON, writeJSON } from "../paths"

// A CLI agent's own model and effort choices (ACP `configOptions`). Claude Code sends `model` and
// `effort` (its effort levels change with the model), Codex `model` and `reasoning_effort` (only
// for some models). Only these two kinds show in the composer; the agent's permission modes go
// through modes.ts, and anything else it offers is left as the agent set it.

/** Which of ours an ACP option is, by its category, else by its id; undefined for the rest. */
export function kindOf(o: Pick<SessionConfigOption, "id" | "category">): AgentOption["kind"] | undefined {
  if (o.category === "model") return "model"
  if (o.category === "thought_level") return "effort"
  if (o.category) return undefined
  if (o.id === "model") return "model"
  if (/effort|reasoning|thought/i.test(o.id)) return "effort"
  return undefined
}

/** The agent's model and effort options, select lists only, groups flattened. Model first. */
export function fromACP(options: readonly SessionConfigOption[] | null | undefined): AgentOption[] {
  const out: AgentOption[] = []
  for (const o of options ?? []) {
    const kind = kindOf(o)
    if (!kind || o.type !== "select" || typeof o.currentValue !== "string") continue
    const choices: AgentChoice[] = []
    for (const c of o.options ?? []) {
      if ("group" in c && Array.isArray(c.options)) {
        for (const g of c.options) choices.push(choice(g.value, g.name, g.description, c.name))
      } else if ("value" in c) choices.push(choice(c.value, c.name, c.description))
    }
    if (choices.length) out.push({ id: o.id, name: o.name, kind, current: o.currentValue, choices })
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "model" ? -1 : 1))
}

function choice(value: string, name: string, description?: string | null, group?: string): AgentChoice {
  const c: AgentChoice = { value, name: name || value }
  if (description) c.description = description
  if (group) c.group = group
  return c
}

/** The options with your picks as the current values, where the agent still offers them. */
export function withPicks(options: AgentOption[], picks: Record<string, string> | undefined): AgentOption[] {
  if (!picks) return options
  return options.map((o) => (picks[o.id] && o.choices.some((c) => c.value === picks[o.id]) ? { ...o, current: picks[o.id]! } : o))
}

/** The next pick to send to a running agent: the model before the effort, since effort levels follow the model. */
export function nextToApply(options: AgentOption[], picks: Record<string, string> | undefined): { id: string; value: string } | undefined {
  if (!picks) return undefined
  for (const o of options) {
    const want = picks[o.id]
    if (want && want !== o.current && o.choices.some((c) => c.value === want)) return { id: o.id, value: want }
  }
  return undefined
}

// The last lists each agent sent, so a new chat shows its choices before the agent starts.

const cacheFile = () => dataPath("agent-options.json")
let cache: Record<string, AgentOption[]> | undefined

export function cachedOptions(agentId: string): AgentOption[] {
  cache ??= readJSON<Record<string, AgentOption[]>>(cacheFile(), {})
  return Object.hasOwn(cache, agentId) ? (cache[agentId] ?? []) : []
}

export function rememberOptions(agentId: string, options: AgentOption[]) {
  cache ??= readJSON<Record<string, AgentOption[]>>(cacheFile(), {})
  if (JSON.stringify(cache[agentId] ?? []) === JSON.stringify(options)) return
  cache[agentId] = options
  writeJSON(cacheFile(), cache)
}

export function resetOptionsCacheForTests() {
  cache = undefined
}
