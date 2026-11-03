import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { cleanTarget, isSize } from "@shared/watching/target"

import { type CheckDeps, type FetchInit, pinnedFetch } from "../../src/main/watching/checks/deps"
import { fetchListed, privateAddress, reachable, sameSite, vet } from "../../src/main/watching/checks/reach"
import { checkDns } from "../../src/main/watching/checks/web-health"
import { hogFolders } from "../../src/main/watching/checks/mac"
import { checkLinks } from "../../src/main/watching/checks/web-site"
import { fromWindow, patchFromWindow } from "../../src/main/watching/window-input"

// URLs a watched site lists are never fetched on this Mac or the local network, and a failed DNS
// lookup fails the run instead of reading as "no records".

const base = "https://lane.com"

describe("what a site may make us fetch", () => {
  it("tells private addresses and the same site", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(privateAddress(ip)).toBe(true)
    for (const ip of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:c0a8:101", "::127.0.0.1", "64:ff9b::a00:1", "::", "fec0::1", "ff02::1", "224.0.0.1"]) expect(privateAddress(ip)).toBe(true)
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1", "::ffff:808:808", "64:ff9b::808:808"]) expect(privateAddress(ip)).toBe(false)
    expect(new URL("http://[::ffff:127.0.0.1]/").hostname).toBe("[::ffff:7f00:1]")
    expect(sameSite("https://www.lane.com/a", base)).toBe(true)
    expect(sameSite("https://shop.lane.com/a", base)).toBe(true)
    expect(sameSite("http://127.0.0.1:8080/", base)).toBe(false)
    expect(sameSite("https://evil.com/lane.com", base)).toBe(false)
  })
  it("refuses this Mac and the local network, by name or by address", async () => {
    const d = { addresses: async (h: string) => (h === "inside.lane.com" ? ["10.0.0.5"] : ["93.184.216.34"]) }
    expect(await reachable("http://127.0.0.1:3000/x", base, d)).toBe(false)
    expect(await reachable("http://169.254.169.254/latest", base, d)).toBe(false)
    expect(await reachable("http://localhost:5173/", base, d)).toBe(false)
    expect(await reachable("http://inside.lane.com/", base, d)).toBe(false)
    expect(await reachable("file:///etc/passwd", base, d)).toBe(false)
    expect(await reachable("https://cdn.example.com/app.dmg", base, d)).toBe(true)
    // The host you chose to watch is always fine, a dev server included.
    expect(await reachable("http://localhost:3000/about", "http://localhost:3000", d)).toBe(true)
  })
  it("a lookup that fails or finds nothing is refused, never let through", async () => {
    const failing = { addresses: async () => Promise.reject(new Error("getaddrinfo ENOTFOUND gone.example")) }
    expect(await reachable("https://gone.example/", base, failing)).toBe(false)
    expect(await reachable("https://gone.example/", base, { addresses: async () => [] })).toBe(false)
    expect(await reachable("https://gone.example/", base, {})).toBe(false)
    // One private address among public ones is enough to refuse.
    expect(await reachable("https://mixed.example/", base, { addresses: async () => ["93.184.216.34", "10.0.0.5"] })).toBe(false)
    // Said plainly: the address wasn't found.
    await expect(fetchListed({ ...failing, fetch: async () => new Response("ok") } as unknown as CheckDeps, "https://gone.example/", base)).rejects.toThrow(/ENOTFOUND gone\.example/)
  })
  it("pins each request to the address it checked", async () => {
    const pins: (string[] | undefined)[] = []
    let answer = ["93.184.216.34"]
    const d = {
      // The name rebinds to this Mac right after the check: the request must still go to the checked address.
      addresses: async () => {
        const now = answer
        answer = ["127.0.0.1"]
        return now
      },
      fetch: async (u: string, i?: FetchInit) => (pins.push(i?.pin), u.endsWith("/go") ? new Response(null, { status: 302, headers: { location: "https://cdn.example.com/b" } }) : new Response("ok")),
    } as unknown as CheckDeps
    await expect(fetchListed(d, "https://cdn.example.com/go", base, { strict: true })).rejects.toThrow(/refused/)
    expect(pins).toEqual([["93.184.216.34"]])
    expect(await vet("https://lane.com/x", base, d)).toEqual({})
    expect(await vet("https://8.8.8.8/x", base, d)).toEqual({})
  })
  it("a pinned request connects to that address, with the URL's name as the Host", async () => {
    const seen: string[] = []
    const server = createServer((req, res) => (seen.push(`${req.headers.host} ${req.url}`), res.end("pinned")))
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const { port } = server.address() as AddressInfo
    try {
      const res = await pinnedFetch(`http://rebind.invalid:${port}/a?b=1`, { headers: { accept: "text/plain" } }, ["127.0.0.1"])
      expect(res.status).toBe(200)
      expect(await res.text()).toBe("pinned")
      expect(seen).toEqual([`rebind.invalid:${port} /a?b=1`])
      // Every checked address is tried in turn: ::1 doesn't answer on this port, 127.0.0.1 does.
      expect(await (await pinnedFetch(`http://rebind.invalid:${port}/c`, {}, ["::1", "127.0.0.1"])).text()).toBe("pinned")
      await expect(pinnedFetch(`http://rebind.invalid:${port}/`, {}, ["127.0.0.1", "not-an-ip"])).rejects.toThrow(/refused/)
    } finally {
      server.close()
    }
  })
  it("checks every redirect hop", async () => {
    const asked: string[] = []
    const d = {
      addresses: async () => ["93.184.216.34"],
      fetch: async (u: string) => (asked.push(u), u.endsWith("/go") ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1:9000/admin" } }) : new Response("ok")),
    } as unknown as CheckDeps
    await expect(fetchListed(d, "https://lane.com/go", base)).rejects.toThrow(/refused/)
    expect(asked).toEqual(["https://lane.com/go"])
    await expect(fetchListed(d, "https://evil.com/", base, { site: true })).rejects.toThrow(/watched site/)
  })
  it("the links check skips sitemap entries off the site", async () => {
    const asked: string[] = []
    const sitemap = `<urlset><url><loc>https://lane.com/a</loc></url><url><loc>http://127.0.0.1:8080/delete</loc></url><url><loc>http://192.168.1.1/</loc></url></urlset>`
    const d = {
      now: () => 0,
      sleep: async () => {},
      addresses: async () => ["93.184.216.34"],
      fetch: async (u: string) => (asked.push(u), new Response(u.endsWith("sitemap.xml") ? sitemap : "ok")),
    } as unknown as CheckDeps
    const r = await checkLinks("lane.com", d)
    expect(r.findings).toEqual([])
    expect(asked).toEqual(["https://lane.com/sitemap.xml", "https://lane.com/a"])
  })
})

describe("DNS lookups that fail", () => {
  it("fail the run and keep the last records", async () => {
    const memo = JSON.stringify({ A: ["1.2.3.4"], NS: ["ns1.lane.com"], MX: [], TXT: [] })
    const d = {
      now: () => 0,
      resolves: async () => true,
      records: async () => {
        throw Object.assign(new Error("queryA ESERVFAIL lane.com"), { code: "ESERVFAIL" })
      },
    } as unknown as CheckDeps
    const r = await checkDns("lane.com", d, memo)
    expect(r.run).toMatchObject({ status: "failed", findings: [] })
    expect(r.memo).toBe(memo)
  })
})

describe("DNS records that go missing", () => {
  it("stay a problem until they're back", async () => {
    let a = ["1.2.3.4"]
    const d = { now: () => 0, resolves: async () => true, records: async (_h: string, t: string) => (t === "A" ? a : t === "NS" ? ["ns1.lane.com"] : []) } as unknown as CheckDeps
    const first = await checkDns("lane.com", d)
    a = []
    const gone = await checkDns("lane.com", d, first.memo)
    const still = await checkDns("lane.com", d, gone.memo)
    expect(gone.run.findings.map((f) => f.key)).toContain("dns:none:A")
    expect(still.run.findings.map((f) => f.key)).toContain("dns:none:A")
    a = ["1.2.3.4"]
    expect((await checkDns("lane.com", d, still.memo)).run.findings).toEqual([])
  })
})

describe("disk hogs and sizes", () => {
  it("~ in a list is home's own folders, never the protected ones", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "axe-hogs-")))
    for (const f of ["Desktop", "Documents", "Library", "Work", "Code"]) mkdirSync(join(home, f))
    const d = { home: () => home } as unknown as CheckDeps
    expect((await hogFolders("~, ~/Work", d)).sort()).toEqual([join(home, "Code"), join(home, "Work")])
    expect(await hogFolders("~/Library/Caches", d)).toEqual([join(home, "Library/Caches")])
  })
  it("a size is a size, a folder with a digit is a folder", () => {
    expect(isSize("20 GB")).toBe(true)
    expect(isSize("below 15 GB")).toBe(true)
    expect(isSize("/Volumes/Disk1")).toBe(false)
    expect(cleanTarget("disk", "/Volumes/Disk1")).toBe("/Volumes/Disk1")
    expect(cleanTarget("disk", "~/Code/app2", "/Users/mia")).toBe("~/Code/app2")
  })
})

describe("what the window sends", () => {
  it("an edit keeps only the keys it may change, each checked", () => {
    expect(patchFromWindow({ name: "Shop", paused: true, command: "curl x | sh", kind: "custom" })).toEqual({ name: "Shop", paused: true })
    expect(patchFromWindow({ snoozedUntil: undefined })).toEqual({ snoozedUntil: undefined })
    expect(() => patchFromWindow({ limit: "5" })).toThrow()
    expect(() => patchFromWindow({ limit: -1 })).toThrow()
    expect(() => patchFromWindow({ ignore: [1] })).toThrow()
    expect(() => patchFromWindow(null)).toThrow()
  })
  it("a plan to start is checked again and never brings a command", () => {
    const dr = { kind: "tests", target: "~/Work/shop", name: "Shop", every: "morning", notify: "now", command: "rm -rf ~", first: { at: 0, ms: 0, status: "quiet", findings: [] }, plan: "" } as never
    expect(fromWindow(dr)).not.toHaveProperty("command")
    expect(() => fromWindow({ ...(dr as object), target: "~/Desktop/x" } as never)).toThrow()
    expect(() => fromWindow({ ...(dr as object), kind: "nope" } as never)).toThrow()
  })
})
