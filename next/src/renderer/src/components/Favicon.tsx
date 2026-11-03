import { useState } from "react"

import { GlobeIcon } from "./Icons"

/** Where sites keep their icon, tried in order. */
const PATHS = ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png"]

const TILE_COLORS = ["#3b6ea5", "#b5473a", "#4a7c59", "#8a6bb5", "#b58a3a"]

/** A site's own icon, fetched from the site itself (no third party); a globe when it has none. */
export function Favicon({ domain, size = 14, className = "", tile, tileColor }: { domain: string; size?: number; className?: string; tile?: boolean; tileColor?: number }) {
  // The mock engine (screenshot tests) never reaches real sites, so pictures stay the same run to run.
  const [tried, setTried] = useState(() => (typeof window !== "undefined" && "__axeMock" in window ? PATHS.length : 0))
  // A tile: with no icon of its own, the site's first letter on a muted colour (the reply's sources row).
  if (tile && tried >= PATHS.length) {
    const hue = (tileColor ?? [...domain].reduce((n, c) => n + c.charCodeAt(0), 0)) % TILE_COLORS.length
    return (
      <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white ${className}`} style={{ width: size, height: size, background: TILE_COLORS[hue] }}>
        {domain.charAt(0).toUpperCase()}
      </span>
    )
  }
  if (tried >= PATHS.length) return <GlobeIcon size={size} className={`text-ink-3 ${className}`} />
  return (
    <img
      src={`https://${domain}${PATHS[tried]}`}
      alt=""
      width={size}
      height={size}
      onError={() => setTried((t) => t + 1)}
      className={`shrink-0 rounded-[3px] object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
