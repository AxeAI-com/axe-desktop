import { animate, useMotionValue, useReducedMotion, useTransform, type MotionValue, type Transition } from "motion/react"
import { useEffect } from "react"

/** The three durations every motion in the window uses (seconds). */
export const D = { fast: 0.12, base: 0.24, slow: 0.32 } as const

/** The one spring: no bounce, timed by how long it looks. */
export const spring = (visualDuration: number = D.base): Transition => ({ type: "spring", bounce: 0, visualDuration })

const fade: Transition = { duration: D.fast, ease: "linear" }

/**
 * Motion presets that turn into 120 ms fades when the system asks for reduced motion.
 * Every animated thing in the window takes its values from here.
 */
export function useMotion() {
  const reduced = useReducedMotion() ?? false
  const t = (d: number = D.base): Transition => (reduced ? fade : spring(d))
  return {
    reduced,
    t,
    /** Messages and cards rise in. */
    rise: {
      initial: reduced ? { opacity: 0 } : { opacity: 0, y: 10 },
      animate: { opacity: 1, y: 0 },
      transition: t(D.slow),
    },
    /** Popovers scale and fade from their anchor. */
    pop: (origin: string) => ({
      initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4 },
      animate: { opacity: 1, scale: 1, y: 0 },
      exit: reduced ? { opacity: 0, transition: fade } : { opacity: 0, scale: 0.97, y: 2, transition: spring(D.fast) },
      transition: t(D.base),
      style: { transformOrigin: origin },
    }),
    /** Height open and close. */
    collapse: {
      initial: { height: 0, opacity: 0 },
      animate: { height: "auto", opacity: 1 },
      exit: { height: 0, opacity: 0 },
      transition: t(D.base),
    },
    /** Lift on hover for cards and options. */
    lift: reduced ? {} : { whileHover: { y: -1 }, whileTap: { scale: 0.985 } },
    /** The nth item of a list arrives a beat after the one before (capped so long lists don't drag). */
    stagger: (i: number, step = 0.045, max = 0.6) => (reduced ? 0 : Math.min(i * step, max)),
    /** A line or arc draws itself in. */
    draw: (delay = 0) => ({
      initial: reduced ? { pathLength: 1, opacity: 0 } : { pathLength: 0, opacity: 0 },
      animate: { pathLength: 1, opacity: 1 },
      transition: reduced ? fade : { pathLength: { ...spring(D.slow), delay }, opacity: { duration: D.fast, delay } },
    }),
    /** Bars and pins grow from their base. */
    grow: (delay = 0) => ({
      initial: reduced ? { opacity: 0 } : { scaleY: 0, opacity: 0 },
      animate: { scaleY: 1, opacity: 1 },
      transition: reduced ? fade : { ...spring(D.slow), delay },
    }),
    /** A card arrives: rises, unblurs and settles, a little slower than a message. */
    card: (delay = 0) => ({
      initial: reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.985, filter: "blur(4px)" },
      animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
      transition: reduced ? fade : { ...spring(D.slow), delay },
    }),
  }
}

/**
 * A number that counts to its value: from 0 on first show, then from wherever it was.
 * Returns a MotionValue of the formatted text, to render as a motion element's child.
 */
export function useCountUp(value: number, format: (n: number) => string, delay = 0): MotionValue<string> {
  const reduced = useReducedMotion() ?? false
  const n = useMotionValue(reduced ? value : 0)
  useEffect(() => {
    if (reduced) {
      n.set(value)
      return
    }
    const run = animate(n, value, { ...spring(D.slow), delay })
    return () => run.stop()
  }, [value, reduced, delay, n])
  return useTransform(n, format)
}
