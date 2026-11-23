import { useMotionValue, useReducedMotion, useTransform, type MotionValue, type Transition } from "motion/react"
import { useEffect } from "react"

// Calm motion (2026-11-08). Content never rises, slides, scales, staggers, draws or counts in: it is
// simply there. The only motion left is a short fade on things that float (menus, popovers) and a height
// change when something opens or closes. Pages and tabs switch instantly.

/** The durations still in use (seconds): 120 for fades and hover, 160 for opening and closing. */
export const D = { fast: 0.12, base: 0.16, slow: 0.16 } as const

/** The one curve: fast out, no bounce. */
export const EASE = [0.23, 1, 0.32, 1] as const

/** The one transition. (Named `spring` for the callers that predate the curve.) */
export const spring = (duration: number = D.base): Transition => ({ type: "tween", duration: Math.min(duration, D.base), ease: EASE })

const fade: Transition = { duration: D.fast, ease: EASE }
const none: Transition = { duration: 0 }

/** Motion presets. Every animated thing in the window takes its values from here. */
export function useMotion() {
  const reduced = useReducedMotion() ?? false
  const t = (d: number = D.base): Transition => (reduced ? fade : spring(d))
  return {
    reduced,
    t,
    /** Messages and cards: shown at once, no entrance. */
    rise: { initial: { opacity: 1 }, animate: { opacity: 1 }, transition: none },
    /** Popovers and menus: a short fade, no scale or slide. */
    pop: (origin: string) => ({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0, transition: fade },
      transition: fade,
      style: { transformOrigin: origin },
    }),
    /** Height open and close. */
    collapse: {
      initial: { height: 0, opacity: 0 },
      animate: { height: "auto", opacity: 1 },
      exit: { height: 0, opacity: 0 },
      transition: reduced ? none : spring(D.base),
    },
    /** No press or lift: the fill changes on hover instead. */
    lift: {},
    /** Lists arrive all at once. */
    stagger: (_i: number, _step?: number, _max?: number) => 0,
    /** Lines and arcs are drawn at once. */
    draw: (_delay = 0) => ({ initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: 1, opacity: 1 }, transition: none }),
    /** Bars and pins are shown at full size. */
    grow: (_delay = 0) => ({ initial: { scaleY: 1, opacity: 1 }, animate: { scaleY: 1, opacity: 1 }, transition: none }),
    /** Cards are shown at once. */
    card: (_delay = 0) => ({ initial: { opacity: 1 }, animate: { opacity: 1 }, transition: none }),
  }
}

/** A number shown at its value straight away (it used to count up). Returns a MotionValue of the text. */
export function useCountUp(value: number, format: (n: number) => string, _delay = 0): MotionValue<string> {
  const n = useMotionValue(value)
  useEffect(() => {
    n.set(value)
  }, [value, n])
  return useTransform(n, format)
}
