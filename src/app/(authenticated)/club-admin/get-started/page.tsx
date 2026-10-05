import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { describeInviteEmailError, sendInviteEmail } from "@/lib/data/invites/invite-email-data"
import { FirstAccessFrame, PasswordFields, validateNewPassword, type FirstAccessStepId } from "@/components/club-admin/first-access-setup-panel"
import { Button, Fact, FactList, Field, FormActions, FormGrid, Input, Notice, Section, Select, SkeletonRows } from "@/components/sk"
import { completeClubAdminOnboarding, setClubAdminFirstAccessPassword } from "@/lib/data/club-admin/first-access-data"
import {
  createClubAdminTeam,
  createCoachInvite,
  getClubAdminOpsSnapshot,
  getClubAdminProfileRecord,
  getClubAdminTeamsSnapshot,
  getCurrentClubAdminActivationState,
  updateCurrentClubAdminOnboardingStep,
  upsertClubAdminProfileRecord,
  type ClubAdminProfileRecord,
} from "@/lib/data/club-admin/ops-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { loadProfileSafe } from "../state"

const defaultProfile: ClubAdminProfileRecord = {
  clubName: "",
  shortName: "",
  primaryColor: "#1368ff",
  seasonYear: "2026",
  seasonStart: "2026-01-10",
  seasonEnd: "2026-10-30",
  passwordSetAt: null,
  onboardingCompletedAt: null,
}

type WizardStep = Extract<FirstAccessStepId, "password" | "club" | "team" | "coach" | "finish">
const STEP_ORDER: WizardStep[] = ["club", "team", "coach", "finish"]

const EVENT_GROUP_OPTIONS = ["Sprint", "Mid", "Distance", "Jumps", "Throws"] as const
type EventGroupOption = (typeof EVENT_GROUP_OPTIONS)[number]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Maps the saved tenant onboarding step onto a wizard step. */
function stepFromOnboardingStep(onboardingStep: string | null): WizardStep {
  switch (onboardingStep) {
    case "first_team":
      return "team"
    case "coach_access":
      return "coach"
    case "review":
    case "complete":
      return "finish"
    default:
      return "club"
  }
}

