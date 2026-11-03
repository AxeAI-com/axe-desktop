import { FileCodeIcon as FileCode2Icon } from "@solar-icons/react/linear/file-code"
import { cn } from "cn"
import type * as React from "react"

interface DiffLine {
  content: string
  newNumber?: number
  oldNumber?: number
  type: "addition" | "context" | "deletion"
}

interface FileDiffProps extends React.ComponentProps<"figure"> {
  additions?: number
  deletions?: number
  filename: string
  lines: DiffLine[]
}

function FileDiff({ additions, className, deletions, filename, lines, ...props }: FileDiffProps) {
  const added = additions ?? lines.filter((line) => line.type === "addition").length
  const removed = deletions ?? lines.filter((line) => line.type === "deletion").length

  return (
    <figure
      data-slot="file-diff"
      className={cn(
        "overflow-hidden rounded-[16px] border-0 bg-card font-sans text-[13px] font-normal text-ink-3 shadow-none",
        className,
      )}
      {...props}
    >
      <figcaption className="flex h-10 items-center gap-2 px-3.5 font-mono text-[13px] text-ink-2">
        {/\.tsx?$/i.test(filename) ? (
          <TypeScriptIcon aria-hidden="true" className="size-4 shrink-0 text-[#3178c6]" />
        ) : (
          <FileCode2Icon aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="min-w-0 truncate">{filename}</span>
        <span className="ml-auto text-[var(--add-ink)]">+{added}</span>
        <span className="text-[var(--del-ink)]">−{removed}</span>
      </figcaption>
      <pre className="m-0 overflow-x-auto border-0 py-2 font-mono text-[13px] leading-5">
        <code>
          {lines.map((line, index) => (
            <span
              className={cn(
                "grid min-w-max grid-cols-[2rem_2rem_1rem_1fr] px-3",
                line.type === "addition" && "bg-[var(--add-bg)] text-[var(--add-ink)]",
                line.type === "deletion" && "bg-[var(--del-bg)] text-[var(--del-ink)]",
                line.type === "context" && "text-ink-2",
              )}
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable id and may repeat
              key={`${line.type}-${index}-${line.content}`}
            >
              <span className="text-right text-ink-4 select-none">{line.oldNumber ?? ""}</span>
              <span className="text-right text-ink-4 select-none">{line.newNumber ?? ""}</span>
              <span className="text-center select-none">
                {line.type === "addition" ? "+" : line.type === "deletion" ? "−" : " "}
              </span>
              <span className="pr-4">{line.content || " "}</span>
            </span>
          ))}
        </code>
      </pre>
    </figure>
  )
}

export type { DiffLine, FileDiffProps }
export { FileDiff }

function TypeScriptIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg aria-hidden="true" fill="currentColor" height="1em" viewBox="0 0 24 24" width="1em" {...props}>
      <path d="M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75q.918 0 1.627.111a6.4 6.4 0 0 1 1.306.34v2.458a4 4 0 0 0-.643-.361a5 5 0 0 0-.717-.26a5.5 5.5 0 0 0-1.426-.2q-.45 0-.819.086a2.1 2.1 0 0 0-.623.242q-.254.156-.393.374a.9.9 0 0 0-.14.49q0 .294.156.529q.156.234.443.444c.287.21.423.276.696.41q.41.203.926.416q.705.296 1.266.628q.561.333.963.753q.402.418.614.957q.213.538.214 1.253q0 .986-.373 1.656a3 3 0 0 1-1.012 1.085a4.4 4.4 0 0 1-1.487.596q-.85.18-1.79.18a10 10 0 0 1-1.84-.164a5.5 5.5 0 0 1-1.512-.493v-2.63a5.03 5.03 0 0 0 3.237 1.2q.5 0 .872-.09q.373-.09.623-.25q.249-.162.373-.38a1.02 1.02 0 0 0-.074-1.089a2.1 2.1 0 0 0-.537-.5a5.6 5.6 0 0 0-.807-.444a28 28 0 0 0-1.007-.436q-1.377-.575-2.053-1.405t-.676-2.005q0-.92.369-1.582q.368-.662 1.004-1.089a4.5 4.5 0 0 1 1.47-.629a7.5 7.5 0 0 1 1.77-.201m-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z" />
    </svg>
  )
}
