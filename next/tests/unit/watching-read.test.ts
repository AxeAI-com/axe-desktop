import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { checkCustom, BAD_ANSWER, BAD_QUOTE } from "../../src/main/watching/checks/custom"
import { createEngine, type EngineDeps } from "../../src/main/watching/engine"
import { type AskModel, ModelUnavailable } from "../../src/main/watching/model"
import { createStore } from "../../src/main/watching/store"
import { customNow, planSentence, rowLine } from "../../src/shared/watching/copy"
import { fallbackAsk, jsonIn, nextAsk, parseCustom, parseRead, parseReplyAnswer, quoteOnPage, WHICH } from "../../src/shared/watching/read"
import { TOO_OFTEN } from "../../src/shared/watching/reply"
import { nearHost } from "../../src/shared/watching/target"
import type { Answerer } from "../../src/shared/types"
import type { Draft, WatchView } from "../../src/shared/watching/types"

const T0 = new Date(2026, 9, 31, 14, 0, 0).getTime()
const agent: Answerer = { kind: "agent", agentId: "claude-acp" }

describe("reading a sentence", () => {
  it("finds the JSON in a reply, fenced or not", () => {
    expect(jsonIn('{"kind":"page"}')).toEqual({ kind: "page" })
    expect(jsonIn('Here it is:\n```json\n{"kind":"uptime","target":"a.com"}\n```')).toEqual({ kind: "uptime", target: "a.com" })
    expect(jsonIn("Sure! {\"a\": {\"b\": 1}} done")).toEqual({ a: { b: 1 } })
    expect(jsonIn("no json here")).toBeUndefined()
  })

  it("validates the model's reading and drops what doesn't fit", () => {
    expect(parseRead('{"kind":"uptime","target":"lane-ceramics.com","every":"1h","notify":null,"condition":null,"name":null}')).toEqual({ kind: "uptime", target: "lane-ceramics.com", every: "1h" })
    // An unknown schedule is dropped, not guessed.
    expect(parseRead('{"kind":"page","target":"a.com/p","every":"2h"}')).toEqual({ kind: "page", target: "a.com/p" })
    expect(parseRead('{"kind":"weather","target":"a.com"}')).toBeNull()
    expect(parseRead("I think it is uptime")).toBeNull()
    expect(
      parseRead('{"kind":"custom","target":"claycollective.org/workshops","condition":"the Saturday glaze workshop has a seat.","name":"Saturday glaze workshop seats"}'),
    ).toEqual({ kind: "custom", target: "claycollective.org/workshops", condition: "the Saturday glaze workshop has a seat", name: "Saturday glaze workshop seats" })
    // A custom watch with nothing to look for can't run: it's unclear.
    expect(parseRead('{"kind":"custom","target":"a.com"}')).toEqual({ kind: "unclear", target: "a.com" })
  })

  it("the fallback finds an address and never picks a kind", () => {
    expect(fallbackAsk("lane-ceramics.com")).toEqual({ ask: "kind", question: "What should I watch on lane-ceramics.com?", target: "lane-ceramics.com" })
    expect(fallbackAsk("keep an eye on things")).toEqual({ ask: "kind", question: "What should I watch?" })
    // Words like "price", "down" or "security" never decide the kind.
    for (const t of ["tell me if my site goes down", "watch the price of clay", "check security on lane-ceramics.com", "has my pricing page changed?"]) {
      const a = fallbackAsk(t)
      expect(a.ask).toBe("kind")
      expect(a.kind).toBeUndefined()
    }
  })

  it("asks for what's missing: the kind, or the target with the kind set", () => {
    expect(nextAsk({ kind: "unclear" })).toEqual({ ask: "kind", question: "What should I watch?" })
    expect(nextAsk({ kind: "uptime" })).toEqual({ ask: "target", question: "Which site?", kind: "uptime" })
    expect(nextAsk({ kind: "price", target: "my shop" })).toEqual({ ask: "target", question: "Which product page?", kind: "price" })
    expect(nextAsk({ kind: "page", target: "a.com/p" })).toBeNull()
    expect([WHICH.page, WHICH.security, WHICH.repo]).toEqual(["Which page?", "Which domain?", "Which repo?"])
  })

  it("offers a close match only one edit away", () => {
    expect(nearHost("lane-ceramics.co", ["lane-ceramics.com", "northclay.com"])).toBe("lane-ceramics.com")
    expect(nearHost("lane-ceramcs.com", ["lane-ceramics.com"])).toBe("lane-ceramics.com")
    expect(nearHost("lane.co", ["lane-ceramics.com"])).toBeNull()
    expect(nearHost("lane-ceramics.com", ["lane-ceramics.com"])).toBeNull()
  })
})

