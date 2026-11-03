import { randomUUID } from "node:crypto"
import { mkdirSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"

import { nativeImage } from "electron"

import type { Attachment } from "@shared/types"

import { dataPath } from "./paths"

// Files you add to a message: picked, dropped or pasted. Picked and dropped files are sent from where
// they are; pasted ones (screenshots) are saved under the data folder first. Images get a small
// thumbnail for the composer and the sent message.

export const MAX_BYTES = 25 * 1024 * 1024

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export const mimeOf = (name: string) => MIME[extname(name).toLowerCase()] ?? "application/octet-stream"

const tooBig = (name: string) => new Error(`${name} is over 25 MB. Try a smaller file.`)

function thumbnail(path: string, mime: string): string | undefined {
  if (!mime.startsWith("image/")) return undefined
  const img = nativeImage.createFromPath(path)
  if (img.isEmpty()) return undefined
  const { width, height } = img.getSize()
  const scale = 160 / Math.max(width, height, 1)
  return (scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: "good" }) : img).toDataURL()
}

/** A file on disk, as an attachment. */
export function fromPath(path: string): Attachment {
  const name = basename(path)
  const st = statSync(path)
  if (!st.isFile()) throw new Error(`${name} isn't a file.`)
  if (st.size > MAX_BYTES) throw tooBig(name)
  const mime = mimeOf(name)
  const preview = thumbnail(path, mime)
  return { path, name, mime, size: st.size, ...(preview ? { preview } : {}) }
}

/** Bytes from the clipboard or a drop with no path: saved, then attached. */
export function fromBytes(name: string, mime: string, bytes: Uint8Array): Attachment {
  if (bytes.byteLength > MAX_BYTES) throw tooBig(name)
  const dir = dataPath("attachments")
  mkdirSync(dir, { recursive: true })
  const safe = basename(name).replace(/[^\w.\- ]+/g, "_") || "file"
  const path = join(dir, `${randomUUID().slice(0, 8)}-${safe}`)
  writeFileSync(path, bytes)
  // Saved under a unique name; shown and sent under its own.
  const a = { ...fromPath(path), name: safe }
  return a.mime === "application/octet-stream" && mime ? { ...a, mime } : a
}

/** What goes to the server or the agent: no thumbnail. */
export const withoutPreview = (a: Attachment): Attachment => {
  const { preview, ...rest } = a
  void preview
  return rest
}
