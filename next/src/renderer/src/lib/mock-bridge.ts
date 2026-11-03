// A fake engine for working on the window in a plain browser (and for the screenshot tests).
// It is only installed when window.axe is missing, so Electron never loads it.
//
// URL options: ?mock=signedout (start signed out), ?mock=live (a reply frozen mid-way),
// ?mock=research (a research run frozen mid-way), ?mock=nomemory (nothing remembered yet),
// ?mock=agentwork (a plan waiting for Start, changes to review, a chat to rewind, Working now),
// ?mock=nolibrary and ?mock=signin (lib/mock-libraries.ts),
// ?theme=light|dark|system.

import type { AxeBridge, CommandName, Commands, EventName, Events } from "@shared/api"

import { mockAgentOptions } from "./mock-agent-options"
import { agentWorkSeed } from "./mock-agent-work"
import { mockLibraries } from "./mock-libraries"
import { mockPower } from "./mock-power"
import { mockWatching } from "./mock-watching"
import { richSeed } from "./mock-rich"
import { mockUpdates } from "./mock-updates"
import type {
  AgentMode,
  Attachment,
  FileChange,
  Answerer,
  ChatMessage,
  InstructionsFile,
  MemoryItem,
  ModelCatalog,
  Part,
  ResearchData,
  PermissionRequest,
  Profile,
  SendRequest,
  Settings,
  SlashCommand,
  ThreadSummary,
} from "@shared/types"

declare global {
  interface Window {
    __axeMock?: { emit: <K extends EventName>(e: K, p: Events[K]) => void; state: MockState }
  }
}

type MockState = {
  profile: Profile | null
  settings: Settings
  catalog: ModelCatalog
  threads: ThreadSummary[]
  messages: Record<string, ChatMessage[]>
  permissions: PermissionRequest[]
  live: Record<string, { message: ChatMessage; startedAt: number }>
  memory: MemoryItem[]
  changes: Record<string, FileChange[]>
  /** Chats that finish as the window opens (Done in Working now). */
  finished: string[]
}

const MIA: Profile = { id: "u_mia", email: "mia@example.com", name: "Mia Lane", plan: "Pro", credits: 1240 }
// ?mock=photo: the account has a picture (a plain gradient, never a real face).
const PHOTO =
  "data:image/svg+xml," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#f6a35b"/><stop offset="1" stop-color="#7b5cff"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>')

const CATALOG: ModelCatalog = {
  axe: {
    defaultModelId: "auto",
    models: [
      { id: "auto", label: "Auto", provider: "axe", tier: "free", description: "Picks the right model for each message", webSearch: true, vision: true, reasoning: true, contextWindow: 131_072 },
      { id: "gpt-oss-120b", label: "GPT OSS 120B", provider: "groq", tier: "free", description: "Fast everyday answers", webSearch: true, vision: false, reasoning: true, contextWindow: 131_072 },
      { id: "sonnet-5.5", label: "Sonnet 5.5", provider: "openrouter", tier: "paid", description: "Careful writing and code", webSearch: true, vision: true, reasoning: true, contextWindow: 200_000 },
      { id: "kimi-k2", label: "Kimi K2", provider: "openrouter", tier: "paid", description: "Long documents", webSearch: true, vision: false, reasoning: false, contextWindow: 131_072 },
    ],
  },
  agents: [
    { id: "claude-code", name: "Claude Code", note: "Works in your folders and terminal", state: "ready" },
    { id: "codex", name: "Codex", note: "Your ChatGPT account", state: "ready" },
    { id: "gemini-cli", name: "Gemini CLI", note: "Not installed yet", state: "install" },
  ],
  local: [],
  servers: [],
}

/**
 * ?mock=local: Ollama and LM Studio running, with three small models between them. Ollama's use tools
 * (LM Studio's doesn't say). &ollama=stopped: Ollama is here but not running (Start Ollama);
 * &chatonly=1: every local model can only chat.
 */
const LOCAL_SERVERS: ModelCatalog["servers"] = [
  {
    id: "ollama",
    name: "Ollama",
    url: "http://127.0.0.1:11434/v1",
    found: true,
    suggested: ["qwen2.5:7b", "qwen3:8b"],
    models: [
      { id: "ollama|qwen3:1.7b", model: "qwen3:1.7b", name: "Qwen3 1.7B", serverId: "ollama", serverName: "Ollama", size: 1_400_000_000, tools: true, vision: false },
      { id: "ollama|qwen3:4b", model: "qwen3:4b", name: "Qwen3 4B", serverId: "ollama", serverName: "Ollama", size: 2_600_000_000, tools: true, vision: false },
    ],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    url: "http://127.0.0.1:1234/v1",
    found: true,
    models: [{ id: "lmstudio|qwen3-4b-instruct-2507", model: "qwen3-4b-instruct-2507", name: "Qwen3 4B Instruct 2507", serverId: "lmstudio", serverName: "LM Studio" }],
  },
  { id: "llamacpp", name: "llama.cpp", url: "http://127.0.0.1:8080/v1", found: false, models: [] },
]

const AUTO: Answerer = { kind: "axe", modelId: "auto" }
const CLAUDE: Answerer = { kind: "agent", agentId: "claude-code" }

const LISBON_TEXT = `Here's a slow day built around the trams, with time to sit down between stops.

## A slow day on the rails

- **Morning:** catch Tram 28 at Martim Moniz before nine to get a seat.
- **Lunch:** pastéis de nata in Belém, a short ride on tram 15.
- **Evening:** sunset at the Senhora do Monte viewpoint.

| Stop | Time | Notes |
| --- | --- | --- |
| Martim Moniz | 9:00 | Board tram 28 |
| Belém | 12:30 | Lunch by the river |
| Graça | 18:30 | Sunset |`

const STREAM_TEXT = `Here's a simple way to keep a weekly review short and useful.

## Three questions, every Friday

1. **What moved?** Name the two or three things that actually shipped.
2. **What's stuck?** One line on why, and who can unstick it.
3. **What's next?** Pick the one thing that matters most on Monday.

| Step | Time | Tip |
| --- | --- | --- |
| Look back | 10 min | Skim your calendar and sent mail |
| Write it down | 10 min | Short sentences, no slides |
| Plan Monday | 5 min | One clear first task |

If you keep notes in plain text, a tiny script can start each week's file for you:

\`\`\`ts
const today = new Date().toISOString().slice(0, 10)
const note = ["# Week of " + today, "", "## Moved", "", "## Stuck", "", "## Next"].join("\\n")
await Bun.write(\`reviews/\${today}.md\`, note)
\`\`\``

const TEST_BEFORE = `  it("counts today's uploads", async () => {
    await upload(file)
    const count = await dailyCount()
    expect(count).toBe(1)
  })`
const TEST_AFTER = `  it("counts today's uploads", async () => {
    await upload(file)
    const count = await waitFor(() => dailyCount(),
      (n) => n === 1)
    expect(count).toBe(1)
  })`
const SAVE_BEFORE = `export async function save(file: Upload) {
  await db.insert(uploads).values(file)
  await bumpDailyCount(file.userId)
}`
const SAVE_AFTER = `export async function save(file: Upload) {
  await db.transaction(async (tx) => {
    await tx.insert(uploads).values(file)
    await bumpDailyCount(file.userId, tx)
  })
}`

