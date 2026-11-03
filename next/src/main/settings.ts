import { defaultQuickBarKey, formatParsed, parseAccelerator, type Platform } from "@shared/accelerator"
import type { Settings } from "@shared/types"
import { isSummaryAt } from "@shared/watching/summary"

import { isMode } from "./agents/modes"
import { dataPath, readJSON, writeJSON } from "./paths"

export const DEFAULT_BASE_URL = "https://axeai.com"

const platform = process.platform as Platform
const defaults: Settings = { baseURL: DEFAULT_BASE_URL, theme: "system", sidebarWidth: 300, quickBarKey: defaultQuickBarKey(platform) }

let current: Settings | undefined
const listeners = new Set<(next: Settings, previous: Settings) => void>()

const file = () => dataPath("settings.json")

function load(): Settings {
  const saved = readJSON<Partial<Settings>>(file(), {})
  const s: Settings = { ...defaults, ...saved }
  // Tests and self-tests point the engine at a local server without saving it.
  if (process.env.AXE_BASE_URL) s.baseURL = process.env.AXE_BASE_URL
  s.baseURL = s.baseURL.replace(/\/+$/, "")
  return s
}

export function settings(): Settings {
  current ??= load()
  return current
}

export function onSettingsChange(fn: (next: Settings, previous: Settings) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const THEMES = new Set(["system", "light", "dark"])

export function updateSettings(patch: Partial<Settings>): Settings {
  const previous = settings()
  const next: Settings = { ...previous }
  if (patch.theme !== undefined && THEMES.has(patch.theme)) next.theme = patch.theme
  if (patch.sidebarWidth !== undefined && Number.isFinite(patch.sidebarWidth))
    next.sidebarWidth = Math.round(Math.min(560, Math.max(200, patch.sidebarWidth)))
  if (patch.answerer !== undefined) next.answerer = patch.answerer
  if (patch.mode !== undefined && isMode(patch.mode)) next.mode = patch.mode
  if (patch.agentConfig !== undefined) next.agentConfig = cleanAgentConfig(patch.agentConfig)
  // Reaches here only from the window (settings:set); no model or agent can call it.
  if (patch.fullAccess !== undefined) next.fullAccess = patch.fullAccess === true
  if (patch.keepAwake !== undefined && ["off", "runs", "plugged", "always"].includes(patch.keepAwake)) next.keepAwake = patch.keepAwake
  if (patch.remoteEnabled !== undefined) next.remoteEnabled = patch.remoteEnabled === true
  if (patch.startOllama !== undefined) next.startOllama = patch.startOllama === true
  if (patch.phoneEnabled !== undefined) next.phoneEnabled = patch.phoneEnabled === true
  if (patch.watchNotify !== undefined) next.watchNotify = patch.watchNotify !== false
  if (patch.summaryAt !== undefined && isSummaryAt(patch.summaryAt)) next.summaryAt = patch.summaryAt
  if (patch.offSkills !== undefined)
    next.offSkills = Array.isArray(patch.offSkills) ? [...new Set(patch.offSkills.filter((s): s is string => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s)))] : []
  if (patch.modelServers !== undefined)
    next.modelServers = (Array.isArray(patch.modelServers) ? patch.modelServers : []).filter(
      (s) => !!s && /^custom-[a-z0-9]{1,16}$/.test(s.id) && typeof s.name === "string" && /^https?:\/\//.test(s.url),
    )
  if (patch.boardAnswerer === null) delete next.boardAnswerer
  else if (patch.boardAnswerer !== undefined) next.boardAnswerer = patch.boardAnswerer
  if (patch.quickBarKey !== undefined) {
    const p = parseAccelerator(patch.quickBarKey, platform)
    if (!p) throw new Error("Use a key with ⌘, Ctrl, Alt or Shift, like Alt+Space.")
    next.quickBarKey = formatParsed(p)
  }
  if (patch.baseURL !== undefined) {
    const u = new URL(patch.baseURL)
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1")
      throw new Error("Use an https address.")
    next.baseURL = u.origin
  }
  current = next
  // AXE_BASE_URL is a session override; never write it to disk.
  const saved = { ...next }
  if (process.env.AXE_BASE_URL && patch.baseURL === undefined)
    saved.baseURL = readJSON<Partial<Settings>>(file(), {}).baseURL ?? DEFAULT_BASE_URL
  writeJSON(file(), saved)
  for (const l of listeners) l(next, previous)
  return next
}

/** Tests only: forget what was loaded. */
export function resetSettingsForTests() {
  current = undefined
}

/** Agent id to {option id: value}, short strings only. */
function cleanAgentConfig(v: unknown): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  if (!v || typeof v !== "object") return out
  for (const [agent, picks] of Object.entries(v as Record<string, unknown>)) {
    if (!picks || typeof picks !== "object" || agent.length > 100) continue
    const kept: Record<string, string> = {}
    for (const [id, value] of Object.entries(picks as Record<string, unknown>)) if (typeof value === "string" && id.length <= 100 && value.length <= 200) kept[id] = value
    out[agent] = kept
  }
  return out
}
