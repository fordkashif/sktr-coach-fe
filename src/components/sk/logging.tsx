import { Check } from "@phosphor-icons/react"
import { useEffect, useId, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Parts for entering results one set at a time with one thumb (the athlete's session log).
 * SetGroup is one exercise; inside it each SetRow holds one or two NumberInputs and a TickButton.
 */

function plain(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

function clock(value: number) {
  if (value < 60) return plain(value)
  const minutes = Math.floor(value / 60)
  const seconds = Math.round((value - minutes * 60) * 100) / 100
  const whole = Math.floor(seconds)
  const fraction = seconds - whole > 0 ? `.${String(Math.round((seconds - whole) * 100)).padStart(2, "0").replace(/0+$/, "")}` : ""
  return `${minutes}:${String(whole).padStart(2, "0")}${fraction}`
}

function parsePlain(text: string): number | null {
  const cleaned = text.trim().replace(",", ".")
  if (!cleaned) return null
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function parseClock(text: string): number | null {
  const cleaned = text.trim().replace(",", ".")
  const match = /^(\d+):(\d{1,2}(?:\.\d*)?)$/.exec(cleaned)
  if (match) return Number.parseInt(match[1], 10) * 60 + Number.parseFloat(match[2])
  return cleaned.includes(":") ? null : parsePlain(cleaned)
}

/**
 * NumberInput: a big number field for a phone (52px tall, decimal keypad, selects itself on focus).
 * It reports a number on every keystroke (null when empty) and keeps what is being typed, so "102."
 * is not rewritten mid entry. `mode="time"` also accepts minutes and seconds ("1:05.3") and reports seconds.
 * `label` is read by screen readers; `unit` shows inside the field on the right.
 */
export function NumberInput({
  label,
  unit,
  value,
  onChange,
  mode = "decimal",
  placeholder = "0",
  className,
}: {
  label: string
  unit?: string
  value: number | null
  onChange: (value: number | null) => void
  mode?: "decimal" | "time"
  /** Shown while empty, for example the target ("120"). */
  placeholder?: string
  className?: string
}) {
  const id = useId()
  const format = mode === "time" ? clock : plain
  const [text, setText] = useState(value === null ? "" : format(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(value === null ? "" : (mode === "time" ? clock : plain)(value))
  }, [focused, mode, value])

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder={placeholder}
        value={text}
        onFocus={(event) => {
          setFocused(true)
          event.currentTarget.select()
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const next = event.target.value.replace(mode === "time" ? /[^0-9.,:]/g : /[^0-9.,]/g, "").slice(0, 9)
          setText(next)
          onChange(mode === "time" ? parseClock(next) : parsePlain(next))
        }}
        className={cn(
          "h-[52px] w-full rounded-[14px] border border-sk-line-strong bg-white px-2 text-center text-xl font-extrabold tabular-nums text-sk-ink placeholder:font-semibold placeholder:text-sk-faint/70 focus:border-sk-blue focus:outline-none focus:ring-2 focus:ring-sk-blue/20",
          unit && "px-10",
        )}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-sk-mute" aria-hidden>
          {unit}
        </span>
      ) : null}
    </div>
  )
}

/** TickButton: tap to mark one set (or a whole item) done, tap again to undo. 52px square, green when done. */
export function TickButton({ done, label, onClick, className }: { done: boolean; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={done}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-[52px] shrink-0 cursor-pointer items-center justify-center rounded-[14px] border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
        done ? "border-sk-green bg-sk-green text-white" : "border-sk-line-strong bg-white text-sk-faint hover:border-sk-ink hover:text-sk-ink",
        className,
      )}
    >
      <Check className="size-6" weight="bold" aria-hidden />
    </button>
  )
}

