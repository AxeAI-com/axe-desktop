import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createEngine, type EngineDeps, priceSeries } from "../../src/main/watching/engine"
import { watchNotice } from "../../src/main/watching/notify"
import { createStore } from "../../src/main/watching/store"
import { firstMessage, planSentence, stripWords } from "../../src/shared/watching/copy"
import { hunks, keptText, pageChange, pageHeadline } from "../../src/shared/watching/diff"
import { money, priceChange, pricePlan } from "../../src/shared/watching/price"
import type { Run } from "../../src/shared/watching/types"

// Page changes and Price and stock: the diff and its words, the price sentences, and the engine
// from a first copy through a change, the unread dot, Ignore changes like this and Undo.

const BEFORE = ["Pricing", "Wheel-thrown mugs, $38", "Free shipping on orders over $75.", "Returns within 30 days.", "Questions? Write to us."].join("\n")
const AFTER = BEFORE.replace("Free shipping on orders over $75.", "Free shipping on orders over $50.\nGift wrap is now free.")

describe("page diff", () => {
  it("tells the design's change in plain words", () => {
    const c = pageChange("lane-ceramics.com/pricing", BEFORE, AFTER)!
    expect(c.headline).toBe("The pricing page changed")
    expect(c.body).toBe("New line about shipping, and the old one is gone.")
    expect(c.line).toBe("New line: “Free shipping on orders over $50.”")
    expect(c.added).toBe(2)
    expect(c.removed).toBe(1)
    expect(c.diff).toEqual([
      { t: "c", s: "Pricing" },
      { t: "c", s: "Wheel-thrown mugs, $38" },
      { t: "d", s: "Free shipping on orders over $75." },
      { t: "a", s: "Free shipping on orders over $50." },
      { t: "a", s: "Gift wrap is now free." },
      { t: "c", s: "Returns within 30 days." },
      { t: "c", s: "Questions? Write to us." },
    ])
    expect(c.anchors).toEqual(["Wheel-thrown mugs, $38"])
  })

  it("keeps two lines of context and marks gaps", () => {
    const a = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n")
    const b = a.replace("Line 3", "Line three").replace("Line 15", "Line fifteen")
    const c = pageChange("x.com", a, b)!
    expect(c.diff.map((l) => l.s)).toEqual(["Line 1", "Line 2", "Line 3", "Line three", "Line 4", "Line 5", "…", "Line 13", "Line 14", "Line 15", "Line fifteen", "Line 16", "Line 17"])
    expect(c.headline).toBe("The home page changed")
  })

  it("names the page from its path", () => {
    expect(pageHeadline("lane-ceramics.com/pricing")).toBe("The pricing page changed")
    expect(pageHeadline("lane-ceramics.com/gift-cards/")).toBe("The gift cards page changed")
    expect(pageHeadline("craftfair.org/2027")).toBe("craftfair.org/2027 changed")
  })

  it("ignores dates, words, and changes near a heading you ignored", () => {
    expect(keptText("Hello\nLast updated Oct 30, 2026\nBye", ["date"])).toBe("Hello\nBye")
    expect(pageChange("x.com", "A\nOpen 9 to 5", "A\nOpen 10 to 6", ["text:open"])).toBeNull()
    const near = ["near:Wheel-thrown mugs, $38"]
    expect(pageChange("x.com", BEFORE, AFTER, near)).toBeNull()
    const more = AFTER.replace("Questions? Write to us.", "Questions? Call us.")
    const c = pageChange("x.com", BEFORE, more, near)!
    expect(c.line).toBe("New line: “Questions? Call us.”")
    expect(c.added).toBe(1)
    expect(hunks(BEFORE, more).length).toBe(2)
  })

  it("adds and removes alone", () => {
    expect(pageChange("x.com", "A\nB", "A\nB\nC\nD")!.body).toBe("2 lines were added.")
    expect(pageChange("x.com", "A\nB\nC", "A")!.body).toBe("2 lines were removed.")
    expect(pageChange("x.com", "A", "A")).toBeNull()
  })
})

