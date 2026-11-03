import type { ConnectorsView, Helper } from "@shared/types"

import { emit } from "../bus"
import { dataPath, isSelfTest, readJSON, writeJSON } from "../paths"
import { settings } from "../settings"
import { childEnv } from "../shell-env"
import { ConnectorHub } from "./connectors"
import { getHelper } from "./helpers"
import type { ConnectorSecret, SecretBox } from "./oauth"
import { Community } from "./community"
import { SkillStore, skillBlock } from "./skills"

// The libraries' engine side, shared by chat.ts and commands.ts: the skill store, the connector hub,
// what each chat was started with (agent, connectors), and the context block that carries an agent's
// or skill's instructions ahead of a message.

export const skills = new SkillStore()
export const community = new Community(skills)

/** Connector tokens: a plain file for tests and self-tests; the app swaps in the OS-encrypted box. */
const plainBox = (): SecretBox => {
  const file = () => dataPath("connector-secrets.json")
  return {
    get: (id) => readJSON<Record<string, ConnectorSecret>>(file(), {})[id],
    set: (id, secret) => {
      const all = readJSON<Record<string, ConnectorSecret>>(file(), {})
      if (secret) all[id] = secret
      else delete all[id]
      writeJSON(file(), all)
    },
  }
}

let options: { secrets?: SecretBox; openUrl?: (url: string) => Promise<void> } = {}
let hubInstance: ConnectorHub | undefined

/** The app passes the encrypted box and the browser; tests pass their own. Call before first use. */
export function configureLibraries(o: typeof options) {
  options = { ...options, ...o }
  void hubInstance?.closeAll()
  hubInstance = undefined
}

/** Self-tests "sign in" by fetching the sign-in page, which a fake server answers at once. */
async function fetchSignIn(url: string) {
  const r = await fetch(url, { redirect: "manual" })
  const back = r.headers.get("location")
  if (back) await fetch(back)
}

export function hub(): ConnectorHub {
  hubInstance ??= new ConnectorHub({
    file: () => dataPath("connectors.json"),
    secrets: options.secrets ?? plainBox(),
    openUrl: isSelfTest() && process.env.AXE_TEST_SIGNIN === "fetch" ? fetchSignIn : (options.openUrl ?? fetchSignIn),
    onChange: (view: ConnectorsView) => emit("connectors", view),
    env: childEnv,
  })
  return hubInstance
}

// What each chat was started with. Axe chats live on axeai.com, so this sits beside them on this computer.

/** `watchId`: a fix's agent session belongs to that watch's thread and stays out of Recents. */
export type ChatMeta = { helperId?: string; connectors?: string[]; allowed?: string[]; pageId?: string; watchId?: string }
const metaFile = () => dataPath("chat-meta.json")

export function allMeta(): Record<string, ChatMeta> {
  const m = readJSON<Record<string, ChatMeta>>(metaFile(), {})
  return m && typeof m === "object" ? m : {}
}
export const chatMeta = (threadId: string): ChatMeta => allMeta()[threadId] ?? {}
export function setChatMeta(threadId: string, patch: Partial<ChatMeta>) {
  const all = allMeta()
  const next = { ...all[threadId], ...patch }
  for (const k of Object.keys(next) as (keyof ChatMeta)[]) if (next[k] === undefined || (Array.isArray(next[k]) && !next[k].length)) delete next[k]
  if (Object.keys(next).length) all[threadId] = next
  else delete all[threadId]
  writeJSON(metaFile(), all)
}
export function moveChatMeta(from: string, to: string) {
  const all = allMeta()
  if (!all[from] || from === to) return
  all[to] = { ...all[from], ...all[to] }
  delete all[from]
  writeJSON(metaFile(), all)
}

// The context block

function helperText(h: Helper): string {
  return [`You are "${h.name}"${h.role ? `: ${h.role}` : ""}.`, h.instructions.trim()].join("\n")
}

/** Instructions for the start of a chat (an agent from the library) and for a skill picked from /, as one block. */
export async function contextFor(o: { helperId?: string; skillIds?: string[]; start: boolean }): Promise<string> {
  const parts: string[] = []
  const skillIds = new Set(o.skillIds ?? [])
  if (o.start && o.helperId) {
    const h = getHelper(o.helperId)
    if (h) {
      parts.push(helperText(h))
      for (const s of h.skills) skillIds.add(s)
    }
  }
  const off = new Set(settings().offSkills ?? [])
  for (const id of skillIds) {
    if (off.has(id)) continue
    const text = await skills.text(id).catch(() => "")
    if (text) parts.push(skillBlock(id, text))
  }
  return parts.join("\n\n")
}
