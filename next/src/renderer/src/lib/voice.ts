import { useSyncExternalStore } from "react"

import { invoke } from "./bridge"
import { replyText } from "./steps"
import { getState, plainError, sendInThread, sendNew } from "./store"
import { encodeWav, HOLD_MS, levelOf, mono, pickVoice, SilenceGate, speakable, speechChunks } from "./voice-logic"

// Voice in the window: dictation into the composer or the quick bar (the microphone button, or
// hold ⌘D), and Talk mode (an orb: speak, hear the answer, speak again). The microphone is asked
// for the first time you use one of these, never at launch. Speech becomes text on the Mac itself
// when it can (macOS 26 and later), on axeai.com otherwise; answers are read by the system's own voices.

export type DictationTarget = "composer" | "quick"

export type Dictation =
  | { phase: "idle" }
  | { phase: "asking"; target: DictationTarget }
  | { phase: "listening"; target: DictationTarget; startedAt: number; levels: number[] }
  | { phase: "writing"; target: DictationTarget }
  | { phase: "error"; target: DictationTarget; message: string; settings?: boolean }

export type TalkPhase = "starting" | "listening" | "hearing" | "writing" | "thinking" | "speaking" | "muted" | "error"

export type Talk = {
  open: boolean
  phase: TalkPhase
  level: number
  /** What you said last. */
  heard: string
  /** The answer being read, and how far the voice has got (characters). */
  reply: string
  spokenUpTo: number
  /** A word was just spoken (the orb answers each one). */
  beat: number
  message?: string
  settings?: boolean
  /** No system voice: answers are shown, not read. */
  silent?: boolean
}

export type VoiceState = { dictation: Dictation; talk: Talk }

const CLOSED_TALK: Talk = { open: false, phase: "starting", level: 0, heard: "", reply: "", spokenUpTo: 0, beat: 0 }

let state: VoiceState = { dictation: { phase: "idle" }, talk: CLOSED_TALK }
const listeners = new Set<() => void>()

function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
const setTalk = (patch: Partial<Talk>) => set({ talk: { ...state.talk, ...patch } })

export const getVoice = () => state
export function useVoice<T>(select: (s: VoiceState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => select(state),
    () => select(state),
  )
}

/** Tests: put voice into a state without a microphone. */
export function setVoiceForTests(next: Partial<VoiceState>) {
  set(next)
}

// In a plain browser (the screenshot tests, never Electron) the tests can set voice states directly.
if (typeof window !== "undefined" && !window.axe) Object.assign(window, { __axeVoice: setVoiceForTests })

// ---------- The microphone ----------

const MIC_DENIED = "Axe can't hear you. Allow the microphone in System Settings."

/** An open microphone: a level meter and a recorder. */
class Mic {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private raf = 0
  private readonly samples: Uint8Array<ArrayBuffer>

  private constructor(
    private readonly stream: MediaStream,
    private readonly ctx: AudioContext,
    private readonly analyser: AnalyserNode,
    private readonly onLevel: (level: number) => void,
  ) {
    this.samples = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    const tick = () => {
      this.analyser.getByteTimeDomainData(this.samples)
      this.onLevel(levelOf(this.samples))
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  static async open(onLevel: (level: number) => void): Promise<Mic> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    return new Mic(stream, ctx, analyser, onLevel)
  }

  record() {
    this.chunks = []
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m))
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined)
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.recorder.start(250)
  }

  /** Stops recording; the audio so far. */
  async take(): Promise<Blob> {
    const r = this.recorder
    if (!r) return new Blob()
    this.recorder = null
    if (r.state !== "inactive") {
      await new Promise<void>((done) => {
        r.onstop = () => done()
        r.stop()
      })
    }
    return new Blob(this.chunks, { type: r.mimeType || "audio/webm" })
  }

  close() {
    cancelAnimationFrame(this.raf)
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop()
    this.recorder = null
    for (const t of this.stream.getTracks()) t.stop()
    void this.ctx.close().catch(() => {})
  }
}

