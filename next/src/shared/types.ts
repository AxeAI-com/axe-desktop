import type { RichBlock } from "./rich"

// Shapes shared by the engine (main process) and the window. Axe API shapes mirror
// packages/contracts in axe-web.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type Profile = {
  id?: string
  email: string
  name?: string
  plan?: string
  credits?: number
  image?: string
}

export type AxeModel = {
  id: string
  label: string
  provider: string
  tier: "free" | "paid"
  description?: string | null
  webSearch: boolean
  vision: boolean
  reasoning: boolean
  /** Tokens it can hold at once (the usage ring's full circle). */
  contextWindow?: number
}

/** A CLI agent on this computer (Claude Code, Codex, Gemini CLI, …), found through the ACP registry. */
export type LocalAgent = {
  id: string
  name: string
  /** One line under the name: "Works in your folders and terminal". */
  note: string
  icon?: string
  /** ready: can chat now; install: not on this computer yet; unavailable: missing Node or similar. */
  state: "ready" | "install" | "unavailable"
  /** Why it is unavailable, in plain words. */
  reason?: string
  /** Its CLI (or downloaded app) is on this computer, not just runnable through npx or uvx. */
  here?: boolean
}

/** Who answers: one of Axe's models, a CLI agent on this computer, or a model a local server runs. */
export type Answerer = { kind: "axe"; modelId: string } | { kind: "agent"; agentId: string } | { kind: "local"; modelId: string }

/** A model a server on this computer (or the user's network) runs: Ollama, LM Studio, llama.cpp, or one they added. */
export type LocalModel = {
  /** "<server id>|<model name>". */
  id: string
  /** The server's own name for it ("qwen3:1.7b"). */
  model: string
  /** For people: "Qwen3 1.7B". */
  name: string
  serverId: string
  /** "Ollama", "LM Studio", "llama.cpp", or the name of one the user added. */
  serverName: string
  /** Bytes on disk, when the server says. */
  size?: number
  /** Can call tools (Do it, connectors). Unknown when the server doesn't say: Axe tries. */
  tools?: boolean
  /** Can see images. Unknown when the server doesn't say. */
  vision?: boolean
}

/** A model server: the three Axe looks for by itself, and any the user added by address. */
export type ModelServer = {
  id: string
  name: string
  url: string
  /** Running right now (checked each time the list is read). */
  found: boolean
  models: LocalModel[]
  /** Added by the user (can be removed); the others are looked for by themselves. */
  custom?: boolean
  /** A key is saved for it. */
  hasKey?: boolean
  /** Ollama: on this computer but not running, so Axe can start it (its models are read from disk). */
  canStart?: boolean
  /** Ollama: Axe started it, and stops it when Axe quits. */
  startedByAxe?: boolean
  /** Ollama: models that fit this computer's memory and use tools, for "Get a model". */
  suggested?: string[]
}

/** A model downloading into Ollama: Ollama's step in plain words, and bytes so far. */
export type ModelPull = { model: string; status: string; completed?: number; total?: number }

export type ModelCatalog = {
  axe: { defaultModelId: string; models: AxeModel[] }
  agents: LocalAgent[]
  /** Models on running local servers, smallest first. */
  local: LocalModel[]
  servers: ModelServer[]
}

/** A chat in the sidebar. Axe chats live on axeai.com; agent chats live on this computer. */
export type ThreadSummary = {
  id: string
  /** local: a chat with a model on a local server, kept on this computer. */
  source: "axe" | "agent" | "local"
  /** For local chats: the model's id. */
  localModel?: string
  /** For agent chats: which CLI. */
  agentId?: string
  /** For agent chats: the folder it works in. */
  cwd?: string
  title: string
  pinned: boolean
  updatedAt: string
  /** Working right now (the sidebar shows the dots). */
  running?: boolean
  /** The agent from the library it was started with. */
  helperId?: string
  /** Connectors switched on for this chat (Axe models run their tools through the app). */
  connectors?: string[]
  /** Agent chats: how much it may do on its own. */
  mode?: AgentMode
  /** Agent chats that work in their own copy of the folder. */
  copy?: FolderCopy
  /** A fix started from this watch: it shows in the watch's thread, never in Recents. */
  watchId?: string
}

/**
 * How much a CLI agent may do on its own. ask: it asks before changes; acceptEdits: it edits files
 * freely and asks before commands; plan: it reads and plans, nothing changes until you start;
 * full: it acts without asking.
 */
export type AgentMode = "ask" | "acceptEdits" | "plan" | "full"

/**
 * One of a CLI agent's own choices, from ACP `configOptions`: its model or its effort (thinking
 * level). Lists, names and values are the agent's own; groups are flattened into `group`.
 */