const text = (id: string, t: string): Part => ({ type: "text", id, text: t })
// Files the mock file picker returns: a photo (with a drawn thumbnail) and a PDF.
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6B98A"/><stop offset=".55" stop-color="#E9806A"/><stop offset="1" stop-color="#7C4B6B"/></linearGradient></defs><rect width="160" height="160" fill="url(#s)"/><circle cx="112" cy="70" r="18" fill="#FBE3B8"/><path d="M0 118 30 96l22 12 26-24 30 22 22-14 30 20v48H0z" fill="#3F2C45"/><rect x="34" y="104" width="40" height="22" rx="4" fill="#F2C14E"/><rect x="38" y="108" width="9" height="8" rx="1.5" fill="#3F2C45"/><rect x="50" y="108" width="9" height="8" rx="1.5" fill="#3F2C45"/><rect x="62" y="108" width="9" height="8" rx="1.5" fill="#3F2C45"/></svg>`
const MOCK_PHOTO: Attachment = {
  path: "/Users/mia/Pictures/Lisbon tram.jpg",
  name: "Lisbon tram.jpg",
  mime: "image/jpeg",
  size: 2_431_000,
  preview: `data:image/svg+xml;utf8,${encodeURIComponent(PHOTO_SVG)}`,
}
const MOCK_PDF: Attachment = { path: "/Users/mia/Documents/Lisbon itinerary.pdf", name: "Lisbon itinerary.pdf", mime: "application/pdf", size: 418_000 }

const user = (id: string, t: string, answerer: Answerer = AUTO): ChatMessage => ({ id, role: "user", parts: [text(`${id}-t`, t)], answerer })

function agentWorkParts(): Part[] {
  return [
    { type: "reasoning", id: "a1-r", text: "One failure in five points at a race: something reads before a write has landed.", done: true, seconds: 3 },
    { type: "tool", id: "a1-t1", title: "Read upload.test.ts", kind: "read", state: "done", input: "test/upload.test.ts" },
    { type: "tool", id: "a1-t2", title: "Read save.ts", kind: "read", state: "done", input: "src/uploads/save.ts" },
    { type: "tool", id: "a1-t3", title: "Read count.ts", kind: "read", state: "done", input: "src/uploads/count.ts" },
    {
      type: "tool",
      id: "a1-t4",
      title: "Ran the test 10 times",
      kind: "execute",
      state: "done",
      input: "pnpm test upload --repeat 10",
      output: "✓ 8 passed\n✗ 2 failed: expected 1, received 0",
    },
    text("a1-x1", "The test reads the daily count before the upload has finished saving. Here's how I'm fixing it:"),
    {
      type: "plan",
      id: "a1-p",
      entries: [
        { text: "Wait in the test until the upload is saved, instead of reading the count straight away.", status: "done" },
        { text: "Make the daily count update in the same database write as the upload.", status: "done" },
        { text: "Run the test 50 times to be sure it no longer fails.", status: "running" },
        { text: "Leave a one-line note in the changelog.", status: "pending" },
      ],
    },
    {
      type: "tool",
      id: "a1-t5",
      title: "Edited upload.test.ts",
      kind: "edit",
      state: "done",
      input: "test/upload.test.ts",
      diff: [{ path: "test/upload.test.ts", before: TEST_BEFORE, after: TEST_AFTER }],
    },
    {
      type: "tool",
      id: "a1-t6",
      title: "Edited save.ts",
      kind: "edit",
      state: "done",
      input: "src/uploads/save.ts",
      diff: [{ path: "src/uploads/save.ts", before: SAVE_BEFORE, after: SAVE_AFTER }],
    },
    { type: "tool", id: "a1-t7", title: "Running the test 50 times", kind: "execute", state: "running", input: "pnpm test upload --repeat 50" },
  ]
}

// Do it: an Axe model working on this computer (src/main/doit). Same steps and cards as the engine sends.

const FORM_PLAN = ["Open the form", "Fill in the fields", "Press Send order"]

function doItFormParts(sent: boolean | "declined"): Part[] {
  const done = sent === true
  return [
    text("f-x1", "I'll fill in the form and stop at Send."),
    { type: "plan", id: "f-plan", entries: FORM_PLAN.map((t, i) => ({ text: t, status: done || i < 2 ? "done" : sent === "declined" ? "done" : "running" })) },
    { type: "tool", id: "f-t1", title: "Open localhost:5203/form.html", kind: "fetch", state: "done", input: "http://localhost:5203/form.html" },
    { type: "tool", id: "f-t2", title: "Fill in “Mia Lane”", kind: "other", state: "done" },
    { type: "tool", id: "f-t3", title: "Fill in “mia@example.com”", kind: "other", state: "done" },
    {
      type: "tool",
      id: "f-t4",
      title: "Click “Send order”",
      kind: "other",
      state: sent === true ? "done" : sent === "declined" ? "declined" : "running",
      ...(sent === "declined" ? { output: "You said no." } : {}),
    },
  ]
}

const SEND_QUESTION = (id: string, threadId: string): PermissionRequest => ({
  id,
  threadId,
  title: "Click “Send order” on localhost:5203",
  detail: "Sends the order form to the shop.",
  options: [
    { id: "allow", label: "Allow", kind: "allow_once" },
    { id: "deny", label: "Don't allow", kind: "reject_once" },
  ],
})

function doItNotesParts(): Part[] {
  return [
    { type: "tool", id: "s-t1", title: "Write notes.txt", kind: "edit", state: "done", diff: [{ path: "~/Library/Application Support/Axe AI/Workspace/notes.txt", after: "apples\npears\nplums\n" }] },
    {
      type: "tool",
      id: "s-t2",
      title: "Run sort -r notes.txt > sorted.txt && cat sorted.txt",
      kind: "execute",
      state: "done",
      input: "sort -r notes.txt > sorted.txt && cat sorted.txt",
      output: "plums\npears\napples",
    },
    { type: "tool", id: "s-t3", title: "Edit notes.txt", kind: "edit", state: "done", diff: [{ path: "~/Library/Application Support/Axe AI/Workspace/notes.txt", before: "apples\npears\nplums\n", after: "apples\nfigs\nplums\n" }] },
    { type: "tool", id: "s-t4", title: "Delete sorted.txt", kind: "delete", state: "declined", input: "~/Library/Application Support/Axe AI/Workspace/sorted.txt", output: "You said no." },
    text("s-x", "Made **notes.txt**, sorted it into **sorted.txt** and swapped pears for figs. You said no to deleting sorted.txt, so it's still there."),
  ]
}

const REPORT = `# How creators price short films

Most independent creators charge per finished minute, then adjust for usage rights and turnaround [1][3]. Studios that sell to brands quote a day rate instead, with edits billed on top [2].

## Per-minute pricing

Freelancers on the big marketplaces list between $150 and $600 per finished minute for a simple edit, rising past $1,000 when motion graphics are included [1]. The figure covers one round of changes; more rounds are billed hourly [4].

## Day rates for brand work

Small studios quote a day rate for shooting and a separate rate for the edit [2]. Usage rights for paid ads add 20 to 50 percent on top, depending on how long the brand runs the film [3, 5].

## What to charge first

Start from a per-minute price for organic posts and a day rate for anything a brand will pay to promote. Write the number of revision rounds into the quote, so extra work is visible before it starts [4].`

