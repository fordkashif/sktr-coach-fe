import { CaretRight, Check } from "@phosphor-icons/react"
import { Fragment, type HTMLAttributes, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"

/** List: rows separated by hairlines. Children are ListRow (or any <li>). */
export function List({ children, className, ordered = false, ...rest }: { children: ReactNode; className?: string; ordered?: boolean; "aria-label"?: string }) {
  const Element = ordered ? "ol" : "ul"
  return (
    <Element className={cn("sk-list", className)} {...rest}>
      {children}
    </Element>
  )
}

/**
 * ListRow: one row of a List. 56px minimum height.
 * leading: a StatusDot, Avatar, icon or short text (a weekday, a step number).
 * trailing: a value or StatusText on the right. Rows that navigate (`to`, `href`, `onClick`) get a chevron.
 * Give it `to` for a route, `href` for an outside link, `onClick` for an action; with none it is static.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  to,
  href,
  onClick,
  onNavigate,
  disabled,
  chevron,
  children,
  className,
  ...rest
}: {
  leading?: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  to?: string
  href?: string
  onClick?: () => void
  /** Runs when a `to` or `href` row is followed (close the sheet it sits in). */
  onNavigate?: () => void
  disabled?: boolean
  /** Defaults to true for rows that navigate and false otherwise. */
  chevron?: boolean
  /** Replaces title and subtitle when a row needs custom content. */
  children?: ReactNode
  className?: string
  "aria-current"?: "page" | "true" | "date"
  "aria-label"?: string
}) {
  const interactive = Boolean(to || href || onClick)
  const showChevron = chevron ?? Boolean(to || href)
  const body = (
    <>
      {leading !== undefined && leading !== null ? <span className="flex shrink-0 items-center justify-center">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        {children ?? (
          <>
            <span className="sk-list-title">{title}</span>
            {subtitle ? <span className="sk-list-sub">{subtitle}</span> : null}
          </>
        )}
      </span>
      {trailing !== undefined && trailing !== null ? <span className="shrink-0 text-right text-[0.9375rem] font-semibold text-sk-ink">{trailing}</span> : null}
      {showChevron ? <CaretRight className="size-[18px] shrink-0 text-sk-mute" weight="bold" aria-hidden /> : null}
    </>
  )
  const rowClass = cn("sk-list-row", interactive && "cursor-pointer", className)
  return (
    <li>
      {to ? (
        <Link to={to} className={rowClass} onClick={onNavigate} {...rest}>
          {body}
        </Link>
      ) : href ? (
        <a href={href} className={rowClass} onClick={onNavigate} {...rest}>
          {body}
        </a>
      ) : onClick ? (
        <button type="button" onClick={onClick} disabled={disabled} className={rowClass} {...rest}>
          {body}
        </button>
      ) : (
        <div className={rowClass} {...rest}>
          {body}
        </div>
      )}
    </li>
  )
}

/**
 * StatStrip: numbers side by side, divided by hairlines, with a hairline above and below.
 * One row on desktop (2 to 5 stats), two columns on phone. Children are Stat.
 */
export function StatStrip({ children, className, ...rest }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <section className={cn("sk-statstrip", className)} {...rest}>
      {children}
    </section>
  )
}

/**
 * Stat: a small label over a big number. `of` renders "3 of 4" with the total small and grey.
 * It is never a coloured tile. `tone` is accepted for older screens and ignored.
 */
export function Stat({
  label,
  value,
  unit,
  of,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  unit?: string
  of?: ReactNode
  hint?: ReactNode
  /** @deprecated Ignored. Stats carry no colour. */
  tone?: string
  className?: string
}) {
  return (
    <div className={cn("sk-stat", className)}>
      <p className="sk-stat-label">{label}</p>
      <p className="sk-stat-value">
        {value}
        {unit}
        {of !== undefined && of !== null ? <span className="sk-stat-of">of {of}</span> : null}
      </p>
      {hint ? <p className="sk-stat-hint">{hint}</p> : null}
    </div>
  )
}

export type DataTableColumn<Row> = {
  /** Unique id and React key. */
  key: string
  header: string
  cell: (row: Row) => ReactNode
  /** Numbers go right. */
  align?: "left" | "right"
  /** Bold ink instead of the default secondary text. */
  strong?: boolean
  /**
   * Phone layout. "line" (default): a labelled line under the title. "plain": the value alone under the title
   * (for values that explain themselves, like a status). "trailing": on the right of the title. "hide": dropped.
   */
  phone?: "line" | "plain" | "trailing" | "hide"
  className?: string
}