export type AgentChoice = { value: string; name: string; description?: string; group?: string }
export type AgentOption = { id: string; name: string; kind: "model" | "effort"; current: string; choices: AgentChoice[] }

/** A copy of a folder an agent chat works in, so several can run side by side. */
export type FolderCopy = {
  /** worktree: a git worktree on its own branch; copy: a plain copy of the folder. */
  kind: "worktree" | "copy"
  /** The folder it was copied from. */
  source: string
  /** Worktrees: the branch it works on. */
  branch?: string
}

/** A file an agent changed in a chat: how it was before its first change, and how it is now. */
export type FileChange = {
  path: string
  /** Relative to the chat's folder. */
  rel: string
  /** null: the file wasn't there before (before) or is gone now (after). */
  before: string | null
  after: string | null
  /** Not text, or too big to show: only Keep and Undo. */
  binary?: boolean
}

export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other"
/** declined: you said no when it asked first. */
export type ToolState = "running" | "done" | "failed" | "declined"

export type Part =
  | { type: "text"; id: string; text: string }
  | { type: "reasoning"; id: string; text: string; done: boolean; seconds?: number }
  | { type: "source"; id: string; title: string; url: string }
  | {
      type: "tool"
      id: string
      /** Plain words: "Read upload.test.ts", "Searched the web". */
      title: string
      kind: ToolKind
      state: ToolState
      /** What it ran or touched: a command, a path, a query. */
      input?: string
      /** A short look at the result. */
      output?: string
      /** File edits, for the diff view. */
      diff?: { path: string; before?: string; after: string }[]
    }
  | {
      type: "plan"
      id: string
      entries: { text: string; status: "pending" | "running" | "done" }[]
      /** A plan made in Plan mode: its opening line, and the whole plan as Markdown. */
      summary?: string
      text?: string
      /** proposed: waiting for Start; started: you started it and it is now the to-do list. */
      stage?: "proposed" | "started"
    }
  | { type: "error"; id: string; text: string }
  /** A card from one of the website's tools (show_map, draft_email); see shared/rich.ts. */
  | { type: "rich"; id: string; block: RichBlock }
  /** A research run: what it is doing, then the record of what it did. The report itself is the text parts. */
  | { type: "research"; id: string; data: ResearchData }
  /** Paid models ask before a research run spends credits. */
  | { type: "researchApproval"; id: string; data: ResearchApproval }

// Research (mirrors packages/contracts chat-research.ts in axe-web).

export type ResearchStep = {
  id: string
  kind: "plan" | "search" | "read" | "write"
  /** "Searching for" */
  verb: string
  /** A query or a site. */
  target?: string
  detail?: string
  status: "running" | "complete" | "failed"
  startedAt: number
  endedAt?: number
}

export type ResearchSource = { n: number; title: string; url: string; site: string; snippet: string; read: boolean }

export type ResearchData = {
  status: "running" | "complete" | "failed"
  queries: string[]
  steps: ResearchStep[]
  sources: ResearchSource[]
  startedAt: number
  endedAt?: number
}

export type ResearchApproval = {
  status: "pending" | "cancelled" | "approved"
  searches: number
  pages: number
  /** Rough cost in millicredits. */
  estimate: number
  modelId: string
}

/** How full a chat's context is, from the last reply. */
export type ContextUsage = {
  /** Tokens in the context now. */
  used: number
  /** The model's window, when the answerer reports it (CLI agents do; Axe replies use the catalog). */
  size?: number
  /** Axe replies: the model that answered (Auto names the one it picked), for its window. */
  modelId?: string
  /** CLI agents: what the session has cost on your own plan so far. */
  cost?: { amount: number; currency: string }
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  parts: Part[]
  /** Who answered (assistant) or was asked (user); a change between turns shows a divider. */
  answerer?: Answerer
  createdAt?: string
  /** Files sent with a user message (path is empty for files that live on axeai.com). */
  attachments?: Attachment[]
  /** Assistant replies: how full the chat's context was after this reply. */
  context?: ContextUsage
}

export type Attachment = {
  path: string
  name: string
  mime: string
  size: number
  /** Images: a small data-URL thumbnail for the window. Never sent to the server or an agent. */
  preview?: string
}

