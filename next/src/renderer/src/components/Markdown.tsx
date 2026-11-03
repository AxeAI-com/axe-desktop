import { memo, useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { invoke } from "@/lib/bridge"
import { isUnifiedDiff } from "@/lib/diff"

import { CodeBlock as PastaCodeBlock } from "./ai/code-block"
import { DiffBlock } from "./DiffBlock"
import { type CiteSource, linkCitations, siteOf } from "@/lib/citations"
import { useSmoothText } from "@/lib/smooth-text"
import { dropThinkTags, holdPartialTable } from "@/lib/streaming-text"
import { splitRich } from "@shared/rich"

import { RichFence } from "./rich/RichBlock"

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[]; properties?: Record<string, unknown> }

/**
 * Wraps each word of the text in a span so new words fade in as they stream. Spans keep their place
 * when more text arrives, so only the new words animate. Code is left alone.
 */
export function rehypeWords() {
  const walk = (node: HastNode) => {
    if (!node.children) return
    if (node.tagName === "code" || node.tagName === "pre") return
    const out: HastNode[] = []
    for (const child of node.children) {
      if (child.type === "text" && child.value) {
        for (const token of child.value.split(/(\s+)/)) {
          if (!token) continue
          if (/^\s+$/.test(token)) out.push({ type: "text", value: token })
          else out.push({ type: "element", tagName: "span", properties: { className: ["w"] }, children: [{ type: "text", value: token }] })
        }
      } else {
        walk(child)
        out.push(child)
      }
    }
    node.children = out
  }
  return (tree: HastNode) => walk(tree)
}

// Fence names models use that Prism knows under another name (same list as the website).
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  html: "markup",
  xml: "markup",
  svg: "markup",
}

/**
 * A fenced code block in an answer: Pasta UI's code surface with line numbers and copy. A diff is drawn
 * as one (DiffBlock); plain output (no language, or text) gets no label and no line numbers.
 */
export function CodeBlock({ lang, text }: { lang?: string; text: string }) {
  const name = (lang ?? "").toLowerCase()
  if (isUnifiedDiff(name, text)) return <DiffBlock text={text} />
  const plain = !name || name === "text" || name === "txt" || name === "plaintext"
  return (
    <div className="wide selectable">
      <PastaCodeBlock className="my-1" code={text} filename={plain ? "" : name} language={LANGUAGE_ALIASES[name] ?? (name || "text")} showLineNumbers={!plain} />
    </div>
  )
}

const textOf = (node: unknown): string => {
  const n = node as HastNode
  if (n.type === "text") return n.value ?? ""
  return (n.children ?? []).map(textOf).join("")
}

const components: Components = {
  pre({ node }) {
    const code = node?.children?.[0] as HastNode | undefined
    const cls = (code?.properties?.className as string[] | undefined)?.find((c) => c.startsWith("language-"))
    return (
      <CodeBlock lang={cls?.slice(9)} text={textOf(code ?? node).replace(/\n$/, "")} />
    )
  },
  table({ children }) {
    return (
      <div className="wide overflow-x-auto">
        <table>{children}</table>
      </div>
    )
  },
  a({ href, children, title }) {
    if ((title === "cite" || title?.startsWith("cite:")) && href) {
      const n = title.startsWith("cite:") ? title.slice(5) : undefined
      return (
        <a
          href={href}
          className="cite"
          title={n ? `${n}. ${siteOf(href)}` : siteOf(href)}
          onClick={(e) => {
            e.preventDefault()
            void invoke("app:openExternal", href)
          }}
        >
          {n ?? siteOf(href).split(".").slice(-2, -1)[0] ?? children}
        </a>
      )
    }
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (href && /^https?:/.test(href)) void invoke("app:openExternal", href)
        }}
      >
        {children}
      </a>
    )
  },
}

/**
 * Splits live text at its last blank line outside a code fence: `done` is everything before it (blocks that
 * cannot change any more), `tail` the paragraph still growing.
 */
export function splitStable(text: string): { done: string[]; tail: string } {
  const blocks: string[] = []
  let fence = ""
  let start = 0
  let pos = 0
  let lastCut = 0
  const lines = text.split("\n")
  for (const line of lines) {
    const end = pos + line.length + 1
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (f) {
      if (!fence) fence = f
      else if (f[0] === fence[0] && f.length >= fence.length) fence = ""
    } else if (!fence && !line.trim() && end <= text.length) {
      if (text.slice(start, pos).trim()) blocks.push(text.slice(start, end))
      start = end
      lastCut = end
    }
    pos = end
  }
  return { done: blocks, tail: text.slice(lastCut) }
}

const NO_SOURCES: CiteSource[] = []

/** One run of answer text: markdown pieces and axe-* blocks. Memoised, so a finished block is not parsed again. */
const Pieces = memo(function Pieces({ text, live, sources }: { text: string; live: boolean; sources: CiteSource[] }) {
  const pieces = useMemo(() => splitRich(text), [text])
  const last = pieces.length - 1
  return (
    <>
      {pieces.map((p, i) => {
        const l = live && i === last
        return p.kind === "md" ? (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={l ? [rehypeWords] : []} components={components}>
            {linkCitations(l ? holdPartialTable(p.text) : p.text, sources, l)}
          </ReactMarkdown>
        ) : (
          <RichFence key={i} type={p.type} lang={p.lang} raw={p.raw} closed={p.closed} streaming={l} />
        )
      })}
    </>
  )
})

/** The answer's words: GitHub-flavoured markdown, styled to the reading column, with axe-* blocks drawn as cards. */
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
  sources = NO_SOURCES,
}: { text: string; streaming?: boolean; sources?: CiteSource[] }) {
  // Some models write narrow no-break spaces ("pastel\u202fde\u202fnata"): they read as missing spaces.
  const clean = useMemo(() => dropThinkTags(text).replace(/\u202f/g, " "), [text])
  // Text arrives in bursts; it is shown at a steady pace, running a moment past the end of the stream.
  const smooth = useSmoothText(clean, streaming)
  const flowing = !smooth.settled
  // Streaming: only the paragraph still growing is parsed again; the blocks before it are memoised.
  const { done, tail } = useMemo(() => (flowing ? splitStable(smooth.text) : { done: [] as string[], tail: smooth.text }), [smooth.text, flowing])
  return (
    <div className="md selectable">
      {done.map((b, i) => (
        <Pieces key={`${i}-${b}`} text={b} live={false} sources={sources} />
      ))}
      {/* Keyed by its place, so a new paragraph's words fade in rather than reuse the last one's spans. */}
      <Pieces key={done.length} text={tail} live={flowing} sources={sources} />
    </div>
  )
})
