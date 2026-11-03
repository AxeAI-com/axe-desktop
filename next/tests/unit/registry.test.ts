import { createHash } from "node:crypto"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  binaryFor,
  binaryPath,
  installAgent,
  listAgents,
  loadRegistry,
  noteFor,
  parseRegistry,
  platformKey,
  readiness,
  type Registry,
  setRegistryForTests,
  signInCommand,
  type Tools,
} from "../../src/main/agents/registry"

const dir = mkdtempSync(join(tmpdir(), "axe-registry-"))
const before = process.env.AXE_DATA_DIR
beforeAll(() => {
  process.env.AXE_DATA_DIR = dir
})
afterAll(() => {
  process.env.AXE_DATA_DIR = before
  setRegistryForTests(undefined)
})

const raw = {
  version: "1.0.0",
  agents: [
    { id: "zed-thing", name: "Zed Thing", version: "1", description: "Does things. More words.", distribution: { npx: { package: "zed-thing@1" } } },
    { id: "claude-acp", name: "Claude Agent", version: "0.30.0", icon: "https://cdn.example/claude.svg", distribution: { npx: { package: "@agentclientprotocol/claude-agent-acp@0.30.0", args: ["--acp"] } } },
    {
      id: "amp-acp",
      name: "Amp",
      version: "0.10.0",
      distribution: {
        binary: {
          "darwin-aarch64": { archive: "https://example.com/amp-darwin.tar.gz", cmd: "./amp-acp", sha256: "ABC" },
          "linux-x86_64": { archive: "https://example.com/amp-linux", cmd: "./amp-acp" },
        },
      },
    },
    { id: "fast-agent", name: "fast-agent", version: "2", distribution: { uvx: { package: "fast-agent-acp" } } },
    { id: "broken", name: "Broken", version: "1", distribution: { npx: { nope: true } } },
    { id: 42, name: "Bad id" },
    "junk",
  ],
}

const tools = (found: Record<string, string>, files: string[] = []): Tools => ({ which: (t) => found[t], exists: (p) => files.includes(p) })

describe("registry parsing", () => {
  it("keeps usable agents and skips broken entries", () => {
    const r = parseRegistry(raw)
    expect(r.version).toBe("1.0.0")
    expect(r.agents.map((a) => a.id)).toEqual(["zed-thing", "claude-acp", "amp-acp", "fast-agent"])
    expect(r.agents[2]?.distribution.binary?.["darwin-aarch64"]?.sha256).toBe("abc")
    expect(parseRegistry(null).agents).toEqual([])
  })

  it("names platforms like the registry does", () => {
    expect(platformKey("darwin", "arm64")).toBe("darwin-aarch64")
    expect(platformKey("win32", "x64")).toBe("windows-x86_64")
    expect(platformKey("linux", "x64")).toBe("linux-x86_64")
  })
})

