import { motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"

import { withoutScripts } from "@shared/rich"

import { D, useMotion } from "@/lib/motion"
import { resolvedTheme, useStore } from "@/lib/store"

import { CheckIcon, CopyIcon, RetryIcon } from "../Icons"
import { CardFrame } from "./shared"

const VARS = ["ink", "ink-2", "ink-3", "ink-4", "ground", "card", "fill", "fill-2", "line", "line-2", "accent", "accent-ink", "accent-2", "ok", "bad", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"]

const themeVars = () => {
  const cs = getComputedStyle(document.documentElement)
  return Object.fromEntries(VARS.map((v) => [v, cs.getPropertyValue(`--${v}`).trim()]))
}

/**
 * A live figure the model wrote, run in a sealed frame (public/visual.html): its own origin, no
 * network, no way into the app. While it streams, the HTML so far shows without its scripts, so
 * shapes appear as they're written; when the block closes, the scripts run.
 */
export function VisualCard({ title, html, height, done }: { title?: string; html: string; height?: number; done: boolean }) {
  const m = useMotion()
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [fit, setFit] = useState<number | undefined>(undefined)
  const [run, setRun] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const theme = useStore((s) => resolvedTheme(s.settings.theme))
  const lines = html.split("\n").length

  const send = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { axeVisual: "render", html: done ? html : withoutScripts(html), run: done, vars: themeVars(), theme },
      "*",
    )
  }, [html, done, theme])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { axeVisual?: string; height?: number; message?: string }
      if (d?.axeVisual === "ready") setReady(true)
      else if (d?.axeVisual === "size" && typeof d.height === "number") setFit(d.height)
      else if (d?.axeVisual === "error") setFailed(d.message ?? "The visual hit an error.")
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  // While streaming, redraw at most a few times a second.
  useEffect(() => {
    if (!ready) return
    if (done) {
      send()
      return
    }
    const t = setTimeout(send, 160)
    return () => clearTimeout(t)
  }, [ready, send, done])

  const h = Math.round(Math.min(640, Math.max(80, height ?? fit ?? 240)))

  return (
    <CardFrame label={title ? `Visual: ${title}` : "Visual"} className="overflow-hidden">
      <div className="flex h-9 items-center gap-2 border-b border-border px-4 text-[12px] text-ink-3">
        {done ? (
          <span className="min-w-0 truncate">
            <span className="text-ink-2">{title ?? "Live visual"}</span>
            <span className="ml-2">{lines} lines</span>
          </span>
        ) : (
          <span className="shimmer">Drawing {title ? title.charAt(0).toLowerCase() + title.slice(1) : "a visual"}</span>
        )}
        <span className="flex-1" />
        {done && (
          <>
            <button
              onClick={() => {
                setReady(false)
                setFailed(null)
                setRun((n) => n + 1)
              }}
              aria-label="Play again"
              className="flex h-6 items-center gap-1.5 rounded-[6px] border-0 bg-transparent px-1.5 text-[12px] text-ink-3 transition-colors duration-150 hover:bg-fill-2 hover:text-ink"
            >
              <RetryIcon size={12} />
              Play again
            </button>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(html)
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              }}
              className="flex h-6 items-center gap-1.5 rounded-[6px] border-0 bg-transparent px-1.5 text-[12px] text-ink-3 transition-colors duration-150 hover:bg-fill-2 hover:text-ink"
            >
              {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              {copied ? "Copied" : "Copy code"}
            </button>
          </>
        )}
      </div>
      <motion.div initial={false} animate={{ height: h }} transition={m.t(D.base)} className="relative">
        <motion.iframe
          key={run}
          ref={frame}
          src="./visual.html"
          title={title ?? "Visual"}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="block h-full w-full border-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={m.t(D.slow)}
        />
      </motion.div>
      {failed && done && <div className="border-t-[0.5px] border-line px-4 py-2 text-[12px] text-ink-3">The visual hit an error: {failed}</div>}
    </CardFrame>
  )
}
