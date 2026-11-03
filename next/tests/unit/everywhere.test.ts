import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { acceleratorFromKey, defaultQuickBarKey, displayAccelerator, parseAccelerator } from "@shared/accelerator"
import type { ThreadSummary } from "@shared/types"

import { quickCwd, quickKeyAction, type QuickState } from "@/lib/quick"
import { encodeWav, GATE, levelOf, mono, pickVoice, releaseMeans, SilenceGate, speakable, speechChunks } from "@/lib/voice-logic"

import { AxeClient } from "../../src/main/axe/client"
import { resetSettingsForTests, settings, updateSettings } from "../../src/main/settings"

// Package E (quick bar, voice, palette): the logic that needs no window, microphone or speaker.

describe("accelerators", () => {
  it("reads and normalises what Electron takes", () => {
    expect(parseAccelerator("alt+space", "darwin")).toEqual({ modifiers: ["Alt"], key: "Space" })
    expect(parseAccelerator("Shift+CmdOrCtrl+k", "darwin")).toEqual({ modifiers: ["Command", "Shift"], key: "K" })
    expect(parseAccelerator("CommandOrControl+Shift+K", "win32")).toEqual({ modifiers: ["Control", "Shift"], key: "K" })
    expect(parseAccelerator("F5", "linux")).toEqual({ modifiers: [], key: "F5" })
  })

  it("refuses keys that would swallow typing or that Electron can't register", () => {
    expect(parseAccelerator("K", "darwin")).toBeNull()
    expect(parseAccelerator("Shift+K", "darwin")).toBeNull()
    expect(parseAccelerator("Alt+Alt+K", "darwin")).toBeNull()
    expect(parseAccelerator("Alt+", "darwin")).toBeNull()
    expect(parseAccelerator("Hyper+K", "darwin")).toBeNull()
    expect(parseAccelerator("Alt+é", "darwin")).toBeNull()
  })

  it("defaults to ⌥Space on a Mac and Ctrl+Space elsewhere", () => {
    expect(defaultQuickBarKey("darwin")).toBe("Alt+Space")
    expect(defaultQuickBarKey("win32")).toBe("Control+Space")
    expect(defaultQuickBarKey("linux")).toBe("Control+Space")
  })

  it("shows Mac symbols in Apple's order, words elsewhere", () => {
    expect(displayAccelerator("Alt+Space", "darwin")).toBe("⌥Space")
    expect(displayAccelerator("Command+Shift+Control+K", "darwin")).toBe("⌃⇧⌘K")
    expect(displayAccelerator("Control+Space", "win32")).toBe("Ctrl+Space")
    expect(displayAccelerator("Control+Alt+Up", "linux")).toBe("Ctrl+Alt+↑")
  })

  it("records a key press by its physical key", () => {
    const press = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
      code,
      key: "?",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    })
    // ⌥K types "˚" on a Mac; the recorder still saves Alt+K.
    expect(acceleratorFromKey(press("KeyK", { altKey: true }), "darwin")).toBe("Alt+K")
    expect(acceleratorFromKey(press("Space", { ctrlKey: true }), "win32")).toBe("Control+Space")
    expect(acceleratorFromKey(press("Digit1", { metaKey: true, shiftKey: true }), "darwin")).toBe("Command+Shift+1")
    // Only modifiers held so far, or a bare letter: keep waiting.
    expect(acceleratorFromKey(press("AltLeft", { altKey: true }), "darwin")).toBeNull()
    expect(acceleratorFromKey(press("KeyK"), "darwin")).toBeNull()
  })
})

describe("the quick bar key in Settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "axe-everywhere-"))
  const saved = process.env.AXE_DATA_DIR
  beforeAll(() => {
    process.env.AXE_DATA_DIR = dir
    resetSettingsForTests()
  })
  afterAll(() => {
    if (saved === undefined) delete process.env.AXE_DATA_DIR
    else process.env.AXE_DATA_DIR = saved
    resetSettingsForTests()
  })

  it("starts on the platform's default and saves a valid change in Electron's spelling", () => {
    expect(settings().quickBarKey).toBe(defaultQuickBarKey(process.platform as "darwin"))
    expect(updateSettings({ quickBarKey: "shift+alt+k" }).quickBarKey).toBe("Alt+Shift+K")
    resetSettingsForTests()
    expect(settings().quickBarKey).toBe("Alt+Shift+K")
  })

  it("refuses a key with no modifier in plain words", () => {
    expect(() => updateSettings({ quickBarKey: "k" })).toThrow(/Use a key with/)
    expect(settings().quickBarKey).toBe("Alt+Shift+K")
  })
})

