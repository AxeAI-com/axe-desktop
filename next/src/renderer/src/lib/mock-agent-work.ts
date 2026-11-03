// The agent work view for the mock engine (?mock=agentwork): a plan waiting for Start, an
// agent chat with changed files to review, a chat to rewind, and the sidebar's Working now.

import type { Answerer, ChatMessage, FileChange, Part, PermissionRequest, ThreadSummary } from "@shared/types"

const CLAUDE: Answerer = { kind: "agent", agentId: "claude-code" }
const CODEX: Answerer = { kind: "agent", agentId: "codex" }

const text = (id: string, t: string): Part => ({ type: "text", id, text: t })
const user = (id: string, t: string, answerer: Answerer): ChatMessage => ({ id, role: "user", parts: [text(`${id}-t`, t)], answerer })

export const PLAN_STEPS = [
  "Wait in the test until the upload is saved, instead of reading the count straight away.",
  "Make the daily count update in the same database write as the upload.",
  "Run the test 50 times to be sure it no longer fails.",
  "Leave a one-line note in the changelog.",
]

const PLAN_TEXT = `The test reads the daily count before the upload has finished saving. Here's how I'd fix it:

1. **Wait** in the test until the upload is saved, instead of reading the count straight away.
2. Make the daily count update in the same database write as the upload.
3. Run the test 50 times to be sure it no longer fails.
4. Leave a one-line note in the changelog.

### Why not retry the test
A retry hides the race. Saving and counting in one write removes it.`

const TEST_BEFORE = `import { upload, dailyCount, fakeFile } from "./helpers"

describe("uploads", () => {
  it("counts today's uploads", async () => {
    await upload(file)
    const count = await dailyCount()
    expect(count).toBe(1)
  })

  it("refuses files over 25 MB", async () => {
    const big = fakeFile(30)
    await expect(upload(big)).rejects.toThrow()
  })
})
`
const TEST_AFTER = `import { upload, dailyCount, fakeFile, waitFor, MB } from "./helpers"

describe("uploads", () => {
  it("counts today's uploads", async () => {
    await upload(file)
    const count = await waitFor(() => dailyCount(),
      (n) => n === 1)
    expect(count).toBe(1)
  })

  it("refuses files over 25 MB", async () => {
    const big = fakeFile(30 * MB)
    await expect(upload(big)).rejects.toThrow()
  })
})
`
const SAVE_BEFORE = `export async function save(file: Upload) {
  await db.insert(uploads).values(file)
  await bumpDailyCount(file.userId)
}
`
const SAVE_AFTER = `export async function save(file: Upload) {
  await db.transaction(async (tx) => {
    await tx.insert(uploads).values(file)
    await bumpDailyCount(file.userId, tx)
  })
}
`

// A short version of the test change, for the board screen: the whole diff fits in the panel.
const DIFF_BEFORE = `  it("counts today's uploads", async () => {
    await upload(file)
    const count = await dailyCount()
    expect(count).toBe(1)
  })
`
const DIFF_AFTER = `  it("counts today's uploads", async () => {
    await upload(file)
    const count = await waitFor(() => dailyCount(),
      (n) => n === 1)
    expect(count).toBe(1)
  })
`

const root = "/Users/mia/Code/axe-web"
export const UPLOAD_CHANGES: FileChange[] = [
  { path: `${root}/CHANGELOG.md`, rel: "CHANGELOG.md", before: "# Changelog\n\n", after: "# Changelog\n\n- Uploads: the daily count no longer misses a file saved a moment earlier.\n" },
  { path: `${root}/src/uploads/save.ts`, rel: "src/uploads/save.ts", before: SAVE_BEFORE, after: SAVE_AFTER },
  { path: `${root}/test/upload.test.ts`, rel: "test/upload.test.ts", before: TEST_BEFORE, after: TEST_AFTER },
  { path: `${root}/test/fixtures/big.bin`, rel: "test/fixtures/big.bin", before: null, after: "", binary: true },
]

