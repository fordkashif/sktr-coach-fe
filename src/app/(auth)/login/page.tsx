"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, Buildings, PersonSimpleRun, ShieldCheck, Strategy, type Icon } from "@phosphor-icons/react"
import { InviteSteps } from "@/components/auth/invite-frame"
import { Button, CheckRow, Field, FormGrid, Input, LinkButton, List, ListRow, Notice, PasswordInput, RadioRow, ScreenHeader, Section, Select, Textarea } from "@/components/sk"
import { AuthSplit } from "@/layouts/auth-layout"
import { describeAccessRequestError, describeAuthLinkError, describeNoAccessError, describeSignInError } from "@/lib/auth-errors"
import { setSessionCookies } from "@/lib/auth-session"
import { getPackageById, getRecommendedPackage, packageOptions, type PackageId } from "@/lib/billing/package-catalog"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import type { AccountRequest } from "@/lib/mock-club-admin"
import { getBackendMode, isSupabaseEnabled } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionAccess, resolveSessionActor } from "@/lib/supabase/actor"
import { REQUEST_REVIEW_TIME } from "@/lib/support"

type DemoCredential = {
  email: string
  password: string
  role: "athlete" | "coach" | "club-admin" | "platform-admin"
  redirectTo: string
  tenantId: string
  defaultTeamId?: string
}

type DemoCredentialMap = Record<"athlete" | "coach" | "clubAdmin" | "platformAdmin", DemoCredential>
type DemoAccountKey = keyof DemoCredentialMap
type AuthMode = "signin" | "request"

type RequestFormState = {
  firstName: string
  lastName: string
  email: string
  jobTitle: string
  organization: string
  organizationType: string
  requestedPlan: string
  organizationWebsite: string
  region: string
  expectedCoachCount: string
  expectedAthleteCount: string
  desiredStartDate: string
  notes: string
}

type RequestField = Exclude<keyof RequestFormState, "notes">

const organizationTypeOptions = [
  { value: "school", label: "School" },
  { value: "club", label: "Club" },
  { value: "university", label: "University" },
  { value: "private-coaching-group", label: "Private coaching group" },
  { value: "federation", label: "Federation" },
] as const

const emptyRequestForm: RequestFormState = {
  firstName: "",
  lastName: "",
  email: "",
  jobTitle: "",
  organization: "",
  organizationType: "",
  requestedPlan: "",
  organizationWebsite: "",
  region: "",
  expectedCoachCount: "",
  expectedAthleteCount: "",
  desiredStartDate: "",
  notes: "",
}

/** Order the fields appear on screen, so the first one with a problem gets focus. */
const requestFieldOrder: Array<{ field: RequestField; id: string }> = [
  { field: "firstName", id: "request-first-name" },
  { field: "lastName", id: "request-last-name" },
  { field: "email", id: "request-email" },
  { field: "jobTitle", id: "request-job-title" },
  { field: "organization", id: "request-organization" },
  { field: "organizationType", id: "request-organization-type" },
  { field: "region", id: "request-region" },
  { field: "organizationWebsite", id: "request-organization-website" },
  { field: "expectedCoachCount", id: "request-expected-coaches" },
  { field: "expectedAthleteCount", id: "request-expected-athletes" },
  { field: "desiredStartDate", id: "request-desired-start" },
  { field: "requestedPlan", id: "request-package-starter" },
]

const packageCopy: Record<PackageId, string> = {
  starter: "One team getting started with plans and testing.",
  pro: "A growing club with several coaches and teams.",
  enterprise: "Several programs, with setup help and support from us.",
}

const demoAccounts: Array<{ key: DemoAccountKey; label: string; hint: string; icon: Icon }> = [
  { key: "coach", label: "Coach", hint: "Plans, roster, test weeks", icon: Strategy },
  { key: "athlete", label: "Athlete", hint: "Today's session, check-ins", icon: PersonSimpleRun },
  { key: "clubAdmin", label: "Club admin", hint: "Teams, coaches, invites", icon: Buildings },
  { key: "platformAdmin", label: "Platform admin", hint: "Club requests, audit", icon: ShieldCheck },
]

