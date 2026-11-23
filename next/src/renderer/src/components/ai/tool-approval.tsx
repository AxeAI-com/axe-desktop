import { cn } from "cn"
import type * as React from "react"
import { isShellCommand } from "@/lib/steps"

import { FileMark, ShieldMark, TerminalMark } from "./board-icons"

interface ToolApprovalProps extends React.ComponentProps<"section"> {
  command?: string
  description: string
  onAllow?: (remember: boolean) => void
  onDeny?: () => void
  scope?: string
  tool: string
  // Axe AI: button labels (defaults are Pasta's).
  allowLabel?: string
  rememberLabel?: string
  denyLabel?: string
  // Axe AI: hide the "always allow" button when allowing already lasts (e.g. for a chat).
  hideRemember?: boolean
}

function ToolApproval({
  className,
  command,
  description,
  onAllow,
  onDeny,
  scope,
  tool,
  allowLabel = "Allow once",
  rememberLabel = "Always allow",
  denyLabel = "Deny",
  hideRemember = false,
  ...props
}: ToolApprovalProps) {
  // Axe AI: left-aligned like the steps above it, no box. A shell command never becomes the title: the
  // title says what it is in a few words and the command waits behind "Show command".
  const shell = isShellCommand(description)
  const title = shell ? "Run a command" : description
  // Axe AI: the question reads as one ("Run this command?", "Write src/cart.js?"), not "Allow Run a command?".
  const question = tool !== "this" ? `Allow ${tool}: ${title}?` : shell ? "Run this command?" : /\?$/.test(title) ? title : `${title}?`
  const commandish = shell || (!!command && isShellCommand(command))
  // Axe AI: a file the title already names ("Write src/cart.js") isn't repeated under it.
  const code = command && command !== description && !description.includes(command) ? command : shell ? description : undefined
  // Axe AI: spec 0001: 32px pills, 150ms ease-out, a 0.96 press.
  const pill = "inline-flex h-[32px] items-center justify-center rounded-full border-0 px-[16px] text-[13px] font-normal transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96]"
  return (
    <section
      data-slot="tool-approval"
      className={cn(
        "flex flex-col items-start rounded-3xl border-0 bg-card p-[24px] font-sans text-[14px] font-normal text-ink-3 shadow-none transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
        className,
      )}
      {...props}
    >
      <div className="mb-[4px] flex min-h-[24px] items-center gap-[8px] text-[14px] leading-5 text-foreground">
        <ShieldMark className="text-warn" />
        {/* An agent's own "X wants to …" title already reads as the question. */}
        <span>{/\bwants to\b/.test(title) ? title : question}</span>
      </div>
      {code && (
        <details open className="group mb-[10px] w-full">
          <summary className="sr-only">
            <span className="group-open:hidden">Show command</span>
            <span className="hidden group-open:inline">Hide command</span>
          </summary>
          {/* Axe AI: a long or multi-line command keeps its lines and scrolls past 8 of them; the icon sits on the first line. */}
          <div className="flex items-start gap-[10px] rounded-media bg-entity px-[16px] py-[8px] font-mono text-[12px] leading-[20px] text-ink">
            <span className="flex h-[20px] shrink-0 items-center">
              {commandish ? <TerminalMark size={14} className="text-ink-3" /> : <FileMark size={14} className="text-ink-3" />}
            </span>
            <code className="scroll max-h-[160px] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all">{code}</code>
          </div>
        </details>
      )}
      {scope && <p className="m-0 mb-[8px] text-[13px] leading-5">Scope: {scope}</p>}
      <div className="flex flex-wrap items-center gap-[8px]">
        <button type="button" onClick={() => onAllow?.(false)} className={`${pill} bg-brand text-white hover:bg-brand-hover`}>
          {allowLabel}
        </button>
        {!hideRemember && (
          <button type="button" onClick={() => onAllow?.(true)} className={`${pill} bg-fill-2 text-foreground hover:bg-fill-3`}>
            {rememberLabel}
          </button>
        )}
        <button type="button" onClick={onDeny} className={`${pill} bg-transparent text-ink-3 hover:bg-fill-2 hover:text-ink`}>
          {denyLabel}
        </button>
      </div>
    </section>
  )
}

export type { ToolApprovalProps }
export { ToolApproval }
