import { AltArrowDownIcon as ChevronDownIcon } from "@solar-icons/react/linear/alt-arrow-down"
import { AltArrowRightIcon as ChevronRightIcon } from "@solar-icons/react/linear/alt-arrow-right"
import { cn } from "cn"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"

const effortLevels = ["Instant", "Medium", "High", "Extra High", "Pro"] as const

interface ReasoningEffortProps {
  className?: string
  // Axe AI: the levels to choose from (defaults to Pasta's five).
  levels?: readonly string[]
  // Axe AI: the trigger's text while open (defaults to "Thinking effort").
  heading?: string
  onChange?: (value: number) => void
  value: number
}

function ReasoningEffort({
  className,
  levels = effortLevels,
  heading = "Thinking effort",
  onChange,
  value,
}: ReasoningEffortProps) {
  const selectedLevel = Math.min(levels.length - 1, Math.max(0, Math.round(value)))
  const [isOpen, setIsOpen] = useState(false)
  const [draftLevel, setDraftLevel] = useState(selectedLevel)
  const reducedMotion = useReducedMotion()
  const textMotion = reducedMotion ? { duration: 0 } : { duration: 0.16, ease: [0.23, 1, 0.32, 1] as const }

  function handleOpenChange(open: boolean) {
    if (open) setDraftLevel(selectedLevel)
    else if (draftLevel !== selectedLevel) onChange?.(draftLevel)

    setIsOpen(open)
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={isOpen}>
      <PopoverTrigger
        className={className}
        render={
          <button
            // Axe AI: name the control, not just the level.
            aria-label={`Thinking effort: ${levels[selectedLevel]}`}
            // Axe AI: Pasta's data-slot convention, so tests and styles can find the control.
            data-slot="reasoning-effort"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground transition-[background-color,scale] duration-150 hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
            type="button"
          >
            <span className="relative grid justify-items-center">
              {[heading, ...levels].map((label) => (
                <span aria-hidden="true" className="invisible col-start-1 row-start-1" key={label}>
                  {label}
                </span>
              ))}
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  animate={{ filter: "blur(0px)", opacity: 1, transform: "translateY(0px)" }}
                  className="col-start-1 row-start-1"
                  exit={{ filter: "blur(2px)", opacity: 0, transform: "translateY(2px)" }}
                  initial={{ filter: "blur(2px)", opacity: 0, transform: "translateY(-2px)" }}
                  key={isOpen ? "open" : levels[selectedLevel]}
                  transition={textMotion}
                >
                  {isOpen ? heading : levels[selectedLevel]}
                </motion.span>
              </AnimatePresence>
            </span>
            <motion.span
              animate={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              className="flex"
              transition={textMotion}
            >
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </motion.span>
          </button>
        }
      />
      <PopoverContent
        align="end"
        data-slot="reasoning-effort-content"
        className="w-65 rounded-[1rem] border-0 bg-card p-2.5 font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground shadow-card ring-0"
      >
        <motion.div
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          initial={reducedMotion ? false : { opacity: 0, transform: "translateY(-3px) scale(0.98)" }}
          transition={textMotion}
        >
          <div className="flex items-center justify-center gap-1 card-heading">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                animate={{ filter: "blur(0px)", opacity: 1, transform: "translateY(0px)" }}
                exit={{ filter: "blur(2px)", opacity: 0, transform: "translateY(2px)" }}
                initial={{ filter: "blur(2px)", opacity: 0, transform: "translateY(-2px)" }}
                key={levels[draftLevel]}
                transition={textMotion}
              >
                {levels[draftLevel]}
              </motion.span>
            </AnimatePresence>
            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
          </div>
          <div className="relative mx-3.5 mt-1">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-3.5 top-1/2 h-6 -translate-y-1/2 overflow-hidden rounded-full bg-foreground/10"
            >
              <div className="absolute inset-y-0 right-3.5 left-3.5">
                <motion.div
                  animate={{
                    transform: `translateX(${(draftLevel / (levels.length - 1) - 1) * 50}%)`,
                  }}
                  className="absolute inset-y-0 right-0 w-[200%] bg-blue-500"
                  initial={false}
                  transition={textMotion}
                />
              </div>
            </div>
            <motion.div
              aria-hidden="true"
              animate={{
                transform: `translateX(${(draftLevel / (levels.length - 1)) * 100}%)`,
              }}
              className="pointer-events-none absolute inset-x-0 top-1/2 z-30"
              initial={false}
              transition={textMotion}
            >
              <span className="absolute top-0 left-0 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md" />
            </motion.div>
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20">
              {levels.map((level, index) => (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25 transition-colors duration-150",
                    index < draftLevel && "bg-primary-foreground/45",
                    index === draftLevel && "opacity-0",
                  )}
                  key={level}
                  style={{ left: `${(index / (levels.length - 1)) * 100}%` }}
                />
              ))}
            </div>
            <Slider
              aria-label={`Thinking effort: ${levels[draftLevel]}, ${draftLevel + 1} of ${levels.length}`}
              className="*:py-1 [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-thumb]]:z-30 [&_[data-slot=slider-thumb]]:size-7 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-transparent [&_[data-slot=slider-thumb]]:shadow-none [&_[data-slot=slider-track]]:h-6 [&_[data-slot=slider-track]]:bg-transparent"
              max={levels.length - 1}
              min={0}
              onClick={(event) => {
                if (event.detail === 0) return

                const { left, width } = event.currentTarget.getBoundingClientRect()
                const position = Math.min(1, Math.max(0, (event.clientX - left) / width))
                setDraftLevel(Math.round(position * (levels.length - 1)))
              }}
              onValueChange={(value) => setDraftLevel(Array.isArray(value) ? value[0] : value)}
              step={1}
              value={[draftLevel]}
            />
          </div>
        </motion.div>
      </PopoverContent>
    </Popover>
  )
}

export type { ReasoningEffortProps }
export { effortLevels, ReasoningEffort }
