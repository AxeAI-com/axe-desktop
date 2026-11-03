import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app, session, shell, systemPreferences, type Session } from "electron"

import type { MicAccess } from "@shared/types"

import * as account from "./axe/account"
import { AxeError } from "./axe/client"
import { isSelfTest } from "./paths"

// Voice: the window records; the engine asks for the microphone (only when you first use it, never
// at launch) and turns speech into text. On a Mac with macOS 26 or later that happens on the Mac
// itself (the axe-speech helper, native/speech/main.swift, Apple's on-device model); elsewhere, and
// whenever the Mac can't, on axeai.com. Reading answers aloud uses the system's own voices in the
// window (speechSynthesis), so no audio leaves the computer for that.

/** Max recording the server takes (packages/contracts VOICE_MAX_BYTES). */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024

export async function microphone(): Promise<MicAccess> {
  // Self-tests speak a recording into the window (AXE_FAKE_MIC=1), never the real microphone: no system prompt.
  if (isSelfTest() && process.env.AXE_FAKE_MIC) return "granted"
  if (process.platform !== "darwin") return "granted"
  const status = systemPreferences.getMediaAccessStatus("microphone")
  if (status === "granted") return "granted"
  if (status === "not-determined") return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" : "denied"
  return "denied"
}

export function openMicSettings() {
  if (process.platform === "darwin") void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
  else if (process.platform === "win32") void shell.openExternal("ms-settings:privacy-microphone")
}

export async function transcribe(audio: Uint8Array, mime: string): Promise<string> {
  if (!audio.byteLength) throw new Error("Nothing was recorded. Try again.")
  if (audio.byteLength > MAX_AUDIO_BYTES) throw new Error("That recording is too long. Keep it under two minutes.")
  try {
    return await account.anyClient().transcribe(audio, mime)
  } catch (e) {
    if (e instanceof AxeError) throw new Error(e.plain)
    throw new Error("Couldn't reach Axe to write that down. Check your connection.")
  }
}

// ---------- On this Mac ----------

function helper(): string | undefined {
  if (process.platform !== "darwin") return undefined
  const candidates = [join(process.resourcesPath ?? "", "axe-speech"), join(app.getAppPath(), "resources", "axe-speech")]
  return candidates.find((p) => existsSync(p))
}

/** The language you speak: the first one in the system's list ("en-GB"). */
const language = () => app.getPreferredSystemLanguages()[0] ?? app.getLocale()

type HelperReply = { ok: boolean; status?: string; text?: string; error?: string }

function runHelper(args: string[], timeoutMs: number): Promise<HelperReply> {
  const file = helper()
  if (!file) return Promise.resolve({ ok: false, error: "unavailable" })
  return new Promise((done) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (_err, stdout) => {
      try {
        done(JSON.parse(stdout.trim().split("\n").pop() ?? "") as HelperReply)
      } catch {
        done({ ok: false, error: "no answer" })
      }
    })
  })
}

let ready = false
let preparing: Promise<unknown> | null = null

/** True once this Mac can write speech down itself; the first call gets the model ready in the background. */
export async function onDevice(): Promise<boolean> {
  if (ready) return true
  if (!helper()) return false
  const r = await runHelper(["status", language()], 5_000)
  if (r.ok && r.status === "installed") return (ready = true)
  if (r.ok && (r.status === "supported" || r.status === "downloading")) {
    // A model to download (usually small, often already on the Mac): axeai.com meanwhile.
    preparing ??= runHelper(["prepare", language()], 10 * 60_000).then((p) => {
      ready = p.ok && p.status === "installed"
      preparing = null
    })
  }
  return false
}

/** Speech to text on this Mac; null when it couldn't, so the window uses axeai.com instead. */
export async function transcribeOnDevice(wav: Uint8Array): Promise<string | null> {
  if (!wav.byteLength || !(await onDevice())) return null
  const file = join(app.getPath("temp"), `axe-voice-${process.pid}-${Date.now()}.wav`)
  try {
    await writeFile(file, wav, { mode: 0o600 })
    const r = await runHelper(["transcribe", language(), file], 30_000)
    if (r.error === "not_installed") ready = false
    return r.ok ? (r.text ?? "") : null
  } finally {
    await rm(file, { force: true })
  }
}

/** The app's own pages may use the microphone; nothing else gets any device. */
export function allowOwnMicrophone(s: Session = session.defaultSession) {
  const own = (url: string) => url.startsWith("file://") || (!!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))
  s.setPermissionRequestHandler((wc, permission, done, details) => {
    const audioOnly = permission === "media" && "mediaTypes" in details && (details.mediaTypes ?? []).every((t) => t === "audio")
    done(own(wc.getURL()) && (audioOnly || permission === "clipboard-sanitized-write"))
  })
  s.setPermissionCheckHandler((wc, permission) => !!wc && own(wc.getURL()) && (permission === "media" || permission === "clipboard-sanitized-write"))
}
