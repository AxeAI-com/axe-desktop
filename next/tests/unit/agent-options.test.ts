import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { EventName, Events } from "@shared/api"

import { cachedOptions, fromACP, nextToApply, resetOptionsCacheForTests, withPicks } from "../../src/main/agents/config"
import { getLocal, resetStoreForTests } from "../../src/main/agents/store"
import { configureAccount } from "../../src/main/axe/account"
import { setEmitter } from "../../src/main/bus"
import * as chat from "../../src/main/chat"
import { resetSettingsForTests, settings } from "../../src/main/settings"
import { optionsLabel, shortName } from "../../src/renderer/src/components/AgentOptionsMenu"

// Model and effort for CLI agents (ACP config options): the lists as the agents send them, and the
// real engine with the fake agent (tests/fixtures/fake-agent.mjs), whose effort levels follow its model.

const CLAUDE: SessionConfigOption[] = [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Manual" }] },
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "default",
    options: [
      { value: "default", name: "Default (recommended)", description: "Opus 5.5" },
      { value: "haiku", name: "Haiku 5.5", description: "Fastest for quick answers" },
    ],
  },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }, { value: "low", name: "Low" }] },
  { id: "ultracode", name: "Ultracode", category: "_ultracode", type: "select", currentValue: "off", options: [{ value: "off", name: "Off" }] },
]

describe("agent options from ACP", () => {
  it("keeps only the model and effort, model first, with the agent's own names", () => {
    const o = fromACP([CLAUDE[2]!, ...CLAUDE])
    expect(o.map((x) => [x.id, x.kind])).toEqual([
      ["model", "model"],
      ["effort", "effort"],
      ["effort", "effort"],
    ])
    expect(o[0]!.choices[1]).toEqual({ value: "haiku", name: "Haiku 5.5", description: "Fastest for quick answers" })
  })

  it("flattens grouped lists and reads Codex's reasoning_effort by its id when there's no category", () => {
    const o = fromACP([
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "b",
        options: [
          { group: "fast", name: "Fast", options: [{ value: "a", name: "A" }] },
          { group: "deep", name: "Deep", options: [{ value: "b", name: "B" }] },
        ],
      },
      { id: "reasoning_effort", name: "Reasoning effort", type: "select", currentValue: "medium", options: [{ value: "medium", name: "Medium" }] },
      { id: "fast", name: "Fast", type: "boolean", currentValue: true },
    ] as SessionConfigOption[])
    expect(o[0]!.choices).toEqual([
      { value: "a", name: "A", group: "Fast" },
      { value: "b", name: "B", group: "Deep" },
    ])
    expect(o[1]).toMatchObject({ id: "reasoning_effort", kind: "effort", current: "medium" })
    expect(o).toHaveLength(2)
  })

  it("applies picks the agent still offers, the model before the effort", () => {
    const o = fromACP(CLAUDE)
    expect(withPicks(o, { model: "haiku", effort: "gone" }).map((x) => x.current)).toEqual(["haiku", "default"])
    expect(nextToApply(o, { effort: "low", model: "haiku" })).toEqual({ id: "model", value: "haiku" })
    expect(nextToApply(withPicks(o, { model: "haiku" }), { effort: "low", model: "haiku" })).toEqual({ id: "effort", value: "low" })
    expect(nextToApply(o, { model: "nope" })).toBeUndefined()
  })

  it("labels the chip with the model, and the effort only when it isn't the default", () => {
    const o = fromACP(CLAUDE)
    expect(shortName(o[0]!.choices[0])).toBe("Default")
    expect(optionsLabel(o)).toEqual({ model: "Default", effort: "" })
    expect(optionsLabel(withPicks(o, { model: "haiku", effort: "low" }))).toEqual({ model: "Haiku 5.5", effort: "Low" })
  })
})

const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-options-")))
const work = join(root, "work")
mkdirSync(work, { recursive: true })
const log = join(root, "agent.log")
const fixture = resolve(import.meta.dirname, "../fixtures/fake-agent.mjs")
const saved = { data: process.env.AXE_DATA_DIR, token: process.env.AXE_TOKEN }
const events: { [K in EventName]?: Events[K][] } = {}

beforeAll(() => {
  process.env.AXE_DATA_DIR = join(root, "data")
  process.env.AXE_TOKEN = "test-token"
  resetSettingsForTests()
  resetStoreForTests()
  resetOptionsCacheForTests()
  configureAccount({})
  setEmitter((event, payload) => ((events[event] ??= []) as unknown[]).push(payload))
  chat.configureChat({
    resolveAgent: async () => ({ name: "Fake Agent", spec: { command: process.execPath, args: [fixture], env: { ...process.env, FAKE_AGENT_LOG: log } as Record<string, string> } }),
    defaultFolder: () => work,
  })
})

