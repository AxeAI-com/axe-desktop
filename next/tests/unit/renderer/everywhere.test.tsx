// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { AxeBridge } from "@shared/api"
import type { ModelCatalog } from "@shared/types"

import { filterPalette, match, paletteEntries, SHORTCUTS } from "@/lib/shortcuts"
import { applyReply, getState, resetStore } from "@/lib/store"
import { closeTalk, DICTATED, getVoice, holdDown, holdUp, openTalk, setVoiceForTests, startDictation, finishDictation, type DictatedDetail } from "@/lib/voice"

import { DictationStrip, MicButton } from "@/components/Voice"

// Package E in the window: every action reachable from ⌘K, and voice end to end on a fake
// microphone (the recording goes to a stubbed engine, which "transcribes" it).

const CATALOG: ModelCatalog = {
  axe: {
    defaultModelId: "auto",
    models: [
      { id: "auto", label: "Auto", provider: "axe", tier: "free", webSearch: true, vision: true, reasoning: true },
      { id: "kimi-k2", label: "Kimi K2", provider: "openrouter", tier: "paid", webSearch: true, vision: false, reasoning: false },
    ],
  },
  agents: [
    { id: "claude-code", name: "Claude Code", note: "Works in your folders", state: "ready" },
    { id: "gemini-cli", name: "Gemini CLI", note: "Not installed yet", state: "install" },
  ],
  local: [],
  servers: [],
}

let level = 0
let micAccess: "granted" | "denied" = "granted"
let heard = "Table for four on Friday"
/** What the Mac itself heard (undefined: this computer can't). null: it tried and couldn't. */
let heardOnDevice: string | null | undefined
const invoke = vi.fn(async (command: string, ...args: unknown[]): Promise<unknown> => {
  if (command === "voice:microphone") return micAccess
  if (command === "voice:onDevice") return heardOnDevice !== undefined
  if (command === "voice:transcribeOnDevice") {
    const wav = args[0] as Uint8Array
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE")
    return heardOnDevice
  }
  if (command === "voice:transcribe") {
    expect((args[0] as Uint8Array).byteLength).toBeGreaterThan(0)
    return heard
  }
  if (command === "chat:send") return { threadId: "t-talk" }
  return undefined
})

class FakeRecorder {
  static isTypeSupported = (m: string) => m === "audio/webm;codecs=opus"
  state: "inactive" | "recording" = "inactive"
  mimeType = "audio/webm;codecs=opus"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }) })
    setTimeout(() => this.onstop?.(), 0)
  }
}

// Decodes any recording as a quarter second of stereo at the context's rate.
class FakeOfflineAudioContext {
  constructor(
    readonly channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  async decodeAudioData() {
    const n = this.sampleRate / 4
    const data = [new Float32Array(n).fill(0.2), new Float32Array(n).fill(0.4)]
    return { numberOfChannels: 2, getChannelData: (i: number) => data[i]! }
  }
}

class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 64,
      getByteTimeDomainData(a: Uint8Array) {
        // A square wave whose height follows `level`.
        const h = Math.round(level * 100)
        for (let i = 0; i < a.length; i++) a[i] = 128 + (i % 2 ? h : -h)
      },
    }
  }
  createMediaStreamSource() {
    return { connect() {} }
  }
  close() {
    return Promise.resolve()
  }
}

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
  window.axe = { invoke, on: () => () => {}, platform: "darwin", pathOf: () => "", quiet: false } as unknown as AxeBridge
  Object.assign(globalThis, { MediaRecorder: FakeRecorder, AudioContext: FakeAudioContext, OfflineAudioContext: FakeOfflineAudioContext })
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) },
  })
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16) as unknown as number
  window.cancelAnimationFrame = (id) => clearTimeout(id)
})

