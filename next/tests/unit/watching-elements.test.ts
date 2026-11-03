import { describe, expect, it } from "vitest"

import { firstMessage, nameFor, planSentence, rowLine, sentence } from "@shared/watching/copy"
import { CATALOGUE, chainOf, cleanElementTarget, cleanFolders, cleanPorts, cleanRepo, NO_INPUT } from "@shared/watching/elements"
import { parseRead } from "@shared/watching/read"
import { cleanTarget } from "@shared/watching/target"
import { ELEMENT_KINDS, type Run } from "@shared/watching/types"

import type { CheckDeps, ExecResult } from "../../src/main/watching/checks/deps"
import {
  awakeApps,
  backupTime,
  checkDocker,
  checkMemory,
  checkPorts,
  checkProcesses,
  checkTimeMachine,
  dockerDisk,
  downloadMbps,
  freePercent,
  hogs,
  parseBattery,
  parseBrew,
  parseContainers,
  parseDu,
  parseGitStatus,
  parseListeners,
  parsePs,
  parseUpdates,
  parseWifi,
  pressureOf,
  sizeGb,
  vpnsOf,
} from "../../src/main/watching/checks/mac"
import { balanceCall, checkEmail, checkMentions, checkWallets, evmFee, listing, payments, rate, releaseTotal, reverse, solanaFee, units6, usd, weekly } from "../../src/main/watching/checks/web-elements"

// Parsers on real output captured on a Mac (2026-11-02), and each element's decisions on fakes.

const MIN = 60_000
const fake = (o: Partial<CheckDeps> & { out?: Record<string, ExecResult> } = {}): CheckDeps => {
  let now = 1_800_000_000_000
  return {
    fetch: async () => new Response("{}"),
    now: () => now,
    sleep: async (ms) => void (now += ms),
    resolveTxt: async () => [],
    connect: async () => false,
    tls: async () => ({ days: null, version: null }),
    exec: async (cmd, args) => o.out?.[[cmd.split("/").pop(), ...args].join(" ")] ?? { stdout: "", code: 1 },
    exists: () => true,
    ...o,
  }
}

