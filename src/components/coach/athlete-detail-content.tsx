"use client"

import { Plus } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { PersonAvatar } from "@/components/account/person-avatar"
import {
  CopyLinkButton,
  EMPTY_MANAGED_ATHLETE_FORM,
  ManagedAthleteFields,
  toManagedAthleteInput,
  type ManagedAthleteFormValues,
} from "@/components/coach/add-athletes-dialog"
import { dayText, markText, ResultMark, StandingTag } from "@/components/athlete/results-parts"
import {
  ActionRow,
  Button,
  Choices,
  DataTable,
  Dialog,
  EmptyState,
  Fact,
  FactList,
  Field,
  InlineConfirm,
  Input,
  LinkButton,
  List,
  ListRow,
  Notice,
  ReadinessText,
  Screen,
  ScreenHeader,
  Section,
  Select,
  SkeletonRows,
  Stat,
  StatStrip,
  StatusDot,
  StatusText,
  TableSub,
  Tabs,
  Textarea,
  TrendLine,
  notify,
  type DataTableColumn,
  type StateTone,
} from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"
import {
  AVAILABILITY_KINDS,
  currentAvailability,
  describeAvailability,
  endAthleteAvailability,
  setAthleteAvailability,
  type AthleteAvailability,
  type AvailabilityKind,
} from "@/lib/data/athlete/availability-data"
import { createAthleteLoginInvite, recordMockInviteEmail } from "@/lib/data/athlete/invite-data"
import { loadCoachAthleteDetail, saveCoachSessionNote } from "@/lib/data/coach/athlete-detail-data"
import type { CoachAthleteDetail, CoachAthleteSessionRow, CoachAthleteWellnessRow } from "@/lib/data/coach/dashboard-data"
import {
  getManagedAthlete,
  getMoveTargets,
  moveAthleteToTeam,
  removeAthleteFromRoster,
  removeManagedAthlete,
  updateManagedAthlete,
  validateManagedAthlete,
  type ManagedAthleteField,
} from "@/lib/data/coach/roster-data"
import { sendInviteEmail } from "@/lib/data/invites/invite-email-data"
import { RESULT_SOURCE_LABELS, standingsOverTime, type AthleteResult, type ResultStanding } from "@/lib/data/pr/marks"
import { parseLocalDay } from "@/lib/data/pr/pr-display"
import { getAthleteRecords, type AthleteRecords } from "@/lib/data/pr/results-data"
import { skippedLabel } from "@/lib/data/session/types"
import { addDaysIso, todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { bodyAreasSummary, PAIN_SEVERITY_WORDS, painImpactLabel } from "@/lib/data/wellness/pain-report-types"

type DetailTab = "overview" | "wellness" | "results" | "details"
const TABS: DetailTab[] = ["overview", "wellness", "results", "details"]
const ROW_LIMIT = 8

type SavedNotice = { tone: "success" | "warning" | "info"; text: string }

function shortDay(value: string | null | undefined, withYear = false) {
  const day = parseLocalDay(value ?? null)
  if (!day) return value ?? ""
  const sameYear = day.getFullYear() === new Date().getFullYear()
  return day.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear || !sameYear ? { year: "numeric" } : {}) })
}

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function ageFrom(dateOfBirth: string | null) {
  const born = parseLocalDay(dateOfBirth)
  if (!born) return null
  const today = new Date()
  let age = today.getFullYear() - born.getFullYear()
  if (today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate())) age -= 1
  return age >= 0 && age < 120 ? age : null
}

function sessionState(session: CoachAthleteSessionRow): { label: string; tone: StateTone } {
  if (session.status === "completed") return { label: "Done", tone: "green" }
  if (session.status === "in-progress") return { label: "In progress", tone: "blue" }
  if (session.status === "skipped") return { label: skippedLabel(session.skipReason), tone: "neutral" }
  if (session.isoDate < todayIso()) return session.excused ? { label: "Excused", tone: "neutral" } : { label: "Not done", tone: "coral" }
  return { label: session.excused ? "Excused" : "Scheduled", tone: "neutral" }
}

/* ---------- Dialogs ---------------------------------------------------------------------------------- */

