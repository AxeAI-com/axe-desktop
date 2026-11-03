import { randomUUID } from "node:crypto"

import type { MemoryItem } from "@shared/types"

import { dataPath, readJSON, writeJSON } from "./paths"

// What Axe remembers about you: short notes sent ahead of the first message of every
// new chat. axeai.com has no memory API yet, so they live on this computer, one file
// per account (memory-<user id>.json); the PR describes the server side that would let
// the website and phones share them.

export const MAX_ITEMS = 100
export const MAX_TEXT = 500

const SAFE = /[^A-Za-z0-9_-]/g
const fileFor = (account: string) => dataPath(`memory-${account.replace(SAFE, "_").slice(0, 80) || "me"}.json`)

export class MemoryStore {
  constructor(private readonly account: () => string | undefined) {}

  private file() {
    const a = this.account()
    if (!a) throw new Error("Sign in to Axe AI first.")
    return fileFor(a)
  }

  list(): MemoryItem[] {
    const a = this.account()
    if (!a) return []
    const items = readJSON<MemoryItem[]>(fileFor(a), [])
    return Array.isArray(items) ? items.filter((i) => i && typeof i.id === "string" && typeof i.text === "string") : []
  }

  private save(items: MemoryItem[]) {
    writeJSON(this.file(), items)
    return items
  }

  add(text: string, now = new Date()): MemoryItem[] {
    const clean = tidy(text)
    const items = this.list()
    if (items.some((i) => i.text.toLowerCase() === clean.toLowerCase())) return items
    if (items.length >= MAX_ITEMS) throw new Error(`Axe can remember up to ${MAX_ITEMS} things. Remove one first.`)
    const at = now.toISOString()
    return this.save([...items, { id: randomUUID(), text: clean, createdAt: at, updatedAt: at }])
  }

  update(id: string, text: string, now = new Date()): MemoryItem[] {
    const clean = tidy(text)
    const items = this.list()
    if (!items.some((i) => i.id === id)) throw new Error("That memory isn't here anymore.")
    return this.save(items.map((i) => (i.id === id ? { ...i, text: clean, updatedAt: now.toISOString() } : i)))
  }

  remove(id: string): MemoryItem[] {
    return this.save(this.list().filter((i) => i.id !== id))
  }
}

function tidy(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) throw new Error("Write something to remember.")
  if (clean.length > MAX_TEXT) throw new Error(`Keep it under ${MAX_TEXT} characters.`)
  return clean
}

/** The block sent ahead of a new chat's first message, or "" when there's nothing to remember. */
export function memoryText(items: MemoryItem[]): string {
  if (!items.length) return ""
  return ["Things the user asked you to remember about them. Use them when they help; don't repeat them back.", ...items.map((i) => `- ${i.text}`)].join(
    "\n",
  )
}
