"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { PencilSimple, SignOut } from "@phosphor-icons/react"
import { MySquadsLine } from "@/components/athlete/my-squads-line"
import {
  Avatar,
  Button,
  EmptyState,
  Fact,
  FactList,
  Field,
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
  Split,
  Textarea,
} from "@/components/sk"
import { PhotoSection } from "@/components/account/account-sections"
import { PersonAvatar } from "@/components/account/person-avatar"
import { refreshAccount, useCurrentAccount } from "@/lib/account-store"
import { clearSessionCookies } from "@/lib/auth-session"
import {
  ATHLETE_EVENT_GROUP_OPTIONS,
  EMPTY_ATHLETE_PRIVATE_DETAILS,
  MOCK_ATHLETE_ID,
  MOCK_COACH_EMAIL,
  MOCK_ORGANIZATION_NAME,
  calculateAgeFromDateOfBirth,
  eventGroupLabel,
  getCurrentAthleteProfileSnapshot,
  hasMockAthleteLeftTeam,
  isMinorDateOfBirth,
  loadMockAthletePrivateDetails,
  loadMockAthleteProfileEdits,
  loadMockAthleteTeamCoaches,
  loadMockJoinedTeamId,
  saveMockAthleteProfile,
  updateCurrentAthletePrivateDetails,
  updateCurrentAthleteProfile,
  validateAthletePrivateDetails,
  validateAthleteProfileInput,
  type AthletePrivateDetails,
  type AthletePrivateDetailsField,
  type AthleteProfileField,
  type AthleteProfileInput,
  type AthleteTeamCoach,
  type CurrentAthleteProfileSnapshot,
} from "@/lib/data/athlete/profile-data"
import { MOCK_COACH_TEAM_STORAGE_KEY, MOCK_ROLE_STORAGE_KEY } from "@/lib/mock-auth"
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
  coaches: AthleteTeamCoach[]
  organizationName: string | null
  adherencePercent: number | null
  lastWellness: string | null
  details: AthletePrivateDetails
}

type LoadState = "loading" | "ready" | "missing" | "error"

/** The text fields of the private details, as typed. Height and weight stay text until saved. */
type DetailsDraft = Record<AthletePrivateDetailsField, string>

const PRIVACY_NOTE = "Only you, the coaches of your team and your club's admins can see this."

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
    coaches: snapshot.coaches,
    organizationName: snapshot.organizationName,
    adherencePercent: snapshot.adherencePercent,
    lastWellness: formatDate(snapshot.lastWellnessDate),
    details: snapshot.details,
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

function toDetailsDraft(details: AthletePrivateDetails): DetailsDraft {
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value === null ? "" : String(value)])) as DetailsDraft
}

/** Text back to details. A height or weight that is not a number becomes NaN so validation can say so. */
function fromDetailsDraft(draft: DetailsDraft): AthletePrivateDetails {
  const number = (value: string) => (value.trim() === "" ? null : Number(value.trim().replace(",", ".")))
  return {
    ...EMPTY_ATHLETE_PRIVATE_DETAILS,
    ...Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim() === "" ? null : value])),
    heightCm: number(draft.heightCm),
    weightKg: number(draft.weightKg),
  }
}

function hasGuardian(details: AthletePrivateDetails) {
  return Boolean(details.guardianName || details.guardianPhone || details.guardianEmail)
}

