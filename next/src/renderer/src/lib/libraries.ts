import type { Answerer, Helper, Skill, SkillLibrary } from "@shared/types"

import { invoke } from "./bridge"
import { getState, plainError, setState, type State, updateSettings } from "./store"

// The window's side of the libraries: open a page, load it, and act on it. State lives in the store
// (`library`, `draft`); the engine does the work (src/main/libraries).

type LibraryView = "skills" | "agents" | "connectors"

const setLibrary = (patch: Partial<State["library"]>) => setState((s) => ({ library: { ...s.library, ...patch } }))

export function openLibrary(kind: LibraryView) {
  setState({ view: { kind }, paletteOpen: false })
  if (kind === "skills") void loadSkills()
  if (kind === "agents") void Promise.all([loadHelpers(), loadSkills(), loadConnectors()])
  if (kind === "connectors") void loadConnectors()
}

/** Runs an engine call; returns the plain sentence when it fails. */
async function attempt<T>(run: () => Promise<T>, done: (v: T) => void): Promise<string | null> {
  try {
    done(await run())
    return null
  } catch (e) {
    return plainError(e)
  }
}

// Skills

export const loadSkills = () => attempt(() => invoke("skills:list"), (skills) => setLibrary({ skills }))
export const installSkill = (id: string, targets: string[]) => attempt(() => invoke("skills:install", id, targets), (skills) => setLibrary({ skills }))
export const uninstallSkill = (id: string) => attempt(() => invoke("skills:uninstall", id), (skills) => setLibrary({ skills }))
export const createSkill = (skill: { name: string; description: string; body: string }) =>
  attempt(() => invoke("skills:create", skill), (skills) => setLibrary({ skills }))
export const importSkill = () => attempt(() => invoke("skills:import"), (skills) => setLibrary({ skills }))
export const readSkill = (id: string) => invoke("skills:read", id)

/** "brand-voice" → "Brand voice". */
export const skillTitle = (s: Pick<Skill, "id" | "name">) => {
  const n = (s.name || s.id).replace(/[-_]+/g, " ").trim()
  return n.charAt(0).toUpperCase() + n.slice(1)
}

/** Skills an Axe model can use from / (installed in Axe). */
/** Skills Axe's / menu offers: added to Axe and not switched off. */
export const axeSkills = (lib: SkillLibrary | null, off: string[] = getState().settings.offSkills ?? []) =>
  (lib?.skills ?? []).filter((s) => s.installedIn.includes("axe") && !off.includes(s.id))

/** Switches a skill on or off: off keeps it on disk, out of the / menu and agents' chats. */
export const setSkillOn = (id: string, on: boolean) => {
  const off = new Set(getState().settings.offSkills ?? [])
  if (on) off.delete(id)
  else off.add(id)
  return updateSettings({ offSkills: [...off] })
}

// Agents

export const loadHelpers = () => attempt(() => invoke("helpers:list"), (helpers) => setLibrary({ helpers }))
export const saveHelper = (h: Omit<Helper, "id"> & { id?: string }) => attempt(() => invoke("helpers:save", h), (helpers) => setLibrary({ helpers }))
export const deleteHelper = (id: string) => attempt(() => invoke("helpers:delete", id), (helpers) => setLibrary({ helpers }))

/** A new chat with an agent from the library: its answerer, web search and connectors. */
export function startWithHelper(h: Helper) {
  const s = getState()
  // "Your default model": the Axe model you last used, never a CLI (that would need a folder).
  const axeDefault: Answerer = s.settings.answerer?.kind === "axe" ? s.settings.answerer : { kind: "axe", modelId: s.catalog?.axe.defaultModelId ?? "auto" }
  const answerer: Answerer = h.answerer ?? axeDefault
  // An agent that needs a CLI you haven't got falls back to your default.
  const usable =
    answerer.kind === "agent" && !s.catalog?.agents.some((a) => a.id === answerer.agentId && a.state === "ready")
      ? { kind: "axe" as const, modelId: s.catalog?.axe.defaultModelId ?? "auto" }
      : answerer
  setState((st) => ({
    view: { kind: "new" },
    paletteOpen: false,
    draft: {
      ...st.draft,
      answerer: usable,
      helperId: h.id,
      webSearch: h.webSearch || st.draft.webSearch,
      connectors: h.connectors,
      // A CLI agent starts in its own folder.
      ...(usable.kind === "agent" && h.cwd ? { cwd: h.cwd } : {}),
    },
  }))
  if (usable.kind === "axe") void updateSettings({ answerer: usable })
}

export function clearHelper() {
  setState((s) => ({ draft: { ...s.draft, helperId: undefined, connectors: [] } }))
}

// Connectors

export const loadConnectors = () => attempt(() => invoke("connectors:list"), (connectors) => setLibrary({ connectors }))
export const connect = (catalogId: string, token?: string) => attempt(() => invoke("connectors:connect", catalogId, token), (connectors) => setLibrary({ connectors }))
export const cancelConnect = () => invoke("connectors:cancel")
export const addCustomConnector = (c: { name: string; url?: string; command?: string; args?: string[]; token?: string }) =>
  attempt(() => invoke("connectors:addCustom", c), (connectors) => setLibrary({ connectors }))
export const setConnectorEnabled = (id: string, enabled: boolean) =>
  attempt(() => invoke("connectors:setEnabled", id, enabled), (connectors) => setLibrary({ connectors }))
export const removeConnector = (id: string) => attempt(() => invoke("connectors:remove", id), (connectors) => setLibrary({ connectors }))

/** Turns a connector on or off for the new chat, or for an open one. */
export async function toggleChatConnector(id: string, threadId?: string) {
  if (!threadId) {
    setState((s) => {
      const now = s.draft.connectors ?? []
      return { draft: { ...s.draft, connectors: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] } }
    })
    return
  }
  const t = getState().threads.find((x) => x.id === threadId)
  const now = t?.connectors ?? []
  const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id]
  setState((s) => ({ threads: s.threads.map((x) => (x.id === threadId ? { ...x, connectors: next } : x)) }))
  await invoke("chat:setConnectors", threadId, next)
}