/** Asks for the microphone (just in time) and opens it; null and a message when it can't. */
async function openMic(onLevel: (level: number) => void): Promise<Mic | { error: string; settings?: boolean }> {
  try {
    if ((await invoke("voice:microphone")) === "denied") return { error: MIC_DENIED, settings: true }
    return await Mic.open(onLevel)
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ""
    if (name === "NotAllowedError") return { error: MIC_DENIED, settings: true }
    if (name === "NotFoundError") return { error: "No microphone found. Plug one in and try again." }
    if (name === "NotSupportedError" || name === "NotReadableError") return { error: "The microphone isn't available. Another app may be using it." }
    return { error: plainError(e) }
  }
}

/** A recording as the 16 kHz mono WAV the Mac's speech model reads. */
async function toWav(blob: Blob): Promise<Uint8Array> {
  const rate = 16_000
  const audio = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await blob.arrayBuffer())
  return encodeWav(mono(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))), rate)
}

async function toText(blob: Blob): Promise<string> {
  // On the Mac itself when it can; axeai.com when it can't (other systems, older macOS, no model yet).
  if (await invoke("voice:onDevice").catch(() => false)) {
    const wav = await toWav(blob).catch(() => null)
    const text = wav ? await invoke("voice:transcribeOnDevice", wav).catch(() => null) : null
    if (text !== null) return text
  }
  return invoke("voice:transcribe", new Uint8Array(await blob.arrayBuffer()), blob.type)
}

export const openMicSettings = () => void invoke("voice:openMicSettings")

// ---------- Dictation ----------

let mic: Mic | null = null
let pressedAt: number | null = null
let maxTimer: ReturnType<typeof setTimeout> | undefined
const MAX_DICTATION_MS = 115_000
const WAVE = 40

/** Text that dictation wrote, for the composer or the quick bar to insert where the cursor is. */
export const DICTATED = "axe:dictated"
export type DictatedDetail = { target: DictationTarget; text: string }

export async function startDictation(target: DictationTarget) {
  if (state.dictation.phase === "listening" || state.dictation.phase === "asking" || state.talk.open) return
  set({ dictation: { phase: "asking", target } })
  const opened = await openMic((level) => {
    const d = state.dictation
    if (d.phase !== "listening") return
    set({ dictation: { ...d, levels: [...d.levels.slice(-(WAVE - 1)), level] } })
  })
  if (!(opened instanceof Mic)) {
    set({ dictation: { phase: "error", target, message: opened.error, settings: opened.settings } })
    return
  }
  // Cancelled while the system was asking.
  if (getVoice().dictation.phase !== "asking") {
    opened.close()
    return
  }
  mic = opened
  mic.record()
  set({ dictation: { phase: "listening", target, startedAt: Date.now(), levels: [] } })
  maxTimer = setTimeout(() => void finishDictation(), MAX_DICTATION_MS)
}

export async function finishDictation() {
  const d = state.dictation
  if (d.phase !== "listening" || !mic) return
  clearTimeout(maxTimer)
  const m = mic
  mic = null
  set({ dictation: { phase: "writing", target: d.target } })
  try {
    const blob = await m.take()
    m.close()
    const text = await toText(blob)
    if (!text) {
      set({ dictation: { phase: "error", target: d.target, message: "Didn't catch that. Try again a little closer." } })
      return
    }
    window.dispatchEvent(new CustomEvent<DictatedDetail>(DICTATED, { detail: { target: d.target, text } }))
    set({ dictation: { phase: "idle" } })
  } catch (e) {
    set({ dictation: { phase: "error", target: d.target, message: plainError(e) } })
  }
}

export function cancelDictation() {
  clearTimeout(maxTimer)
  mic?.close()
  mic = null
  pressedAt = null
  set({ dictation: { phase: "idle" } })
}

/** The microphone button: start, or stop and write it down. */
export function toggleDictation(target: DictationTarget) {
  const p = state.dictation.phase
  if (p === "listening") void finishDictation()
  else if (p === "idle" || p === "error") void startDictation(target)
}

