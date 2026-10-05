import { ArrowsHorizontal, Check, WarningCircle } from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { StatusText } from "./status"

export type SaveStateValue = "idle" | "saving" | "saved" | "error"

/**
 * SaveState: where something that saves by itself stands, as a dot and words: "Saving...",
 * "Saved", "Not saved". Pass your own words with `children` ("3 results not saved").
 * Shows nothing while idle. Announced to screen readers.
 */
export function SaveState({ state, children, className }: { state: SaveStateValue; children?: ReactNode; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn("text-sm", className)}>
      {state === "idle" ? null : (
        <StatusText tone={state === "saved" ? "green" : state === "error" ? "coral" : "neutral"}>
          {children ?? (state === "saved" ? "Saved" : state === "error" ? "Not saved" : "Saving...")}
        </StatusText>
      )}
    </span>
  )
}

export type EntryGridColumn = {
  key: string
  /** Shown at the top of the column ("30m"). */
  header: string
  /** A small second line: the unit ("seconds"). */
  sub?: string
}

export type EntryGridRow = {
  key: string
  /** What the row is, as plain text, for screen readers ("Marcus Johnson"). */
  label: string
  /** The row header cell: a name, with an Avatar or TableSub if wanted. */
  header: ReactNode
}

export type EntryGridCell = {
  /** The saved (or being saved) text of the cell. Empty for no value. */
  value: string
  state?: SaveStateValue
  /** Why it was not saved. Read out and shown under the grid while the cell has focus. */
  message?: string | null
  /** A quiet mark in the corner, explained by the caller under the grid ("entered by coach"). */
  marked?: boolean
}

/**
 * EntryGrid: type many numbers fast, spreadsheet style. Rows down (athletes), columns across
 * (tests), one input per cell.
 *   Tab         next cell (across, then down)
 *   Enter       the cell below (Shift+Enter: above), arrows up and down too
 *   paste       a column or a block copied from a spreadsheet fills down and across from the cell
 *   Escape      puts back what was saved
 * A cell is handed to `onCommit` when you leave it with a changed value (empty means "remove").
 * `validate` returns a message to refuse a value before it is sent. The caller keeps each cell's
 * value and save state and passes them through `cell`.
 * The first column stays in place while the rest scrolls sideways inside the grid's own frame
 * (the page never scrolls sideways); a line under the grid says so when there is more to see.
 */
