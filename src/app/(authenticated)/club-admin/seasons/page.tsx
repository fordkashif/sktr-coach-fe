import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Plus } from "@phosphor-icons/react"
import {
  ActionRow,
  Button,
  EmptyState,
  Field,
  FormActions,
  FormGrid,
  InlineConfirm,
  Input,
  LinkButton,
  List,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  StatusDot,
  StatusText,
  notify,
  type RowMenuItem,
  type StateTone,
} from "@/components/sk"
import { addDays, currentSeason, SEASON_NAME_MAX, validateSeasonDraft, type ClubSeason, type SeasonDraft, type SeasonDraftErrors } from "@/lib/data/club-admin/season-logic"
import { deleteClubSeason, listClubSeasons, saveClubSeason } from "@/lib/data/club-admin/seasons-data"
import { formatDay } from "../ops-format"

const STATE: Record<ClubSeason["status"], { label: string; tone: StateTone }> = {
  current: { label: "Current", tone: "blue" },
  upcoming: { label: "Upcoming", tone: "neutral" },
  past: { label: "Past", tone: "neutral" },
}

/** A sensible first guess for the next season: the year that follows the newest season. */
function nextSeasonDraft(seasons: ClubSeason[]): SeasonDraft {
  const newest = seasons[0]
  if (!newest) return { name: "", start: "", end: "" }
  const start = addDays(newest.end, 1)
  return { name: "", start, end: addDays(start, 364) }
}

