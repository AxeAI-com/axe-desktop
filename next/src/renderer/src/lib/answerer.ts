import type { Answerer, ModelCatalog, ThreadSummary } from "@shared/types"

export const sameAnswerer = (a?: Answerer, b?: Answerer) => {
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  return a.kind === "agent" ? a.agentId === (b as { agentId: string }).agentId : a.modelId === (b as { modelId: string }).modelId
}

export function answererLabel(a: Answerer | undefined, catalog: ModelCatalog | null): string {
  if (!a) return "Auto"
  if (a.kind === "agent") return catalog?.agents.find((x) => x.id === a.agentId)?.name ?? agentName(a.agentId)
  if (a.kind === "local") return catalog?.local.find((m) => m.id === a.modelId)?.name ?? localName(a.modelId)
  return catalog?.axe.models.find((m) => m.id === a.modelId)?.label ?? (a.modelId === "auto" ? "Auto" : a.modelId)
}

/** "Auto, free" under a reply. */
export function answererNote(a: Answerer | undefined, catalog: ModelCatalog | null): string {
  const label = answererLabel(a, catalog)
  if (!a || a.kind !== "axe") return label
  const m = catalog?.axe.models.find((x) => x.id === a.modelId)
  return m?.tier === "free" ? `${label}, free` : label
}

export function agentName(id: string): string {
  const known: Record<string, string> = {
    "claude-code": "Claude Code",
    "claude-acp": "Claude Code",
    codex: "Codex",
    "codex-acp": "Codex",
    gemini: "Gemini CLI",
    "gemini-cli": "Gemini CLI",
  }
  return known[id] ?? id.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

/** "ollama|qwen3:1.7b" → "qwen3:1.7b", for a model whose server isn't running right now. */
export const localName = (id: string) => id.slice(id.indexOf("|") + 1)

export const folderName = (path?: string) => (path ? (path.split(/[\\/]/).filter(Boolean).pop() ?? path) : "")

/** Who answers the next message in a chat, before you pick someone else. */
export function threadAnswerer(thread: ThreadSummary | undefined, fallback: Answerer): Answerer {
  if (thread?.source === "agent" && thread.agentId) return { kind: "agent", agentId: thread.agentId }
  if (thread?.source === "local" && thread.localModel) return fallback.kind === "local" ? fallback : { kind: "local", modelId: thread.localModel }
  return fallback
}