const MAX_HEADCOUNT = 100000
/**
 * A person cannot read and fill this form in under three seconds; a script can. A request sent sooner
 * than this after the form appeared is held back until the time is up (nobody is turned away), and the
 * real time taken is sent along. The database drops requests that report less (20261006181000).
 */
const REQUEST_MIN_FILL_MS = 3000
const MOCK_ROLE_STORAGE_KEY = "pacelab:mock-role"
const MOCK_USER_EMAIL_STORAGE_KEY = "pacelab:mock-user-email"
const MOCK_COACH_TEAM_STORAGE_KEY = "pacelab:mock-coach-team"

async function resolveInitialCoachTeamId() {
  const snapshot = await getCoachTeamsSnapshotForCurrentUser()
  if (!snapshot.ok) return undefined
  return snapshot.data.teams[0]?.id
}

function todayIsoDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isSupabaseMode = getBackendMode() === "supabase"
  const mode: AuthMode = searchParams.get("mode") === "request" ? "request" : "signin"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState("")
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false)
  const [requestForm, setRequestForm] = useState<RequestFormState>(emptyRequestForm)
  const [requestErrors, setRequestErrors] = useState<Partial<Record<RequestField, string>>>({})
  const [requestSubmitted, setRequestSubmitted] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState("")
  const [demoCredentials, setDemoCredentials] = useState<DemoCredentialMap | null>(null)
  const signInLock = useRef(false)
  const requestLock = useRef(false)
  // Honeypot: a field people never see or reach. Only a script fills it. See the form markup below.
  const [referenceCode, setReferenceCode] = useState("")
  const requestShownAt = useRef<number | null>(null)
  const parsedCoachCount = Number.parseInt(requestForm.expectedCoachCount || "0", 10)
  const parsedAthleteCount = Number.parseInt(requestForm.expectedAthleteCount || "0", 10)
  const hasHeadcount =
    requestForm.expectedCoachCount.trim() !== "" &&
    requestForm.expectedAthleteCount.trim() !== "" &&
    parsedCoachCount >= 0 &&
    parsedAthleteCount >= 0
  const selectedPackage = getPackageById(requestForm.requestedPlan)
  const recommendedPackageId =
    parsedCoachCount >= 0 && parsedAthleteCount >= 0 ? getRecommendedPackage(parsedCoachCount, parsedAthleteCount) : null
  const packageFitWarnings =
    selectedPackage &&
    Number.isFinite(selectedPackage.limits.coaches) &&
    Number.isFinite(selectedPackage.limits.athletes)
      ? [
          ...(parsedCoachCount > selectedPackage.limits.coaches
            ? [`${selectedPackage.label} covers up to ${selectedPackage.limits.coaches} coaches. You expect ${parsedCoachCount}.`]
            : []),
          ...(parsedAthleteCount > selectedPackage.limits.athletes
            ? [`${selectedPackage.label} covers up to ${selectedPackage.limits.athletes} athletes. You expect ${parsedAthleteCount}.`]
            : []),
        ]
      : []
  const safeRedirect = (() => {
    const candidate = searchParams.get("redirect")
    return candidate && candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : null
  })()

  // Start the clock when the request form appears (again after a sent request, too).
  useEffect(() => {
    requestShownAt.current = mode === "request" && !requestSubmitted ? performance.now() : null
  }, [mode, requestSubmitted])

  // Mock helpers are only loaded in mock mode so they stay out of the live sign-in path.
  useEffect(() => {
    if (isSupabaseMode) return
    let active = true
    void import("@/lib/mock-auth").then((module) => {
      if (active) setDemoCredentials(module.MOCK_CREDENTIALS)
    })
    return () => {
      active = false
    }
  }, [isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) return
    if (!isSupabaseEnabled()) return

    const supabase = getBrowserSupabaseClient()
    if (!supabase) return

    let active = true
    let redirecting = false

    const routeActor = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!active || !session || redirecting) return

      const actor = await resolveSessionActor(supabase, session)
      if (!active || !actor) return

      redirecting = true
      setError("")

      window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_USER_EMAIL_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
      window.localStorage.setItem("pacelab-remember-me", rememberMe ? "true" : "false")

      let coachTeamId: string | undefined
      if (actor.role === "coach") {
        coachTeamId = await resolveInitialCoachTeamId()
      }

      setSessionCookies(
        actor.role,
        actor.tenantId ?? "platform-admin",
        actor.userEmail ?? session.user.email ?? "",
        actor.role === "coach" ? coachTeamId : undefined,
      )

      if (safeRedirect) {
        navigate(safeRedirect, { replace: true })
        return
      }
      if (actor.role === "athlete") {
        navigate("/athlete/home", { replace: true })
        return
      }
      if (actor.role === "coach") {
        navigate("/coach/dashboard", { replace: true })
        return
      }
      if (actor.role === "platform-admin") {
        navigate("/platform-admin/dashboard", { replace: true })
        return
      }
      navigate("/club-admin/dashboard", { replace: true })
    }

    const handleAuthCallback = async () => {
      const currentUrl = new URL(window.location.href)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""))
      if (hashParams.get("access_token") || hashParams.get("refresh_token")) {
        setError("That sign-in link is in an older format we no longer accept. Sign in with your email and password instead.")
        return
      }
      if (hashParams.get("error") || hashParams.get("error_code") || currentUrl.searchParams.get("error_code")) {
        setError(describeAuthLinkError(hashParams.get("error_description") ?? currentUrl.searchParams.get("error_description")))
        return
      }

      const tokenHash = currentUrl.searchParams.get("token_hash")
      const tokenType = currentUrl.searchParams.get("type")
      if (tokenHash && tokenType) {
        navigate(`/club-admin/claim?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(tokenType)}`, {
          replace: true,
        })
        return
      }

      const callbackCode = currentUrl.searchParams.get("code")
      if (callbackCode) {
        const exchangeResult = await supabase.auth.exchangeCodeForSession(callbackCode)
        if (exchangeResult.error) {
          // A second pass over the same code (React strict mode, a refresh) fails even though the first one signed in.
          const { data: existing } = await supabase.auth.getSession()
          if (!existing.session) {
            if (active) setError(describeAuthLinkError(exchangeResult.error))
            return
          }
        }

        currentUrl.searchParams.delete("code")
        currentUrl.searchParams.delete("type")
        window.history.replaceState({}, document.title, currentUrl.toString())
      }

      await routeActor()
    }

    void handleAuthCallback().catch(() => undefined)

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void routeActor().catch(() => undefined)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [isSupabaseMode, navigate, rememberMe, safeRedirect])

  const signInWithMockAccount = async (accountEmail: string, accountPassword: string) => {
    const { resolveMockLogin } = await import("@/lib/mock-auth")
    const match = resolveMockLogin(accountEmail, accountPassword)

    if (!match) {
      setError("That is not one of the demo accounts. Pick a role under Try the demo.")
      return
    }

    window.localStorage.setItem(MOCK_ROLE_STORAGE_KEY, match.role)
    window.localStorage.setItem(MOCK_USER_EMAIL_STORAGE_KEY, match.email)
    window.localStorage.setItem("pacelab-remember-me", rememberMe ? "true" : "false")

    const coachTeamId = "defaultTeamId" in match ? match.defaultTeamId : undefined
    if (match.role === "coach" && coachTeamId) {
      window.localStorage.setItem(MOCK_COACH_TEAM_STORAGE_KEY, coachTeamId)
    } else {
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    }

    setSessionCookies(match.role, match.tenantId, match.email, match.role === "coach" ? coachTeamId : undefined)
    setError("")
    navigate(match.redirectTo)
  }

  const signInWithSupabase = async () => {
    if (!isSupabaseEnabled()) {
      setError("Sign in is not set up on this site yet. Tell whoever runs it that the connection settings are missing.")
      return
    }

    const supabase = getBrowserSupabaseClient()
    if (!supabase) {
      setError("Sign in could not start. Refresh the page and try again.")
      return
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (signInError || !data.session) {
      setError(describeSignInError(signInError))
      return
    }

    const { actor, noAccessReason } = await resolveSessionAccess(supabase, data.session)
    if (!actor) {
      // Signed in, but nothing to open: the database found no club this account belongs to. Do not leave a half signed-in session behind.
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined)
      setError(describeNoAccessError(noAccessReason))
      return
    }

    window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
    window.localStorage.removeItem(MOCK_USER_EMAIL_STORAGE_KEY)
    window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    window.localStorage.setItem("pacelab-remember-me", rememberMe ? "true" : "false")

    let coachTeamId: string | undefined
    if (actor.role === "coach") {
      coachTeamId = await resolveInitialCoachTeamId()
    }

    setSessionCookies(
      actor.role,
      actor.tenantId ?? "platform-admin",
      actor.userEmail ?? data.session.user.email ?? "",
      actor.role === "coach" ? coachTeamId : undefined,
    )

    setError("")
    if (safeRedirect) {
      navigate(safeRedirect)
      return
    }
    if (actor.role === "athlete") {
      navigate("/athlete/home")
      return
    }
    if (actor.role === "coach") {
      navigate("/coach/dashboard")
      return
    }
    if (actor.role === "platform-admin") {
      navigate("/platform-admin/dashboard")
      return
    }
    navigate("/club-admin/dashboard")
  }

  const runSignIn = async (task: () => Promise<void>) => {
    if (signInLock.current) return
    signInLock.current = true
    setIsSigningIn(true)
    setError("")
    try {
      await task()
    } catch (caught) {
      setError(describeSignInError(caught instanceof Error ? caught : null))
    } finally {
      signInLock.current = false
      setIsSigningIn(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runSignIn(() => (isSupabaseMode ? signInWithSupabase() : signInWithMockAccount(email, password)))
  }

  const handleDemoSignIn = (accountKey: DemoAccountKey) => {
    const account = demoCredentials?.[accountKey]
    if (!account) return
    setEmail(account.email)
    setPassword(account.password)
    void runSignIn(() => signInWithMockAccount(account.email, account.password))
  }

  const updateRequestField = (field: keyof RequestFormState, value: string) => {
    setRequestForm((previous) => ({ ...previous, [field]: value }))
    if (field !== "notes") {
      setRequestErrors((previous) => ({ ...previous, [field]: undefined }))
    }
  }

  const handleRequestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (requestLock.current) return
    setError("")

    const nextErrors: Partial<Record<RequestField, string>> = {}
    const normalizedEmail = requestForm.email.trim().toLowerCase()
    const rawWebsite = requestForm.organizationWebsite.trim()
    const normalizedWebsite = rawWebsite && !/^[a-z][a-z0-9+.-]*:\/\//i.test(rawWebsite) ? `https://${rawWebsite}` : rawWebsite
    const coachCountText = requestForm.expectedCoachCount.trim()
    const athleteCountText = requestForm.expectedAthleteCount.trim()
    const coachCount = Number.parseInt(coachCountText || "0", 10)
    const athleteCount = Number.parseInt(athleteCountText || "0", 10)
    const requestorName = `${requestForm.firstName.trim()} ${requestForm.lastName.trim()}`.trim()
    const notes = requestForm.notes.trim()

    if (!requestForm.firstName.trim()) nextErrors.firstName = "Add your first name."
    if (!requestForm.lastName.trim()) nextErrors.lastName = "Add your last name."
    if (!normalizedEmail) {
      nextErrors.email = "Add your work email."
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = "That does not look like an email address. Check for typos."
    }
    if (!requestForm.jobTitle.trim()) nextErrors.jobTitle = "Add your job title, for example Head coach."
    if (!requestForm.organization.trim()) nextErrors.organization = "Add the name of your club or organization."
    if (!requestForm.organizationType.trim()) nextErrors.organizationType = "Choose the type that fits best."
    if (!requestForm.requestedPlan.trim()) nextErrors.requestedPlan = "Choose the package you want to start with."
    if (!requestForm.region.trim()) nextErrors.region = "Add your country or region."
    if (!coachCountText) {
      nextErrors.expectedCoachCount = "Add how many coaches you expect."
    } else if (!/^\d+$/.test(coachCountText) || coachCount > MAX_HEADCOUNT) {
      nextErrors.expectedCoachCount = "Use a whole number, 0 or more."
    }
    if (!athleteCountText) {
      nextErrors.expectedAthleteCount = "Add how many athletes you expect."
    } else if (!/^\d+$/.test(athleteCountText) || athleteCount > MAX_HEADCOUNT) {
      nextErrors.expectedAthleteCount = "Use a whole number, 0 or more."
    }
    if (normalizedWebsite) {
      try {
        const parsedWebsite = new URL(normalizedWebsite)
        if (!(parsedWebsite.protocol === "http:" || parsedWebsite.protocol === "https:") || !parsedWebsite.hostname.includes(".")) {
          nextErrors.organizationWebsite = "Use a web address like yourclub.com."
        }
      } catch {
        nextErrors.organizationWebsite = "Use a web address like yourclub.com."
      }
    }
    if (requestForm.desiredStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestForm.desiredStartDate)) {
      nextErrors.desiredStartDate = "Pick a date from the calendar."
    }

    setRequestErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      const firstInvalid = requestFieldOrder.find((entry) => nextErrors[entry.field])
      if (firstInvalid) document.getElementById(firstInvalid.id)?.focus()
      return
    }

    requestLock.current = true
    setIsSubmittingRequest(true)
    try {
      const shownAt = requestShownAt.current ?? performance.now()
      const remainingMs = REQUEST_MIN_FILL_MS - (performance.now() - shownAt)
      if (remainingMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingMs))
      }
      const fillMs = Math.round(performance.now() - shownAt)
      const honeypot = referenceCode.trim()

      if (isSupabaseMode) {
        const supabase = getBrowserSupabaseClient()
        if (!supabase) {
          setError("Requests are not set up on this site yet. Refresh the page and try again.")
          return
        }

        const requestArgs = {
          p_requestor_name: requestorName,
          p_requestor_email: normalizedEmail,
          p_organization_name: requestForm.organization.trim(),
          p_notes: notes || null,
          p_requested_plan: requestForm.requestedPlan.trim(),
          p_expected_seats: Math.max(0, coachCount) + Math.max(0, athleteCount),
          p_job_title: requestForm.jobTitle.trim(),
          p_organization_type: requestForm.organizationType.trim(),
          p_organization_website: normalizedWebsite || null,
          p_region: requestForm.region.trim(),
          p_expected_coach_count: Math.max(0, coachCount),
          p_expected_athlete_count: Math.max(0, athleteCount),
          p_desired_start_date: requestForm.desiredStartDate || null,
        }
        // The database decides what to do with a filled honeypot or a too-fast form (it reports success
        // and stores nothing), so a script learns nothing from this page's code.
        let result = await supabase.rpc("submit_tenant_provision_request", {
          ...requestArgs,
          p_reference_code: honeypot || null,
          p_fill_ms: fillMs,
        })
        // PGRST202: the database does not have the two new arguments yet (the app was deployed before
        // the migration ran). Send the request the old way rather than lose it.
        if (result.error?.code === "PGRST202" && !honeypot) {
          result = await supabase.rpc("submit_tenant_provision_request", requestArgs)
        }

        if (result.error) {
          setError(describeAccessRequestError(result.error))
          return
        }
      } else if (!honeypot) {
        // Demo mode has no database, so the honeypot rule is applied here: report success, store nothing.
        const [{ submitMockTenantProvisionRequest }, { loadAccountRequests, saveAccountRequests }] = await Promise.all([
          import("@/lib/mock-platform-admin"),
          import("@/lib/mock-club-admin"),
        ])

        submitMockTenantProvisionRequest({
          fullName: requestorName,
          email: requestForm.email,
          jobTitle: requestForm.jobTitle,
          organization: requestForm.organization,
          organizationType: requestForm.organizationType,
          requestedPlan: requestForm.requestedPlan as PackageId,
          organizationWebsite: normalizedWebsite,
          region: requestForm.region,
          expectedCoachCount: Math.max(0, coachCount),
          expectedAthleteCount: Math.max(0, athleteCount),
          desiredStartDate: requestForm.desiredStartDate,
          notes,
        })

        const existingRequests = loadAccountRequests()
        const nextRequest: AccountRequest = {
          id: `request-${Date.now()}`,
          fullName: requestorName,
          email: normalizedEmail,
          organization: requestForm.organization.trim(),
          role: "club-admin",
          status: "pending",
          createdAt: new Date().toISOString(),
        }
        saveAccountRequests([nextRequest, ...existingRequests])
      }

      setError("")
      setRequestErrors({})
      setSubmittedEmail(normalizedEmail)
      setRequestForm(emptyRequestForm)
      setReferenceCode("")
      setRequestSubmitted(true)
      window.scrollTo({ top: 0 })
    } catch (caught) {
      setError(describeAccessRequestError(caught instanceof Error ? caught : null))
    } finally {
      requestLock.current = false
      setIsSubmittingRequest(false)
    }
  }

  const switchMode = (nextMode: AuthMode) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (nextMode === "request") next.set("mode", "request")
        else next.delete("mode")
        return next
      },
      { replace: false },
    )
    setError("")
    setRequestErrors({})
    if (nextMode === "request") {
      setRequestSubmitted(false)
    }
    window.scrollTo({ top: 0 })
  }

  const isRequest = mode === "request"
  const fitWarning =
    packageFitWarnings.length > 0
      ? `Your club looks bigger than this package. ${getPackageById(recommendedPackageId)?.label ?? "A larger package"} is a better fit. ${packageFitWarnings.join(" ")} You can still send the request as it is.`
      : null

  return (
    <AuthSplit
      wide={isRequest && !requestSubmitted}
      headline={isRequest ? ["Your whole club", "on one plan."] : ["Plan the week.", "Know who is ready."]}
      body={
        isRequest
          ? "Coaches write the training, athletes log it, and you see every team from one place."
          : "Write the training, run test weeks and read every athlete's check-in before the first rep."
      }
    >
      {!isRequest ? (
        <>
          <ScreenHeader title="Sign in" lede="Coaches, athletes and club admins all start here." />

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <Field id="email" label="Email">
              <Input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                placeholder="you@yourclub.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field id="password" label="Password">
              <PasswordInput name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <List>
              <CheckRow checked={rememberMe} onChange={setRememberMe} title="Keep me signed in on this device" />
            </List>

            {error ? <Notice tone="error">{error}</Notice> : null}

            <Button type="submit" variant="primary" size="lg" block disabled={isSigningIn}>
              {isSigningIn ? "Signing in..." : "Sign in"}
              {isSigningIn ? null : <ArrowRight className="size-5" weight="bold" aria-hidden />}
            </Button>
            <LinkButton to="/reset-password" variant="quiet">
              Forgot password?
            </LinkButton>
            <p className="sr-only" aria-live="polite">
              {isSigningIn ? "Signing in. Checking your account." : ""}
            </p>
          </form>

          <Section title="New to SKTR Coach?" hint="Clubs join by request. It takes about two minutes.">
            <div className="pt-3">
              <Button onClick={() => switchMode("request")}>Request access for your club</Button>
            </div>
          </Section>

          {!isSupabaseMode ? (
            <Section title="Try the demo" hint="Open a sample club as any role. Nothing here touches real data.">
              <List>
                {demoAccounts.map((account) => (
                  <ListRow
                    key={account.key}
                    leading={<account.icon className="size-6 text-sk-blue" weight="bold" aria-hidden />}
                    title={account.label}
                    subtitle={account.hint}
                    disabled={!demoCredentials || isSigningIn}
                    onClick={() => handleDemoSignIn(account.key)}
                  />
                ))}
              </List>
            </Section>
          ) : null}
        </>
      ) : requestSubmitted ? (
        <>
          <ScreenHeader
            title="We have your access request."
            lede={
              isSupabaseMode
                ? "Thanks. A real person reads every request, so there is nothing more to do right now."
                : "Demo mode: this request is now in the platform-admin queue. Sign in as Platform admin to review and approve it."
            }
          />
          <InviteSteps
            title="What happens next"
            steps={[
              { title: "We review your request", body: `We reply ${REQUEST_REVIEW_TIME}. If we need anything else we will email you.` },
              {
                title: "You get a setup link by email",
                body: submittedEmail ? `We send it to ${submittedEmail}. Use it to create your club admin sign-in.` : "Use it to create your club admin sign-in.",
              },
              { title: "You invite your coaches and athletes", body: "Set up your teams, then send invites from your club dashboard." },
            ]}
          />
          <div>
            <Button variant="primary" onClick={() => switchMode("signin")}>
              <ArrowLeft className="size-5" weight="bold" aria-hidden />
              Back to sign in
            </Button>
          </div>
        </>
      ) : (
        <>
          <ScreenHeader
            variant="top"
            back={{ onClick: () => switchMode("signin"), label: "Back to sign in" }}
            title="Request access for your club"
            lede={`Tell us who you are and how big your club is. We review each request and email you a setup link, ${REQUEST_REVIEW_TIME}.`}
          />

          <form className="flex flex-col gap-7 lg:gap-9" onSubmit={handleRequestSubmit} noValidate>
            <Section title="About you">
              <FormGrid className="pt-3">
                <Field id="request-first-name" label="First name" error={requestErrors.firstName}>
                  <Input maxLength={60} autoComplete="given-name" placeholder="Jordan" value={requestForm.firstName} onChange={(event) => updateRequestField("firstName", event.target.value)} />
                </Field>
                <Field id="request-last-name" label="Last name" error={requestErrors.lastName}>
                  <Input maxLength={60} autoComplete="family-name" placeholder="Davis" value={requestForm.lastName} onChange={(event) => updateRequestField("lastName", event.target.value)} />
                </Field>
                <Field id="request-email" label="Work email" hint="Your setup link goes here, so use one you check." error={requestErrors.email} className="sm:col-span-2">
                  <Input
                    type="email"
                    maxLength={254}
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="jordan@club.com"
                    value={requestForm.email}
                    onChange={(event) => updateRequestField("email", event.target.value)}
                  />
                </Field>
                <Field id="request-job-title" label="Job title" error={requestErrors.jobTitle} className="sm:col-span-2">
                  <Input maxLength={120} autoComplete="organization-title" placeholder="Head coach" value={requestForm.jobTitle} onChange={(event) => updateRequestField("jobTitle", event.target.value)} />
                </Field>
              </FormGrid>
            </Section>

            <Section title="Your club">
              <FormGrid className="pt-3">
                <Field id="request-organization" label="Club or organization name" error={requestErrors.organization} className="sm:col-span-2">
                  <Input maxLength={160} autoComplete="organization" placeholder="Elite Track Club" value={requestForm.organization} onChange={(event) => updateRequestField("organization", event.target.value)} />
                </Field>
                <Field id="request-organization-type" label="Organization type" error={requestErrors.organizationType}>
                  <Select value={requestForm.organizationType} onChange={(event) => updateRequestField("organizationType", event.target.value)}>
                    <option value="" disabled>
                      Choose one
                    </option>
                    {organizationTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="request-region" label="Country or region" error={requestErrors.region}>
                  <Input maxLength={120} autoComplete="country-name" placeholder="Jamaica" value={requestForm.region} onChange={(event) => updateRequestField("region", event.target.value)} />
                </Field>
                <Field id="request-organization-website" label="Website" optional error={requestErrors.organizationWebsite} className="sm:col-span-2">
                  <Input
                    type="url"
                    maxLength={290}
                    inputMode="url"
                    autoComplete="url"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="yourclub.com"
                    value={requestForm.organizationWebsite}
                    onChange={(event) => updateRequestField("organizationWebsite", event.target.value)}
                  />
                </Field>
              </FormGrid>
            </Section>

            <Section title="Size and timing" hint="A rough guess is fine. It helps us suggest the right package.">
              <div className="grid grid-cols-2 gap-4 pt-3">
                <Field id="request-expected-coaches" label="Expected coaches" error={requestErrors.expectedCoachCount}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_HEADCOUNT}
                    step={1}
                    placeholder="4"
                    value={requestForm.expectedCoachCount}
                    onChange={(event) => updateRequestField("expectedCoachCount", event.target.value)}
                  />
                </Field>
                <Field id="request-expected-athletes" label="Expected athletes" error={requestErrors.expectedAthleteCount}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_HEADCOUNT}
                    step={1}
                    placeholder="60"
                    value={requestForm.expectedAthleteCount}
                    onChange={(event) => updateRequestField("expectedAthleteCount", event.target.value)}
                  />
                </Field>
                <Field id="request-desired-start" label="Target start date" optional hint="When you would like your coaches using it." error={requestErrors.desiredStartDate} className="col-span-2 sm:col-span-1">
                  <Input type="date" min={todayIsoDate()} value={requestForm.desiredStartDate} onChange={(event) => updateRequestField("desiredStartDate", event.target.value)} />
                </Field>
              </div>
            </Section>

            <Section title="Package" hint="Pick where you want to start. You can change it later.">
              <div
                role="radiogroup"
                aria-label="Package"
                aria-invalid={requestErrors.requestedPlan ? "true" : undefined}
                aria-describedby={requestErrors.requestedPlan ? "request-package-error" : undefined}
              >
                <List>
                  {packageOptions.map((option) => {
                    const hasLimits = Number.isFinite(option.limits.coaches) && Number.isFinite(option.limits.athletes)
                    return (
                      <RadioRow
                        key={option.id}
                        id={`request-package-${option.id}`}
                        name="request-package"
                        value={option.id}
                        checked={requestForm.requestedPlan === option.id}
                        onChange={(value) => updateRequestField("requestedPlan", value)}
                        title={option.label}
                        subtitle={packageCopy[option.id]}
                        detail={hasLimits ? `Up to ${option.limits.coaches} coaches and ${option.limits.athletes} athletes` : "No set limit on coaches or athletes"}
                        note={hasHeadcount && recommendedPackageId === option.id ? "Fits your numbers" : undefined}
                      />
                    )
                  })}
                </List>
              </div>
              {requestErrors.requestedPlan ? (
                <p id="request-package-error" className="sk-field-error mt-1.5">
                  {requestErrors.requestedPlan}
                </p>
              ) : null}
              {fitWarning ? (
                <Notice tone="warning" className="mt-3">
                  {fitWarning}
                </Notice>
              ) : null}
            </Section>

            <Field id="request-notes" label="Notes" optional hint="Anything that helps us set you up: events you coach, a deadline, questions.">
              <Textarea rows={3} maxLength={1000} value={requestForm.notes} onChange={(event) => updateRequestField("notes", event.target.value)} />
            </Field>

            {/*
              Honeypot. Scripts that fill every input fill this one; the database then reports success
              and stores nothing. People never meet it: it is off screen (not display:none, which some
              scripts skip), hidden from screen readers, out of the tab order, and named so that browsers
              and password managers have no reason to autofill it.
            */}
            <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] top-auto size-px overflow-hidden">
              <label htmlFor="request-reference-code">Reference code (leave this empty)</label>
              <input
                id="request-reference-code"
                name="club_reference_code"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
                value={referenceCode}
                onChange={(event) => setReferenceCode(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-4">
              {error ? <Notice tone="error">{error}</Notice> : null}
              {Object.values(requestErrors).some(Boolean) ? <Notice tone="error">Some answers need another look. Fix the fields marked above, then send again.</Notice> : null}
              <Button type="submit" variant="primary" size="lg" disabled={isSubmittingRequest} className="w-full sm:w-auto sm:self-start sm:px-8">
                {isSubmittingRequest ? "Submitting request..." : "Submit request"}
              </Button>
              <p className="text-sm text-sk-mute">
                We only use these details to review your request and set up your club. By sending this request you agree to our{" "}
                <Link to="/terms" className="sk-link">
                  terms
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="sk-link">
                  privacy notice
                </Link>
                .
              </p>
            </div>
          </form>
        </>
      )}
    </AuthSplit>
  )
}