beforeEach(() => {
  level = 0
  micAccess = "granted"
  heard = "Table for four on Friday"
  heardOnDevice = undefined
  invoke.mockClear()
  resetStore({
    profile: { email: "mia@example.com", name: "Mia Lane" },
    catalog: CATALOG,
    view: { kind: "new" },
    threads: [
      { id: "t-lisbon", source: "axe", title: "Two days in Lisbon", pinned: false, updatedAt: "2026-10-22T10:00:00Z" },
      { id: "t-up", source: "agent", agentId: "claude-code", cwd: "/w/axe-web", title: "Fix the upload test", pinned: true, updatedAt: "2026-10-21T10:00:00Z" },
    ],
    messages: {},
    live: {},
    settings: { baseURL: "https://axeai.com", theme: "dark", sidebarWidth: 300, quickBarKey: "Alt+Space" },
    draft: { answerer: null, webSearch: true, research: false, doIt: false },
  })
  setVoiceForTests({ dictation: { phase: "idle" } })
})
afterEach(() => {
  cleanup()
  closeTalk()
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(check: () => boolean, ms = 4000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out")
    await act(() => wait(20))
  }
}

describe("the palette reaches everything", () => {
  it("lists every action, chat, model and agent, each with its key", () => {
    const entries = paletteEntries(getState())
    const ids = entries.map((e) => e.id)
    // Every action in the table that applies on this screen (the palette itself excluded).
    for (const s of SHORTCUTS) if (s.id !== "palette" && (!s.when || s.when())) expect(ids).toContain(s.id)
    expect(ids).toEqual(expect.arrayContaining(["t-lisbon", "t-up", "model-auto", "model-kimi-k2", "agent-claude-code", "install-gemini-cli"]))
    const hint = (id: string) => entries.find((e) => e.id === id)?.hint
    expect(hint("new")).toBe("⌘N")
    expect(hint("dictate")).toBe("⌘D")
    expect(hint("talk")).toBe("⇧⌘T")
    expect(hint("quick")).toBe("⌥Space")
    expect(hint("t-up")).toBe("Claude Code")
  })

  it("follows the quick bar key you set", () => {
    resetStore({ settings: { ...getState().settings, quickBarKey: "Control+Shift+K" } })
    expect(paletteEntries().find((e) => e.id === "quick")?.hint).toBe("⌃⇧K")
  })

  it("finds actions by their words, grouped", () => {
    const names = (q: string) => filterPalette(paletteEntries(), q).map((e) => e.label)
    expect(names("microphone")).toEqual(["Dictate", "Quick bar and voice"])
    expect(names("kimi")).toEqual(["Answer with Kimi K2"])
    expect(names("lisbon")).toEqual(["Two days in Lisbon"])
    expect(names("dark")).toContain("Switch to dark theme")
    expect(names("claude")).toEqual(expect.arrayContaining(["New chat with Claude Code", "CLIs on this computer"]))
  })

  it("offers chat actions only inside a chat", () => {
    expect(paletteEntries().some((e) => e.id === "archive")).toBe(false)
    resetStore({ view: { kind: "thread", id: "t-up" } })
    const ids = paletteEntries().map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(["archive", "unpin", "copy"]))
    expect(ids).not.toContain("pin")
    // An agent chat keeps its agent: no model switching from the palette.
    expect(ids.some((id) => id.startsWith("model-"))).toBe(false)
  })

  it("shows the everyday actions and recent chats before you type", () => {
    const first = filterPalette(paletteEntries(), "").map((e) => e.id)
    expect(first.slice(0, 5)).toEqual(["new", "quick", "attach", "focus", "new-watch"])
    expect(first).toEqual(expect.arrayContaining(["dictate", "talk"]))
    expect(first.some((id) => id.startsWith("t-"))).toBe(true)
  })

  it("never treats a palette-only action as a key", () => {
    const press = (key: string, extra: Partial<KeyboardEvent> = {}) => match({ key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...extra })
    expect(press("d")?.id).toBe("dictate")
    expect(press("T", { shiftKey: true })?.id).toBe("talk")
    expect(press("q")).toBeUndefined()
    expect(match({ key: "d", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false })).toBeUndefined()
  })
})

