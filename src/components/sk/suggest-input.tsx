import { useId, useState, type InputHTMLAttributes, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"

export type SuggestOption = { id: string; label: string; detail?: string }

/**
 * SuggestInput: a text input that offers matching saved items while you type (an exercise from
 * the club library). Typing something that is not in the list is always allowed; picking an
 * option calls `onPick`. Arrow keys move through the list, Enter picks the highlighted option,
 * Escape closes the list. With nothing highlighted Enter (and every other key) reaches
 * `onKeyDown`, so the input still works inside a keyboard driven table.
 * `options` is the whole list; the input shows the few that contain what was typed.
 */
export function SuggestInput({
  value,
  onValueChange,
  options,
  onPick,
  listLabel,
  max = 6,
  className,
  onKeyDown,
  onBlur,
  onFocus,
  ...props
}: {
  value: string
  onValueChange: (next: string) => void
  options: SuggestOption[]
  onPick: (option: SuggestOption) => void
  /** Names the list for screen readers ("Exercises in the library"). */
  listLabel: string
  max?: number
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "role">) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const query = value.trim().toLowerCase()
  const matches = query
    ? options
        .filter((option) => option.label.toLowerCase().includes(query))
        // Names that start with what was typed come first.
        .sort((left, right) => Number(right.label.toLowerCase().startsWith(query)) - Number(left.label.toLowerCase().startsWith(query)))
        .slice(0, max)
    : []
  // Nothing to offer once the text is exactly one of the options.
  const exact = matches.length === 1 && matches[0].label.toLowerCase() === query
  const showing = open && matches.length > 0 && !exact

  const pick = (option: SuggestOption) => {
    onPick(option)
    setOpen(false)
    setActive(-1)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (showing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setActive((current) => (current + step + matches.length + (current < 0 && step < 0 ? 1 : 0)) % matches.length)
        return
      }
      if (event.key === "Enter" && active >= 0 && matches[active]) {
        event.preventDefault()
        pick(matches[active])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        setActive(-1)
        return
      }
    }
    onKeyDown?.(event)
  }

  return (
    <span className="relative block min-w-0">
      <input
        {...props}
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className={cn("sk-field", className)}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={(event) => {
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setOpen(false)
          setActive(-1)
          onBlur?.(event)
        }}
        onKeyDown={handleKeyDown}
      />
      {showing ? (
        <ul id={listId} role="listbox" aria-label={listLabel} className="absolute left-0 top-full z-30 mt-1 w-full min-w-[min(18rem,80vw)] overflow-hidden rounded-[12px] border border-sk-line-strong bg-white py-1">
          {matches.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Keeps the input focused, so the click lands before the list closes.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              onMouseEnter={() => setActive(index)}
              className={cn("flex min-h-11 cursor-pointer items-baseline justify-between gap-3 px-3 py-2.5 text-[0.9375rem]", index === active && "bg-sk-soft")}
            >
              <span className="min-w-0 truncate font-semibold text-sk-ink">{option.label}</span>
              {option.detail ? <span className="shrink-0 text-sm text-sk-mute">{option.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  )
}
