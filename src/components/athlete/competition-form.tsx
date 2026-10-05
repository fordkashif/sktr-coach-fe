"use client"

import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Button, Choices, Field, Input, InlineConfirm, LinkButton, Notice, Section, Select, Textarea } from "@/components/sk"
import { createCompetitionForCurrentAthlete, deleteCompetition, updateCompetition, validateCompetitionInput } from "@/lib/data/competition/competition-data"
import { COMPETITION_LEVELS, type Competition, type CompetitionInput, type CompetitionLevel } from "@/lib/data/competition/types"

/** Add or edit a competition the athlete entered on their own. `existing` switches it to editing (and adds delete). */
export function CompetitionForm({ existing, cancelTo }: { existing?: Competition; cancelTo: string }) {
  const navigate = useNavigate()
  const [name, setName] = useState(existing?.name ?? "")
  const [startDate, setStartDate] = useState(existing?.startDate ?? "")
  const [endDate, setEndDate] = useState(existing && existing.endDate !== existing.startDate ? existing.endDate : "")
  const [venue, setVenue] = useState(existing?.venue ?? "")
  const [location, setLocation] = useState(existing?.location ?? "")
  const [level, setLevel] = useState<CompetitionLevel | "">(existing?.level ?? "")
  const [environment, setEnvironment] = useState<"outdoor" | "indoor">(existing?.environment ?? "outdoor")
  const [notes, setNotes] = useState(existing?.notes ?? "")
  const [errors, setErrors] = useState<{ name?: string; startDate?: string; endDate?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    const input: CompetitionInput = { name, startDate, endDate: endDate || null, venue, location, level: level || null, environment, notes }
    const nextErrors: typeof errors = {}
    if (!name.trim()) nextErrors.name = "Give the competition a name."
    if (!startDate) nextErrors.startDate = "Choose the date."
    if (startDate && endDate && endDate < startDate) nextErrors.endDate = "The last day cannot be before the first day."
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
    const result = existing ? await updateCompetition(existing.id, input) : await createCompetitionForCurrentAthlete(input)
    setSaving(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    navigate(`/athlete/competitions/${result.data.id}`, {
      replace: true,
      state: { saved: { tone: "success", text: existing ? "Competition updated." : "Competition added. Now add the events you are entered in." } },
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
    navigate("/athlete/competitions", { replace: true })
  }

  return (
    <>
      <Section aria-label="Competition">
        <form className="flex flex-col gap-5" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Field label="Name" error={errors.name}>
            <Input value={name} maxLength={160} placeholder="Spring Open" onChange={(event) => setName(event.target.value)} />
          </Field>
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
          <Field label="Note" optional hint="Anything to remember: entry deadline, travel, who to report to.">
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
        <Section title="Delete this competition" hint="Your entries go with it. Results you already recorded stay in your history.">
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
