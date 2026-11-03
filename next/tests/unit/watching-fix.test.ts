import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createEngine, type EngineDeps, githubOf } from "../../src/main/watching/engine"
import { watchNotice } from "../../src/main/watching/notify"
import { createStore } from "../../src/main/watching/store"
import { firstMessage, fixBrief, fixedLine, foldedLine, foldedPlan, repoBody, rowLine } from "../../src/shared/watching/copy"
import type { RepoAlert, Run } from "../../src/shared/watching/types"

// Security and repo watches through the engine, and the fix handoff: a run opens a finding and
// notifies, Fix asks for the folder once, the agent starts with a brief built from the evidence,
// Keep all re-checks a repo straight away, and only a run that shows it gone marks it fixed.

const T0 = new Date(2026, 9, 31, 7, 30, 0).getTime()

const AUDIT = (vulnerable: boolean) =>
  JSON.stringify({
    vulnerabilities: vulnerable
      ? {
          express: { name: "express", severity: "moderate", via: [{ title: "Express.js Open Redirect in malformed URLs", url: "https://github.com/advisories/GHSA-rv95-896h-c2vc", severity: "moderate", range: "<4.19.2" }], fixAvailable: { name: "express", version: "4.19.2" } },
        }
      : {},
    metadata: { dependencies: { total: 68 } },
  })

function setup() {
  const store = createStore(mkdtempSync(join(tmpdir(), "watching-fix-")))
  let now = T0
  let vulnerable = false
  let dmarc = "v=DMARC1; p=quarantine"
  const notices: string[][] = []
  const started: { brief: string; folder: string; title: string }[] = []
  const sent: string[] = []
  const deps: EngineDeps = {
    fetch: async () => new Response("", { status: 200, headers: { "strict-transport-security": "max-age=1", "content-security-policy": "frame-ancestors 'none'", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } }),
    now: () => now,
    sleep: async () => {},
    resolveTxt: async (h) => (h === "lane-ceramics.com" ? [["v=spf1 -all"]] : h === "_dmarc.lane-ceramics.com" ? [[dmarc]] : h === "google._domainkey.lane-ceramics.com" ? [["v=DKIM1; p=x"]] : []),
    resolves: async (h) => h !== "lane-ceramcs.com",
    connect: async (_h, p) => p === 80 || p === 443,
    tls: async () => ({ days: 74, version: "TLSv1.3", valid: true }),
    tlsOld: async () => false,
    exec: async (cmd, args) => {
      if (cmd === "npm") return { stdout: AUDIT(vulnerable), code: vulnerable ? 1 : 0 }
      if (cmd === "git" && args[0] === "remote") return { stdout: "", code: 2 }
      return { stdout: "", code: 1 }
    },
    exists: (p) => p.startsWith("/work/shop") && !p.endsWith("pnpm-lock.yaml") && !p.endsWith("yarn.lock"),
    online: () => true,
    notice: (_w, opened) => notices.push(opened.map((f) => f.key)),
    changed: () => {},
    fixer: async () => ({ agent: "Claude Code", answerer: { kind: "agent", agentId: "claude" } }),
    startFix: async (o) => {
      started.push({ brief: o.brief, folder: o.folder, title: o.title })
      return "agent-thread-1"
    },
    continueFix: async (_t, text) => {
      sent.push(text)
    },
  }
  const e = createEngine(store, deps)
  return {
    e,
    store,
    notices,
    started,
    sent,
    advance: (ms: number) => (now += ms),
    setVulnerable: (v: boolean) => (vulnerable = v),
    setDmarc: (v: string) => (dmarc = v),
  }
}

