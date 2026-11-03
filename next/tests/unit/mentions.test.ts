import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import type { ChatMessage, ThreadSummary } from "@shared/types"

import { chatMarkdown, mentionItems, mentionQuery, replaceMention } from "@/lib/mentions"

import { mentionOrder } from "../../src/renderer/src/components/MentionMenu"
import { folderHits } from "../../src/main/mentions"

// The composer's @ menu: folders, apps and chats.

describe("@ in the composer", () => {
  it("reads the @word at the cursor, only after a space or the start", () => {
    expect(mentionQuery("@", 1)).toEqual({ at: 0, query: "" })
    expect(mentionQuery("look at @axe", 12)).toEqual({ at: 8, query: "axe" })
    expect(mentionQuery("mail@example.com", 16)).toBeNull()
    expect(mentionQuery("@axe web", 8)).toBeNull()
    expect(mentionQuery("fix @~/Code/ax", 14)).toEqual({ at: 4, query: "~/Code/ax" })
    expect(replaceMention("fix @ax now", 4, 7, "@~/Code/axe-web ")).toBe("fix @~/Code/axe-web  now")
  })

  const t = (id: string, title: string): ThreadSummary => ({ id, title, source: "axe", pinned: false, updatedAt: "2026-10-23T00:00:00Z" })
  const lists = {
    folders: [{ path: "/Users/mia/Code/axe-web", display: "~/Code/axe-web" }],
    connectors: [{ id: "c1", name: "Notion" }],
    apps: ["Notion", "Safari", "Slack"],
    threads: [t("t1", "Launch posts"), t("t2", "Two days in Lisbon")],
  }

  it("lists folders, then apps (connected first, no twins), then chats", () => {
    const all = mentionItems("", lists)
    expect(all.map((i) => i.kind)).toEqual(["folder", "connector", "app", "app", "chat", "chat"])
    expect(mentionItems("no", lists).map((i) => i.label)).toEqual(["Notion"])
    expect(mentionItems("lisbon", lists).map((i) => i.value)).toEqual(["t2"])
    // A typed path is about folders only.
    expect(mentionItems("~/Co", lists).every((i) => i.kind === "folder")).toBe(true)
  })

  it("puts watches first on Watching and after folders in a chat, with their kind", () => {
    const items = mentionItems("", { ...lists, watches: [{ id: "w1", name: "lane-ceramics.com", kind: "uptime", label: "Uptime and speed" }] })
    expect(items.find((i) => i.kind === "watch")).toMatchObject({ label: "lane-ceramics.com", detail: "Uptime and speed", value: "w1", watchKind: "uptime" })
    expect(mentionOrder(items, true).map((i) => i.kind).slice(0, 2)).toEqual(["watch", "folder"])
    expect(mentionOrder(items).map((i) => i.kind).slice(0, 2)).toEqual(["folder", "watch"])
  })

  it("turns a chat into Markdown, keeping the newest when it's long", () => {
    const msg = (role: "user" | "assistant", text: string): ChatMessage => ({ id: text, role, parts: [{ type: "text", id: "p", text }] })
    expect(chatMarkdown("Lisbon", [msg("user", "Plan two days"), msg("assistant", "Day one: Alfama")])).toBe("# Lisbon\n\n**You:** Plan two days\n\n**Answer:** Day one: Alfama\n")
    const long = chatMarkdown("Long", [msg("user", "a".repeat(50)), msg("assistant", "b".repeat(50))], 60)
    expect(long).toContain("(Earlier messages left out.)")
    expect(long).toContain("b".repeat(50))
  })

  it("completes a folder path you type, and filters your recent folders otherwise", async () => {
    const home = mkdtempSync(join(tmpdir(), "axe-home-"))
    mkdirSync(join(home, "Code", "axe-web"), { recursive: true })
    mkdirSync(join(home, "Code", "axe-mac"), { recursive: true })
    mkdirSync(join(home, "Code", ".hidden"), { recursive: true })
    const typed = await folderHits("~/Code/axe-w", [], home)
    expect(typed).toEqual([{ path: join(home, "Code", "axe-web"), display: "~/Code/axe-web" }])
    expect((await folderHits("~/Code/", [], home)).map((f) => f.display)).toEqual(["~/Code/axe-mac", "~/Code/axe-web"])
    const recent = await folderHits("mac", [join(home, "Code", "axe-mac"), join(home, "Code", "axe-web")], home)
    expect(recent.map((f) => f.display)).toEqual(["~/Code/axe-mac"])
  })
})