describe("custom watches", () => {
  const page = (left: string) => `<title>Workshops</title><h1>Workshops</h1><p>Sat 7 Nov, Glazing for stoneware, 10:00 to 13:00. ${left}</p>`
  const answer = (o: object) => JSON.stringify({ level: "news", detail: null, state: null, ...o })

  it("checks the model's answer and its quote", () => {
    expect(parseCustom(answer({ met: true, headline: "A seat opened.", quote: "“2 places left.”", state: "2 seats free" }))).toEqual({ met: true, level: "news", headline: "A seat opened", quote: "2 places left.", state: "2 seats free" })
    expect(parseCustom('{"met":"yes"}')).toBeNull()
    expect(quoteOnPage("glazing  for STONEWARE", "Sat 7 Nov, Glazing for stoneware, 10:00")).toBe(true)
    expect(quoteOnPage("3 places left", "2 places left")).toBe(false)
  })

  it("tells you once when it turns true, quoting the page; a made-up quote is a failed run", async () => {
    let html = page("Fully booked.")
    let reply = answer({ met: false, headline: "The workshop is still full", detail: "All 8 seats are taken.", quote: "Fully booked.", state: "Full" })
    const ask: AskModel = async () => reply
    const d = { fetch: async () => new Response(html), now: () => T0 }
    const first = await checkCustom("claycollective.org/workshops", "the Saturday glaze workshop has a seat", agent, undefined, d, ask)
    expect(first.run.status).toBe("quiet")
    expect(first.memo).toBe("not")
    expect(customNow(first.run)).toBe("It’s full now.")
    expect(planSentence("custom", "claycollective.org/workshops", "1h", "now", { first: first.run, condition: "the Saturday glaze workshop has a seat" })).toBe(
      "I’ll read claycollective.org/workshops every hour and tell you when the Saturday glaze workshop has a seat. It’s full now.",
    )
    html = page("2 places left.")
    reply = answer({ met: true, headline: "A seat opened in the Saturday glaze workshop", detail: "2 of 8 seats are free now.", quote: "Sat 7 Nov, Glazing for stoneware, 10:00 to 13:00. 2 places left.", state: "2 seats free" })
    const opened = await checkCustom("claycollective.org/workshops", "x", agent, "not", d, ask)
    expect(opened.run.status).toBe("news")
    expect(opened.run.findings[0]).toMatchObject({ level: "news", headline: "A seat opened in the Saturday glaze workshop", detail: "2 of 8 seats are free now.", ev: { quote: "Sat 7 Nov, Glazing for stoneware, 10:00 to 13:00. 2 places left." } })
    // Still true an hour later: no second news.
    expect((await checkCustom("claycollective.org/workshops", "x", agent, "met", d, ask)).run.status).toBe("quiet")
    reply = answer({ met: true, headline: "A seat opened", quote: "3 places left." })
    expect((await checkCustom("claycollective.org/workshops", "x", agent, "not", d, ask)).run).toMatchObject({ status: "failed", error: BAD_QUOTE })
    reply = "I couldn't tell"
    expect((await checkCustom("claycollective.org/workshops", "x", agent, "not", d, ask)).run).toMatchObject({ status: "failed", error: BAD_ANSWER })
  })

  it("a model that can't run says so in the row", async () => {
    const ask: AskModel = async () => {
      throw new ModelUnavailable("Claude Code isn’t signed in, so this can’t run.")
    }
    const r = await checkCustom("a.com", "x", agent, "not", { fetch: async () => new Response(page("Fully booked.")), now: () => T0 }, ask)
    expect(r.run.error).toBe("Claude Code isn’t signed in, so this can’t run.")
    expect(rowLine("custom", r.run)).toBe("Claude Code isn’t signed in, so this can’t run.")
  })
})

