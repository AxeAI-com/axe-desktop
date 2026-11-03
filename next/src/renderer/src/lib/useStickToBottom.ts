import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

const NEAR = 48

/**
 * Keeps a scrolling list pinned to its bottom while content grows (a reply streaming in), until you
 * scroll up. Scroll back down, or call jump(), and it pins again.
 */
export function useStickToBottom(scroller: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, key: string) {
  const [pinned, setPinned] = useState(true)
  const pinnedRef = useRef(true)
  // While a smooth jump runs, its own scroll events must not unpin.
  const jumping = useRef(false)

  const set = (v: boolean) => {
    pinnedRef.current = v
    setPinned(v)
  }

  // A new chat opens at its end.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
    set(true)
  }, [key, scroller])

  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      const near = gap < NEAR
      if (jumping.current) {
        if (near) jumping.current = false
        return
      }
      if (near !== pinnedRef.current) set(near)
    }
    // Wheel and touch say you meant to move; leave the bottom straight away.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && el.scrollHeight > el.clientHeight + 1) {
        jumping.current = false
        if (pinnedRef.current) set(false)
      }
    }
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight
      else onScroll()
    })
    ro.observe(inner)
    el.addEventListener("scroll", onScroll, { passive: true })
    el.addEventListener("wheel", onWheel, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener("scroll", onScroll)
      el.removeEventListener("wheel", onWheel)
    }
  }, [scroller, content, key])

  const jump = useCallback(
    (smooth = true) => {
      const el = scroller.current
      if (!el) return
      set(true)
      jumping.current = smooth
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" })
    },
    [scroller],
  )

  return { pinned, jump }
}
