import type { Helper } from "./types"

// Shared by the engine (adding a wshobson/agents agent) and the window (its card's mark).

const KIND_WORDS: [Helper["kind"], RegExp][] = [
  ["design", /design|ui|ux|accessib|frontend-mobile|visual/],
  ["write", /content|marketing|docs|documentation|writ|seo|tutorial/],
  ["research", /research|search|analys|review/],
  ["data", /data|analytics|ml|machine|database|sql|quant|finance/],
  ["support", /support|customer|incident|sales/],
  ["plan", /orchestr|team|business|product|startup|project|agent-/],
]

/** A helper kind from the plugin an agent ships in ("ui-design" → design). */
export function kindOfPlugin(plugin: string): Helper["kind"] {
  for (const [kind, re] of KIND_WORDS) if (re.test(plugin)) return kind
  return "code"
}
