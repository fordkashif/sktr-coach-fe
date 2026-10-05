import { useId, useMemo, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { SearchInput } from "./form"
import { Avatar } from "./status"

export type PickerPerson = {
  id: string
  name: string
  /** Photo, when there is one. Initials otherwise. */
  avatarSrc?: string | null
  /** One plain line under the name ("100m", "Sprint Group"). */
  detail?: ReactNode
  /** State on the right, as a StatusText ("Injured until 12 Oct"). */
  status?: ReactNode
  /** Why this person cannot be picked ("No login"). The row is shown, greyed, and cannot be chosen. */
  unavailable?: string
}

type PickerBase = {
  /** Says what is being picked: "Athletes to enter". */
  label: string
  people: PickerPerson[]
  /** Shown when the list is empty. */
  empty?: ReactNode
  /** A search box above the list. Defaults to on for more than eight people. */
  searchable?: boolean
  /** Extra content under a chosen person (the events to enter them in). Multiple only. */
  renderChosen?: (person: PickerPerson) => ReactNode
  className?: string
}

/**
 * PersonPicker: choose one person, or with `multiple` several, from a list of people. Rows like
 * CheckRow: a tick box (a radio button for one person), the photo or initials, the name, one line
 * of detail and a state on the right; the whole row is the target. A person who cannot be picked
 * stays in the list, greyed, with the reason. A search box appears for long lists.
 * Use it for recipients and for a roster to enter in something; for a short fixed set of words use Choices.
 */
export function PersonPicker(
  props: PickerBase & ({ multiple?: false; value: string | null; onChange: (id: string) => void } | { multiple: true; value: string[]; onChange: (ids: string[]) => void }),
) {
  const { label, people, empty, renderChosen, className } = props
  const id = useId()
  const [query, setQuery] = useState("")
  const searchable = props.searchable ?? people.length > 8
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? people.filter((person) => person.name.toLowerCase().includes(needle)) : people
  }, [people, query])

  const isOn = (personId: string) => (props.multiple ? props.value.includes(personId) : props.value === personId)
  const toggle = (personId: string) => {
    if (props.multiple) props.onChange(props.value.includes(personId) ? props.value.filter((item) => item !== personId) : [...props.value, personId])
    else props.onChange(personId)
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span id={id} className="sr-only">
        {label}
      </span>
      {searchable ? <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" aria-label={`Search ${label.toLowerCase()}`} /> : null}
      {shown.length === 0 ? (
        <p className="py-3 text-[0.9375rem] text-sk-mute">{people.length === 0 ? (empty ?? "Nobody to choose from yet.") : "Nobody matches that name."}</p>
      ) : (
        <ul role={props.multiple ? "group" : "radiogroup"} aria-labelledby={id} className="sk-list">
          {shown.map((person) => {
            const on = isOn(person.id)
            const blocked = Boolean(person.unavailable)
            return (
              <li key={person.id}>
                <label className={cn("sk-list-row", blocked ? "cursor-default" : "cursor-pointer")}>
                  <input
                    type={props.multiple ? "checkbox" : "radio"}
                    name={props.multiple ? undefined : id}
                    className="size-5 shrink-0 accent-sk-blue"
                    checked={on}
                    disabled={blocked}
                    onChange={() => toggle(person.id)}
                  />
                  <Avatar name={person.name} src={person.avatarSrc} size="md" className={blocked ? "opacity-50" : undefined} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("sk-list-title", blocked && "text-sk-mute")}>{person.name}</span>
                    {person.detail ? <span className="sk-list-sub">{person.detail}</span> : null}
                  </span>
                  {blocked ? (
                    <span className="shrink-0 text-sm font-semibold text-sk-mute">{person.unavailable}</span>
                  ) : person.status ? (
                    <span className="shrink-0 text-right text-sm">{person.status}</span>
                  ) : null}
                </label>
                {on && props.multiple && renderChosen ? <div className="pb-4 pl-8 sm:pl-[5.25rem]">{renderChosen(person)}</div> : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
