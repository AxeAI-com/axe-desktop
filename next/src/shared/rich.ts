import { z } from "zod"

// Rich replies: cards a model can put in an answer by writing a fenced block whose
// language is axe-<kind> and whose body is JSON (```axe-chart {...} ```). The window
// draws the card; when the JSON is broken, or the reply ended mid-block, it shows the
// plain code block instead. The same shapes come from the website's own tools
// (show_map, draft_email), mapped in fromTool().

const text = (max: number) => z.string().trim().min(1).max(max)
const num = z.coerce.number().refine(Number.isFinite, "Not a number")

// ---------- Choices: two to four options you click to answer ----------

const choiceOption = z.union([
  text(140).transform((label) => ({ label })),
  z.object({
    label: text(140),
    detail: z.string().trim().max(280).optional(),
    recommended: z.boolean().optional(),
  }),
])

export const choicesSchema = z.object({
  question: z.string().trim().max(200).optional(),
  options: z.array(choiceOption).max(4),
})

// ---------- Charts: bar, line, area, donut ----------

const series = z.object({ name: z.string().trim().max(60).default(""), values: z.array(num).max(400) })

export const chartSchema = z
  .object({
    type: z.enum(["bar", "line", "area", "donut"]).default("bar"),
    title: z.string().trim().max(120).optional(),
    /** Put before or after every value: "$", "%", " h". */
    prefix: z.string().max(4).optional(),
    suffix: z.string().max(6).optional(),
    labels: z.array(z.coerce.string()).max(400).optional(),
    series: z.array(series).max(5).optional(),
    /** Shorthand for one series: [{ "label": "Mon", "value": 4 }]. */
    data: z.array(z.object({ label: z.coerce.string(), value: num })).max(400).optional(),
  })
  .transform((c) => {
    const labels = c.data ? c.data.map((d) => d.label) : (c.labels ?? [])
    const all = c.data ? [{ name: "", values: c.data.map((d) => d.value) }] : (c.series ?? [])
    const n = Math.max(labels.length, ...all.map((s) => s.values.length), 0)
    const filled = Array.from({ length: n }, (_, i) => labels[i] ?? String(i + 1))
    return {
      type: c.type,
      title: c.title,
      prefix: c.prefix ?? "",
      suffix: c.suffix ?? "",
      labels: filled,
      // A donut shows one series.
      series: (c.type === "donut" ? all.slice(0, 1) : all).filter((s) => s.values.length > 0),
    }
  })

// ---------- Maps: places with pins ----------

const place = z.object({
  name: text(120),
  note: z.string().trim().max(200).optional(),
  group: z.string().trim().max(40).optional(),
  lat: num.refine((v) => v >= -90 && v <= 90, "Latitude out of range"),
  lon: num.refine((v) => v >= -180 && v <= 180, "Longitude out of range"),
})

export const mapSchema = z.object({
  title: z.string().trim().max(120).optional(),
  places: z.array(place).max(25),
})

// ---------- Drafts: an email or a post to edit and copy ----------

export const draftSchema = z
  .object({
    kind: z.enum(["email", "post"]).default("email"),
    /** Where a post goes: "X", "LinkedIn", "Instagram". */
    channel: z.string().trim().max(30).optional(),
    to: z.union([z.string().trim().max(400), z.array(z.string().trim().max(254)).max(20)]).optional(),
    subject: z.string().trim().max(300).optional(),
    body: z.string().trim().max(20_000),
  })
  // `kind` names the card itself, so the draft's own kind travels as `format`.
  .transform(({ kind, to, ...rest }) => ({ format: kind, ...rest, to: (Array.isArray(to) ? to.join(", ") : to) || undefined }))

// ---------- Tables that sort ----------

export const tableSchema = z.object({
  title: z.string().trim().max(120).optional(),
  columns: z.array(z.coerce.string()).max(12),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]).transform((v) => (v === null ? "" : v))).max(12)).max(200),
})

// ---------- Live visuals: HTML, SVG and script run in a sealed frame ----------

export const visualSchema = z.object({
  title: z.string().trim().max(120).optional(),
  /** Height in px the frame starts at; it then fits its content (80 to 640). */
  height: z.coerce.number().min(80).max(640).optional(),
  html: z.string().max(60_000),
})

