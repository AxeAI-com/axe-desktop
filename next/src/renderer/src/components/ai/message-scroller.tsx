import { cn } from "cn"
import type * as React from "react"
import { useEffect, useRef, useState } from "react"
import { MessageBubble } from "@/components/ai/message-bubble"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const HORIZONTAL_WAVE = [2.8, 2.15, 1.55, 1.2]
const VERTICAL_WAVE = [1.4, 1.22, 1.1, 1.04]

interface MessageScrollerMessage {
  content: string
  from?: "assistant" | "system" | "user"
  id: string
}

interface MessageScrollerProps extends Omit<React.ComponentProps<"section">, "children"> {
  activeId?: string
  // Axe AI: navigate an existing thread that scrolls with the page. When set, the minimap
  // finds each message with this, follows the window scroll, and renders no viewport of its own.
  getMessageElement?: (id: string) => HTMLElement | null
  messages: MessageScrollerMessage[]
  onMessageSelect?: (message: MessageScrollerMessage) => void
}

function getWaveScale(index: number, hoveredIndex: number | null, wave: number[]) {
  if (hoveredIndex === null) return 1
  return wave[Math.abs(index - hoveredIndex)] ?? 1
}

function MessageScroller({
  activeId,
  className,
  getMessageElement,
  messages,
  onMessageSelect,
  ...props
}: MessageScrollerProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState(
    activeId ?? messages.find((message) => (message.from ?? "user") === "user")?.id,
  )
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const messageElements = useRef(new Map<string, HTMLDivElement>())
  const viewportRef = useRef<HTMLDivElement>(null)

  const currentMessageId = activeId ?? selectedId
  const userMessages = messages.filter((message) => (message.from ?? "user") === "user")

  // Axe AI: page mode (getMessageElement) measures against the window instead of the viewport.
  const elementFor = (id: string) => getMessageElement?.(id) ?? messageElements.current.get(id)
  const viewportBounds = (viewport: HTMLElement | null) =>
    viewport
      ? { height: viewport.clientHeight, top: viewport.getBoundingClientRect().top }
      : { height: window.innerHeight, top: 0 }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Axe AI: elementFor reads the latest props each frame
  useEffect(() => {
    const viewport = getMessageElement ? null : viewportRef.current
    if (!getMessageElement && !viewport) return
    let frame = 0

    function updatePosition() {
      const bounds = viewportBounds(viewport)
      const center = bounds.top + bounds.height / 2
      const visible: string[] = []
      let nearestId: string | undefined
      let nearestDistance = Infinity

      for (const message of messages) {
        if ((message.from ?? "user") !== "user") continue
        const element = elementFor(message.id)
        if (!element) continue
        const rect = element.getBoundingClientRect()
        if (rect.bottom > bounds.top && rect.top < bounds.top + bounds.height) {
          visible.push(message.id)
        }
        const distance = Math.abs(rect.top + rect.height / 2 - center)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestId = message.id
        }
      }

      setSelectedId(nearestId)
      setVisibleIds((previous) =>
        previous.length === visible.length && previous.every((id, index) => id === visible[index])
          ? previous
          : visible,
      )
    }

    function scheduleUpdate() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updatePosition)
    }

    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(viewport ?? document.documentElement)
    for (const message of messages) {
      const element = elementFor(message.id)
      if (element) observer.observe(element)
    }
    const scroller = viewport ?? window
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true })
    updatePosition()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroller.removeEventListener("scroll", scheduleUpdate)
    }
  }, [messages])

  function selectMessage(message: MessageScrollerMessage) {
    const viewport = getMessageElement ? null : viewportRef.current
    const target = elementFor(message.id)

    if ((viewport || getMessageElement) && target) {
      const bounds = viewportBounds(viewport)
      const targetBounds = target.getBoundingClientRect()
      const top =
        (viewport ? viewport.scrollTop : window.scrollY) +
        targetBounds.top -
        bounds.top -
        bounds.height / 2 +
        targetBounds.height / 2

      ;(viewport ?? window).scrollTo({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        top,
      })
    }

    onMessageSelect?.(message)
  }

  return (
    <TooltipProvider>
      <section
        className={cn("relative flex h-60 w-full overflow-hidden", className)}
        data-slot="message-scroller"
        {...props}
      >
        <nav
          aria-label="User message navigation"
          className="absolute inset-y-0 left-3 z-10 flex w-12 flex-col justify-center gap-0.5 py-2"
          onPointerLeave={() => setHoveredIndex(null)}
        >
          {userMessages.map((message, index) => {
            const isActive = message.id === currentMessageId
            const isVisible = visibleIds.includes(message.id)
            const isHovered = index === hoveredIndex
            const scaleX = getWaveScale(index, hoveredIndex, HORIZONTAL_WAVE)
            const scaleY = getWaveScale(index, hoveredIndex, VERTICAL_WAVE)

            return (
              <Tooltip key={message.id} open={isHovered}>
                <TooltipTrigger
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`Jump to user message: ${message.content}`}
                  className="flex h-2.5 w-full items-center rounded-sm border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onBlur={() => setHoveredIndex(null)}
                  onClick={() => selectMessage(message)}
                  onFocus={() => setHoveredIndex(index)}
                  onPointerEnter={() => setHoveredIndex(index)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block h-0.5 w-3 origin-left rounded-full bg-muted-foreground/35 opacity-80 transition-[transform,background-color,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform motion-reduce:transition-[background-color,opacity]",
                      (isVisible || isActive || isHovered) && "bg-foreground opacity-100",
                    )}
                    style={{ transform: `scaleX(${scaleX}) scaleY(${scaleY})` }}
                  />
                </TooltipTrigger>
                <TooltipContent
                  className="w-64 max-w-[calc(100vw-5rem)] bg-transparent p-0 text-foreground shadow-none [&>:last-child]:hidden"
                  side="right"
                  sideOffset={12}
                >
                  <MessageBubble
                    className="max-w-full rounded-[0.75rem] px-3 py-2 text-xs leading-5"
                    from={message.from ?? "user"}
                  >
                    {message.content}
                  </MessageBubble>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </nav>

        {/* Axe AI: page mode navigates the thread on the page, so no viewport here. */}
        {!getMessageElement && (
          <div
            ref={viewportRef}
            className="h-full min-w-0 flex-1 [scrollbar-width:none] overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,#000_3rem,#000_calc(100%-3rem),transparent)] py-20 pr-4 pl-18 [&::-webkit-scrollbar]:hidden"
            data-slot="message-scroller-viewport"
          >
            <div className="flex flex-col gap-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  ref={(element) => {
                    if (element) messageElements.current.set(message.id, element)
                    else messageElements.current.delete(message.id)
                  }}
                  data-message-id={message.id}
                >
                  <MessageBubble
                    className="rounded-[0.75rem] px-3 py-2 text-xs leading-5"
                    from={message.from ?? "user"}
                  >
                    {message.content}
                  </MessageBubble>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </TooltipProvider>
  )
}

export type { MessageScrollerMessage, MessageScrollerProps }
export { MessageScroller }
