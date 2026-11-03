import type { Answerer, ChatMessage, ContextUsage, ModelCatalog } from "@shared/types"

// The usage ring: how full this chat's context is, from the last reply that reported it.

export type ChatContext = { used: number; size?: number; fraction: number; cost?: ContextUsage["cost"] }

/**
 * The latest reply's usage, sized by what the agent said or by the window of the model you picked
 * (Auto's own window for Auto: it picks a model that fits, so one free model's small cap isn't the limit).
 * A research reply's usage is every call of the run added up, not what the chat now holds: it counts
 * as the context before it plus the report's own length.
 */
export function chatContext(messages: ChatMessage[], catalog: ModelCatalog | null): ChatContext | null {
  let last: { c: ContextUsage; answerer?: Answerer } | null = null
  let held = 0
  for (const m of messages) {
    if (m.role !== "assistant") continue
    if (m.parts.some((p) => p.type === "research")) {
      const report = m.parts.reduce((n, p) => n + (p.type === "text" ? p.text.length : 0), 0)
      if (!report) continue
      last = { c: { used: held + Math.ceil(report / 4), ...(m.context?.modelId ? { modelId: m.context.modelId } : {}) }, answerer: m.answerer }
    } else if (m.context) last = { c: m.context, answerer: m.answerer }
    else continue
    held = last.c.used
  }
  if (!last) return null
  const { c } = last
  const size = c.size ?? windowOf(axeModel(last.answerer) ?? c.modelId, catalog) ?? windowOf(c.modelId, catalog)
  return { used: c.used, ...(size ? { size } : {}), fraction: size ? Math.min(1, c.used / size) : 0, ...(c.cost ? { cost: c.cost } : {}) }
}

const axeModel = (a?: Answerer) => (a?.kind === "axe" ? a.modelId : undefined)

function windowOf(modelId: string | undefined, catalog: ModelCatalog | null): number | undefined {
  if (!modelId) return undefined
  return catalog?.axe.models.find((m) => m.id === modelId)?.contextWindow
}

/** 840 → "840", 12_400 → "12.4K", 1_000_000 → "1M". */
export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}K`
  }
  const mm = n / 1_000_000
  return `${mm < 10 ? mm.toFixed(1).replace(/\.0$/, "") : Math.round(mm)}M`
}

export function money(c: { amount: number; currency: string }): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: c.currency, maximumFractionDigits: 2 }).format(c.amount)
  } catch {
    return `${c.amount.toFixed(2)} ${c.currency}`
  }
}

/** Millicredits to the credits people see ("about 3 credits"). */
export const credits = (milli: number) => Math.max(1, Math.round(milli / 1000))