/**
 * DataTable: a real table (caption, th scope) on tablet and desktop that restacks into list rows on phone.
 * The first column is the row header: give it the name of the thing and, with `sub`, one line under it.
 * It never scrolls the page sideways.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowProps,
  rowBelow,
  className,
}: {
  /** Read by screen readers; say what the table lists. */
  caption: string
  columns: Array<DataTableColumn<Row>>
  rows: Row[]
  rowKey: (row: Row) => string
  /**
   * Attributes for one row: data attributes, or `onClick` to open the row's detail from anywhere on
   * the row (the row then shows a pointer). Keep a real button or link in the first column too, so
   * the keyboard can open it.
   */
  rowProps?: (row: Row) => HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | boolean | undefined>
  /**
   * Something that opens under one row, across the full width: an InlineConfirm for that row's
   * remove or deactivate action. Return null for every other row.
   */
  rowBelow?: (row: Row) => ReactNode
  className?: string
}) {
  const [first, ...others] = columns
  return (
    <table className={cn("sk-table", className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" data-align={column.align ?? "left"} className={column.className}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const extra = rowProps?.(row)
          const below = rowBelow?.(row)
          return (
          <Fragment key={rowKey(row)}>
          <tr {...extra} className={cn(extra?.onClick && "cursor-pointer", extra?.className)}>
            <th scope="row" className={first.className}>
              {first.cell(row)}
            </th>
            {others.map((column) => (
              <td
                key={column.key}
                data-label={column.header}
                data-align={column.align ?? "left"}
                data-strong={column.strong ? "true" : undefined}
                data-phone={column.phone ?? "line"}
                className={column.className}
              >
                {column.cell(row)}
              </td>
            ))}
          </tr>
          {below ? (
            <tr data-below>
              <td colSpan={columns.length}>{below}</td>
            </tr>
          ) : null}
          </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

/** The second line inside a DataTable row header ("400m" under the athlete's name). */
export function TableSub({ children }: { children: ReactNode }) {
  return <span className="sk-table-sub">{children}</span>
}

export type DayStripDay = {
  key: string
  /** One letter weekday. */
  letter: string
  number: number
  /** today: blue. done: green tick. planned: soft fill. rest: plain number. */
  state: "today" | "done" | "planned" | "rest"
  isToday?: boolean
  /** Full sentence for screen readers: "Monday 5 October: session planned". */
  label: string
}

/** DayStrip: the seven days of a week as circles. Read only. */
export function DayStrip({ days, className, ...rest }: { days: DayStripDay[]; className?: string; "aria-label"?: string }) {
  return (
    <ol className={cn("sk-daystrip", className)} {...rest}>
      {days.map((day) => (
        <li key={day.key} className="sk-day" data-state={day.state} data-today={day.isToday ? "true" : undefined} aria-current={day.isToday ? "date" : undefined} aria-label={day.label}>
          <span className="sk-day-letter" aria-hidden>
            {day.letter}
          </span>
          <span className="sk-day-num" aria-hidden>
            {day.state === "done" ? <Check className="size-4" weight="bold" /> : day.number}
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * EmptyState: what will appear here, in plain words, and the one next action. No box, no illustration.
 * `icon` is accepted for older screens and ignored.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string
  body?: ReactNode
  action?: ReactNode
  /** @deprecated Ignored. Empty states are plain text. */
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("sk-empty", className)}>
      <div>
        <p className="text-base font-semibold text-sk-ink">{title}</p>
        {body ? <p className="mt-0.5 max-w-[56ch] text-[0.9375rem] leading-normal text-sk-mute">{body}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** Skeleton: a grey bar the size of the text it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("sk-skel h-4 w-24", className)} />
}

/**
 * SkeletonRows: stands in for a List or DataTable while it loads. Rows are the height of real rows,
 * so nothing moves when the data arrives. Pass the number of rows you expect.
 */
export function SkeletonRows({ rows = 4, leading = false, label = "Loading", className }: { rows?: number; leading?: boolean; label?: string; className?: string }) {
  return (
    <ul className={cn("sk-list", className)} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}>
          <div className="sk-list-row">
            {leading ? <span aria-hidden className="sk-skel size-10 rounded-full" /> : null}
            <span className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3.5 w-3/5" />
            </span>
            <Skeleton className="h-4 w-10" />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** ScreenSkeleton: the whole-screen placeholder used while a route's code loads. */
export function ScreenSkeleton() {
  return (
    <div className="sk-page">
      <span className="sr-only" role="status">
        Loading...
      </span>
      <div className="flex flex-col gap-3" aria-hidden>
        <span className="sk-skel h-9 w-56 rounded-[8px] lg:h-11 lg:w-80" />
        <span className="sk-skel h-4 w-72 max-w-full" />
      </div>
      <div aria-hidden>
        <SkeletonRows rows={5} />
      </div>
    </div>
  )
}
