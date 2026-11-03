import { motion } from "motion/react"
import { useMemo, useState } from "react"

import type { RichTable } from "@shared/rich"

import { D, useMotion } from "@/lib/motion"

import { CardFrame, EmptyNote } from "./shared"

type Cell = string | number

/** A cell as a number when it reads as one ("$1,200", "45%", "3.5"); otherwise undefined. */
export function numberOf(c: Cell): number | undefined {
  if (typeof c === "number") return c
  const t = c.replace(/[\s,$€£¥%]/g, "").replace(/^−/, "-")
  return t && /^-?\d*\.?\d+(e-?\d+)?$/i.test(t) ? Number(t) : undefined
}

/** Rows sorted by one column: numbers by value, words in reading order; blanks last. */
export function sortRows(rows: Cell[][], col: number, dir: 1 | -1): Cell[][] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = a.r[col] ?? ""
      const y = b.r[col] ?? ""
      if (x === "" && y !== "") return 1
      if (y === "" && x !== "") return -1
      const nx = numberOf(x)
      const ny = numberOf(y)
      const c = nx !== undefined && ny !== undefined ? nx - ny : String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" })
      return c * dir || a.i - b.i
    })
    .map((x) => x.r)
}

/** A table you can sort by clicking a column's name. */
export function TableCard({ table }: { table: RichTable }) {
  const m = useMotion()
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const rows = useMemo(() => (sort ? sortRows(table.rows, sort.col, sort.dir) : table.rows), [table.rows, sort])
  const numeric = useMemo(
    () => table.columns.map((_, c) => table.rows.length > 0 && table.rows.every((r) => r[c] === undefined || r[c] === "" || numberOf(r[c]!) !== undefined)),
    [table],
  )

  if (!table.columns.length || !table.rows.length)
    return (
      <CardFrame label={table.title ?? "Table"}>
        <EmptyNote title={table.title} text="This table has no rows yet." />
      </CardFrame>
    )

  const click = (col: number) =>
    setSort((s) => (s?.col !== col ? { col, dir: numeric[col] ? -1 : 1 } : s.dir === (numeric[col] ? -1 : 1) ? { col, dir: s.dir === 1 ? -1 : 1 } : null))

  return (
    <CardFrame label={table.title ?? "Table"} className="overflow-hidden">
      {table.title && <div className="px-4 pt-3.5 pb-1 text-[12px] text-ink-2">{table.title}</div>}
      <div className="scroll max-h-[420px] overflow-x-auto">
        <table className="rich-table w-full border-separate border-spacing-0 text-[13px] leading-[21px]">
          <thead className="sticky top-0 z-[1]" style={{ background: "var(--card)" }}>
            <tr>
              {table.columns.map((c, i) => {
                const on = sort?.col === i
                return (
                  <th
                    key={i}
                    aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}
                    style={{ textAlign: numeric[i] ? "right" : "left" }}
                    className={`border-b border-line px-4 py-2.5 text-[12px] whitespace-nowrap ${on ? "text-ink" : "text-ink-3"}`}
                  >
                    <button onClick={() => click(i)} className={`hover:text-ink ${numeric[i] ? "flex-row-reverse" : ""}`}>
                      {c}
                      <motion.svg
                        width="9"
                        height="9"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        aria-hidden="true"
                        animate={{ opacity: on ? 1 : 0.35, rotate: on && sort!.dir === -1 ? 180 : 0 }}
                        transition={m.t(D.base)}
                      >
                        <path d="M2 6.5 5 3.5 8 6.5" />
                      </motion.svg>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = table.rows.indexOf(r)
              return (
                <motion.tr
                  key={key}
                  layout={m.reduced ? false : "position"}
                  initial={m.reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...m.t(D.base), delay: sort ? 0 : m.stagger(key, 0.03, 0.4) }}
                  className="hover:bg-fill"
                >
                  {table.columns.map((_, c) => (
                    <td
                      key={c}
                      style={{ textAlign: numeric[c] ? "right" : "left" }} className={`selectable border-b border-line px-4 py-2.5 align-top ${numeric[c] ? "tabular-nums" : ""} ${c === 0 ? "text-ink" : "text-ink-2"}`}
                    >
                      {r[c] ?? ""}
                    </td>
                  ))}
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </CardFrame>
  )
}
