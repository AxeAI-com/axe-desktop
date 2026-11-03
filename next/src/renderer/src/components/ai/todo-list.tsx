import { cn } from "cn"
import type * as React from "react"
import { ChevronDownMark, StepsMark } from "./board-icons"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

interface AgentTodoItem {
  detail?: string
  id: string
  label: string
  status: "complete" | "in-progress" | "pending"
}

interface TodoListProps extends React.ComponentProps<typeof Collapsible> {
  items: AgentTodoItem[]
  title?: string
  /** An agent waiting on you: a tighter card, "2 of 4", steps not struck through. */
  compact?: boolean
}

function TodoList({ className, compact = false, defaultOpen = true, items, title = "Plan", ...props }: TodoListProps) {
  const complete = items.filter((item) => item.status === "complete").length

  return (
    <Collapsible
      data-slot="todo-list"
      className={cn(
        "rounded-[16px] border-0 bg-card font-sans text-[14px] font-normal text-ink-3 shadow-none",
        compact ? "px-[16px] py-[12px]" : "px-[18px] pt-[14px] pb-[18px]",
        className,
      )}
      defaultOpen={defaultOpen}
      {...props}
    >
      <CollapsibleTrigger
        className={cn("group flex w-full items-center gap-[8px] rounded-sm text-left text-[14px] leading-[20px] font-normal text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/30", compact ? "min-h-[24px]" : "min-h-[28px]")}
        render={<button aria-label="Toggle agent plan" type="button" />}
      >
        <StepsMark className="text-ink-3" />
        <span>{title}</span>
        <span className="ml-auto shrink-0 text-[13px] leading-[20px] font-normal text-ink-3 tabular-nums">
          {compact ? `${complete} of ${items.length}` : `${complete}/${items.length}`}
        </span>
        <ChevronDownMark
          size={13}
          className={cn(
            "shrink-0 text-ink-3 transition-[rotate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-panel-open:rotate-180 motion-reduce:transition-none",
            compact && "hidden",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-opacity">
        <ol className={cn("flex flex-col", compact ? "gap-[6px] pt-[4px]" : "gap-[10px] pt-[8px]")}>
          {items.map((item) => (
            <li className="flex gap-[12px]" key={item.id}>
              <TodoStatus status={item.status} compact={compact} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[14px] leading-[20px] font-normal",
                    item.status === "complete" ? (compact ? "text-ink-3" : "text-ink-3 line-through") : item.status === "in-progress" ? "text-foreground" : "text-ink-2",
                  )}
                >
                  {item.label}
                </p>
                {item.detail && (
                  <p className="mt-0.5 text-[13px] leading-[20px] font-normal text-ink-3">{item.detail}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

function TodoStatus({ status, compact }: Pick<AgentTodoItem, "status"> & { compact?: boolean }) {
  if (status === "complete") {
    return (
      <svg
        role="img"
        aria-label="Complete"
        viewBox="0 0 16 16"
        className="mt-px size-[18px] shrink-0 text-live transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:scale-90 starting:opacity-0 motion-reduce:starting:scale-100"
      >
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path d="m4.5 8.2 2.3 2.3 4.7-5" fill="none" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (status === "in-progress") {
    return (
      <span className="mt-px flex size-[18px] shrink-0 items-center justify-center">
        <svg role="img" aria-label="In progress" viewBox="0 0 24 24" fill="none" className="size-[15px] animate-spin text-foreground motion-reduce:animate-none">
          <circle cx="12" cy="12" r="9" stroke="var(--fill-3)" strokeWidth="2.5" />
          <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  return (
    <span className="mt-px flex size-[18px] shrink-0 items-center justify-center">
      <span aria-hidden="true" className={cn("size-[18px] rounded-full border-[1.5px] border-ink-4", !compact && "border-dashed")} />
      <span className="sr-only">Pending</span>
    </span>
  )
}

export type { AgentTodoItem, TodoListProps }
export { TodoList }
