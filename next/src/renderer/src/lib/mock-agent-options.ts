import type { AgentOption } from "@shared/types"

// Model and effort lists for the mock bridge, as Claude Code and Codex send them (their own names).

const CLAUDE: AgentOption[] = [
  {
    id: "model",
    name: "Model",
    kind: "model",
    current: "default",
    choices: [
      { value: "default", name: "Default (recommended)", description: "Opus 5.5" },
      { value: "fable", name: "Fable 5.1", description: "Most capable for your hardest and longest-running tasks" },
      { value: "sonnet", name: "Sonnet 5.5", description: "Efficient for routine tasks" },
      { value: "haiku", name: "Haiku 5.5", description: "Fastest for quick answers" },
    ],
  },
  {
    id: "effort",
    name: "Effort",
    kind: "effort",
    current: "default",
    choices: ["Default", "Low", "Medium", "High", "Xhigh", "Max"].map((name) => ({ value: name.toLowerCase(), name })),
  },
]

const CODEX: AgentOption[] = [
  {
    id: "model",
    name: "Model",
    kind: "model",
    current: "gpt-5.6-luna",
    choices: [
      { value: "gpt-5.6-sol", name: "5.6 Sol" },
      { value: "gpt-6-luna", name: "6 Luna" },
      { value: "gpt-5.6-luna", name: "5.6 Luna" },
    ],
  },
  {
    id: "reasoning_effort",
    name: "Reasoning effort",
    kind: "effort",
    current: "medium",
    choices: ["Low", "Medium", "High"].map((name) => ({ value: name.toLowerCase(), name })),
  },
]

/** Picks per chat ("draft:<agent>" for a new chat), applied to the agent's lists. */
export function mockAgentOptions(on: boolean) {
  const picks: Record<string, Record<string, string>> = {}
  const lists = (agentId: string) => (!on ? [] : agentId === "codex" ? CODEX : agentId === "claude-code" ? CLAUDE : [])
  const view = (key: string, agentId: string): AgentOption[] =>
    lists(agentId).map((o) => ({ ...o, current: picks[key]?.[o.id] ?? picks[`draft:${agentId}`]?.[o.id] ?? o.current }))
  return {
    options: (threadId: string | null, agentId: string) => view(threadId ?? `draft:${agentId}`, agentId),
    set(threadId: string | null, agentId: string, configId: string, value: string) {
      for (const key of [threadId ?? `draft:${agentId}`, `draft:${agentId}`]) picks[key] = { ...picks[key], [configId]: value }
      return view(threadId ?? `draft:${agentId}`, agentId)
    },
  }
}
