import type { UpdateState } from "@shared/types"

import { relativeAgo } from "./time"

/** One line for Settings: where updates stand, in plain words. */
export function updateLine(s: UpdateState, now: number): string {
  switch (s.status) {
    case "unsupported":
      return s.reason
    case "checking":
      return "Checking for updates…"
    case "downloading":
      return `Downloading ${s.version}, ${s.percent}%`
    case "ready":
      return `Version ${s.version} is ready. Restart to update.`
    case "error":
      return s.message
    default:
      return s.checkedAt !== undefined ? `Up to date. Checked ${relativeAgo(s.checkedAt, now)}.` : "Up to date."
  }
}
