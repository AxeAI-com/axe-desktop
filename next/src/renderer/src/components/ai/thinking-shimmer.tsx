import { cn } from "cn"
import type * as React from "react"

import { AxeMark } from "@/components/Logo"

interface ThinkingShimmerProps extends React.ComponentProps<"div"> {
  label?: string
  /** Axe AI: seconds so far, shown after the label ("Thinking · 6s"). */
  seconds?: number
}

function ThinkingShimmer({ className, label = "Thinking", seconds, ...props }: ThinkingShimmerProps) {
  return (
    <div
      aria-live="polite"
      data-slot="thinking-shimmer"
      className={cn(
        "flex items-center gap-2 font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {/* Axe AI: the Axe mark, breathing, in place of a generic sparkle. */}
      <AxeMark size={12} className="shrink-0 animate-pulse motion-reduce:animate-none" />
      {/* Axe AI: a new label swaps in place (180 ms fade and a 2 px rise) instead of a new row. */}
      <span
        key={label}
        className="agent-text-shimmer transition-[opacity,translate] duration-180 ease-[cubic-bezier(0.2,0,0,1)] starting:translate-y-0.5 starting:opacity-0 motion-reduce:transition-none"
      >
        {label}
      </span>
      {seconds !== undefined ? (
        <span className="text-muted-foreground/70 tabular-nums">{seconds}s</span>
      ) : null}
    </div>
  )
}

export type { ThinkingShimmerProps }
export { ThinkingShimmer }
