import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * PrintSheet: what goes on paper (or into a PDF) when the screen itself is the wrong thing to
 * print: a plan week as a clean table, a results sheet. It is invisible on screen. While one is
 * mounted, printing shows the sheet and nothing else (no navigation, no buttons).
 * Mount it when the person asks to print, call `printPage()`, and unmount it afterwards.
 * `title` is the heading on the paper, `meta` the plain lines under it (team, dates).
 * `brand` goes above the title: whose paper this is (the club's logo and name).
 * Inside, use PrintTable and plain text. Start a new page with `<PrintBreak />`.
 */
export function PrintSheet({ title, meta, brand, children }: { title: ReactNode; meta?: ReactNode[]; brand?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute("data-sk-print-sheet", "")
    return () => root.removeAttribute("data-sk-print-sheet")
  }, [])

  return createPortal(
    <div className="sk-print-sheet" data-sk-print-sheet-root>
      <header className="sk-print-head">
        {brand}
        <h1>{title}</h1>
        {meta?.filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}
      </header>
      {children}
    </div>,
    document.body,
  )
}

/** A heading inside a PrintSheet ("Week 2, 12 to 18 Oct"). `note` is a plain line beside it. */
export function PrintHeading({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <h2 className="sk-print-h2">
      {children}
      {note ? <span>{note}</span> : null}
    </h2>
  )
}

/** A table inside a PrintSheet. Rows never split across pages. `widths` are CSS widths per column. */
export function PrintTable({ columns, rows, widths }: { columns: string[]; rows: ReactNode[][]; widths?: Array<string | undefined> }) {
  return (
    <table className="sk-print-table">
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={column} scope="col" style={widths?.[index] ? { width: widths[index] } : undefined}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((value, index) => (index === 0 ? <th key={index} scope="row">{value}</th> : <td key={index}>{value}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Starts a new page inside a PrintSheet. */
export function PrintBreak() {
  return <div className="sk-print-break" aria-hidden />
}

/**
 * Opens the print dialog (which also offers "Save as PDF") once the screen has caught up, so a
 * PrintSheet mounted in the same click is on the paper. Runs `after` when the dialog closes.
 */
export function printPage(after?: () => void) {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const done = () => {
        window.removeEventListener("afterprint", done)
        after?.()
      }
      window.addEventListener("afterprint", done)
      window.print()
    }),
  )
}