describe("This Mac parsers", () => {
  it("ps adds helpers up by name, busiest first", () => {
    const p = parsePs(" 38.0 2202009 Safari\n 12.5 1468006 Code Helper\n  6.0 838860 Code Helper\n  0.0  1024 launchd\n")
    expect(p[0]).toMatchObject({ name: "Safari", cpu: 38 })
    expect(p[1]!.name).toBe("Code Helper")
    expect(p[1]!.cpu).toBeCloseTo(18.5)
    expect(p[0]!.memGb).toBeCloseTo(2.1, 1)
  })
  it("a hog is an app over the line for 10 minutes, and the clock starts again when it drops", () => {
    const t0 = 1_000_000
    const a = hogs(parsePs(" 95.0 100 node\n"), {}, t0, 80)
    expect(a.hogs).toEqual([])
    expect(a.since).toEqual({ node: t0 })
    expect(hogs(parsePs(" 95.0 100 node\n"), a.since, t0 + 9 * MIN, 80).hogs).toEqual([])
    expect(hogs(parsePs(" 95.0 100 node\n"), a.since, t0 + 10 * MIN, 80).hogs[0]).toMatchObject({ name: "node", forMs: 10 * MIN })
    expect(hogs(parsePs(" 20.0 100 node\n"), a.since, t0 + 11 * MIN, 80).since).toEqual({})
  })
  it("memory pressure levels and free percentage", () => {
    expect(pressureOf("1\n")).toBe("Green")
    expect(pressureOf("2")).toBe("Yellow")
    expect(pressureOf("4")).toBe("Red")
    expect(pressureOf("")).toBeNull()
    expect(freePercent("The system has 17179869184 (4194304 pages with a page size of 4096).\nSystem-wide memory free percentage: 56%")).toBe(56)
  })
  it("battery from ioreg and pmset, health as System Settings shows it", () => {
    const io = `  |   "MaxCapacity" = 100\n  |   "CycleCount" = 217\n  |   "NominalChargeCapacity" = 7196\n  |   "DesignCapacity" = 8694\n`
    const charged = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=23461987)\t100%; charged; 0:00 remaining present: true"
    expect(parseBattery(io, charged)).toEqual({ percent: 100, charging: true, left: null, cycles: 217, health: 83 })
    const onBattery = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t64%; discharging; 4:10 remaining present: true"
    expect(parseBattery(io, onBattery)).toMatchObject({ percent: 64, charging: false, left: "4h 10m" })
    expect(parseBattery("", "Now drawing from 'AC Power'\n")).toBeNull()
  })
  it("what keeps the Mac awake, without macOS's own", () => {
    const out = `   pid 38728(Electron): [0x1] 00:24:09 NoIdleSleepAssertion named: "Electron"\n   pid 708(sharingd): [0x2] 00:11:16 PreventUserIdleSystemSleep named: "Handoff"\n   pid 414(WindowServer): [0x3] 00:00:57 UserIsActive named: "tickle"\n   pid 900(caffeinate): [0x4] 01:00:00 PreventUserIdleSystemSleep named: "caffeinate"`
    expect(awakeApps(out)).toEqual(["Electron", "caffeinate"])
  })
  it("listening ports from lsof -F, first program per port", () => {
    expect(parseListeners("p100\ncnode\nn[::1]:5173\nn127.0.0.1:5173\np200\ncpostgres\nn*:5432\n")).toEqual([
      { port: 5173, command: "node" },
      { port: 5432, command: "postgres" },
    ])
  })
  it("docker containers and disk use", () => {
    const ps = `{"Names":"web","State":"running","Status":"Up 2 hours","Image":"shop-web"}\n{"Names":"db","State":"exited","Status":"Exited (137) 3 minutes ago","Image":"postgres"}`
    expect(parseContainers(ps).map((c) => c.state)).toEqual(["running", "exited"])
    expect(sizeGb("32.29GB")).toBeCloseTo(32.29)
    expect(sizeGb("3.023MB")).toBeCloseTo(0.003)
    expect(sizeGb("0B")).toBe(0)
    const df = `{"Type":"Images","Size":"32.29GB","Reclaimable":"5.834GB (18%)"}\n{"Type":"Build Cache","Size":"11.31GB","Reclaimable":"7.728GB"}`
    const t = dockerDisk(df)
    expect(t.size).toBeCloseTo(43.6)
    expect(t.reclaim).toBeCloseTo(13.562)
  })
  it("git status: branch, upstream, ahead, behind, changed files", () => {
    expect(parseGitStatus("/r", "## change-reading-to-thinking...origin/change-reading-to-thinking [ahead 31]\n M next/BUILD.md\n?? new.ts\n")).toEqual({
      repo: "/r",
      branch: "change-reading-to-thinking",
      upstream: "origin/change-reading-to-thinking",
      ahead: 31,
      behind: 0,
      dirty: 2,
    })
    expect(parseGitStatus("/r", "## master...origin/master [behind 2]\n")).toMatchObject({ behind: 2, dirty: 0 })
    expect(parseGitStatus("/r", "## main\n")).toEqual({ repo: "/r", branch: "main", dirty: 0, ahead: 0, behind: 0 })
  })
  it("brew outdated JSON, formulae and casks", () => {
    const j = JSON.stringify({ formulae: [{ name: "aom", installed_versions: ["3.15.1"], current_version: "3.15.2" }], casks: [{ name: "docker", installed_versions: ["4.30"], current_version: "4.31" }] })
    expect(parseBrew(j)).toEqual([
      { name: "aom", from: "3.15.1", to: "3.15.2" },
      { name: "docker", from: "4.30", to: "4.31" },
    ])
    expect(parseBrew("Error: not json")).toBeNull()
    expect(parseBrew(`${j}\n==> Auto-updated Homebrew!\nUpdated 2 taps (homebrew/core, homebrew/cask).`)).toHaveLength(2)
  })
  it("softwareupdate -l", () => {
    const out = "Software Update Tool\n\nFinding available software\nSoftware Update found the following new or updated software:\n* Label: macOS Tahoe 26.1-25B78\n\tTitle: macOS Tahoe 26.1, Version: 26.1, Size: 7340032KiB, Recommended: YES, Action: restart, \n* Label: Safari26.1\n\tTitle: Safari, Version: 26.1, Size: 204800KiB, Recommended: YES, \n"
    expect(parseUpdates(out)).toEqual([
      { label: "macOS Tahoe 26.1-25B78", title: "macOS Tahoe 26.1", size: "7 GB", restart: true },
      { label: "Safari26.1", title: "Safari 26.1", size: "200 MB", restart: false },
    ])
    expect(parseUpdates("Software Update Tool\n\nFinding available software\nNo new software available.\n")).toEqual([])
  })
  it("Time Machine's latest backup path gives its time", () => {
    expect(backupTime("/Volumes/.timemachine/ABC/2026-11-01-083012.backup/2026-11-01-083012.backup\n")).toBe(new Date(2026, 10, 1, 8, 30, 12).getTime())
    expect(backupTime("Failed to mount backup destination, error: Error Domain=com.apple.backupd.ErrorDomain Code=17")).toBeNull()
  })
  it("du, Wi-Fi, VPN and the speed test", () => {
    expect(parseDu("1048576\t/Users/mia/Work\n524288\t/Users/mia/.npm\n")).toEqual([
      { path: "/Users/mia/Work", gb: 1 },
      { path: "/Users/mia/.npm", gb: 0.5 },
    ])
    const wifi = JSON.stringify({ SPAirPortDataType: [{ spairport_airport_interfaces: [{ _name: "en0", spairport_current_network_information: { _name: "<redacted>", spairport_network_rate: 648, spairport_network_phymode: "802.11ax", spairport_signal_noise: "-65 dBm / -94 dBm" } }] }] })
    expect(parseWifi(wifi)).toEqual({ signal: -65, noise: -94, rate: 648, phy: "802.11ax" })
    expect(parseWifi(JSON.stringify({ SPAirPortDataType: [{ spairport_airport_interfaces: [{ _name: "en0" }] }] }))).toBeNull()
    const nc = `* (Disconnected)   F877 VPN (ch.protonvpn.mac) "ProtonVPN"   [VPN:ch.protonvpn.mac]\n* (Connected)      36DE VPN (io.tailscale.ipn.macsys) "Tailscale"   [VPN:io.tailscale]`
    expect(vpnsOf(nc)).toEqual(["Tailscale"])
    expect(downloadMbps('{"dl_throughput":482113024,"ul_throughput":40000000}')).toBe(482)
    expect(downloadMbps("")).toBeNull()
  })
})