describe("security watch", () => {
  it("validates the domain, runs the four checks after Start, and a weak DMARC is a record fix", async () => {
    const { e, setDmarc, notices, advance } = setup()
    expect(await e.draft({ kind: "security", target: "lane-ceramcs.com" })).toEqual({ error: "lane-ceramcs.com doesn’t exist. Check the spelling." })
    setDmarc("v=DMARC1; p=none")
    const d = await e.draft({ kind: "security", target: "https://lane-ceramics.com/pricing" })
    if ("error" in d) throw new Error(d.error)
    expect(d.target).toBe("lane-ceramics.com")
    expect(d.name).toBe("lane-ceramics.com security")
    expect(d.plan).toBe("Every morning I’ll check lane-ceramics.com’s email records, certificate, TLS and headers, and open ports.")
    const v = e.create(d)
    expect(v.steps?.map((s) => s.label)).toEqual(["Email records", "Certificate", "TLS and headers", "Open ports"])
    await e.settled()
    const w = e.get(v.id)!
    expect(w.open.map((f) => f.key)).toEqual(["dmarc:none"])
    // The first run sets the baseline: a real problem, but no notification.
    expect(notices).toEqual([])
    expect(firstMessage("security", w.target, w.first!, w.every)).toBe("One thing to fix. Everything else looks right.")
    expect(w.line).toBe("Anyone can send email as lane-ceramics.com.")

    // Copy record: the next run that no longer sees it closes it as fixed, in one run.
    e.act(v.id, "dmarc:none", "copied")
    advance(60_000)
    await e.runOne(v.id)
    expect(e.get(v.id)!.open.map((f) => f.key)).toEqual(["dmarc:none"])
    setDmarc("v=DMARC1; p=quarantine; rua=mailto:dmarc@lane-ceramics.com")
    advance(60_000)
    const fixed = (await e.runOne(v.id))!
    expect(fixed.open).toEqual([])
    expect(fixed.past.map((f) => [f.key, f.how])).toEqual([["dmarc:none", "fixed"]])
    expect(fixedLine("security", fixed.target, ["dmarc:none"], fixed.latest)).toBe("Mail that fakes lane-ceramics.com now goes to spam.")
    expect(foldedLine(fixed.past[0]!, fixed.target, "fixed")).toBe("7:30 am. Anyone could send email as lane-ceramics.com.")
    expect(notices).toEqual([])
  })

  it("after Copy record it checks again every hour for a day", async () => {
    const { e, setDmarc, store, advance } = setup()
    setDmarc("v=DMARC1; p=none")
    const d = await e.draft({ kind: "security", target: "lane-ceramics.com" })
    if ("error" in d) throw new Error(d.error)
    const v = e.create(d)
    await e.settled()
    e.act(v.id, "dmarc:none", "copied")
    advance(61 * 60_000)
    await e.tick()
    expect(store.runs(v.id).length).toBe(2)
    advance(25 * 3_600_000)
    await e.tick()
    // A day later the hourly checks stop; the morning schedule takes over.
    const n = store.runs(v.id).length
    advance(61 * 60_000)
    await e.tick()
    expect(store.runs(v.id).length).toBeLessThanOrEqual(n + 1)
  })
})

describe("repo watch and the fix handoff", () => {
  it("a folder that isn't a git repo, and one that is", async () => {
    const { e } = setup()
    expect(await e.draft({ kind: "repo", target: "/nope" })).toEqual({ error: "That folder doesn’t exist." })
    const d = await e.draft({ kind: "repo", target: "/work/shop" })
    if ("error" in d) throw new Error(d.error)
    expect(d.name).toBe("shop")
    expect(d.plan).toBe("Every morning I’ll check shop for new security alerts, vulnerable packages and leaked keys.")
  })

  it("from a new alert to a notification, a fix in the watch's thread, Keep all, a re-check and fixed", async () => {
    const { e, notices, started, setVulnerable, advance } = setup()
    const d = await e.draft({ kind: "repo", target: "/work/shop" })
    if ("error" in d) throw new Error(d.error)
    const v = e.create(d)
    expect(v.steps?.map((s) => s.label)).toEqual(["Packages", "Leaked keys"])
    await e.settled()
    expect(firstMessage("repo", v.target, e.get(v.id)!.first!, "morning")).toBe("68 packages, none with known problems. No keys in the code.")

    setVulnerable(true)
    advance(24 * 3_600_000)
    await e.runOne(v.id)
    const w = e.get(v.id)!
    expect(w.open.map((f) => f.key)).toEqual(["alert:express"])
    expect(notices).toEqual([["alert:express"]])
    expect(w.line).toBe("express: Open redirect in malformed URLs.")

    // The folder is the target, so there's no folder question: the agent starts straight away.
    const f1 = (await e.fix(v.id, ["alert:express"]))!
    expect(f1.fixes).toMatchObject([{ keys: ["alert:express"], agent: "Claude Code", state: "working", threadId: "agent-thread-1", folder: "/work/shop" }])
    expect(started[0]?.title).toBe("A new security alert in shop")
    expect(started[0]?.brief).toContain("express: Open redirect in malformed URLs, moderate. Fixed in 4.19.2")
    expect(started[0]?.brief).toContain("Make the smallest change that fixes this. Don’t commit or deploy.")

    // The agent bumped the package; Keep all re-runs the folder checks straight away.
    setVulnerable(false)
    advance(60_000)
    const kept = (await e.fixDone(v.id, f1.fixes[0]!.at, "kept", 2))!
    expect(kept.fixes[0]).toMatchObject({ state: "kept", files: 2, result: "fixed" })
    expect(kept.open).toEqual([])
    expect(kept.past.map((f) => [f.key, f.how])).toEqual([["alert:express", "fixed"]])
    expect(fixedLine("repo", kept.target, ["alert:express"], kept.latest, 0)).toBe("No open alerts in shop.")
    expect(notices.length).toBe(1)
  })

  it("a kept fix that didn't fix it says so, and Try again goes to the same session", async () => {
    const { e, sent, setVulnerable, advance } = setup()
    const d = await e.draft({ kind: "repo", target: "/work/shop" })
    if ("error" in d) throw new Error(d.error)
    const v = e.create(d)
    await e.settled()
    setVulnerable(true)
    advance(3_600_000)
    await e.runOne(v.id)
    const f = (await e.fix(v.id, ["alert:express"]))!.fixes[0]!
    const still = (await e.fixDone(v.id, f.at, "kept", 1))!
    expect(still.fixes[0]?.result).toBe("still")
    expect(still.open.map((x) => x.key)).toEqual(["alert:express"])
    const again = (await e.fixAgain(v.id, f.at))!
    expect(again.fixes[0]).toMatchObject({ state: "working" })
    expect(again.fixes[0]?.result).toBeUndefined()
    expect(sent[0]).toMatch(/^That didn’t fix it\. A new security alert in shop\./)
  })

  it("a GitHub repo with no local clone asks which folder has the code, once", async () => {
    const { e, store, started } = setup()
    const w = { id: "r1", kind: "repo" as const, target: "mia/shop-web", name: "shop-web", every: "morning" as const, notify: "now" as const, createdAt: T0 }
    store.put(w)
    store.setState("r1", { open: [{ key: "alert:express", level: "problem", headline: "express: Open redirect", fix: "agent", openedAt: T0, lastSeenAt: T0, ev: { alert: { source: "package", name: "express", problem: "Open redirect" } } }], failedStreak: 0 })
    const asked = (await e.fix("r1", ["alert:express"]))!
    expect(asked.fixes).toMatchObject([{ state: "asking" }])
    expect(started).toEqual([])
    const going = (await e.fix("r1", ["alert:express"], "/work/shop"))!
    expect(going.fixes.length).toBe(1)
    expect(going.fixes[0]).toMatchObject({ state: "working", folder: "/work/shop" })
    expect(going.folder).toBe("/work/shop")
    // Undo all: the problem card comes back.
    const undone = (await e.fixDone("r1", going.fixes[0]!.at, "undone"))!
    expect(undone.fixes[0]?.state).toBe("undone")
    expect(undone.open.length).toBe(1)
  })
})