describe("transcription on axeai.com", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("posts the recording as the form's file, with the session", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData
      const file = form.get("file") as File
      expect(file.name).toBe("voice.webm")
      expect(file.type).toBe("audio/webm")
      expect(await file.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer)
      return new Response(JSON.stringify({ text: "  Table for four on Friday.  ", language: "en" }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const text = await new AxeClient("http://localhost:3000", "tok").transcribe(new Uint8Array([1, 2, 3]), "audio/webm;codecs=opus")
    expect(text).toBe("Table for four on Friday.")
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("http://localhost:3000/api/voice/transcribe")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok")
  })

  it("names the file for the format it was recorded in", async () => {
    let name = ""
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      name = ((init.body as FormData).get("file") as File).name
      return new Response('{"text":"hi"}')
    })
    await new AxeClient("http://x", undefined).transcribe(new Uint8Array([1]), "audio/mp4")
    expect(name).toBe("voice.m4a")
  })

  it("passes the server's own words on (the daily limit)", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ error: { code: "daily_limit", message: "You've used today's 60 free voice transcriptions." } }), { status: 429 }),
    )
    await expect(new AxeClient("http://x", "t").transcribe(new Uint8Array([1]), "audio/webm")).rejects.toMatchObject({ status: 429, code: "daily_limit" })
  })
})

describe("speech to text on the Mac itself", () => {
  it("writes the recording as a 16-bit mono WAV the speech model reads", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, 0.5]), 16_000)
    const v = new DataView(wav.buffer)
    const text = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n))
    expect([text(0, 4), text(8, 4), text(12, 4), text(36, 4)]).toEqual(["RIFF", "WAVE", "fmt ", "data"])
    expect(wav.byteLength).toBe(44 + 5 * 2)
    expect(v.getUint32(4, true)).toBe(36 + 10)
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 1, 16_000, 16])
    expect(v.getUint32(40, true)).toBe(10)
    // Loud samples are clipped, never wrapped round.
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, 16383])
  })

  it("mixes stereo down to one channel", () => {
    expect(Array.from(mono([new Float32Array([1, 0.5]), new Float32Array([0, 0.5])]))).toEqual([0.5, 0.5])
    const one = new Float32Array([0.25])
    expect(mono([one])).toBe(one)
  })
})

describe("hearing a turn", () => {
  it("measures loudness from analyser samples", () => {
    expect(levelOf(new Uint8Array(512).fill(128))).toBe(0)
    const loud = Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 128 + 60 : 128 - 60))
    expect(levelOf(loud)).toBeGreaterThan(0.9)
    const soft = Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 129 : 127))
    expect(levelOf(soft)).toBeLessThan(GATE.end)
  })

  /** Feeds levels at 50 ms steps; returns the gate's answers. */
  const run = (levels: number[]) => {
    const gate = new SilenceGate()
    return levels.map((l, i) => gate.push(l, i * 50))
  }
  const span = (level: number, ms: number) => Array.from({ length: ms / 50 }, () => level)

  it("ends the turn after a second of quiet once you've spoken", () => {
    const out = run([...span(0.05, 500), ...span(0.5, 1200), ...span(0.05, 1100)])
    expect(out.slice(0, 10).every((s) => s === "waiting")).toBe(true)
    expect(out).toContain("speaking")
    expect(out[out.length - 1]).toBe("done")
    expect(out.indexOf("done")).toBe(10 + 24 + 20)
  })

  it("keeps listening through short pauses", () => {
    const out = run([...span(0.5, 600), ...span(0.05, 600), ...span(0.5, 600), ...span(0.05, 300)])
    expect(out).not.toContain("done")
  })

  it("ignores a click", () => {
    const out = run([...span(0.6, 100), ...span(0.05, 2000)])
    expect(out).not.toContain("speaking")
  })

  it("starts over when nobody speaks", () => {
    const out = run(span(0.05, GATE.waitMs + 100))
    expect(out[out.length - 1]).toBe("nothing")
  })

  it("never runs past the longest turn", () => {
    const out = run(span(0.5, GATE.maxMs + 1000))
    expect(out[out.length - 1]).toBe("done")
  })

  it("tells a hold from a tap", () => {
    expect(releaseMeans(0, 200)).toBe("keep")
    expect(releaseMeans(0, 900)).toBe("finish")
  })
})