/** Hold-to-talk, key down: starts (or a tap ends a recording a tap started). */
export function holdDown(target: DictationTarget) {
  if (state.dictation.phase === "listening") {
    pressedAt = null
    void finishDictation()
    return
  }
  pressedAt = Date.now()
  void startDictation(target)
}

/** Key up: a long press ends the recording; a short tap leaves it running. */
export function holdUp() {
  if (pressedAt === null) return
  const held = Date.now() - pressedAt
  pressedAt = null
  if (held < HOLD_MS) return
  if (state.dictation.phase === "listening") void finishDictation()
  else if (state.dictation.phase === "asking") {
    // Let go before the microphone opened: end as soon as it does.
    const wait = setInterval(() => {
      if (state.dictation.phase === "asking") return
      clearInterval(wait)
      if (state.dictation.phase === "listening") void finishDictation()
    }, 50)
  }
}

// ---------- Speaking ----------

const synth = () => (typeof speechSynthesis !== "undefined" ? speechSynthesis : null)

async function voices(): Promise<SpeechSynthesisVoice[]> {
  const s = synth()
  if (!s) return []
  const now = s.getVoices()
  if (now.length) return now
  // Chromium loads them a moment after start.
  return new Promise((done) => {
    const t = setTimeout(() => done(s.getVoices()), 800)
    s.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(t)
        done(s.getVoices())
      },
      { once: true },
    )
  })
}

/** Reads text aloud, sentence by sentence; resolves when done or stopped. */
async function speak(text: string, alive: () => boolean, onProgress: (upTo: number) => void): Promise<"spoken" | "silent"> {
  // Self-tests never make a sound: the words light up at a speaking pace instead.
  if (window.axe?.quiet) {
    for (const m of text.matchAll(/\S+/g)) {
      if (!alive()) break
      onProgress(m.index)
      await new Promise((r) => setTimeout(r, 120))
    }
    onProgress(text.length)
    return "spoken"
  }
  const s = synth()
  const list = await voices()
  if (!s || !list.length) return "silent"
  const voice = pickVoice(list, navigator.language)
  let offset = 0
  for (const chunk of speechChunks(text)) {
    if (!alive()) return "spoken"
    const start = text.indexOf(chunk, offset)
    const base = start >= 0 ? start : offset
    await new Promise<void>((done) => {
      const u = new SpeechSynthesisUtterance(chunk)
      if (voice) u.voice = voice
      u.lang = voice?.lang ?? navigator.language
      u.onboundary = (e) => {
        if (e.name === "word" || e.name === undefined) onProgress(base + e.charIndex)
      }
      u.onend = () => done()
      u.onerror = () => done()
      s.speak(u)
    })
    offset = base + chunk.length
    onProgress(offset)
  }
  return "spoken"
}

// ---------- Talk mode ----------

let talkRun = 0
let talkMic: Mic | null = null

/** Opens Talk: speak, Axe answers in the open chat (or a new one) and reads it back, then listens again. */
export async function openTalk() {
  if (state.talk.open) return
  cancelDictation()
  const run = ++talkRun
  setTalk({ ...CLOSED_TALK, open: true, phase: "starting" })
  const opened = await openMic((level) => {
    if (state.talk.phase === "listening" || state.talk.phase === "hearing") setTalk({ level })
  })
  if (run !== talkRun) {
    if (opened instanceof Mic) opened.close()
    return
  }
  if (!(opened instanceof Mic)) {
    setTalk({ phase: "error", message: opened.error, settings: opened.settings })
    return
  }
  talkMic = opened
  void talkLoop(run)
}

export function closeTalk() {
  talkRun++
  synth()?.cancel()
  talkMic?.close()
  talkMic = null
  set({ talk: CLOSED_TALK })
}

