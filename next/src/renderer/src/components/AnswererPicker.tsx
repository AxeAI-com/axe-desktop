import { useCallback, useMemo, useRef, useState } from "react"

import type { Answerer, ThreadSummary } from "@shared/types"

import { answererLabel } from "@/lib/answerer"
import { agentOptionsOf, defaultAnswerer, nextAnswerer, pickAnswerer, useStore } from "@/lib/store"

import { AxeTile, agentLogo, LogoTile, localModelLogo, modelLogo } from "./BrandLogo"
import { ModelPicker } from "./ModelPicker"
import { underControl } from "./Kit"
import { AgentOptionRows, optionsLabel } from "./AgentOptionsMenu"
import { ChevronDown as LineChevron } from "./Icons"

const NONE: never[] = []

/**
 * Who answers next: a page's own pick (`own`), the chat's next answerer, or the new chat's (the draft's,
 * else the default kept in settings).
 */
export function useAnswerer(threadId?: string, own?: Answerer): Answerer {
  // Selected as a string: the helpers build fresh objects, and the store wants stable snapshots.
  const key = useStore((s) => JSON.stringify(own ?? (threadId ? nextAnswerer(threadId, s) : (s.draft.answerer ?? defaultAnswerer(s)))))
  return useMemo(() => JSON.parse(key) as Answerer, [key])
}

/** What a chat may switch to: local chats stay with local models, other chats never switch to one. A new chat takes anything. */
export function pickerSections(thread?: ThreadSummary): ("axe" | "agent" | "local")[] | undefined {
  return thread?.source === "local" ? ["local"] : thread ? ["axe", "agent"] : undefined
}

/** The answerer's logo: the CLI's, the local model's, the Axe model's, or the Axe tile for Auto. */
export function AnswererLogo({ answerer, size = 16, square }: { answerer: Answerer; size?: number; square?: boolean }) {
  const catalog = useStore((s) => s.catalog)
  const label = answererLabel(answerer, catalog)
  if (answerer.kind === "agent") {
    const agent = catalog?.agents.find((x) => x.id === answerer.agentId)
    return <LogoTile logo={agent ? agentLogo(agent) : undefined} name={label} size={size} square={square} />
  }
  if (answerer.kind === "local") {
    const local = catalog?.local.find((x) => x.id === answerer.modelId)
    return <LogoTile logo={local ? localModelLogo(local) : undefined} name={label} size={size} square={square} />
  }
  if (answerer.modelId === "auto") return <AxeTile size={size} square={square} />
  const model = catalog?.axe.models.find((x) => x.id === answerer.modelId)
  return <LogoTile logo={model ? modelLogo(model) : undefined} name={label} size={size} square={square} />
}

/**
 * The "who answers" button and its list, in the quiet row under the composer (2026-11-08: one picker, no
 * longer in the title bar). It opens above. Without `onAnswerer`, a pick goes to the chat, or,
 * on New chat, becomes the default for new chats (`settings.answerer`).
 */
export function AnswererPicker({
  threadId,
  answerer: own,
  onAnswerer,
  place,
  className = "",
}: {
  threadId?: string
  answerer?: Answerer
  onAnswerer?: (a: Answerer) => void
  place: "above" | "below"
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // The list never runs past the window's edge.
  const [room, setRoom] = useState(560)
  const btn = useRef<HTMLButtonElement>(null)
  const catalog = useStore((s) => s.catalog)
  const thread = useStore((s) => (threadId ? s.threads.find((t) => t.id === threadId) : undefined))
  const answerer = useAnswerer(threadId, own)
  const agentId = answerer.kind === "agent" ? answerer.agentId : ""
  // An agent's model and effort share this control (Draft 3): "Opus 5.5 Medium"; else who answers.
  const options = useStore((s) => (agentId ? agentOptionsOf(threadId, agentId, s) : NONE))
  const picked_ = optionsLabel(options)
  // An agent left on its default model reads as the agent ("Claude Code"), not "Default".
  const label = picked_.model && picked_.model !== "Default" ? picked_.model : answererLabel(answerer, catalog)
  const detail = picked_.effort
  const close = useCallback(() => setOpen(false), [])

  const picked = (a: Answerer) => {
    if (onAnswerer) {
      onAnswerer(a)
      return setOpen(false)
    }
    void pickAnswerer(a, threadId).then((ok) => {
      if (ok) setOpen(false)
    })
  }

  return (
    <div className={`relative flex min-w-0 ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose who answers"
        onClick={() => {
          if (!open) {
            const r = btn.current?.getBoundingClientRect()
            setRoom(Math.min(560, place === "above" ? (r?.top ?? 600) - 32 : window.innerHeight - (r?.bottom ?? 0) - 24))
          }
          setOpen((o) => !o)
        }}
        // Plain text under the composer: the small logo, the name and a chevron; ink on hover.
        className={underControl(open)}
      >
        <AnswererLogo answerer={answerer} size={14} square />
        <span className="truncate">{label}</span>
        {detail && <span className="shrink-0 text-[var(--cx-ink4)]">{detail}</span>}
        <LineChevron size={12} className="shrink-0 opacity-70" />
      </button>
      <ModelPicker
        sections={pickerSections(thread)}
        open={open}
        onClose={close}
        anchor={btn}
        current={answerer}
        onPick={picked}
        origin={place === "above" ? "bottom right" : "top left"}
        className={place === "above" ? "right-0 bottom-[calc(100%+8px)]" : "top-[calc(100%+6px)] left-0"}
        maxHeight={room}
      >
        {agentId && <AgentOptionRows threadId={threadId} agentId={agentId} onDone={close} />}
      </ModelPicker>
    </div>
  )
}
