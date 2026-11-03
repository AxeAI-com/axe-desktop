import { describe, expect, it } from "vitest"

import { fromTool, isEmpty, parseRich, partialVisual, richKind, splitRich, withoutScripts, type RichChart } from "@shared/rich"
import type { ChatMessage, Json } from "@shared/types"

import { applyChunk, storedMessage } from "../../src/main/axe/stream"

const fence = (lang: string, body: string, close = true) => `\`\`\`${lang}\n${body}${close ? "\n```" : ""}`

describe("splitRich", () => {
  it("cuts words and cards apart, in order", () => {
    const text = `Here are the numbers.\n\n${fence("axe-chart", '{"type":"bar","data":[{"label":"A","value":1}]}')}\n\nThat's all.`
    const pieces = splitRich(text)
    expect(pieces.map((p) => p.kind)).toEqual(["md", "rich", "md"])
    expect(pieces[1]).toMatchObject({ type: "chart", lang: "axe-chart", closed: true })
    expect(pieces[2]).toMatchObject({ text: "\nThat's all." })
  })

  it("marks a block that hasn't closed yet", () => {
    const pieces = splitRich(`Look:\n${fence("axe-choices", '{"options":["A", "B"', false)}`)
    expect(pieces.at(-1)).toMatchObject({ kind: "rich", type: "choices", closed: false, raw: '{"options":["A", "B"' })
  })

  it("leaves other code, and axe blocks quoted inside it, as markdown", () => {
    const text = `${fence("ts", "const a = 1")}\n\n\`\`\`\`markdown\n${fence("axe-chart", "{}")}\n\`\`\`\``
    const pieces = splitRich(text)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]!.kind).toBe("md")
  })

  it("ignores unknown axe-* languages and is case-blind about known ones", () => {
    expect(richKind("axe-chart")).toBe("chart")
    expect(richKind("AXE-Map")).toBe("map")
    expect(richKind("axe-hologram")).toBeUndefined()
    expect(richKind("json")).toBeUndefined()
    expect(splitRich(fence("axe-hologram", "{}"))[0]!.kind).toBe("md")
  })

  it("accepts ~~~ fences and drops whitespace-only runs", () => {
    const pieces = splitRich(`~~~axe-table\n{"columns":["a"],"rows":[[1]]}\n~~~\n\n`)
    expect(pieces).toEqual([{ kind: "rich", type: "table", lang: "axe-table", raw: '{"columns":["a"],"rows":[[1]]}', closed: true }])
  })
})

describe("parseRich", () => {
  it("reads a chart with series and fills missing labels", () => {
    const r = parseRich("chart", '{"type":"line","prefix":"$","series":[{"name":"Sales","values":[1,"2",3]}]}')
    expect(r.ok).toBe(true)
    const c = (r as { block: RichChart }).block
    expect(c).toMatchObject({ kind: "chart", type: "line", prefix: "$", suffix: "", labels: ["1", "2", "3"] })
    expect(c.series[0]!.values).toEqual([1, 2, 3])
  })

  it("reads the data shorthand and keeps one series for a donut", () => {
    const r = parseRich("chart", '{"type":"donut","data":[{"label":"Ads","value":40},{"label":"SEO","value":60}]}')
    expect(r).toMatchObject({ ok: true, block: { labels: ["Ads", "SEO"], series: [{ name: "", values: [40, 60] }] } })
  })

  it("forgives a trailing comma", () => {
    expect(parseRich("choices", '{"options":["Yes","No",],}').ok).toBe(true)
  })

  it("turns plain-string options into labels", () => {
    expect(parseRich("choices", '{"question":"Tone?","options":["Warm",{"label":"Sharp","recommended":true}]}')).toEqual({
      ok: true,
      block: { kind: "choices", question: "Tone?", options: [{ label: "Warm" }, { label: "Sharp", recommended: true }] },
    })
  })

  it("fails on broken JSON and on data that doesn't fit", () => {
    expect(parseRich("chart", '{"type":"bar", "data": [')).toEqual({ ok: false, error: "The card's data isn't valid JSON." })
    expect(parseRich("chart", '{"type":"pie"}').ok).toBe(false)
    expect(parseRich("map", '{"places":[{"name":"X","lat":200,"lon":0}]}').ok).toBe(false)
    expect(parseRich("draft", '{"subject":"Hi"}').ok).toBe(false)
  })

  it("keeps a draft's own kind as format and joins recipients", () => {
    expect(parseRich("draft", '{"kind":"post","channel":"X","body":"Hello"}')).toMatchObject({ ok: true, block: { kind: "draft", format: "post", channel: "X" } })
    expect(parseRich("draft", '{"to":["a@x.com","b@x.com"],"body":"Hi"}')).toMatchObject({ block: { format: "email", to: "a@x.com, b@x.com" } })
  })

  it("takes a visual as JSON or as bare HTML", () => {
    expect(parseRich("visual", "<svg></svg>")).toEqual({ ok: true, block: { kind: "visual", html: "<svg></svg>" } })
    expect(parseRich("visual", '{"title":"Orbit","height":300,"html":"<canvas></canvas>"}')).toMatchObject({ ok: true, block: { title: "Orbit", height: 300 } })
  })

  it("tells empty cards apart", () => {
    const empty = (kind: Parameters<typeof parseRich>[0], raw: string) => {
      const r = parseRich(kind, raw)
      if (!r.ok) throw new Error(r.error)
      return isEmpty(r.block)
    }
    expect(empty("chart", '{"type":"bar","data":[]}')).toBe(true)
    expect(empty("choices", '{"options":[]}')).toBe(true)
    expect(empty("map", '{"places":[]}')).toBe(true)
    expect(empty("table", '{"columns":["a"],"rows":[]}')).toBe(true)
    expect(empty("draft", '{"body":""}')).toBe(true)
    expect(empty("chart", '{"type":"bar","data":[{"label":"a","value":0}]}')).toBe(false)
  })
})

