import { ExportIcon as ExternalLinkIcon } from "@solar-icons/react/linear/export"
import { cn } from "cn"
import type * as React from "react"
import { Button } from "@/components/ui/button"

interface InlineCitationProps extends React.ComponentProps<"span"> {
  excerpt?: string
  index: number
  /** Axe AI: what the chip shows instead of its number (a site's logo and name). */
  label?: React.ReactNode
  onOpenChange?: (open: boolean) => void
  onOpenSource?: () => void
  open?: boolean
  source: string
  title: string
}

function InlineCitation({
  className,
  excerpt,
  index,
  label,
  onOpenChange,
  onOpenSource,
  open = false,
  source,
  title,
  ...props
}: InlineCitationProps) {
  return (
    <span
      data-slot="inline-citation"
      className={cn(
        "relative inline-flex font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground",
        className,
      )}
      {...props}
    >
      <button
        aria-expanded={open}
        aria-label={label ? `Source ${index}: ${source}` : undefined}
        className={cn(
          "inline-flex items-center justify-center font-[450] text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          label
            ? "h-[1.125rem] max-w-36 gap-1 rounded-full bg-foreground/6 px-1.5 align-[0.125em] text-[0.6875rem] leading-none hover:bg-foreground/10 hover:text-foreground"
            : "min-w-5 rounded-md bg-muted px-1.5 py-0.5 align-super text-xs leading-4 hover:bg-muted/70",
        )}
        onClick={() => onOpenChange?.(!open)}
        type="button"
      >
        {label ? <span className="flex min-w-0 items-center gap-1 truncate">{label}</span> : index}
      </button>
      {open && (
        <span className="absolute bottom-full left-1/2 z-20 mb-2 w-72 max-w-[calc(100vw-2rem)] origin-bottom -translate-x-1/2 rounded-[1rem] bg-card p-4 text-muted-foreground shadow-card transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] starting:scale-95 starting:opacity-0 motion-reduce:starting:scale-100">
          <span className="block card-heading leading-5">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{source}</span>
          {excerpt && <span className="mt-2 block text-xs leading-5 text-muted-foreground">{excerpt}</span>}
          <Button
            className="mt-3 h-7 gap-2 rounded-full border-0 bg-primary px-3 text-sm font-[450] tracking-[-0.05px] text-primary-foreground shadow-none hover:brightness-110 dark:bg-none"
            onClick={onOpenSource}
            size="sm"
            type="button"
            variant="default"
          >
            Open source <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        </span>
      )}
    </span>
  )
}

export type { InlineCitationProps }
export { InlineCitation }