// ---------- The one union ----------

export type RichChoices = { kind: "choices" } & z.infer<typeof choicesSchema>
export type RichChart = { kind: "chart" } & z.infer<typeof chartSchema>
export type RichMap = { kind: "map" } & z.infer<typeof mapSchema>
export type RichDraft = { kind: "draft" } & z.infer<typeof draftSchema>
export type RichTable = { kind: "table" } & z.infer<typeof tableSchema>
export type RichVisual = { kind: "visual" } & z.infer<typeof visualSchema>
export type RichBlock = RichChoices | RichChart | RichMap | RichDraft | RichTable | RichVisual
export type RichKind = RichBlock["kind"]

export const RICH_KINDS: readonly RichKind[] = ["choices", "chart", "map", "draft", "table", "visual"]

const schemas = {
  choices: choicesSchema,
  chart: chartSchema,
  map: mapSchema,
  draft: draftSchema,
  table: tableSchema,
  visual: visualSchema,
} as const

/** "axe-chart" → "chart"; anything else → undefined. */
export function richKind(lang: string | undefined): RichKind | undefined {
  const m = /^axe-([a-z]+)$/.exec(lang?.trim().toLowerCase() ?? "")
  return m && (RICH_KINDS as readonly string[]).includes(m[1]!) ? (m[1] as RichKind) : undefined
}

/** Whether a card has nothing to show (valid, but no options, points, places or rows). */
export function isEmpty(b: RichBlock): boolean {
  switch (b.kind) {
    case "choices":
      return b.options.length === 0
    case "chart":
      return b.series.length === 0 || b.labels.length === 0
    case "map":
      return b.places.length === 0
    case "draft":
      return !b.body
    case "table":
      return b.columns.length === 0 || b.rows.length === 0
    case "visual":
      return !b.html.trim()
  }
}

export type RichParse = { ok: true; block: RichBlock } | { ok: false; error: string }

/** Models write "detail": null for a field they skip; drop those keys (array items stay, for table cells). */
const dropNulls = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(dropNulls) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)])) : v

/** Models often leave a comma before a closing bracket; JSON doesn't allow it. */
const looseJSON = (raw: string): unknown => {
  try {
    return dropNulls(JSON.parse(raw))
  } catch {
    return dropNulls(JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1")))
  }
}

/** Reads a block's body. A visual may also be bare HTML or SVG instead of JSON. */
export function parseRich(kind: RichKind, raw: string): RichParse {
  const body = raw.trim()
  if (kind === "visual" && body.startsWith("<")) return { ok: true, block: { kind, html: body } }
  let json: unknown
  try {
    json = looseJSON(body)
  } catch {
    return { ok: false, error: "The card's data isn't valid JSON." }
  }
  const out = schemas[kind].safeParse(json)
  if (!out.success) return { ok: false, error: out.error.issues[0]?.message ?? "The card's data doesn't fit." }
  return { ok: true, block: { kind, ...out.data } as RichBlock }
}

/**
 * What a visual has so far while it streams: its title and the HTML written up to now,
 * read straight out of the unfinished JSON (or bare HTML).
 */
export function partialVisual(raw: string): { title?: string; html: string } {
  const body = raw.trim()
  if (body.startsWith("<")) return { html: body }
  const read = (key: string) => {
    const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(body)
    if (!m) return undefined
    let out = ""
    for (let i = m.index + m[0].length; i < body.length; i++) {
      const c = body[i]!
      if (c === '"') return out
      if (c !== "\\") {
        out += c
        continue
      }
      const n = body[i + 1]
      if (n === undefined) break
      if (n === "u") {
        const hex = body.slice(i + 2, i + 6)
        if (!/^[0-9a-f]{4}$/i.test(hex)) break
        out += String.fromCharCode(parseInt(hex, 16))
        i += 5
      } else {
        out += ({ n: "\n", t: "\t", r: "", b: "", f: "" } as Record<string, string>)[n] ?? n
        i += 1
      }
    }
    return out
  }
  const title = read("title")
  return { ...(title ? { title } : {}), html: read("html") ?? "" }
}

/** HTML safe to show while it's still arriving: scripts (finished or not) taken out. */
export const withoutScripts = (html: string) => html.replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, "")

