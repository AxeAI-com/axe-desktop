import { createHash } from "node:crypto"
import { existsSync, rmSync } from "node:fs"
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, join, relative, resolve } from "node:path"

import type { AgentImageMime } from "@shared/types"

import { dataPath } from "../paths"
import { toolPaths } from "./modes"

// Pictures an agent makes or opens, shown in its reply (spec 0035). Axe keeps its own copy of each one in
// its data folder, so the chat shows what the agent made even after the file changes, and the window and
// a paired phone fetch that copy by part id, never by a path. Axe reads a picture only where it can do so
// without a macOS permission prompt (never Desktop, Documents, Downloads or ~/Library unless the chat
// works in there), and never writes anywhere but its own folder.

/** Bigger pictures aren't shown. */
export const IMAGE_MAX = 10 * 1024 * 1024
/** Pictures in one reply. */
export const IMAGES_PER_REPLY = 12

const BY_EXT: Record<string, AgentImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
}
const EXT: Record<AgentImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
}

/** The picture type a file name says, or undefined. */
export function imageMimeOf(path: string): AgentImageMime | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return ext ? BY_EXT[ext] : undefined
}

/** A type an agent's image block names, if it is one Axe shows. */
export function normalMime(mime: string | null | undefined): AgentImageMime | undefined {
  const m = (mime ?? "").toLowerCase().split(";")[0]?.trim()
  if (m === "image/jpg") return "image/jpeg"
  return m && m in EXT ? (m as AgentImageMime) : undefined
}

/** Do the bytes really start like that kind of picture? (A ".png" full of text is not one.) */
export function looksLike(bytes: Uint8Array, mime: AgentImageMime): boolean {
  const b = bytes
  const ascii = (at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0))
  switch (mime) {
    case "image/png":
      return b.length > 8 && b[0] === 0x89 && ascii(1, "PNG\r\n\x1a\n")
    case "image/jpeg":
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    case "image/gif":
      return ascii(0, "GIF87a") || ascii(0, "GIF89a")
    case "image/webp":
      return b.length > 12 && ascii(0, "RIFF") && ascii(8, "WEBP")
    case "image/svg+xml": {
      if (b.includes(0)) return false
      const text = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("utf8")
      return /<svg[\s>]/i.test(text)
    }
  }
}

const inside = (child: string, parent: string) => {
  const r = relative(parent, child)
  return r === "" || (!!r && !r.startsWith("..") && !isAbsolute(r))
}

/** Folders macOS asks about: Axe stays out of them unless the chat works in there. */
function protectedFolders(home: string): string[] {
  return ["Desktop", "Documents", "Downloads", "Library"].map((f) => join(home, f))
}

/** May Axe read a picture here without a permission prompt? `path` is the real path (links followed). */
export function mayRead(path: string, cwd: string, home = homedir()): boolean {
  if (inside(path, cwd)) return true
  return !protectedFolders(home).some((f) => inside(path, f))
}

/** A path as the agent wrote it, made absolute against the chat's folder ("~/" too). */
function absolute(p: string, cwd: string, home: string): string {
  if (p.startsWith("~/")) return join(home, p.slice(2))
  return isAbsolute(p) ? p : resolve(cwd, p)
}

const QUOTED_OR_WORD = /"([^"\n]+)"|'([^'\n]+)'|([^\s"'`;|&<>()]+)/g

