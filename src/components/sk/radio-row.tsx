import type { ReactNode } from "react"

/**
 * RadioRow: a list row you pick one of. The whole row is the label of its radio button. Goes inside
 * a List (give the List's wrapper `role="radiogroup"` and a label). Use it when each choice needs a
 * line or two of explanation (a package, a plan template); for short words use Choices.
 * `note` is one plain line on the right, such as "Fits your numbers".
 */
export function RadioRow({
  id,
  name,
  value,
  checked,
  onChange,
  title,
  subtitle,
  detail,
  note,
}: {
  id?: string
  /** The same for every row of one question. */
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  title: ReactNode
  subtitle?: ReactNode
  /** A second, quieter line (limits, a price). */
  detail?: ReactNode
  note?: ReactNode
}) {
  return (
    <li>
      <label className="sk-list-row cursor-pointer items-start">
        <input type="radio" id={id} name={name} value={value} checked={checked} onChange={() => onChange(value)} className="mt-0.5 size-5 shrink-0 accent-sk-blue" />
        <span className="min-w-0 flex-1">
          <span className="sk-list-title">{title}</span>
          {subtitle ? <span className="sk-list-sub">{subtitle}</span> : null}
          {detail ? <span className="sk-list-sub">{detail}</span> : null}
        </span>
        {note ? <span className="shrink-0 text-right text-sm font-semibold text-sk-blue-ink">{note}</span> : null}
      </label>
    </li>
  )
}
