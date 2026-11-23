// The live loops (spec 0002). An element asks for one with `data-loop="lv-blink 1.2s ease-in-out"` (keyframes name,
// duration, easing, optional direction) and `data-delay` (seconds, negative to start part way through). The keyframes
// are the ones in live.css, read once from the style sheet; the loop runs through the Web Animations API, on the
// compositor (transform and opacity only).
//
// Why not plain CSS animations: React listens for `animationiteration` on its root, so Chrome wakes the main thread
// to dispatch an event at the end of every CSS loop. With a hundred loops that was most of the dashboard's CPU.
// Web animations send no such events; nothing here runs per frame.

/** The only loops that still run. */
const CALM = new Set(["lv-spin 1s linear"])

const frames = new Map<string, Keyframe[] | null>()

/** The keyframes of `@keyframes <name>` in the page's style sheets, as Web Animations keyframes. */
function keyframesOf(name: string): Keyframe[] | null {
  if (frames.has(name)) return frames.get(name)!
  let found: Keyframe[] | null = null
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSKeyframesRule) || r.name !== name) continue
      const out: Keyframe[] = []
      for (const k of Array.from(r.cssRules) as CSSKeyframeRule[])
        for (const at of k.keyText.split(",")) {
          const t = at.trim()
          const f: Keyframe = { offset: t === "from" ? 0 : t === "to" ? 1 : Number.parseFloat(t) / 100 }
          for (const p of ["transform", "opacity"] as const) {
            const v = k.style.getPropertyValue(p)
            if (v) f[p] = v
          }
          out.push(f)
        }
      found = out.sort((a, b) => (a.offset as number) - (b.offset as number))
    }
  }
  frames.set(name, found)
  return found
}

/** Props for an element that loops: `{...loop("lv-blink 1.2s ease-in-out", -0.3)}`. */
export function loop(spec: string, delay?: number): Record<string, string> {
  return delay ? { "data-loop": spec, "data-delay": delay.toFixed(3) } : { "data-loop": spec }
}

/** Starts a loop `delay` s later than the rest, as a negative delay into its cycle. */
export const late = (delay: number, period: number) => -((period - (delay % period)) % period)

type Running = { key: string; anim: Animation; seen: boolean }
const running = new Map<Element, Running>()
let paused = false
let users = 0
let observer: MutationObserver | undefined
let view: IntersectionObserver | undefined
let still: MediaQueryList | undefined

/** A loop plays while the window is here and it's on screen. Odometer digits (`data-clock`) keep real time, so
 *  they only stop with the window. */
function sync(r: Running) {
  const on = !paused && r.seen
  if (on && r.anim.playState === "paused") r.anim.play()
  else if (!on && r.anim.playState === "running") r.anim.pause()
}

function drop(el: Element) {
  running.get(el)?.anim.cancel()
  running.delete(el)
  view?.unobserve(el)
}

function start(el: HTMLElement) {
  const spec = el.dataset.loop
  const key = `${spec}|${el.dataset.delay ?? ""}`
  const was = running.get(el)
  if (was?.key === key) return
  drop(el)
  if (!spec || still?.matches) return
  const [name, dur = "1s", easing = "linear", direction = "normal"] = spec.split(" ")
  // Calm motion (2026-11-08): only the spinner on a check that is running keeps moving. Sweeps, pings, blinks,
  // waves and scrolling logs stay still.
  if (!CALM.has(spec)) return
  const kf = keyframesOf(name!)
  if (!kf) return
  const anim = el.animate(kf, {
    id: "lv",
    duration: Number.parseFloat(dur) * 1000,
    easing,
    direction: direction as PlaybackDirection,
    iterations: Number.POSITIVE_INFINITY,
    delay: Number.parseFloat(el.dataset.delay ?? "0") * 1000,
  })
  const r: Running = { key, anim, seen: true }
  running.set(el, r)
  sync(r)
  if (el.dataset.clock === undefined) view?.observe(el)
}

/** Drops the loops of elements that left the page. */
function prune() {
  for (const el of running.keys()) if (!el.isConnected) drop(el)
}

function scan(root: ParentNode = document) {
  prune()
  if (root instanceof HTMLElement && root.dataset.loop !== undefined) start(root)
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-loop]"))) start(el)
}

function stopAll() {
  for (const el of [...running.keys()]) drop(el)
}

/** Pauses or plays every loop (the window hidden, or back). */
export function pauseLoops(p: boolean) {
  paused = p
  for (const r of running.values()) sync(r)
}

const onMotion = () => (still?.matches ? stopAll() : scan())

/** Runs the loops while a live page is mounted: one observer for the whole window, started by the first user. */
export function startLoops() {
  users++
  if (users > 1) return
  still = window.matchMedia("(prefers-reduced-motion: reduce)")
  still.addEventListener("change", onMotion)
  view = new IntersectionObserver((list) => {
    for (const e of list) {
      const r = running.get(e.target)
      if (!r) continue
      r.seen = e.isIntersecting
      sync(r)
    }
  })
  observer = new MutationObserver((list) => {
    let gone = false
    for (const m of list) {
      if (m.type === "attributes" && m.target instanceof HTMLElement) start(m.target)
      else if (m.removedNodes.length) gone = true
      for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement) scan(n)
    }
    if (gone) prune()
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-loop", "data-delay"] })
  scan()
}

export function stopLoops() {
  users = Math.max(0, users - 1)
  if (users) return
  observer?.disconnect()
  observer = undefined
  still?.removeEventListener("change", onMotion)
  stopAll()
  view?.disconnect()
  view = undefined
}
