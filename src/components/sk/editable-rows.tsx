import { Plus, X } from "@phosphor-icons/react"
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"

export type EditableColumn = {
  key: string
  header: string
  placeholder?: string
  /** "grow" takes the space that is left (one per table, first). The others are narrow, for numbers. */
  size?: "grow" | "sm" | "md"
}

const COLUMN_WIDTH = { grow: "minmax(0,1fr)", sm: "4.5rem", md: "6rem" } as const

/**
 * EditableRows: a short table you type straight into (the exercises of a block: name, sets, reps,
 * load). Built for the keyboard: Tab moves across, Enter moves down and, on the last row, adds a
 * row and puts the cursor in it; Backspace in an empty row removes it. On phone the first column
 * takes a line of its own and the narrow ones share the next.
 * `cellLabel` names each input for screen readers ("Block 1 exercise 2 reps").
 */
export function EditableRows({
  columns,
  rows,
  onChange,
  onAdd,
  onRemove,
  addLabel,
  cellLabel,
  removeLabel,
  className,
}: {
  columns: EditableColumn[]
  rows: Array<{ id: string; values: Record<string, string> }>
  onChange: (rowId: string, key: string, value: string) => void
  onAdd: () => void
  onRemove: (rowId: string) => void
  addLabel: string
  cellLabel: (rowIndex: number, column: EditableColumn) => string
  removeLabel: (rowIndex: number) => string
  className?: string
}) {
  const root = useRef<HTMLDivElement | null>(null)
  // Set when a row was just asked for, so the cursor lands in it once it exists.
  const focusNewRow = useRef(false)

  const focusCell = (rowIndex: number, columnIndex: number) => {
    root.current?.querySelector<HTMLInputElement>(`[data-cell="${rowIndex}:${columnIndex}"]`)?.focus()
  }

  useEffect(() => {
    if (!focusNewRow.current) return
    focusNewRow.current = false
    focusCell(rows.length - 1, 0)
  }, [rows.length])

  const add = () => {
    focusNewRow.current = true
    onAdd()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) => {
    const row = rows[rowIndex]
    if (event.key === "Enter") {
      event.preventDefault()
      if (rowIndex < rows.length - 1) return focusCell(rowIndex + 1, columnIndex)
      // The last row: start the next one, unless this one is still empty.
      if (Object.values(row.values).some((value) => value.trim())) add()
      return
    }
    if (event.key === "Backspace" && columnIndex === 0 && Object.values(row.values).every((value) => !value)) {
      event.preventDefault()
      onRemove(row.id)
      window.requestAnimationFrame(() => focusCell(Math.max(0, rowIndex - 1), 0))
    }
  }

  const narrow = columns.filter((column) => (column.size ?? "sm") !== "grow")
  const style = {
    "--sk-cols": [...columns.map((column) => COLUMN_WIDTH[column.size ?? "sm"]), "2.75rem"].join(" "),
    "--sk-cols-phone": `repeat(${Math.max(1, narrow.length)}, minmax(0, 1fr)) 2.75rem`,
  } as CSSProperties
  const grid = "grid items-center gap-x-2 gap-y-1.5 [grid-template-columns:var(--sk-cols-phone)] sm:[grid-template-columns:var(--sk-cols)]"

  return (
    <div ref={root} className={cn("flex flex-col gap-1.5", className)} style={style}>
      {rows.length > 0 ? (
        <div className={cn(grid, "hidden text-sm font-semibold text-sk-mute sm:grid")} aria-hidden>
          {columns.map((column) => (
            <span key={column.key} className={column.size === "grow" ? "pl-0.5" : "pl-2.5"}>
              {column.header}
            </span>
          ))}
        </div>
      ) : null}
      {rows.map((row, rowIndex) => (
        <div key={row.id} className={cn(grid, "border-b border-sk-line pb-2.5 last:border-b-0 sm:border-b-0 sm:pb-0")}>
          {columns.map((column, columnIndex) => (
            <input
              key={column.key}
              data-cell={`${rowIndex}:${columnIndex}`}
              className={cn("sk-field", column.size === "grow" ? "col-span-full sm:col-span-1" : "px-2.5")}
              aria-label={cellLabel(rowIndex, column)}
              placeholder={column.placeholder ?? column.header}
              autoComplete="off"
              enterKeyHint={rowIndex === rows.length - 1 ? "done" : "next"}
              value={row.values[column.key] ?? ""}
              onChange={(event) => onChange(row.id, column.key, event.target.value)}
              onKeyDown={(event) => onKeyDown(event, rowIndex, columnIndex)}
            />
          ))}
          <button
            type="button"
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[12px] text-sk-mute transition-colors hover:bg-sk-soft hover:text-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
            aria-label={removeLabel(rowIndex)}
            onClick={() => onRemove(row.id)}
          >
            <X className="size-4" weight="bold" aria-hidden />
          </button>
        </div>
      ))}
      <button type="button" data-add-row className="sk-btn sk-btn-text sk-btn-sm -ml-2.5 self-start" onClick={add}>
        <Plus className="size-4" weight="bold" aria-hidden />
        {addLabel}
      </button>
    </div>
  )
}

/**
 * DayChecks: tick any of the seven days of a week. Each day is a square toggle with its short
 * name and, when ticked, an optional mark under it (the "A" or "B" of an alternating pattern).
 * Give the group a name with `label`.
 */
export function DayChecks({
  label,
  days,
  onToggle,
  className,
}: {
  label: string
  days: Array<{ key: string; label: string; checked: boolean; mark?: string }>
  onToggle: (key: string) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn("grid grid-cols-7 gap-1.5", className)}>
      {days.map((day) => (
        <button
          key={day.key}
          type="button"
          role="checkbox"
          aria-checked={day.checked}
          aria-label={day.mark && day.checked ? `${day.label}, ${day.mark}` : day.label}
          onClick={() => onToggle(day.key)}
          className={cn(
            "flex min-h-[52px] cursor-pointer flex-col items-center justify-center rounded-[12px] border text-sm font-bold leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
            day.checked ? "border-sk-blue bg-sk-blue-tint text-sk-blue-ink" : "border-sk-line-strong bg-white text-sk-ink-2 hover:border-sk-ink",
          )}
        >
          {day.label}
          <span className="min-h-4 text-xs tabular-nums" aria-hidden>
            {day.checked ? day.mark : ""}
          </span>
        </button>
      ))}
    </div>
  )
}
