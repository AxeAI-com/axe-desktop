import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { deleteLocal, getLocal, isLocalId, listLocal, newAgentThread, overlayFor, resetStoreForTests, saveLocal, titleFrom } from "../../src/main/agents/store"

const dir = mkdtempSync(join(tmpdir(), "axe-store-"))
const before = process.env.AXE_DATA_DIR

beforeAll(() => {
  process.env.AXE_DATA_DIR = dir
  resetStoreForTests()
})
afterAll(() => {
  process.env.AXE_DATA_DIR = before
  resetStoreForTests()
})

describe("thread store", () => {
  it("titles chats from the first line, cut at a word", () => {
    expect(titleFrom("  Fix the login bug\nmore detail")).toBe("Fix the login bug")
    expect(titleFrom("")).toBe("New chat")
    const long = titleFrom("Look through the upload code and find why big files fail halfway through on slow connections")
    expect(long.length).toBeLessThanOrEqual(61)
    expect(long.endsWith("…")).toBe(true)
    expect(long).not.toMatch(/\s…$/)
  })

  it("saves agent chats as JSON and reads them back after a restart", () => {
    const t = newAgentThread({ agentId: "claude-acp", cwd: "/Users/mia/code/site", text: "Tidy the README" })
    expect(isLocalId(t.id)).toBe(true)
    t.messages.push({ id: "u", role: "user", parts: [{ type: "text", id: "p", text: "Tidy the README" }], answerer: { kind: "agent", agentId: "claude-acp" } })
    saveLocal(t)
    const onDisk = JSON.parse(readFileSync(join(dir, "threads", `${t.id}.json`), "utf8"))
    expect(onDisk).toMatchObject({ source: "agent", agentId: "claude-acp", cwd: "/Users/mia/code/site", title: "Tidy the README" })
    resetStoreForTests()
    expect(getLocal(t.id)?.messages).toHaveLength(1)
    expect(listLocal().map((x) => x.id)).toContain(t.id)
    expect(readdirSync(join(dir, "threads")).some((f) => f.endsWith(".tmp"))).toBe(false)
  })

  it("keeps agent turns in Axe chats as an overlay, and deletes cleanly", () => {
    const axeId = "0b7f3f5e-8d0c-4a51-9a51-2f7f5a3a9e10"
    expect(overlayFor(axeId, undefined)).toBeUndefined()
    const o = overlayFor(axeId, { agentId: "codex-acp", cwd: "/Users/mia" })
    expect(o).toMatchObject({ id: axeId, source: "axe", agentId: "codex-acp" })
    expect(overlayFor(axeId, undefined)).toBe(o)
    deleteLocal(axeId)
    resetStoreForTests()
    expect(getLocal(axeId)).toBeUndefined()
  })

  it("refuses ids that could leave the folder", () => {
    expect(() => deleteLocal("../settings")).toThrow()
  })
})
