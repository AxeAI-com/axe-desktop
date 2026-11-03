import type {
  PairingCode,
  PhoneLogEntry,
  PhonesView,
  AgentMode,
  AgentOption,
  Answerer,
  Attachment,
  CommunityAgent,
  CommunitySkill,
  FileChange,
  ConnectorsView,
  CustomConnector,
  Helper,
  SkillLibrary,
  ChatMessage,
  InstructionsFile,
  MemoryItem,
  MicAccess,
  ModelCatalog,
  ModelPull,
  PermissionRequest,
  Profile,
  QuickCapture,
  ReplyUpdate,
  SendRequest,
  Settings,
  SlashCommand,
  ThreadSummary,
  UpdateState,
  KeepAwakeMode,
  PowerState,
  RemoteState,
  TerminalSession,
} from "./types"
import type { Draft, DraftError, FindingAct, Kind, ReadResult, Run, WatchList, WatchPatch, WatchView } from "./watching/types"

// Everything the window can ask the engine, and everything the engine pushes back.
// The window never sees the session token, Node or the file system; it only calls these.

export type Commands = {
  "account:get": () => Profile | null
  /** Opens axeai.com in the browser to approve; resolves once signed in, or null if cancelled. */
  "account:signIn": () => Profile | null
  "account:cancelSignIn": () => void
  "account:signOut": () => void
  "account:openBilling": () => void

  "models:get": () => ModelCatalog
  /** Installs a CLI agent from the registry (npx packages need nothing else). */
  "agents:install": (agentId: string) => ModelCatalog
  /** Looks for local model servers again (and any the user added), then the whole catalog. */
  "models:refresh": () => ModelCatalog
  "models:addServer": (address: string, key?: string) => ModelCatalog
  "models:removeServer": (serverId: string) => ModelCatalog
  /** Starts Ollama (when it's on this computer and not running), then the whole catalog. */
  "models:startOllama": () => ModelCatalog
  /** Downloads a model into Ollama ("qwen2.5:7b"); progress comes as modelPull events. Resolves with the catalog once done. */
  "models:pull": (name: string) => ModelCatalog
  /** Stops the download in progress. */
  "models:cancelPull": () => void
  /** Loads an Ollama model into memory ahead of the first message. */
  "models:warm": (modelId: string) => void

  "threads:list": () => ThreadSummary[]
  "threads:messages": (threadId: string) => ChatMessage[]
  "threads:rename": (threadId: string, title: string) => void
  "threads:pin": (threadId: string, pinned: boolean) => void
  "threads:archive": (threadId: string) => void
  "threads:delete": (threadId: string) => void

  /** Starts a reply; updates arrive as "reply" events. Returns the chat's id (new chats get one). */
  "chat:send": (request: SendRequest) => { threadId: string }
  "chat:stop": (threadId: string) => void
  /** Answer a CLI agent's permission request. */
  "chat:answerPermission": (requestId: string, optionId: string) => void
  /** Runs the research a paid model asked about (replaces the approval card with the run). */
  "chat:approveResearch": (threadId: string, messageId: string) => void
  "chat:cancelResearch": (threadId: string, messageId: string) => void
  /** The / menu for a chat: the agent's own commands and skills (Axe's starters are the window's). */
  "chat:commands": (threadId: string) => SlashCommand[]
  /** The / menu before a new agent chat starts: skills in that folder and the agent's home. */
  "agents:commands": (agentId: string, cwd: string) => SlashCommand[]
  /** The CLI's own instructions files for an agent chat's folder. */
  "agents:instructions": (threadId: string) => InstructionsFile[]
  /** Opens one of those files in the default editor, creating it when it isn't there yet. */
  "agents:openInstructions": (threadId: string, name: string) => void

  /** How much an agent chat may do on its own. */
  "agents:setMode": (threadId: string, mode: AgentMode) => void
  /** An agent's model and effort lists (threadId null: a new chat), its own names, with the current picks. */
  "agents:options": (threadId: string | null, agentId: string) => AgentOption[]
  /** Picks a model or effort: kept for the chat and as the agent's default for new chats; a running agent switches now. */
  "agents:setOption": (threadId: string | null, agentId: string, configId: string, value: string) => AgentOption[]
  /**
   * Plan mode: start the plan. Switches the mode and answers the agent's plan question; false when
   * it wasn't asking (the window then sends "Go ahead with the plan.").
   */
  "chat:startPlan": (threadId: string) => boolean
  /** Every file the agent changed in this chat, with how it was and how it is. */
  "changes:list": (threadId: string) => FileChange[]
  /** Keep changes as they are (null: every file). */
  "changes:keep": (threadId: string, paths: string[] | null) => FileChange[]
  /** Put files back as they were before the agent first changed them (null: every file). */
  "changes:undo": (threadId: string, paths: string[] | null) => FileChange[]
  /** What rewinding to one of your messages would undo. */
  "chat:rewindPreview": (threadId: string, messageId: string) => { replies: number; files: number }
  /** Goes back to before one of your messages: later turns are dropped, and (files: true) files restored. */
  "chat:rewind": (threadId: string, messageId: string, files: boolean) => { messages: ChatMessage[]; text: string }

  /** What Axe remembers about you (kept on this computer, per account). */
  "memory:list": () => MemoryItem[]
  "memory:add": (text: string) => MemoryItem[]
  "memory:update": (id: string, text: string) => MemoryItem[]
  "memory:delete": (id: string) => MemoryItem[]

  /** Skills: the gallery, installed or not, and where they can go. */
  "skills:list": () => SkillLibrary
  /** The SKILL.md text, front matter and all. */
  "skills:read": (id: string) => string
  /** Installs into Axe and the CLIs you pick (only "axe" when none). */
  "skills:install": (id: string, targets: string[]) => SkillLibrary
  "skills:uninstall": (id: string) => SkillLibrary
  /** Makes a skill of your own (installed in Axe). */
  "skills:create": (skill: { name: string; description: string; body: string }) => SkillLibrary
  /** Copies a skill folder from disk into your library. */
  "skills:import": () => SkillLibrary
  /** Skills from open-source libraries (cached a day; `fresh` reloads). */
  "community:skills": (fresh?: boolean) => CommunitySkill[]
  /** A community skill's SKILL.md, fetched to read before adding. */
  "community:skillText": (key: string) => string
  /** Downloads the skill's folder into Axe and the CLIs you pick. */
  "community:installSkill": (key: string, targets: string[]) => SkillLibrary

  "helpers:list": () => Helper[]
  /** Saves a helper (no id: a new one). */
  "helpers:save": (helper: Omit<Helper, "id"> & { id?: string }) => Helper[]
  "helpers:delete": (id: string) => Helper[]
  /** Agents from wshobson/agents (cached a day; `fresh` reloads). */
  "community:agents": (fresh?: boolean) => CommunityAgent[]
  "community:agentText": (key: string) => string
  /** Copies a community agent into your agents. */
  "community:addAgent": (key: string) => Helper[]

  "connectors:list": () => ConnectorsView
  /** Connects a directory entry: opens the brand's sign-in for OAuth; resolves once connected. */
  "connectors:connect": (catalogId: string, token?: string) => ConnectorsView
  "connectors:cancel": () => void
  "connectors:addCustom": (custom: CustomConnector) => ConnectorsView
  "connectors:setEnabled": (id: string, enabled: boolean) => ConnectorsView
  "connectors:remove": (id: string) => ConnectorsView
  /** Connectors on for a chat (Axe models use their tools through the app; agents always get the enabled ones). */
  "chat:setConnectors": (threadId: string, ids: string[]) => void

  "settings:get": () => Settings
  "settings:set": (patch: Partial<Settings>) => Settings
  /** Opens a folder picker (for agent chats). */
  "app:pickFolder": () => string | null
  /** The @ menu: folders in a path you type ("~/Doc"), else the recent folders you pass that match. */
  "mention:folders": (query: string, recent: string[]) => { path: string; display: string }[]
  /** The @ menu: the apps on this Mac, by name. */
  "mention:apps": () => string[]
  "app:openExternal": (url: string) => void
  /** Opens a file picker; returns the files chosen (empty if cancelled). */
  "app:pickFiles": () => Attachment[]
  /** Files dropped on the window, by path. */
  "app:attachPaths": (paths: string[]) => Attachment[]
  /** A pasted or dragged file with no path (a screenshot): saved, then attached. */
  "app:attachBytes": (name: string, mime: string, bytes: Uint8Array) => Attachment

  /** The quick bar: a small window on a global shortcut (Settings › Quick bar and voice). */
  "quick:toggle": () => void
  "quick:hide": () => void
  /** The bar grows and shrinks with what it shows (CSS px of the panel). */
  "quick:resize": (height: number) => void
  /** Opens a chat the bar started as a full chat in the main window (null: just the window). */
  "quick:openInMain": (threadId: string | null) => void
  /** "Open" after a watch started from the bar: the main window shows the watch. */
  "quick:openWatch": (id: string) => void
  /** The screen under the pointer (without the bar) or what's copied, as an attachment; null when there's nothing. */
  "quick:capture": (what: QuickCapture) => Attachment | null
  /** The chat that drops out of the menu bar (the tray on Windows and Linux). */
  "tray:hide": () => void
  /** Opens this chat (or the app) in the main window and closes the panel. */
  "tray:openInMain": (threadId: string | null) => void
  /** The panel's links into the app: Watching, one watch, or Settings. Closes the panel. */
  "tray:open": (where: "watching" | "settings" | { watch: string }) => void

  /** True when Do it may use this computer (Screen Recording and Accessibility granted); never asks. */
  "doit:access": () => boolean
  /** Asks for the microphone the first time voice is used (never at launch). */
  "voice:microphone": () => MicAccess
  /** Opens the system's microphone privacy settings (after a no). */
  "voice:openMicSettings": () => void
  /** Speech to text on axeai.com (POST /api/voice/transcribe). */
  "voice:transcribe": (audio: Uint8Array, mime: string) => string
  /** True when this Mac writes speech down itself (macOS 26 and the model ready); starts getting the model ready otherwise. */
  "voice:onDevice": () => boolean
  /** Speech to text on this Mac from a 16 kHz mono WAV; null when it couldn't (use voice:transcribe). */
  "voice:transcribeOnDevice": (wav: Uint8Array) => string | null

  /** This copy's version and how its updates stand. */
  "updates:get": () => { version: string; state: UpdateState }
  "updates:check": () => UpdateState
  /** Quits, installs the downloaded version and opens it again. */
  "updates:install": () => void
  /** Watching (v3): every watch with its latest run, problems first. */
  "watching:list": () => WatchList
  "watching:get": (id: string) => WatchView | null
  /** Runs oldest first, for a watch's charts. */
  "watching:runs": (id: string) => Run[]
  /** Checks the target once; that run becomes the first. An error says what to fix. */
  /** `folders`: folders Axe knows (recent agent chats), so a GitHub repo finds its local clone. */
  "watching:draft": (input: { kind: Kind; target: string; answerer?: Answerer; force?: boolean; folders?: string[] }) => Draft | DraftError
  /**
   * A sentence typed on the Watching page: the picked model reads it once, then the target is validated.
   * A question back when the kind or target is missing. `known`: hosts from your chats, for a typo's close match.
   */
  "watching:read": (input: { text: string; answerer?: Answerer; folders?: string[]; known?: string[] }) => ReadResult
  "watching:create": (draft: Draft) => WatchView
  /** Edit, Rename, Pause and Resume. A new target is validated first: an error says what to fix. */
  "watching:update": (id: string, patch: WatchPatch) => WatchView | DraftError | null
  "watching:delete": (id: string) => WatchList
  "watching:checkNow": (id: string) => WatchView | null
  /** A finding's card: That's expected (and its Undo), Snooze (and Undo), Ignore changes like this, and Undo on a reply. */
  /** "copied" also puts the record's new value on the clipboard. */
  "watching:act": (id: string, key: string, act: FindingAct) => WatchView | null
  /** A reply in a watch's thread: a change Axe understood, or what it can change. Kept in the thread. */
  "watching:reply": (id: string, text: string) => WatchView | null
  /** You opened the watch: its changes are read, so the row loses its blue dot. */
  "watching:seen": (id: string) => WatchView | null
  /**
   * "Fix with …" on a finding (or a repo's alerts): with no code folder yet, Axe asks for one in the thread;
   * with one, the agent starts in plan mode in its own session, hidden from Recents.
   */
  "watching:fix": (id: string, keys: string[], folder?: string) => WatchView | null
  /** What you did with a fix's changes: kept (with how many files) or undone. Repo fixes re-check straight away. */
  "watching:fixDone": (id: string, at: number, how: "kept" | "undone", files?: number) => WatchView | null
  /** "Try again" after a kept fix didn't fix it: the new numbers go to the same agent session. */
  "watching:fixAgain": (id: string, at: number) => WatchView | null
  /** The Repo starter's menu: your GitHub repos (gh repo list) and the folders of recent agent chats. */
  /** /summary: the morning summary card now, from what the next one would say. */
  "watching:summary": () => WatchList
  /** × on the summary card. */
  "watching:summaryClose": () => WatchList
  "watching:repos": () => { repos: string[]; folders: string[] }
  /** "Which folder has the code?": recent agent chat folders, best match first, with what each one is. */
  "watching:folders": (id: string) => { path: string; about: string }[]

  "power:get": () => PowerState
  "power:set": (mode: KeepAwakeMode) => PowerState
  "remote:get": () => RemoteState
  "remote:setEnabled": (on: boolean) => RemoteState
  "remote:newCode": () => RemoteState
  /** Phones that may use this computer (Settings, Use from your phone). */
  "phones:get": () => PhonesView
  "phones:setEnabled": (on: boolean) => PhonesView
  /** The QR to show now; null while it can't pair (off, signed out, no secret store). */
  "phones:code": () => PairingCode | null
  "phones:remove": (id: string) => PhonesView
  /** Your answer to "Connect David's iPhone?" */
  "phones:answer": (askId: string, allow: boolean) => void
  /** What the phones did, newest first. */
  "phones:log": () => PhoneLogEntry[]
  /** Stop on the banner: ends every phone's session and turns "Let my phone use this Mac" off. */
  "phones:stop": () => PhonesView
  /** The built-in terminal: a shell on this computer. With `agentId`, it starts on that CLI's sign-in. */
  "terminal:open": (cols: number, rows: number, agentId?: string) => TerminalSession
  /** Shells still running (after a window reload), with what they printed. */
  "terminal:list": () => (TerminalSession & { output: string })[]
  "terminal:write": (id: string, data: string) => void
  /** Types an agent CLI's sign-in into a running shell (Sign in, when a shell is already open). */
  "terminal:signIn": (id: string, agentId: string) => void
  "terminal:resize": (id: string, cols: number, rows: number) => void
  "terminal:close": (id: string) => void
}

