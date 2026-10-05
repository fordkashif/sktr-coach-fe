import { Minus, Plus } from "@phosphor-icons/react"
import { useId, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * FormQuestion: the label line shared by TapScale, Stepper and Choices. A question on the left and,
 * on the right, the current answer in words (or what is missing).
 */
function QuestionHead({ id, label, answer, hint, invalid }: { id: string; label: ReactNode; answer?: ReactNode; hint?: ReactNode; invalid?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p id={id} className="text-base font-semibold leading-snug text-sk-ink">
          {label}
        </p>
        {answer ? <p className={cn("shrink-0 text-sm font-bold", invalid ? "text-sk-coral-ink" : "text-sk-blue-ink")}>{answer}</p> : null}
      </div>
      {hint ? <p className="mt-0.5 text-sm text-sk-mute">{hint}</p> : null}
    </div>
  )
}

const TAP_BASE =
  "flex min-h-12 cursor-pointer items-center justify-center rounded-[14px] border text-center font-bold leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue disabled:cursor-not-allowed disabled:opacity-50"
const TAP_OFF = "border-sk-line-strong bg-white text-sk-ink hover:border-sk-blue"
const TAP_ON = "border-sk-blue bg-sk-blue text-white"

/**
 * TapScale: a 1 to N answer in one tap (N is the number of `words`, normally five). The numbers are the
 * buttons, the words for the two ends sit under them and the word for the chosen number shows beside the
 * question. `missing` marks an unanswered question after a failed submit.
 */
export function TapScale({
  label,
  name,
  words,
  value,
  onChange,
  missing = false,
  hint,
  className,
}: {
  label: string
  /** Short name read out with each option: "Soreness 2 of 5, Light". */
  name: string
  words: string[]
  value: number | null
  onChange: (next: number) => void
  missing?: boolean
  hint?: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn("flex flex-col gap-2.5 py-4", className)}>
      <QuestionHead id={id} label={label} hint={hint} invalid={missing && !value} answer={value ? words[value - 1] : missing ? "Pick one" : null} />
      <div role="radiogroup" aria-labelledby={id} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${words.length}, minmax(0, 1fr))` }}>
        {words.map((word, index) => {
          const option = index + 1
          const selected = value === option
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${name} ${option} of ${words.length}, ${word}`}
              onClick={() => onChange(option)}
              className={cn(TAP_BASE, "text-lg tabular-nums", selected ? TAP_ON : TAP_OFF)}
            >
              {option}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between text-sm text-sk-mute" aria-hidden>
        <span>{words[0]}</span>
        <span>{words[words.length - 1]}</span>
      </div>
    </div>
  )
}

/**
 * Stepper: a number changed with minus and plus (hours of sleep, reps). The value is shown large
 * between the two buttons. `format` turns the number into text ("7.5 hours").
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  format = (current) => String(current),
  decreaseLabel,
  increaseLabel,
  hint,
  className,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  format?: (value: number) => ReactNode
  /** Says what the button does: "Half an hour less sleep". */
  decreaseLabel: string
  increaseLabel: string
  hint?: ReactNode
  className?: string
}) {
  const id = useId()
  const move = (direction: 1 | -1) => {
    const next = Math.round((value + direction * step) / step) * step
    onChange(Math.max(min, Math.min(max, Number(next.toFixed(4)))))
  }
  const buttonClass =
    "flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-[14px] border border-sk-line-strong bg-white text-sk-ink transition-colors hover:border-sk-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue disabled:cursor-not-allowed disabled:opacity-40"
  return (
    <div className={cn("flex flex-col gap-2.5 py-4", className)}>
      <QuestionHead id={id} label={label} hint={hint} />
      <div role="group" aria-labelledby={id} className="flex items-center gap-3">
        <button type="button" className={buttonClass} aria-label={decreaseLabel} disabled={value <= min} onClick={() => move(-1)}>
          <Minus className="size-5" weight="bold" aria-hidden />
        </button>
        <p role="status" className="min-w-0 flex-1 text-center text-[1.75rem] font-extrabold leading-none tracking-[-0.03em] text-sk-ink tabular-nums">
          {format(value)}
        </p>
        <button type="button" className={buttonClass} aria-label={increaseLabel} disabled={value >= max} onClick={() => move(1)}>
          <Plus className="size-5" weight="bold" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export type ChoiceOption<T extends string> = { value: T; label: string; detail?: string }

type ChoicesBase<T extends string> = {
  /** The question. Pass `hideLabel` when a heading right above already asks it. */
  label: string
  hideLabel?: boolean
  options: Array<ChoiceOption<T>>
  /** Buttons per row. Options are equal width. */
  columns?: 1 | 2 | 3
  hint?: ReactNode
  error?: ReactNode
  className?: string
}

/**
 * Choices: tap to pick from a short set of words, as a grid of equal buttons. One answer by default
 * (radio buttons to a screen reader); with `multiple` any number (checkboxes). Use it in forms where
 * Segmented would be wrong because Segmented switches views.
 */
export function Choices<T extends string>(
  props: ChoicesBase<T> & ({ multiple?: false; value: T | null; onChange: (next: T) => void } | { multiple: true; value: T[]; onChange: (next: T[]) => void }),
) {
  const { label, hideLabel, options, columns = 2, hint, error, className } = props
  const id = useId()
  const isOn = (option: T) => (props.multiple ? props.value.includes(option) : props.value === option)
  const toggle = (option: T) => {
    if (props.multiple) props.onChange(props.value.includes(option) ? props.value.filter((item) => item !== option) : [...props.value, option])
    else props.onChange(option)
  }
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {hideLabel ? (
        <span id={id} className="sr-only">
          {label}
        </span>
      ) : (
        <QuestionHead id={id} label={label} hint={hint} />
      )}
      <div
        role={props.multiple ? "group" : "radiogroup"}
        aria-labelledby={id}
        className={cn("grid gap-2", columns === 1 ? "grid-cols-1" : columns === 3 ? "grid-cols-3" : "grid-cols-2")}
      >
        {options.map((option) => {
          const on = isOn(option.value)
          return (
            <button
              key={option.value}
              type="button"
              role={props.multiple ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() => toggle(option.value)}
              className={cn(TAP_BASE, "flex-col px-2.5 py-2 text-[0.9375rem]", on ? TAP_ON : TAP_OFF)}
            >
              {option.label}
              {option.detail ? <span className={cn("text-[0.8125rem] font-medium", on ? "text-white/85" : "text-sk-mute")}>{option.detail}</span> : null}
            </button>
          )
        })}
      </div>
      {error ? (
        <p role="alert" className="sk-field-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
