import { ClockCircleIcon } from "@solar-icons/react/linear/clock-circle"
import { CloseIcon } from "@solar-icons/react/linear/close"
import { KeyMinimalisticIcon as KeyRoundIcon } from "@solar-icons/react/linear/key-minimalistic"
import { cn } from "cn"
import type * as React from "react"
import { Button } from "@/components/ui/button"

interface PermissionGrantProps extends React.ComponentProps<"section"> {
  capability: string
  description: string
  duration?: string
  onDeny?: () => void
  onGrant?: () => void
  restrictions?: React.ReactNode[]
  scope: React.ReactNode[]
  // Axe AI: heading and button labels (defaults are Pasta's).
  title?: string
  grantLabel?: string
  denyLabel?: string
}

const itemClass =
  "flex items-start gap-2.5 text-[14px] leading-5 text-ink-2 [&_code]:rounded-[6px] [&_code]:bg-fill-2 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[13px]"

function PermissionGroup({
  allowed,
  items,
  label,
}: {
  allowed: boolean
  items: React.ReactNode[]
  label: string
}) {
  return (
    <div>
      <p className="mb-2 text-[13px] leading-5 font-normal text-ink-3">{label}</p>
      <ul className="space-y-2">
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items are arbitrary ReactNodes with no stable id
          <li className={itemClass} key={index}>
            {allowed ? (
              <svg
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-live"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
                viewBox="0 0 16 16"
              >
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>
            ) : (
              <CloseIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PermissionGrant({
  capability,
  className,
  description,
  duration = "This session",
  onDeny,
  onGrant,
  restrictions = [],
  scope,
  title,
  grantLabel = "Grant access",
  denyLabel = "Deny",
  ...props
}: PermissionGrantProps) {
  return (
    <section
      data-slot="permission-grant"
      className={cn(
        "overflow-hidden rounded-[16px] border-0 bg-card font-sans text-[14px] font-normal text-ink-3 shadow-none transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
        className,
      )}
      {...props}
    >
      <div className="flex gap-3 p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-fill-4 text-ink-2">
          <KeyRoundIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-6 font-normal text-foreground">
            {title ?? `Grant ${capability}?`}
          </h3>
          <p className="mt-1 text-[14px] leading-5 text-ink-3">{description}</p>
          <div className="mt-4 space-y-4 rounded-[12px] bg-fill p-4">
            {scope.length > 0 && <PermissionGroup allowed items={scope} label="Can" />}
            {restrictions.length > 0 && (
              <PermissionGroup allowed={false} items={restrictions} label="Can't" />
            )}
          </div>
          <p className="mt-3 flex items-center gap-2 text-[13px] leading-5 text-ink-3">
            <ClockCircleIcon aria-hidden="true" className="size-4 shrink-0" />
            {duration}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5">
        <Button
          className="h-8 rounded-full px-4 text-[13px] font-normal text-ink-3 hover:bg-fill hover:text-ink"
          onClick={onDeny}
          size="sm"
          type="button"
          variant="ghost"
        >
          {denyLabel}
        </Button>
        <Button
          className="h-8 rounded-full border-0 bg-primary px-4 text-[13px] font-normal text-primary-foreground shadow-none hover:brightness-110 dark:bg-none"
          onClick={onGrant}
          size="sm"
          type="button"
          variant="default"
        >
          {grantLabel}
        </Button>
      </div>
    </section>
  )
}

export type { PermissionGrantProps }
export { PermissionGrant }