/** Mute: Axe stops listening until you unmute. */
export function toggleMute() {
  if (!state.talk.open) return
  if (state.talk.phase === "muted") {
    setTalk({ phase: "listening", level: 0 })
    void talkLoop(++talkRun)
  } else {
    talkRun++
    synth()?.cancel()
    void talkMic?.take()
    setTalk({ phase: "muted", level: 0 })
  }
}

/** Tapping the orb while Axe speaks: stop reading and listen. */
export function interrupt() {
  if (state.talk.phase !== "speaking") return
  talkRun++
  synth()?.cancel()
  setTalk({ phase: "listening", level: 0 })
  void talkLoop(talkRun)
}

async function talkLoop(run: number) {
  const alive = () => run === talkRun && state.talk.open
  while (alive()) {
    const m = talkMic
    if (!m) return
    setTalk({ phase: "listening", level: 0, message: undefined })
    const blob = await hearTurn(m, alive)
    if (!alive() || !blob) continue
    setTalk({ phase: "writing", level: 0 })
    let text = ""
    try {
      text = await toText(blob)
    } catch (e) {
      setTalk({ phase: "error", message: plainError(e) })
      return
    }
    if (!alive()) return
    if (!text) continue
    setTalk({ phase: "thinking", heard: text, reply: "", spokenUpTo: 0 })
    const reply = await ask(text, alive)
    if (!alive()) return
    if (reply === null) {
      setTalk({ phase: "error", message: "Axe didn't answer. Try again." })
      return
    }
    const words = speakable(reply)
    setTalk({ phase: "speaking", reply: words, spokenUpTo: 0 })
    const how = await speak(words, alive, (upTo) => alive() && setTalk({ spokenUpTo: upTo, beat: state.talk.beat + 1 }))
    if (how === "silent") {
      setTalk({ silent: true, spokenUpTo: words.length })
      await new Promise((r) => setTimeout(r, Math.min(6000, 800 + words.length * 20)))
    }
  }
}

/** Records one turn: from when you start speaking until a pause. Null when nobody spoke. */
async function hearTurn(m: Mic, alive: () => boolean): Promise<Blob | null> {
  for (;;) {
    m.record()
    const gate = new SilenceGate()
    let heard = false
    const outcome = await new Promise<"done" | "nothing" | "stopped">((done) => {
      const t = setInterval(() => {
        if (!alive()) {
          clearInterval(t)
          return done("stopped")
        }
        const g = gate.push(state.talk.level, Date.now())
        if (g === "speaking" && !heard) {
          heard = true
          setTalk({ phase: "hearing" })
        }
        if (g === "done" || g === "nothing") {
          clearInterval(t)
          done(g)
        }
      }, 50)
    })
    const blob = await m.take()
    if (outcome === "stopped") return null
    if (outcome === "done") return blob
    // Nobody spoke for a while: start a fresh recording so it never grows large.
  }
}

/** Sends what you said in the open chat (or starts one) and waits for the whole answer. */
async function ask(text: string, alive: () => boolean): Promise<string | null> {
  const v = getState().view
  const before = v.kind === "thread" ? (getState().messages[v.id] ?? []).length : 0
  if (v.kind === "thread") await sendInThread(v.id, text)
  else await sendNew(text)
  const after = getState().view
  if (after.kind !== "thread") return null
  const id = after.id
  const started = Date.now()
  return new Promise((done) => {
    const t = setInterval(() => {
      const s = getState()
      const msgs = s.messages[id] ?? []
      const last = [...msgs].reverse().find((m) => m.role === "assistant")
      const fresh = msgs.length > before && last && msgs.indexOf(last) >= before
      const running = !!s.live[id] || !!s.threads.find((x) => x.id === id)?.running
      if (!alive()) {
        clearInterval(t)
        return done(null)
      }
      if (fresh && !running) {
        clearInterval(t)
        const err = last.parts.find((p) => p.type === "error")
        done(replyText(last.parts) || (err && err.type === "error" ? err.text : "") || "Done.")
      } else if (Date.now() - started > 5 * 60_000) {
        clearInterval(t)
        done(null)
      }
    }, 150)
  })
}

export { HOLD_MS }
