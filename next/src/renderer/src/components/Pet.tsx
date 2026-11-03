import { motion } from "motion/react"
import { useRef, useState } from "react"

import { D, useMotion } from "@/lib/motion"
import { setState, useStore } from "@/lib/store"

// The fox that sits on the composer's top edge, a thin line drawing. Hover and it looks up happy; click and the
// forest ripples out behind the chat (Forest.tsx); click again to leave.

// The same fox in type, for the forest scene (Forest.tsx).
export const FOX = [" /\\   /\\", "//\\\\_//\\\\", "\\_     _/  ___", " / o o \\  /  /", " \\_\\v/_/ /__/"].join("\n")

export function FoxPet({ className = "" }: { className?: string }) {
  const m = useMotion()
  const forest = useStore((s) => !!s.forest)
  const [hover, setHover] = useState(false)
  const self = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    const r = self.current?.getBoundingClientRect()
    setState((s) => ({ forest: s.forest || !r ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } }))
  }

  return (
    <motion.button
      ref={self}
      type="button"
      aria-label={forest ? "Fox: leave the forest" : "Fox: show the forest"}
      aria-pressed={forest}
      title={forest ? "Back to the chat" : "Into the forest"}
      onClick={toggle}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      animate={m.reduced ? {} : { y: hover ? -2 : 0, rotate: hover ? -2 : 0 }}
      whileTap={m.reduced ? {} : { scale: 0.95 }}
      transition={m.t(D.fast)}
      style={{ color: "var(--pet)", transformOrigin: "50% 100%" }}
      className={`m-0 cursor-pointer border-0 bg-transparent p-0 focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-[var(--pet)] ${className}`}
    >
      <svg width="56" height="34" viewBox="0 0 56 34" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block">
        <path d="M10 33 L14 14 L20 6 L24 15 L32 15 L36 6 L42 14 L46 33" />
        <path d="M17 15 L20 10 L22 15M34 15 L36 10 L39 15" />
        {hover || forest ? <path d="M19.5 23.5q2-2.5 4 0M32.5 23.5q2-2.5 4 0" /> : <path d="M21.5 22.5h.01M34.5 22.5h.01" strokeWidth="2.2" />}
        <path d="M26 27.5 L28 29 L30 27.5" />
        <path d="M6 25 L14 24M6 29 L14 27M50 25 L42 24M50 29 L42 27" />
      </svg>
    </motion.button>
  )
}
