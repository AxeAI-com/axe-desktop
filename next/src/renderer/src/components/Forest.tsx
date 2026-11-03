import { AnimatePresence, motion } from "motion/react"
import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { D, useMotion } from "@/lib/motion"
import { useStore } from "@/lib/store"

import { FOX } from "./Pet"

// The fox's forest: a still night scene in type (stars, a moon, two rows of pines, the fox on the
// grass) behind the chat. Click the fox and it opens out from the fox through a soft edge while its
// layers settle in, back to front; click again and it folds back. All once, on the slow speed.

type Ink = "star" | "moon" | "ridge" | "far" | "near" | "ground" | "fox"
type Cell = { ch: string; ink: Ink } | null

const COLOR: Record<Ink, string> = {
  star: "var(--star)",
  moon: "var(--moon)",
  ridge: "var(--star)",
  far: "var(--forest-far)",
  near: "var(--forest)",
  ground: "var(--forest-ground)",
  fox: "var(--pet)",
}

const MOON = ["  _..._", ".'     '.", ":       :", "'.     .'", "  '---'"]

/** Same forest every time for the same size. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A pine `h` rows tall whose trunk stands on `base`, centred on `col`: needles out from a trunk. */
function pine(grid: Cell[][], col: number, base: number, h: number, ink: Ink) {
  const put = (r: number, c: number, ch: string) => {
    if (grid[r] && c >= 0 && c < grid[r]!.length) grid[r]![c] = { ch, ink }
  }
  const top = base - h
  put(top, col, "^")
  // Tiers: each widens for a few rows, then the next starts a little narrower.
  let w = 0
  for (let i = 1; i < h; i++) {
    w = i > 2 && i % 3 === 0 ? Math.max(1, w - 1) : w + 1
    for (let k = 1; k <= w; k++) {
      put(top + i, col - k, "/")
      put(top + i, col + k, "\\")
    }
    put(top + i, col, "|")
  }
  put(base, col, "|")
}

/** A far ridge of hills across the middle: a walk up and down, drawn with / \\ and _. */
function ridge(grid: Cell[][], rnd: () => number, from: number, to: number) {
  const cols = grid[0]?.length ?? 0
  let r = Math.round((from + to) / 2)
  for (let c = 0; c < cols; c++) {
    const step = rnd()
    const next = step < 0.3 ? Math.max(from, r - 1) : step > 0.7 ? Math.min(to, r + 1) : r
    const ch = next < r ? "/" : next > r ? "\\" : "_"
    const row = next < r ? r : next > r ? next : r
    if (grid[row]) grid[row]![c] = { ch, ink: "ridge" }
    r = next
  }
}

/** The scene for a grid of `cols` × `rows` characters. */
export function forestScene(cols: number, rows: number): Cell[][] {
  const rnd = random(cols * 131 + rows)
  const grid: Cell[][] = Array.from({ length: rows }, () => Array<Cell>(cols).fill(null))
  const ground = rows - 2

  // Stars in the upper half.
  for (let r = 0; r < Math.floor(rows * 0.55); r++)
    for (let c = 0; c < cols; c++) if (rnd() < 0.012) grid[r]![c] = { ch: rnd() < 0.25 ? "*" : rnd() < 0.5 ? "·" : ".", ink: "star" }

  // The moon, high on the right.
  const mc = Math.max(0, Math.floor(cols * 0.78))
  MOON.forEach((line, i) => [...line].forEach((ch, j) => ch !== " " && grid[1 + i] && mc + j < cols && (grid[1 + i]![mc + j] = { ch, ink: "moon" })))

  // Hills far off, then far pines (small, many), then near pines (tall, fewer), leaving room for the fox.
  ridge(grid, rnd, Math.floor(rows * 0.63), Math.floor(rows * 0.7))
  const tall = (lo: number, hi: number) => Math.max(3, Math.floor(rows * (lo + rnd() * (hi - lo))))
  for (let c = 2 + Math.floor(rnd() * 4); c < cols - 2; c += 5 + Math.floor(rnd() * 5)) pine(grid, c, ground - 2, tall(0.12, 0.2), "far")
  const foxAt = Math.floor(cols * 0.6)
  for (let c = 4 + Math.floor(rnd() * 6); c < cols - 3; c += 12 + Math.floor(rnd() * 10)) {
    if (Math.abs(c - foxAt - 6) < 14) continue
    pine(grid, c, ground, tall(0.2, 0.34), "near")
  }

  // Grass.
  for (let r = ground + 1; r < rows; r++) for (let c = 0; c < cols; c++) grid[r]![c] = { ch: r === ground + 1 ? (rnd() < 0.3 ? "," : rnd() < 0.5 ? "'" : "_") : rnd() < 0.15 ? "." : " ", ink: "ground" }

  // The fox, sitting on the grass.
  const lines = FOX.split("\n")
  lines.forEach((line, i) =>
    [...line].forEach((ch, j) => {
      const r = ground - lines.length + 1 + i
      if (ch !== " " && grid[r] && foxAt + j < cols) grid[r]![foxAt + j] = { ch, ink: "fox" }
    }),
  )
  return grid
}