/** Words in a command that name a picture, at most a few. */
export function commandImages(command: string): string[] {
  const out: string[] = []
  for (const m of command.matchAll(QUOTED_OR_WORD)) {
    const w = (m[1] ?? m[2] ?? m[3] ?? "").replace(/^-[-\w]*=/, "")
    if (imageMimeOf(w) && !/^[a-z]+:\/\//i.test(w) && !out.includes(w)) out.push(w)
    if (out.length >= 6) break
  }
  return out
}

type Call = { kind?: string | null; locations?: { path: string }[] | null; content?: { type: string; path?: string }[] | null; rawInput?: unknown }

/**
 * The pictures a finished tool call wrote or read, as absolute paths. A command counts only for the
 * pictures it names that changed during this turn (`since`, ms), so `ls *.png` shows nothing.
 */
export async function pathsOf(call: Call, cwd: string, since: number, home = homedir()): Promise<{ path: string; fromCommand: boolean }[]> {
  const out = new Map<string, boolean>()
  for (const p of toolPaths(call)) if (imageMimeOf(p)) out.set(absolute(p, cwd, home), false)
  if (call.kind === "execute") {
    const raw = call.rawInput as { command?: unknown; cmd?: unknown } | null | undefined
    const cmd = raw && typeof raw === "object" ? (raw.command ?? raw.cmd) : undefined
    const text = typeof cmd === "string" ? cmd : Array.isArray(cmd) ? cmd.filter((x) => typeof x === "string").join(" ") : ""
    for (const w of commandImages(text)) {
      const path = absolute(w, cwd, home)
      if (!out.has(path)) out.set(path, true)
    }
  }
  const found: { path: string; fromCommand: boolean }[] = []
  for (const [path, fromCommand] of out) {
    if (!fromCommand) {
      found.push({ path, fromCommand })
      continue
    }
    // Only stat it where reading is allowed, so a command naming ~/Downloads never prompts.
    if (!mayRead(path, cwd, home)) continue
    const s = await stat(path).catch(() => undefined)
    if (s?.isFile() && s.mtimeMs >= since - 1000) found.push({ path, fromCommand })
  }
  return found
}

export type Picture = { name: string; mime: AgentImageMime; bytes: Buffer }

/** Reads a picture the agent made, if Axe may and it really is one under the size limit. */
export async function readPicture(path: string, cwd: string, home = homedir()): Promise<Picture | undefined> {
  const mime = imageMimeOf(path)
  if (!mime || !mayRead(path, cwd, home)) return undefined
  // Links are followed first, so one pointing into a protected folder is never opened.
  const real = await realpath(path).catch(() => undefined)
  const realCwd = await realpath(cwd).catch(() => cwd)
  if (!real || !mayRead(real, realCwd, home)) return undefined
  const s = await stat(real).catch(() => undefined)
  if (!s?.isFile() || s.size === 0 || s.size > IMAGE_MAX) return undefined
  const bytes = await readFile(real).catch(() => undefined)
  if (!bytes || bytes.length > IMAGE_MAX || !looksLike(bytes, mime)) return undefined
  return { name: basename(path).slice(0, 120), mime, bytes }
}

/** An image block an agent sent (base64), if it is a picture Axe shows. */
export function blockPicture(block: { data?: string; mimeType?: string; uri?: string | null }, fallbackName = "Picture"): Picture | undefined {
  const mime = normalMime(block.mimeType)
  if (!mime || !block.data || block.data.length > Math.ceil(IMAGE_MAX / 3) * 4 + 4) return undefined
  const bytes = Buffer.from(block.data, "base64")
  if (!bytes.length || bytes.length > IMAGE_MAX || !looksLike(bytes, mime)) return undefined
  const fromUri = block.uri ? basename(block.uri.replace(/^file:\/\//, "")) : ""
  const name = (fromUri && imageMimeOf(fromUri) ? fromUri : `${fallbackName}.${EXT[mime]}`).slice(0, 120)
  return { name, mime, bytes }
}

// The store: <data>/agent-images/<hash of the chat id>/<part id>.<ext>

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

function folderOf(threadId: string): string {
  return dataPath("agent-images", createHash("sha256").update(threadId).digest("hex").slice(0, 32))
}

function fileOf(threadId: string, partId: string, mime: AgentImageMime): string {
  if (!SAFE_ID.test(partId)) throw new Error("That isn't a picture in this chat.")
  return join(folderOf(threadId), `${partId}.${EXT[mime]}`)
}

export async function savePicture(threadId: string, partId: string, picture: Picture): Promise<void> {
  const file = fileOf(threadId, partId, picture.mime)
  await mkdir(folderOf(threadId), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, picture.bytes)
  await rename(tmp, file)
}

/** Axe's copy of a picture in a chat. The caller checks the part belongs to that chat first. */
export async function readCopy(threadId: string, partId: string, mime: AgentImageMime): Promise<Buffer> {
  const bytes = await readFile(fileOf(threadId, partId, mime)).catch(() => undefined)
  if (!bytes) throw new Error("That picture isn't on this computer anymore.")
  return bytes
}

/** The chat was deleted: its pictures go too. */
export function deletePictures(threadId: string) {
  const dir = folderOf(threadId)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