describe("security and repo copy", () => {
  const pk = (name: string, fixedIn?: string): RepoAlert => ({ source: "package", name, problem: "x", ...(fixedIn ? { fixedIn } : {}) })
  it("repo card bodies", () => {
    expect(repoBody([pk("a", "1"), pk("b", "2")])).toBe("Both are in packages with a fixed version out.")
    expect(repoBody([pk("a", "1")])).toBe("It’s in a package with a fixed version out.")
    expect(repoBody([pk("a")])).toBe("No fixed version yet. I’ll tell you when there is one.")
    expect(repoBody([{ source: "key", name: "config/dev.env", file: "config/dev.env", problem: "Looks like a Stripe secret", committedAt: new Date(2026, 9, 30).getTime() }])).toBe(
      "A key that looks like a Stripe secret is in config/dev.env, committed Oct 30.",
    )
  })
  it("row lines, the folded plan, notices and the brief", () => {
    const run = (n: number): Run => ({ at: T0, ms: 1, status: "problem", findings: Array.from({ length: n }, (_, i) => ({ key: `alert:${i}`, level: "problem" as const, headline: `p${i}: x`, line: `p${i}: x.`, fix: "agent" as const })) })
    expect(rowLine("repo", run(2))).toBe("2 new security alerts.")
    expect(foldedPlan("morning", "now")).toBe("Watching. Every morning at 7:30, tells you right away.")
    const opened = run(2).findings.map((f) => ({ ...f, openedAt: T0, lastSeenAt: T0 }))
    expect(watchNotice({ id: "r", name: "shop-web", kind: "repo" }, opened, "Fix with Claude Code")).toMatchObject({ title: "shop-web", body: "2 new security alerts.", actions: [{ id: "fix", text: "Fix with Claude Code" }, { id: "snooze1h" }] })
    expect(fixBrief({ kind: "security", target: "a.com", name: "a.com security" }, [{ key: "header:hsts", level: "problem", headline: "a.com sends no HSTS header", detail: "Without it…", fix: "agent" }])).toBe(
      "a.com sends no HSTS header.\nWithout it…\nSite: a.com\n\nMake the smallest change that fixes this. Don’t commit or deploy.",
    )
    expect(githubOf("git@github.com:mia/shop-web.git")).toBe("mia/shop-web")
    expect(githubOf("https://github.com/mia/shop-web")).toBe("mia/shop-web")
  })
})
