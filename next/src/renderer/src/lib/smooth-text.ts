import { useEffect, useRef, useState } from "react"

// Answers arrive in bursts: a provider sends a few words, pauses, then a paragraph at
// once. Shown as they land, that reads as stop and start. Instead the text on screen
// follows the text received at a steady pace: quick when far behind, easing off as it
// catches up, so it flows without a stutter and never lags far behind. It shows whole
// words only, so each one can fade in once (rehypeWords in components/Markdown.tsx).

/** Characters per second for a given backlog: catches up in about 0.4 s, never crawls. */
const MIN_CPS = 45
const CATCH_UP_SECONDS = 0.4

/** Where the reveal should be after `dtMs`, moving toward `target`. */
export function advance(shown: number, target: number, dtMs: number) {
  if (shown >= target) return target
  const backlog = target - shown
  const cps = Math.max(MIN_CPS, backlog / CATCH_UP_SECONDS)
  return Math.min(target, shown + (cps * dtMs) / 1000)
}

/** The longest prefix of `text` within `n` characters that ends on a whole word. */
export function wholeWords(text: string, n: number) {
  if (n >= text.length) return text
  const cut = Math.floor(n)
  // Already at a word break.
  if (/\s/.test(text[cut] ?? "")) return text.slice(0, cut)
  const lastBreak = text.slice(0, cut).search(/\s\S*$/)
  return lastBreak < 0 ? "" : text.slice(0, lastBreak)
}

/**
 * The part of `text` to show now. While `streaming` (and until the reveal has caught
 * up afterwards) it grows smoothly; otherwise it is the whole text. `settled` is true
 * once everything is shown.
 */
export function useSmoothText(text: string, streaming: boolean) {
  // Whatever is already there when it first appears shows at once (history, or an answer
  // that was mid-stream when the page changed); only what arrives after flows in.
  const shownRef = useRef(text.length)
  const textRef = useRef(text)
  textRef.current = text
  const [, rerender] = useState(0)
  // Reduced motion: no pacing, just the text.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) shownRef.current = text.length
  const animating = shownRef.current < text.length

  useEffect(() => {
    if (!animating) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const target = textRef.current.length
      const next = advance(shownRef.current, target, Math.min(now - last, 100))
      last = now
      const before = Math.floor(shownRef.current)
      shownRef.current = next
      if (Math.floor(next) !== before) rerender((n) => n + 1)
      if (next < target) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // Restart the loop whenever more text arrives after it went idle.
  }, [animating])

  const shown = shownRef.current >= text.length ? text : wholeWords(text, shownRef.current)
  return { text: shown, settled: shown.length === text.length && !streaming }
}