export function EntryGrid({
  caption,
  rowHeader,
  rows,
  columns,
  cell,
  onCommit,
  validate,
  disabled = false,
  className,
}: {
  /** Read by screen readers; say what is being entered. */
  caption: string
  /** Heading of the first column ("Athlete"). */
  rowHeader: string
  rows: EntryGridRow[]
  columns: EntryGridColumn[]
  cell: (rowKey: string, columnKey: string) => EntryGridCell
  onCommit: (rowKey: string, columnKey: string, text: string) => void
  validate?: (columnKey: string, text: string) => string | null
  disabled?: boolean
  className?: string
}) {
  const frame = useRef<HTMLDivElement | null>(null)
  // What is being typed, per cell, until it is committed.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [focused, setFocused] = useState<string | null>(null)
  const [overflow, setOverflow] = useState({ scrollable: false, scrolled: false })

  const measure = useCallback(() => {
    const node = frame.current
    if (!node) return
    setOverflow({ scrollable: node.scrollWidth - node.clientWidth > 4, scrolled: node.scrollLeft > 2 })
  }, [])

  useEffect(() => {
    measure()
    const node = frame.current
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [measure, rows.length, columns.length])

  const id = (rowKey: string, columnKey: string) => `${rowKey}|${columnKey}`

  const focusCell = (rowIndex: number, columnIndex: number) => {
    const target = frame.current?.querySelector<HTMLInputElement>(`[data-cell="${rowIndex}:${columnIndex}"]`)
    if (!target) return false
    target.focus()
    target.select()
    return true
  }

  /** Sends one cell if it changed and passes the check. Returns false when it was refused. */
  const commit = (rowKey: string, columnKey: string, text: string | undefined) => {
    const key = id(rowKey, columnKey)
    if (text === undefined) return true
    const next = text.trim()
    const clear = (current: Record<string, string>) => Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key))
    if (next === cell(rowKey, columnKey).value.trim()) {
      setDrafts(clear)
      setErrors(clear)
      return true
    }
    const problem = next ? (validate?.(columnKey, next) ?? null) : null
    if (problem) {
      setErrors((current) => ({ ...current, [key]: problem }))
      return false
    }
    setErrors(clear)
    setDrafts(clear)
    onCommit(rowKey, columnKey, next)
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) => {
    if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const up = event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)
      // Leaving the last row with Enter still commits: blur does it.
      if (!focusCell(rowIndex + (up ? -1 : 1), columnIndex)) event.currentTarget.blur()
      return
    }
    if (event.key === "Escape") {
      const key = id(rows[rowIndex].key, columns[columnIndex].key)
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key)))
      setErrors((current) => Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key)))
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) => {
    const text = event.clipboardData.getData("text")
    if (!/[\n\t]/.test(text.replace(/[\r\n]+$/, ""))) return
    event.preventDefault()
    const lines = text.replace(/\r\n?/g, "\n").split("\n")
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
    const refused: Record<string, string> = {}
    const kept: Record<string, string> = {}
    lines.forEach((line, lineIndex) => {
      const row = rows[rowIndex + lineIndex]
      if (!row) return
      line.split("\t").forEach((raw, cellIndex) => {
        const column = columns[columnIndex + cellIndex]
        const value = raw.trim()
        // An empty pasted cell leaves what is there alone; pasting never removes a result.
        if (!column || !value) return
        const key = id(row.key, column.key)
        const problem = validate?.(column.key, value) ?? null
        if (problem) {
          refused[key] = problem
          kept[key] = value
        } else if (value !== cell(row.key, column.key).value.trim()) {
          onCommit(row.key, column.key, value)
        }
      })
    })
    setDrafts((current) => {
      const next = { ...current, ...kept }
      delete next[id(rows[rowIndex].key, columns[columnIndex].key)]
      return { ...next, ...kept }
    })
    setErrors((current) => ({ ...current, ...refused }))
  }

  const focusedMessage = focused ? (errors[focused] ?? null) : null
  const focusedCellMessage = (() => {
    if (!focused || focusedMessage) return null
    const [rowKey, columnKey] = focused.split("|")
    const current = cell(rowKey, columnKey)
    return current.state === "error" ? (current.message ?? "Not saved. Try again.") : null
  })()

  return (
    <div className={cn("min-w-0", className)}>
      <div ref={frame} onScroll={measure} className="-mx-1 overflow-x-auto px-1 pb-1" data-sk-entry-grid>
        <table className="w-max min-w-full border-collapse text-left text-[0.9375rem]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn("sticky left-0 z-10 border-b border-sk-line bg-white py-2.5 pr-3 align-bottom font-semibold text-sk-mute", overflow.scrolled && "border-r border-r-sk-line-strong")}>
                {rowHeader}
              </th>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="border-b border-sk-line py-2.5 pl-4 pr-[1.125rem] text-right align-bottom font-semibold text-sk-mute">
                  <span className="block whitespace-nowrap text-sk-ink">{column.header}</span>
                  {column.sub ? <span className="block whitespace-nowrap text-[0.8125rem] font-medium">{column.sub}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.key}>
                <th scope="row" className={cn("sticky left-0 z-10 max-w-[44vw] border-b border-sk-line bg-white py-1.5 pr-3 font-bold text-sk-ink sm:max-w-none", overflow.scrolled && "border-r border-r-sk-line-strong")}>
                  {row.header}
                </th>
                {columns.map((column, columnIndex) => {
                  const key = id(row.key, column.key)
                  const current = cell(row.key, column.key)
                  const error = errors[key] ?? (current.state === "error" ? (current.message ?? "Not saved") : null)
                  const text = drafts[key] ?? current.value
                  return (
                    <td key={column.key} className="border-b border-sk-line py-1.5 pl-1.5 text-right">
                      <span className="relative -mr-1.5 inline-block">
                        <input
                          data-cell={`${rowIndex}:${columnIndex}`}
                          data-state={error ? "error" : (current.state ?? "idle")}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          enterKeyHint="next"
                          disabled={disabled}
                          aria-label={`${row.label}, ${column.header}`}
                          aria-invalid={error ? true : undefined}
                          title={error ?? undefined}
                          placeholder="-"
                          value={text}
                          onFocus={(event) => {
                            setFocused(key)
                            event.currentTarget.select()
                          }}
                          onBlur={() => {
                            setFocused((now) => (now === key ? null : now))
                            commit(row.key, column.key, drafts[key])
                          }}
                          onChange={(event) => {
                            const next = event.target.value
                            setDrafts((now) => ({ ...now, [key]: next }))
                            if (errors[key]) setErrors((now) => Object.fromEntries(Object.entries(now).filter(([entry]) => entry !== key)))
                          }}
                          onKeyDown={(event) => onKeyDown(event, rowIndex, columnIndex)}
                          onPaste={(event) => onPaste(event, rowIndex, columnIndex)}
                          className={cn(
                            "h-11 w-[5.5rem] rounded-[10px] border bg-transparent pl-2 pr-6 text-right font-bold tabular-nums text-sk-ink placeholder:font-medium placeholder:text-sk-faint hover:bg-sk-soft focus:bg-white focus:outline-none focus:ring-2 focus:ring-sk-blue/20 disabled:hover:bg-transparent",
                            error ? "border-sk-coral-ink" : "border-transparent focus:border-sk-blue",
                          )}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center" aria-hidden>
                          {error ? (
                            <WarningCircle className="size-4 text-sk-coral-ink" weight="fill" />
                          ) : current.state === "saving" ? (
                            <span className="size-1.5 animate-pulse rounded-full bg-sk-faint" />
                          ) : current.state === "saved" ? (
                            <Check className="size-3.5 text-sk-green" weight="bold" />
                          ) : current.marked ? (
                            <span className="size-1.5 rounded-full bg-sk-blue" />
                          ) : null}
                        </span>
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="alert" className={cn("mt-2 min-h-5 text-sm font-semibold text-sk-coral-ink", !(focusedMessage ?? focusedCellMessage) && "hidden")}>
        {focusedMessage ?? focusedCellMessage}
      </p>
      {overflow.scrollable ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-sk-mute" data-sk-entry-grid-hint>
          <ArrowsHorizontal className="size-4 shrink-0" weight="bold" aria-hidden />
          Scroll sideways for more columns.
        </p>
      ) : null}
    </div>
  )
}
