import { describe, expect, it, vi } from "vitest"

import type { AgentMode, ModelCatalog, ReplyUpdate, SendRequest, ThreadSummary } from "@shared/types"

import { PhoneControl } from "../../src/main/remote/phone-chat"

// A paired phone driving chats (src/main/remote/phone-chat.ts; threat model section 6).

const catalog: ModelCatalog = {
  axe: { defaultModelId: "auto", models: [{ id: "auto", label: "Auto", provider: "axe" } as ModelCatalog["axe"]["models"][number]] },
  agents: [
    { id: "claude-code", name: "Claude Code", note: "", state: "ready" },
    { id: "codex", name: "Codex", note: "", state: "install" },
  ],
  local: [],
  servers: [],
}

const thread = (t: Partial<ThreadSummary>): ThreadSummary => ({ id: "t1", source: "agent", agentId: "claude-code", cwd: "/Users/david/shop", title: "Fix the checkout test", pinned: false, updatedAt: "2026-10-28T10:00:00Z", ...t }) as ThreadSummary

function rig() {
  const sent: Record<string, unknown>[] = []
  const events: { kind: string; body: unknown; chat?: string }[] = []
  const log: { text: string; bypass?: boolean }[] = []
  const sends: SendRequest[] = []
  const modes: [string, AgentMode][] = []
  const stopped: string[] = []
  const answers: [string, string][] = []
  const saved: { name: string; bytes: number }[] = []
  const reads: string[] = []
  const pictures = new Map<string, Uint8Array>()
  let now = 1_000_000
  const threads = [thread({}), thread({ id: "t2", source: "axe", agentId: undefined, title: "Plan the launch" })]
  const control = new PhoneControl({
    chat: {
      listThreads: async () => threads,
      messages: async () => [],
      send: async (r) => (sends.push(r), { threadId: r.threadId ?? "t-new" }),
      stop: (id) => void stopped.push(id),
      setMode: async (id, mode) => void modes.push([id, mode]),
      modeOf: () => "ask",
      defaultMode: () => "ask",
      isRunning: () => false,
      title: (id) => threads.find((t) => t.id === id)?.title ?? "New chat",
      answer: (rq, opt) => void answers.push([rq, opt]),
      image: async (chat, part) => {
        reads.push(`${chat}:${part}`)
        const bytes = pictures.get(`${chat}:${part}`)
        if (!bytes) throw new Error("That isn't a picture in this chat.")
        return { mime: "image/png", bytes }
      },
    },
    saveFile: (name, bytes) => (saved.push({ name, bytes: bytes.byteLength }), { path: `/tmp/${name}`, name, mime: "image/png", size: bytes.byteLength }),
    catalog: async () => catalog,
    phoneName: async () => "David's iPhone",
    sendTo: async (_p, m) => (sent.push(m), true),
    broadcast: (kind, body, chat) => void events.push({ kind, body, chat }),
    log: (e) => void log.push({ text: e.text, bypass: e.bypass }),
    now: () => now,
  })
  const cmd = (c: Record<string, unknown>, id = "1", phone = "phone-1") => control.handle(phone, { type: "cmd", id, cmd: c })
  return { control, cmd, sent, events, log, sends, modes, stopped, threads, answers, saved, reads, pictures, tick: (ms: number) => (now += ms) }
}