describe("price copy", () => {
  const n = "Stoneware clay, 25 lb"
  it("writes the plan, the first message and the strip", () => {
    expect(pricePlan(n, { price: 48, currency: "USD", stock: "In stock" }, "every hour", "tell you")).toBe(
      "Stoneware clay, 25 lb is $48 and in stock. I’ll check every hour and tell you when either changes.",
    )
    const first: Run = { at: 0, ms: 1, status: "quiet", findings: [], metric: 48, stock: "In stock", currency: "USD" }
    expect(planSentence("price", "northclay.com/stoneware-25", "1h", "now", { name: n, first })).toBe(
      "Stoneware clay, 25 lb is $48 and in stock. I’ll check every hour and tell you when either changes.",
    )
    expect(firstMessage("price", "northclay.com/stoneware-25", first, "1h")).toBe("$48, in stock. I’ll check every hour.")
    expect(stripWords("price", new Date(2026, 9, 1).getTime(), { price: 48, stock: "In stock" })).toBe("$48, in stock, since Oct 1")
    expect(stripWords("page", new Date(2026, 9, 24).getTime())).toBe("No changes since Oct 24")
  })
  it("says each kind of change", () => {
    const at = (price: number, stock: "In stock" | "Out of stock" = "In stock") => ({ price, currency: "USD", stock })
    expect(priceChange(n, at(45), at(42))).toEqual({ headline: "Down to $42", body: "Stoneware clay, 25 lb went from $45 to $42. Still in stock.", line: "Down to $42 from $45." })
    expect(priceChange(n, at(48), at(51))?.headline).toBe("Up to $51")
    expect(priceChange(n, at(48), at(51, "Out of stock"))?.body).toBe("Stoneware clay, 25 lb went from $48 to $51. Now out of stock.")
    expect(priceChange(n, at(42), at(42, "Out of stock"))?.headline).toBe("Out of stock")
    expect(priceChange(n, at(42, "Out of stock"), at(42))?.headline).toBe("Back in stock")
    expect(priceChange(n, at(42), at(42))).toBeNull()
    expect(money(19.5, "EUR", false)).toBe("€19.50")
    expect(money(48, "CAD")).toBe("48.00 CAD")
  })
})

