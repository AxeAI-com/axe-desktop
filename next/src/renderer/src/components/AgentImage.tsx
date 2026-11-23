import { useEffect, useState } from "react"

import type { Part } from "@shared/types"

import { invoke } from "@/lib/bridge"

// A picture an agent made, in its reply (spec 0035). The engine hands over its own copy by part id.
// Shown only through <img>, so an SVG's scripts never run.

type ImagePart = Extract<Part, { type: "image" }>

/** Data URLs by chat, part and rev, so scrolling back doesn't ask again. */
const cache = new Map<string, string>()

export function AgentImage({ threadId, part }: { threadId: string; part: ImagePart }) {
  const key = `${threadId}:${part.id}:${part.rev ?? 0}`
  const [src, setSrc] = useState(() => cache.get(key))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const known = cache.get(key)
    if (known) return setSrc(known)
    let live = true
    setFailed(false)
    invoke("chat:image", threadId, part.id).then(
      (url) => {
        if (cache.size > 60) cache.delete(cache.keys().next().value!)
        cache.set(key, url)
        if (live) setSrc(url)
      },
      () => live && setFailed(true),
    )
    return () => void (live = false)
  }, [key, threadId, part.id])

  if (failed) return <p className="m-0 text-[13px] text-ink-3">Couldn't show {part.name}.</p>
  if (!src) return <div aria-label={part.name} className="h-[160px] w-full max-w-[420px] animate-pulse rounded-media bg-fill-2" />
  return (
    <img
      src={src}
      alt={part.name}
      title={part.name}
      draggable={false}
      className="block h-auto max-h-[420px] max-w-full self-start rounded-media object-contain"
    />
  )
}
