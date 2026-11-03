import { cn } from "cn"
import * as React from "react"
import { Button } from "@/components/ui/button"

interface PlanApprovalStep {
  id: string
  label: string
}

interface PlanApprovalCardProps extends React.ComponentProps<"section"> {
  title: string
  steps: PlanApprovalStep[]
  onEdit?: () => void
  onCancel?: () => void
  onStart?: () => void
  disabled?: boolean
  /** Controlled display only; the card never starts a plan automatically. */
  countdownSeconds?: number
  countdownDuration?: number
}

function PlanApprovalCard({
  className,
  title,
  steps,
  onEdit,
  onCancel,
  onStart,
  disabled = false,
  countdownSeconds,
  countdownDuration = 60,
  ...props
}: PlanApprovalCardProps) {
  const titleId = React.useId()
  const seconds =
    countdownSeconds === undefined || !Number.isFinite(countdownSeconds)
      ? undefined
      : Math.max(0, Math.ceil(countdownSeconds))
  const progress =
    seconds === undefined || !Number.isFinite(countdownDuration) || countdownDuration <= 0
      ? 0
      : Math.min(1, seconds / countdownDuration)

  return (
    <section
      aria-labelledby={titleId}
      data-slot="plan-approval-card"
      className={cn(
        "w-fit max-w-full rounded-[16px] border-0 bg-card p-[18px] font-sans text-[14px] leading-5 font-normal text-ink-2 shadow-none transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
        className,
      )}
      {...props}
    >
      <h3 id={titleId} className="m-0 text-[14px] leading-5 font-normal text-ink">
        {title}
      </h3>
      <ol className="mt-4 space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3.5">
            <span
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-ink-4"
            />
            <span className="min-w-0 break-words">{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          className="h-7 rounded-full px-3 text-[13px] font-normal text-ink-3 hover:bg-fill hover:text-ink"
          disabled={disabled}
          onClick={onEdit}
        >
          Edit
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              className="h-7 rounded-full px-3 text-[13px] font-normal text-ink-3 hover:bg-fill hover:text-ink"
              disabled={disabled}
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            type="button"
            variant="default"
            className="h-7 gap-2 rounded-full border-0 bg-primary px-3 text-[13px] font-normal text-primary-foreground shadow-none hover:brightness-110 dark:bg-none"
            disabled={disabled || steps.length === 0}
            onClick={onStart}
          >
            Start
            {seconds !== undefined && (
              <span
                className="relative flex size-5 items-center justify-center text-[0.625rem] tabular-nums"
                role="img"
                aria-label={`${seconds} seconds remaining`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 32 32"
                  className="absolute inset-0 size-5 -rotate-90 fill-none stroke-current"
                >
                  <circle cx="16" cy="16" r="14" strokeWidth="1.5" className="opacity-15" />
                  <circle
                    cx="16"
                    cy="16"
                    r="14"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    pathLength="1"
                    strokeDasharray={`${progress} 1`}
                    className="transition-[stroke-dasharray] duration-1000 ease-linear motion-reduce:transition-none"
                  />
                </svg>
                {seconds}
              </span>
            )}
          </Button>
        </div>
      </div>
    </section>
  )
}

export type { PlanApprovalCardProps, PlanApprovalStep }
export { PlanApprovalCard }
