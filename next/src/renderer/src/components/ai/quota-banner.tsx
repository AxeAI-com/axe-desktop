import { ArrowRightUpIcon as ArrowUpRightIcon } from "@solar-icons/react/linear/arrow-right-up"
import { SpeedometerMiddleIcon as GaugeIcon } from "@solar-icons/react/linear/speedometer-middle"
import { cn } from "cn"
import type * as React from "react"
import { Button } from "@/components/ui/button"

interface QuotaBannerProps extends React.ComponentProps<"aside"> {
  label?: string
  limit: number
  onUpgrade?: () => void
  resetsAt: string
  unit?: string
  used: number
  // Axe AI: replace the "used / limit" headline and the "left · Resets" line, and name the button.
  summary?: React.ReactNode
  detail?: React.ReactNode
  upgradeLabel?: string
}

function QuotaBanner({
  className,
  label = "Monthly agent usage",
  limit,
  onUpgrade,
  resetsAt,
  unit = "runs",
  used,
  summary,
  detail,
  upgradeLabel = "Upgrade",
  ...props
}: QuotaBannerProps) {
  const remaining = Math.max(limit - used, 0)
  const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const tone = percentage > 95 ? "bg-red-500" : percentage >= 80 ? "bg-amber-500" : "bg-foreground/85"

  return (
    <aside
      data-slot="quota-banner"
      className={cn(
        "rounded-[1rem] bg-card p-4 font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground shadow-card dark:shadow-none",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-foreground/6 text-muted-foreground">
          <GaugeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm leading-5 font-medium text-muted-foreground">{label}</h3>
          <p className="mt-1 text-[1.375rem] leading-7 font-medium tracking-[-0.02em] text-foreground tabular-nums">
            {summary ?? `${used.toLocaleString()} / ${limit.toLocaleString()} ${unit}`}
          </p>
          <meter
            aria-label={`${label}: ${used.toLocaleString()} of ${limit.toLocaleString()} ${unit} used`}
            className="sr-only"
            max={limit}
            min={0}
            value={Math.min(used, limit)}
          />
          <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/8">
            <div
              className={cn("h-full rounded-full transition-colors duration-200 ease-out", tone)}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground tabular-nums">
            {detail ?? `${remaining.toLocaleString()} left · Resets ${resetsAt}`}
          </p>
        </div>
        {onUpgrade && (
          <Button
            className="h-7 rounded-full border-0 bg-primary px-3 text-sm font-[450] text-primary-foreground shadow-none hover:bg-primary/90"
            onClick={onUpgrade}
            size="sm"
            type="button"
          >
            {upgradeLabel}{" "}
            <ArrowUpRightIcon
              data-icon="inline-end"
              className="transition-[translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/button:translate-x-px group-hover/button:-translate-y-px motion-reduce:transition-none"
            />
          </Button>
        )}
      </div>
    </aside>
  )
}

export type { QuotaBannerProps }
export { QuotaBanner }