const CHAR_H = 14
// How soft the reveal's edge is.
const FEATHER = 160
// Back to front: they settle in one after another as the forest opens.
const LAYERS: Ink[][] = [["star", "moon"], ["ridge"], ["far"], ["near", "ground"], ["fox"]]

/** One `<span>` per run of the same ink. */
function Row({ cells }: { cells: Cell[] }) {
  const out: React.ReactNode[] = []
  let run = ""
  let ink: Ink | null = null
  const flush = (k: number) => {
    if (!run) return
    out.push(ink ? <span key={k} style={{ color: COLOR[ink] }}>{run}</span> : run)
    run = ""
  }
  cells.forEach((c, i) => {
    const next = c?.ink ?? null
    if (next !== ink) {
      flush(i)
      ink = next
    }
    run += c?.ch ?? " "
  })
  flush(cells.length)
  return <>{out}</>
}

export function Forest() {
  // Only behind a new chat, where the fox is.
  const at = useStore((s) => (s.view.kind === "new" ? s.forest : null))
  const m = useMotion()
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0, cw: 7.2 })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    // The width of one character of the monospace font, measured once.
    const ctx = document.createElement("canvas").getContext("2d")
    if (ctx) ctx.font = `12px ${getComputedStyle(el).fontFamily}`
    const cw = ctx?.measureText("M").width || 7.2
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight, cw })
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cols = Math.max(0, Math.floor(size.w / size.cw))
  const rows = Math.max(0, Math.floor(size.h / CHAR_H))
  const scene = useMemo(() => (at && cols && rows ? forestScene(cols, rows) : null), [at, cols, rows])

  // Where the fox is, inside this pane, and how far the reveal must reach to cover it.
  const rect = box.current?.getBoundingClientRect()
  const x = at && rect ? at.x - rect.left : 0
  const y = at && rect ? at.y - rect.top : 0
  const reach = Math.hypot(Math.max(x, size.w - x), Math.max(y, size.h - y)) + FEATHER
  // A soft edge, not a hard circle: the forest fades in across FEATHER px as the circle grows.
  const mask = `radial-gradient(circle at ${x}px ${y}px, #000 calc(var(--reach) - ${FEATHER}px), transparent var(--reach))`

  return (
    <div ref={box} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden font-mono">
      <AnimatePresence>
        {at && scene && (
          <motion.div
            key="forest"
            className="absolute inset-0"
            initial={m.reduced ? { opacity: 0 } : { opacity: 0, ["--reach" as string]: "0px" }}
            animate={m.reduced ? { opacity: 1 } : { opacity: 1, ["--reach" as string]: `${reach}px` }}
            exit={m.reduced ? { opacity: 0 } : { opacity: 0, ["--reach" as string]: "0px" }}
            transition={m.t(D.slow)}
            style={{
              background: "linear-gradient(to bottom, var(--forest-sky), transparent 70%)",
              ...(m.reduced ? {} : { maskImage: mask, WebkitMaskImage: mask }),
            }}
          >
            {LAYERS.map((inks, i) => (
              <motion.pre
                key={i}
                className="absolute inset-x-0 bottom-0 m-0 text-[12px] select-none"
                style={{ lineHeight: `${CHAR_H}px` }}
                initial={m.reduced ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(3px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={m.reduced ? m.t() : { ...m.t(D.slow), delay: 0.04 + i * 0.05 }}
              >
                {scene.map((cells, r) => (
                  <div key={r}>
                    <Row cells={cells.map((c) => (c && inks.includes(c.ink) ? c : null))} />
                  </div>
                ))}
              </motion.pre>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