describe("replies", () => {
  it("reads the model's patch and keeps only what fits the kind", () => {
    expect(parseReplyAnswer('{"patch":{"every":"morning","ignore":["date"]},"say":"Done. I’ll check every morning."}', { kind: "page" })).toEqual({ patch: { every: "morning", ignore: ["date"] }, say: "Done. I’ll check every morning." })
    expect(parseReplyAnswer('{"patch":{"fixedSeconds":3},"say":"Okay."}', { kind: "uptime" })).toEqual({ patch: { fixedMs: 3000 }, say: "Okay." })
    expect(parseReplyAnswer('{"patch":{"fixedSeconds":3},"say":"Okay."}', { kind: "page" })).toEqual({ patch: null, say: "Okay." })
    expect(parseReplyAnswer('{"patch":null,"say":"It changed on Oct 28."}', { kind: "page" })).toEqual({ patch: null, say: "It changed on Oct 28." })
    expect(parseReplyAnswer("sure", { kind: "page" })).toBeNull()
  })

  it("knows what's too often", () => {
    for (const t of ["check every minute", "every 30 seconds", "every 2 min", "every 1 minute"]) expect(TOO_OFTEN.test(t)).toBe(true)
    for (const t of ["every 5 minutes", "every 15 minutes", "every hour"]) expect(TOO_OFTEN.test(t)).toBe(false)
  })
})