/**
 * SetGroup: one exercise in a log. The name, the target under it ("3 x 5 at 120kg"), an optional
 * hint line ("Last time: ..."), a short status on the right ("2 of 3") and, under that, the SetRows
 * and one row of quiet actions ("Same as target", "Add set"). Groups in a list are divided by hairlines.
 * With `trailing` and no children it is a single line with its control on the right (a tick-only item).
 */
export function SetGroup({
  title,
  target,
  hint,
  status,
  trailing,
  columns,
  actions,
  children,
  className,
  ...rest
}: {
  title?: ReactNode
  target?: ReactNode
  hint?: ReactNode
  status?: ReactNode
  /** A control on the right of the heading (the TickButton of a tick-only item). */
  trailing?: ReactNode
  /** Column labels above the inputs ("Reps", "kg"). Hidden from screen readers; every input has its own label. */
  columns?: string[]
  actions?: ReactNode
  children?: ReactNode
  className?: string
  "data-exercise"?: string
}) {
  return (
    <li className={cn("border-b border-sk-line py-4 first:pt-1.5 last:border-b-0 last:pb-1", className)} {...rest}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {title ? <h3 className="text-base font-bold leading-snug text-sk-ink">{title}</h3> : null}
          {target ? <p className={cn("leading-snug", title ? "text-[0.9375rem] text-sk-ink-2" : "text-base text-sk-ink")}>{target}</p> : null}
          {hint ? <p className="mt-0.5 text-sm leading-snug text-sk-mute">{hint}</p> : null}
        </div>
        {trailing ?? (status ? <span className="shrink-0 text-sm font-bold tabular-nums text-sk-mute">{status}</span> : null)}
      </div>
      {children ? (
        <>
          {columns ? (
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-sk-mute" aria-hidden>
              <span className="w-6 shrink-0" />
              {columns.map((column) => (
                <span key={column} className="flex-1 text-center">
                  {column}
                </span>
              ))}
              <span className="w-[52px] shrink-0 text-center">Done</span>
            </div>
          ) : null}
          <ol className={cn("flex flex-col gap-2", columns ? "mt-1.5" : "mt-3")}>{children}</ol>
        </>
      ) : null}
      {actions ? <div className="-ml-2.5 mt-1.5 flex flex-wrap items-center gap-x-1">{actions}</div> : null}
    </li>
  )
}

/** SetList: the list a session block's SetGroups sit in. */
export function SetList({ children, className, ...rest }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <ul className={cn("flex flex-col", className)} {...rest}>
      {children}
    </ul>
  )
}

/** SetRow: one set. Its number on the left, the inputs (or a line of text) in the middle, the TickButton on the right. */
export function SetRow({ index, children, tick }: { index: number; children: ReactNode; tick: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-6 shrink-0 text-center text-base font-extrabold tabular-nums text-sk-mute" aria-hidden>
        {index}
      </span>
      {children}
      {tick}
    </li>
  )
}

/**
 * EffortScale: a 1 to 10 answer in one tap, two rows of five big buttons, with the word for the
 * chosen number under it. Tap the chosen number again to clear it. `words[n]` describes n (index 0 unused).
 */
export function EffortScale({
  label,
  value,
  onChange,
  words,
  className,
}: {
  label: string
  value: number | null
  onChange: (next: number | null) => void
  words: string[]
  className?: string
}) {
  return (
    <div className={className}>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-2">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((option) => {
          const active = value === option
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${option}, ${words[option] ?? ""}`}
              onClick={() => onChange(active ? null : option)}
              className={cn(
                "h-12 cursor-pointer rounded-[14px] border text-lg font-extrabold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
                active ? "border-sk-blue bg-sk-blue text-white" : "border-sk-line-strong bg-white text-sk-ink hover:border-sk-blue",
              )}
            >
              {option}
            </button>
          )
        })}
      </div>
      <p className="mt-2 min-h-5 text-sm font-semibold text-sk-ink-2" aria-live="polite">
        {value ? `${value} out of 10: ${words[value] ?? ""}` : ""}
      </p>
    </div>
  )
}