function researchRun(status: ResearchData["status"], at: number): ResearchData {
  const s = (id: string, kind: ResearchData["steps"][number]["kind"], verb: string, target: string, detail?: string, running = false) => ({
    id,
    kind,
    verb,
    target,
    ...(detail ? { detail } : {}),
    status: running ? ("running" as const) : ("complete" as const),
    startedAt: at,
    ...(running ? {} : { endedAt: at + 4000 }),
  })
  const sources = [
    { n: 1, title: "What video editors charge in 2026", url: "https://www.example.com/editor-rates", site: "example.com", snippet: "", read: true },
    { n: 2, title: "Day rates for small studios", url: "https://studio.example.org/day-rates", site: "studio.example.org", snippet: "", read: true },
    { n: 3, title: "Usage rights, explained", url: "https://rights.example.net/usage", site: "rights.example.net", snippet: "", read: true },
    { n: 4, title: "Scoping revisions in a quote", url: "https://www.example.com/revisions", site: "example.com", snippet: "", read: true },
    { n: 5, title: "Paid social licensing terms", url: "https://ads.example.org/licensing", site: "ads.example.org", snippet: "", read: false },
  ]
  const queries = ["short film editing price per minute", "video studio day rate brand work", "usage rights fee paid social video"]
  if (status === "running")
    return {
      status,
      queries,
      startedAt: at,
      sources,
      steps: [
        s("plan-0", "plan", "Planned", "3 searches"),
        s("search-1", "search", "Searched for", queries[0]!, "6 results"),
        s("search-2", "search", "Searched for", queries[1]!, "6 results"),
        s("search-3", "search", "Searched for", queries[2]!, "5 results"),
        s("read-4", "read", "Read", "example.com"),
        s("read-5", "read", "Read", "studio.example.org"),
        s("read-6", "read", "Read", "rights.example.net"),
        s("write-7", "write", "Writing", "the report", undefined, true),
      ],
    }
  return {
    status,
    queries,
    startedAt: at,
    endedAt: at + 72_000,
    sources,
    steps: [
      s("plan-0", "plan", "Planned", "3 searches"),
      ...queries.map((q, i) => s(`search-${i + 1}`, "search", "Searched for", q, "6 results")),
      ...["example.com", "studio.example.org", "rights.example.net", "example.com"].map((site, i) => s(`read-${i + 4}`, "read", "Read", site)),
      s("write-8", "write", "Wrote", "the report"),
    ],
  }
}