describe("dictation", () => {
  it("records, then writes it down where you were typing", async () => {
    const got: DictatedDetail[] = []
    const listen = (e: Event) => got.push((e as CustomEvent<DictatedDetail>).detail)
    window.addEventListener(DICTATED, listen)
    render(
      <>
        <MicButton target="composer" />
        <DictationStrip target="composer" />
      </>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }))
    await until(() => getVoice().dictation.phase === "listening")
    level = 0.4
    await act(() => wait(120))
    const d = getVoice().dictation
    expect(d.phase === "listening" && d.levels.some((l) => l > 0.5)).toBe(true)
    expect(screen.getByRole("button", { name: "Stop dictating" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Write it down" }))
    await until(() => getVoice().dictation.phase === "idle")
    expect(got).toEqual([{ target: "composer", text: "Table for four on Friday" }])
    expect(invoke).toHaveBeenCalledWith("voice:microphone")
    window.removeEventListener(DICTATED, listen)
  })

  it("asks for the microphone only when you first dictate", async () => {
    expect(invoke).not.toHaveBeenCalledWith("voice:microphone")
    await act(() => startDictation("quick"))
    expect(invoke).toHaveBeenCalledWith("voice:microphone")
    await act(() => finishDictation())
  })

  it("says how to allow the microphone after a no", async () => {
    micAccess = "denied"
    render(<DictationStrip target="composer" />)
    await act(() => startDictation("composer"))
    expect(screen.getByText(/Allow the microphone in System Settings/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }))
    expect(invoke).toHaveBeenCalledWith("voice:openMicSettings")
  })

  it("writes speech down on the Mac itself when it can, without axeai.com", async () => {
    heardOnDevice = "Table for two by the window"
    const got: string[] = []
    const take = (e: Event) => got.push((e as CustomEvent<DictatedDetail>).detail.text)
    window.addEventListener(DICTATED, take)
    await act(() => startDictation("composer"))
    await act(() => finishDictation())
    window.removeEventListener(DICTATED, take)
    expect(got).toEqual(["Table for two by the window"])
    const wav = invoke.mock.calls.find(([c]) => c === "voice:transcribeOnDevice")![1] as Uint8Array
    // A quarter second at 16 kHz, mono, 16-bit.
    expect(wav.byteLength).toBe(44 + 4000 * 2)
    expect(invoke).not.toHaveBeenCalledWith("voice:transcribe", expect.anything(), expect.anything())
  })

  it("uses axeai.com when the Mac couldn't write it down", async () => {
    heardOnDevice = null
    await act(() => startDictation("composer"))
    await act(() => finishDictation())
    expect(invoke).toHaveBeenCalledWith("voice:transcribeOnDevice", expect.any(Uint8Array))
    expect(invoke).toHaveBeenCalledWith("voice:transcribe", expect.any(Uint8Array), "audio/webm;codecs=opus")
    expect(getVoice().dictation.phase).toBe("idle")
  })

  it("says so when nothing was heard", async () => {
    heard = ""
    await act(() => startDictation("composer"))
    await act(() => finishDictation())
    const d = getVoice().dictation
    expect(d.phase === "error" && d.message).toMatch(/Didn't catch that/)
  })

  it("hold-to-talk: a long press ends on release, a tap keeps recording", async () => {
    holdDown("composer")
    await until(() => getVoice().dictation.phase === "listening")
    await act(() => wait(400))
    holdUp()
    await until(() => getVoice().dictation.phase === "idle")
    expect(invoke).toHaveBeenCalledWith("voice:transcribe", expect.any(Uint8Array), "audio/webm;codecs=opus")

    holdDown("composer")
    holdUp()
    await until(() => getVoice().dictation.phase === "listening")
    await act(() => wait(400))
    expect(getVoice().dictation.phase).toBe("listening")
    // The next press ends it.
    holdDown("composer")
    await until(() => getVoice().dictation.phase === "idle")
  })
})

describe("Talk mode", () => {
  it("hears a turn, asks Axe, and shows the answer when there is no system voice", async () => {
    void openTalk()
    await until(() => getVoice().talk.phase === "listening")
    level = 0.5
    await until(() => getVoice().talk.phase === "hearing")
    await act(() => wait(400))
    level = 0
    await until(() => getVoice().talk.phase === "thinking", 3000)
    expect(getVoice().talk.heard).toBe("Table for four on Friday")
    expect(invoke).toHaveBeenCalledWith("chat:send", expect.objectContaining({ threadId: null, text: "Table for four on Friday" }))
    expect(getState().view).toEqual({ kind: "thread", id: "t-talk" })

    act(() =>
      applyReply({
        threadId: "t-talk",
        startedAt: Date.now(),
        done: true,
        message: { id: "a1", role: "assistant", parts: [{ type: "text", id: "x", text: "**Done.** Booked [Rio](https://rio.example) for *eight*." }] },
      }),
    )
    await until(() => getVoice().talk.phase === "speaking")
    expect(getVoice().talk.reply).toBe("Done. Booked Rio for eight.")
    // jsdom has no speechSynthesis: the answer is shown instead.
    await until(() => !!getVoice().talk.silent)
  }, 10_000)

  it("ends cleanly", async () => {
    void openTalk()
    await until(() => getVoice().talk.phase === "listening")
    closeTalk()
    expect(getVoice().talk.open).toBe(false)
  })
})