// ---------- Cutting a reply's text into words and cards ----------

export type RichPiece =
  | { kind: "md"; text: string }
  /** `closed` is false while the block is still streaming (or the reply was cut off in it). */
  | { kind: "rich"; type: RichKind; lang: string; raw: string; closed: boolean }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)(.*)$/

/**
 * Splits markdown into plain runs and axe-* blocks. Other fenced code is left inside the
 * markdown untouched, so an axe block quoted inside a ```markdown fence stays code.
 * Models sometimes put a whole block on one line (```axe-chart {...}```) or start the JSON
 * on the fence line; both count.
 */
export function splitRich(text: string): RichPiece[] {
  const lines = text.split("\n")
  const out: RichPiece[] = []
  let md: string[] = []
  const flush = () => {
    if (md.length && md.some((l) => l.trim())) out.push({ kind: "md", text: md.join("\n") })
    md = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const open = FENCE.exec(line)
    const type = open ? richKind(open[2]) : undefined
    // A plain code fence's info string can't hold backticks; an axe block's opening line may hold its JSON.
    if (!open || (!type && open[1]![0] === "`" && open[3]!.includes("`"))) {
      md.push(line)
      continue
    }
    const fence = open[1]!
    const lang = open[2] ?? ""
    let rest = type ? open[3]!.trim() : ""
    const closer = fence[0]!.repeat(3)
    if (type && rest.endsWith(closer)) {
      flush()
      out.push({ kind: "rich", type, lang, raw: rest.slice(0, -3).replace(/[`~]+$/, "").trim(), closed: true })
      continue
    }
    const closes = (l: string) => {
      const t = l.trim()
      return t.startsWith(fence[0]!.repeat(fence.length)) && /^[`~]+$/.test(t)
    }
    let j = i + 1
    // A closing fence glued to the last line of JSON: {...}```
    let tail = ""
    while (j < lines.length && !closes(lines[j]!)) {
      if (type && lines[j]!.trimEnd().endsWith(closer) && !lines[j]!.trim().startsWith(closer)) {
        tail = lines[j]!.trimEnd().slice(0, -3)
        break
      }
      j++
    }
    const closed = j < lines.length
    if (type) {
      flush()
      const body = [...(rest ? [rest] : []), ...lines.slice(i + 1, j), ...(tail ? [tail] : [])]
      out.push({ kind: "rich", type, lang, raw: body.join("\n"), closed })
    } else {
      md.push(...lines.slice(i, closed ? j + 1 : j))
    }
    i = j
    rest = ""
  }
  flush()
  return out
}

// ---------- The website's own tools, drawn as the same cards ----------

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * show_map (its output, with found places) and draft_email (its input) as cards.
 * Undefined for any other tool, or when there's nothing to draw.
 */
export function fromTool(name: string, input: unknown, output: unknown): RichBlock | undefined {
  if (name === "show_map") {
    const o = rec(output)
    const places = (Array.isArray(o.places) ? o.places : []).flatMap((p) => {
      const r = rec(p)
      const loc = rec(r.location)
      return typeof loc.lat === "number" && typeof loc.lon === "number" ? [{ name: r.name, note: r.note, group: r.group, lat: loc.lat, lon: loc.lon }] : []
    })
    const out = mapSchema.safeParse({ title: o.title, places })
    return out.success && out.data.places.length ? { kind: "map", ...out.data } : undefined
  }
  if (name === "draft_email") {
    const out = draftSchema.safeParse({ kind: "email", ...rec(input) })
    return out.success && out.data.body ? { kind: "draft", ...out.data } : undefined
  }
  return undefined
}

// ---------- What the model is told ----------

/**
 * Chats from before axeai.com took `clientHints` (2026-10-23) carry the card instructions at the end of
 * their first message, inside these tags; the app strips them when it shows the message. Since then the
 * app sends `clientHints: ["rich-cards"]` and the website adds the instructions to its system prompt
 * (axe-web `apps/api/src/features/chat/rich-cards.ts`, which lists the blocks this file parses).
 */
export const RICH_HINT_OPEN = "<axe-desktop-cards>"
export const RICH_HINT_CLOSE = "</axe-desktop-cards>"