function formatDate(value: string) {
  if (!value) return "Not set"
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export default function ClubAdminGetStartedPage() {
  const navigate = useNavigate()
  const isSupabaseMode = getBackendMode() === "supabase"
  const [profile, setProfile] = useState<ClubAdminProfileRecord>(() =>
    isSupabaseMode ? defaultProfile : { ...defaultProfile, ...loadProfileSafe(), passwordSetAt: "mock" },
  )
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(isSupabaseMode)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<WizardStep>("club")
  /** The step to resume at once the password fallback step is done. */
  const [resumeStep, setResumeStep] = useState<WizardStep>("club")
  const [firstTeamName, setFirstTeamName] = useState("")
  const [firstTeamEventGroup, setFirstTeamEventGroup] = useState<EventGroupOption>("Sprint")
  const [createdTeamId, setCreatedTeamId] = useState<string | null>(null)
  const [coachInviteEmail, setCoachInviteEmail] = useState("")
  /** Email of a coach invite that already exists, so going back never sends it twice. */
  const [sentInviteEmail, setSentInviteEmail] = useState<string | null>(null)
  /** Why the invite email did not go out, when the invite exists but was not emailed. */
  const [inviteEmailProblem, setInviteEmailProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      const client = getBrowserSupabaseClient()
      if (!client) {
        setError("Supabase client failed to initialize.")
        setLoadFailed(true)
        setLoading(false)
        return
      }

      const [activationResult, result, teamsResult, opsResult, sessionResult] = await Promise.all([
        getCurrentClubAdminActivationState(),
        getClubAdminProfileRecord(),
        getClubAdminTeamsSnapshot(),
        getClubAdminOpsSnapshot(),
        client.auth.getSession(),
      ])
      if (cancelled) return

      if (
        activationResult.ok &&
        (activationResult.data.lifecycleStatus === "approved_pending_billing" ||
          activationResult.data.lifecycleStatus === "billing_failed")
      ) {
        navigate("/club-admin/setup/billing", { replace: true })
        return
      }

      if (!result.ok) {
        setError(result.error.message)
        setLoadFailed(true)
        setLoading(false)
        return
      }
      if (result.data.passwordSetAt && result.data.onboardingCompletedAt) {
        navigate("/club-admin/dashboard", { replace: true })
        return
      }

      // Restore what earlier steps already saved, so a refresh never repeats or loses them.
      const existingTeam = teamsResult.ok
        ? teamsResult.data.filter((team) => team.status !== "archived").at(-1) ?? null
        : null
      if (existingTeam) {
        setCreatedTeamId(existingTeam.id)
        setFirstTeamName(existingTeam.name)
        if (EVENT_GROUP_OPTIONS.includes(existingTeam.eventGroup as EventGroupOption)) {
          setFirstTeamEventGroup(existingTeam.eventGroup as EventGroupOption)
        }
      }
      const existingInvite = opsResult.ok ? opsResult.data.invites.find((invite) => invite.status === "pending" || invite.status === "accepted") : null
      if (existingInvite) {
        setSentInviteEmail(existingInvite.email)
        if (existingInvite.status === "pending" && !existingInvite.emailSentAt) {
          setInviteEmailProblem(describeInviteEmailError(existingInvite.emailError) ?? "The invite has not been emailed yet.")
        }
        setCoachInviteEmail(existingInvite.email)
      }

      let savedStep = stepFromOnboardingStep(activationResult.ok ? activationResult.data.onboardingStep : null)
      // The saved step can run ahead of the data (for example a team that was later removed).
      if (!existingTeam && (savedStep === "coach" || savedStep === "finish")) savedStep = "team"

      setProfile(result.data)
      setAccountEmail(sessionResult.data.session?.user.email ?? null)
      setResumeStep(savedStep)
      setStep(result.data.passwordSetAt ? savedStep : "password")
      setError(null)
      setLoadFailed(false)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, navigate])

  const goTo = (next: WizardStep) => {
    setError(null)
    setStep(next)
    if (typeof window !== "undefined") document.getElementById("main-content")?.scrollTo({ top: 0 })
  }

  /** Records progress on the tenant so a refresh resumes at the right step. */
  const saveProgress = async (next: "first_team" | "coach_access" | "review") => {
    if (!isSupabaseMode) return true
    const result = await updateCurrentClubAdminOnboardingStep(next)
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    return true
  }

  const submitPassword = async () => {
    const invalid = validateNewPassword(password, confirmPassword)
    if (invalid) return setError(invalid)
    setSaving(true)
    const result = await setClubAdminFirstAccessPassword(password)
    setSaving(false)
    if (!result.ok) return setError(result.error.message)
    setProfile((current) => ({ ...current, passwordSetAt: new Date().toISOString() }))
    setPassword("")
    setConfirmPassword("")
    goTo(resumeStep)
  }

  const submitClub = async () => {
    if (!profile.clubName.trim()) return setError("Add your club name.")
    if (!profile.shortName.trim()) return setError("Add a short name for your club.")
    if (!profile.seasonYear.trim()) return setError("Add the season year.")
    if (!profile.seasonStart || !profile.seasonEnd) return setError("Add both season dates.")
    if (profile.seasonStart > profile.seasonEnd) return setError("The season has to end after it starts.")

    if (isSupabaseMode) {
      setSaving(true)
      const result = await upsertClubAdminProfileRecord(profile)
      if (!result.ok) {
        setSaving(false)
        return setError(result.error.message)
      }
      const saved = await saveProgress("first_team")
      setSaving(false)
      if (!saved) return
    }
    goTo("team")
  }

  const submitTeam = async () => {
    if (!createdTeamId) {
      if (!firstTeamName.trim()) return setError("Give your first team a name.")
      if (isSupabaseMode) {
        setSaving(true)
        const result = await createClubAdminTeam({
          name: firstTeamName.trim(),
          eventGroup: firstTeamEventGroup,
        })
        if (!result.ok) {
          setSaving(false)
          return setError(result.error.message)
        }
        setCreatedTeamId(result.data.id)
      } else {
        setCreatedTeamId("mock-first-team")
      }
    }
    setSaving(true)
    const saved = await saveProgress("coach_access")
    setSaving(false)
    if (!saved) return
    goTo("coach")
  }

  const submitCoach = async (skip: boolean) => {
    const email = coachInviteEmail.trim().toLowerCase()
    const alreadySent = Boolean(sentInviteEmail) && (email === "" || email === sentInviteEmail)

    if (!skip && !alreadySent) {
      if (!createdTeamId) return setError("Create your first team before inviting a coach.")
      if (!EMAIL_PATTERN.test(email)) return setError("Enter the coach's email address, or skip this for now.")
      let inviteId = "mock-first-coach-invite"
      setSaving(true)
      if (isSupabaseMode) {
        const result = await createCoachInvite({ email, teamId: createdTeamId })
        if (!result.ok) {
          setSaving(false)
          return setError(result.error.message)
        }
        inviteId = result.data.id
      }
      setSentInviteEmail(email)
      const emailResult = await sendInviteEmail({ kind: "coach", inviteId })
      if (!emailResult.ok) {
        // The invite exists, so setup can go on. Stay on this step once so the admin sees the email did not go out.
        setSaving(false)
        setInviteEmailProblem(emailResult.error.message)
        return
      }
      setInviteEmailProblem(null)
    }
    setSaving(true)
    const saved = await saveProgress("review")
    setSaving(false)
    if (!saved) return
    goTo("finish")
  }

  const submitFinish = async () => {
    if (isSupabaseMode) {
      setSaving(true)
      const result = await completeClubAdminOnboarding(profile)
      setSaving(false)
      if (!result.ok) return setError(result.error.message)
    }
    setError(null)
    navigate("/club-admin/dashboard", { replace: true })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setError(null)
    if (step === "password") void submitPassword()
    else if (step === "club") void submitClub()
    else if (step === "team") void submitTeam()
    else if (step === "coach") void submitCoach(false)
    else void submitFinish()
  }

  if (loading) {
    return (
      <FirstAccessFrame title="Setting up your club">
        <SkeletonRows rows={4} label="Loading your setup" />
      </FirstAccessFrame>
    )
  }

  if (loadFailed) {
    return (
      <FirstAccessFrame title="We could not load your setup" lede="Nothing has been lost. Everything you already saved is still there.">
        <Notice tone="error">{error}</Notice>
        <div>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </FirstAccessFrame>
    )
  }

  const stepIndex = STEP_ORDER.indexOf(step)
  const previousStep = stepIndex > 0 ? STEP_ORDER[stepIndex - 1] : null
  const inviteAlreadySent = Boolean(sentInviteEmail) && (coachInviteEmail.trim() === "" || coachInviteEmail.trim().toLowerCase() === sentInviteEmail)
  const teamLabel = firstTeamName.trim() || "your first team"

  const heading: Record<WizardStep, { title: string; lede: string }> = {
    password: {
      title: "Set your password",
      lede: "You need a password before anything else, so you can always sign back in and pick up where you left off.",
    },
    club: {
      title: "Tell us about your club",
      lede: "This is how your club shows up for coaches and athletes. You can change any of it later in Club profile.",
    },
    team: {
      title: "Create your first team",
      lede: "A team is a squad or training group, like your sprinters or your under 18s. Coaches and athletes join a team.",
    },
    coach: {
      title: "Invite your first coach",
      lede: `Coaches build the plans and manage the roster for ${teamLabel}. You can invite more later.`,
    },
    finish: {
      title: "Check and finish",
      lede: "Here is what you have set up. Finish to open your club dashboard.",
    },
  }

  const primaryLabel = saving
    ? "Saving..."
    : step === "password"
      ? "Save password and continue"
      : step === "club"
        ? "Save and continue"
        : step === "team"
          ? createdTeamId
            ? "Continue"
            : "Create team and continue"
          : step === "coach"
            ? inviteAlreadySent
              ? "Continue"
              : "Send invite and continue"
            : "Finish and open dashboard"

  return (
    <FirstAccessFrame step={step} title={heading[step].title} lede={heading[step].lede}>
      <form className="flex flex-col gap-7" onSubmit={handleSubmit} noValidate>
        {step === "password" ? (
          <Section aria-label="Password">
            <div className="flex flex-col gap-4">
              <PasswordFields email={accountEmail} password={password} confirmPassword={confirmPassword} onPasswordChange={setPassword} onConfirmPasswordChange={setConfirmPassword} />
            </div>
          </Section>
        ) : null}

        {step === "club" ? (
          <>
            <Section title="Your club">
              <div className="flex flex-col gap-4 pt-3">
                <Field label="Club name">
                  <Input name="organization" autoComplete="organization" required value={profile.clubName} onChange={(event) => setProfile({ ...profile, clubName: event.target.value })} />
                </Field>
                <FormGrid>
                  <Field label="Short name" hint="A few letters, used where space is tight.">
                    <Input
                      name="short-name"
                      autoComplete="off"
                      autoCapitalize="characters"
                      maxLength={12}
                      required
                      value={profile.shortName}
                      onChange={(event) => setProfile({ ...profile, shortName: event.target.value })}
                    />
                  </Field>
                  <Field label="Club colour">
                    <Input name="club-colour" type="color" className="w-24 cursor-pointer p-1.5" value={profile.primaryColor} onChange={(event) => setProfile({ ...profile, primaryColor: event.target.value })} />
                  </Field>
                </FormGrid>
              </div>
            </Section>
            <Section title="Your season" hint="Plans, records and season bests follow these dates.">
              <div className="flex flex-col gap-4 pt-3">
                <Field label="Season year" className="sm:max-w-40">
                  <Input name="season-year" inputMode="numeric" autoComplete="off" required value={profile.seasonYear} onChange={(event) => setProfile({ ...profile, seasonYear: event.target.value })} />
                </Field>
                <FormGrid>
                  <Field label="Season starts">
                    <Input name="season-start" type="date" autoComplete="off" required value={profile.seasonStart} onChange={(event) => setProfile({ ...profile, seasonStart: event.target.value })} />
                  </Field>
                  <Field label="Season ends">
                    <Input
                      name="season-end"
                      type="date"
                      autoComplete="off"
                      required
                      min={profile.seasonStart || undefined}
                      value={profile.seasonEnd}
                      onChange={(event) => setProfile({ ...profile, seasonEnd: event.target.value })}
                    />
                  </Field>
                </FormGrid>
              </div>
            </Section>
          </>
        ) : null}

        {step === "team" ? (
          <Section aria-label="First team">
            {createdTeamId ? (
              <Notice tone="success">
                {firstTeamName} is created
                <span className="mt-0.5 block font-normal">You can rename it or add more teams from Teams once setup is done.</span>
              </Notice>
            ) : (
              <div className="flex flex-col gap-4">
                <Field label="Team name">
                  <Input name="team-name" autoComplete="off" placeholder="Senior sprints" required value={firstTeamName} onChange={(event) => setFirstTeamName(event.target.value)} />
                </Field>
                <Field label="Event group" className="sm:max-w-56">
                  <Select name="event-group" value={firstTeamEventGroup} onChange={(event) => setFirstTeamEventGroup(event.target.value as EventGroupOption)}>
                    {EVENT_GROUP_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === "Mid" ? "Middle distance" : option}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </Section>
        ) : null}

        {step === "coach" ? (
          <Section aria-label="First coach">
            <div className="flex flex-col gap-4">
              {sentInviteEmail && inviteEmailProblem ? (
                <Notice tone="warning">
                  Invite created, but the email to <span className="break-all">{sentInviteEmail}</span> was not sent
                  <span className="mt-0.5 block font-normal">{inviteEmailProblem} You can continue: after setup, open People, then Invites, to resend the email or copy the link.</span>
                </Notice>
              ) : sentInviteEmail ? (
                <Notice tone="success">
                  Invite emailed to <span className="break-all">{sentInviteEmail}</span>
                  <span className="mt-0.5 block font-normal">Continue, or enter a different email to invite another coach.</span>
                </Notice>
              ) : null}
              <Field label="Coach email" hint={`We email them an invite to join ${teamLabel} as a coach.`}>
                <Input
                  name="coach-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="coach@yourclub.com"
                  value={coachInviteEmail}
                  onChange={(event) => setCoachInviteEmail(event.target.value)}
                />
              </Field>
            </div>
          </Section>
        ) : null}

        {step === "finish" ? (
          <Section aria-label="What you have set up">
            <FactList>
              <Fact label="Club" empty="Not set">
                {profile.clubName}
              </Fact>
              <Fact label="Short name" empty="Not set">
                {profile.shortName}
              </Fact>
              <Fact label="Season">{`${profile.seasonYear}, ${formatDate(profile.seasonStart)} to ${formatDate(profile.seasonEnd)}`}</Fact>
              <Fact label="First team" empty="Not created yet">
                {createdTeamId ? firstTeamName : null}
              </Fact>
              <Fact label="First coach" empty="Not invited yet">
                {sentInviteEmail ? <span className="break-all">{sentInviteEmail}</span> : null}
              </Fact>
            </FactList>
          </Section>
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}

        <FormActions>
          {previousStep ? (
            <Button variant="quiet" size="lg" disabled={saving} className="sm:mr-auto" onClick={() => goTo(previousStep)}>
              Back
            </Button>
          ) : null}
          {step === "coach" && !inviteAlreadySent ? (
            <Button variant="quiet" size="lg" disabled={saving} onClick={() => void submitCoach(true)}>
              Skip for now
            </Button>
          ) : null}
          <Button type="submit" variant="primary" size="lg" disabled={saving}>
            {primaryLabel}
            {saving ? null : <ArrowRight className="size-5" weight="bold" aria-hidden />}
          </Button>
        </FormActions>
      </form>
    </FirstAccessFrame>
  )
}
