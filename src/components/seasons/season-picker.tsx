import { Field, Select } from "@/components/sk"
import { type ClubSeason } from "@/lib/data/club-admin/season-logic"

/**
 * SeasonPicker: choose which season a screen looks at, from the current season and past ones.
 * Renders nothing when there is only one to choose from.
 */
export function SeasonPicker({
  seasons,
  value,
  onChange,
  label = "Season",
  className,
}: {
  /** Current and past seasons, newest first (pickableSeasons). */
  seasons: ClubSeason[]
  /** The id of the season showing. */
  value: string
  onChange: (seasonId: string) => void
  label?: string
  className?: string
}) {
  if (seasons.length < 2) return null
  return (
    <Field label={label} className={className}>
      <Select name="season" value={value} onChange={(event) => onChange(event.target.value)}>
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.status === "current" ? `${season.name} (current)` : season.name}
          </option>
        ))}
      </Select>
    </Field>
  )
}
