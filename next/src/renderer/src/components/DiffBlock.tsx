import { type DiffFile, parseUnifiedDiff } from "@/lib/diff"

import { Counts } from "./ChangesPanel"

/**
 * A diff an answer printed ("show me the diff"), drawn like the Changes panel: a box per file with its
 * counts, added lines green, removed red, long lines wrapped, no line numbers.
 */
export function DiffBlock({ text }: { text: string }) {
  const files = parseUnifiedDiff(text)
  return (
    <div className="wide selectable my-1 flex flex-col gap-[10px]">
      {files.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: files are positional in one printed diff
        <DiffFileBox key={i} f={f} />
      ))}
    </div>
  )
}

function DiffFileBox({ f }: { f: DiffFile }) {
  return (
    <div className="overflow-hidden rounded-[12px] bg-entity">
      {f.path && (
        <div className="flex h-[32px] items-center gap-[8px] px-[14px] font-mono text-[12px] leading-[20px] text-ink">
          <span className="min-w-0 flex-1 truncate" title={f.path}>
            {f.path}
          </span>
          <Counts mono added={f.added} removed={f.removed} />
        </div>
      )}
      <div className="pt-[4px] pb-[8px] font-mono text-[12px] leading-[20px]">
        {f.lines.map((r, i) =>
          "hunk" in r ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <div key={i} className="my-1 px-3.5 text-[12px] text-ink-4">
              {r.hunk || "…"}
            </div>
          ) : (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
              key={i}
              className="flex"
              style={{
                background: r.sign === "+" ? "var(--add-bg)" : r.sign === "-" ? "var(--del-bg)" : undefined,
                color: r.sign === "+" ? "var(--add-ink)" : r.sign === "-" ? "var(--del-ink)" : "var(--ink-2)",
              }}
            >
              <span className="w-[26px] shrink-0 text-center opacity-80 select-none">{r.sign === " " ? "" : r.sign === "-" ? "−" : "+"}</span>
              <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.text || " "}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