export type SendRequest = {
  /** null starts a new chat. */
  threadId: string | null
  text: string
  answerer: Answerer
  attachments?: Attachment[]
  /** Axe models only: let it search the web when it helps. */
  webSearch?: boolean
  /** Agent chats only: the folder it works in (new chats). */
  cwd?: string
  /** Axe models only: work on this computer (files, terminal, its own browser, other apps). */
  doIt?: boolean
  /** Axe models only: run deep research and answer with a cited report. */
  research?: boolean
  /** New agent chats: how much it may do on its own (Ask when missing). */
  mode?: AgentMode
  /** New agent chats: work in a copy of the folder (a git worktree when it's a repo). */
  copy?: boolean
  /** Don't make this send's answerer and mode the default for new chats (sends from a paired phone). */
  keepDefaults?: boolean
  /** The id the window gave your message, so it can point at it later (rewind). */
  messageId?: string
  /** New chats: start it with this agent from the library. */
  helperId?: string
  /** Connectors on for this chat (by connector id); the chat keeps the choice. */
  connectors?: string[]
  /** New chats: this is a page's own chat, so it can read and change that page. */
  pageId?: string
  /** New chats: a fix started from this watch (hidden from Recents). */
  watchId?: string
  /** Background for the model only (a page's numbers): sent with the message, never shown in the chat. */
  context?: string
  /** New chats: their name. */
  title?: string
}

/** A live reply as it streams. `done` once finished; `startedAt` drives the seconds counter. */
export type ReplyUpdate = { threadId: string; message: ChatMessage; done: boolean; startedAt: number; error?: string }

