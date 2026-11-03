// Some models cite search results by the source's id in lenticular brackets ("…in 1889【5140c9596a24】",
// "【5140c9596a24†L3-L9】") or plain brackets ("[5140c9596a24]"). Those become numbered links to the source,
// which the answer draws as small source chips; brackets that match no source are dropped, never shown raw.
// (Same rules as axe-web's citations-text.ts.)

export type CiteSource = { id: string; url: string; title: string }

const LENTICULAR = /【([^】]*)】/g
const BRACKETED_ID = /\[([0-9a-f]{12})\](?!\()/g
/** An unfinished bracket at the end of a streaming answer: hidden until it closes. */
const OPEN_TAIL = /【[^】]*$/

export function linkCitations(text: string, sources: CiteSource[], streaming: boolean): string {
  if (!text.includes("【") && !/\[[0-9a-f]{12}\]/.test(text)) return text
  const index = new Map(sources.map((s, i) => [s.id, { n: i + 1, url: s.url }]))
  const link = (raw: string) => {
    const hit = index.get(raw.trim().split("†")[0]?.trim() ?? "")
    return hit ? ` [${hit.n}](${hit.url} "cite:${hit.n}")` : ""
  }
  let out = text.replace(LENTICULAR, (_, inner: string) => link(inner)).replace(BRACKETED_ID, (_, id: string) => link(id))
  if (streaming) out = out.replace(OPEN_TAIL, "")
  // The same source twice in a row reads as one chip.
  return out.replace(/( \[\d+\]\(([^ )]+) "cite:\d+"\))(?: \[\d+\]\(\2 "cite:\d+"\))+/g, "$1")
}

export const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/**
 * Research reports cite by number ("[2]", "[1, 3]"). Each number that names a source becomes the same
 * small chip as above, showing its number to match the report's source list; unknown numbers stay as written. (Same rule as axe-web's research/parse.ts.)
 */
export function linkNumbered(markdown: string, sources: { n: number; url: string }[]): string {
  const byNumber = new Map(sources.map((s) => [s.n, s.url]))
  return markdown.replace(/\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\](?!\()/g, (match, list: string) => {
    const nums = list.split(/[,;]/).map((n) => Number(n.trim()))
    if (!nums.every((n) => byNumber.has(n))) return match
    return nums.map((n) => ` [${n}](${byNumber.get(n)} "cite:${n}")`).join("")
  })
}
