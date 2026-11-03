import { describe, expect, it } from "vitest"

import type { CheckDeps } from "../../src/main/watching/checks/deps"
import { checkPage } from "../../src/main/watching/checks/page"
import { checkPrice } from "../../src/main/watching/checks/price"
import { checkRepo } from "../../src/main/watching/checks/repo"
import { checkSecurity } from "../../src/main/watching/checks/security"

// Plain checks with fake deps: no network, no gh, no npm.

const res = (body: string, status = 200, headers: Record<string, string> = {}, statusText = "") => new Response(body, { status, statusText, headers })

const fake = (d: Partial<CheckDeps> = {}): CheckDeps => ({
  fetch: async () => res("<p>Hello</p>"),
  now: () => 1000,
  sleep: async () => {},
  resolveTxt: async () => [],
  connect: async () => false,
  tls: async () => ({ days: null, version: null }),
  exec: async () => ({ stdout: "", code: 0 }),
  exists: () => true,
  ...d,
})

describe("page", () => {
  it("first run is quiet and saves the text", async () => {
    const { run, text } = await checkPage("a.com/p", undefined, fake({ fetch: async () => res("<title>Shop</title><p>Hello there</p>") }))
    expect(run.status).toBe("quiet")
    expect(run.facts).toEqual([
      ["Words", "2"],
      ["Title", "Shop"],
      ["Last changed", "Unknown"],
    ])
    expect(text).toBe("Hello there")
  })
  it("same text is quiet", async () => {
    const { run } = await checkPage("a.com/p", "Hello", fake())
    expect(run.status).toBe("quiet")
    expect(run.findings).toEqual([])
  })
  it("changed text is news with the line diff", async () => {
    const { run, text } = await checkPage("a.com/p", "Hello\nOld price 5", fake({ fetch: async () => res("<p>Hello</p><p>New price 6</p>") }))
    expect(run.status).toBe("news")
    const f = run.findings[0]
    expect(f?.key).toMatch(/^page:[0-9a-f]+$/)
    expect(f?.headline).toBe("The p page changed")
    expect(f?.detail).toBe("New line about price, and the old one is gone.")
    expect(f?.line).toBe("New line: “New price 6”")
    expect(f?.note).toBe("New line: “New price 6”")
    expect(f?.fix).toBe("none")
    expect(f?.ev?.diff).toEqual([
      { t: "c", s: "Hello" },
      { t: "d", s: "Old price 5" },
      { t: "a", s: "New price 6" },
    ])
    expect(text).toBe("Hello\nNew price 6")
  })
  it("a removed line", async () => {
    const { run } = await checkPage("a.com/p", "Hello\nGone", fake())
    expect(run.findings[0]?.detail).toBe("A line was removed.")
    expect(run.findings[0]?.line).toBe("Line removed: “Gone”")
  })
  it("ignored lines don't count", async () => {
    const { run } = await checkPage("a.com/p", "Hello\nUpdated Oct 30, 2026", fake({ fetch: async () => res("<p>Hello</p><p>Updated Oct 31, 2026</p>") }), ["date"])
    expect(run.status).toBe("quiet")
  })
  it("404, sign-in walls, no text and no answer are failed runs", async () => {
    const r404 = await checkPage("a.com/p", undefined, fake({ fetch: async () => res("", 404, {}, "Not Found") }))
    expect(r404.run.status).toBe("failed")
    expect(r404.run.error).toBe("That page returns Not found (404).")
    expect(r404.text).toBeUndefined()
    const r403 = await checkPage("a.com/p", undefined, fake({ fetch: async () => res("", 403) }))
    expect(r403.run.error).toBe("That page needs a sign-in, so Axe can’t read it.")
    const wall = await checkPage("a.com/p", undefined, fake({ fetch: async () => res('<form><input name="email"><input type="password"></form><p>Sign in</p>') }))
    expect(wall.run.error).toBe("That page needs a sign-in, so Axe can’t read it.")
    const empty = await checkPage("a.com/p", undefined, fake({ fetch: async () => res("<div><img src=a.png></div>") }))
    expect(empty.run.error).toBe("That page has no text Axe can read.")
    const down = await checkPage("a.com/p", "x", fake({ fetch: async () => { throw new Error("getaddrinfo ENOTFOUND a.com") } }))
    expect(down.run.error).toBe("The address wasn’t found")
  })
})

