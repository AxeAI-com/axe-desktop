import { cn } from "cn"
import * as React from "react"
import { Button } from "@/components/ui/button"

interface PlanResearchStep {
  id: string
  label: string
  status: "pending" | "running" | "complete"
}

interface PlanResearchCardProps extends React.ComponentProps<"section"> {
  title: string
  steps: PlanResearchStep[]
  progress: number
  searchCount: number
  statusText: string
  onUpdate?: () => void
  onStop?: () => void
  disabled?: boolean
}

function PlanResearchCard({
  title,
  steps,
  progress,
  searchCount,
  statusText,
  onUpdate,
  onStop,
  disabled = false,
  className,
  ...props
}: PlanResearchCardProps) {
  const titleId = React.useId()
  const percentage = Math.min(100, Math.max(0, progress))

  return (
    <section
      aria-labelledby={titleId}
      data-slot="plan-research-card"
      className={cn(
        "w-fit max-w-full rounded-[16px] border-0 bg-card p-[18px] font-sans text-[14px] leading-5 font-normal text-ink-2 shadow-none",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-4">
        <h3 id={titleId} className="m-0 text-[14px] leading-5 font-normal text-ink">
          {title}
        </h3>
        <Button
          type="button"
          variant="ghost"
          className="h-7 shrink-0 rounded-full px-3 text-[13px] font-normal text-ink-3 hover:bg-fill hover:text-ink"
          onClick={onUpdate}
          disabled={disabled || !onUpdate}
        >
          Update
        </Button>
      </div>
      <ol className="mt-4 space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3.5">
            {step.status === "complete" ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="mt-0.5 size-4 shrink-0 text-live transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:scale-90 starting:opacity-0 motion-reduce:starting:scale-100"
              >
                <circle cx="8" cy="8" r="8" fill="currentColor" />
                <path
                  d="m4.5 8 2.2 2.2 4.8-5"
                  fill="none"
                  className="stroke-background"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0 rounded-full border-[1.5px]",
                  step.status === "running"
                    ? "border-foreground"
                    : "border-dashed border-ink-4",
                )}
              />
            )}
            <span className="min-w-0 break-words">
              <span className="sr-only">{step.status}: </span>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <output className="min-w-0 flex-1">{statusText}</output>
          <span className="shrink-0 tabular-nums">{searchCount.toLocaleString("en-US")} searches</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <progress
            aria-label="Research progress"
            max={100}
            value={percentage}
            className="h-1 min-w-0 flex-1 appearance-none overflow-hidden rounded-full border-0 bg-muted [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-muted-foreground [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-muted-foreground"
          />
          <Button
            type="button"
            aria-label="Stop research"
            variant="default"
            className="size-7 rounded-full border-0 bg-primary p-0 text-primary-foreground shadow-none hover:brightness-110 dark:bg-none"
            disabled={disabled || !onStop}
            onClick={onStop}
          >
            <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-current" />
          </Button>
        </div>
      </div>
    </section>
  )
}

export type { PlanResearchCardProps, PlanResearchStep }
export { PlanResearchCard }