describe("This Mac decisions", () => {
  it("processes: no problem at first, a hog after 10 minutes over the line", async () => {
    let now = 1_000_000
    const d = { ...fake({ out: { "ps -Aceo pcpu=,rss=,comm=": { stdout: " 97.0 1048576 ffmpeg\n  3.0 1024 Finder\n", code: 0 } } }), now: () => now }
    const a = await checkProcesses(d, {})
    expect(a.run.status).toBe("quiet")
    expect(a.run.facts?.[0]).toEqual(["ffmpeg", "97% CPU, 1 GB"])
    now += 10 * MIN
    const b = await checkProcesses(d, {}, a.memo)
    expect(b.run.findings[0]?.headline).toBe("ffmpeg has used 97% CPU for 10 minutes")
  })
  it("memory: red is a problem, green is the row's words", async () => {
    const out = (lvl: string) => ({ "sysctl -n kern.memorystatus_vm_pressure_level": { stdout: lvl, code: 0 }, "memory_pressure -Q": { stdout: "System-wide memory free percentage: 44%", code: 0 } })
    expect((await checkMemory(fake({ out: out("1") }))).state).toBe("Green, 56% used")
    expect((await checkMemory(fake({ out: out("4") }))).findings[0]?.headline).toBe("Memory pressure is red")
  })
  it("dev servers: a picked port that stops is a problem", async () => {
    const d = fake({ out: { "lsof -nP -iTCP -sTCP:LISTEN -Fcn": { stdout: "p1\ncnode\nn*:3000\n", code: 0 } } })
    const r = await checkPorts("3000, 5173", d)
    expect(r.findings.map((f) => f.headline)).toEqual(["Nothing is listening on :5173"])
    expect(r.state).toBe("1 of 2 listening")
  })
  it("docker: a container seen running stays a problem while it's stopped", async () => {
    const ps = (db: string) => ({ stdout: `{"Names":"web","State":"running","Status":"Up","Image":"w"}\n{"Names":"db","State":"${db}","Status":"Exited (1)","Image":"p"}`, code: 0 })
    let state = "running"
    const d = fake({ run: async (_c, args) => (args[0] === "ps" ? ps(state) : { stdout: "", code: 0 }) })
    const a = await checkDocker(d)
    expect(a.run.findings).toEqual([])
    state = "exited"
    const b = await checkDocker(d, a.memo)
    expect(b.run.findings[0]?.headline).toBe("db stopped")
    const c = await checkDocker(d, b.memo)
    expect(c.run.findings[0]?.key).toBe("stopped:db")
    expect((await checkDocker(fake({ run: async () => ({ stdout: "", code: 1, missing: true }) }))).run.error).toBe("Docker isn’t installed on this Mac")
    expect((await checkDocker(fake({ run: async () => ({ stdout: "Cannot connect to the Docker daemon", code: 1 }) }))).run.error).toBe("Docker isn’t running")
  })
  it("time machine: no disk is said plainly; an old backup is a problem", async () => {
    expect((await checkTimeMachine(fake({ out: { "tmutil destinationinfo": { stdout: "tmutil: No destinations configured.", code: 0 } } }), {})).error).toBe("Time Machine has no backup disk set up")
    const d = fake({ out: { "tmutil destinationinfo": { stdout: "Name : Backup", code: 0 }, "tmutil latestbackup": { stdout: "/Volumes/x/2027-01-14-090000.backup", code: 0 } } })
    const at = new Date(2027, 0, 15, 15, 0).getTime()
    const r = await checkTimeMachine({ ...d, now: () => at }, {})
    expect(r.findings[0]?.headline).toBe("The last backup was 30 h ago")
  })
})

