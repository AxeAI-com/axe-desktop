import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { ChatMessage } from "@shared/types"

import {
  blockPicture,
  commandImages,
  deletePictures,
  IMAGE_MAX,
  looksLike,
  mayRead,
  pathsOf,
  readCopy,
  readPicture,
  savePicture,
} from "../../src/main/agents/images"
import { ReplyBuilder } from "../../src/main/agents/updates"

// Pictures an agent makes, shown in its reply (spec 0035; src/main/agents/images.ts).

const root = realpathSync(mkdtempSync(join(tmpdir(), "axe-images-")))
const home = join(root, "home")
const cwd = join(root, "work", "site")
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const saved = process.env.AXE_DATA_DIR

beforeAll(() => {
  process.env.AXE_DATA_DIR = join(root, "data")
  for (const d of [cwd, join(home, "Downloads"), join(home, "Documents", "proj")]) mkdirSync(d, { recursive: true })
})
afterAll(() => {
  process.env.AXE_DATA_DIR = saved
})

describe("what counts as a picture", () => {
  it("checks the bytes, not just the name", () => {
    expect(looksLike(PNG, "image/png")).toBe(true)
    expect(looksLike(Buffer.from("hello"), "image/png")).toBe(false)
    expect(looksLike(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(true)
    expect(looksLike(Buffer.from("GIF89a...."), "image/gif")).toBe(true)
    expect(looksLike(Buffer.from("RIFF0000WEBPVP8 "), "image/webp")).toBe(true)
    expect(looksLike(Buffer.from('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>'), "image/svg+xml")).toBe(true)
    expect(looksLike(Buffer.from("<svgx>"), "image/svg+xml")).toBe(false)
  })

  it("finds pictures a command names", () => {
    expect(commandImages(`rsvg-convert glass.svg -o "out dir/glass.png" && open --file=./b.webp https://x.com/a.png`)).toEqual([
      "glass.svg",
      "out dir/glass.png",
      "./b.webp",
    ])
  })

  it("takes pictures from a tool's paths, and from a command only when they changed this turn", async () => {
    writeFileSync(join(cwd, "new.png"), PNG)
    writeFileSync(join(cwd, "old.png"), PNG)
    const since = Date.now()
    utimesSync(join(cwd, "old.png"), new Date(since - 60_000), new Date(since - 60_000))
    const write = await pathsOf({ kind: "edit", locations: [{ path: join(cwd, "a.svg") }], rawInput: { file_path: join(cwd, "a.svg") } }, cwd, since, home)
    expect(write).toEqual([{ path: join(cwd, "a.svg"), fromCommand: false }])
    const run = await pathsOf({ kind: "execute", rawInput: { command: "convert x new.png old.png missing.png ~/Downloads/d.png" } }, cwd, since, home)
    expect(run.map((r) => r.path)).toEqual([join(cwd, "new.png")])
  })
})

describe("where Axe may read", () => {
  it("stays out of protected folders unless the chat works in there", () => {
    expect(mayRead(join(cwd, "a.png"), cwd, home)).toBe(true)
    expect(mayRead("/private/tmp/claude-501/x/glass.svg", cwd, home)).toBe(true)
    expect(mayRead(join(home, "Downloads", "a.png"), cwd, home)).toBe(false)
    expect(mayRead(join(home, "Library", "a.png"), cwd, home)).toBe(false)
    expect(mayRead(join(home, "Documents", "proj", "a.png"), join(home, "Documents", "proj"), home)).toBe(true)
  })

  it("never opens a file in Downloads, even through a link from the chat's folder", async () => {
    writeFileSync(join(home, "Downloads", "d.png"), PNG)
    symlinkSync(join(home, "Downloads", "d.png"), join(cwd, "link.png"))
    expect(await readPicture(join(home, "Downloads", "d.png"), cwd, home)).toBeUndefined()
    expect(await readPicture(join(cwd, "link.png"), cwd, home)).toBeUndefined()
  })

  it("reads a real picture under the size limit, and nothing else", async () => {
    writeFileSync(join(cwd, "ok.png"), PNG)
    writeFileSync(join(cwd, "text.png"), "not a picture")
    writeFileSync(join(cwd, "big.png"), Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX)]))
    expect(await readPicture(join(cwd, "ok.png"), cwd, home)).toMatchObject({ name: "ok.png", mime: "image/png" })
    expect(await readPicture(join(cwd, "text.png"), cwd, home)).toBeUndefined()
    expect(await readPicture(join(cwd, "big.png"), cwd, home)).toBeUndefined()
  })

  it("takes image blocks of the types it shows", () => {
    expect(blockPicture({ data: PNG.toString("base64"), mimeType: "image/png" })).toMatchObject({ name: "Picture.png", mime: "image/png" })
    expect(blockPicture({ data: PNG.toString("base64"), mimeType: "image/tiff" })).toBeUndefined()
    expect(blockPicture({ data: Buffer.from("hi").toString("base64"), mimeType: "image/png" })).toBeUndefined()
  })
})

describe("Axe's copy", () => {
  it("saves and reads by chat and part id, and goes with the chat", async () => {
    await savePicture("t1", "img1", { name: "a.png", mime: "image/png", bytes: PNG })
    expect((await readCopy("t1", "img1", "image/png")).equals(PNG)).toBe(true)
    await expect(readCopy("t2", "img1", "image/png")).rejects.toThrow()
    await expect(readCopy("t1", "../img1", "image/png")).rejects.toThrow("isn't a picture")
    deletePictures("t1")
    await expect(readCopy("t1", "img1", "image/png")).rejects.toThrow()
  })
})

describe("pictures in the reply", () => {
  it("places a picture after its tool, once per file, at most the cap", () => {
    const message: ChatMessage = { id: "m", role: "assistant", parts: [] }
    const b = new ReplyBuilder(message)
    b.apply({ sessionUpdate: "tool_call", toolCallId: "w1", title: "Write a.svg", kind: "edit", status: "completed" })
    b.apply({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Here it is." } })
    const id = b.pictureSlot("path:/a.svg", 2)!
    b.image({ id, name: "a.svg", mime: "image/svg+xml", size: 10 }, "w1")
    expect(message.parts.map((p) => p.type)).toEqual(["tool", "image", "text"])
    // Written again: the same picture, a new rev.
    expect(b.pictureSlot("path:/a.svg", 2)).toBe(id)
    b.image({ id, name: "a.svg", mime: "image/svg+xml", size: 20 }, "w1")
    expect(message.parts.filter((p) => p.type === "image")).toEqual([{ type: "image", id, name: "a.svg", mime: "image/svg+xml", size: 20, rev: 1 }])
    expect(b.pictureSlot("path:/b.png", 2)).toBeDefined()
    expect(b.pictureSlot("path:/c.png", 2)).toBeUndefined()
  })
})
