import { useRef, useState } from "react"

import type { Answerer } from "@shared/types"

import { answererLabel } from "@/lib/answerer"
import { useStore } from "@/lib/store"

import { AxeTile, agentLogo, LogoTile, localModelLogo, modelLogo } from "../BrandLogo"
import { ChevronDown } from "../Icons"
import { ModelPicker } from "../ModelPicker"

// A watch's model as a filled chip that opens the chat's own picker: the plan's "Runs on", Edit's
// "Model", and the line that says a watch's model can't run. No prices or plans in it.

export function AnswererLogo({ a, size = 14 }: { a: Answerer; size?: number }) {
  const catalog = useStore((s) => s.catalog)
  const label = answererLabel(a, catalog)
  if (a.kind === "agent") {
    const agent = catalog?.agents.find((x) => x.id === a.agentId)
    return <LogoTile logo={agent ? agentLogo(agent) : undefined} name={label} size={size} />
  }
  if (a.kind === "local") {
    const m = catalog?.local.find((x) => x.id === a.modelId)
    return <LogoTile logo={m ? localModelLogo(m) : undefined} name={label} size={size} />
  }
  if (a.modelId === "auto") return <AxeTile size={size} />
  const m = catalog?.axe.models.find((x) => x.id === a.modelId)
  return <LogoTile logo={m ? modelLogo(m) : undefined} name={label} size={size} />
}

export function ModelChip({ value, onPick, label = "Model", up }: { value: Answerer; onPick: (a: Answerer) => void; label?: string; up?: boolean }) {
  const catalog = useStore((s) => s.catalog)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <span className="relative inline-flex">
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[28px] cursor-pointer items-center gap-[6px] rounded-[6px] border-0 bg-button px-[8px] text-[13px] whitespace-nowrap text-ink transition-colors duration-150 hover:bg-fill-3"
      >
        <AnswererLogo a={value} />
        {answererLabel(value, catalog)}
        <ChevronDown size={12} className="text-ink-3" />
      </button>
      <ModelPicker
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        current={value}
        onPick={(a) => {
          onPick(a)
          setOpen(false)
        }}
        origin={up ? "bottom left" : "top left"}
        className={up ? "bottom-[calc(100%+4px)] left-0" : "top-[calc(100%+4px)] left-0"}
        maxHeight={360}
      />
    </span>
  )
}
