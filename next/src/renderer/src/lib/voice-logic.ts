// The parts of voice that don't need a microphone or a speaker: hearing when you stop talking,
// turning an answer into words worth saying, and cutting it into sentences the system voice reads well.

/** How loud a frame is, 0 to 1, from the analyser's time-domain samples (0–255, 128 is silence). */
export function levelOf(samples: ArrayLike<number>): number {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i]! - 128) / 128
    sum += v * v
  }
  const rms = Math.sqrt(sum / samples.length)
  // Speech sits around 0.02–0.2 RMS; spread that over the useful range.
  return Math.min(1, Math.sqrt(rms) * 1.6)
}

export type GateState = "waiting" | "speaking" | "done" | "nothing"

export type GateOptions = {
  /** Louder than this counts as speech starting. */
  start: number
  /** Quieter than this counts as a pause. */
  end: number
  /** A pause this long after speech ends the turn. */
  silenceMs: number
  /** Speech shorter than this was a cough or a click. */
  minSpeechMs: number
  /** No speech for this long: start over (keeps recordings small). */
  waitMs: number
  /** A turn never runs longer than this. */
  maxMs: number
}

export const GATE: GateOptions = { start: 0.22, end: 0.15, silenceMs: 1000, minSpeechMs: 300, waitMs: 12_000, maxMs: 60_000 }

/**
 * Hears a turn in Talk mode: waits for speech, follows it through short pauses, and says "done"
 * once you've been quiet for a moment. "nothing" means nobody spoke for a while.
 */
export class SilenceGate {
  private began: number | null = null
  private speechAt: number | null = null
  private loudSince: number | null = null
  private quietSince: number | null = null
  private heard = false

  constructor(private readonly o: GateOptions = GATE) {}

  push(level: number, now: number): GateState {
    this.began ??= now
    if (level >= this.o.start) {
      this.loudSince ??= now
      this.quietSince = null
      if (!this.heard && now - this.loudSince >= this.o.minSpeechMs) {
        this.heard = true
        this.speechAt = this.loudSince
      }
    } else if (level < this.o.end) {
      this.loudSince = null
      this.quietSince ??= now
    }
    if (!this.heard) return now - this.began >= this.o.waitMs ? "nothing" : "waiting"
    if (now - (this.speechAt ?? now) >= this.o.maxMs) return "done"
    if (this.quietSince !== null && now - this.quietSince >= this.o.silenceMs) return "done"
    return "speaking"
  }

  get spoke() {
    return this.heard
  }
}

/**
 * What to say out loud for an answer written in Markdown: the words, without the markup. Code,
 * tables and cards stay on screen; the voice says where to look instead of reading them.
 */
export function speakable(markdown: string): string {
  const notes: string[] = []
  let text = markdown.replace(/\r/g, "")
  // Cards (```axe-chart …```) and code blocks.
  text = text.replace(/```([\w-]*)[^\n]*\n?[\s\S]*?(```|$)/g, (_m, lang: string) => {
    if (lang.startsWith("axe-")) {
      if (!notes.includes("card")) notes.push("card")
    } else if (!notes.includes("code")) notes.push("code")
    return "\n"
  })
  // Tables: every line that starts with a pipe.
  const lines = text.split("\n")
  const kept = lines.filter((l) => !/^\s*\|/.test(l))
  if (kept.length !== lines.length) notes.push("table")
  text = kept
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, ""),
    )
    .join("\n")
  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+\]/g, "")
    .replace(/https?:\/\/[^\s)\]>]+/g, "a link")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
  // Lines become sentences: a list item without a full stop still gets a pause.
  text = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?:;,]$/.test(l) ? l : `${l}.`))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  const where: Record<string, string> = {
    code: "The code is in the chat.",
    table: "The table is in the chat.",
    card: "There's more to see in the chat.",
  }
  const tail = ["code", "table", "card"].filter((n) => notes.includes(n)).map((n) => where[n])
  return [text, ...tail].filter(Boolean).join(" ")
}

/** Sentences, joined up to about `max` characters (system voices stall on very long utterances). */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? []
  const out: string[] = []
  for (const s of sentences) {
    const last = out[out.length - 1]
    if (last && last.length + 1 + s.length <= max) out[out.length - 1] = `${last} ${s}`
    else if (s.length <= max) out.push(s)
    else {
      // One very long sentence: break at commas, then at spaces.
      let rest = s
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf(" ", max))
        const at = cut > max / 2 ? cut + 1 : max
        out.push(rest.slice(0, at).trim())
        rest = rest.slice(at).trim()
      }
      if (rest) out.push(rest)
    }
  }
  return out
}

/** The house voice first (Daniel, like axeai.com), then the best-sounding voice for the language. */
export function pickVoice<V extends { name: string; lang: string; localService?: boolean }>(voices: V[], lang = "en"): V | undefined {
  const base = lang.toLowerCase().split("-")[0]!
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  const pool = same.length ? same : voices
  const score = (v: V) =>
    (v.name === "Daniel" && v.lang === "en-GB" ? 100 : 0) +
    (/premium|enhanced|natural|neural/i.test(v.name) ? 20 : 0) +
    (v.localService ? 5 : 0) +
    (/^en-(US|GB)$/i.test(v.lang) ? 3 : 0) -
    (/compact|eloquence|novelty|whisper|bad news|bells|boing|bubbles|cellos|zarvox|trinoids|organ|jester|superstar|wobble|albert|fred|junior|ralph|kathy|bahh/i.test(v.name) ? 50 : 0)
  return [...pool].sort((a, b) => score(b) - score(a))[0]
}

/** One channel from several: their average. */
export function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!
  const out = new Float32Array(channels[0]?.length ?? 0)
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i]! += c[i]! / channels.length
  return out
}

/** Samples (-1 to 1) as a 16-bit mono WAV file, what the Mac's speech model reads. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples.length * 2))
  const v = new DataView(bytes.buffer)
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, "RIFF")
  v.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, "data")
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!))
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return bytes
}

/** Seconds as "0:07". */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * Hold-to-talk: a long press records while held; a short tap starts a recording that the next tap
 * ends. Returns what a key-up means.
 */
export const HOLD_MS = 350
export const releaseMeans = (pressedAt: number, now: number) => (now - pressedAt >= HOLD_MS ? "finish" : "keep")
