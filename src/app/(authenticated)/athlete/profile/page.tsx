"use client"

import { useEffect, useId, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowsLeftRight, Bell, CaretRight, CheckCircle, PencilSimple, SignOut, WarningCircle } from "@phosphor-icons/react"
import { EmptyState, Initials, PageHeader, Panel, ReadinessTag } from "@/components/sk"
import { clearSessionCookies } from "@/lib/auth-session"
import {
  ATHLETE_EVENT_GROUP_OPTIONS,
  MOCK_ATHLETE_ID,
  MOCK_COACH_NAME,
  MOCK_ORGANIZATION_NAME,
  calculateAgeFromDateOfBirth,
  eventGroupLabel,
  getCurrentAthleteProfileSnapshot,
  loadMockAthleteProfileEdits,
  loadMockJoinedTeamId,
  saveMockAthleteProfile,
  updateCurrentAthleteProfile,
  validateAthleteProfileInput,
  type AthleteProfileField,
  type AthleteProfileInput,
  type CurrentAthleteProfileSnapshot,
} from "@/lib/data/athlete/profile-data"
import { useRole } from "@/lib/role-context"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

type ProfileView = {
  firstName: string
  lastName: string
  email: string | null
  dateOfBirth: string | null
  eventGroup: string | null
  primaryEvent: string | null
  readiness: "green" | "yellow" | "red" | null
  teamName: string | null
  teamEventGroup: string | null
  coachNames: string | null
  organizationName: string | null
  adherencePercent: number | null
  lastWellness: string | null
}

type LoadState = "loading" | "ready" | "missing" | "error"

const MOCK_ROLE_STORAGE_KEY = "pacelab:mock-role"
const MOCK_COACH_TEAM_STORAGE_KEY = "pacelab:mock-coach-team"

function formatDate(isoDate: string | null) {
  if (!isoDate) return null
  const parsed = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
}

function viewFromSnapshot(snapshot: CurrentAthleteProfileSnapshot): ProfileView {
  return {
    firstName: snapshot.firstName,
    lastName: snapshot.lastName,
    email: snapshot.email,
    dateOfBirth: snapshot.dateOfBirth,
    eventGroup: snapshot.eventGroup,
    primaryEvent: snapshot.primaryEvent,
    readiness: snapshot.readiness,
    teamName: snapshot.teamName,
    teamEventGroup: snapshot.teamEventGroup,
    coachNames: snapshot.coachNames,
    organizationName: snapshot.organizationName,
    adherencePercent: snapshot.adherencePercent,
    lastWellness: formatDate(snapshot.lastWellnessDate),
  }
}

function toInput(view: ProfileView): AthleteProfileInput {
  return {
    firstName: view.firstName,
    lastName: view.lastName,
    dateOfBirth: view.dateOfBirth,
    eventGroup: view.eventGroup,
    primaryEvent: view.primaryEvent,
  }
}

function DetailRow({ label, children, muted = false }: { label: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="sk-row items-baseline">
      <dt className="sk-label shrink-0">{label}</dt>
      <dd className={muted ? "min-w-0 text-right text-sk-mute" : "min-w-0 break-words text-right font-bold text-sk-ink"}>{children}</dd>
    </div>
  )
}

