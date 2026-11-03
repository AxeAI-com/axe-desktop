import type { SVGProps } from "react"

// The agent screens' marks (board RC-AgentChat, RC-AgentWorking): 24 px grid, 1.5 stroke.
type P = SVGProps<SVGSVGElement> & { size?: number }

function Mark({ size = 16, d, ...rest }: P & { d: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }} {...rest}>
      <path d={d} />
    </svg>
  )
}

/** A shield: what the mode and a permission request are about. */
export const ShieldMark = (p: P) => <Mark d="M12 3.5l7.5 3v5.5c0 4.2-3.2 7.7-7.5 8.5-4.3-.8-7.5-4.3-7.5-8.5V6.5z" {...p} />
/** A terminal window: the command a request wants to run. */
export const TerminalMark = (p: P) => <Mark d="M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M12.5 15h4" {...p} />
/** Three lines with dots: a plan's steps. */
export const StepsMark = (p: P) => <Mark d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" {...p} />
/** Chevrons, 13 px: down (turns up when open) and right. */
export const ChevronDownMark = (p: P) => <Mark d="M7 10l5 5 5-5" {...p} />
export const ChevronRightMark = (p: P) => <Mark d="M10 7l5 5-5 5" {...p} />
/** The row marks of an agent waiting on you: thinking, a file, an edit. */
export const ThoughtMark = (p: P) => <Mark d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.5A3 3 0 0 0 9 19.5h.5V4.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.5A3 3 0 0 1 15 19.5h-.5V4.5z" {...p} />
export const FileMark = (p: P) => <Mark d="M6.5 3.5h7.5l4 4v13h-11.5zM14 3.5v4h4" {...p} />
export const EditMark = (p: P) => <Mark d="M15.5 4.5l4 4L8 20H4v-4z" {...p} />
