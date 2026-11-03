import { readFile } from "node:fs/promises"
import { inflateSync } from "node:zlib"

import type { Attachment, Json } from "@shared/types"

// Files sent to a model on a local server. Axe models get uploads; a local model only gets words and
// pictures in its message, so text files (and the text in PDFs) go inline, photos go as images for
// models that can see, and anything else becomes a short note naming the file.

const PER_FILE = 20_000
const ALL_FILES = 60_000
const MAX_IMAGE = 10 * 1024 * 1024

export type LocalFiles = {
  /** Goes after the message: each readable file in a <file> block, then notes for the rest. */
  text: string
  /** AI SDK image parts ({ type: "image", image: data URL }) for a model that can see. */
  images: Json[]
  /** Files the model couldn't get, with why, for a step in the reply. */
  left: { name: string; why: string }[]
}

const TEXT_MIME = /^text\/|^application\/(json|xml|x-yaml|yaml|javascript|typescript|x-sh|sql)/
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/

/** Plain UTF-8 text, or undefined for bytes that aren't text. */
function asText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/**
 * The words in a simple PDF: its compressed page streams are opened and the text shown by Tj and TJ
 * read out. Good for PDFs made from documents; scans and unusual fonts give nothing, and say so.
 */
export function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1")
  const out: string[] = []
  // Each object's header up to its stream (tempered, so one object never reaches into the next).
  const streams = /\bobj\b((?:(?!\bobj\b)[\s\S])*?)\bstream\r?\n/g
  for (let m = streams.exec(raw); m; m = streams.exec(raw)) {
    const start = m.index + m[0].length
    const end = raw.indexOf("endstream", start)
    if (end < 0) break
    streams.lastIndex = end
    let body = Buffer.from(raw.slice(start, end), "latin1")
    if (/\/FlateDecode/.test(m[1] ?? "")) {
      try {
        body = inflateSync(body)
      } catch {
        continue
      }
    } else if (/\/Filter/.test(m[1] ?? "")) continue
    const content = body.toString("latin1")
    if (!/\bBT\b/.test(content)) continue
    for (const block of content.match(/\bBT\b[\s\S]*?\bET\b/g) ?? []) {
      const line: string[] = []
      const ops = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|\[(?:[^\]\\]|\\.)*\]\s*TJ|T\*|Td|TD/g
      for (const op of block.match(ops) ?? []) {
        if (/^(T\*|Td|TD)$/.test(op)) {
          if (line.length && line[line.length - 1] !== "\n") line.push("\n")
          continue
        }
        for (const s of op.match(/\((?:\\.|[^\\)])*\)/g) ?? []) line.push(unescapePdf(s.slice(1, -1)))
      }
      out.push(line.join(""))
    }
  }
  const text = out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  // Fonts with their own encodings come out as symbols, not words.
  const letters = (text.match(/[\p{L}\p{N}]/gu) ?? []).length
  return text.length && letters / text.length > 0.5 ? text : ""
}

function unescapePdf(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => {
    if (/^[0-7]/.test(c)) return String.fromCharCode(Number.parseInt(c, 8))
    return ({ n: "\n", r: "", t: "\t", b: "", f: "" } as Record<string, string>)[c] ?? c
  })
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[… cut here, ${s.length - n} more characters]` : s)

/** What a local model gets from the files on a message. `vision`: undefined means the server didn't say. */
export async function localFiles(attachments: Attachment[], vision: boolean | undefined): Promise<LocalFiles> {
  const blocks: string[] = []
  const images: Json[] = []
  const left: LocalFiles["left"] = []
  let room = ALL_FILES
  for (const a of attachments) {
    let bytes: Buffer
    try {
      bytes = await readFile(a.path)
    } catch {
      left.push({ name: a.name, why: "It isn't there anymore." })
      continue
    }
    if (a.mime.startsWith("image/")) {
      if (vision === false) left.push({ name: a.name, why: "This model can't see photos, so it only got the file's name." })
      else if (!IMAGE_MIME.test(a.mime)) left.push({ name: a.name, why: "Local models read PNG, JPEG, GIF and WebP photos. Save it as one of those." })
      else if (bytes.byteLength > MAX_IMAGE) left.push({ name: a.name, why: "It's over 10 MB. Try a smaller photo." })
      else {
        images.push({ type: "image", image: `data:${a.mime};base64,${bytes.toString("base64")}`, mediaType: a.mime })
        continue
      }
      blocks.push(`(Attached: ${a.name}, a photo you can't see.)`)
      continue
    }
    const text = a.mime === "application/pdf" ? pdfText(bytes) : TEXT_MIME.test(a.mime) || a.mime === "application/octet-stream" ? asText(bytes) : undefined
    if (!text?.trim()) {
      left.push({ name: a.name, why: a.mime === "application/pdf" ? "There's no text Axe can read in this PDF (a scan, perhaps)." : "Local models get text and photos; this kind of file can't go to them." })
      blocks.push(`(Attached: ${a.name}, which you can't read.)`)
      continue
    }
    if (room <= 0) {
      left.push({ name: a.name, why: "The other files filled the room this model has." })
      continue
    }
    const body = clip(text, Math.min(PER_FILE, room))
    room -= body.length
    blocks.push(`<file name="${a.name.replace(/"/g, "'")}">\n${body}\n</file>`)
  }
  return { text: blocks.join("\n\n"), images, left }
}
