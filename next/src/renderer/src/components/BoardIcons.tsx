import { CopyIcon as SolarCopy } from "@solar-icons/react/bold-duotone/copy"
import { DocumentTextIcon as SolarPage } from "@solar-icons/react/bold-duotone/document-text"
import { GlobalIcon as SolarGlobal } from "@solar-icons/react/bold-duotone/global"
import { RefreshIcon as SolarRefresh } from "@solar-icons/react/bold-duotone/refresh"

// The four icons the chat screens share with the board: a page, a web mark, a copy mark and a retry arrow.
// Solar Bold Duotone (spec 0001), drawn at the size the board uses (16 or 14).

const make = (Solar: (p: Record<string, unknown>) => React.ReactNode) =>
  function BoardIcon({ size = 16 }: { size?: number }) {
    return <Solar size={size} className="axe-icon" aria-hidden="true" focusable="false" />
  }

export const PageIcon = make(SolarPage as never)
export const WebMark = make(SolarGlobal as never)
export const CopyMark = make(SolarCopy as never)
export const RetryMark = make(SolarRefresh as never)
