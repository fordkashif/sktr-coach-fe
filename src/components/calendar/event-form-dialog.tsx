import { useState } from "react"
import { Button, CheckRow, Choices, Dialog, Field, FormGrid, Input, List, Notice, Textarea, notify } from "@/components/sk"
import { saveClubEvent } from "@/lib/data/calendar/club-events-data"
import { validateClubEvent, type ClubEvent, type ClubEventAudience, type ClubEventInput } from "@/lib/data/calendar/model"
import type { CalendarEventTools } from "./calendar-board"

/** Add a club event, or change one. A coach can only pick the teams they coach; a club admin can also pick the whole club. */
export function EventFormDialog({ event, day, tools, onClose }: { event: ClubEvent | null; day: string; tools: CalendarEventTools; onClose: () => void }) {
  const isAdmin = tools.viewer.role === "club-admin"
  const [title, setTitle] = useState(event?.title ?? "")
  const [startsOn, setStartsOn] = useState(event?.startsOn ?? day)
  const [endsOn, setEndsOn] = useState(event?.endsOn ?? day)
  const [startTime, setStartTime] = useState(event?.startTime ?? "")
  const [endTime, setEndTime] = useState(event?.endTime ?? "")
  const [place, setPlace] = useState(event?.place ?? "")
  const [note, setNote] = useState(event?.note ?? "")
  const [audience, setAudience] = useState<ClubEventAudience>(event?.audience ?? (isAdmin ? "club" : "teams"))
  const [teamIds, setTeamIds] = useState<string[]>(event?.teamIds ?? tools.defaultTeamIds)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const input: ClubEventInput = {
      id: event?.id ?? null,
      title,
      startsOn,
      endsOn: endsOn && endsOn >= startsOn ? endsOn : startsOn,
      startTime: startTime || null,
      endTime: endTime || null,
      place: place || null,
      note: note || null,
      audience,
      teamIds: audience === "teams" ? teamIds : [],
    }
    const invalid = validateClubEvent(input, tools.viewer)
    if (invalid) return setProblem(invalid)
    setSaving(true)
    const result = await saveClubEvent(input, tools.viewer)
    setSaving(false)
    if (!result.ok) return setProblem(result.error.message)
    notify(event ? "Event saved" : "Event added", "It is on the calendar of everyone it is for.")
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={event ? "Edit event" : "Add a club event"}
      description="A meeting, a camp, a closure. It shows on the calendar of the people it is for."
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving..." : event ? "Save event" : "Add event"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault()
          void save()
        }}
      >
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        <Field label="Title">
          <Input value={title} maxLength={120} placeholder="Parents' meeting" onChange={(change) => setTitle(change.target.value)} autoFocus />
        </Field>
        <FormGrid>
          <Field label="First day">
            <Input
              type="date"
              value={startsOn}
              onChange={(change) => {
                const next = change.target.value
                // Moving the first day keeps a one day event one day long.
                if (endsOn === startsOn || endsOn < next) setEndsOn(next)
                setStartsOn(next)
              }}
            />
          </Field>
          <Field label="Last day" hint="The same day for a one day event.">
            <Input type="date" value={endsOn} min={startsOn} onChange={(change) => setEndsOn(change.target.value)} />
          </Field>
          <Field label="Start time" optional hint="Leave empty for all day.">
            <Input type="time" value={startTime} onChange={(change) => setStartTime(change.target.value)} />
          </Field>
          <Field label="End time" optional>
            <Input type="time" value={endTime} onChange={(change) => setEndTime(change.target.value)} />
          </Field>
        </FormGrid>
        <Field label="Place" optional>
          <Input value={place} maxLength={160} placeholder="Club house" onChange={(change) => setPlace(change.target.value)} />
        </Field>
        <Field label="Note" optional hint="Everyone the event is for can read this. Do not put anything private about an athlete here.">
          <Textarea value={note} maxLength={1000} rows={3} onChange={(change) => setNote(change.target.value)} />
        </Field>

        {isAdmin ? (
          <Choices
            label="Who is it for"
            value={audience}
            onChange={setAudience}
            options={[
              { value: "club", label: "The whole club" },
              { value: "teams", label: "Chosen teams" },
            ]}
          />
        ) : null}
        {audience === "teams" ? (
          tools.teams.length === 1 && !isAdmin ? (
            <p className="text-[0.9375rem] text-sk-mute">
              For <span className="font-semibold text-sk-ink">{tools.teams[0].name}</span>. Only a club admin can add an event for the whole club.
            </p>
          ) : (
            <div>
              <p className="sk-field-label">{isAdmin ? "Teams" : "Which of your teams"}</p>
              <List aria-label="Teams">
                {tools.teams.map((team) => (
                  <CheckRow
                    key={team.id}
                    title={team.name}
                    checked={teamIds.includes(team.id)}
                    onChange={(checked) => setTeamIds((current) => (checked ? [...new Set([...current, team.id])] : current.filter((id) => id !== team.id)))}
                  />
                ))}
              </List>
            </div>
          )
        ) : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  )
}