export function agentWorkSeed(now: number, board?: "agentchat" | "agentworking") {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString()
  const threads: ThreadSummary[] = [
    { id: "t-plan", source: "agent", agentId: "claude-code", cwd: root, title: "Make uploads resumable", pinned: false, updatedAt: ago(2), running: true, mode: "plan" },
    {
      id: "t-review",
      source: "agent",
      agentId: "claude-code",
      cwd: `/Users/mia/Library/Application Support/Axe AI/copies/axe-web-3f9a2c1d`,
      copy: { kind: "worktree", source: root, branch: "axe/fix-the-flaky-upload-test-3f9a2c1d" },
      title: "Fix the daily upload count",
      pinned: false,
      updatedAt: ago(8),
      mode: "acceptEdits",
    },
    { id: "t-docs", source: "agent", agentId: "codex", cwd: "/Users/mia/Code/docs-site", title: "Tidy the docs folder", pinned: false, updatedAt: ago(40), mode: "full" },
  ]

  const proposed: Extract<Part, { type: "plan" }> = {
    type: "plan",
    id: "pl-plan",
    summary: "The test reads the daily count before the upload has finished saving. Here's how I'd fix it:",
    entries: PLAN_STEPS.map((t) => ({ text: t, status: "pending" as const })),
    text: PLAN_TEXT,
    stage: "proposed",
  }
  const planReply: ChatMessage = {
    id: "pl-a1",
    role: "assistant",
    answerer: CLAUDE,
    parts: [
      { type: "reasoning", id: "pl-r", text: "One failure in five points at a race.", done: true, seconds: 4 },
      { type: "tool", id: "pl-t1", title: "Read upload.test.ts", kind: "read", state: "done", input: "test/upload.test.ts" },
      { type: "tool", id: "pl-t2", title: "Read save.ts", kind: "read", state: "done", input: "src/uploads/save.ts" },
      { type: "tool", id: "pl-t3", title: "Read count.ts", kind: "read", state: "done", input: "src/uploads/count.ts" },
      { type: "tool", id: "pl-t4", title: "Read helpers.ts", kind: "read", state: "done", input: "test/helpers.ts" },
      proposed,
    ],
  }

  const messages: Record<string, ChatMessage[]> = {
    "t-plan": [user("pl-u1", "The upload test fails about one run in five. Find out why and fix it.", CLAUDE), planReply],
    "t-review": [
      user("rv-u1", "The upload test fails about one run in five. Find out why and fix it.", CLAUDE),
      {
        id: "rv-a1",
        role: "assistant",
        answerer: CLAUDE,
        parts: [
          { type: "tool", id: "rv-t1", title: "Read upload.test.ts", kind: "read", state: "done", input: "test/upload.test.ts" },
          {
            type: "plan",
            id: "rv-p",
            summary: "The test reads the daily count before the upload has finished saving.",
            entries: PLAN_STEPS.map((t) => ({ text: t, status: "done" as const })),
            stage: "started",
          },
          { type: "tool", id: "rv-t2", title: "Edited upload.test.ts", kind: "edit", state: "done", input: "test/upload.test.ts", diff: [{ path: "test/upload.test.ts", before: TEST_BEFORE, after: TEST_AFTER }] },
          { type: "tool", id: "rv-t3", title: "Edited save.ts", kind: "edit", state: "done", input: "src/uploads/save.ts", diff: [{ path: "src/uploads/save.ts", before: SAVE_BEFORE, after: SAVE_AFTER }] },
          { type: "tool", id: "rv-t4", title: "Ran the test 50 times", kind: "execute", state: "done", input: "pnpm test upload --repeat 50", output: "✓ 50 passed" },
          text("rv-x", "Fixed. The test now waits for the upload to be saved, and the count updates in the same write. It passed **50 runs in a row**."),
        ],
        context: { used: 61_200, size: 200_000, cost: { amount: 0.31, currency: "USD" } },
      },
    ],
    "t-docs": [
      user("dc-u1", "Sort the docs folder into guides, reference and archive.", CODEX),
      {
        id: "dc-a1",
        role: "assistant",
        answerer: CODEX,
        parts: [
          { type: "tool", id: "dc-t1", title: "Moved 38 files into 3 folders", kind: "move", state: "done", input: "docs/" },
          text("dc-x1", "Done. Guides, Reference and Archive, with a short index in each."),
        ],
      },
      user("dc-u2", "Now delete the drafts older than a month.", CODEX),
      {
        id: "dc-a2",
        role: "assistant",
        answerer: CODEX,
        parts: [
          { type: "tool", id: "dc-t2", title: "Deleted 6 old drafts", kind: "delete", state: "done", input: "docs/archive/drafts" },
          text("dc-x2", "Deleted 6 drafts last changed before 22 September."),
        ],
      },
    ],
  }

  const permissions: PermissionRequest[] = [
    {
      id: "perm-plan",
      threadId: "t-plan",
      title: "Ready to code?",
      options: [
        { id: "exit-plan-default", label: "Yes, manually approve edits", kind: "allow_once" },
        { id: "reject", label: "No, keep planning", kind: "reject_once" },
      ],
      plan: { partId: "pl-plan" },
    },
  ]

  const live: Record<string, { message: ChatMessage; startedAt: number }> = { "t-plan": { message: planReply, startedAt: now - 51_000 } }
  let changes = { "t-review": UPLOAD_CHANGES, "t-docs": UPLOAD_CHANGES.slice(0, 1) } as Record<string, FileChange[]>

  // The board screens (?mock=agentchat, ?mock=agentworking): the upload chat in the middle of its work,
  // waiting on a command (AgentChat) or running it (AgentWorking).
  if (board) {
    const review = threads.find((t) => t.id === "t-review")!
    // Waiting on a command is paused, not running: Undo stays available (AgentChat).
    review.running = board === "agentworking"
    review.updatedAt = ago(1)
    review.mode = board === "agentchat" ? "ask" : "acceptEdits"
    const running: Part = {
      type: "tool",
      id: "bd-t5",
      title: "Running the test 50 times",
      kind: "execute",
      state: "running",
      input: "pnpm test upload --repeat 50",
    }
    const plan: Part = {
      type: "plan",
      id: "bd-p",
      entries: (board === "agentchat"
        ? ["Make the test wait for the upload.", "Save the upload and the daily count together.", "Run the test 50 times.", "Add a line to the changelog."]
        : PLAN_STEPS
      ).map((t, i) => ({ text: t, status: i < 2 ? ("done" as const) : i === 2 ? ("running" as const) : ("pending" as const) })),
      stage: "started",
    }
    const reply: ChatMessage = {
      id: "bd-a1",
      role: "assistant",
      answerer: CLAUDE,
      parts:
        board === "agentchat"
          ? [
              { type: "reasoning", id: "bd-r", text: "One failure in five points at a race.", done: true, seconds: 3 },
              { type: "tool", id: "bd-t1", title: "Read 3 files, ran the test 10 times. 2 runs failed.", kind: "read", state: "done", input: "test/upload.test.ts" },
              text("bd-x", "The test reads the count before the upload finishes saving. Fixing it:"),
              plan,
              {
                type: "tool",
                id: "bd-t6",
                title: "Edited 2 files",
                kind: "edit",
                state: "done",
                input: "test/upload.test.ts",
                diff: [
                  { path: "test/upload.test.ts", before: TEST_BEFORE, after: TEST_AFTER },
                  { path: "src/uploads/save.ts", before: SAVE_BEFORE, after: SAVE_AFTER },
                ],
              },
              running,
            ]
          : [
              { type: "reasoning", id: "bd-r", text: "One failure in five points at a race.", done: true, seconds: 3 },
              { type: "tool", id: "bd-t1", title: "Read upload.test.ts", kind: "read", state: "done", input: "test/upload.test.ts" },
              { type: "tool", id: "bd-t2", title: "Read save.ts", kind: "read", state: "done", input: "src/uploads/save.ts" },
              { type: "tool", id: "bd-t3", title: "Read count.ts", kind: "read", state: "done", input: "src/uploads/count.ts" },
              { type: "tool", id: "bd-t4", title: "Ran the test 10 times", kind: "execute", state: "done", input: "pnpm test upload --repeat 10", output: "✓ 8 passed\n✗ 2 failed" },
              text("bd-x", "The test reads the daily count before the upload has finished saving. Here's how I'm fixing it:"),
              plan,
              { type: "tool", id: "bd-t6", title: "Edited upload.test.ts", kind: "edit", state: "done", input: "test/upload.test.ts", diff: [{ path: "test/upload.test.ts", before: TEST_BEFORE, after: TEST_AFTER }] },
              { type: "tool", id: "bd-t7", title: "Edited save.ts", kind: "edit", state: "done", input: "src/uploads/save.ts", diff: [{ path: "src/uploads/save.ts", before: SAVE_BEFORE, after: SAVE_AFTER }] },
              running,
            ],
    }
    // The chat has history, so it sits scrolled to the bottom like the board's.
    const earlier: ChatMessage[] =
      board === "agentchat"
        ? [
            user("bd-u0", "Is the upload test the only one that fails now and then?", CLAUDE),
            {
              id: "bd-a0",
              role: "assistant",
              answerer: CLAUDE,
              parts: [
                text(
                  "bd-x0",
                  "Yes. I ran the whole suite 20 times and only the upload test failed, about one run in five. The other tests passed every time, so the problem is in this one test and the code it calls.\n\nWhat do you want me to do next?",
                ),
              ],
            },
          ]
        : []
    messages["t-review"] = [...earlier, user("bd-u", "The upload test fails about one run in five. Find out why and fix it.", CLAUDE), reply]
    live["t-review"] = { message: reply, startedAt: now - 42_000 }
    if (board === "agentchat") {
      permissions.push({
        id: "perm-board",
        threadId: "t-review",
        title: "Claude Code wants to run a command",
        detail: "pnpm test upload --repeat 50",
        options: [
          { id: "once", label: "Allow once", kind: "allow_once" },
          { id: "always", label: "Always allow tests here", kind: "allow_always" },
          { id: "no", label: "Don't allow", kind: "reject_once" },
        ],
      })
      changes = { ...changes, "t-review": [UPLOAD_CHANGES[0]!, UPLOAD_CHANGES[1]!, { ...UPLOAD_CHANGES[2]!, before: DIFF_BEFORE, after: DIFF_AFTER }, { ...UPLOAD_CHANGES[3]!, before: "" }] }
    } else changes = { ...changes, "t-review": UPLOAD_CHANGES.slice(1, 3) }
  }

  return {
    threads,
    messages,
    permissions,
    live,
    changes,
    /** Finished while you were elsewhere: Done in the sidebar until opened. */
    finished: ["t-docs"],
  }
}
