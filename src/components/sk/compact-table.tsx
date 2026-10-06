import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type CompactTableColumn<Row> = {
  /** Unique id and React key. */
  key: string
  header: string
  cell: (row: Row) => ReactNode
  /** Numbers go right. */
  align?: "left" | "right"
  /** Bold ink instead of the default secondary text. */
  strong?: boolean
}

/**
 * CompactTable: a small real table that stays a table on a phone. For two to four short columns
 * of numbers that belong to one thing: the splits of a race, the attempts of a jump, the legs of a
 * relay. It sits under a row or inside a Dialog, never as the main list of a screen (that is a
 * DataTable, which restacks). The first column is the row header. Hairlines only, no box.
 * `footer` is one plain line under the table (what the numbers add up to).
 */
export function CompactTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowMark,
  footer,
  className,
}: {
  /** Read by screen readers; say what the table lists. */
  caption: string
  columns: Array<CompactTableColumn<Row>>
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  /** True for the one row the table is about (the best attempt): its first cell is ink and bold. */
  rowMark?: (row: Row) => boolean
  footer?: ReactNode
  className?: string
}) {
  const [first, ...others] = columns
  return (
    <div className={cn("min-w-0", className)}>
      <table className="!table w-full border-collapse text-left text-[0.9375rem] leading-snug tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="!static !p-0 !border-0 !m-0 !table-header-group !h-auto !w-auto !overflow-visible !whitespace-normal ![clip-path:none] ![clip:auto]">
          <tr className="!table-row">
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                className={cn("!table-cell !border-b !border-sk-line !px-0 !py-2 text-sm !font-semibold text-sk-mute", index > 0 && "!pl-3", column.align === "right" && "text-right")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="!table-row-group">
          {rows.map((row, index) => {
            const marked = rowMark?.(row) ?? false
            const last = index === rows.length - 1
            return (
              <tr key={rowKey(row, index)} data-marked={marked ? "true" : undefined} className="!table-row !border-b-0 !p-0">
                <th scope="row" className={cn("!table-cell !px-0 !py-2 align-baseline !text-[0.9375rem] text-sk-ink", marked ? "!font-bold" : "!font-semibold", last ? "!border-b-0" : "!border-b !border-sk-line", first.align === "right" && "text-right")}>
                  {first.cell(row)}
                </th>
                {others.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "!table-cell !py-2 !pl-3 !pr-0 align-baseline !text-[0.9375rem] before:!content-none",
                      last ? "!border-b-0" : "!border-b !border-sk-line",
                      column.align === "right" && "text-right",
                      column.strong || marked ? "font-bold text-sk-ink" : "text-sk-ink-2",
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {footer ? <p className="mt-2 text-sm text-sk-mute">{footer}</p> : null}
    </div>
  )
}