describe("a phone driving chats", () => {
  it("lists chats with what can answer (only agents that are ready)", async () => {
    const r = rig()
    await r.cmd({ type: "chats" })
    const res = r.sent[0] as { ok: boolean; data: { chats: { id: string }[]; catalog: { agents: { id: string }[] } } }
    expect(res.ok).toBe(true)
    expect(res.data.chats.map((c) => c.id)).toEqual(["t1", "t2"])
    expect(res.data.catalog.agents.map((a) => a.id)).toEqual(["claude-code"])
  })

  it("starts a Claude Code chat in Bypass from the phone, and the Mac says so", async () => {
    const r = rig()
    await r.cmd({ type: "send", chat: null, text: "Fix the checkout test", answerer: { kind: "agent", agentId: "claude-code" }, mode: "full" })
    expect(r.sends[0]).toMatchObject({ threadId: null, answerer: { kind: "agent", agentId: "claude-code" }, mode: "full", keepDefaults: true })
    // With no folder picked, it works where you last worked with that agent on the Mac.
    expect(r.sends[0]?.cwd).toBe("/Users/david/shop")
    expect(r.log).toEqual([{ text: "Started New chat with Claude Code in Bypass", bypass: true }])
  })

  it("won't start an agent chat when the Mac has no folder for it yet", async () => {
    const r = rig()
    r.threads.length = 0
    await r.cmd({ type: "send", chat: null, text: "hi", answerer: { kind: "agent", agentId: "claude-code" } })
    expect(r.sends).toEqual([])
    expect((r.sent[0] as { error: string }).error).toBe("Pick a folder for this agent.")
  })

  it("lists the Mac's recent folders, newest first, one per folder", async () => {
    const r = rig()
    r.threads.push(
      thread({ id: "t3", agentId: "codex", cwd: "/Users/david/shop", updatedAt: "2026-10-27T10:00:00Z" }),
      thread({ id: "t4", cwd: "/Users/david/site/", updatedAt: "2026-10-29T10:00:00Z" }),
      thread({ id: "t5", source: "axe", agentId: undefined, cwd: undefined }),
    )
    await r.cmd({ type: "folders" })
    const res = r.sent[0] as { ok: boolean; data: { folders: { path: string; label: string; agentIds: string[]; lastUsedAt: string }[] } }
    expect(res.data.folders).toEqual([
      { path: "/Users/david/site/", label: "site", lastUsedAt: "2026-10-29T10:00:00Z", agentIds: ["claude-code"] },
      { path: "/Users/david/shop", label: "shop", lastUsedAt: "2026-10-28T10:00:00Z", agentIds: ["claude-code", "codex"] },
    ])
  })

  it("keeps the list to 20 folders", async () => {
    const r = rig()
    for (let n = 0; n < 30; n++) r.threads.push(thread({ id: `x${n}`, cwd: `/work/p${n}`, updatedAt: `2026-09-${String(n + 1).padStart(2, "0")}T10:00:00Z` }))
    await r.cmd({ type: "folders" })
    expect((r.sent[0] as { data: { folders: unknown[] } }).data.folders).toHaveLength(20)
  })

  it("starts an agent chat in a folder from the list, and refuses any other", async () => {
    const r = rig()
    r.threads.push(thread({ id: "t4", cwd: "/Users/david/site", updatedAt: "2026-10-29T10:00:00Z" }))
    const agent = { kind: "agent", agentId: "claude-code" }
    await r.cmd({ type: "send", chat: null, text: "hi", answerer: agent, folder: "/Users/david/site" })
    expect(r.sends[0]?.cwd).toBe("/Users/david/site")
    for (const [n, folder] of ["/Users/david", "/Users/david/site/../..", "/etc", "/Users/david/SITE"].entries())
      await r.cmd({ type: "send", chat: null, text: "hi", answerer: agent, folder }, `bad${n}`)
    expect(r.sends).toHaveLength(1)
    expect(r.sent.slice(1).map((m) => (m as { error?: string }).error)).toEqual(Array(4).fill("Pick a folder from the list."))
  })

  it("a chat started on a phone asks first, unless the phone picks a mode", async () => {
    const r = rig()
    const agent = { kind: "agent", agentId: "claude-code" }
    await r.cmd({ type: "send", chat: null, text: "hi", answerer: agent })
    await r.cmd({ type: "send", chat: null, text: "hi", answerer: agent, mode: "plan" }, "2")
    expect(r.sends.map((s) => s.mode)).toEqual(["ask", "plan"])
  })

  it("switches a chat's mode, Bypass included, and logs it", async () => {
    const r = rig()
    await r.cmd({ type: "mode", chat: "t1", mode: "full" })
    expect(r.modes).toEqual([["t1", "full"]])
    expect(r.log).toEqual([{ text: "Switched Fix the checkout test to Bypass", bypass: true }])
    await r.cmd({ type: "mode", chat: "t1", mode: "acceptEdits" })
    expect(r.log[1]).toEqual({ text: "Switched Fix the checkout test to Auto-accept edits", bypass: false })
  })

  it("stops a reply", async () => {
    const r = rig()
    await r.cmd({ type: "stop", chat: "t1" })
    expect(r.stopped).toEqual(["t1"])
  })

  it("drops anything that isn't on the list", async () => {
    const r = rig()
    for (const bad of [
      { type: "shell", command: "rm -rf ~" },
      { type: "send", chat: null, text: "hi", cwd: "/" },
      { type: "settings", fullAccess: true },
      { type: "mode", chat: "t1", mode: "yolo" },
      { type: "send", chat: null, text: "" },
    ])
      await r.cmd(bad)
    await r.control.handle("phone-1", { type: "run", cmd: { type: "chats" } })
    expect(r.sent).toEqual([])
    expect(r.sends).toEqual([])
  })

  it("only uses models and agents this computer offers", async () => {
    const r = rig()
    await r.cmd({ type: "send", chat: null, text: "hi", answerer: { kind: "axe", modelId: "made-up" } })
    await r.cmd({ type: "send", chat: null, text: "hi", answerer: { kind: "agent", agentId: "codex" } }, "2")
    await r.cmd({ type: "send", chat: "t1", text: "hi", answerer: { kind: "agent", agentId: "gemini" } }, "3")
    expect(r.sends).toEqual([])
    expect(r.sent.map((m) => (m as { error?: string }).error)).toEqual(["That model isn't available.", "That agent isn't ready on this computer.", "This chat stays with its agent."])
  })

  it("keeps a chat's agent, and uses the default model for Axe chats", async () => {
    const r = rig()
    await r.cmd({ type: "send", chat: "t1", text: "Run the tests again" })
    await r.cmd({ type: "send", chat: "t2", text: "Shorter please" }, "2")
    expect(r.sends.map((s) => s.answerer)).toEqual([
      { kind: "agent", agentId: "claude-code" },
      { kind: "axe", modelId: "auto" },
    ])
  })

  it("slows down a phone that sends too much", async () => {
    const r = rig()
    for (let i = 0; i < 45; i++) await r.cmd({ type: "chats" }, String(i))
    expect(r.sent.filter((m) => (m as { ok: boolean }).ok === false)).toHaveLength(5)
  })

  it("streams replies at most every 120 ms, and always the last one", async () => {
    vi.useFakeTimers()
    const r = rig()
    const u = (n: number, done = false): ReplyUpdate => ({ threadId: "t1", message: { id: "m", role: "assistant", parts: [{ type: "text", id: "p", text: `x${n}` }] }, done, startedAt: 0 })
    for (let i = 0; i < 10; i++) r.control.reply(u(i))
    r.control.reply(u(10, true))
    vi.advanceTimersByTime(500)
    vi.useRealTimers()
    const replies = r.events.filter((e) => e.kind === "reply")
    expect(replies.length).toBeLessThanOrEqual(2)
    expect(replies.at(-1)?.body).toMatchObject({ chat: "t1", done: true })
  })

  it("answers what the agent waits on, only with the options it offered, once", async () => {
    const r = rig()
    r.control.asked({ id: "q1", threadId: "t1", title: "Run npm test", detail: "npm test", options: [{ id: "yes", label: "Allow", kind: "allow_once" }, { id: "no", label: "Not now", kind: "reject_once" }] })
    expect(r.events.at(-1)).toMatchObject({ kind: "ask", chat: "t1", body: { request: { id: "q1", title: "Run npm test", detail: "npm test" } } })
    await r.cmd({ type: "answer", chat: "t2", request: "q1", option: "yes" }, "a")
    await r.cmd({ type: "answer", chat: "t1", request: "q1", option: "always" }, "b")
    await r.cmd({ type: "answer", chat: "t1", request: "q9", option: "yes" }, "c")
    expect(r.answers).toEqual([])
    await r.cmd({ type: "read", chat: "t1" }, "d")
    expect((r.sent.at(-1) as { data: { waiting: { id: string }[] } }).data.waiting.map((w) => w.id)).toEqual(["q1"])
    await r.cmd({ type: "answer", chat: "t1", request: "q1", option: "yes" }, "e")
    expect(r.answers).toEqual([["q1", "yes"]])
    expect(r.log.at(-1)?.text).toBe("Allowed Run npm test in Fix the checkout test")
    await r.cmd({ type: "answer", chat: "t1", request: "q1", option: "yes" }, "f")
    expect(r.answers).toHaveLength(1)
  })

  it("forgets a question once it's answered on the Mac", async () => {
    const r = rig()
    r.control.asked({ id: "q1", threadId: "t1", title: "Edit a.txt", options: [{ id: "yes", label: "Allow", kind: "allow_once" }] })
    r.control.answered("t1", "q1")
    await r.cmd({ type: "answer", chat: "t1", request: "q1", option: "yes" })
    expect(r.answers).toEqual([])
  })

  const piece = (upload: string, index: number, total: number, data: string, size: number, name = "photo.png") => ({ type: "upload", upload, name, size, index, total, data })

  it("takes a file in pieces and sends it with a message, once", async () => {
    const r = rig()
    const a = Buffer.from("hello ").toString("base64")
    const b = Buffer.from("world").toString("base64")
    await r.cmd(piece("upload-1", 0, 2, a, 11, "../../etc/photo.png"), "u1")
    await r.cmd(piece("upload-1", 1, 2, b, 11, "../../etc/photo.png"), "u2")
    expect(r.saved).toEqual([{ name: "photo.png", bytes: 11 }])
    await r.cmd({ type: "send", chat: "t1", text: "Use this", attachments: ["upload-1"] }, "s1")
    expect(r.sends[0]?.attachments?.map((x) => x.name)).toEqual(["photo.png"])
    expect(r.log.at(-1)?.text).toBe("Sent a message with a file in Fix the checkout test")
    await r.cmd({ type: "send", chat: "t1", text: "Again", attachments: ["upload-1"] }, "s2")
    expect(r.sends).toHaveLength(1)
  })

  it("refuses pieces out of order, too big, or another phone's file", async () => {
    const r = rig()
    const x = Buffer.from("abc").toString("base64")
    await r.cmd(piece("upload-2", 1, 2, x, 6), "1")
    await r.cmd(piece("upload-3", 0, 1, Buffer.from("abcdef").toString("base64"), 3), "2")
    await r.cmd(piece("upload-4", 0, 1, x, 3), "3")
    await r.cmd({ type: "send", chat: "t1", text: "Mine now", attachments: ["upload-4"] }, "4", "phone-2")
    expect(r.saved.map((f) => f.bytes)).toEqual([3])
    expect(r.sends).toEqual([])
    expect(r.sent.filter((m) => (m as { ok: boolean }).ok === false)).toHaveLength(3)
  })

  describe("pictures an agent made (spec 0035)", () => {
    type Piece = { ok: boolean; error?: string; data?: { mime: string; size: number; total: number; index: number; data: string } }

    it("sends a picture of that chat in pieces that put back together exactly", async () => {
      const r = rig()
      const bytes = new Uint8Array(250 * 1024).map((_, i) => i % 251)
      r.pictures.set("t1:img1", bytes)
      await r.cmd({ type: "image", chat: "t1", part: "img1", index: 0 }, "a")
      const first = r.sent[0] as Piece
      expect(first.ok).toBe(true)
      expect(first.data).toMatchObject({ mime: "image/png", size: bytes.length, total: 3, index: 0 })
      for (let index = 1; index < 3; index++) await r.cmd({ type: "image", chat: "t1", part: "img1", index }, `p${index}`)
      const pieces = (r.sent as Piece[]).map((p) => Buffer.from(p.data!.data, "base64"))
      expect(Buffer.concat(pieces).equals(Buffer.from(bytes))).toBe(true)
      // The copy is read once for the whole picture.
      expect(r.reads).toEqual(["t1:img1"])
    })

    it("refuses a part that isn't a picture in that chat, and pieces past the end", async () => {
      const r = rig()
      r.pictures.set("t1:img1", new Uint8Array(10))
      await r.cmd({ type: "image", chat: "t2", part: "img1", index: 0 }, "a")
      await r.cmd({ type: "image", chat: "t1", part: "img1", index: 1 }, "b")
      expect((r.sent as Piece[]).map((p) => p.ok)).toEqual([false, false])
      expect((r.sent[1] as Piece).error).toBe("That piece isn't part of the picture.")
    })

    it("never takes a path", async () => {
      const r = rig()
      await r.cmd({ type: "image", chat: "t1", part: "img1", index: 0, path: "/etc/passwd" }, "a")
      await r.cmd({ type: "image", chat: "t1", part: "../../secrets", index: 0 }, "b")
      // The first is dropped by the schema (no answer); the second is a part id the engine doesn't know.
      expect(r.sent.map((m) => m.id)).toEqual(["b"])
      expect(r.reads).toEqual(["t1:../../secrets"])
      expect((r.sent[0] as Piece).ok).toBe(false)
    })

    it("has its own budget, apart from the 40-command limit", async () => {
      const r = rig()
      r.pictures.set("t1:img1", new Uint8Array(10))
      for (let i = 0; i < 201; i++) await r.cmd({ type: "image", chat: "t1", part: "img1", index: 0 }, `i${i}`)
      const res = r.sent as Piece[]
      expect(res.slice(0, 200).every((p) => p.ok)).toBe(true)
      expect(res[200]?.error).toBe("Too fast. Wait a moment.")
      await r.cmd({ type: "chats" }, "c")
      expect((r.sent.at(-1) as Piece).ok).toBe(true)
    })
  })
})
