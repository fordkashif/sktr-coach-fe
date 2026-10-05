"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { COMPETITIONS_PATH, competitionPath } from "@/components/coach/competitions/competition-parts"
import { Button, Choices, Field, Input, InlineConfirm, LinkButton, Notice, Section, Select, Textarea } from "@/components/sk"
import { createCompetitionForStaff, deleteCompetition, updateCompetition, validateCompetitionInput } from "@/lib/data/competition/competition-data"
import { getStaffTeams, type StaffTeam } from "@/lib/data/competition/staff-roster"
import { COMPETITION_LEVELS, type Competition, type CompetitionInput, type CompetitionLevel } from "@/lib/data/competition/types"

const WHOLE_CLUB = "club"

/**
 * Add or edit a competition as a coach or club admin. A coach's meet belongs to the team they have
 * selected (`teamId`); a club admin (no selected team) chooses a team or the whole club.
 * `existing` switches it to editing (and adds delete).
 */
export function StaffCompetitionForm({ existing, teamId, cancelTo }: { existing?: Competition; teamId: string | null; cancelTo: string }) {
  const navigate = useNavigate()
  const [name, setName] = useState(existing?.name ?? "")
  const [startDate, setStartDate] = useState(existing?.startDate ?? "")
  const [endDate, setEndDate] = useState(existing && existing.endDate !== existing.startDate ? existing.endDate : "")
  const [venue, setVenue] = useState(existing?.venue ?? "")
  const [location, setLocation] = useState(existing?.location ?? "")
  const [level, setLevel] = useState<CompetitionLevel | "">(existing?.level ?? "")
  const [environment, setEnvironment] = useState<"outdoor" | "indoor">(existing?.environment ?? "outdoor")
  const [notes, setNotes] = useState(existing?.notes ?? "")
  // Club admin only: who the meet is for. A coach's meet is for their selected team.
  const [audience, setAudience] = useState<string>("")
  const [teams, setTeams] = useState<StaffTeam[] | null>(null)
  const [errors, setErrors] = useState<{ name?: string; startDate?: string; endDate?: string; audience?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const choosesAudience = !existing && !teamId

  useEffect(() => {
    if (!choosesAudience) return
    let cancelled = false
    void getStaffTeams().then((result) => {
      if (!cancelled) setTeams(result.ok ? result.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [choosesAudience])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const input: CompetitionInput = { name, startDate, endDate: endDate || null, venue, location, level: level || null, environment, notes }
    const nextErrors: typeof errors = {}
    if (!name.trim()) nextErrors.name = "Give the competition a name."
    if (!startDate) nextErrors.startDate = "Choose the date."
    if (startDate && endDate && endDate < startDate) nextErrors.endDate = "The last day cannot be before the first day."
    if (choosesAudience && !audience) nextErrors.audience = "Choose who this competition is for."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setFormError("Check the highlighted fields, then save again.")
      return
    }
    const invalid = validateCompetitionInput(input)
    if (invalid) {
      setFormError(invalid)
      return
    }

    setSaving(true)
    const result = existing
      ? await updateCompetition(existing.id, input)
      : await createCompetitionForStaff(
          choosesAudience ? (audience === WHOLE_CLUB ? { ...input, scope: "club" } : { ...input, scope: "team", teamId: audience }) : { ...input, scope: "team", teamId },
        )
    setSaving(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    navigate(competitionPath(result.data.id), {
      replace: true,
      state: { saved: { tone: "success", text: existing ? "Competition updated." : "Competition added. Now enter your athletes." } },
    })
  }

  const handleDelete = async () => {
    if (!existing) return
    setDeleting(true)
    const result = await deleteCompetition(existing.id)
    setDeleting(false)
    if (!result.ok) {
      setConfirmDelete(false)
      setFormError(result.error.message)
      return
    }
    navigate(COMPETITIONS_PATH, { replace: true })
  }

  return (
    <>
      <Section aria-label="Competition">
        <form className="flex flex-col gap-5" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Field label="Name" error={errors.name}>
            <Input value={name} maxLength={160} placeholder="Spring Open" onChange={(event) => setName(event.target.value)} />
          </Field>
          {choosesAudience ? (
            <Field label="Who it is for" hint="A team's meet shows on that team's calendar. A club wide meet shows for everyone." error={errors.audience}>
              <Select value={audience} onChange={(event) => setAudience(event.target.value)}>
                <option value="">{teams === null ? "Loading teams..." : "Choose"}</option>
                <option value={WHOLE_CLUB}>The whole club</option>
                {(teams ?? []).map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Date" hint="The first day, if it runs for more than one." error={errors.startDate}>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="Last day" optional error={errors.endDate}>
            <Input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
          <Field label="Venue" optional>
            <Input value={venue} maxLength={160} placeholder="National Stadium" onChange={(event) => setVenue(event.target.value)} />
          </Field>
          <Field label="Town or city" optional>
            <Input value={location} maxLength={160} onChange={(event) => setLocation(event.target.value)} />
          </Field>
          <Choices
            label="Indoors or outdoors"
            hint="Wind is only recorded outdoors."
            value={environment}
            onChange={setEnvironment}
            options={[
              { value: "outdoor", label: "Outdoors" },
              { value: "indoor", label: "Indoors" },
            ]}
          />
          <Field label="Level" optional>
            <Select value={level} onChange={(event) => setLevel(event.target.value as CompetitionLevel | "")}>
              <option value="">Not set</option>
              {COMPETITION_LEVELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" optional hint="What athletes need to know: entry deadline, travel, when to report.">
            <Textarea value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
          </Field>

          {formError ? <Notice tone="error">{formError}</Notice> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving..." : existing ? "Save changes" : "Add competition"}
            </Button>
            <LinkButton to={cancelTo} variant="quiet">
              Cancel
            </LinkButton>
          </div>
        </form>
      </Section>

      {existing ? (
        <Section title="Delete this competition" hint="Its entries go with it. Results already recorded stay in each athlete's history.">
          {confirmDelete ? (
            <InlineConfirm question="Delete this competition for good?" confirmLabel="Delete competition" busy={deleting} onConfirm={() => void handleDelete()} onCancel={() => setConfirmDelete(false)} />
          ) : (
            <Button variant="danger" className="mt-2 self-start" onClick={() => setConfirmDelete(true)}>
              Delete competition
            </Button>
          )}
        </Section>
      ) : null}
    </>
  )
}