afterAll(() => {
  chat.shutdown()
  process.env.AXE_DATA_DIR = saved.data
  process.env.AXE_TOKEN = saved.token
  resetSettingsForTests()
  resetStoreForTests()
  resetOptionsCacheForTests()
})

const answer = async (threadId: string | null, text: string) => {
  const before = (events.reply ?? []).filter((u) => u.done).length
  const r = await chat.send({ threadId, text, answerer: { kind: "agent", agentId: "fake" } })
  for (let i = 0; i < 300; i++) {
    const done = (events.reply ?? []).filter((u) => u.done).slice(before).find((u) => u.threadId === r.threadId)
    const last = done?.message.parts.findLast((p) => p.type === "text")
    if (done) return { threadId: r.threadId, text: last?.type === "text" ? last.text : (done.error ?? "") }
    await new Promise((res) => setTimeout(res, 50))
  }
  throw new Error("no answer")
}

describe("agent options in the engine", () => {
  it("a new chat starts on the picks made before it, applied before the first turn", async () => {
    // No session has run yet: no lists to show.
    expect(chat.agentOptions(null, "fake")).toEqual([])
    await chat.setAgentOption(null, "fake", "model", "haiku")
    await chat.setAgentOption(null, "fake", "effort", "low")
    expect(settings().agentConfig?.fake).toEqual({ model: "haiku", effort: "low" })

    const first = await answer(null, "which model")
    expect(first.text).toBe("Model: haiku. Effort: low.")
    expect(getLocal(first.threadId)!.config).toEqual({ model: "haiku", effort: "low" })
    // The model was set before the effort (Haiku has no High), and both before the prompt.
    const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    const order = lines.map((l) => (l.set ? Object.keys(l.set)[0] : l.texts ? "prompt" : "session"))
    expect(order).toEqual(["session", "model", "effort", "prompt"])

    // The window got the agent's lists, and they are kept for the next new chat.
    const sent = events.agentOptions!.filter((e) => e.threadId === first.threadId).at(-1)!
    expect(sent.options.map((o) => [o.id, o.current])).toEqual([
      ["model", "haiku"],
      ["effort", "low"],
    ])
    expect(cachedOptions("fake").map((o) => o.id)).toEqual(["model", "effort"])
    expect(chat.agentOptions(null, "fake").map((o) => o.current)).toEqual(["haiku", "low"])
  })

  it("a pick in a running chat switches the agent now and becomes the default", async () => {
    const { threadId } = await answer(null, "which model")
    const after = await chat.setAgentOption(threadId, "fake", "model", "sonnet")
    // Sonnet keeps Low (it has it); the chat and the default both follow.
    expect(after.map((o) => [o.id, o.current])).toEqual([
      ["model", "sonnet"],
      ["effort", "low"],
    ])
    expect(after[1]!.choices.map((c) => c.value)).toEqual(["default", "low", "high"])
    expect(getLocal(threadId)!.config).toEqual({ model: "sonnet", effort: "low" })
    expect(settings().agentConfig?.fake?.model).toBe("sonnet")
    expect((await answer(threadId, "which model")).text).toBe("Model: sonnet. Effort: low.")
  })

  it("an older chat keeps its own picks when the default changes", async () => {
    const { threadId } = await answer(null, "which model")
    await chat.setAgentOption(null, "fake", "model", "haiku")
    chat.shutdown()
    expect(chat.agentOptions(threadId, "fake")[0]!.current).toBe("sonnet")
    expect((await answer(threadId, "which model")).text).toBe("Model: sonnet. Effort: low.")
  })

  it("picking the model in a new chat keeps the remembered effort", async () => {
    await chat.setAgentOption(null, "fake", "model", "haiku")
    await chat.setAgentOption(null, "fake", "effort", "low")
    // A chat made before its first turn (a watch's result): it has no picks of its own yet.
    const threadId = chat.postMessage({ threadId: null, title: "Shop tests", answerer: { kind: "agent", agentId: "fake" }, message: { id: "m1", role: "assistant", parts: [{ type: "text", text: "Tests pass." }] } as never })
    expect(getLocal(threadId)!.config).toBeUndefined()
    await chat.setAgentOption(threadId, "fake", "model", "sonnet")
    expect(getLocal(threadId)!.config).toEqual({ model: "sonnet", effort: "low" })
    expect((await answer(threadId, "which model")).text).toBe("Model: sonnet. Effort: low.")
  })
})