describe("web decisions", () => {
  it("wallet maths: balanceOf call, 6 decimals, payments in", () => {
    expect(balanceCall("0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE")).toBe("0x70a082310000000000000000000000003f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be")
    expect(units6("0x0000000000000000000000000000000000000000000000000000000001312d00")).toBe(20)
    expect(units6("0x")).toBe(0)
    const h = [{ address: "0xa", chain: "base" as const, token: "USDC" as const, amount: 45 }]
    expect(payments(h, { "0xa:base:USDC": 20 })[0]?.got).toBe(25)
    expect(payments(h, {})).toEqual([])
    expect(payments(h, { "0xa:base:USDC": 50 })).toEqual([])
  })
  it("wallets: a payment between runs is news; a node that fails is a failed run", async () => {
    let bal = "0x1312d00"
    const d = fake({ fetch: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: bal })) })
    const a = await checkWallets("0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE", d)
    expect(a.run.findings).toEqual([])
    bal = "0x2625a00"
    const b = await checkWallets("0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE", d, a.memo)
    expect(b.run.findings.map((f) => f.headline)).toContain("Got 20.00 USDC on Base")
    expect((await checkWallets("0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE", fake({ fetch: async () => new Response("", { status: 503 }) }))).run.status).toBe("failed")
  })
  it("fees in dollars", () => {
    expect(evmFee("0x3b9aca00", 3000)).toBeCloseTo(0.195) // 1 gwei × 65,000 gas × $3,000
    expect(solanaFee([{ prioritizationFee: 0 }, { prioritizationFee: 1000 }, { prioritizationFee: 5000 }], 150)).toBeCloseTo(0.00078)
    expect(usd(0.195)).toBe("$0.20")
    expect(usd(0.0007)).toBe("$0.00070")
  })
  it("mentions: the first run only remembers; new posts after are news", async () => {
    let hits = [{ objectID: "1", title: "Show HN: Lane Ceramics", created_at_i: 1_799_990_000 }]
    const d = fake({ fetch: async (u) => (String(u).includes("algolia") ? new Response(JSON.stringify({ hits })) : new Response("", { status: 403 })) })
    const a = await checkMentions("Lane Ceramics", d)
    expect(a.run.findings).toEqual([])
    hits = [{ objectID: "2", title: "Lane Ceramics raises prices", created_at_i: 1_799_999_000 }, ...hits]
    const b = await checkMentions("Lane Ceramics", d, a.memo)
    expect(b.run.findings.map((f) => f.headline)).toEqual(["New on Hacker News: “Lane Ceramics raises prices”"])
    expect(b.run.facts?.find(([x]) => x === "Reddit")?.[1]).toBe("Couldn’t ask: Reddit refused; it blocks most apps without an account")
    const feed = `<feed><entry><id>t3_1abc</id><title>Lane Ceramics &amp; friends</title><link href="https://www.reddit.com/r/Pottery/comments/1abc/x/"/><updated>2026-11-02T08:00:00+00:00</updated></entry></feed>`
    const rd = fake({ fetch: async (u) => (String(u).includes("algolia") ? new Response(JSON.stringify({ hits: [] })) : new Response(feed)) })
    const c = await checkMentions("Lane Ceramics", rd)
    expect(c.run.facts?.find(([x]) => x === "Reddit")?.[1]).toBe("Lane Ceramics & friends")
  })
  it("blacklists: listed, clean, and Spamhaus refusing a public resolver", async () => {
    expect(listing([])).toBe("clean")
    expect(listing(["127.0.0.2"])).toBe("listed")
    expect(listing(["127.255.255.254"])).toBe("refused")
    expect(reverse("1.2.3.4")).toBe("4.3.2.1")
    const d = fake({ resolveMx: async () => ["mx.lane-ceramics.test"], records: async (h) => (h === "mx.lane-ceramics.test" ? ["127.0.0.2"] : h.endsWith(".zen.spamhaus.org") ? ["127.255.255.254"] : h.startsWith("2.0.0.127.bl.spamcop") ? ["127.0.0.2"] : []) })
    const r = await checkEmail("lane-ceramics.test", d)
    expect(r.findings.map((f) => f.key)).toEqual(["listed:bl.spamcop.net:127.0.0.2"])
    expect(r.facts?.find(([a]) => a === "Couldn’t ask")?.[1]).toBe("zen.spamhaus.org")
  })
  it("page vitals ratings, release totals and the weekly count", () => {
    expect(rate(1800, 0.04)).toBe("Good")
    expect(rate(3000, 0.04)).toBe("Needs work")
    expect(rate(4200, 0.04)).toBe("Poor")
    expect(rate(null, 0)).toBe("Unknown")
    expect(releaseTotal([{ tag_name: "v1", published_at: "", draft: false, assets: [{ name: "a", download_count: 3 }, { name: "b", download_count: 4 }] }])).toBe(7)
    const day = 86_400_000
    expect(weekly([[0, 100]], 0)).toBeNull()
    expect(weekly([[0, 100], [3 * day, 150], [8 * day, 300]], 8 * day)).toEqual({ n: 200, since: 0 })
  })
})

