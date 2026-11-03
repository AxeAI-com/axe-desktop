import { Fragment, useCallback, useEffect, useRef, useState } from "react"

import type { AgentChoice, AgentOption } from "@shared/types"

import { agentOptionsOf, loadAgentOptions, setAgentOption, useStore } from "@/lib/store"

import { BrainIcon, ChevronDown } from "./Icons"
import { MenuLabel, MenuLine, MenuRow, Popover } from "./Popover"

/** "Default (recommended)" reads "Default" on the chip; the menu keeps the agent's own words. */
export const shortName = (c: AgentChoice | undefined) => (c ? c.name.replace(/\s*\([^)]*\)\s*$/, "") || c.name : "")

/** The chip's words: the model, then the effort when it isn't the agent's default. */
export function optionsLabel(options: AgentOption[]): { model: string; effort: string } {
  const pick = (kind: AgentOption["kind"]) => {
    const o = options.find((x) => x.kind === kind)
    return o?.choices.find((c) => c.value === o.current)
  }
  const effort = pick("effort")
  return { model: shortName(pick("model")), effort: effort && effort.value !== "default" ? shortName(effort) : "" }
}

/**
 * A CLI agent's model and effort, next to the mode menu: the agent's own lists and names (ACP
 * config options), shown once it has sent them (this chat, or its last session for a new chat).
 */
export function AgentOptionsMenu({ threadId, agentId }: { threadId?: string; agentId: string }) {
  const options = useStore((s) => agentOptionsOf(threadId, agentId, s))
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    void loadAgentOptions(threadId, agentId)
  }, [threadId, agentId])

  if (!options.length) return null
  const { model, effort } = optionsLabel(options)
  const label = [model, effort && `${effort} effort`].filter(Boolean).join(", ")

  return (
    <div className="relative min-w-0 shrink">
      <Popover
        open={open}
        onClose={close}
        anchor={anchor}
        origin="bottom left"
        className="bottom-[calc(100%+8px)] left-0 max-h-[min(520px,calc(100vh-160px))] overflow-y-auto"
        label="Model and effort"
      >
        {options.map((o, i) => (
          <Fragment key={o.id}>
            {i > 0 && <MenuLine />}
            <MenuLabel>{o.name}</MenuLabel>
            {o.choices.map((c, j) => (
              <Fragment key={c.value}>
                {c.group && c.group !== o.choices[j - 1]?.group && <MenuLabel>{c.group}</MenuLabel>}
                <MenuRow
                  role="menuitemradio"
                  checked={c.value === o.current}
                  title={c.description}
                  onSelect={() => {
                    // Effort levels follow the model, so the menu stays open for the second pick.
                    if (o.kind === "effort") close()
                    void setAgentOption(threadId, agentId, o.id, c.value)
                  }}
                >
                  {c.name}
                </MenuRow>
              </Fragment>
            ))}
          </Fragment>
        ))}
      </Popover>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model and effort: ${label}`}
        title="Model and effort"
        onClick={() => setOpen((x) => !x)}
        className={`flex h-7 min-w-0 items-center gap-1.5 rounded-full border-0 px-2.5 text-[13px] transition-[background-color,color] duration-150 ${open ? "bg-fill-2 text-ink" : "bg-transparent text-ink-3 hover:bg-fill hover:text-ink-2"}`}
      >
        <BrainIcon size={14} className="shrink-0" />
        <span className="truncate">{model}</span>
        {effort && <span className="shrink-0 text-ink-4">{effort}</span>}
        <ChevronDown size={12} className="shrink-0 text-ink-4" />
      </button>
    </div>
  )
}
