import { memo, type ReactNode, useMemo } from "react"

import { parseRich, partialVisual, type RichBlock as Block, type RichKind } from "@shared/rich"

import { CodeBlock } from "../Markdown"
import { ChartCard } from "./Chart"
import { ChoicesCard } from "./Choices"
import { DraftCard } from "./Draft"
import { MapCard } from "./MapCard"
import { CardFrame } from "./shared"
import { TableCard } from "./Table"
import { VisualCard } from "./Visual"

/** A parsed card. */
export function RichCard({ block }: { block: Block }) {
  switch (block.kind) {
    case "chart":
      return <ChartCard chart={block} />
    case "choices":
      return <ChoicesCard choices={block} />
    case "map":
      return <MapCard map={block} />
    case "draft":
      return <DraftCard draft={block} />
    case "table":
      return <TableCard table={block} />
    case "visual":
      return <VisualCard title={block.title} html={block.html} height={block.height} done />
  }
}

/**
 * One ```axe-* block from a reply. Streaming: the card's outline (a visual draws as it comes).
 * Finished and valid: the card. Broken, or cut off when the reply ended: the plain code block.
 */
export const RichFence = memo(function RichFence({ type, lang, raw, closed, streaming }: { type: RichKind; lang: string; raw: string; closed: boolean; streaming: boolean }) {
  const parsed = useMemo(() => (closed ? parseRich(type, raw) : undefined), [closed, type, raw])
  let body: ReactNode
  let card = true
  if (!closed && streaming) {
    if (type === "visual") {
      const v = partialVisual(raw)
      body = <VisualCard title={v.title} html={v.html} done={false} />
    } else body = <Building type={type} />
  } else if (parsed?.ok) body = <RichCard block={parsed.block} />
  else {
    card = false
    body = <CodeBlock lang={lang} text={raw} />
  }
  // The code block already spans the column; cards get the same reach from .rich.
  return card ? <div className="rich">{body}</div> : body
})

const NAMES: Record<RichKind, string> = {
  chart: "Making a chart",
  choices: "Writing your options",
  map: "Placing pins",
  draft: "Writing the draft",
  table: "Building a table",
  visual: "Drawing a visual",
}

/** The outline of a card that's still arriving. */
function Building({ type }: { type: RichKind }) {
  return (
    <CardFrame label={NAMES[type]} className="flex flex-col gap-3 px-[18px] pt-4 pb-[18px]">
      <span className="shimmer w-fit text-[12px]">{NAMES[type]}</span>
      {type === "chart" ? (
        <div className="flex h-[120px] items-end gap-2.5" aria-hidden="true">
          {[46, 70, 58, 88, 64, 100, 78, 92].map((h, i) => (
            <span key={i} className="rich-skeleton flex-1" style={{ height: `${h}%`, opacity: 0.35 + i * 0.06 }} />
          ))}
        </div>
      ) : type === "choices" ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="rich-skeleton h-[46px] w-full rounded-[10px]" />
          ))}
        </div>
      ) : type === "map" ? (
        <div className="flex gap-4" aria-hidden="true">
          <span className="rich-skeleton h-[120px] w-[160px] rounded-[10px]" />
          <div className="flex flex-1 flex-col gap-2.5 pt-1">
            {[80, 64, 72].map((w, i) => (
              <span key={i} className="rich-skeleton h-3" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5" aria-hidden="true">
          {[92, 100, 84, 60].map((w, i) => (
            <span key={i} className="rich-skeleton h-3" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </CardFrame>
  )
}