describe("targets and words", () => {
  it("cleans each element's target", () => {
    expect(cleanPorts("3000, :5173 and 3000")).toBe("3000, 5173")
    expect(cleanPorts("my server")).toBeNull()
    expect(cleanFolders("", "/Users/mia")).toBe("~")
    expect(cleanFolders("~/Work, /Users/mia/Library/Caches", "/Users/mia")).toBe("~/Work, ~/Library/Caches")
    expect(cleanRepo("https://github.com/electron/electron")).toBe("electron/electron")
    expect(chainOf("0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE")).toBe("evm")
    expect(chainOf("TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL")).toBe("tron")
    expect(chainOf("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe("solana")
    expect(cleanElementTarget("wallets", "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE, not-an-address")).toBeNull()
    expect(cleanElementTarget("email", "hello@Lane-Ceramics.com")).toBe("lane-ceramics.com")
    expect(cleanElementTarget("global", "https://www.lane-ceramics.com/shop")).toBe("lane-ceramics.com")
    expect(cleanTarget("gitrepos", "")).toBe("~/Work")
    expect(cleanTarget("gitrepos", "~/Documents/code")).toBeNull()
    for (const k of NO_INPUT) expect(cleanTarget(k, "")).toBeTruthy()
  })
  it("every element has words, and the catalogue has 19", () => {
    expect(CATALOGUE).toHaveLength(19)
    expect(CATALOGUE.filter((c) => c.group === "mac")).toHaveLength(11)
    const first: Run = { at: 0, ms: 0, status: "quiet", findings: [], state: "Green, 56% used" }
    for (const k of ELEMENT_KINDS) {
      const t = cleanTarget(k, k === "ports" ? "3000" : k === "wallets" ? "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE" : k === "downloads" ? "mia/shop-app" : k === "mentions" ? "Lane Ceramics" : k === "gitrepos" || k === "hogs" ? "~/Work" : "lane-ceramics.com")!
      expect(t, k).toBeTruthy()
      for (const s of [sentence(k, t), nameFor(k, t), planSentence(k, t, "1h", "now", { first }), firstMessage(k, t, first, "1h"), rowLine(k, first)]) {
        expect(s, k).toBeTruthy()
        expect(s, k).not.toMatch(/ · |undefined|NaN/)
      }
    }
    expect(rowLine("memory", first)).toBe("Green, 56% used.")
  })
  it("the model may answer with an element kind", () => {
    expect(parseRead('{"kind":"timemachine","target":null}')).toEqual({ kind: "timemachine" })
    expect(parseRead('{"kind":"ports","target":"3000"}')).toEqual({ kind: "ports", target: "3000" })
  })
})