describe("visuals while they stream", () => {
  it("reads the HTML so far out of unfinished JSON, escapes and all", () => {
    expect(partialVisual('{"title":"Waves","html":"<svg width=\\"10\\">\\n<circle')).toEqual({ title: "Waves", html: '<svg width="10">\n<circle' })
    expect(partialVisual('{"title":"Wa')).toEqual({ title: "Wa", html: "" })
    expect(partialVisual('{"html":"a\\u00e9b')).toEqual({ html: "aéb" })
    expect(partialVisual("<div>hi")).toEqual({ html: "<div>hi" })
  })

  it("drops scripts, finished or not", () => {
    expect(withoutScripts("<p>a</p><script>go()</script><p>b</p><script>half")).toBe("<p>a</p><p>b</p>")
  })
})

describe("cards from the website's tools", () => {
  const output: Json = { title: "Lisbon", places: [{ name: "Prado", query: "Prado, Lisbon", location: { lat: 38.71, lon: -9.13 } }, { name: "Lost", query: "x" }] }

  it("maps show_map's found places and draft_email's input", () => {
    expect(fromTool("show_map", {}, output)).toEqual({ kind: "map", title: "Lisbon", places: [{ name: "Prado", lat: 38.71, lon: -9.13 }] })
    expect(fromTool("draft_email", { subject: "Hi", body: "Hello Jack" }, undefined)).toMatchObject({ kind: "draft", format: "email", subject: "Hi", body: "Hello Jack" })
    expect(fromTool("web_search", {}, {})).toBeUndefined()
    expect(fromTool("show_map", {}, { places: [] })).toBeUndefined()
  })

  it("adds the card to a streaming reply once, after the tool step", () => {
    const m: ChatMessage = { id: "r", role: "assistant", parts: [] }
    applyChunk(m, { type: "tool-input-start", toolCallId: "c1", toolName: "show_map" })
    applyChunk(m, { type: "tool-input-available", toolCallId: "c1", toolName: "show_map", input: { places: [] } })
    applyChunk(m, { type: "tool-output-available", toolCallId: "c1", output })
    applyChunk(m, { type: "tool-output-available", toolCallId: "c1", output })
    expect(m.parts.map((p) => p.type)).toEqual(["tool", "rich"])
    applyChunk(m, { type: "tool-input-available", toolCallId: "c2", toolName: "draft_email", input: { subject: "S", body: "B" } })
    expect(m.parts.at(-1)).toMatchObject({ type: "rich", id: "rich-c2", block: { kind: "draft", body: "B" } })
  })

  it("adds it to a stored message too", () => {
    const m = storedMessage({ id: "s", role: "assistant", parts: [{ type: "tool-show_map", toolCallId: "c9", state: "output-available", input: {}, output }] })!
    expect(m.parts.map((p) => p.type)).toEqual(["tool", "rich"])
  })
})

describe("blocks the way models really write them", () => {
  it("takes a whole block on one line", () => {
    const pieces = splitRich('Here:\n```axe-chart {"type":"bar","data":[{"label":"A","value":1}]}```\nDone.')
    expect(pieces.map((p) => p.kind)).toEqual(["md", "rich", "md"])
    expect(pieces[1]).toMatchObject({ type: "chart", closed: true, raw: '{"type":"bar","data":[{"label":"A","value":1}]}' })
  })

  it("takes JSON that starts on the fence line, or a fence glued to its end", () => {
    expect(splitRich('```axe-choices {"options":\n["A","B"]}\n```')[0]).toMatchObject({ raw: '{"options":\n["A","B"]}', closed: true })
    expect(splitRich('```axe-choices\n{"options":["A","B"]}```\nAfter')).toEqual([
      { kind: "rich", type: "choices", lang: "axe-choices", raw: '{"options":["A","B"]}', closed: true },
      { kind: "md", text: "After" },
    ])
    expect(splitRich('```axe-chart {"type":"bar"')[0]).toMatchObject({ raw: '{"type":"bar"', closed: false })
  })

  it("ignores null for fields a model skipped", () => {
    expect(parseRich("choices", '{"question":"Q","options":[{"label":"Growth","detail":null,"recommended":null}],"recommended":null}')).toEqual({
      ok: true,
      block: { kind: "choices", question: "Q", options: [{ label: "Growth" }] },
    })
  })

  it("leaves inline code alone", () => {
    expect(splitRich("Use ```ts const a``` here")[0]!.kind).toBe("md")
  })
})
