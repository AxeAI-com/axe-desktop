import { cleanTarget } from "@shared/watching/target"
import { statusOf } from "@shared/watching/findings"
import type { ElementKind, Every, Finding, OpenFinding, Run } from "@shared/watching/types"

// The Available elements for the mock engine: what each one's run reads, with the values a real run read on
// a Mac and on public data on 2026-11-02 (tests/e2e/watching-elements-run.mjs), and placeholder names for
// anything personal. ?mock=watchelements is a dashboard with one watch of every element.

const run = (at: number, o: Partial<Run> = {}): Run => ({ at, ms: 600, findings: [], ...o, status: statusOf(o.findings ?? []) })

export const PORT_DOWN: Finding = { key: "port:5173", level: "problem", headline: "Nothing is listening on :5173", line: ":5173 stopped.", detail: "The server on port 5173 stopped. Start it again.", fix: "none" }
export const BACKUP_OLD: Finding = { key: "backup:old", level: "problem", headline: "The last backup was 3 days ago", line: "Last backup 3 days ago.", detail: "Connect the backup disk, or back up now from the Time Machine menu.", fix: "none", value: 74 }

const RUNS: Record<ElementKind, { target: string; facts: [string, string][]; state: string; metric?: number }> = {
  processes: { target: "this-mac", facts: [["Xcode", "87% CPU, 2.4 GB"], ["node", "66% CPU, 0.5 GB"], ["WindowServer", "44% CPU, 0.1 GB"]], state: "Xcode 87% CPU", metric: 87 },
  memory: { target: "this-mac", facts: [["Pressure", "Green"], ["Used", "36%"]], state: "Green, 36% used", metric: 36 },
  battery: { target: "this-mac", facts: [["Health", "83%"], ["Cycles", "217"], ["Charge", "100%, on power"], ["Left", "On power"], ["Awake", "Xcode"]], state: "83% health, 217 cycles", metric: 83 },
  ports: { target: "3000, 4870, 5173", facts: [[":3000", "node"], [":4870", "node"], [":5173", "node"]], state: "3 of 3 listening", metric: 3 },
  docker: { target: "this-mac", facts: [["Running", "4"], ["Stopped", "2"], ["Disk", "66.5 GB"], ["Reclaimable", "28 GB"]], state: "4 running, 2 stopped, 66.5 GB", metric: 66.5 },
  gitrepos: { target: "~/Code", facts: [["shop-web", "18 uncommitted, main not pushed"], ["shop-api", "2 unpushed"]], state: "6 repos, 1 uncommitted, 2 unpushed, 0 behind", metric: 0 },
  brew: { target: "this-mac", facts: [["Outdated", "66"], ["node", "24.10.0 to 24.11.0"], ["git", "2.51.0 to 2.51.1"]], state: "66 outdated", metric: 66 },
  macos: { target: "this-mac", facts: [["Command Line Tools for Xcode 27.2", "509 MB"], ["macOS 27.2", "5.8 GB, restart"]], state: "2 pending: macOS 27.2", metric: 2 },
  timemachine: { target: "this-mac", facts: [["Last backup", "Nov 2, 1:12 pm"]], state: "Last backup 2 h ago", metric: 2 },
  hogs: { target: "~", facts: [["~/Code", "48.2 GB, up 1.3 GB"], ["~/.docker", "21.4 GB"], ["~/.npm", "6.1 GB"]], state: "~/Code 48.2 GB", metric: 48.2 },
  network: { target: "this-mac", facts: [["Connection", "Wi-Fi, Good (-65 dBm)"], ["Link", "648 Mbps, 802.11ax"], ["Speed", "214 Mbps down"], ["VPN", "Off"]], state: "214 Mbps, VPN off", metric: 214 },
  pagespeed: { target: "lane-ceramics.com", facts: [["LCP", "1.4 s"], ["CLS", "0.00"], ["First byte", "212 ms"], ["Rating", "Good"]], state: "LCP 1.4 s, CLS 0.00", metric: 1400 },
  wallets: { target: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", facts: [["USDC", "$1,240.00"], ["USDT", "$310.50"], ["On", "Base, Ethereum"]], state: "$1,550.50 in USDC and USDT", metric: 1550.5 },
  fees: { target: "base, solana, ethereum", facts: [["Base", "$0.0012"], ["Solana", "$0.00038"], ["Ethereum", "$0.21"]], state: "Base $0.0012, Solana $0.00038, Ethereum $0.21", metric: 0.21 },
  mentions: { target: "Lane Ceramics", facts: [["Hacker News", "Show HN: A glaze calculator"], ["Reddit", "Best stoneware for beginners? (r/Pottery)"], ["New today", "2"]], state: "2 new today", metric: 2 },
  email: { target: "lane-ceramics.com", facts: [["Listed", "0 of 11"], ["Mail server", "mx1.hostinger.com"], ["Lists", "11"]], state: "0 of 11 blacklists", metric: 0 },
  global: { target: "lane-ceramics.com", facts: [["North America", "909 ms from Buffalo"], ["Europe", "622 ms from Falkenstein"], ["Asia", "72 ms from Singapore"]], state: "N. America 909 ms, Europe 622 ms, Asia 72 ms", metric: 909 },
  downloads: { target: "mia/shop-app", facts: [["All time", "1,284"], ["Latest", "v0.8.0, 312"], ["This week", "96"]], state: "96 downloads this week", metric: 1284 },
}

/** An element's first run in the mock engine; Dev servers with no ports names what's listening. */
export function elementFirstRun(kind: ElementKind, at: number): Run {
  const r = RUNS[kind]
  return run(at, { facts: r.facts, state: r.state, ...(r.metric !== undefined ? { metric: r.metric } : {}) })
}
export const elementDraftError = (kind: ElementKind, target: string) =>
  kind === "ports" && !target.trim() ? { error: "Which ports? Listening now: 3000 (node), 4870 (node), 5173 (node), 5432 (postgres)." } : !cleanTarget(kind, target) ? { error: "That doesn’t look right for this one." } : null

const EVERY: Partial<Record<ElementKind, Every>> = { processes: "5m", ports: "5m", memory: "15m", fees: "15m", wallets: "15m", brew: "morning", macos: "morning", hogs: "morning", pagespeed: "morning", email: "morning", downloads: "morning" }

/** ?mock=watchelements: one watch of every element, Dev servers and Time Machine in trouble. */
export function elementsSample(T: number, HOUR: number) {
  const ago = 12 * 60_000
  return (Object.keys(RUNS) as ElementKind[]).map((kind) => {
    const r = RUNS[kind]
    const bad = kind === "ports" ? PORT_DOWN : kind === "timemachine" ? BACKUP_OLD : null
    const runs = Array.from({ length: 24 }, (_, i) => {
      const at = T - ago - (23 - i) * HOUR
      const last = i === 23
      if (bad && last) return run(at, { findings: [bad], facts: kind === "ports" ? [[":3000", "node"], [":4870", "node"], [":5173", "Stopped"]] : [["Last backup", "Oct 30, 9:40 am"]], state: kind === "ports" ? "2 of 3 listening" : "Last backup 3 days ago", metric: kind === "ports" ? 2 : 74 })
      return run(at, { facts: r.facts, state: r.state, ...(r.metric !== undefined ? { metric: r.metric } : {}) })
    })
    const open: OpenFinding[] = bad ? [{ ...bad, openedAt: T - ago, lastSeenAt: T - ago, notified: true }] : []
    return { kind, id: `e-${kind}`, target: r.target, every: EVERY[kind] ?? ("1h" as Every), runs, open }
  })
}