export default function AthleteProfilePage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const navigate = useNavigate()
  const { userEmail } = useRole()
  const { avatarUrl } = useCurrentAccount()

  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<AthleteProfileInput | null>(null)
  const [detailsDraft, setDetailsDraft] = useState<DetailsDraft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AthleteProfileField | AthletePrivateDetailsField, string>>>({})
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
      const teamId = hasMockAthleteLeftTeam() ? null : (loadMockJoinedTeamId() ?? athlete.teamId)
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
        coaches: team ? loadMockAthleteTeamCoaches() : [],
        organizationName: MOCK_ORGANIZATION_NAME,
        adherencePercent: athlete.adherence,
        lastWellness: athlete.lastWellness,
        details: loadMockAthletePrivateDetails(),
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
    setDetailsDraft(toDetailsDraft(profile.details))
    setFieldErrors({})
    setSaveError(null)
    setSavedNotice(false)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setDraft(null)
    setDetailsDraft(null)
    setFieldErrors({})
    setSaveError(null)
  }

  const updateDraft = (field: AthleteProfileField, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value === "" && field !== "firstName" && field !== "lastName" ? null : value } : current))
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const updateDetail = (field: AthletePrivateDetailsField, value: string) => {
    setDetailsDraft((current) => (current ? { ...current, [field]: value } : current))
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft || !detailsDraft || !profile || saving) return

    const validation = validateAthleteProfileInput(draft)
    const detailsValidation = validateAthletePrivateDetails(fromDetailsDraft(detailsDraft))
    if (!validation.ok || !detailsValidation.ok) {
      setFieldErrors({ ...(validation.ok ? {} : validation.fieldErrors), ...(detailsValidation.ok ? {} : detailsValidation.fieldErrors) })
      setSaveError("Some details need a second look. Check the fields marked in red.")
      return
    }

    setSaving(true)
    setSaveError(null)
    const result = isSupabaseMode ? await updateCurrentAthleteProfile(validation.data) : saveMockAthleteProfile(validation.data)
    const detailsResult = result.ok ? await updateCurrentAthletePrivateDetails(detailsValidation.data) : null
    setSaving(false)

    const failure = !result.ok ? result.error : detailsResult && !detailsResult.ok ? detailsResult.error : null
    if (failure) {
      setSaveError(
        failure.code === "FORBIDDEN" || failure.code === "UNAUTHORIZED"
          ? "You are not allowed to change this profile. Sign in again and retry."
          : `Could not save your profile. ${failure.message}`,
      )
      return
    }

    setProfile({ ...profile, ...validation.data, details: detailsValidation.data })
    // The top bar shows the same name.
    void refreshAccount()
    setEditing(false)
    setDraft(null)
    setDetailsDraft(null)
    setFieldErrors({})
    setSavedNotice(true)
  }

  const handleSignOut = async () => {
    if (isSupabaseMode) {
      const supabase = getBrowserSupabaseClient()
      if (supabase) await supabase.auth.signOut({ scope: "local" })
    } else {
      window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    }
    clearSessionCookies()
    navigate("/login")
  }

  const lede = profile
    ? [profile.details.preferredName ? `Goes by ${profile.details.preferredName}` : null, profile.primaryEvent, profile.teamName].filter(Boolean).join(", ") ||
      "Add your events so your coach knows what you train for."
    : undefined

  const details = profile?.details ?? EMPTY_ATHLETE_PRIVATE_DETAILS
  const isMinor = isMinorDateOfBirth(profile?.dateOfBirth ?? null)
  const draftIsMinor = isMinorDateOfBirth(draft?.dateOfBirth ?? null)
  const showGuardianFields = draftIsMinor || hasGuardian(details) || Boolean(detailsDraft?.guardianName || detailsDraft?.guardianPhone || detailsDraft?.guardianEmail)

  const detailField = (field: AthletePrivateDetailsField) => ({
    value: detailsDraft?.[field] ?? "",
    onChange: (event: { target: { value: string } }) => updateDetail(field, event.target.value),
  })

  return (
    <Screen>
      <ScreenHeader
        title={
          <span className="flex items-center gap-3 sm:gap-4">
            {profile ? <Avatar name={fullName} src={avatarUrl} size="xl" /> : null}
            <span className="min-w-0 break-words">{fullName}</span>
          </span>
        }
        lede={lede}
        actions={
          profile && !editing ? (
            <Button onClick={startEditing}>
              <PencilSimple className="size-5" weight="bold" aria-hidden />
              Edit profile
            </Button>
          ) : null
        }
      />

      {loadState === "loading" ? (
        <Section title="About you">
          <SkeletonRows rows={6} label="Loading your profile" />
        </Section>
      ) : null}

      {loadState === "error" ? <Notice tone="error">We could not load your profile. {loadError}</Notice> : null}

      {loadState === "missing" ? (
        <Section title="No team yet">
          <EmptyState
            title="You are not on a team yet"
            body="Your athlete profile is created when you join a team. Ask your coach for an invite, then enter the code."
            action={
              <LinkButton to="/athlete/join" variant="primary">
                Join a team
              </LinkButton>
            }
          />
        </Section>
      ) : null}

      {savedNotice && !editing ? <Notice tone="success">Profile saved.</Notice> : null}

      {profile && editing && draft && detailsDraft ? (
        <form className="flex max-w-[720px] flex-col gap-7 lg:gap-9" onSubmit={(event) => void handleSave(event)} noValidate>
          <Section title="About you" hint="Your coaches see these on the roster.">
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <Field label="First name" error={fieldErrors.firstName}>
                <Input autoComplete="given-name" maxLength={60} value={draft.firstName} onChange={(event) => updateDraft("firstName", event.target.value)} />
              </Field>
              <Field label="Last name" error={fieldErrors.lastName}>
                <Input autoComplete="family-name" maxLength={60} value={draft.lastName} onChange={(event) => updateDraft("lastName", event.target.value)} />
              </Field>
              <Field label="Preferred name" optional hint="What you like to be called." error={fieldErrors.preferredName}>
                <Input autoComplete="nickname" maxLength={60} {...detailField("preferredName")} />
              </Field>
              <Field label="Pronouns" optional error={fieldErrors.pronouns}>
                <Input maxLength={40} placeholder="she/her, he/him, they/them" {...detailField("pronouns")} />
              </Field>
              <Field label="Date of birth" error={fieldErrors.dateOfBirth}>
                <Input
                  type="date"
                  autoComplete="bday"
                  min="1900-01-01"
                  max={new Date().toISOString().slice(0, 10)}
                  value={draft.dateOfBirth ?? ""}
                  onChange={(event) => updateDraft("dateOfBirth", event.target.value)}
                />
              </Field>
              <Field label="Event group" error={fieldErrors.eventGroup}>
                <Select value={draft.eventGroup ?? ""} onChange={(event) => updateDraft("eventGroup", event.target.value)}>
                  <option value="">Not set</option>
                  {eventGroupOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Primary event" error={fieldErrors.primaryEvent}>
                <Input placeholder="100m, long jump, shot put" maxLength={60} value={draft.primaryEvent ?? ""} onChange={(event) => updateDraft("primaryEvent", event.target.value)} />
              </Field>
              <Field label="School or club" optional error={fieldErrors.affiliation}>
                <Input autoComplete="organization" maxLength={120} {...detailField("affiliation")} />
              </Field>
              <Field label="Bib or registration number" optional hint="The number you compete under." error={fieldErrors.bibNumber}>
                <Input maxLength={40} autoCapitalize="characters" {...detailField("bibNumber")} />
              </Field>
            </div>
          </Section>

          <Section title="Body and health" hint={PRIVACY_NOTE}>
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <Field label="Height in cm" optional error={fieldErrors.heightCm}>
                <Input inputMode="decimal" maxLength={6} {...detailField("heightCm")} />
              </Field>
              <Field label="Weight in kg" optional error={fieldErrors.weightKg}>
                <Input inputMode="decimal" maxLength={6} {...detailField("weightKg")} />
              </Field>
              <Field
                className="sm:col-span-2"
                label="Medical notes and allergies"
                optional
                hint="Asthma, allergies, medication, anything a coach should know in an emergency."
                error={fieldErrors.medicalNotes}
              >
                <Textarea rows={3} maxLength={1000} {...detailField("medicalNotes")} />
              </Field>
            </div>
          </Section>

          <Section title="Emergency contact" hint={`Who your club calls if something happens. ${PRIVACY_NOTE}`}>
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <Field label="Contact name" optional error={fieldErrors.emergencyContactName}>
                <Input maxLength={120} {...detailField("emergencyContactName")} />
              </Field>
              <Field label="Relationship" optional error={fieldErrors.emergencyContactRelationship}>
                <Input maxLength={60} placeholder="Mother, partner, friend" {...detailField("emergencyContactRelationship")} />
              </Field>
              <Field label="Contact phone" optional error={fieldErrors.emergencyContactPhone}>
                <Input type="tel" inputMode="tel" maxLength={30} {...detailField("emergencyContactPhone")} />
              </Field>
            </div>
          </Section>

          {showGuardianFields ? (
            <Section
              title="Parent or guardian"
              hint={draftIsMinor ? `You are under 18, so please add a parent or guardian your club can reach. ${PRIVACY_NOTE}` : PRIVACY_NOTE}
            >
              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                <Field label="Guardian name" optional={!draftIsMinor} error={fieldErrors.guardianName}>
                  <Input maxLength={120} {...detailField("guardianName")} />
                </Field>
                <Field label="Guardian phone" optional error={fieldErrors.guardianPhone}>
                  <Input type="tel" inputMode="tel" maxLength={30} {...detailField("guardianPhone")} />
                </Field>
                <Field label="Guardian email" optional error={fieldErrors.guardianEmail}>
                  <Input type="email" inputMode="email" autoCapitalize="none" spellCheck={false} maxLength={254} {...detailField("guardianEmail")} />
                </Field>
              </div>
            </Section>
          ) : null}

          {saveError ? <Notice tone="error">{saveError}</Notice> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </Button>
            <Button variant="quiet" onClick={cancelEditing} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {profile && !editing ? (
        <Split
          main={
            <>
              <Section title="About you">
                <FactList>
                  <Fact label="Name">{fullName}</Fact>
                  <Fact label="Preferred name">{details.preferredName}</Fact>
                  <Fact label="Pronouns">{details.pronouns}</Fact>
                  <Fact label="Date of birth">{profile.dateOfBirth ? `${formatDate(profile.dateOfBirth)}${age !== null ? ` (${age})` : ""}` : null}</Fact>
                  <Fact label="Event group" empty="Not set">
                    {eventGroupLabel(profile.eventGroup)}
                  </Fact>
                  <Fact label="Primary event" empty="Not set">
                    {profile.primaryEvent}
                  </Fact>
                  <Fact label="School or club">{details.affiliation}</Fact>
                  <Fact label="Bib or registration number">{details.bibNumber}</Fact>
                  {profile.email ? <Fact label="Email">{profile.email}</Fact> : null}
                </FactList>
              </Section>

              <Section title="Body and health" hint={PRIVACY_NOTE}>
                <FactList>
                  <Fact label="Height">{details.heightCm !== null ? `${details.heightCm} cm` : null}</Fact>
                  <Fact label="Weight">{details.weightKg !== null ? `${details.weightKg} kg` : null}</Fact>
                  <Fact label="Medical notes and allergies" stack={Boolean(details.medicalNotes)} empty="None added">
                    {details.medicalNotes}
                  </Fact>
                </FactList>
              </Section>

              <Section title="Emergency contact" hint={PRIVACY_NOTE}>
                {details.emergencyContactName || details.emergencyContactPhone ? (
                  <FactList>
                    <Fact label="Name">{details.emergencyContactName}</Fact>
                    <Fact label="Relationship">{details.emergencyContactRelationship}</Fact>
                    <Fact label="Phone">{details.emergencyContactPhone}</Fact>
                  </FactList>
                ) : (
                  <EmptyState
                    title="No emergency contact yet"
                    body="Add the person your club should call if something happens at training or a meet."
                    action={
                      <Button size="sm" onClick={startEditing}>
                        Add a contact
                      </Button>
                    }
                  />
                )}
              </Section>

              {isMinor || hasGuardian(details) ? (
                <Section title="Parent or guardian" hint={PRIVACY_NOTE}>
                  {hasGuardian(details) ? (
                    <FactList>
                      <Fact label="Name">{details.guardianName}</Fact>
                      <Fact label="Phone">{details.guardianPhone}</Fact>
                      <Fact label="Email">{details.guardianEmail}</Fact>
                    </FactList>
                  ) : (
                    <EmptyState
                      title="No parent or guardian yet"
                      body="You are under 18, so your club needs a parent or guardian it can reach."
                      action={
                        <Button size="sm" onClick={startEditing}>
                          Add a parent or guardian
                        </Button>
                      }
                    />
                  )}
                </Section>
              ) : null}

              <Section title="Training" hint="From your coach and your own logging.">
                <FactList>
                  <Fact label="Readiness" empty="Not set yet">
                    {profile.readiness ? <ReadinessText status={profile.readiness} /> : null}
                  </Fact>
                  <Fact label="Sessions done, last 4 weeks" empty="No sessions due">
                    {profile.adherencePercent !== null ? `${profile.adherencePercent}%` : null}
                  </Fact>
                  <Fact label="Last wellness check" empty="None yet">
                    {profile.lastWellness}
                  </Fact>
                </FactList>
              </Section>
            </>
          }
          side={
            <>
              <Section title="Your team">
                {profile.teamName ? (
                  <>
                    <List>
                      <ListRow
                        leading={<Avatar name={profile.teamName} />}
                        title={profile.teamName}
                        subtitle={[profile.organizationName, eventGroupLabel(profile.teamEventGroup)].filter(Boolean).join(", ") || undefined}
                      />
                      {profile.coaches.map((coach) => (
                        <ListRow
                          key={coach.userId ?? coach.name}
                          leading={<PersonAvatar name={coach.name} userId={coach.userId} email={coach.email ?? (isSupabaseMode ? null : MOCK_COACH_EMAIL)} />}
                          title={coach.name}
                          subtitle={
                            <>
                              {coach.isLead ? "Lead coach" : "Coach"}
                              {coach.email ? <span className="break-all">, {coach.email}</span> : null}
                            </>
                          }
                          href={coach.email ? `mailto:${coach.email}` : undefined}
                          aria-label={coach.email ? `Email ${coach.name}, ${coach.isLead ? "lead coach" : "coach"}` : undefined}
                        />
                      ))}
                      {profile.coaches.length === 0 ? <ListRow title="No coach listed yet" subtitle="Your club has not assigned a coach to this team." /> : null}
                    </List>
                    <MySquadsLine />
                    <p className="pt-3 text-sm text-sk-mute">To move to another team or come off this one, ask your coach or club admin.</p>
                  </>
                ) : (
                  <EmptyState
                    title="You are not on a team"
                    body="Ask your coach for an invite link or code to see your plan and test weeks."
                    action={
                      <LinkButton to="/athlete/join" size="sm">
                        Join a team
                      </LinkButton>
                    }
                  />
                )}
              </Section>

              <PhotoSection hint="Your coaches see this on the roster." />

              <Section title="Settings">
                <List>
                  <ListRow to="/account" title="Account and security" subtitle="Email, password and devices." />
                  <ListRow to="/settings/notifications" title="Notification settings" subtitle="What we tell you about and how." />
                  <ListRow to="/athlete/join" title={profile.teamName ? "Join or switch team" : "Join a team"} subtitle="Use an invite link or code from a coach." />
                </List>
                <div className="pt-4">
                  <Button variant="danger" onClick={() => void handleSignOut()}>
                    <SignOut className="size-5" weight="bold" aria-hidden />
                    Sign out
                  </Button>
                </div>
              </Section>
            </>
          }
        />
      ) : null}
    </Screen>
  )
}