describe("readiness", () => {
  const r = parseRegistry(raw)
  const [zed, claude, amp, fast] = r.agents as [Registry["agents"][0], Registry["agents"][0], Registry["agents"][0], Registry["agents"][0]]

  it("npx agents are ready when Node is there", () => {
    const ready = readiness(claude, tools({ npx: "/opt/homebrew/bin/npx", node: "/opt/homebrew/bin/node" }), "darwin-aarch64")
    expect(ready).toEqual({ state: "ready", launch: { command: "/opt/homebrew/bin/npx", args: ["-y", "@agentclientprotocol/claude-agent-acp@0.30.0", "--acp"] } })
    const noNode = readiness(claude, tools({ npx: "/usr/bin/npx" }), "darwin-aarch64")
    expect(noNode).toMatchObject({ state: "unavailable" })
    expect(noNode.state === "unavailable" && noNode.reason).toMatch(/Node\.js/)
  })

  it("binary agents need an install, then are ready", () => {
    expect(readiness(amp, tools({}), "darwin-aarch64")).toEqual({ state: "install" })
    const exe = binaryPath(amp, binaryFor(amp, "darwin-aarch64")!)
    expect(readiness(amp, tools({}, [exe]), "darwin-aarch64")).toMatchObject({ state: "ready", launch: { command: exe } })
    expect(readiness(amp, tools({}), "windows-x86_64")).toMatchObject({ state: "unavailable", reason: "There's no version for this computer yet." })
  })

  it("uvx agents need uv", () => {
    expect(readiness(fast, tools({ uvx: "/usr/local/bin/uvx" }))).toMatchObject({ state: "ready" })
    expect(readiness(fast, tools({}))).toMatchObject({ state: "unavailable", reason: expect.stringMatching(/uv/) })
  })

  it("lists featured agents first with names and notes", () => {
    const list = listAgents(r, tools({ npx: "/x/npx", node: "/x/node" }), "darwin-aarch64")
    expect(list[0]).toEqual({ id: "claude-acp", name: "Claude Code", note: "Works in your folders and terminal", icon: "https://cdn.example/claude.svg", state: "ready" })
    expect(list.map((a) => a.state)).toEqual(["ready", "ready", "install", "unavailable"])
    expect(noteFor(zed)).toBe("Does things")
    for (const a of list) expect(a.note).not.toContain(" · ")
  })
})

describe("loading and installing", () => {
  it("caches the registry and falls back to the cache offline", async () => {
    let calls = 0
    const ok = (async () => {
      calls++
      return new Response(JSON.stringify(raw), { status: 200 })
    }) as unknown as typeof fetch
    setRegistryForTests(undefined)
    expect((await loadRegistry({ fetchImpl: ok })).agents).toHaveLength(4)
    expect(existsSync(join(dir, "acp-registry.json"))).toBe(true)
    setRegistryForTests(undefined)
    const offline = (async () => {
      calls++
      throw new Error("offline")
    }) as unknown as typeof fetch
    // Fresh cache on disk: no fetch at all. Stale (maxAge 0): fetch fails, the cache is used.
    expect((await loadRegistry({ fetchImpl: offline })).agents).toHaveLength(4)
    expect(calls).toBe(1)
    setRegistryForTests(undefined)
    expect((await loadRegistry({ fetchImpl: offline, maxAge: 0 })).agents).toHaveLength(4)
    expect(calls).toBe(2)
  })

  it("installs a binary agent and checks its SHA-256", async () => {
    const bytes = Buffer.from("#!/bin/sh\necho hi\n")
    const sha = createHash("sha256").update(bytes).digest("hex")
    const key = platformKey()
    const make = (sha256: string) =>
      parseRegistry({
        version: "1",
        agents: [{ id: "solo", name: "Solo", version: "1.0.0", distribution: { binary: { [key]: { archive: "https://example.com/solo-bin", cmd: "solo", sha256 } } } }],
      })
    const fetchImpl = (async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch

    setRegistryForTests(make("0".repeat(64)))
    await expect(installAgent("solo", fetchImpl)).rejects.toThrow(/checksum/)

    const reg = make(sha)
    setRegistryForTests(reg)
    await installAgent("solo", fetchImpl)
    const a = reg.agents[0]!
    const exe = binaryPath(a, binaryFor(a)!)
    expect(existsSync(exe)).toBe(true)
    expect(readiness(a, { which: () => undefined, exists: existsSync })).toMatchObject({ state: "ready", launch: { command: exe } })
  })
})

describe("sign-in commands", () => {
  it("only for known agent ids, never an inherited key", () => {
    expect(signInCommand("claude-acp")).toBe("claude auth login")
    expect(signInCommand("gemini")).toBe("gemini")
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty", "nope"]) expect(signInCommand(id)).toBeUndefined()
    expect(signInCommand(42)).toBeUndefined()
    expect(signInCommand({})).toBeUndefined()
  })
})