describe("the engine with a model", () => {
  function setup(model: (system: string, prompt: string) => string | Promise<string>) {
    const store = createStore(mkdtempSync(join(tmpdir(), "watching-read-")))
    let now = T0
    let html = "<title>Workshops</title><p>Sat 7 Nov, Glazing for stoneware. Fully booked.</p>"
    const asked: string[] = []
    const deps: EngineDeps = {
      resolveTxt: async () => [],
      resolves: async (host) => !host.endsWith(".co"),
      connect: async () => false,
      tls: async () => ({ days: null, version: null }),
      exec: async () => ({ stdout: "", code: 1 }),
      exists: () => false,
      fetch: async (url) => {
        if (String(url).includes(".co/")) throw Object.assign(new Error("getaddrinfo ENOTFOUND lane-ceramics.co"), { cause: { code: "ENOTFOUND" } })
        return new Response(html)
      },
      load: async () => ({ ms: 900, files: [] }),
      now: () => now,
      sleep: async () => {},
      online: () => true,
      notice: () => {},
      changed: () => {},
      ask: async (_a, system, prompt) => {
        asked.push(prompt)
        return model(system, prompt)
      },
    }
    return { store, e: createEngine(store, deps), asked, advance: (ms: number) => (now += ms), setHtml: (h: string) => (html = h) }
  }
  const reading = (o: object) => () => JSON.stringify({ target: null, every: null, notify: null, condition: null, name: null, ...o })

  it("a sentence the model can't place asks with the starters", async () => {
    const { e } = setup(reading({ kind: "unclear" }))
    expect(await e.read({ text: "keep an eye on things for me", answerer: agent })).toEqual({ ask: "kind", question: "What should I watch?" })
  })

  it("a kind with no target asks which one", async () => {
    const { e } = setup(reading({ kind: "uptime" }))
    expect(await e.read({ text: "Tell me if my site goes down.", answerer: agent })).toEqual({ ask: "target", question: "Which site?", kind: "uptime" })
  })

  it("no model, or a reply that doesn't validate, falls back to the address", async () => {
    const { e } = setup(() => "uptime, I think")
    expect(await e.read({ text: "Tell me if lane-ceramics.com goes down", answerer: agent })).toEqual({ ask: "kind", question: "What should I watch on lane-ceramics.com?", target: "lane-ceramics.com" })
    const thrown = setup(() => Promise.reject(new Error("offline")))
    expect(await thrown.e.read({ text: "keep an eye on things", answerer: agent })).toEqual({ ask: "kind", question: "What should I watch?" })
    expect(await thrown.e.read({ text: "lane-ceramics.com" })).toEqual({ ask: "kind", question: "What should I watch on lane-ceramics.com?", target: "lane-ceramics.com" })
  })

  it("a domain that doesn't exist offers the close match from your watches", async () => {
    const { e } = setup(reading({ kind: "page", target: "lane-ceramics.co/pricing" }))
    const d = await e.draft({ kind: "page", target: "lane-ceramics.com/pricing" })
    if ("error" in d) throw new Error(d.error)
    e.create(d)
    expect(await e.read({ text: "Tell me when lane-ceramics.co/pricing changes.", answerer: agent })).toEqual({
      error: "I couldn’t reach lane-ceramics.co. That domain doesn’t exist.",
      button: { label: "Use lane-ceramics.com/pricing", kind: "page", target: "lane-ceramics.com/pricing" },
      kind: "page",
      target: "lane-ceramics.co/pricing",
    })
  })

  it("one of the five kinds gets that kind's plan, with what the sentence said", async () => {
    const { e } = setup(reading({ kind: "page", target: "lane-ceramics.com/pricing", every: "morning" }))
    const d = (await e.read({ text: "Each morning, tell me if lane-ceramics.com/pricing changes", answerer: agent })) as Draft
    expect(d).toMatchObject({ kind: "page", target: "lane-ceramics.com/pricing", every: "morning", asked: "Each morning, tell me if lane-ceramics.com/pricing changes" })
    expect(d.plan).toBe("I’ll read this page every morning at 7:30 and tell you what changed, in one line.")
  })

  it("a free sentence becomes a custom watch on your model and tells you when it comes true", async () => {
    let met = false
    const { e, advance, setHtml } = setup((system) => {
      if (system.startsWith("You turn one sentence"))
        return reading({ kind: "custom", target: "claycollective.org/workshops", condition: "the Saturday glaze workshop has a seat", name: "Saturday glaze workshop seats" })()
      return met
        ? JSON.stringify({ met: true, level: "news", headline: "A seat opened in the Saturday glaze workshop", detail: "2 of 8 seats are free now.", quote: "2 places left.", state: "2 seats free" })
        : JSON.stringify({ met: false, level: "news", headline: "Still full", detail: "All 8 seats are taken.", quote: "Fully booked.", state: "Full" })
    })
    const text = "Tell me when a seat opens in the Saturday glaze workshop at claycollective.org/workshops."
    const d = (await e.read({ text, answerer: agent })) as Draft
    expect(d).toMatchObject({ kind: "custom", name: "Saturday glaze workshop seats", asked: text, answerer: agent })
    expect(d.plan).toBe("I’ll read claycollective.org/workshops every hour and tell you when the Saturday glaze workshop has a seat. It’s full now.")
    const v = e.create(d)
    await e.settled()
    expect(e.get(v.id)?.line).toBe("Full.")
    met = true
    setHtml("<title>Workshops</title><p>Sat 7 Nov, Glazing for stoneware. 2 places left.</p>")
    advance(70 * 60_000)
    await e.tick()
    const after = e.get(v.id)!
    expect(after.news.at(-1)).toMatchObject({ headline: "A seat opened in the Saturday glaze workshop", ev: { quote: "2 places left." } })
    expect(after.unread).toBe(true)
  })

  it("a reply goes to the model; a question gets an answer, a change gets Undo, too often is refused", async () => {
    let answer = '{"patch":{"every":"morning"},"say":"Done. I’ll check every morning at 7:30."}'
    const { e } = setup(() => answer)
    const d = await e.draft({ kind: "page", target: "lane-ceramics.com/pricing", answerer: agent })
    if ("error" in d) throw new Error(d.error)
    const id = e.create(d).id
    let v = (await e.reply(id, "only once a day please"))!
    expect(v.every).toBe("morning")
    expect(v.said.at(-1)).toMatchObject({ you: "only once a day please", axe: "Done. I’ll check every morning at 7:30.", undo: { every: "1h" } })
    answer = '{"patch":null,"say":"Nothing has changed since you started watching it."}'
    v = (await e.reply(id, "what changed last week?"))!
    expect(v.said.at(-1)).toMatchObject({ axe: "Nothing has changed since you started watching it." })
    expect(v.said.at(-1)!.undo).toBeUndefined()
    v = (await e.reply(id, "check every minute"))!
    expect(v.said.at(-1)!.axe).toBe("I can’t check more often than every 5 minutes.")
    expect(v.every).toBe("morning")
    // No valid answer: the plain phrases still work.
    answer = "hmm"
    v = (await e.reply(id, "every hour"))!
    expect(v.every).toBe("1h")
  })

  it("pause keeps when, resume says so and checks; a bad new target comes back as its error", async () => {
    const { e, store, advance } = setup(() => "")
    const d = await e.draft({ kind: "page", target: "lane-ceramics.com/pricing" })
    if ("error" in d) throw new Error(d.error)
    const id = e.create(d).id
    let v = (await e.update(id, { paused: true })) as WatchView
    expect(v.paused).toBe(true)
    expect(v.pausedAt).toBe(T0)
    expect(v.nextAt).toBeNull()
    advance(60_000)
    v = (await e.update(id, { paused: false })) as WatchView
    expect(v.paused).toBe(false)
    expect(v.pausedAt).toBeUndefined()
    expect(v.said.at(-1)).toMatchObject({ you: "", axe: "Resumed. Checking now." })
    await new Promise((r) => setTimeout(r, 10))
    expect(store.runs(id).length).toBe(2)
    expect(await e.update(id, { target: "lane-ceramics.co/pricing" })).toEqual({ error: "lane-ceramics.co doesn’t exist. Check the spelling." })
    expect(e.get(id)?.target).toBe("lane-ceramics.com/pricing")
    v = (await e.update(id, { target: "lane-ceramics.com/about" })) as WatchView
    expect(v.target).toBe("lane-ceramics.com/about")
    expect(v.name).toBe("lane-ceramics.com/about")
    expect(v.targetAt).toBe(T0 + 60_000)
  })
})