function AvailabilityDialog({
  open,
  onOpenChange,
  athleteId,
  athleteName,
  current,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  athleteId: string
  athleteName: string
  current: AthleteAvailability | null
  onSaved: () => void
}) {
  const [kind, setKind] = useState<AvailabilityKind>(current?.kind ?? "injured")
  const [startsOn, setStartsOn] = useState(current?.startsOn ?? todayIso())
  const [endsOn, setEndsOn] = useState(current?.endsOn ?? "")
  const [note, setNote] = useState(current?.note ?? "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = athleteName.split(" ")[0] || athleteName

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await setAthleteAvailability(athleteId, { kind, startsOn, endsOn: endsOn || null, note: note.trim() || null })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    notify(`${first} marked ${describeAvailability(result.data)}`)
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={current ? "Change availability" : "Set availability"}
      description={`Planned sessions inside these days are excused for ${first}: they do not count as missed.`}
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Choices label={`${first} is`} value={kind} onChange={setKind} columns={3} options={AVAILABILITY_KINDS.map((option) => ({ value: option.value, label: option.label }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First day">
            <Input type="date" required value={startsOn} min={addDaysIso(todayIso(), -60)} max={addDaysIso(todayIso(), 365)} onChange={(event) => setStartsOn(event.target.value)} />
          </Field>
          <Field label="Last day" optional hint="Leave empty for until further notice.">
            <Input type="date" value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} />
          </Field>
        </div>
        <Field label="Note" optional hint={`${first} and their coaches can read this.`}>
          <Textarea value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving..." : "Save availability"}
          </Button>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function MoveTeamDialog({
  open,
  onOpenChange,
  athleteId,
  athleteName,
  teamId,
  teamName,
  onMoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  athleteId: string
  athleteName: string
  teamId: string | null
  teamName: string | null
  onMoved: (toTeamId: string, toTeamName: string, warning: string | null) => void
}) {
  const { role, coachTeams } = useCoachTeamScope()
  const [targets, setTargets] = useState<Array<{ id: string; name: string }> | null>(null)
  const [target, setTarget] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = athleteName.split(" ")[0] || athleteName
  // A coach may move between the teams they coach; a club admin between any teams of the club.
  const coachTeamIds = role === "coach" ? coachTeams.map((team) => team.id) : null
  const coachTeamKey = coachTeamIds?.join(",") ?? "all"

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getMoveTargets(teamId, coachTeamKey === "all" ? null : coachTeamKey.split(",").filter(Boolean)).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setTargets(result.data)
        setTarget(result.data[0]?.id ?? "")
      } else {
        setTargets([])
        setError(result.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [coachTeamKey, open, teamId])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const chosen = targets?.find((team) => team.id === target)
    if (!chosen) return
    setBusy(true)
    setError(null)
    const result = await moveAthleteToTeam(athleteId, chosen.id)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onOpenChange(false)
    onMoved(chosen.id, chosen.name, result.data.warning)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Move to another team" description={teamName ? `${athleteName} is on ${teamName}.` : `${athleteName} is not on a team.`}>
      {targets === null ? (
        <SkeletonRows rows={2} label="Loading teams" />
      ) : targets.length === 0 ? (
        <div className="flex flex-col gap-4">
          {error ? <Notice tone="error">{error}</Notice> : null}
          <p className="text-[0.9375rem] text-sk-mute">
            {role === "coach"
              ? "You can move an athlete between teams you coach, and you coach one team. A club admin can move athletes between any teams of the club."
              : "There is no other active team to move them to."}
          </p>
          <div>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <Field label="Move to">
            <Select value={target} onChange={(event) => setTarget(event.target.value)}>
              {targets.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-[0.9375rem] text-sk-mute">
            {first}'s sessions, results and check-ins move with them. Upcoming sessions from the old team's plan that {first} has not started are removed, and the new team's plan takes over. {first} and the coaches of both teams are told.
          </p>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || !target}>
              {busy ? "Moving..." : "Move athlete"}
            </Button>
            <Button variant="quiet" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function LoginInviteDialog({
  open,
  onOpenChange,
  athleteId,
  athleteName,
  teamId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  athleteId: string
  athleteName: string
  teamId: string
}) {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ email: string; link: string; sent: boolean; reason: string | null } | null>(null)
  const first = athleteName.split(" ")[0] || athleteName

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await createAthleteLoginInvite({ athleteId, teamId, athleteName, email })
    if (!result.ok) {
      setBusy(false)
      setError(result.error.message)
      return
    }
    const sent = await sendInviteEmail({ kind: "athlete", inviteId: result.data.inviteId })
    recordMockInviteEmail(result.data.inviteId, sent.ok ? { sentAt: sent.data.sentAt } : { error: typeof sent.error.cause === "string" ? sent.error.cause : "provider_failure" })
    setBusy(false)
    setCreated({
      email: email.trim().toLowerCase(),
      link: typeof window !== "undefined" ? new URL(result.data.invitePath, window.location.origin).toString() : result.data.invitePath,
      sent: sent.ok,
      reason: sent.ok ? null : sent.error.message,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setCreated(null)
          setEmail("")
          setError(null)
        }
      }}
      title="Give them a login"
      description={`${first} gets their own account and takes over this record. Everything you entered for them stays.`}
    >
      {created ? (
        <div className="flex flex-col gap-4" data-login-invite={created.sent ? "sent" : "failed"}>
          {created.sent ? (
            <Notice tone="success">
              Invite emailed to <span className="break-all">{created.email}</span>
              <span className="mt-0.5 block font-normal">When they accept it, {first} signs in and sees their own sessions and results. Until then nothing changes for you.</span>
            </Notice>
          ) : (
            <Notice tone="warning">
              Invite created, but the email was not sent
              <span className="mt-0.5 block font-normal">{created.reason} Copy the link and send it to them yourself.</span>
            </Notice>
          )}
          <Field label="Their personal link" hint="It works once, for that email address.">
            <Input readOnly value={created.link} onFocus={(event) => event.currentTarget.select()} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <CopyLinkButton text={created.link} variant={created.sent ? "secondary" : "primary"} />
            <Button variant="quiet" size="sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <Field label="Their email (or a parent's)" hint="Use an address that has no SKTR Coach account yet.">
            <Input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
              {busy ? "Sending..." : "Send login invite"}
            </Button>
            <Button variant="quiet" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function EditManagedDialog({ open, onOpenChange, athleteId, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; athleteId: string; onSaved: () => void }) {
  const [values, setValues] = useState<ManagedAthleteFormValues | null>(null)
  const [errors, setErrors] = useState<Partial<Record<ManagedAthleteField, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setValues(null)
    void getManagedAthlete(athleteId).then((result) => {
      if (cancelled) return
      if (!result.ok || !result.data) {
        setFormError(result.ok ? "This athlete has their own login now and keeps their own details." : result.error.message)
        setValues(EMPTY_MANAGED_ATHLETE_FORM)
        return
      }
      setFormError(null)
      setValues({
        firstName: result.data.firstName,
        lastName: result.data.lastName,
        dateOfBirth: result.data.dateOfBirth ?? "",
        eventGroup: result.data.eventGroup ?? "",
        primaryEvent: result.data.primaryEvent ?? "",
        guardianName: result.data.guardianName ?? "",
        guardianPhone: result.data.guardianPhone ?? "",
        guardianEmail: result.data.guardianEmail ?? "",
      })
    })
    return () => {
      cancelled = true
    }
  }, [athleteId, open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!values) return
    const input = toManagedAthleteInput(values)
    const checked = validateManagedAthlete(input)
    if (!checked.ok) {
      setErrors(checked.fieldErrors)
      setFormError("Check the highlighted fields, then save again.")
      return
    }
    setErrors({})
    setBusy(true)
    const result = await updateManagedAthlete(athleteId, input)
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    notify("Details saved")
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit details" className="sm:max-w-xl">
      {values === null ? (
        <SkeletonRows rows={4} label="Loading details" />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
          <ManagedAthleteFields values={values} onChange={setValues} errors={errors} />
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving..." : "Save details"}
            </Button>
            <Button variant="quiet" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/* ---------- Sections --------------------------------------------------------------------------------- */

function SessionList({
  sessions,
  athleteId,
  onNoteSaved,
}: {
  sessions: CoachAthleteSessionRow[]
  athleteId: string
  onNoteSaved: (sessionId: string, note: string | null) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visible = showAll ? sessions : sessions.slice(0, ROW_LIMIT)

  const save = async (sessionId: string) => {
    setSaving(true)
    setError(null)
    const result = await saveCoachSessionNote(athleteId, sessionId, draft)
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onNoteSaved(sessionId, result.data.coachNote)
    setEditingId(null)
    notify(result.data.coachNote ? "Note saved" : "Note removed")
  }

  return (
    <>
      <List aria-label="Recent sessions">
        {visible.map((session) => {
          const state = sessionState(session)
          const meta = [
            shortDay(session.isoDate),
            session.durationMinutes ? `${session.durationMinutes} min` : null,
            session.origin === "athlete" ? "added by athlete" : null,
            session.status === "completed" && session.completedOn && session.completedOn !== session.isoDate ? `done ${shortDay(session.completedOn)}` : null,
          ].filter(Boolean)
          const editing = editingId === session.id
          return (
            <ActionRow
              key={session.id}
              data-session={session.id}
              leading={<StatusDot tone={state.tone} />}
              title={session.title}
              subtitle={
                <>
                  {meta.join(", ")}
                  {session.results ? (
                    <span className="mt-1 block text-sk-ink-2" data-session-results>
                      {session.results.exercises.length > 0
                        ? session.results.exercises.map((exercise) => (
                            <span key={exercise.id} className="block">
                              <span className="font-semibold text-sk-ink">{exercise.label}</span>{" "}
                              {exercise.sets.every((entry) => entry === "Done") ? (exercise.sets.length > 1 ? `${exercise.sets.length} done` : "done") : exercise.sets.join(", ")}
                              {exercise.target ? <span className="text-sk-mute"> (target {exercise.target})</span> : null}
                            </span>
                          ))
                        : "Finished without logging any sets."}
                      {session.results.rpe || session.results.comment ? (
                        <span className="block">
                          {session.results.rpe ? `Effort ${session.results.rpe} of 10. ` : ""}
                          {session.results.comment ? `"${session.results.comment}"` : ""}
                        </span>
                      ) : null}
                    </span>
                  ) : session.details && session.status === "completed" && !/^Session /.test(session.details) ? (
                    <span className="mt-1 block text-sk-ink-2">{session.details}</span>
                  ) : null}
                  {session.status === "skipped" && session.skipNote ? <span className="mt-1 block text-sk-ink-2">Their note: {session.skipNote}</span> : null}
                  {session.coachNote && !editing ? <span className="mt-1 block text-sk-ink-2">Your note: {session.coachNote}</span> : null}
                </>
              }
              trailing={<StatusText tone={state.tone}>{state.label}</StatusText>}
              className="[&_.sk-list-row]:items-start"
              actions={
                editing ? undefined : (
                  <Button
                    variant="quiet"
                    size="sm"
                    aria-label={`${session.coachNote ? "Edit your note on" : "Add a note to"} ${session.title}, ${shortDay(session.isoDate)}`}
                    onClick={() => {
                      setEditingId(session.id)
                      setDraft(session.coachNote ?? "")
                      setError(null)
                    }}
                  >
                    {session.coachNote ? "Edit note" : "Add note"}
                  </Button>
                )
              }
              below={
                editing ? (
                  <div className="flex flex-col gap-3">
                    <Field label="Note for this session" hint="The athlete sees it when they open the session." error={error ? `Could not save the note: ${error}` : undefined}>
                      <Textarea rows={3} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={saving} onClick={() => void save(session.id)}>
                        {saving ? "Saving..." : "Save note"}
                      </Button>
                      <Button size="sm" variant="quiet" disabled={saving} onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : undefined
              }
            />
          )
        })}
      </List>
      {sessions.length > ROW_LIMIT ? (
        <div>
          <Button variant="quiet" size="sm" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
            {showAll ? "Show fewer" : `Show all ${sessions.length} sessions`}
          </Button>
        </div>
      ) : null}
    </>
  )
}

function OverviewTab({
  detail,
  onChanged,
  onNoteSaved,
  onOpenAvailability,
  onGoTo,
}: {
  detail: CoachAthleteDetail
  onChanged: () => void
  onNoteSaved: (sessionId: string, note: string | null) => void
  onOpenAvailability: () => void
  onGoTo: (tab: DetailTab) => void
}) {
  const { athlete, sessions, availability, openPainReports, wellness } = detail
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)
  const today = todayIso()
  const period = currentAvailability(availability, today)
  const first = athlete.name.split(" ")[0] || athlete.name

  // Adherence: sessions set by the coach that were due in the last 28 days. Skipped with a reason, or
  // inside an unavailable period, leaves the count.
  const windowStart = addDaysIso(today, -27)
  const due = sessions.filter((session) => {
    if (session.isoDate < windowStart || session.isoDate > today || session.origin === "athlete") return false
    return session.status === "completed" || (session.status !== "skipped" && !session.excused)
  })
  const done = due.filter((session) => session.status === "completed").length
  const adherence = due.length > 0 ? Math.round((done / due.length) * 100) : null
  const latest = wellness[0]

  const endPeriod = async () => {
    if (!period) return
    setEnding(true)
    setEndError(null)
    // Ending a period that has not started yet cancels it; otherwise yesterday was the last day off.
    const result = await endAthleteAvailability(period.id)
    setEnding(false)
    setConfirmEnd(false)
    if (!result.ok) {
      setEndError(result.error.message)
      return
    }
    notify(`${first} is marked available again`)
    onChanged()
  }

  return (
    <>
      {detail.hasPainAffectingTraining ? (
        <Notice
          tone="warning"
          action={
            <Button variant="quiet" size="sm" onClick={() => onGoTo("wellness")}>
              See reports
            </Button>
          }
        >
          {first} has an open pain report that changes training: {bodyAreasSummary(openPainReports.find((report) => report.trainingImpact !== "none")?.bodyAreas ?? []).toLowerCase()}.
        </Notice>
      ) : null}

      <StatStrip aria-label="At a glance">
        {adherence === null ? <Stat label="Plan adherence" value="None" hint="No sessions due in the last 4 weeks" /> : <Stat label="Plan adherence" value={adherence} unit="%" hint={`${done} of ${due.length} sessions, last 4 weeks`} />}
        {latest ? <Stat label="Readiness" value={latest.readinessScore} of={100} hint={`Checked in ${shortDay(latest.date)}`} /> : <Stat label="Readiness" value="None" hint="No check-ins yet" />}
        <Stat label="Open pain reports" value={detail.openPainReportCount} hint={detail.openPainReportCount > 0 ? "See Wellness" : "Nothing reported"} />
      </StatStrip>

      <Section
        title="Availability"
        action={
          period ? undefined : (
            <Button variant="quiet" size="sm" onClick={onOpenAvailability}>
              Set availability
            </Button>
          )
        }
      >
        {endError ? <Notice tone="error">{endError}</Notice> : null}
        {period ? (
          <>
            <List aria-label="Availability">
              <ListRow
                leading={<StatusDot tone="amber" />}
                title={sentenceCase(describeAvailability(period, today))}
                subtitle={[period.note, period.createdByRole === "athlete" ? `Set by ${first}` : period.createdByRole ? "Set by a coach" : null, "Planned sessions inside it are excused"].filter(Boolean).join(". ")}
              />
            </List>
            {confirmEnd ? (
              <InlineConfirm
                question={period.startsOn > today ? `Cancel this for ${first}?` : `Mark ${first} available again from today?`}
                confirmLabel={period.startsOn > today ? "Cancel it" : "Mark available"}
                cancelLabel="Keep it"
                busy={ending}
                onConfirm={() => void endPeriod()}
                onCancel={() => setConfirmEnd(false)}
              />
            ) : (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" onClick={() => setConfirmEnd(true)}>
                  {period.startsOn > today ? "Cancel it" : "Mark available again"}
                </Button>
                <Button size="sm" variant="quiet" onClick={onOpenAvailability}>
                  Change dates
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-[0.9375rem] text-sk-mute">Available. If {first} is injured, sick or away, set it here and their planned sessions are excused instead of counting as missed.</p>
        )}
      </Section>

      <Section title="Recent sessions" hint="What was planned and what was logged. A note you add is shown to the athlete in that session.">
        {sessions.length > 0 ? (
          <SessionList sessions={sessions} athleteId={athlete.id} onNoteSaved={onNoteSaved} />
        ) : (
          <EmptyState
            title="No sessions yet"
            body="Sessions appear here once a training plan is published to this athlete's team."
            action={
              <LinkButton to="/coach/training-plan" size="sm">
                Open plans
              </LinkButton>
            }
          />
        )}
      </Section>
    </>
  )
}

function WellnessTab({ detail }: { detail: CoachAthleteDetail }) {
  const { athlete, wellness, openPainReports } = detail
  const [showAll, setShowAll] = useState(false)
  const first = athlete.name.split(" ")[0] || athlete.name
  const points = useMemo(
    () =>
      [...wellness]
        .reverse()
        .slice(-28)
        .flatMap((entry) => {
          const day = parseLocalDay(entry.date)
          return day ? [{ x: day, y: entry.readinessScore }] : []
        }),
    [wellness],
  )
  const latest = wellness[0]
  const earliest = points[0]

  const columns: Array<DataTableColumn<CoachAthleteWellnessRow>> = [
    {
      key: "date",
      header: "Date",
      cell: (entry) => (
        <>
          {shortDay(entry.date)}
          {entry.notes ? <TableSub>{entry.notes}</TableSub> : null}
        </>
      ),
    },
    { key: "readiness", header: "Readiness", phone: "plain", cell: (entry) => <ReadinessText status={entry.readiness} detail={`${entry.readinessScore} of 100`} /> },
    { key: "sleep", header: "Sleep", align: "right", phone: "trailing", strong: true, cell: (entry) => `${entry.sleep}h` },
    { key: "soreness", header: "Soreness", align: "right", cell: (entry) => entry.soreness },
    { key: "fatigue", header: "Fatigue", align: "right", cell: (entry) => entry.fatigue },
    { key: "mood", header: "Mood", align: "right", cell: (entry) => entry.mood },
    { key: "stress", header: "Stress", align: "right", cell: (entry) => entry.stress },
  ]

  return (
    <>
      <Section title="Pain and injury reports" hint="Health information. Only this athlete's coaches and club admins can see it.">
        {openPainReports.length > 0 ? (
          <List aria-label="Open pain reports">
            {openPainReports.map((report) => (
              <ListRow
                key={report.id}
                data-pain-report={report.id}
                leading={<StatusDot tone={report.trainingImpact === "cannot_train" ? "coral" : report.trainingImpact === "modified" ? "amber" : "neutral"} />}
                title={bodyAreasSummary(report.bodyAreas)}
                subtitle={[`${PAIN_SEVERITY_WORDS[report.severity - 1] ?? "Pain"} (${report.severity} of 5), since ${shortDay(report.startedOn)}`, report.note].filter(Boolean).join(". ")}
                trailing={
                  <StatusText tone={report.trainingImpact === "cannot_train" ? "coral" : report.trainingImpact === "modified" ? "amber" : "neutral"}>{painImpactLabel(report.trainingImpact)}</StatusText>
                }
              />
            ))}
          </List>
        ) : (
          <EmptyState title="No open reports" body={`When ${first} reports pain or an injury it shows here until they mark it resolved.`} />
        )}
      </Section>

      <Section title="Readiness" meta={latest ? `Last check-in ${shortDay(latest.date)}` : undefined}>
        {points.length >= 2 && latest && earliest ? (
          <TrendLine
            points={points}
            seriesName="Readiness"
            min={0}
            max={100}
            smooth
            formatDate={(date) => date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            label={`Readiness over the last ${points.length} check-ins, from ${earliest.y} to ${latest.readinessScore} out of 100.`}
          />
        ) : (
          <EmptyState
            title={wellness.length === 0 ? "No check-ins yet" : "One check-in so far"}
            body={`When ${first} fills in the daily check-in, their readiness trend builds up here.`}
          />
        )}
      </Section>

      {wellness.length > 0 ? (
        <Section title="Check-ins" hint="Soreness, fatigue, mood and stress are scored 1 to 5.">
          <DataTable caption={`Wellness check-ins of ${athlete.name}`} columns={columns} rows={showAll ? wellness : wellness.slice(0, ROW_LIMIT)} rowKey={(entry) => entry.id} />
          {wellness.length > ROW_LIMIT ? (
            <div>
              <Button variant="quiet" size="sm" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
                {showAll ? "Show fewer" : `Show all ${wellness.length} check-ins`}
              </Button>
            </div>
          ) : null}
        </Section>
      ) : null}
    </>
  )
}

function ResultsTab({ detail, records, error }: { detail: CoachAthleteDetail; records: AthleteRecords | null; error: string | null }) {
  const { athlete } = detail
  const first = athlete.name.split(" ")[0] || athlete.name
  const addPath = `/coach/athletes/${athlete.id}/results/new`
  const standings = useMemo(() => {
    const all = new Map<string, ResultStanding>()
    for (const event of records?.events ?? []) for (const [id, standing] of standingsOverTime(event.results)) all.set(id, standing)
    return all
  }, [records])

  if (error) return <Notice tone="error">Could not load results: {error}</Notice>
  if (!records) {
    return (
      <Section title="Bests">
        <SkeletonRows rows={4} label="Loading results" />
      </Section>
    )
  }

  if (records.results.length === 0) {
    return (
      <Section title="Results">
        <EmptyState
          title="No results yet"
          body={`Marks from meets, training and test weeks build ${first}'s history. Personal and season bests are worked out from it.`}
          action={
            <LinkButton to={addPath} size="sm">
              Add a result
            </LinkButton>
          }
        />
      </Section>
    )
  }

  const columns: Array<DataTableColumn<AthleteResult>> = [
    {
      key: "date",
      header: "Date",
      cell: (result) => (
        <>
          {dayText(result.date)}
          <TableSub>{[result.location, RESULT_SOURCE_LABELS[result.source]].filter(Boolean).join(", ")}</TableSub>
        </>
      ),
    },
    { key: "event", header: "Event", phone: "plain", cell: (result) => result.eventLabel },
    { key: "mark", header: "Mark", align: "right", strong: true, phone: "trailing", cell: (result) => <ResultMark result={result} size="sm" withWind /> },
    { key: "standing", header: "On the day", phone: "plain", cell: (result) => <StandingTag standing={standings.get(result.id) ?? null} /> },
    {
      key: "edit",
      header: "Change",
      align: "right",
      phone: "plain",
      cell: (result) =>
        result.source !== "test_week" && result.source !== "imported" && !result.competitionEntryId ? (
          <Link className="sk-link" to={`/coach/athletes/${athlete.id}/results/${result.id}`} aria-label={`Correct ${markText(result)} from ${dayText(result.date)}`}>
            Correct
          </Link>
        ) : null,
    },
  ]

  return (
    <>
      <Section title="Bests" meta={`Season ${records.season.start.slice(0, 4)}`}>
        <List aria-label="Personal and season bests">
          {records.events.map((event) => {
            const { personalBest, seasonBest, windAssistedBest } = event.bests
            const lead = personalBest ?? windAssistedBest ?? event.results[0]
            return (
              <ListRow
                key={event.group}
                title={event.label}
                subtitle={
                  <>
                    {personalBest ? `Personal best ${[dayText(personalBest.date), personalBest.location].filter(Boolean).join(", ")}` : "No wind legal mark yet"}
                    <span className="block">
                      {!seasonBest ? "No mark this season" : personalBest && seasonBest.id === personalBest.id ? "Also the season best" : `Season best ${markText(seasonBest)}, ${dayText(seasonBest.date)}`}
                    </span>
                  </>
                }
                trailing={<ResultMark result={lead} />}
              />
            )
          })}
        </List>
      </Section>

      <Section title="All results" meta={`${records.results.length} ${records.results.length === 1 ? "result" : "results"}`}>
        <DataTable caption={`Every result of ${athlete.name}, newest first`} columns={columns} rows={records.results} rowKey={(result) => result.id} />
      </Section>
    </>
  )
}

function DetailsTab({
  detail,
  onChanged,
  onMoved,
  onGone,
}: {
  detail: CoachAthleteDetail
  onChanged: () => void
  onMoved: (toTeamId: string, toTeamName: string, warning: string | null) => void
  onGone: (message: string) => void
}) {
  const { athlete, privateDetails } = detail
  const [moveOpen, setMoveOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirm, setConfirm] = useState<"team" | "club" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = athlete.name.split(" ")[0] || athlete.name
  const age = ageFrom(detail.dateOfBirth)

  const removeFromTeam = async () => {
    if (!athlete.teamId) return
    setBusy(true)
    setError(null)
    const result = await removeAthleteFromRoster(athlete.id, athlete.teamId)
    setBusy(false)
    setConfirm(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onGone(`${athlete.name} was taken off ${athlete.teamName ?? "the team"}. They keep their account and history.`)
  }

  const removeFromClub = async () => {
    setBusy(true)
    setError(null)
    const result = await removeManagedAthlete(athlete.id)
    setBusy(false)
    setConfirm(null)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onGone(`${athlete.name} was removed. Their sessions and results are kept.`)
  }

  return (
    <>
      <Notice>Private details. Only {first}'s coaches and your club admins can see this, never other athletes.</Notice>

      <Section title="About" action={athlete.hasLogin ? undefined : <Button variant="quiet" size="sm" onClick={() => setEditOpen(true)}>Edit details</Button>}>
        <FactList aria-label="About this athlete">
          <Fact label="Login">{athlete.hasLogin ? "Has their own login" : "No login. You enter results and availability for them"}</Fact>
          <Fact label="Date of birth" empty="Not added">
            {detail.dateOfBirth ? `${shortDay(detail.dateOfBirth, true)}${age !== null ? ` (age ${age})` : ""}` : null}
          </Fact>
          <Fact label="Event group">{athlete.eventGroup}</Fact>
          <Fact label="Main event" empty="Not added">
            {athlete.primaryEvent}
          </Fact>
          <Fact label="Preferred name" empty="Not added">
            {privateDetails?.preferredName}
          </Fact>
          <Fact label="Height" empty="Not added">
            {privateDetails?.heightCm ? `${privateDetails.heightCm} cm` : null}
          </Fact>
          <Fact label="Weight" empty="Not added">
            {privateDetails?.weightKg ? `${privateDetails.weightKg} kg` : null}
          </Fact>
          <Fact label="Bib number" empty="Not added">
            {privateDetails?.bibNumber}
          </Fact>
          <Fact label="Affiliation" empty="Not added">
            {privateDetails?.affiliation}
          </Fact>
        </FactList>
      </Section>

      <Section title="Contacts">
        <FactList aria-label="Emergency and guardian contacts">
          <Fact label="Emergency contact" empty="Not added">
            {[privateDetails?.emergencyContactName, privateDetails?.emergencyContactRelationship].filter(Boolean).join(", ") || null}
          </Fact>
          <Fact label="Emergency phone" empty="Not added">
            {privateDetails?.emergencyContactPhone ? (
              <a className="sk-link" href={`tel:${privateDetails.emergencyContactPhone.replace(/[^+0-9]/g, "")}`}>
                {privateDetails.emergencyContactPhone}
              </a>
            ) : null}
          </Fact>
          <Fact label="Parent or guardian" empty={age !== null && age < 18 ? "Not added yet" : "Not added"}>
            {privateDetails?.guardianName}
          </Fact>
          <Fact label="Guardian phone" empty="Not added">
            {privateDetails?.guardianPhone ? (
              <a className="sk-link" href={`tel:${privateDetails.guardianPhone.replace(/[^+0-9]/g, "")}`}>
                {privateDetails.guardianPhone}
              </a>
            ) : null}
          </Fact>
          <Fact label="Guardian email" empty="Not added">
            {privateDetails?.guardianEmail ? (
              <a className="sk-link break-all" href={`mailto:${privateDetails.guardianEmail}`}>
                {privateDetails.guardianEmail}
              </a>
            ) : null}
          </Fact>
          <Fact label="Medical notes" empty="Nothing added" stack>
            {privateDetails?.medicalNotes}
          </Fact>
        </FactList>
      </Section>

      <Section title="Team and access" hint={athlete.teamName ? `${first} is on ${athlete.teamName}.` : `${first} is not on a team.`}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {confirm === "team" ? (
          <InlineConfirm
            question={`Take ${athlete.name} off ${athlete.teamName ?? "the team"}? They keep their account and training history.`}
            confirmLabel="Remove from team"
            cancelLabel="Keep them"
            busy={busy}
            onConfirm={() => void removeFromTeam()}
            onCancel={() => setConfirm(null)}
          />
        ) : confirm === "club" ? (
          <InlineConfirm
            question={`Remove ${athlete.name} from the club? They have no login, so nobody can get them back from here. Their sessions and results are kept.`}
            confirmLabel="Remove athlete"
            cancelLabel="Keep them"
            busy={busy}
            onConfirm={() => void removeFromClub()}
            onCancel={() => setConfirm(null)}
          />
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {!athlete.hasLogin && athlete.teamId ? <Button onClick={() => setLoginOpen(true)}>Give them a login</Button> : null}
            <Button onClick={() => setMoveOpen(true)}>Move to another team</Button>
            {athlete.hasLogin ? (
              athlete.teamId ? (
                <Button variant="danger" onClick={() => setConfirm("team")}>
                  Remove from team
                </Button>
              ) : null
            ) : (
              <Button variant="danger" onClick={() => setConfirm("club")}>
                Remove athlete
              </Button>
            )}
          </div>
        )}
      </Section>

      <MoveTeamDialog open={moveOpen} onOpenChange={setMoveOpen} athleteId={athlete.id} athleteName={athlete.name} teamId={athlete.teamId} teamName={athlete.teamName} onMoved={onMoved} />
      {athlete.teamId ? <LoginInviteDialog open={loginOpen} onOpenChange={setLoginOpen} athleteId={athlete.id} athleteName={athlete.name} teamId={athlete.teamId} /> : null}
      <EditManagedDialog open={editOpen} onOpenChange={setEditOpen} athleteId={athlete.id} onSaved={onChanged} />
    </>
  )
}

/* ---------- The screen -------------------------------------------------------------------------------- */

/** The coach's view of one athlete: overview, wellness, results and private details, with the coach's actions. */
export function CoachAthleteDetailContent({ athleteId, fallbackBackTo = "/coach/teams" }: { athleteId: string; fallbackBackTo?: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { syncSelectedTeam, isAssigned, role } = useCoachTeamScope()
  const [detail, setDetail] = useState<CoachAthleteDetail | null>(null)
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null)
  const [records, setRecords] = useState<AthleteRecords | null>(null)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  const [availabilityOpen, setAvailabilityOpen] = useState(false)
  const [notice, setNotice] = useState<SavedNotice | null>((location.state as { saved?: SavedNotice } | null)?.saved ?? null)

  const requestedTab = searchParams.get("tab") as DetailTab | null
  const tab: DetailTab = requestedTab && TABS.includes(requestedTab) ? requestedTab : "overview"
  const setTab = (next: DetailTab) => {
    const params = new URLSearchParams(searchParams)
    if (next === "overview") params.delete("tab")
    else params.set("tab", next)
    setSearchParams(params, { replace: true, state: location.state })
  }

  const load = useCallback(async () => {
    const result = await loadCoachAthleteDetail(athleteId)
    if (!result.ok) {
      setLoadError({ notFound: result.error.code === "NOT_FOUND" || result.error.code === "FORBIDDEN", message: result.error.message })
      return
    }
    setLoadError(null)
    setDetail(result.data)
  }, [athleteId])

  const loadRecords = useCallback(async () => {
    const result = await getAthleteRecords(athleteId)
    if (result.ok) {
      setRecords(result.data)
      setRecordsError(null)
    } else setRecordsError(result.error.message)
  }, [athleteId])

  useEffect(() => {
    void load()
    void loadRecords()
  }, [load, loadRecords])

  // Opening an athlete by link selects their team, so the rest of the app follows.
  const teamId = detail?.athlete.teamId ?? null
  useEffect(() => {
    if (role === "coach" && teamId && isAssigned(teamId)) syncSelectedTeam(teamId)
  }, [isAssigned, role, syncSelectedTeam, teamId])

  if (loadError && !detail) {
    return (
      <Screen>
        <ScreenHeader
          back={{ to: fallbackBackTo, label: "Athletes" }}
          title={loadError.notFound ? "Athlete not found" : "Athlete"}
          lede={loadError.notFound ? "This athlete is not on a team you coach, or does not exist in your SKTR Coach workspace." : undefined}
        />
        {loadError.notFound ? null : <Notice tone="error">Could not load this athlete: {loadError.message}</Notice>}
      </Screen>
    )
  }

  if (!detail) {
    return (
      <Screen>
        <ScreenHeader back={{ to: fallbackBackTo, label: "Athletes" }} title="Athlete" lede="Getting their details..." />
        <Section aria-label="Loading">
          <SkeletonRows rows={5} label="Loading athlete" />
        </Section>
      </Screen>
    )
  }

  const { athlete } = detail
  const today = todayIso()
  const period = currentAvailability(detail.availability, today)
  const unavailableNow = period && period.startsOn <= today ? period : null
  const backTo = athlete.teamId ? `/coach/teams/${athlete.teamId}` : fallbackBackTo
  const age = ageFrom(detail.dateOfBirth)
  const about = [athlete.primaryEvent, athlete.teamName ?? "No team", age !== null && age < 18 ? `Age ${age}` : null, athlete.hasLogin ? null : "No login"].filter(Boolean).join(", ")

  return (
    <Screen>
      <ScreenHeader
        back={{ to: backTo, label: athlete.teamName ?? "Athletes" }}
        title={
          <span className="flex items-center gap-3 sm:gap-4">
            <PersonAvatar name={athlete.name} athleteId={athlete.id} size="xl" />
            <span className="min-w-0 break-words">{athlete.name}</span>
          </span>
        }
        lede={
          <>
            {about}
            <span className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.9375rem]" data-athlete-status>
              {athlete.readiness ? <ReadinessText status={athlete.readiness} /> : <StatusText tone="neutral">No check-ins yet</StatusText>}
              {unavailableNow ? <StatusText tone="amber">{sentenceCase(describeAvailability(unavailableNow, today))}</StatusText> : <StatusText tone="green">Available</StatusText>}
            </span>
          </>
        }
        actions={
          <>
            <Button onClick={() => setAvailabilityOpen(true)}>{period ? "Change availability" : "Set availability"}</Button>
            <LinkButton to={`/coach/athletes/${athlete.id}/results/new`} variant="primary">
              <Plus className="size-[18px]" weight="bold" aria-hidden />
              Add result
            </LinkButton>
          </>
        }
      />

      {loadError ? <Notice tone="error">Could not load the latest data: {loadError.message}</Notice> : null}
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      <Tabs
        label="Athlete sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview" },
          { value: "wellness", label: "Wellness", count: detail.openPainReportCount > 0 ? detail.openPainReportCount : undefined },
          { value: "results", label: "Results" },
          { value: "details", label: "Details" },
        ]}
      />

      {tab === "overview" ? (
        <OverviewTab
          detail={detail}
          onChanged={() => void load()}
          onOpenAvailability={() => setAvailabilityOpen(true)}
          onGoTo={setTab}
          onNoteSaved={(sessionId, note) =>
            setDetail((current) => (current ? { ...current, sessions: current.sessions.map((session) => (session.id === sessionId ? { ...session, coachNote: note } : session)) } : current))
          }
        />
      ) : null}
      {tab === "wellness" ? <WellnessTab detail={detail} /> : null}
      {tab === "results" ? <ResultsTab detail={detail} records={records} error={recordsError} /> : null}
      {tab === "details" ? (
        <DetailsTab
          detail={detail}
          onChanged={() => void load()}
          onMoved={(toTeamId, toTeamName, warning) => {
            setNotice({ tone: warning ? "warning" : "success", text: warning ?? `${athlete.name} moved to ${toTeamName}. Their history came with them.` })
            // A coach who is not on the new team can no longer open this athlete.
            if (role === "coach" && !isAssigned(toTeamId)) navigate(backTo, { replace: true })
            else void load()
          }}
          onGone={(message) => {
            notify(message)
            navigate(backTo, { replace: true })
          }}
        />
      ) : null}

      <AvailabilityDialog
        key={`${period?.id ?? "new"}-${availabilityOpen}`}
        open={availabilityOpen}
        onOpenChange={setAvailabilityOpen}
        athleteId={athlete.id}
        athleteName={athlete.name}
        current={period}
        onSaved={() => void load()}
      />
    </Screen>
  )
}
