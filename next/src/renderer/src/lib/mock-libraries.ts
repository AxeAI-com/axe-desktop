// The libraries in the mock engine (lib/mock-bridge.ts): skills, agents and connectors for
// working on the pages in a plain browser and for the screenshot tests.
//
// URL options: ?mock=nolibrary (nothing installed, connected or made yet), ?mock=signin (connecting
// waits on the browser until you cancel).

import type { Commands, Events } from "@shared/api"
import { CATALOG } from "@shared/connectors"
import { STARTER_HELPERS } from "@shared/starter-helpers"
import { STARTER_SKILLS } from "@shared/starter-skills"
import type { CommunityAgent, CommunitySkill, Connector, ConnectorsView, Helper, Skill, SkillLibrary } from "@shared/types"

type LibraryCommand = Extract<keyof Commands, `skills:${string}` | `helpers:${string}` | `connectors:${string}` | `community:${string}`>
type Handlers = { [K in LibraryCommand]: (...args: Parameters<Commands[K]>) => Awaited<ReturnType<Commands[K]>> | Promise<Awaited<ReturnType<Commands[K]>>> }

const describe = (text: string) => /\ndescription: (.*)\n/.exec(text)?.[1] ?? ""

const TARGETS: SkillLibrary["targets"] = [
  { id: "axe", name: "Axe", path: "/Users/mia/Library/Application Support/Axe AI/skills" },
  { id: "claude", name: "Claude Code", path: "/Users/mia/.claude/skills" },
  { id: "codex", name: "Codex", path: "/Users/mia/.codex/skills" },
]

const YOURS = `---\nname: pricing-page\ndescription: Write pricing page copy that sells what people get, not the price.\n---\n\n# Pricing page\n\nLead with the outcome for each plan. Three lines per plan. No discounts in the headline.\n`

// The open-source libraries, as the engine lists them (a few of each).
const gh = (repo: string, path: string) => `https://github.com/${repo}/tree/HEAD/${path}`
const COMMUNITY_SKILLS: CommunitySkill[] = [
  { key: "superpowers/brainstorming", name: "Brainstorming", description: "Turns a rough idea into a design through questions, before any code.", source: "superpowers", repo: "obra/superpowers", path: "skills/brainstorming", url: gh("obra/superpowers", "skills/brainstorming") },
  { key: "superpowers/test-driven-development", name: "Test driven development", description: "Write the test first, watch it fail, then write the code.", source: "superpowers", repo: "obra/superpowers", path: "skills/test-driven-development", url: gh("obra/superpowers", "skills/test-driven-development") },
  { key: "superpowers/systematic-debugging", name: "Systematic debugging", description: "Find the root cause before changing anything.", source: "superpowers", repo: "obra/superpowers", path: "skills/systematic-debugging", url: gh("obra/superpowers", "skills/systematic-debugging") },
  { key: "voltagent/anthropics/docx", name: "Docx", description: "Create, edit, and analyze Word documents", source: "voltagent", category: "Official: Claude", repo: "anthropics/skills", skill: "docx", url: "https://officialskills.sh/anthropics/skills/docx" },
  { key: "voltagent/stripe/stripe-best-practices", name: "Stripe best practices", description: "Build payments the way Stripe recommends", source: "voltagent", category: "Official: Stripe", repo: "stripe/ai", skill: "stripe-best-practices", url: "https://officialskills.sh/stripe/ai/stripe-best-practices" },
  { key: "voltagent/AgriciDaniel/claude-seo", name: "Claude SEO", description: "Universal SEO skill for comprehensive website analysis and optimization", source: "voltagent", category: "Marketing", repo: "AgriciDaniel/claude-seo", url: "https://github.com/AgriciDaniel/claude-seo" },
]
const COMMUNITY_AGENTS: CommunityAgent[] = [
  { key: "wshobson/backend-development/backend-architect", name: "Backend architect", description: "Designs APIs, services and data models that scale.", plugin: "backend-development", path: "plugins/backend-development/agents/backend-architect.md", url: "https://github.com/wshobson/agents" },
  { key: "wshobson/code-review-ai/architect-review", name: "Architect review", description: "Reviews changes for architecture and design problems.", plugin: "code-review-ai", path: "plugins/code-review-ai/agents/architect-review.md", url: "https://github.com/wshobson/agents" },
  { key: "wshobson/seo-content-creation/seo-content-writer", name: "SEO content writer", description: "Writes pages that rank and read well.", plugin: "seo-content-creation", path: "plugins/seo-content-creation/agents/seo-content-writer.md", url: "https://github.com/wshobson/agents" },
  { key: "wshobson/ui-design/ui-designer", name: "UI designer", description: "Designs clean interfaces with a clear hierarchy.", plugin: "ui-design", path: "plugins/ui-design/agents/ui-designer.md", url: "https://github.com/wshobson/agents" },
]

