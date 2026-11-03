import { AnimatePresence, motion } from "motion/react"

import type { Attachment } from "@shared/types"

import { invoke, pathOf } from "@/lib/bridge"
import { useMotion } from "@/lib/motion"

import { PageIcon } from "./BoardIcons"
import { XIcon } from "./Icons"

const KIND: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
  "application/json": "JSON",
  "text/html": "HTML",
}

/** "PDF, 2.4 MB" */
export function fileNote(a: Attachment): string {
  const ext = a.name.includes(".") ? a.name.split(".").pop()!.toUpperCase() : "File"
  const kind = KIND[a.mime] ?? (a.mime.startsWith("image/") ? "Image" : ext)
  if (!a.size) return kind
  const size = a.size < 1024 * 1024 ? `${Math.max(1, Math.round(a.size / 1024))} KB` : `${(a.size / 1024 / 1024).toFixed(1)} MB`
  return `${kind}, ${size}`
}

/** One file: an image thumbnail, or a card with its name and kind. */
export function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  const remove = onRemove && (
    <button
      aria-label={`Remove ${a.name}`}
      onClick={onRemove}
      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border-0 bg-fill-4 text-ink-2 opacity-0 transition-opacity duration-150 group-hover/chip:opacity-100 hover:text-ink focus-visible:opacity-100"
    >
      <XIcon size={10} />
    </button>
  )
  if (a.preview)
    return (
      <div className="group/chip relative shrink-0" title={a.name}>
        <img src={a.preview} alt={a.name} draggable={false} className="size-[52px] rounded-[16px] border-0 object-cover" />
        {remove}
      </div>
    )
  return (
    <div className="group/chip relative flex h-[52px] max-w-[240px] shrink-0 items-center gap-[10px] rounded-[16px] border-0 bg-card pr-[16px] pl-[8px]" title={a.name}>
      <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] bg-fill-4 text-ink-2">
        <PageIcon size={17} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[14px] leading-[18px] text-ink">{a.name}</span>
        <span className="truncate text-[12px] leading-[18px] text-ink-3">{fileNote(a)}</span>
      </span>
      {remove}
    </div>
  )
}

/** The files waiting in the composer. */
export function AttachmentTray({ files, onRemove }: { files: Attachment[]; onRemove: (i: number) => void }) {
  const m = useMotion()
  return (
    <AnimatePresence initial={false}>
      {files.length > 0 && (
        <motion.div
          key="tray"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={m.t()}
          className="overflow-visible"
        >
          <div className="flex flex-wrap gap-2 pb-2">
            <AnimatePresence initial={false}>
              {files.map((a, i) => (
                <motion.div
                  key={a.path || a.name + i}
                  layout={!m.reduced}
                  initial={{ opacity: 0, scale: m.reduced ? 1 : 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: m.reduced ? 1 : 0.9 }}
                  transition={m.t()}
                >
                  <AttachmentChip a={a} onRemove={() => onRemove(i)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Files from a drop or a paste: by path when the file has one, else its bytes. */
export async function attachFiles(list: FileList | File[]): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const f of Array.from(list)) {
    const path = pathOf(f)
    if (path) out.push(...(await invoke("app:attachPaths", [path])))
    else out.push(await invoke("app:attachBytes", f.name || "Pasted image.png", f.type, new Uint8Array(await f.arrayBuffer())))
  }
  return out
}