describe("reading an answer aloud", () => {
  it("drops the markup and keeps the words", () => {
    expect(speakable("## A slow day\n\n- **Morning:** catch *Tram 28*\n- Lunch in [Belém](https://x.pt)\n\nSee `README` for more")).toBe(
      "A slow day. Morning: catch Tram 28. Lunch in Belém. See README for more.",
    )
  })

  it("points at code, tables and cards instead of reading them", () => {
    const md = "Here it is:\n\n```ts\nconst a = 1\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```axe-chart\n{}\n```\nDone."
    expect(speakable(md)).toBe("Here it is: Done. The code is in the chat. The table is in the chat. There's more to see in the chat.")
  })

  it("says links and citations quietly", () => {
    expect(speakable("Prices rose [1] (see https://example.com/a)")).toBe("Prices rose (see a link).")
  })

  it("cuts long text into sentences a system voice reads in one go", () => {
    const text = "One. Two is longer. " + "Word ".repeat(80).trim() + ". Last."
    const chunks = speechChunks(text, 120)
    expect(chunks.every((c) => c.length <= 120)).toBe(true)
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text)
    expect(chunks[0]).toBe("One. Two is longer.")
  })

  it("picks the house voice, then a good one, never a novelty voice", () => {
    const v = (name: string, lang = "en-US", localService = true) => ({ name, lang, localService })
    expect(pickVoice([v("Samantha"), v("Daniel", "en-GB"), v("Zarvox")])?.name).toBe("Daniel")
    expect(pickVoice([v("Zarvox"), v("Ava (Premium)"), v("Samantha")])?.name).toBe("Ava (Premium)")
    expect(pickVoice([v("Thomas", "fr-FR"), v("Samantha")], "fr-FR")?.name).toBe("Thomas")
    expect(pickVoice([])).toBeUndefined()
  })
})

describe("the quick bar's keys", () => {
  const s = (patch: Partial<QuickState> = {}): QuickState => ({ menuOpen: false, hasText: false, answered: false, hasThread: false, dictating: false, ...patch })
  const k = (key: string, mod = false, shift = false) => ({ key, mod, shift })

  it("asks with Enter, and opens a finished answer as a full chat", () => {
    expect(quickKeyAction(k("Enter"), s({ hasText: true }))).toBe("send")
    expect(quickKeyAction(k("Enter"), s({ hasThread: true, answered: true }))).toBe("open")
    expect(quickKeyAction(k("Enter"), s({ hasThread: true }))).toBe("none")
    expect(quickKeyAction(k("Enter"), s({ hasThread: true, answered: true, hasText: true }))).toBe("send")
    expect(quickKeyAction(k("Enter", true), s({ hasThread: true, hasText: true }))).toBe("open")
    expect(quickKeyAction(k("Enter", false, true), s({ hasText: true }))).toBe("none")
    expect(quickKeyAction({ ...k("Enter"), composing: true }, s({ hasText: true }))).toBe("none")
  })

  it("closes the list, then the recording, then the bar with Esc", () => {
    expect(quickKeyAction(k("Escape"), s({ menuOpen: true, dictating: true }))).toBe("menu-close")
    expect(quickKeyAction(k("Escape"), s({ dictating: true }))).toBe("stop-dictation")
    expect(quickKeyAction(k("Escape"), s())).toBe("hide")
  })

  it("moves through an open list with the arrows", () => {
    expect(quickKeyAction(k("ArrowDown"), s({ menuOpen: true }))).toBe("menu-down")
    expect(quickKeyAction(k("ArrowUp"), s({ menuOpen: true }))).toBe("menu-up")
    expect(quickKeyAction(k("Enter"), s({ menuOpen: true, hasText: true }))).toBe("menu-pick")
    expect(quickKeyAction(k("ArrowDown"), s())).toBe("none")
  })

  it("reuses the folder an agent last worked in", () => {
    const t = (id: string, agentId: string, cwd: string, updatedAt: string): ThreadSummary => ({ id, source: "agent", agentId, cwd, title: id, pinned: false, updatedAt })
    const threads = [t("a", "claude-code", "/w/old", "2026-10-01T00:00:00Z"), t("b", "claude-code", "/w/new", "2026-10-20T00:00:00Z"), t("c", "codex", "/w/dl", "2026-10-21T00:00:00Z")]
    expect(quickCwd(threads, "claude-code")).toBe("/w/new")
    expect(quickCwd(threads, "gemini-cli")).toBeUndefined()
  })
})