export function mockLibraries(scenario: string | null, emit: <K extends keyof Events>(e: K, p: Events[K]) => void) {
  const empty = scenario === "nolibrary"

  const installed: Record<string, Skill["installedIn"]> = empty ? {} : { "brand-voice": ["axe", "claude"], "meeting-notes": ["axe"], "pricing-page": ["axe"], "release-notes": ["claude"] }
  const skills = (): SkillLibrary => ({
    targets: TARGETS,
    skills: [
      ...STARTER_SKILLS.map((s) => ({ id: s.id, name: s.id, description: describe(s.text), source: "starter" as const, category: s.category, installedIn: installed[s.id] ?? [] })),
      ...(empty
        ? []
        : [
            { id: "pricing-page", name: "pricing-page", description: describe(YOURS), source: "yours" as const, installedIn: installed["pricing-page"] ?? [] },
            { id: "release-notes", name: "release-notes", description: "Turn merged pull requests into release notes.", source: "cli" as const, installedIn: installed["release-notes"] ?? [] },
          ]),
    ],
  })

  let helpers: Helper[] = [
    ...STARTER_HELPERS.map((h) => (h.answerer?.kind === "agent" ? { ...h, answerer: { kind: "agent" as const, agentId: "claude-code" } } : h)),
    ...(empty
      ? []
      : [
          {
            id: "h-support",
            name: "Support replies",
            role: "Answers customer emails from our docs",
            kind: "support" as const,
            instructions: "Answer from the help docs. Warm and short. Never promise refunds; hand those to Mia.",
            answerer: { kind: "axe" as const, modelId: "sonnet-5.5" },
            skills: ["email-reply"],
            connectors: ["c-notion"],
            webSearch: false,
          },
        ]),
  ]

  const tools = (n: number, names: string[]) => [...names, ...Array.from({ length: Math.max(0, n - names.length) }, (_, i) => `tool_${i}`)]
  let connected: Connector[] = empty
    ? []
    : [
        { id: "c-notion", name: "Notion", catalogId: "notion", url: "https://mcp.notion.com/mcp", enabled: true, state: "connected", tools: tools(14, ["search", "fetch", "create-pages"]) },
        { id: "c-linear", name: "Linear", catalogId: "linear", url: "https://mcp.linear.app/mcp", enabled: true, state: "connected", tools: tools(21, ["list_issues"]) },
        { id: "c-wiki", name: "Team wiki", command: "npx", args: ["-y", "wiki-mcp"], enabled: false, state: "connected", tools: [] },
      ]
  const view = (): ConnectorsView => ({ catalog: CATALOG, connected })
  let cancel: (() => void) | null = null
  let n = 0

  const handlers: Handlers = {
    "skills:list": () => skills(),
    "skills:read": (id) => STARTER_SKILLS.find((s) => s.id === id)?.text ?? (id === "pricing-page" ? YOURS : `---\nname: ${id}\n---\n\nInstructions.`),
    "skills:install": (id, targets) => {
      installed[id] = ["axe", ...(targets as Skill["installedIn"])]
      return skills()
    },
    "skills:uninstall": (id) => {
      installed[id] = (installed[id] ?? []).filter((t) => t !== "axe" && id !== "brand-voice" && id !== "meeting-notes")
      return skills()
    },
    "skills:create": ({ name }) => {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      if (!id) throw new Error("Give the skill a name.")
      installed[id] = ["axe"]
      return skills()
    },
    "skills:import": () => skills(),

    "community:skills": () => COMMUNITY_SKILLS,
    "community:skillText": (key) => `---\nname: ${key.split("/").pop()}\n---\n\n# ${key}\n\nAsk one question at a time. Say what you heard before moving on.`,
    "community:installSkill": (key, targets) => {
      installed[key.split("/").pop()!] = ["axe", ...(targets as Skill["installedIn"])]
      return skills()
    },
    "community:agents": () => COMMUNITY_AGENTS,
    "community:agentText": () => "You design backend systems. Start from the data, then the API, then the services.",
    "community:addAgent": (key) => {
      const a = COMMUNITY_AGENTS.find((x) => x.key === key)!
      helpers = [...helpers, { id: `h-new-${++n}`, name: a.name, role: a.description, instructions: "From the library.", kind: "code", skills: [], connectors: [], webSearch: false }]
      return helpers
    },
    "helpers:list": () => helpers,
    "helpers:save": (h) => {
      if (!h.name.trim()) throw new Error("Give the agent a name.")
      if (!h.instructions.trim()) throw new Error("Write what it should do.")
      const id = h.id && !h.starter ? h.id : `h-new-${++n}`
      const next: Helper = { ...h, id, starter: undefined } as Helper
      helpers = helpers.some((x) => x.id === id) ? helpers.map((x) => (x.id === id ? next : x)) : [...helpers, next]
      return helpers
    },
    "helpers:delete": (id) => {
      helpers = helpers.filter((h) => h.id !== id)
      return helpers
    },

    "connectors:list": () => view(),
    "connectors:connect": (catalogId) =>
      new Promise((resolve, reject) => {
        const entry = CATALOG.find((c) => c.id === catalogId)!
        const id = `c-${catalogId}`
        connected = [...connected.filter((c) => c.id !== id), { id, name: entry.name, catalogId, url: entry.url, enabled: true, state: "signin", tools: [] }]
        emit("connectors", view())
        const finish = setTimeout(
          () => {
            connected = connected.map((c) => (c.id === id ? { ...c, state: "connected", tools: tools(9, ["search"]) } : c))
            emit("connectors", view())
            cancel = null
            resolve(view())
          },
          scenario === "signin" ? 600_000 : 1500,
        )
        cancel = () => {
          clearTimeout(finish)
          connected = connected.filter((c) => c.id !== id)
          emit("connectors", view())
          reject(new Error("Cancelled."))
        }
      }),
    "connectors:cancel": () => {
      cancel?.()
      cancel = null
    },
    "connectors:addCustom": (c) => {
      if (!c.name.trim()) throw new Error("Give it a name.")
      connected = [...connected, { id: `c-own-${++n}`, name: c.name.trim(), ...(c.url ? { url: c.url } : { command: c.command, args: c.args }), enabled: true, state: "connected", tools: tools(4, []) }]
      return view()
    },
    "connectors:setEnabled": (id, enabled) => {
      connected = connected.map((c) => (c.id === id ? { ...c, enabled } : c))
      return view()
    },
    "connectors:remove": (id) => {
      connected = connected.filter((c) => c.id !== id)
      return view()
    },
  }

  return { handlers }
}
