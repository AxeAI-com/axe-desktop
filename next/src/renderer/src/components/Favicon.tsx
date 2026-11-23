import { useState } from "react"

import { GlobeIcon } from "./SolarIcons"

/** Where sites keep their icon, tried in order. */
const PATHS = ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png"]

/** A site's own icon, fetched from the site itself (no third party); a globe when it has none. */
export function Favicon({ domain, size = 14, className = "", tile, tileColor }: { domain: string; size?: number; className?: string; tile?: boolean; tileColor?: number }) {
  // The mock engine (screenshot tests) never reaches real sites, so pictures stay the same run to run.
  const [tried, setTried] = useState(() => (typeof window !== "undefined" && "__axeMock" in window ? PATHS.length : 0))
  // A tile: with no icon of its own, a globe on the raised circle (never a letter).
  if (tile && tried >= PATHS.length)
    return (
      <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-3 ${className}`} style={{ width: size, height: size }}>
        <GlobeIcon size={Math.round(size * 0.6)} />
      </span>
    )
  if (tried >= PATHS.length) return <GlobeIcon size={size} className={`text-ink-3 ${className}`} />
  return (
    <img
      src={`https://${domain}${PATHS[tried]}`}
      alt=""
      width={size}
      height={size}
      onError={() => setTried((t) => t + 1)}
      className={`shrink-0 rounded-full object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