describe("page and price watches in the engine", () => {
  const T0 = new Date(2026, 9, 24, 9, 0).getTime()
  function setup() {
    const store = createStore(mkdtempSync(join(tmpdir(), "watching-pp-")))
    let now = T0
    let body = `<title>Pricing, Lane Ceramics</title>${BEFORE.split("\n").map((l) => `<p>${l}</p>`).join("")}`
    let status = 200
    const notices: string[] = []
    const deps: EngineDeps = {
      resolveTxt: async () => [],
      connect: async () => false,
      tls: async () => ({ days: null, version: null }),
      exec: async () => ({ stdout: "", code: 1 }),
      exists: () => false,
      fetch: async () => new Response(body, { status }),
      load: async () => ({ ms: 900, files: [] }),
      now: () => now,
      sleep: async () => {},
      online: () => true,
      notice: (w, opened) => {
        const n = watchNotice(w, opened)
        if (n) notices.push(`${n.title}: ${n.body}`)
      },
      changed: () => {},
    }
    return { store, e: createEngine(store, deps), notices, advance: (ms: number) => (now += ms), setBody: (b: string) => (body = b), setStatus: (s: number) => (status = s) }
  }

  it("validates a page, shows Checking now, then tells you about a change once", async () => {
    const { e, notices, advance, setBody, setStatus } = setup()
    expect(await e.draft({ kind: "page", target: "lane-ceramics" })).toEqual({ error: "That doesn’t look like a link." })
    setStatus(404)
    expect(await e.draft({ kind: "page", target: "lane-ceramics.com/prices" })).toEqual({ error: "That page returns Not found (404)." })
    setStatus(200)
    const d = await e.draft({ kind: "page", target: "https://lane-ceramics.com/pricing" })
    if ("error" in d) throw new Error(d.error)
    expect(d.name).toBe("lane-ceramics.com/pricing")
    expect(d.plan).toBe("I’ll read this page every hour and tell you what changed, in one line.")
    const started = e.create(d)
    expect(started.steps).toEqual([
      { label: "Loading the page", state: "done" },
      { label: "Saving its text", state: "run" },
    ])
    await e.settled()
    let v = e.get(started.id)!
    expect(v.steps).toBeUndefined()
    expect(firstMessage("page", v.target, v.first!, v.every)).toBe("Saved a copy of the page: 18 words. I’ll compare it every hour.")
    expect(v.line).toBe("No changes since 9:00 am.")

    advance(3_600_000)
    await e.runOne(v.id)
    expect(notices).toEqual([])
    setBody(`<title>Pricing, Lane Ceramics</title>${AFTER.split("\n").map((l) => `<p>${l}</p>`).join("")}`)
    advance(3_600_000)
    v = (await e.runOne(v.id))!
    expect(notices).toEqual(["lane-ceramics.com/pricing: New line: “Free shipping on orders over $50.”"])
    expect(v.unread).toBe(true)
    expect(v.news.length).toBe(1)
    expect(v.line).toBe("New line: “Free shipping on orders over $50.”")
    expect(v.strip.at(-1)?.status).toBe("news")

    // The same text again is quiet; the change stays in the thread.
    advance(3_600_000)
    v = (await e.runOne(v.id))!
    expect(v.news.length).toBe(1)
    expect(notices.length).toBe(1)

    v = e.seen(v.id)!
    expect(v.unread).toBe(false)
    expect(v.line).toMatch(/^No changes since /)
  })

  it("Ignore changes like this, and Undo", async () => {
    const { e, advance, setBody } = setup()
    const d = await e.draft({ kind: "page", target: "lane-ceramics.com/pricing" })
    if ("error" in d) throw new Error(d.error)
    const id = e.create(d).id
    await e.settled()
    setBody(AFTER.split("\n").map((l) => `<p>${l}</p>`).join(""))
    advance(3_600_000)
    let v = (await e.runOne(id))!
    const at = v.news[0]!.at
    v = e.act(id, String(at), "ignore")!
    expect(v.ignore).toEqual(["near:Wheel-thrown mugs, $38"])
    expect(v.news[0]!.ignored).toBe(true)
    const said = v.said.at(-1)!
    expect(said).toMatchObject({ you: "", axe: "Okay. I’ll ignore changes in that part of the page.", undo: { ignore: [] } })
    // The same part changing again stays quiet.
    setBody(AFTER.replace("$50", "$40").split("\n").map((l) => `<p>${l}</p>`).join(""))
    advance(3_600_000)
    v = (await e.runOne(id))!
    expect(v.latest?.status).toBe("quiet")
    v = e.act(id, String(said.at), "undo")!
    expect(v.ignore).toEqual([])
    expect(v.news[0]!.ignored).toBe(false)
    expect(v.said.at(-1)!.undone).toBe(true)
  })

  it("a reply changes the schedule and the ignore rules, with Undo", async () => {
    const { e } = setup()
    const d = await e.draft({ kind: "page", target: "lane-ceramics.com/pricing" })
    if ("error" in d) throw new Error(d.error)
    const id = e.create(d).id
    let v = (await e.reply(id, "only check this once a day, and ignore the date at the bottom"))!
    expect(v.every).toBe("morning")
    expect(v.ignore).toEqual(["date"])
    const s = v.said.at(-1)!
    expect(s.axe).toBe("Done. I’ll check every morning at 7:30 and ignore the date line at the bottom.")
    v = e.act(id, String(s.at), "undo")!
    expect(v.every).toBe("1h")
    expect(v.ignore).toBeUndefined()
  })

  const product = (price: number, stock = "InStock") =>
    `<title>Stoneware clay | North Clay</title><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Stoneware clay, 25 lb", offers: { price, priceCurrency: "USD", availability: stock } })}</script>`

  it("validates a product page, names it, and tells you when the price drops", async () => {
    const { e, notices, advance, setBody } = setup()
    setBody("<p>About us</p>")
    expect(await e.draft({ kind: "price", target: "northclay.com/about" })).toEqual({
      error: "There’s no price on that page that Axe can read.",
      button: { label: "Watch the page instead", kind: "page", target: "northclay.com/about" },
    })
    setBody(product(48))
    const d = await e.draft({ kind: "price", target: "northclay.com/stoneware-25" })
    if ("error" in d) throw new Error(d.error)
    expect(d.name).toBe("Stoneware clay, 25 lb")
    expect(d.plan).toBe("Stoneware clay, 25 lb is $48 and in stock. I’ll check every hour and tell you when either changes.")
    const started = e.create(d)
    expect(started.steps?.map((s) => s.label)).toEqual(["Loading the page", "Finding the price"])
    await e.settled()
    let v = e.get(started.id)!
    expect(v.line).toBe("$48. In stock.")
    expect(v.first?.facts).toEqual([
      ["Price", "$48.00"],
      ["Stock", "In stock"],
      ["Found in", "Product data"],
    ])
    setBody(product(45))
    advance(3_600_000)
    await e.runOne(v.id)
    setBody(product(42))
    advance(3_600_000)
    v = (await e.runOne(v.id))!
    expect(notices).toEqual(["Stoneware clay, 25 lb: Down to $45 from $48.", "Stoneware clay, 25 lb: Down to $42 from $45."])
    expect(v.line).toBe("Down to $42 from $45.")
    expect(v.news.map((n) => n.headline)).toEqual(["Down to $45", "Down to $42"])
    expect(v.prices?.map((p) => p[1])).toEqual([48, 45, 42])
    expect(v.strip.at(-1)?.stock).toBe("In stock")
  })

  it("a price that disappears: a failed run, then a problem", async () => {
    const { e, advance, setBody } = setup()
    setBody(product(48))
    const d = await e.draft({ kind: "price", target: "northclay.com/stoneware-25" })
    if ("error" in d) throw new Error(d.error)
    const id = e.create(d).id
    await e.settled()
    setBody("<p>Coming soon</p>")
    advance(3_600_000)
    let v = (await e.runOne(id))!
    expect(v.latest?.status).toBe("failed")
    expect(v.open).toEqual([])
    advance(3_600_000)
    v = (await e.runOne(id))!
    expect(v.open.map((f) => f.headline)).toEqual(["I can’t find the price on this page anymore."])
  })

  it("keeps a 30-day series of changes", () => {
    const day = 86_400_000
    const runs: Run[] = [40, 48, 48, 45, 45, 42].map((p, i) => ({ at: T0 + (i - 1) * 10 * day, ms: 1, status: "quiet", findings: [], metric: p }))
    expect(priceSeries(runs, T0 + 40 * day)).toEqual([
      [T0 + 10 * day, 48],
      [T0 + 20 * day, 45],
      [T0 + 40 * day, 42],
    ])
  })
})
