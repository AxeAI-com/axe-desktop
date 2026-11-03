import { randomUUID } from "node:crypto"

import type { Helper } from "@shared/types"

import { STARTER_HELPERS } from "@shared/starter-helpers"

import { dataPath, readJSON, writeJSON } from "../paths"

export { STARTER_HELPERS }

// The agents library: ready-made helpers with their own instructions, who answers (an Axe model or
// a CLI), the skills they use and the connectors they switch on. Axe's starters live here in code;
// yours live in helpers.json. A starter can be copied and changed, not deleted. Starting a chat with
// one puts its instructions ahead of the first message (libraries/context.ts).

const KINDS: Helper["kind"][] = ["write", "research", "code", "plan", "support", "data", "design", "custom"]

const file = () => dataPath("helpers.json")

export function listHelpers(): Helper[] {
  const mine = readJSON<Helper[]>(file(), [])
  return [...STARTER_HELPERS, ...(Array.isArray(mine) ? mine.filter((h) => h && typeof h.id === "string" && !h.starter) : [])]
}

export const getHelper = (id: string) => listHelpers().find((h) => h.id === id)

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "")
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length < 100))].slice(0, 20) : [])

export function saveHelper(input: Omit<Helper, "id"> & { id?: string }): Helper[] {
  const name = clean(input.name, 60)
  if (!name) throw new Error("Give the agent a name.")
  const instructions = clean(input.instructions, 8000)
  if (!instructions) throw new Error("Write what it should do.")
  const mine = listHelpers().filter((h) => !h.starter)
  // Changing a starter saves your own copy.
  const id = input.id && !STARTER_HELPERS.some((s) => s.id === input.id) ? input.id : `h_${randomUUID()}`
  const a = input.answerer
  const answerer =
    a && a.kind === "axe" && a.modelId
      ? { kind: "axe" as const, modelId: a.modelId }
      : a && a.kind === "agent" && a.agentId
        ? { kind: "agent" as const, agentId: a.agentId }
        : a && a.kind === "local" && a.modelId
          ? { kind: "local" as const, modelId: a.modelId }
          : undefined
  const helper: Helper = {
    id,
    name,
    role: clean(input.role, 120),
    instructions,
    kind: KINDS.includes(input.kind) ? input.kind : "custom",
    skills: ids(input.skills),
    connectors: ids(input.connectors),
    webSearch: input.webSearch === true,
    ...(answerer ? { answerer } : {}),
    ...(answerer?.kind === "agent" && typeof input.cwd === "string" && input.cwd.startsWith("/") ? { cwd: input.cwd } : {}),
  }
  const next = mine.some((h) => h.id === id) ? mine.map((h) => (h.id === id ? helper : h)) : [...mine, helper]
  writeJSON(file(), next)
  return listHelpers()
}

export function deleteHelper(id: string): Helper[] {
  if (STARTER_HELPERS.some((s) => s.id === id)) throw new Error("Axe's own agents can't be deleted.")
  writeJSON(
    file(),
    listHelpers().filter((h) => !h.starter && h.id !== id),
  )
  return listHelpers()
}
