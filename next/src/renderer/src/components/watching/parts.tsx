import { clock, day, sameDay } from "@/components/watching/Evidence"

// Small parts every Watching screen shares: buttons, dots, the bubble, one-line rows, facts, cards.

export const btn = (kind: "pri" | "sec" | "ghost" = "sec") =>
  `inline-flex h-[28px] shrink-0 cursor-pointer items-center gap-[6px] rounded-[6px] border-0 px-[12px] text-[13px] whitespace-nowrap transition-colors duration-150 disabled:cursor-default disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-brand ${
    kind === "pri" ? "bg-brand text-white hover:bg-brand-hover" : kind === "ghost" ? "bg-transparent px-[8px] text-ink-2 hover:bg-fill" : "bg-button text-ink hover:bg-fill-3"
  }`

export function Dot({ tone }: { tone: "warn" | "news" | "mute" | "ok" | "live" }) {
  const bg = tone === "warn" ? "bg-warn" : tone === "news" ? "bg-brand" : tone === "ok" ? "bg-ok" : tone === "live" ? "bg-live" : "bg-ink-4"
  return <i className={`inline-block size-[7px] shrink-0 rounded-full ${bg}`} />
}

export const Spin = ({ size = 12 }: { size?: number }) => (
  <span aria-hidden="true" className="block shrink-0 animate-spin rounded-full border-[1.5px] border-ink-4 border-t-transparent motion-reduce:animate-none" style={{ width: size, height: size }} />
)

export function Bubble({ children }: { children: string }) {
  return <div className="selectable max-w-[540px] self-end rounded-[16px] bg-bubble px-[14px] py-[8px] text-[15px] leading-[22px] text-ink">{children}</div>
}

export function Line({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      {icon}
      <span className="text-ink-2">{children}</span>
    </>
  )
  if (onClick)
    return (
      <button type="button" onClick={onClick} className="flex cursor-pointer items-center gap-[10px] border-0 bg-transparent p-0 py-[2px] text-left text-[13px] leading-[18px] text-ink-3">
        {inner}
      </button>
    )
  return <div className="flex items-center gap-[10px] py-[2px] text-[13px] leading-[18px] text-ink-3">{inner}</div>
}

export function Facts({ facts, warn = -1 }: { facts: [string, string][]; warn?: number }) {
  if (!facts.length) return null
  return (
    <div className="grid grid-cols-3 gap-[12px]">
      {facts.slice(0, 6).map(([a, b], i) => (
        <div key={a} className="flex min-w-0 flex-col border-t border-[var(--watch-line)] pt-[8px] text-[13px] leading-[18px]">
          <span className="text-[12px] leading-[16px] text-ink-3">{a}</span>
          <span className={`truncate ${i === warn ? "text-warn" : "text-ink"}`}>{b}</span>
        </div>
      ))}
    </div>
  )
}


export const card = (warn: boolean) => `relative flex flex-col gap-[12px] rounded-[10px] bg-card p-[16px] ${warn ? "shadow-[var(--card-shadow),inset_3px_0_0_var(--warn)]" : "shadow-card"}`

export function Meta({ at, tone }: { at: number; tone: "warn" | "news" | "mute" }) {
  return (
    <div className="flex items-center gap-[8px] text-[12px] leading-[16px] text-ink-3 tabular-nums">
      <Dot tone={tone} />
      <span className={tone === "warn" ? "text-warn" : tone === "news" ? "text-brand-text" : ""}>{sameDay(at, Date.now()) ? clock(at) : `${day(at)}, ${clock(at)}`}</span>
    </div>
  )
}


export function Undo({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="cursor-pointer self-start border-0 bg-transparent p-0 text-[13px] leading-[18px] text-brand-text hover:underline" onClick={onClick}>
      Undo
    </button>
  )
}