describe("a price page with no product data", () => {
  const text = "Glaze kit, 8 colours\nOur price: $36.50\nIn stock, ships tomorrow.\nWas $42.00"

  it("reads the price after the saved words, and checks the model's pick", async () => {
    const { parsePricePick, priceNear } = await import("../../src/shared/watching/read")
    expect(priceNear(text, "Our price")).toEqual({ price: 36.5, currency: "USD", stock: "In stock" })
    expect(priceNear("Sold out. Price: 1.299,00 EUR", "Price")).toEqual({ price: 1299, currency: "EUR", stock: "Out of stock" })
    expect(priceNear(text, "Member price")).toBeNull()
    expect(parsePricePick('{"near":"Our price","price":36.5,"currency":"USD","name":"Glaze kit, 8 colours"}', text)).toEqual({ near: "Our price", name: "Glaze kit, 8 colours" })
    // An amount the page doesn't show after those words is no pick.
    expect(parsePricePick('{"near":"Our price","price":42}', text)).toBeNull()
  })

  it("the model picks once at setup, the saved words work after, and it picks again only when they break", async () => {
    const { checkPrice } = await import("../../src/main/watching/checks/price")
    let html = `<title>Glaze kit</title>${text.split("\n").map((l) => `<p>${l}</p>`).join("")}`
    let picks = 0
    const pick = async (t: string) => {
      picks++
      const near = t.includes("Our price") ? "Our price" : "Today"
      return { near, name: "Glaze kit, 8 colours" }
    }
    const d = { fetch: async () => new Response(html), now: () => T0 } as never
    const first = await checkPrice("shop.com/kit", undefined, d, { pick })
    expect(first.selector).toBe("Our price")
    expect(first.run).toMatchObject({ status: "quiet", metric: 36.5, stock: "In stock", product: "Glaze kit, 8 colours" })
    expect(first.run.facts).toContainEqual(["Found in", "The page’s text"])
    const again = await checkPrice("shop.com/kit", first.memo, d, { pick, selector: "Our price" })
    expect(picks).toBe(1)
    expect(again.selector).toBeUndefined()
    html = "<title>Glaze kit</title><p>Today $34.00</p><p>Add to cart</p>"
    const moved = await checkPrice("shop.com/kit", again.memo, d, { pick, selector: "Our price" })
    expect(picks).toBe(2)
    expect(moved.selector).toBe("Today")
    expect(moved.run.findings[0]).toMatchObject({ level: "news" })
  })
})