const MEMORY: MemoryItem[] = [
  { id: "mem-1", text: "I run a small video studio with David and Jack.", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z" },
  { id: "mem-2", text: "Prices in US dollars, dates as 22 Oct 2026.", createdAt: "2026-10-03T10:00:00Z", updatedAt: "2026-10-03T10:00:00Z" },
  { id: "mem-3", text: "Keep answers short; tables over long lists.", createdAt: "2026-10-09T10:00:00Z", updatedAt: "2026-10-09T10:00:00Z" },
]

const AGENT_COMMANDS: SlashCommand[] = [
  { name: "review", description: "Review the changes on this branch", source: "agent" },
  { name: "init", description: "Write a CLAUDE.md for this folder", source: "agent" },
  { name: "compact", description: "Summarise the chat to free up context", source: "agent", hint: "what to keep" },
  { name: "pr-comments", description: "Read the comments on the open pull request", source: "agent" },
  { name: "brand-voice", description: "Write in the studio's house style", source: "skill" },
  { name: "release-notes", description: "Turn merged changes into release notes", source: "skill" },
]

function seed(scenario: string | null): MockState {
  const params = new URLSearchParams(location.search)
  const now = Date.now()
  const ago = (min: number) => new Date(now - min * 60_000).toISOString()
  const day = 24 * 60

  const threads: ThreadSummary[] = [
    { id: "t-studio", source: "axe", title: "Launch posts for Studio", pinned: true, updatedAt: ago(3 * day) },
    { id: "t-lisbon", source: "axe", title: "Two days in Lisbon", pinned: false, updatedAt: ago(12) },

    {
      id: "t-upload",
      source: "agent",
      agentId: "claude-code",
      cwd: "/Users/mia/Code/axe-web",
      title: "Fix the flaky upload test",
      pinned: false,
      updatedAt: ago(30),
      running: true,
    },
    { id: "t-refund", source: "axe", title: "Refund for a double charge", pinned: false, updatedAt: ago(95) },
    { id: "t-gift", source: "axe", title: "Gift ideas for Sam", pinned: false, updatedAt: ago(day + 60) },
    { id: "t-pricing", source: "axe", title: "Pricing page copy", pinned: false, updatedAt: ago(3 * day) },
    { id: "t-tidy", source: "agent", agentId: "codex", cwd: "/Users/mia/Downloads", title: "Tidy the Downloads folder", pinned: false, updatedAt: ago(4 * day) },
    { id: "t-jack", source: "axe", title: "Notes from the Jack call", pinned: false, updatedAt: ago(5 * day) },
    { id: "t-q3", source: "axe", title: "Q3 sales review", pinned: false, updatedAt: ago(20 * day) },
  ]

  const messages: Record<string, ChatMessage[]> = {
    "t-lisbon": [
      user("l-u1", "Plan a relaxed day in Lisbon with trams, with a small table."),
      {
        id: "l-a1",
        role: "assistant",
        answerer: AUTO,
        parts: [
          { type: "reasoning", id: "l-r", text: "A relaxed tram day: Tram 28 early, Belém for lunch, a viewpoint at sunset.", done: true, seconds: 2 },
          { type: "tool", id: "l-s", title: "Searched the web", kind: "search", state: "done", input: "lisbon tram 28 times belem tram 15 sunset viewpoint" },
          { type: "source", id: "l-s1", title: "Tram 28: the complete guide", url: "https://www.visitlisboa.com/tram-28" },
          { type: "source", id: "l-s2", title: "Carris timetables", url: "https://www.carris.pt/en/timetables" },
          { type: "source", id: "l-s3", title: "Miradouro da Senhora do Monte", url: "https://www.lisbonlux.com/senhora-do-monte" },
          text("l-x", LISBON_TEXT),
        ],
        context: { used: 3_420, modelId: "gpt-oss-120b" },
      },
    ],
    "t-pricing-films": [
      user("f-u1", "How do creators price short films? Per minute or per day?"),
      {
        id: "f-a1",
        role: "assistant",
        answerer: AUTO,
        parts: [{ type: "research", id: "research", data: researchRun("complete", now - 3 * 60_000) }, text("f-x", REPORT)],
        context: { used: 18_600, modelId: "gpt-oss-120b" },
      },
    ],
    "t-ask": [
      user("w-u1", "What do studios charge for wedding films in Portugal?", { kind: "axe", modelId: "sonnet-5.5" }),
      {
        id: "w-a1",
        role: "assistant",
        answerer: { kind: "axe", modelId: "sonnet-5.5" },
        parts: [{ type: "researchApproval", id: "approval", data: { status: "pending", searches: 5, pages: 6, estimate: 4_200, modelId: "sonnet-5.5" } }],
      },
    ],
    "t-upload": [
      user("u-u1", "The upload test fails about one run in five. Find out why and fix it.", CLAUDE),
      { id: "u-a1", role: "assistant", answerer: CLAUDE, parts: agentWorkParts(), context: { used: 84_300, size: 200_000, cost: { amount: 0.42, currency: "USD" } } },
    ],
    "t-refund": [
      user("r-u1", "Draft a short note asking for a refund on a double charge from Northwind."),
      { id: "r-a1", role: "assistant", answerer: AUTO, parts: [{ type: "error", id: "r-e", text: "The model didn't answer in time. Your message is safe." }] },
    ],
    "t-pricing": [
      user("p-u1", "Give me three headlines for the pricing page."),
      {
        id: "p-a1",
        role: "assistant",
        answerer: AUTO,
        parts: [{ type: "reasoning", id: "p-r", text: "", done: true, seconds: 1 }, text("p-x", "1. Every model, one plan.\n2. Pay for answers, not subscriptions.\n3. One calm place to think, write and make.")],
      },
      user("p-u2", "Now make the second one warmer.", { kind: "axe", modelId: "kimi-k2" }),
      { id: "p-a2", role: "assistant", answerer: { kind: "axe", modelId: "kimi-k2" }, parts: [text("p-x2", "**Pay for the answers you need, nothing more.**\n\nIt keeps the promise and drops the edge.")] },
    ],
    "t-gift": [
      user("g-u1", "Gift ideas for Sam, who likes hiking and coffee. Under $60."),
      { id: "g-a1", role: "assistant", answerer: AUTO, parts: [text("g-x", "- A compact pour-over set for the trail\n- A good insulated mug\n- A paper map of a park Sam hasn't walked yet")] },
    ],
  }

  const live: MockState["live"] = {
    "t-upload": { message: messages["t-upload"]![1]!, startedAt: now - 42_000 },
  }

  if (scenario === "research") {
    threads.splice(
      1,
      0,
      { id: "t-live-research", source: "axe", title: "Pricing for short films", pinned: false, updatedAt: ago(1), running: true },
      { id: "t-pricing-films", source: "axe", title: "How creators price short films", pinned: false, updatedAt: ago(20) },
      { id: "t-ask", source: "axe", title: "Rates for wedding films", pinned: false, updatedAt: ago(26) },
    )
    const half = REPORT.slice(0, REPORT.indexOf("## Day rates"))
    const msg: ChatMessage = {
      id: "lr-a1",
      role: "assistant",
      answerer: AUTO,
      parts: [{ type: "research", id: "research", data: researchRun("running", now - 130_000) }, text("lr-x", half)],
    }
    messages["t-live-research"] = [user("lr-u1", "How do creators price short films?"), msg]
    live["t-live-research"] = { message: msg, startedAt: now - 130_000 }
  }

  if (scenario === "live") {
    threads.splice(1, 0, { id: "t-notes", source: "axe", title: "Compare three note apps", pinned: false, updatedAt: ago(1), running: true })
    const msg: ChatMessage = {
      id: "n-a1",
      role: "assistant",
      answerer: AUTO,
      parts: [
        { type: "reasoning", id: "n-r", text: "", done: true, seconds: 2 },
        { type: "tool", id: "n-s", title: "Searching the web", kind: "search", state: "running", input: "notion obsidian bear small team pricing sync" },
      ],
    }
    messages["t-notes"] = [user("n-u1", "Compare Notion, Obsidian and Bear for a small team that writes a lot."), msg]
    live["t-notes"] = { message: msg, startedAt: now - 4_000 }
  }

  // The Lisbon answer half written: its searches done, the text streaming (the board's "streaming" screen).
  if (scenario === "stream") {
    const t = threads.find((x) => x.id === "t-lisbon")
    const msg = messages["t-lisbon"]![1]!
    if (t) t.running = true
    msg.parts = [
      ...msg.parts.filter((p) => p.type !== "text"),
      text(
        "l-x",
        "Here's a slow day built around the trams, with time to sit down between stops.\n\n## A slow day on the rails\n\n- **Morning:** catch Tram 28 at Martim Moniz before nine to get a seat.【l-s1】【l-s2】\n- **Lunch:** pastéis de nata in Belém, a short ride on tram 15.【l-s2】\n- **Evening:** sunset at the Senhora do Monte",
      ),
    ]
    live["t-lisbon"] = { message: msg, startedAt: now - 9_000 }
  }

  if (scenario === "rich") {
    const rich = richSeed(now)
    threads.unshift(...rich.threads)
    Object.assign(messages, rich.messages)
    Object.assign(live, rich.live)
  }

  const work = scenario === "agentwork" ? agentWorkSeed(now) : scenario === "agentchat" || scenario === "agentworking" ? agentWorkSeed(now, scenario) : null
  if (work) {
    threads.splice(1, 0, ...work.threads)
    Object.assign(messages, work.messages)
    Object.assign(live, work.live)
  }

  const permissions: PermissionRequest[] = [...(work?.permissions ?? [])]
  if (scenario === "doit") {
    threads.splice(
      1,
      0,
      { id: "t-form", source: "axe", title: "Fill the order form", pinned: false, updatedAt: ago(1), running: true },
      { id: "t-notes", source: "axe", title: "Sort my shopping list", pinned: false, updatedAt: ago(6) },
    )
    const form: ChatMessage = { id: "f-a1", role: "assistant", answerer: AUTO, parts: doItFormParts(false) }
    messages["t-form"] = [user("f-u1", "Fill the order form at localhost:5203 for Mia Lane and stop at Send.", AUTO), form]
    live["t-form"] = { message: form, startedAt: now - 9_000 }
    permissions.push(SEND_QUESTION("perm-send", "t-form"))
    messages["t-notes"] = [
      user("s-u1", "Make a shopping list in the workspace, sort it, swap pears for figs, then clean up.", AUTO),
      { id: "s-a1", role: "assistant", answerer: AUTO, parts: doItNotesParts() },
    ]
  }

  permissions.push(
    {
      id: "perm-1",
      threadId: "t-upload",
      title: "Claude Code wants to run a command",
      detail: "pnpm test upload --repeat 50",
      options: [
        { id: "once", label: "Allow once", kind: "allow_once" },
        { id: "always", label: "Always allow tests here", kind: "allow_always" },
        { id: "no", label: "Don't allow", kind: "reject_once" },
      ],
    })

  let theme: Settings["theme"] = "dark"
  const q = new URLSearchParams(location.search).get("theme")
  if (q === "light" || q === "dark" || q === "system") theme = q

  return {
    profile: scenario === "signedout" ? null : scenario === "photo" ? { ...MIA, image: PHOTO } : MIA,
    settings: { baseURL: "https://axeai.com", theme, sidebarWidth: 300, quickBarKey: params.get("platform") && params.get("platform") !== "darwin" ? "Control+Space" : "Alt+Space" },
    catalog: params.get("mock") === "local" || params.has("local") ? localCatalog(params) : structuredClone(CATALOG),
    threads,
    messages,
    // The agent work scene keeps the upload chat working, so Working now shows all three states.
    permissions: work ? permissions.filter((p) => p.id !== "perm-1") : permissions,
    live,
    memory: scenario === "nomemory" ? [] : structuredClone(MEMORY),
    changes: structuredClone(work?.changes ?? {}),
    finished: work?.finished ?? [],
  }
}

/** The local models scene, with Ollama stopped or the models chat-only when the address asks. */
function localCatalog(params: URLSearchParams): ModelCatalog {
  const servers = structuredClone(LOCAL_SERVERS)
  const ollama = servers[0]!
  if (params.get("ollama") === "stopped") Object.assign(ollama, { found: false, canStart: true })
  if (params.has("chatonly")) for (const m of servers.flatMap((x) => x.models)) Object.assign(m, { tools: false, vision: false })
  return { ...structuredClone(CATALOG), servers, local: servers.flatMap((x) => x.models) }
}

// A small grey "desktop" as the captured screen.
const MOCK_SCREEN: Attachment = {
  path: "/mock/Screen.png",
  name: "Screen.png",
  mime: "image/png",
  size: 812_000,
  preview:
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#3a3d45"/><rect x="14" y="14" width="86" height="60" rx="4" fill="#f4f3ee"/><rect x="22" y="24" width="50" height="5" rx="2" fill="#c9c7bf"/><rect x="22" y="34" width="66" height="4" rx="2" fill="#dedcd4"/><rect x="22" y="42" width="58" height="4" rx="2" fill="#dedcd4"/><rect x="108" y="22" width="40" height="52" rx="4" fill="#5a5eff"/></svg>',
    ),
}
const MOCK_COPIED: Attachment = { path: "/mock/Copied text.txt", name: "Copied text.txt", mime: "text/plain", size: 1_420 }

