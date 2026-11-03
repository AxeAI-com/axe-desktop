import { CheckReadIcon as CheckIcon } from "@solar-icons/react/linear/check-read"
import { CopyIcon } from "@solar-icons/react/linear/copy"
import { cn } from "cn"
import * as React from "react"
import { Button } from "@/components/ui/button"

interface EmailComposerProps extends Omit<React.ComponentProps<"form">, "onSubmit"> {
  body: string
  onBodyChange?: (value: string) => void
  onSubmit?: () => void
  onSubjectChange?: (value: string) => void
  onRecipientsChange?: (value: string[]) => void
  recipients: string[]
  subject: string
  // Axe AI: the submit button's words ("Open in mail": Axe AI never sends mail itself).
  submitLabel?: string
  // Axe AI: overrides the default "needs a recipient and a message" rule for Send.
  canSubmit?: boolean
}

function EmailComposer({
  body,
  className,
  onBodyChange,
  onSubmit,
  onSubjectChange,
  onRecipientsChange,
  recipients,
  subject,
  canSubmit,
  submitLabel = "Send",
  ...props
}: EmailComposerProps) {
  const id = React.useId()
  const [copyStatus, setCopyStatus] = React.useState("")
  const fieldClassName =
    "min-w-0 flex-1 rounded-sm bg-transparent py-4 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/60"

  async function copyDraft() {
    try {
      // Axe AI: no empty "To:" line when there are no recipients yet.
      const to = recipients.filter((r) => r.trim()).join(", ")
      await navigator.clipboard.writeText(`${to ? `To: ${to}\n` : ""}Subject: ${subject}\n\n${body}`)
      setCopyStatus("Copied")
    } catch {
      setCopyStatus("Could not copy. Please try again.")
    }
  }

  React.useEffect(() => {
    if (!copyStatus) return
    const timer = setTimeout(() => setCopyStatus(""), 2500)
    return () => clearTimeout(timer)
  }, [copyStatus])

  return (
    <form
      data-slot="email-composer"
      className={cn(
        "overflow-hidden rounded-[1rem] bg-card font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground shadow-card",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.()
      }}
      {...props}
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-1 sm:px-6">
        <h3 className="card-heading text-muted-foreground">Email</h3>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Copy email"
            title="Copy email"
            onClick={copyDraft}
            size="icon-sm"
            type="button"
            variant="ghost"
            className="text-muted-foreground"
          >
            <span className="grid *:col-start-1 *:row-start-1 *:transition-[opacity,scale] *:duration-150 *:ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:*:transition-opacity">
              <CopyIcon className={cn(copyStatus === "Copied" && "scale-75 opacity-0")} />
              <CheckIcon className={cn(copyStatus !== "Copied" && "scale-75 opacity-0")} />
            </span>
          </Button>
          <Button
            className="ml-2 h-7 rounded-full border-0 bg-primary px-3 text-primary-foreground shadow-none hover:brightness-110 dark:bg-none"
            size="sm"
            variant="default"
            type="submit"
            disabled={
              !onSubmit || !(canSubmit ?? (recipients.some((recipient) => recipient.trim()) && body.trim()))
            }
          >
            {submitLabel}
          </Button>
        </div>
      </header>
      <div className="px-5 sm:px-6">
        <div className="flex items-baseline gap-4 border-b border-border/70">
          <label className="w-20 shrink-0 text-sm text-muted-foreground/70" htmlFor={`${id}-recipients`}>
            Recipients
          </label>
          <input
            className={fieldClassName}
            id={`${id}-recipients`}
            aria-label="Recipients"
            placeholder="Add recipients"
            value={recipients.join(",")}
            readOnly={!onRecipientsChange}
            onChange={(event) => onRecipientsChange?.(event.target.value.split(","))}
          />
        </div>
        <div className="flex items-baseline gap-4 border-b border-border/70">
          <label className="w-20 shrink-0 text-sm text-muted-foreground/70" htmlFor={`${id}-subject`}>
            Subject
          </label>
          <input
            className={fieldClassName}
            id={`${id}-subject`}
            placeholder="Add a subject"
            value={subject}
            readOnly={!onSubjectChange}
            onChange={(event) => onSubjectChange?.(event.target.value)}
          />
        </div>
        <textarea
          aria-label="Email message"
          className={cn(
            // Axe AI: no expand button; the message grows with its text (field-sizing), so the whole email shows.
            "block min-h-64 w-full resize-none rounded-sm bg-transparent pt-4 pb-5 text-sm leading-[1.6] text-muted-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground/60",
          )}
          onChange={(event) => onBodyChange?.(event.target.value)}
          readOnly={!onBodyChange}
          placeholder="Write your message…"
          value={body}
        />
      </div>
      <output className="sr-only">{copyStatus}</output>
    </form>
  )
}

export type { EmailComposerProps }
export { EmailComposer }
