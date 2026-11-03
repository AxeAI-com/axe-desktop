import type { Answerer, CatalogConnector, CommunitySkill, Helper, LocalAgent, Skill } from "@shared/types"

// An agent from one sentence, built on this computer with no model call: what to do, who does it (a CLI
// in a folder for code or a folder you named, else Axe), the apps it names, and the skills whose words
// match the job best.

export type DraftSkill = { name: string; source: string; id?: string; key?: string }
export type DraftConnector = { name: string; catalogId: string; id?: string }

export type AgentDraft = {
  name: string
  role: string
  instructions: string
  answerer: Answerer
  cwd?: string
  kind: Helper["kind"]
  skills: DraftSkill[]
  connectors: DraftConnector[]
}

const CODE = /\b(code|coding|repo|repository|pull requests?|prs?|branch(es)?|commits?|tests?|bugs?|deploy|refactor|lint|build|typescript|javascript|python|swift|api|endpoint)\b/i

const STOP = new Set(
  "a an the and or but to of in on at for with by from my our your me us it its this that these those is are be do does every each day days week weeks morning evening night weekday weekdays daily weekly monthly hour hours minute minutes am pm then when what tell show me please new open".split(
    " ",
  ),
)

/** The words that carry the job, for matching skills. */
export const jobWords = (text: string) => [...new Set(text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [])].filter((w) => !STOP.has(w))

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "review my open pull requests in axe-web and tell me what to fix" → "Review pull requests". */
export function nameFrom(task: string): string {
  const first = task.split(/,|;|\.| and | then /i)[0]!.trim()
  const all = first.split(/\s+/).filter((w) => !/^(my|our|the|please|all|open|new)$/i.test(w))
  // Stop at where or for whom ("in axe-web", "on GitHub"): the name is the job.
  const stop = all.findIndex((w, i) => i >= 2 && /^(in|on|for|from|at|to|with|into)$/i.test(w))
  const words = all.slice(0, stop > 0 ? stop : 4).slice(0, 4)
  return cap(words.join(" ").replace(/[^\w\s'-]/g, "").trim()) || "New agent"
}

const KINDS: [Helper["kind"], RegExp][] = [
  ["code", CODE],
  ["research", /\b(research|find out|look up|sources?|compare)\b/i],
  ["write", /\b(write|draft|post|email|blog|copy|newsletter)\b/i],
  ["data", /\b(numbers|metrics|revenue|spreadsheet|report|sum up|summari[sz]e)\b/i],
  ["support", /\b(support|customers?|tickets?|replies|inbox)\b/i],
  ["plan", /\b(plan|schedule|launch|roadmap)\b/i],
]

export function draftAgent(
  text: string,
  o: {
    agents: LocalAgent[]
    signedIn: boolean
    recentFolders: string[]
    lastFolder?: string
    catalog: CatalogConnector[]
    connected: { id: string; catalogId?: string; name: string }[]
    installed: Skill[]
    community: CommunitySkill[]
  },
): AgentDraft {
  const sentence = text.replace(/\s+/g, " ").trim()
  const task = sentence.replace(/[.\s]+$/, "")
  const lower = sentence.toLowerCase()

  // A folder you named by its last part ("axe-web"), or a path you typed.
  const typedPath = /(?:^|\s)@?((?:~|\/)[\w~/.-]+)/.exec(sentence)?.[1]
  const named = o.recentFolders.find((p) => {
    const base = p.split("/").pop()!.toLowerCase()
    return base.length > 2 && new RegExp(`(^|[^\\w-])${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`).test(lower)
  })
  // "~/Code/axe-web" is one of your folders when it ends the same way (the window doesn't know your home).
  const typed = typedPath?.startsWith("~") ? o.recentFolders.find((p) => p.endsWith(typedPath.slice(1))) : typedPath
  const folder = typed ?? named
  const cli = o.agents.find((a) => a.state === "ready" && /claude/i.test(a.id)) ?? o.agents.find((a) => a.state === "ready")
  const wantsCli = !!cli && (CODE.test(sentence) || !!folder || !o.signedIn)
  const answerer: Answerer = wantsCli && cli ? { kind: "agent", agentId: cli.id } : { kind: "axe", modelId: "auto" }

  const connectors = o.catalog
    .filter((c) => new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence))
    .map((c) => {
      const mine = o.connected.find((x) => x.catalogId === c.id || x.name.toLowerCase() === c.name.toLowerCase())
      return { name: c.name, catalogId: c.id, ...(mine ? { id: mine.id } : {}) }
    })

  // Skills: the most job words in the name and description; your own first on a tie.
  const words = jobWords(task)
  const score = (s: string) => words.filter((w) => s.toLowerCase().includes(w)).length
  const pool: (DraftSkill & { score: number; mine: boolean })[] = [
    ...o.installed.map((s) => ({ name: s.name, source: "Yours", id: s.id, score: score(`${s.name} ${s.description}`), mine: true })),
    ...o.community.map((s) => ({ name: s.name, source: s.source === "superpowers" ? "Superpowers" : s.repo.split("/")[0]!, key: s.key, score: score(`${s.name} ${s.description}`), mine: false })),
  ]
  const skills = pool
    .filter((s) => s.score >= 2 || (s.score >= 1 && words.length <= 3))
    .sort((a, b) => b.score - a.score || Number(b.mine) - Number(a.mine))
    .filter((s, i, all) => all.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === i)
    .slice(0, 3)
    .map(({ name, source, id, key }) => ({ name, source, ...(id ? { id } : {}), ...(key ? { key } : {}) }))

  return {
    name: nameFrom(task),
    role: cap(task),
    instructions: `${cap(task)}.`,
    answerer,
    ...(answerer.kind === "agent" ? { cwd: folder ?? o.lastFolder } : {}),
    kind: KINDS.find(([, re]) => re.test(sentence))?.[0] ?? "custom",
    skills,
    connectors,
  }
}
