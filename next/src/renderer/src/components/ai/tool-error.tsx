import { DangerTriangleIcon as DangerIcon } from "@solar-icons/react/bold/danger-triangle"
import { cn } from "cn"
import type * as React from "react"
import { Button } from "@/components/ui/button"

interface ToolErrorProps extends React.ComponentProps<"section"> {
  attempts?: number
  code?: string
  title?: string
  message: string
  onFix?: () => void
  onRetry?: () => void
  fixLabel?: string
  // Axe AI: the line above the card (defaults to Pasta's "Needs a fix").
  label?: string
  tool: string
}

function ToolError({
  attempts,
  className,
  code,
  title,
  message,
  onFix,
  onRetry,
  fixLabel = "Fix connection",
  label = "Needs a fix",
  tool,
  ...props
}: ToolErrorProps) {
  return (
    <section
      data-slot="tool-error"
      className={cn(
        "font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
        className,
      )}
      {...props}
    >
      <div className="mb-3 flex items-center gap-2 px-1 text-destructive" role="alert">
        <DangerIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span>{label}</span>
      </div>
      {/* Axe AI: spec 0001: 24px container on the card fill, 24 padding, no shadow. */}
      <div className="rounded-3xl bg-card p-[24px]">
        <h3 className="text-sm leading-5 font-[450]">{title ?? `${tool} connection lost partway through`}</h3>
        <p className="mt-1 text-sm leading-5 text-foreground">{message}</p>
        {(code || attempts !== undefined) && (
          <p className="mt-2 metadata-label break-words">
            {code && <code>{code}</code>}
            {code && attempts !== undefined && " · "}
            {attempts !== undefined && `Attempt ${attempts}`}
          </p>
        )}
        {(onFix || onRetry) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {onFix && (
              <Button
                onClick={onFix}
                size="sm"
                variant="default"
                className="h-[32px] rounded-full border-0 bg-brand px-[16px] text-[13px] font-normal text-white shadow-none hover:bg-brand-hover dark:bg-brand"
              >
                {fixLabel}
              </Button>
            )}
            {onRetry && (
              <Button
                onClick={onRetry}
                size="sm"
                variant="outline"
                className="h-[32px] rounded-full border-0 bg-fill-2 px-[16px] text-[13px] font-normal hover:bg-fill-3"
              >
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export type { ToolErrorProps }
export { ToolError }