export default function AthleteProfilePage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const navigate = useNavigate()
  const { userEmail } = useRole()
  const formId = useId()

  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<AthleteProfileInput | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AthleteProfileField, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadSupabase = async () => {
      const result = await getCurrentAthleteProfileSnapshot()
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.error.message)
        setLoadState(result.error.code === "NOT_FOUND" ? "missing" : "error")
        return
      }
      setLoadError(null)
      setProfile(viewFromSnapshot(result.data))
      setLoadState("ready")
    }

    const loadMock = async () => {
      const module = await import("@/lib/mock-data")
      if (cancelled) return
      const athlete = module.mockAthletes.find((item) => item.id === MOCK_ATHLETE_ID) ?? module.mockAthletes[0]
      const edits = loadMockAthleteProfileEdits()
      const [mockFirst, ...mockRest] = athlete.name.split(" ")
      const teamId = loadMockJoinedTeamId() ?? athlete.teamId
      const team = module.mockTeams.find((item) => item.id === teamId) ?? null
      setProfile({
        firstName: edits.firstName ?? mockFirst ?? "",
        lastName: edits.lastName ?? mockRest.join(" "),
        email: userEmail,
        dateOfBirth: edits.dateOfBirth ?? null,
        eventGroup: edits.eventGroup !== undefined ? edits.eventGroup : athlete.eventGroup,
        primaryEvent: edits.primaryEvent !== undefined ? edits.primaryEvent : athlete.primaryEvent,
        readiness: athlete.readiness,
        teamName: team?.name ?? null,
        teamEventGroup: team?.eventGroup ?? null,
        coachNames: team ? MOCK_COACH_NAME : null,
        organizationName: MOCK_ORGANIZATION_NAME,
        adherencePercent: athlete.adherence,
        lastWellness: athlete.lastWellness,
      })
      setLoadState("ready")
    }

    void (isSupabaseMode ? loadSupabase() : loadMock())
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, userEmail])

  const fullName = profile ? `${profile.firstName} ${profile.lastName}`.trim() || "Athlete" : "Your profile"
  const age = useMemo(() => calculateAgeFromDateOfBirth(profile?.dateOfBirth ?? null), [profile?.dateOfBirth])

  const eventGroupOptions = useMemo(() => {
    const current = draft?.eventGroup
    if (current && !ATHLETE_EVENT_GROUP_OPTIONS.some((option) => option.value === current)) {
      return [...ATHLETE_EVENT_GROUP_OPTIONS, { value: current, label: current }]
    }
    return ATHLETE_EVENT_GROUP_OPTIONS
  }, [draft?.eventGroup])

  const startEditing = () => {
    if (!profile) return
    setDraft(toInput(profile))
    setFieldErrors({})
    setSaveError(null)
    setSavedNotice(false)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setDraft(null)
    setFieldErrors({})
    setSaveError(null)
  }

  const updateDraft = (field: AthleteProfileField, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value === "" && field !== "firstName" && field !== "lastName" ? null : value } : current))
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft || !profile || saving) return

    const validation = validateAthleteProfileInput(draft)
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors)
      setSaveError(null)
      return
    }

    setSaving(true)
    setSaveError(null)
    const result = isSupabaseMode ? await updateCurrentAthleteProfile(validation.data) : saveMockAthleteProfile(validation.data)
    setSaving(false)

    if (!result.ok) {
      setSaveError(
        result.error.code === "FORBIDDEN" || result.error.code === "UNAUTHORIZED"
          ? "You are not allowed to change this profile. Sign in again and retry."
          : `Could not save your profile. ${result.error.message}`,
      )
      return
    }

    setProfile({ ...profile, ...result.data })
    setEditing(false)
    setDraft(null)
    setFieldErrors({})
    setSavedNotice(true)
  }

  const handleSignOut = async () => {
    if (isSupabaseMode) {
      const supabase = getBrowserSupabaseClient()
      if (supabase) await supabase.auth.signOut()
    } else {
      window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    }
    clearSessionCookies()
    navigate("/login")
  }

  const fieldProps = (field: AthleteProfileField) => ({
    id: `${formId}-${field}`,
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `${formId}-${field}-error` : undefined,
  })

  const fieldError = (field: AthleteProfileField) =>
    fieldErrors[field] ? (
      <p id={`${formId}-${field}-error`} className="mt-1.5 text-sm font-semibold text-[#b32a0c]">
        {fieldErrors[field]}
      </p>
    ) : null

  const lede = profile
    ? [profile.primaryEvent, profile.teamName].filter(Boolean).join(", ") || "Add your events so your coach knows what you train for."
    : undefined

  return (
    <div className="sk-page">
      <PageHeader
        title={
          <span className="flex items-center gap-3 sm:gap-4">
            {profile ? <Initials name={fullName} size="lg" /> : null}
            <span className="min-w-0 break-words">{fullName}</span>
          </span>
        }
        lede={lede}
        actions={
          profile && !editing ? (
            <button type="button" className="sk-btn sk-btn-primary" onClick={startEditing}>
              <PencilSimple className="size-5" weight="bold" />
              Edit profile
            </button>
          ) : null
        }
      />

      {loadState === "loading" ? <p className="text-sk-mute">Loading your profile...</p> : null}

      {loadState === "error" ? (
        <div className="flex items-start gap-3 rounded-2xl bg-sk-coral-tint p-4" role="alert">
          <WarningCircle className="mt-0.5 size-5 shrink-0 text-[#b32a0c]" weight="fill" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-bold text-[#b32a0c]">We could not load your profile.</p>
            <p className="text-sk-ink-2">{loadError}</p>
          </div>
        </div>
      ) : null}

      {loadState === "missing" ? (
        <EmptyState
          title="You are not on a team yet"
          body="Your athlete profile is created when you join a team. Ask your coach for an invite, then enter the code."
          action={
            <Link to="/athlete/join" className="sk-btn sk-btn-primary">
              Join a team
            </Link>
          }
        />
      ) : null}

      {savedNotice && !editing ? (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-bold text-[#07673f]">
          <CheckCircle className="size-5 shrink-0" weight="fill" aria-hidden />
          Profile saved.
        </p>
      ) : null}

      {profile ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-8">
          <div className="space-y-6 lg:space-y-8">
            {editing && draft ? (
              <Panel title="Edit your details" hint="Your coach sees these on the roster.">
                <form className="grid gap-4" onSubmit={handleSave} noValidate>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`${formId}-firstName`} className="sk-label mb-1.5 block">
                        First name
                      </label>
                      <input
                        {...fieldProps("firstName")}
                        className="sk-field"
                        autoComplete="given-name"
                        maxLength={60}
                        value={draft.firstName}
                        onChange={(event) => updateDraft("firstName", event.target.value)}
                      />
                      {fieldError("firstName")}
                    </div>
                    <div>
                      <label htmlFor={`${formId}-lastName`} className="sk-label mb-1.5 block">
                        Last name
                      </label>
                      <input
                        {...fieldProps("lastName")}
                        className="sk-field"
                        autoComplete="family-name"
                        maxLength={60}
                        value={draft.lastName}
                        onChange={(event) => updateDraft("lastName", event.target.value)}
                      />
                      {fieldError("lastName")}
                    </div>
                  </div>
                  <div>
                    <label htmlFor={`${formId}-dateOfBirth`} className="sk-label mb-1.5 block">
                      Date of birth
                    </label>
                    <input
                      {...fieldProps("dateOfBirth")}
                      type="date"
                      className="sk-field"
                      autoComplete="bday"
                      min="1900-01-01"
                      max={new Date().toISOString().slice(0, 10)}
                      value={draft.dateOfBirth ?? ""}
                      onChange={(event) => updateDraft("dateOfBirth", event.target.value)}
                    />
                    {fieldError("dateOfBirth")}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`${formId}-eventGroup`} className="sk-label mb-1.5 block">
                        Event group
                      </label>
                      <select
                        {...fieldProps("eventGroup")}
                        className="sk-field"
                        value={draft.eventGroup ?? ""}
                        onChange={(event) => updateDraft("eventGroup", event.target.value)}
                      >
                        <option value="">Not set</option>
                        {eventGroupOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {fieldError("eventGroup")}
                    </div>
                    <div>
                      <label htmlFor={`${formId}-primaryEvent`} className="sk-label mb-1.5 block">
                        Primary event
                      </label>
                      <input
                        {...fieldProps("primaryEvent")}
                        className="sk-field"
                        placeholder="100m, long jump, shot put"
                        maxLength={60}
                        value={draft.primaryEvent ?? ""}
                        onChange={(event) => updateDraft("primaryEvent", event.target.value)}
                      />
                      {fieldError("primaryEvent")}
                    </div>
                  </div>
                  {saveError ? (
                    <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
                      {saveError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="submit" className="sk-btn sk-btn-primary" disabled={saving}>
                      {saving ? "Saving..." : "Save profile"}
                    </button>
                    <button type="button" className="sk-btn sk-btn-ghost" onClick={cancelEditing} disabled={saving}>
                      Cancel
                    </button>
                  </div>
                </form>
              </Panel>
            ) : (
              <Panel title="About you">
                <dl>
                  <DetailRow label="Name">{fullName}</DetailRow>
                  <DetailRow label="Date of birth" muted={!profile.dateOfBirth}>
                    {profile.dateOfBirth
                      ? `${formatDate(profile.dateOfBirth)}${age !== null ? ` (${age})` : ""}`
                      : "Not added yet"}
                  </DetailRow>
                  <DetailRow label="Event group" muted={!profile.eventGroup}>
                    {eventGroupLabel(profile.eventGroup) ?? "Not set"}
                  </DetailRow>
                  <DetailRow label="Primary event" muted={!profile.primaryEvent}>
                    {profile.primaryEvent ?? "Not set"}
                  </DetailRow>
                  {profile.email ? <DetailRow label="Email">{profile.email}</DetailRow> : null}
                </dl>
              </Panel>
            )}

            <Panel title="Training" hint="Set by your coach and your own logging.">
              <dl>
                <DetailRow label="Readiness" muted={!profile.readiness}>
                  {profile.readiness ? <ReadinessTag status={profile.readiness} /> : "Not set yet"}
                </DetailRow>
                <DetailRow label="Sessions done, last 4 weeks" muted={profile.adherencePercent === null}>
                  {profile.adherencePercent !== null ? `${profile.adherencePercent}%` : "No sessions yet"}
                </DetailRow>
                <DetailRow label="Last wellness check" muted={!profile.lastWellness}>
                  {profile.lastWellness ?? "None yet"}
                </DetailRow>
              </dl>
            </Panel>
          </div>

          <div className="space-y-6 lg:space-y-8">
            <Panel title="Your team">
              {profile.teamName ? (
                <dl>
                  <DetailRow label="Team">{profile.teamName}</DetailRow>
                  <DetailRow label="Coach" muted={!profile.coachNames}>
                    {profile.coachNames ?? "Not listed yet"}
                  </DetailRow>
                  {profile.organizationName ? <DetailRow label="Club">{profile.organizationName}</DetailRow> : null}
                </dl>
              ) : (
                <p className="text-sm leading-relaxed text-sk-mute">
                  You are not on a team yet. Ask your coach for an invite code to see your plan and test weeks.
                </p>
              )}
              <Link to="/athlete/join" className="sk-btn sk-btn-quiet mt-4 w-full sm:w-auto">
                <ArrowsLeftRight className="size-5" weight="bold" />
                {profile.teamName ? "Switch team" : "Join a team"}
              </Link>
            </Panel>

            <Panel title="Account" flush>
              <div className="px-5 pb-2 pt-3 sm:px-6">
                <Link
                  to="/settings/notifications"
                  className="sk-row min-h-[56px] font-bold text-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
                >
                  <span className="flex items-center gap-3">
                    <Bell className="size-5 text-sk-ink-2" weight="bold" aria-hidden />
                    Notification settings
                  </span>
                  <CaretRight className="size-4 text-sk-mute" weight="bold" aria-hidden />
                </Link>
                <button
                  type="button"
                  className="sk-row min-h-[56px] w-full text-left font-bold text-[#c7300f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
                  onClick={() => {
                    void handleSignOut()
                  }}
                >
                  <span className="flex items-center gap-3">
                    <SignOut className="size-5" weight="bold" aria-hidden />
                    Sign out
                  </span>
                </button>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  )
}