/** A CLI agent asking before it acts. */
export type PermissionRequest = {
  id: string
  threadId: string
  title: string
  detail?: string
  options: { id: string; label: string; kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" }[]
  /** Plan mode: the agent asks to start on this plan (the plan card with that id shows Start and Change). */
  plan?: { partId: string }
  /** The agent's step this asks about: the card stands in for that step's row while it waits. */
  toolCallId?: string
}

export type Theme = "system" | "light" | "dark"

export type Settings = {
  baseURL: string
  theme: Theme
  /** The answerer you used last (picked or sent with), reused for new chats in every window. */
  answerer?: Answerer
  /** The agent mode you used last, reused for new agent chats. */
  mode?: AgentMode
  /** Each CLI agent's model and effort you picked last (option id to value), reused for its new chats. */
  agentConfig?: Record<string, Record<string, string>>
  sidebarWidth: number
  /** Do it and agents act without asking first (protected folders still ask). Only you can turn it on. */
  fullAccess?: boolean
  /** The quick bar's global shortcut, as an Electron accelerator ("Alt+Space"). */
  quickBarKey: string
  /** When to keep this computer awake (default: while something runs). */
  keepAwake?: KeepAwakeMode
  /** Remote control from axeai.com (default on once signed in). */
  remoteEnabled?: boolean
  /** Let my phone use this Mac (remote control from a paired phone). Off until you turn it on. */
  phoneEnabled?: boolean
  /** Skills switched off: kept on disk, left out of the / menu and of agents' chats. */
  offSkills?: string[]
  /** Start Ollama when Axe opens (when it's on this computer and not running). */
  startOllama?: boolean
  /** Model servers the user added by address (keys live in the secret store). */
  modelServers?: { id: string; name: string; url: string }[]
  /** Who new boards check with; unset (null clears it) means the smallest local model, when there is one. */
  boardAnswerer?: Answerer | null
  /** Settings, Notifications: watch notifications (default on). */
  watchNotify?: boolean
  /** Settings, Notifications: when the morning summary shows (default 8:00 am). */
  summaryAt?: "7:00" | "8:00" | "9:00" | "off"
}

/** Something Axe remembers about you, sent with new chats. */
export type MemoryItem = { id: string; text: string; createdAt: string; updatedAt: string }

/** A line in the composer's / menu. */
export type SlashCommand = {
  /** Without the slash. */
  name: string
  description: string
  /** axe: Axe's own starters; agent: the CLI advertised it; skill: a skill folder the CLI reads (or one installed in Axe); helper: one of your agents. */
  source: "axe" | "agent" | "skill" | "helper"
  /** What to type after it, when it takes something. */
  hint?: string
}

/** A CLI's own instructions file in a chat's folder (CLAUDE.md, AGENTS.md, GEMINI.md). */
export type InstructionsFile = { name: string; path: string; exists: boolean }

// Libraries: skills, agents, connectors and projects (slice 4, package G).

/** Where a skill can be installed: Axe itself, or a CLI's own skills folder in your home. */
export type SkillTarget = { id: "axe" | "claude" | "codex" | "gemini" | "agents"; name: string; path: string }

/** A skill: a folder with a SKILL.md (the open Agent Skills format). */
export type Skill = {
  /** The folder name, also the / command. */
  id: string
  name: string
  description: string
  /** starter: written by Axe; yours: one you made or imported; cli: found in a CLI's folder. */
  source: "starter" | "yours" | "cli"
  category?: string
  /** The targets it is installed in (by SkillTarget id). Empty: not installed. */
  installedIn: SkillTarget["id"][]
}

export type SkillLibrary = { skills: Skill[]; targets: SkillTarget[] }

/** Open-source skill libraries the Skills page lists: obra/superpowers and VoltAgent's index. */
export type CommunitySkillSource = "superpowers" | "voltagent"

/** A skill from an open-source library, not on this computer yet. */
export type CommunitySkill = {
  /** Stable across refreshes: "superpowers/brainstorming", "voltagent/anthropics/docx". */
  key: string
  name: string
  description: string
  source: CommunitySkillSource
  /** The index's section ("Marketing", "Official: Stripe"). */
  category?: string
  /** Where the skill lives on GitHub ("owner/repo"), its folder when known, or the skill's name to look for. */
  repo: string
  path?: string
  skill?: string
  /** The page to read it on. */
  url: string
}

/** An agent from wshobson/agents (a Markdown file with instructions), not in your library yet. */
export type CommunityAgent = {
  key: string
  name: string
  description: string
  /** The plugin it ships in ("backend-development"), used as its category. */
  plugin: string
  path: string
  url: string
}

/** A ready-made helper from the agents library: its own instructions, who answers, and its tools. */
export type Helper = {
  id: string
  name: string
  /** One line under the name. */
  role: string
  instructions: string
  /** Who answers; unset uses your default. */
  answerer?: Answerer
  /** Skill ids it uses (their instructions go with its chats). */
  skills: string[]
  /** Connector ids it switches on. */
  connectors: string[]
  /** Axe models: search the web when it helps. */
  webSearch: boolean
  /** A starter from Axe (can be copied and changed, not deleted). */
  starter?: boolean
  /** CLI agents: the folder it works in. */
  cwd?: string
  /** Which icon it shows. */
  kind: "write" | "research" | "code" | "plan" | "support" | "data" | "design" | "custom"
}

/** How a directory connector signs in. */
export type ConnectorAuth = "oauth" | "token" | "none" | "soon"

/** An entry in the connector directory. */
export type CatalogConnector = {
  id: string
  name: string
  about: string
  category: "Work" | "Design" | "Developer" | "Sales" | "Payments" | "Marketing"
  url: string
  auth: ConnectorAuth
  /** token: where to make one, and what to call it. */
  tokenHelp?: { url: string; label: string }
}

/** A connector on this computer. */
export type Connector = {
  id: string
  name: string
  /** The directory entry it came from (for its logo). */
  catalogId?: string
  /** Remote servers: the MCP address. */
  url?: string
  /** Local servers: the command that runs it. */
  command?: string
  args?: string[]
  /** Off: kept, but never offered to models or agents. */
  enabled: boolean
  state: "connected" | "connecting" | "signin" | "error"
  /** Tool names it offers, once connected. */
  tools: string[]
  error?: string
}

export type ConnectorsView = { catalog: CatalogConnector[]; connected: Connector[] }

/** What you add when it isn't in the directory: an https address, or a command on this computer. */
export type CustomConnector = { name: string; url?: string; command?: string; args?: string[]; token?: string }

/** What the quick bar can add to a question on request. */
export type QuickCapture = "screen" | "clipboard"

/** The microphone, as the system sees it: asked only when you first use voice. */
export type MicAccess = "granted" | "denied"

// Updates: the app keeps itself current (src/main/updates).

export type UpdateState =
  | { status: "unsupported"; reason: string }
  | { status: "idle"; checkedAt?: number }
  | { status: "checking" }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string }
export type KeepAwakeMode = "off" | "runs" | "plugged" | "always"

export type PowerState = { keepAwake: KeepAwakeMode; holding: boolean; awakeUntil: string | null; onBattery: boolean }

/** Remote control from axeai.com on your phone. */
/** Phones allowed to use this computer (Settings, Use from your phone). */
export type PhonesView = {
  /** False when this computer has no secret store for its keys: pairing stays off. */
  available: boolean
  /** "Let my phone use this Mac" */
  enabled: boolean
  macId: string | null
  phones: { id: string; name: string; agent: string; addedAt: number; lastUsedAt: number; connected: boolean }[]
}

/** One line of "What the phone did". */
export type PhoneLogEntry = { at: number; phone: string; name: string; text: string }

/** The pairing QR on screen: a link to axeai.com/connect, new every 2 minutes. */
export type PairingCode = { link: string; expiresAt: number }

export type RemoteState = {
  enabled: boolean
  connected: boolean
  /** The 8-character code a browser types to get in (24 hours). */
  code: string
  codeExpires: string
  /** Where to open it on a phone. */
  phoneURL: string
  /** The last thing done from axeai.com. */
  lastCommand?: string
}

/** A shell in the built-in terminal. */
export type TerminalSession = { id: string; title: string }