const jsonLd = (data: unknown) => `<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`

describe("price", () => {
  it("reads JSON-LD in a @graph", async () => {
    const html = jsonLd({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": "Product", offers: [{ "@type": "Offer", price: "48.00", priceCurrency: "USD", availability: "https://schema.org/InStock" }] }] })
    const { run, memo } = await checkPrice("shop.com/mug", undefined, fake({ fetch: async () => res(html) }))
    expect(run.status).toBe("quiet")
    expect(run.metric).toBe(48)
    expect(run.facts).toEqual([
      ["Price", "$48.00"],
      ["Stock", "In stock"],
      ["Found in", "Product data"],
    ])
    expect(run.stock).toBe("In stock")
    expect(run.currency).toBe("USD")
    expect(JSON.parse(memo ?? "")).toEqual({ price: 48, currency: "USD", stock: "In stock" })
  })
  it("reads og meta tags", async () => {
    const html = `<meta property="og:price:amount" content="19,90"><meta property="og:price:currency" content="EUR"><meta property="og:availability" content="out of stock">`
    const { run } = await checkPrice("shop.com/x", undefined, fake({ fetch: async () => res(html) }))
    expect(run.facts).toEqual([
      ["Price", "€19.90"],
      ["Stock", "Out of stock"],
      ["Found in", "Product data"],
    ])
  })
  it("reads microdata", async () => {
    const html = `<div itemscope><span itemprop="price" content="12.5">$12.50</span><meta itemprop="priceCurrency" content="GBP"><link itemprop="availability" href="https://schema.org/InStock"></div>`
    const { run } = await checkPrice("shop.com/x", undefined, fake({ fetch: async () => res(html) }))
    expect(run.facts?.[0]).toEqual(["Price", "£12.50"])
    expect(run.facts?.[1]).toEqual(["Stock", "In stock"])
  })
  it("names the product from its data, else the title", async () => {
    const named = await checkPrice("shop.com/x", undefined, fake({ fetch: async () => res(jsonLd({ "@type": "Product", name: "Stoneware clay, 25 lb", offers: { price: 48 } })) }))
    expect(named.run.product).toBe("Stoneware clay, 25 lb")
    const titled = await checkPrice("shop.com/x", undefined, fake({ fetch: async () => res(`<title>Celadon glaze | North Clay</title><meta property="og:price:amount" content="19">`) }))
    expect(titled.run.product).toBe("Celadon glaze")
  })
  it("a new price or stock is news", async () => {
    const page = (price: number, availability: string) => jsonLd({ "@type": "Product", offers: { price, priceCurrency: "USD", availability } })
    const prev = JSON.stringify({ price: 45, stock: "In stock" })
    const o = { name: "Stoneware clay, 25 lb" }
    const down = await checkPrice("shop.com/mug", prev, fake({ fetch: async () => res(page(42, "InStock")) }), o)
    expect(down.run.status).toBe("news")
    expect(down.run.findings[0]).toMatchObject({
      key: "price:42:in-stock",
      headline: "Down to $42",
      detail: "Stoneware clay, 25 lb went from $45 to $42. Still in stock.",
      line: "Down to $42 from $45.",
      note: "Down to $42 from $45.",
      fix: "none",
      ev: { from: 45, to: 42, currency: "USD", stock: "In stock" },
    })
    const up = await checkPrice("shop.com/mug", prev, fake({ fetch: async () => res(page(51, "InStock")) }), o)
    expect(up.run.findings[0]?.headline).toBe("Up to $51")
    const out = await checkPrice("shop.com/mug", prev, fake({ fetch: async () => res(page(45, "OutOfStock")) }), o)
    expect(out.run.findings[0]?.headline).toBe("Out of stock")
    expect(out.run.findings[0]?.detail).toBe("Stoneware clay, 25 lb is out of stock. It was $45.")
    const back = await checkPrice("shop.com/mug", out.memo, fake({ fetch: async () => res(page(45, "InStock")) }), o)
    expect(back.run.findings[0]?.headline).toBe("Back in stock")
    expect(back.run.findings[0]?.line).toBe("Back in stock at $45.")
    const same = await checkPrice("shop.com/mug", prev, fake({ fetch: async () => res(page(45, "InStock")) }), o)
    expect(same.run.status).toBe("quiet")
  })
  it("no price is a failed run, then a problem the second time", async () => {
    const { run, memo } = await checkPrice("shop.com/x", undefined, fake({ fetch: async () => res("<p>Hi</p>") }))
    expect(run.status).toBe("failed")
    expect(run.error).toBe("There’s no price on that page that Axe can read.")
    expect(memo).toBeUndefined()
    const again = await checkPrice("shop.com/x", JSON.stringify({ price: 48, stock: "In stock" }), fake({ fetch: async () => res("<p>Hi</p>") }), { missing: 1 })
    expect(again.run.status).toBe("problem")
    expect(again.run.findings[0]).toMatchObject({ key: "price:missing", headline: "I can’t find the price on this page anymore.", fix: "none" })
    const gone = await checkPrice("shop.com/x", undefined, fake({ fetch: async () => res("", 404, {}, "Not Found") }))
    expect(gone.run.error).toBe("That page returns Not found (404).")
  })
})

const GOOD_HEADERS = {
  "strict-transport-security": "max-age=63072000",
  "content-security-policy": "default-src 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
}

/** DNS for a domain: its TXT records by name. */
const dns = (records: Record<string, string[]>) => async (h: string) => (records[h] ?? []).map((r) => [r])

describe("security", () => {
  const good = (host: string, more: Partial<CheckDeps> = {}) =>
    fake({
      fetch: async () => res("", 200, GOOD_HEADERS),
      resolveTxt: dns({ [host]: ["v=spf1 include:_spf.google.com ~all"], [`_dmarc.${host}`]: ["v=DMARC1; p=reject"], [`google._domainkey.${host}`]: ["v=DKIM1; k=rsa; p=MIGf"] }),
      tls: async () => ({ days: 74, version: "TLSv1.3", valid: true }),
      tlsOld: async () => false,
      connect: async (_h, p) => p === 80 || p === 443,
      ...more,
    })

  it("a good domain is quiet, with the four rows", async () => {
    const steps: string[][] = []
    const run = await checkSecurity("good.com", good("good.com"), (s) => steps.push(s.filter((x) => x.state === "done").map((x) => x.label)))
    expect(run.status).toBe("quiet")
    expect(run.rows).toEqual([
      { label: "Email records", sub: "SPF, DKIM, DMARC", value: "Protected", ok: true },
      { label: "Certificate", sub: "good.com", value: "74 days left", ok: true },
      { label: "TLS and headers", value: "TLS 1.3", ok: true },
      { label: "Open ports", sub: "12 checked", value: "80 and 443 only", ok: true },
    ])
    // The four parts run at once and tick off as each finishes.
    expect(steps[0]).toEqual([])
    expect(steps.at(-1)?.sort()).toEqual(["Certificate", "Email records", "Open ports", "TLS and headers"])
  })

  it("DMARC p=none without DKIM is a record fix with the record as found and the diff", async () => {
    const run = await checkSecurity("lane-ceramics.com", good("lane-ceramics.com", { resolveTxt: dns({ "lane-ceramics.com": ["v=spf1 -all"], "_dmarc.lane-ceramics.com": ["v=DMARC1; p=none"] }) }))
    expect(run.status).toBe("problem")
    expect(run.findings.map((f) => f.key)).toEqual(["dmarc:none"])
    const f = run.findings[0]!
    expect(f.headline).toBe("Anyone can send email as lane-ceramics.com")
    expect(f.line).toBe("Anyone can send email as lane-ceramics.com.")
    expect(f.detail).toBe("DMARC is set to none and there’s no DKIM record, so mail that fakes your address still gets delivered.")
    expect(f.fix).toBe("record")
    expect(f.ev?.record).toEqual({
      name: "_dmarc.lane-ceramics.com",
      type: "TXT",
      found: "v=DMARC1; p=none",
      want: "v=DMARC1; p=quarantine; rua=mailto:dmarc@lane-ceramics.com",
      how: "Turn on DKIM with your mail provider. Then change this record:",
    })
    expect(run.rows?.[0]).toEqual({ label: "Email records", sub: "SPF, DKIM, DMARC", value: "Spoofable", ok: false })
    expect(run.dmarc).toBe("v=DMARC1; p=none")
  })

  it("no SPF is a record fix that includes the mail provider", async () => {
    const run = await checkSecurity("a.com", good("a.com", { resolveTxt: dns({ "_dmarc.a.com": ["v=DMARC1; p=reject"] }), resolveMx: async () => ["aspmx.l.google.com"] }))
    expect(run.findings.map((f) => f.key)).toEqual(["spf:none"])
    expect(run.findings[0]?.ev?.record?.want).toBe("v=spf1 include:_spf.google.com ~all")
  })

  it("missing headers and TLS 1.0 are agent fixes; a database port and an ending certificate have no fix", async () => {
    const run = await checkSecurity(
      "a.com",
      good("a.com", {
        fetch: async () => res("", 200, { "x-content-type-options": "nosniff" }),
        tls: async () => ({ days: 13, version: "TLSv1.2", valid: true }),
        tlsOld: async () => true,
        connect: async (_h, p) => p === 443 || p === 3306,
      }),
    )
    const by = Object.fromEntries(run.findings.map((f) => [f.key, f]))
    expect(Object.keys(by)).toEqual(["cert:ending", "header:hsts", "header:missing", "tls:old", "port:3306"])
    expect(by["header:hsts"]?.headline).toBe("a.com sends no HSTS header")
    expect(by["header:hsts"]?.fix).toBe("agent")
    expect(by["header:missing"]?.detail).toBe("Content-Security-Policy, X-Frame-Options and Referrer-Policy aren’t set. They stop other sites from framing yours and limit what injected scripts can do.")
    expect(by["tls:old"]?.headline).toBe("TLS 1.0 is still allowed")
    expect(by["port:3306"]?.headline).toBe("Port 3306 (MySQL) is open to anyone")
    expect(by["port:3306"]?.fix).toBe("none")
    expect(by["cert:ending"]?.headline).toBe("The certificate for a.com ends in 13 days")
    expect(run.rows?.map((r) => r.value)).toEqual(["Protected", "13 days left", "TLS 1.0 allowed", "443 and 3306"])
  })

  it("checks 12 ports, and DKIM on the common selectors", async () => {
    const asked: number[] = []
    const names: string[] = []
    await checkSecurity("a.com", good("a.com", { connect: async (_h, p) => (asked.push(p), false), resolveTxt: async (h) => (names.push(h), []) }))
    expect(asked.length).toBe(12)
    expect(names).toContain("google._domainkey.a.com")
    expect(names).toContain("selector1._domainkey.a.com")
  })

  it("a domain that doesn't resolve is a failed run", async () => {
    const run = await checkSecurity("nope.invalid", fake({ fetch: async () => { throw new Error("getaddrinfo ENOTFOUND nope.invalid") } }))
    expect(run.status).toBe("failed")
    expect(run.error).toBe("The address wasn’t found")
  })
})

const ALERTS = [
  {
    number: 7,
    dependency: { package: { name: "express" } },
    security_advisory: { ghsa_id: "GHSA-rv95-896h-c2vc", summary: "Express.js Open Redirect in malformed URLs", severity: "medium" },
    security_vulnerability: { severity: "medium", vulnerable_version_range: "< 4.19.2", first_patched_version: { identifier: "4.19.2" } },
  },
  {
    number: 9,
    dependency: { package: { name: "semver" } },
    security_advisory: { ghsa_id: "GHSA-c2qf-rxjj-qqgw", summary: "semver vulnerable to Regular Expression Denial of Service", severity: "medium" },
    security_vulnerability: { severity: "medium", first_patched_version: { identifier: "7.5.2" } },
  },
]

/** gh answers by path: Dependabot alerts, code scanning and secret scanning. */
const ghFake = (by: Record<string, { stdout: string; code: number }>): CheckDeps["exec"] => async (cmd, args) => {
  if (cmd !== "gh") return { stdout: "", code: 1 }
  const path = args[1] ?? ""
  const hit = Object.entries(by).find(([k]) => path.includes(k))
  return hit?.[1] ?? { stdout: '{"message":"Not enabled"}\ngh: Advanced Security must be enabled (HTTP 403)', code: 1 }
}

describe("repo", () => {
  it("reads Dependabot alerts through gh, one row per package with its fixed version", async () => {
    const run = await checkRepo("mia/shop-web", fake({ exec: ghFake({ dependabot: { stdout: JSON.stringify(ALERTS), code: 0 } }) }))
    expect(run.status).toBe("problem")
    expect(run.findings.map((f) => f.key)).toEqual(["alert:express", "alert:semver"])
    expect(run.findings[0]?.ev?.alert).toEqual({
      source: "package",
      name: "express",
      problem: "Open redirect in malformed URLs",
      severity: "moderate",
      fixedIn: "4.19.2",
      id: "GHSA-rv95-896h-c2vc",
      url: "https://github.com/advisories/GHSA-rv95-896h-c2vc",
    })
    expect(run.findings[1]?.ev?.alert?.problem).toBe("Regular expression denial of service")
    expect(run.findings.every((f) => f.fix === "agent" && f.level === "problem")).toBe(true)
    expect(run.facts).toEqual([["GitHub alerts", "2 open"]])
  })

  it("code scanning and secret scanning alerts", async () => {
    const run = await checkRepo(
      "mia/shop-web",
      fake({
        exec: ghFake({
          dependabot: { stdout: "[]", code: 0 },
          "code-scanning": { stdout: JSON.stringify([{ number: 3, rule: { description: "SQL injection", security_severity_level: "high" }, most_recent_instance: { location: { path: "src/db.js" } } }]), code: 0 },
          "secret-scanning": { stdout: JSON.stringify([{ number: 1, secret_type_display_name: "Stripe API Key" }]), code: 0 },
        }),
      }),
    )
    expect(run.findings.map((f) => f.key)).toEqual(["code:3", "secret:1"])
    expect(run.findings.map((f) => f.headline)).toEqual(["SQL injection", "GitHub found a Stripe API Key"])
  })

  it("gh not signed in, gh missing, and a repo Axe can't see are failed runs", async () => {
    const signedOut = await checkRepo("mia/shop-web", fake({ exec: async () => ({ stdout: "\nTo get started with GitHub CLI, please run:  gh auth login", code: 4 }) }))
    expect(signedOut.error).toBe("GitHub CLI isn’t signed in. Run gh auth login")
    const missing = await checkRepo("mia/shop-web", fake({ exec: async () => ({ stdout: "", code: 1, missing: true }) }))
    expect(missing.error).toBe("Install the GitHub CLI to read GitHub alerts")
    const unseen = await checkRepo("mia/shop-api", fake({ exec: async () => ({ stdout: "gh: Not Found (HTTP 404)", code: 1 }) }))
    expect(unseen.error).toBe("Axe can’t see mia/shop-api")
  })

  it("every kind of alert off is quiet", async () => {
    const run = await checkRepo("mia/shop-web", fake({ exec: ghFake({}) }))
    expect(run.status).toBe("quiet")
    expect(run.facts).toEqual([["GitHub alerts", "None open"]])
  })

  it("a folder with a leaked key: the file and its first 4 characters, never the secret", async () => {
    const secret = "sk_live_51HabcdefghijklmnopqrstuvWXYZ"
    const run = await checkRepo(
      "/work/shop",
      fake({
        exists: (p) => !p.endsWith("package-lock.json") && !p.endsWith("pnpm-lock.yaml") && !p.endsWith("yarn.lock") && !p.endsWith("package.json"),
        exec: async (cmd, args) => (cmd === "git" && args[0] === "grep" ? { stdout: `config/dev.env:3:${secret}\nyarn.lock:9:${secret}\n`, code: 0 } : cmd === "git" ? { stdout: "1793404800\n", code: 0 } : { stdout: "", code: 0 }),
      }),
    )
    expect(run.status).toBe("problem")
    expect(run.findings.map((f) => f.key)).toEqual(["key:config/dev.env:a Stripe secret"])
    expect(run.findings[0]?.ev?.alert).toMatchObject({ source: "key", file: "config/dev.env", problem: "Looks like a Stripe secret", id: "sk_l", committedAt: 1793404800000 })
    expect(JSON.stringify(run)).not.toContain(secret)
    expect(run.facts).toEqual([
      ["Packages", "No packages"],
      ["Keys", "1 found"],
    ])
  })

  it("npm audit: one row per package, the installed version, and how it's fixed", async () => {
    const audit = {
      vulnerabilities: {
        express: { name: "express", severity: "high", via: [{ title: "express vulnerable to XSS via response.redirect()", url: "https://github.com/advisories/GHSA-qw6h-vgh9-j6wx", severity: "low", range: "<4.20.0" }, { title: "Express.js Open Redirect in malformed URLs", url: "https://github.com/advisories/GHSA-rv95-896h-c2vc", severity: "moderate", range: "<4.19.2" }, "body-parser"], fixAvailable: { name: "express", version: "4.22.3" } },
        "body-parser": { name: "body-parser", severity: "high", via: [{ title: "body-parser vulnerable to denial of service when url encoding is enabled", url: "https://github.com/advisories/GHSA-qwcr-r2fm-qrc7", severity: "high", range: "<=1.20.8" }], fixAvailable: { name: "express", version: "4.22.3" } },
        "serve-static": { name: "serve-static", severity: "low", via: ["send"], fixAvailable: true },
      },
      metadata: { dependencies: { total: 68 } },
    }
    const run = await checkRepo("/work/shop", fake({ exists: (p) => p.endsWith("package-lock.json") || p === "/work/shop", exec: async (cmd) => (cmd === "npm" ? { stdout: JSON.stringify(audit), code: 1 } : { stdout: "", code: 1 }) }))
    expect(run.findings.map((f) => f.key)).toEqual(["alert:express", "alert:body-parser"])
    expect(run.findings[0]?.ev?.alert).toMatchObject({ name: "express", problem: "Open redirect in malformed URLs and 1 more", severity: "moderate", fixedIn: "4.22.3" })
    expect(run.findings[1]?.ev?.alert).toMatchObject({ name: "body-parser", problem: "Denial of service when url encoding is enabled", severity: "high", fixVia: "express 4.22.3" })
    expect(run.facts).toEqual([
      ["Packages", "68, 2 affected"],
      ["Keys", "None found"],
    ])
  })

  it("a GitHub repo with a local clone uses both, and the folder's row wins", async () => {
    const audit = { vulnerabilities: { express: { name: "express", severity: "moderate", via: [{ title: "Express.js Open Redirect in malformed URLs", url: "https://github.com/advisories/GHSA-rv95-896h-c2vc", severity: "moderate", range: "<4.19.2" }], fixAvailable: { name: "express", version: "4.19.2" } } }, metadata: { dependencies: { total: 68 } } }
    const gh = ghFake({ dependabot: { stdout: JSON.stringify([ALERTS[0]]), code: 0 } })
    const run = await checkRepo("mia/shop-web", fake({ exists: (p) => !p.endsWith("pnpm-lock.yaml") && !p.endsWith("yarn.lock"), exec: async (cmd, args, o) => (cmd === "gh" ? gh(cmd, args, o) : cmd === "npm" ? { stdout: JSON.stringify(audit), code: 1 } : { stdout: "", code: 1 }) }), "/work/shop")
    expect(run.findings.map((f) => f.key)).toEqual(["alert:express"])
    expect(run.facts).toEqual([
      ["GitHub alerts", "1 open"],
      ["Packages", "68, 1 affected"],
      ["Keys", "None found"],
    ])
  })
})
