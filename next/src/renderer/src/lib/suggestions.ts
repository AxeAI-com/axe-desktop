// The four cards under a new chat's box. Each shows one thing Axe does and starts it, picked by what
// you can use right now: signed in or not, and whether a CLI agent is ready on this computer.

export type SuggestionId = "fix" | "plan" | "research" | "doit" | "watch" | "skill" | "install" | "signin"

export function pickSuggestions({ signedIn, agentReady }: { signedIn: boolean; agentReady: boolean }): SuggestionId[] {
  if (signedIn) return agentReady ? ["fix", "research", "doit", "skill"] : ["install", "research", "doit", "skill"]
  return agentReady ? ["fix", "plan", "skill", "watch"] : ["install", "signin", "plan", "watch"]
}

/** What each card says. `agent` and `folder` fill in the agent card. */
export function suggestionText(id: SuggestionId, agent = "Your CLI", folder?: string): { title: string; note: string } {
  switch (id) {
    case "fix":
      return { title: "Fix what's failing", note: `${agent} fixes failing tests${folder ? ` in ${folder}` : ""}.` }
    case "plan":
      return { title: "Plan before it builds", note: "It plans first. You approve, then it builds." }
    case "research":
      return { title: "Research with sources", note: "A cited report from the web." }
    case "doit":
      return { title: "Use this computer", note: "Files, apps, browser. Asks first." }
    case "watch":
      return { title: "Watch a site", note: "Tells you only when something’s wrong." }
    case "skill":
      return { title: "Use a skill", note: "Type / to pick one." }
    case "install":
      return { title: "Add a CLI agent", note: "Claude Code, Codex or Gemini, on your own plan." }
    case "signin":
      return { title: "Sign in to Axe AI", note: "Adds research and Axe's own chat." }
  }
}