export function installMockBridge() {
  const params = new URLSearchParams(location.search)
  const state = seed(params.get("mock"))
  const listeners = new Map<EventName, Set<(p: unknown) => void>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>()
  let signInCancel: (() => void) | null = null
  let n = 0
  let pullStopped = false

  const emit = <K extends EventName>(event: K, payload: Events[K]) => {
    for (const l of listeners.get(event) ?? []) l(structuredClone(payload))
  }
  const libraries = mockLibraries(params.get("mock"), emit)
  const updates = mockUpdates(params, emit)
  // ?mock=noruns: nothing working either, so nothing waits on you.
  if (params.get("mock") === "noruns") {
    state.threads = state.threads.map((t) => ({ ...t, running: false }))
    state.live = {}
    state.permissions = []
  }
  const watchingMock = mockWatching(params.get("mock"), emit)
  const powerMock = mockPower(params.get("mock"), emit)
  const later = (threadId: string, ms: number, fn: () => void) => {
    const id = setTimeout(fn, ms)
    timers.set(threadId, [...(timers.get(threadId) ?? []), id])
  }
  const setRunning = (threadId: string, running: boolean) => {
    state.threads = state.threads.map((t) => (t.id === threadId ? { ...t, running, updatedAt: new Date().toISOString() } : t))
    emit("threads", state.threads)
  }
  const push = (threadId: string, message: ChatMessage, startedAt: number, done: boolean) => {
    const list = state.messages[threadId] ?? []
    const i = list.findIndex((m) => m.id === message.id)
    state.messages[threadId] = i >= 0 ? list.map((m, j) => (j === i ? message : m)) : [...list, message]
    if (done) delete state.live[threadId]
    else state.live[threadId] = { message, startedAt }
    emit("reply", { threadId, message: structuredClone(message), done, startedAt })
    if (done) setRunning(threadId, false)
  }

  /** Streams words into the last text part, a couple at a time. */
  const streamWords = (threadId: string, msg: ChatMessage, startedAt: number, at: number, full: string, then?: () => void) => {
    const words = full.split(/(?<=\s)/)
    const part = msg.parts[msg.parts.length - 1] as Extract<Part, { type: "text" }>
    let i = 0
    let t = at
    while (i < words.length) {
      const chunk = words.slice(i, i + 2).join("")
      i += 2
      const last = i >= words.length
      t += 45
      later(threadId, t, () => {
        part.text += chunk
        if (last && then) then()
        else push(threadId, msg, startedAt, last)
      })
    }
    return t
  }

  const axeReply = (threadId: string, req: SendRequest) => {
    const startedAt = Date.now()
    const msg: ChatMessage = { id: `m-${++n}`, role: "assistant", answerer: req.answerer, parts: [], createdAt: new Date().toISOString() }
    if (/\b(error|fail)\b/i.test(req.text)) {
      later(threadId, 900, () => {
        msg.parts = [{ type: "error", id: "e", text: "Couldn't reach the model. Check your connection and try again." }]
        push(threadId, msg, startedAt, true)
      })
      return
    }
    if (req.research) {
      researchReply(threadId, msg, startedAt)
      return
    }
    later(threadId, 120, () => {
      msg.parts = [{ type: "reasoning", id: "r", text: "They want something short they will actually keep doing.", done: false }]
      push(threadId, msg, startedAt, false)
    })
    later(threadId, 1100, () => {
      msg.parts = [
        { type: "reasoning", id: "r", text: "They want something short they will actually keep doing.", done: true, seconds: 1 },
        { type: "tool", id: "s", title: "Searching the web", kind: "search", state: "running", input: req.text.slice(0, 60) },
      ]
      push(threadId, msg, startedAt, false)
    })
    later(threadId, 2600, () => {
      msg.parts = [
        msg.parts[0]!,
        { type: "tool", id: "s", title: "Searched the web", kind: "search", state: "done", input: req.text.slice(0, 60) },
        { type: "source", id: "s1", title: "How to run a weekly review", url: "https://www.example.com/weekly-review" },
        { type: "source", id: "s2", title: "The one-page plan", url: "https://notes.example.org/one-page" },
        text("x", ""),
      ]
      push(threadId, msg, startedAt, false)
      streamWords(threadId, msg, startedAt, 0, STREAM_TEXT)
    })
  }

  /** Do it: fills the form step by step, then asks before Send. */
  const doItReply = (threadId: string, req: SendRequest) => {
    const startedAt = Date.now()
    const msg: ChatMessage = { id: `m-${++n}`, role: "assistant", answerer: req.answerer, parts: [], createdAt: new Date().toISOString() }
    const all = doItFormParts(false)
    const steps = [all.slice(0, 2), all.slice(0, 3), all.slice(0, 4), all.slice(0, 5), all]
    steps.forEach((parts, i) =>
      later(threadId, 200 + i * 450, () => {
        // The newest step is the one running.
        msg.parts = structuredClone(parts)
        const last = msg.parts[msg.parts.length - 1]
        if (last?.type === "tool") last.state = "running"
        push(threadId, msg, startedAt, false)
      }),
    )
    later(threadId, 200 + 5 * 450, () => {
      const p = SEND_QUESTION(`perm-${++n}`, threadId)
      state.permissions.push(p)
      emit("permission", p)
    })
    pendingAgent.set(threadId, { msg, startedAt, finish: (allowed) => finishDoIt(threadId, msg, startedAt, allowed) })
  }

  const finishDoIt = (threadId: string, msg: ChatMessage, startedAt: number, allowed: boolean) => {
    msg.parts = doItFormParts(allowed ? true : "declined")
    msg.parts.push(text("x", ""))
    push(threadId, msg, startedAt, false)
    streamWords(
      threadId,
      msg,
      startedAt,
      0,
      allowed ? "Done: filled in the form for Mia Lane and pressed **Send order**." : "You said no, so I stopped before pressing Send order. The form is filled in and waiting.",
    )

  }

  /** A research run: plan, three searches, reads, then the report streams in section by section. */
  const researchReply = (threadId: string, msg: ChatMessage, startedAt: number) => {
    const full = researchRun("complete", startedAt)
    const data: ResearchData = { status: "running", queries: [], steps: [], sources: [], startedAt }
    const part: Part = { type: "research", id: "research", data }
    msg.parts = [part]
    const at = (ms: number, fn: () => void) =>
      later(threadId, ms, () => {
        fn()
        push(threadId, msg, startedAt, false)
      })
    at(100, () => data.steps.push({ id: "plan-0", kind: "plan", verb: "Planning", target: "the searches", status: "running", startedAt }))
    at(700, () => {
      data.steps[0] = full.steps[0]!
      data.queries = full.queries
    })
    full.steps.slice(1, 4).forEach((step, i) => at(1000 + i * 350, () => data.steps.push({ ...step, status: "running", verb: "Searching for" })))
    at(2100, () => {
      for (let i = 1; i < 4; i++) data.steps[i] = full.steps[i]!
      data.sources = full.sources
    })
    full.steps.slice(4, 8).forEach((step, i) => at(2300 + i * 250, () => data.steps.push({ ...step, status: "running", verb: "Reading" })))
    at(3400, () => {
      for (let i = 4; i < 8; i++) data.steps[i] = full.steps[i]!
      data.steps.push({ id: "write-8", kind: "write", verb: "Writing", target: "the report", status: "running", startedAt })
      msg.parts.push(text("x", ""))
    })
    later(threadId, 3500, () => {
      streamWords(threadId, msg, startedAt, 0, REPORT, () => {
        data.steps[8] = full.steps[8]!
        data.status = "complete"
        data.endedAt = Date.now()
        msg.context = { used: 19_200, modelId: "gpt-oss-120b" }
        push(threadId, msg, startedAt, true)
      })
    })
  }

  const agentReply = (threadId: string, req: SendRequest) => {
    const startedAt = Date.now()
    const agent = req.answerer.kind === "agent" ? req.answerer.agentId : "claude-code"
    const name = state.catalog.agents.find((a) => a.id === agent)?.name ?? "The agent"
    const msg: ChatMessage = { id: `m-${++n}`, role: "assistant", answerer: req.answerer, parts: [], createdAt: new Date().toISOString() }
    const steps: [number, () => void][] = [
      [150, () => (msg.parts = [{ type: "reasoning", id: "r", text: "Start by looking at what is there.", done: false }])],
      [
        1000,
        () =>
          (msg.parts = [
            { type: "reasoning", id: "r", text: "Start by looking at what is there.", done: true, seconds: 1 },
            { type: "tool", id: "t1", title: "Reading package.json", kind: "read", state: "running", input: "package.json" },
          ]),
      ],
      [
        1800,
        () => {
          msg.parts[1] = { type: "tool", id: "t1", title: "Read package.json", kind: "read", state: "done", input: "package.json" }
          msg.parts.push({ type: "tool", id: "t2", title: "Read README.md", kind: "read", state: "done", input: "README.md" })
          msg.parts.push({ type: "tool", id: "t3", title: "Running the tests", kind: "execute", state: "running", input: "pnpm test" })
        },
      ],
    ]
    for (const [ms, fn] of steps)
      later(threadId, ms, () => {
        fn()
        push(threadId, msg, startedAt, false)
      })
    later(threadId, 2300, () => {
      const p: PermissionRequest = {
        id: `perm-${++n}`,
        threadId,
        title: `${name} wants to run a command`,
        detail: "pnpm test",
        options: [
          { id: "once", label: "Allow once", kind: "allow_once" },
          { id: "always", label: "Always allow tests here", kind: "allow_always" },
          { id: "no", label: "Don't allow", kind: "reject_once" },
        ],
      }
      state.permissions.push(p)
      emit("permission", p)
    })
    pendingAgent.set(threadId, { msg, startedAt, finish: (allowed) => finishAgent(threadId, msg, startedAt, allowed) })
  }

  const finishAgent = (threadId: string, msg: ChatMessage, startedAt: number, allowed: boolean) => {
    const last = msg.parts.findIndex((p) => p.id === "t3")
    if (last >= 0)
      msg.parts[last] = allowed
        ? { type: "tool", id: "t3", title: "Ran the tests", kind: "execute", state: "done", input: "pnpm test", output: "✓ 42 passed" }
        : { type: "tool", id: "t3", title: "Didn't run the tests", kind: "execute", state: "failed", input: "pnpm test" }
    msg.parts.push(text("x", ""))
    push(threadId, msg, startedAt, false)
    streamWords(
      threadId,
      msg,
      startedAt,
      0,
      allowed ? "All **42 tests pass**. Nothing needed changing; tell me what to work on next." : "Okay, I left the tests alone. Tell me when you want me to run them.",
    )
  }

  // ?agentoptions: Claude Code and Codex have sent their model and effort lists (a real agent does once it has run).
  const agentOpts = mockAgentOptions(params.has("agentoptions"))
  const setMode = (threadId: string, mode: AgentMode) => {
    state.threads = state.threads.map((t) => (t.id === threadId ? { ...t, mode } : t))
    emit("mode", { threadId, mode })
  }

  /** Start on the seeded plan: the card turns into the to-do list and ticks through it. */
  const runPlan = (threadId: string, partId: string) => {
    const entry = state.live[threadId]
    if (!entry) return
    const msg = entry.message
    const plan = msg.parts.find((p) => p.id === partId)
    if (plan?.type !== "plan") return
    plan.stage = "started"
    plan.entries = plan.entries.map((e, i) => ({ ...e, status: i === 0 ? "running" : "pending" }))
    push(threadId, msg, entry.startedAt, false)
    plan.entries.forEach((_, i) =>
      later(threadId, 900 * (i + 1), () => {
        plan.entries = plan.entries.map((e, j) => ({ ...e, status: j <= i ? "done" : j === i + 1 ? "running" : "pending" }))
        push(threadId, msg, entry.startedAt, false)
      }),
    )
  }

  const pendingAgent = new Map<string, { msg: ChatMessage; startedAt: number; finish: (allowed: boolean) => void }>()

  // The seeded agent chat finishes once you answer its question.
  const finishUpload = (allowed: boolean) => {
    const entry = state.live["t-upload"]
    if (!entry) return
    const msg = entry.message
    const i = msg.parts.findIndex((p) => p.id === "a1-t7")
    msg.parts[i] = allowed
      ? { type: "tool", id: "a1-t7", title: "Ran the test 50 times", kind: "execute", state: "done", input: "pnpm test upload --repeat 50", output: "✓ 50 passed" }
      : { type: "tool", id: "a1-t7", title: "Didn't run the test", kind: "execute", state: "failed", input: "pnpm test upload --repeat 50" }
    const plan = msg.parts.find((p) => p.type === "plan")
    if (plan && plan.type === "plan" && allowed) plan.entries = plan.entries.map((e) => ({ ...e, status: "done" }))
    msg.parts.push(text("a1-x2", ""))
    push("t-upload", msg, entry.startedAt, false)
    streamWords(
      "t-upload",
      msg,
      entry.startedAt,
      0,
      allowed
        ? "Fixed. The test now waits for the upload to be saved, and the count updates in the same write. It passed **50 runs in a row**."
        : "I didn't run it. The fix is in place; run `pnpm test upload --repeat 50` when you're ready.",
    )
  }

  const handlers: { [K in CommandName]: (...args: Parameters<Commands[K]>) => Awaited<ReturnType<Commands[K]>> | Promise<Awaited<ReturnType<Commands[K]>>> } = {
    "account:get": () => state.profile,
    // A pretend shell: what you type comes back, so the panel can be drawn.
    "terminal:open": (_cols, _rows, agentId) => {
      const id = `term-${Date.now()}`
      setTimeout(() => emit("terminal", { id, data: agentId ? "% claude auth login\r\nOpening your browser to sign in…\r\n" : "% " }), 50)
      return { id, title: "zsh" }
    },
    "terminal:list": () => [],
    "terminal:write": (id, data) => emit("terminal", { id, data: data === "\r" ? "\r\n% " : data }),
    "terminal:signIn": (id) => emit("terminal", { id, data: "claude auth login\r\nOpening your browser to sign in…\r\n" }),
    "terminal:resize": () => {},
    "terminal:close": () => {},
    "account:signIn": () =>
      new Promise((resolve) => {
        const id = setTimeout(() => {
          state.profile = MIA
          signInCancel = null
          resolve(MIA)
        }, 2500)
        signInCancel = () => {
          clearTimeout(id)
          resolve(null)
        }
      }),
    "account:cancelSignIn": () => {
      signInCancel?.()
      signInCancel = null
    },
    "account:signOut": () => {
      state.profile = null
      emit("account", null)
    },
    "account:openBilling": () => console.info("[mock] open billing"),
    "models:get": () => state.catalog,
    "models:refresh": () => state.catalog,
    "models:addServer": async (address) => {
      await new Promise((r) => setTimeout(r, 600))
      if (!/^https?:\/\//.test(address)) throw new Error("Nothing answered at that address.")
      const host = new URL(address).host
      const id = `custom-${state.catalog.servers.length}`
      const model = { id: `${id}|llama-3.1-8b-instruct`, model: "llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct", serverId: id, serverName: host }
      state.catalog = { ...state.catalog, servers: [...state.catalog.servers, { id, name: host, url: address, found: true, custom: true, models: [model] }], local: [...state.catalog.local, model] }
      emit("models", state.catalog)
      return state.catalog
    },
    "models:startOllama": async () => {
      await new Promise((r) => setTimeout(r, 600))
      state.catalog = {
        ...state.catalog,
        servers: state.catalog.servers.map((x) => (x.id === "ollama" ? { ...x, found: true, canStart: false, startedByAxe: true } : x)),
      }
      emit("models", state.catalog)
      return state.catalog
    },
    "models:pull": async (name) => {
      const total = 4_700_000_000
      pullStopped = false
      for (const [status, share] of [["Looking it up", 0], ["Downloading", 0.18], ["Downloading", 0.64], ["Checking the download", 1]] as const) {
        if (pullStopped) {
          emit("modelPull", null)
          throw new Error("Download stopped.")
        }
        emit("modelPull", { model: name, status, ...(share ? { total, completed: Math.round(total * share) } : {}) })
        await new Promise((r) => setTimeout(r, Number(params.get("pullms") ?? 400)))
      }
      const model = { id: `ollama|${name}`, model: name, name: name.replace(/:/, " ").toUpperCase(), serverId: "ollama", serverName: "Ollama", tools: true }
      state.catalog = {
        ...state.catalog,
        servers: state.catalog.servers.map((x) => (x.id === "ollama" ? { ...x, models: [...x.models, model] } : x)),
        local: [...state.catalog.local, model],
      }
      emit("modelPull", null)
      emit("models", state.catalog)
      return state.catalog
    },
    "models:cancelPull": () => {
      pullStopped = true
    },
    "models:warm": () => new Promise<void>((r) => setTimeout(r, Number(params.get("warmms") ?? 0))),
    "models:removeServer": (serverId) => {
      state.catalog = { ...state.catalog, servers: state.catalog.servers.filter((s) => s.id !== serverId), local: state.catalog.local.filter((m) => m.serverId !== serverId) }
      emit("models", state.catalog)
      return state.catalog
    },
    "agents:install": async (agentId) => {
      await new Promise((r) => setTimeout(r, 1200))
      state.catalog.agents = state.catalog.agents.map((a) => (a.id === agentId ? { ...a, state: "ready", note: "Works in your folders and terminal" } : a))
      emit("models", state.catalog)
      return state.catalog
    },
    "threads:list": () => state.threads,
    "threads:messages": (id) => state.messages[id] ?? [],
    "threads:rename": (id, title) => {
      state.threads = state.threads.map((t) => (t.id === id ? { ...t, title } : t))
      emit("threads", state.threads)
    },
    "threads:pin": (id, pinned) => {
      state.threads = state.threads.map((t) => (t.id === id ? { ...t, pinned } : t))
      emit("threads", state.threads)
    },
    "threads:archive": (id) => {
      state.threads = state.threads.filter((t) => t.id !== id)
      emit("threads", state.threads)
    },
    "threads:delete": (id) => {
      state.threads = state.threads.filter((t) => t.id !== id)
      delete state.messages[id]
      emit("threads", state.threads)
    },
    "chat:send": (req) => {
      let threadId = req.threadId
      if (!threadId) {
        threadId = `t-new-${++n}`
        state.threads = [
          {
            id: threadId,
            source: req.answerer.kind,
            agentId: req.answerer.kind === "agent" ? req.answerer.agentId : undefined,
            cwd: req.cwd,
            title: req.text.length > 48 ? `${req.text.slice(0, 46).trim()}…` : req.text,
            pinned: false,
            updatedAt: new Date().toISOString(),
            running: true,
            ...(req.helperId ? { helperId: req.helperId } : {}),
            ...(req.connectors?.length ? { connectors: req.connectors } : {}),
          },
          ...state.threads,
        ]
      }
      state.messages[threadId] = [
        ...(state.messages[threadId] ?? []),
        { ...user(`m-${++n}`, req.text, req.answerer), ...(req.attachments?.length ? { attachments: req.attachments } : {}) },
      ]
      setRunning(threadId, true)
      if (req.answerer.kind === "agent") agentReply(threadId, req)
      else if (req.doIt) doItReply(threadId, req)
      else axeReply(threadId, req)
      return { threadId }
    },
    "chat:stop": (threadId) => {
      for (const id of timers.get(threadId) ?? []) clearTimeout(id)
      timers.delete(threadId)
      const live = state.live[threadId]
      if (live) {
        live.message.parts = live.message.parts.map((p) =>
          p.type === "tool" && p.state === "running" ? { ...p, state: "failed" } : p.type === "reasoning" && !p.done ? { ...p, done: true } : p,
        )
        push(threadId, live.message, live.startedAt, true)
      } else setRunning(threadId, false)
      for (const p of state.permissions.filter((x) => x.threadId === threadId)) emit("permissionDone", { id: p.id })
      state.permissions = state.permissions.filter((x) => x.threadId !== threadId)
    },
    "chat:answerPermission": (requestId, optionId) => {
      const p = state.permissions.find((x) => x.id === requestId)
      state.permissions = state.permissions.filter((x) => x.id !== requestId)
      emit("permissionDone", { id: requestId })
      if (!p) return
      const allowed = p.options.find((o) => o.id === optionId)?.kind.startsWith("allow") ?? false
      if (p.threadId === "t-upload") finishUpload(allowed)
      else if (p.threadId === "t-form") {
        const entry = state.live["t-form"]
        if (entry) finishDoIt("t-form", entry.message, entry.startedAt, allowed)
      }
      else pendingAgent.get(p.threadId)?.finish(allowed)
    },
    "chat:approveResearch": (threadId, messageId) => {
      state.messages[threadId] = (state.messages[threadId] ?? []).filter((m) => m.id !== messageId)
      setRunning(threadId, true)
      const startedAt = Date.now()
      const msg: ChatMessage = { id: `m-${++n}`, role: "assistant", answerer: { kind: "axe", modelId: "sonnet-5.5" }, parts: [], createdAt: new Date().toISOString() }
      researchReply(threadId, msg, startedAt)
    },
    "chat:cancelResearch": (threadId, messageId) => {
      state.messages[threadId] = (state.messages[threadId] ?? []).map((m) =>
        m.id === messageId ? { ...m, parts: m.parts.map((p) => (p.type === "researchApproval" ? { ...p, data: { ...p.data, status: "cancelled" as const } } : p)) } : m,
      )
    },
    "agents:setMode": (threadId, mode) => setMode(threadId, mode),
    "agents:options": (threadId, agentId) => agentOpts.options(threadId, agentId),
    "agents:setOption": (threadId, agentId, configId, value) => {
      const options = agentOpts.set(threadId, agentId, configId, value)
      if (threadId) emit("agentOptions", { threadId, agentId, options })
      return options
    },
    "chat:startPlan": (threadId) => {
      const q = state.permissions.find((p) => p.threadId === threadId && p.plan)
      setMode(threadId, "acceptEdits")
      if (!q) return false
      state.permissions = state.permissions.filter((p) => p.id !== q.id)
      emit("permissionDone", { id: q.id })
      runPlan(threadId, q.plan!.partId)
      return true
    },
    "changes:list": (threadId) => state.changes[threadId] ?? [],
    "changes:keep": (threadId, paths) => {
      state.changes[threadId] = (state.changes[threadId] ?? []).filter((f) => paths && !paths.includes(f.path))
      emit("changes", { threadId, files: state.changes[threadId]! })
      return state.changes[threadId]!
    },
    "changes:undo": (threadId, paths) => {
      state.changes[threadId] = (state.changes[threadId] ?? []).filter((f) => paths && !paths.includes(f.path))
      emit("changes", { threadId, files: state.changes[threadId]! })
      return state.changes[threadId]!
    },
    "chat:rewindPreview": (threadId, messageId) => {
      const list = state.messages[threadId] ?? []
      const i = list.findIndex((m) => m.id === messageId)
      return { replies: list.slice(i).filter((m) => m.role === "assistant").length, files: i > 0 ? 2 : (state.changes[threadId]?.length ?? 0) }
    },
    "chat:rewind": (threadId, messageId) => {
      const list = state.messages[threadId] ?? []
      const i = list.findIndex((m) => m.id === messageId)
      const msg = list[i]
      state.messages[threadId] = list.slice(0, Math.max(0, i))
      return { messages: state.messages[threadId]!, text: msg ? msg.parts.map((p) => (p.type === "text" ? p.text : "")).join("") : "" }
    },
    "chat:commands": (threadId) => (state.threads.find((t) => t.id === threadId)?.agentId === "claude-code" ? AGENT_COMMANDS : AGENT_COMMANDS.filter((c) => c.source === "skill")),
    "agents:commands": () => AGENT_COMMANDS.filter((c) => c.source === "skill"),
    "agents:instructions": (threadId): InstructionsFile[] => {
      const t = state.threads.find((x) => x.id === threadId)
      const cwd = t?.cwd ?? "/Users/mia"
      return t?.agentId === "claude-code"
        ? [{ name: "CLAUDE.md", path: `${cwd}/CLAUDE.md`, exists: true }, { name: "AGENTS.md", path: `${cwd}/AGENTS.md`, exists: true }]
        : [{ name: "AGENTS.md", path: `${cwd}/AGENTS.md`, exists: false }]
    },
    "agents:openInstructions": (_threadId, name) => console.info("[mock] open", name),
    "memory:list": () => state.memory,
    "memory:add": (t) => {
      const clean = t.replace(/\s+/g, " ").trim()
      if (!clean) throw new Error("Write something to remember.")
      const at = new Date().toISOString()
      state.memory = [...state.memory, { id: `mem-new-${++n}`, text: clean, createdAt: at, updatedAt: at }]
      return state.memory
    },
    "memory:update": (id, t) => {
      state.memory = state.memory.map((m) => (m.id === id ? { ...m, text: t.trim(), updatedAt: new Date().toISOString() } : m))
      return state.memory
    },
    "memory:delete": (id) => {
      state.memory = state.memory.filter((m) => m.id !== id)
      return state.memory
    },
    ...libraries.handlers,
    ...updates.handlers,
    ...powerMock.handlers,
    ...watchingMock.handlers,
    "chat:setConnectors": (threadId, ids) => {
      state.threads = state.threads.map((t) => (t.id === threadId ? { ...t, connectors: ids } : t))
      emit("threads", state.threads)
    },
    "settings:get": () => state.settings,
    "settings:set": (patch) => {
      state.settings = { ...state.settings, ...patch }
      return state.settings
    },
    "app:pickFolder": () => "/Users/mia/Code/axe-web",
    "mention:folders": (query, recent) => {
      const all = [...recent, "/Users/mia/Code/axe-web", "/Users/mia/Code/axe-mac", "/Users/mia/Documents/Launch"]
      const q = query.replace(/^~/, "").toLowerCase()
      return [...new Set(all)].filter((p) => p.toLowerCase().includes(q)).slice(0, 8).map((path) => ({ path, display: path.replace("/Users/mia", "~") }))
    },
    "mention:apps": () => ["Figma", "Finder", "Linear", "Mail", "Notes", "Notion", "Safari", "Slack", "Xcode"],
    "app:pickFiles": () => [MOCK_PHOTO, MOCK_PDF],
    "app:attachPaths": (paths) => paths.map((p) => ({ ...MOCK_PDF, path: p, name: p.split("/").pop() ?? p })),
    "app:attachBytes": (name, mime, bytes) => ({ path: `/mock/${name}`, name, mime, size: bytes.byteLength, ...(mime.startsWith("image/") ? { preview: MOCK_PHOTO.preview } : {}) }),
    "app:openExternal": (url) => console.info("[mock] open", url),
    "quick:toggle": () => emit("quickShown", { at: Date.now() }),
    "quick:hide": () => console.info("[mock] hide quick bar"),
    "tray:hide": () => console.info("[mock] hide the menu bar chat"),
    "tray:openInMain": (threadId) => console.info("[mock] open in the app", threadId),
    "tray:open": (where) => console.info("[mock] open in the app", where),
    "quick:resize": () => {},
    "quick:openInMain": (threadId) => console.info("[mock] open in main", threadId),
    "quick:openWatch": (id) => console.info("[mock] open watch", id),
    "quick:capture": (what) => (what === "screen" ? MOCK_SCREEN : MOCK_COPIED),
    // ?access=granted: Screen Recording and Accessibility are on, so Do it stays on without a chip.
    "doit:access": () => params.get("access") === "granted",
    "voice:microphone": () => (params.get("mic") === "denied" ? "denied" : "granted"),
    "voice:openMicSettings": () => console.info("[mock] open microphone settings"),
    "voice:transcribe": async () => {
      await new Promise((r) => setTimeout(r, 400))
      return "Find a quiet table for four on Friday at eight, somewhere near the river"
    },
    "voice:onDevice": () => false,
    "voice:transcribeOnDevice": () => null,
  }

  const bridge: AxeBridge = {
    invoke: async (command, ...args) => {
      await new Promise((r) => setTimeout(r, 30))
      const fn = handlers[command] as (...a: unknown[]) => unknown
      return structuredClone(await fn(...args)) as never
    },
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener as (p: unknown) => void)
      listeners.set(event, set)
      // Whatever is already happening reaches a new listener, as the engine would replay it.
      if (event === "reply")
        setTimeout(() => {
          for (const [threadId, l] of Object.entries(state.live))
            (listener as (p: Events["reply"]) => void)({ threadId, message: structuredClone(l.message), done: false, startedAt: l.startedAt })
        }, 0)
      if (event === "permission") setTimeout(() => state.permissions.forEach((p) => (listener as (p: PermissionRequest) => void)(structuredClone(p))), 0)
      // Chats that finish as the window opens: their last reply's final update.
      if (event === "reply")
        setTimeout(() => {
          for (const threadId of state.finished) {
            const last = (state.messages[threadId] ?? []).at(-1)
            if (last) (listener as (p: Events["reply"]) => void)({ threadId, message: structuredClone(last), done: true, startedAt: Date.now() })
          }
        }, 0)
      return () => set.delete(listener as (p: unknown) => void)
    },
    platform: (params.get("platform") as AxeBridge["platform"]) ?? "darwin",
    pathOf: () => "",
  }

  window.axe = bridge
  window.__axeMock = { emit, state }
}