/** The club's seasons: the list, adding the next one, changing names and dates, and the way into the rollover. */
export default function ClubAdminSeasonsPage() {
  const [seasons, setSeasons] = useState<ClubSeason[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** "new" for the add form, a season id for the edit form. */
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<SeasonDraft>({ name: "", start: "", end: "" })
  const [errors, setErrors] = useState<SeasonDraftErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await listClubSeasons()
    if (result.ok) {
      setSeasons(result.data)
      setLoadError(null)
    } else {
      setLoadError(result.error.message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openForm = (season: ClubSeason | null) => {
    setEditing(season ? season.id : "new")
    setDraft(season ? { name: season.name, start: season.start, end: season.end } : nextSeasonDraft(seasons ?? []))
    setErrors({})
    setSaveError(null)
    setRemoving(null)
    setRowError(null)
  }

  const closeForm = () => {
    setEditing(null)
    setErrors({})
    setSaveError(null)
  }

  const update = (field: keyof SeasonDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || !seasons || !editing) return
    const seasonId = editing === "new" ? null : editing
    const checked = validateSeasonDraft(draft, seasons, seasonId)
    if (!checked.ok) {
      setErrors(checked.errors)
      setSaveError(null)
      return
    }
    setSaving(true)
    setSaveError(null)
    const result = await saveClubSeason(seasonId, checked.data)
    setSaving(false)
    if (!result.ok) {
      setSaveError(`Could not save. ${result.error.message}`)
      return
    }
    closeForm()
    await load()
    notify(seasonId ? "Season saved" : "Season added")
  }

  const remove = async (season: ClubSeason) => {
    setRemoveBusy(true)
    const result = await deleteClubSeason(season.id)
    setRemoveBusy(false)
    setRemoving(null)
    if (!result.ok) {
      setRowError(`Could not remove ${season.name}. ${result.error.message}`)
      return
    }
    setRowError(null)
    await load()
    notify("Season removed")
  }

  const current = seasons ? currentSeason(seasons) : null
  const editedSeason = editing && editing !== "new" ? seasons?.find((season) => season.id === editing) ?? null : null

  return (
    <Screen>
      <ScreenHeader
        back={{ to: "/club-admin/profile", label: "Club" }}
        title="Seasons"
        lede={
          seasons
            ? current
              ? `Season bests count from the first day of ${current.name}. Add next season when you know its dates, then start it at year end.`
              : "Add your club's season. Season bests are counted inside the current one."
            : undefined
        }
        actions={
          seasons && editing === null ? (
            <Button variant="primary" onClick={() => openForm(null)}>
              <Plus className="size-[18px]" weight="bold" aria-hidden />
              Add a season
            </Button>
          ) : null
        }
      />

      {loadError ? <Notice tone="error">Your seasons could not be loaded. {loadError}</Notice> : null}

      {editing ? (
        <Section
          title={editedSeason ? `Change ${editedSeason.name}` : "Add a season"}
          hint={
            editedSeason
              ? editedSeason.status === "current"
                ? "Season bests follow these dates straight away."
                : undefined
              : "It is added as upcoming. Nothing changes for coaches or athletes until you start it."
          }
        >
          <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)} noValidate>
            <Field label="Name" error={errors.name}>
              <Input name="season-name" placeholder="2026/27 outdoor" maxLength={SEASON_NAME_MAX} autoComplete="off" value={draft.name} onChange={(event) => update("name", event.target.value)} />
            </Field>
            <FormGrid>
              <Field label="First day" error={errors.start}>
                <Input name="season-start" type="date" value={draft.start} onChange={(event) => update("start", event.target.value)} />
              </Field>
              <Field label="Last day" error={errors.end}>
                <Input name="season-end" type="date" min={draft.start || undefined} value={draft.end} onChange={(event) => update("end", event.target.value)} />
              </Field>
            </FormGrid>
            {saveError ? <Notice tone="error">{saveError}</Notice> : null}
            <FormActions>
              <Button variant="quiet" onClick={closeForm} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving..." : editedSeason ? "Save season" : "Add season"}
              </Button>
            </FormActions>
          </form>
        </Section>
      ) : null}

      <Section title="All seasons" meta={seasons && seasons.length > 0 ? `${seasons.length} ${seasons.length === 1 ? "season" : "seasons"}` : undefined}>
        {rowError ? (
          <Notice tone="error" className="mb-3">
            {rowError}
          </Notice>
        ) : null}
        {seasons === null && !loadError ? <SkeletonRows rows={3} label="Loading seasons" /> : null}
        {seasons && seasons.length === 0 ? (
          <EmptyState
            title="No seasons yet"
            body="Add your first season and season bests will be counted inside it."
            action={
              <Button size="sm" onClick={() => openForm(null)}>
                Add a season
              </Button>
            }
          />
        ) : null}
        {seasons && seasons.length > 0 ? (
          <List aria-label="Seasons">
            {seasons.map((season) => {
              const state = STATE[season.status]
              const items: RowMenuItem[] = [{ label: "Change name and dates", onSelect: () => openForm(season) }]
              if (season.status === "upcoming") {
                items.push({
                  label: "Remove",
                  danger: true,
                  onSelect: () => {
                    setRemoving(season.id)
                    setRowError(null)
                  },
                })
              }
              return (
                <ActionRow
                  key={season.id}
                  data-season-status={season.status}
                  leading={<StatusDot tone={state.tone} />}
                  title={season.name}
                  subtitle={`${formatDay(season.start)} to ${formatDay(season.end)}`}
                  trailing={season.status === "current" ? <StatusText tone="blue">{state.label}</StatusText> : <span className="font-normal text-sk-mute">{state.label}</span>}
                  actions={<RowMenu label={`More for ${season.name}`} items={items} />}
                  below={
                    removing === season.id ? (
                      <InlineConfirm
                        question={`Remove ${season.name}? It has not started, so nothing else changes.`}
                        confirmLabel="Remove season"
                        busy={removeBusy}
                        onConfirm={() => void remove(season)}
                        onCancel={() => setRemoving(null)}
                      />
                    ) : season.status === "upcoming" && editing === null ? (
                      <LinkButton to={`/club-admin/profile/seasons/${season.id}/start`} size="sm">
                        Start this season
                      </LinkButton>
                    ) : null
                  }
                />
              )
            })}
          </List>
        ) : null}
      </Section>
    </Screen>
  )
}