export type Events = {
  account: Profile | null
  /** Settings changed (from any window, the quick bar, or the engine). */
  settings: Settings
  threads: ThreadSummary[]
  reply: ReplyUpdate
  permission: PermissionRequest
  /** A permission request answered or withdrawn. */
  permissionDone: { id: string }
  models: ModelCatalog
  /** A model downloading into Ollama; null once it's done or stopped. */
  modelPull: ModelPull | null
  /** An agent's / commands changed (ACP available_commands_update). */
  commands: { threadId: string; commands: SlashCommand[] }
  /** An agent chat's mode changed (you, Start, or the agent itself). */
  mode: { threadId: string; mode: AgentMode }
  /** An agent chat's model and effort lists changed (its session started, you picked, or the agent changed them). */
  agentOptions: { threadId: string; agentId: string; options: AgentOption[] }
  /** The files an agent chat changed, after each turn and each Keep or Undo. */
  changes: { threadId: string; files: FileChange[] }
  /** Open this chat (a notification was clicked). */
  openThread: { threadId: string }
  /** Connectors changed (connected, signing in, failed). */
  connectors: ConnectorsView
  /** The main window should open this chat (the quick bar handed it over). */
  navigate: { threadId: string }
  /** The quick bar was just shown: focus the box. */
  quickShown: { at: number }
  /** The menu bar's chat was just shown: focus its box. */
  trayShown: { at: number }
  /** Updates: checking, downloading, ready to restart. */
  update: UpdateState
  /** Watching (v3): a watch ran, or one was added, changed or deleted. */
  watching: WatchList
  /** A watch's notification was clicked: show that watch. `fix`: its Fix button, for that finding. */
  openWatch: { id: string; fix?: string }
  /** The morning summary's notification was clicked: Watching, with the card on top. */
  openWatching: Record<string, never>
  /** Settings… in the menu bar panel: the main window shows Settings. */
  openSettings: Record<string, never>
  power: PowerState
  remote: RemoteState
  phones: PhonesView
  /** A phone proved it scanned this computer's QR: ask "Connect David's iPhone?" (null: the question ended). */
  phoneAsk: { id: string; name: string; agent: string } | null
  phoneLog: PhoneLogEntry[]
  /** Something a phone did that the banner says at once (Bypass turned on); null clears it. */
  phoneNotice: { text: string } | null
  /** What a terminal's shell printed. */
  terminal: { id: string; data: string }
  terminalExit: { id: string; code: number }
}

export type CommandName = keyof Commands
export type EventName = keyof Events

/** What the preload puts on window.axe. */
export type AxeBridge = {
  invoke<K extends CommandName>(command: K, ...args: Parameters<Commands[K]>): Promise<Awaited<ReturnType<Commands[K]>>>
  on<K extends EventName>(event: K, listener: (payload: Events[K]) => void): () => void
  platform: "darwin" | "win32" | "linux"
  /** Where a dropped File is on disk; "" when it has no path (a pasted screenshot). */
  pathOf(file: File): string
  /** Self-tests: Talk mode reads answers at zero volume, so a test never plays sound. */
  quiet?: boolean
}
