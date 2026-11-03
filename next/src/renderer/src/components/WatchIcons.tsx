import type { Kind } from "@shared/watching/types"

// One plain glyph per kind of watch. The kind shows only as this icon, never as a label on a row.

const PATHS: Record<Kind, string> = {
  // The Available elements board's glyphs (design "Watching redesign", Elements), as one path each.
  processes: "M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4",
  memory: "M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2zM7 10v4M11 10v4M15 10v4",
  battery: "M4.5 7h12a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1 -2.5 2.5h-12a2.5 2.5 0 0 1 -2.5 -2.5v-5a2.5 2.5 0 0 1 2.5 -2.5zM22 11v2M6 10v4M9 10v4",
  ports: "M5 4h14a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-3a2 2 0 0 1 2 -2zM5 13h14a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-3a2 2 0 0 1 2 -2zM7 7.5h.01M7 16.5h.01",
  docker: "M5 10h14a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2zM7 10V6h4v4M13 10V6h4v4",
  gitrepos: "M4 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M16 8a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M6 8v8M18 10c0 4-6 3-11 7",
  brew: "M5 8h11v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM16 11h2a2 2 0 0 1 0 4h-2M8 4v1M12 3v2",
  macos: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  timemachine: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2",
  hogs: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 16v-5M9 13l3-3 3 3",
  network: "M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
  pagespeed: "M4 17a8 8 0 1 1 16 0M12 17l4-5",
  wallets: "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4M21 11h-5a2 2 0 0 0 0 4h5z",
  fees: "M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 3v6a1.5 1.5 0 0 0 3 0V9l-3-3",
  mentions: "M4 5h16v11H9l-5 4z",
  email: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM3 7l9 6 9-6",
  global: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  downloads: "M12 4v11M7 10l5 5 5-5M5 20h14",

  uptime: "M3 12h4l3-7 4 14 3-7h4",
  page: "M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8zM14 3v5h5M8.5 13h7M8.5 16.5h4.5",
  price: "M20.5 13.5l-7 7a1.8 1.8 0 0 1-2.5 0L3 12.5V3h9.5l8 8a1.8 1.8 0 0 1 0 2.5zM7.5 6.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z",
  security: "M12 3l7.5 3v5.5c0 4.7-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.8-7.5-9.5V6z",
  repo: "M6.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6.5 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17.5 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6.5 7.5v9M17.5 9.5c0 4.5-6 3.5-10 7.2",
  custom: "M12 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z",
  // A pulse in a heart.
  health: "M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20zM7 12h2.5l1.5-2.5 2 4 1.5-1.5H17",
  // A calendar page.
  expiry: "M5.5 5.5h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1zM4.5 10h15M8.5 3.5v4M15.5 3.5v4M12 13v3l2 1",
  // Three linked nodes.
  dns: "M12 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM5.5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18.5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM10.8 8.2l-4 7.6M13.2 8.2l4 7.6M8 18h8",
  // Stacked layers.
  status: "M12 4l8.5 4.5L12 13 3.5 8.5zM3.5 12.5L12 17l8.5-4.5M3.5 16L12 20.5 20.5 16",
  // A download arrow onto a tray.
  feed: "M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3",
  // A magnifier.
  seo: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.3 15.3l4.7 4.7",
  // A broken chain link.
  links: "M9.5 14.5l-2 2a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0M14.5 9.5l2-2a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0M8 4v2M4 8h2M16 20v-2M20 16h-2",
  // A flask.
  tests: "M9.5 3.5h5M10.5 3.5v6L5 18.5a1.3 1.3 0 0 0 1.1 2h11.8a1.3 1.3 0 0 0 1.1-2L13.5 9.5v-6M7.5 14.5h9",
  // A box with an up arrow.
  outdated: "M4 8l8-4.5L20 8v8l-8 4.5L4 16zM4 8l8 4.5L20 8M12 12.5v8",
  // A drive.
  disk: "M4.5 13.5l2.5-8h10l2.5 8M4.5 13.5h15v5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM16 16.5h.01",
}

export function KindIcon({ kind, size = 15, className = "", strokeWidth = 1.6 }: { kind: Kind; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[kind]} />
    </svg>
  )
}

/** Competitor pages has its own glyph in the catalogue (an eye); it drafts a Page changes watch. */
export const COMPETITOR_PATH = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"

/** The 28 px tile a watch row and the plan card start with. */
export function KindTile({ kind, size = 28 }: { kind: Kind; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[6px] bg-fill text-ink-2" style={{ width: size, height: size }}>
      <KindIcon kind={kind} size={Math.round(size * 0.54)} />
    </span>
  )
}

const glyph = (d: string) =>
  function Glyph({ size = 14, className = "" }: { size?: number; className?: string }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
        <path d={d} />
      </svg>
    )
  }

/** The chevron and row menus' Pause, Resume and Rename. */
export const PauseIcon = glyph("M9 6v12M15 6v12")
export const PlayIcon = glyph("M8 5.5l10.5 6.5L8 18.5z")
export const TypeIcon = glyph("M5 7V5h14v2M12 5v14M9.5 19h5")
