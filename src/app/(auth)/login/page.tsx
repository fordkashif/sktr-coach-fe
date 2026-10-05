"use client"

import { useEffect, useId, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  Buildings,
  CheckCircle,
  CircleNotch,
  Eye,
  EyeSlash,
  PersonSimpleRun,
  ShieldCheck,
  Strategy,
  Warning,
  WarningCircle,
  type Icon,
} from "@phosphor-icons/react"
import { Tag } from "@/components/sk"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AUTH_PHOTOS, AuthSplit } from "@/layouts/auth-layout"
import { describeAccessRequestError, describeAuthLinkError, describeNoAccessError, describeSignInError } from "@/lib/auth-errors"
import { setSessionCookies } from "@/lib/auth-session"
import { getPackageById, getRecommendedPackage, packageOptions, type PackageId } from "@/lib/billing/package-catalog"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import type { AccountRequest } from "@/lib/mock-club-admin"
import { getBackendMode, isSupabaseEnabled } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionAccess, resolveSessionActor } from "@/lib/supabase/actor"
import { cn } from "@/lib/utils"

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

function FormAlert({ children, tone = "coral" }: { children: ReactNode; tone?: "coral" | "yellow" }) {
  const isCoral = tone === "coral"
  const Glyph = isCoral ? WarningCircle : Warning
  return (
    <div
      role={isCoral ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-2xl p-4 text-sm", isCoral ? "bg-sk-coral-tint" : "bg-sk-yellow-tint")}
    >
      <Glyph className={cn("mt-0.5 size-5 shrink-0", isCoral ? "text-[#b32a0c]" : "text-[#7a5600]")} weight="fill" aria-hidden />
      <div className={cn("min-w-0 leading-relaxed", isCoral ? "font-semibold text-[#b32a0c]" : "text-sk-ink-2")}>{children}</div>
    </div>
  )
}

function FieldShell({
  id,
  label,
  optional = false,
  hint,
  error,
  children,
  className,
}: {
  id: string
  label: string
  optional?: boolean
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-sk-ink-2">
        {label}
        {optional ? <span className="font-normal text-sk-mute"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-semibold text-[#b32a0c]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-sk-mute">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function TextField({
  id,
  label,
  optional,
  hint,
  error,
  wrapperClassName,
  className,
  ...inputProps
}: {
  id: string
  label: string
  optional?: boolean
  hint?: string
  error?: string
  wrapperClassName?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error} className={wrapperClassName}>
      <input
        id={id}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn("sk-field text-base sm:text-[0.95rem]", error && "border-sk-coral focus:border-sk-coral focus:ring-sk-coral/20", className)}
        {...inputProps}
      />
    </FieldShell>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isSupabaseMode = getBackendMode() === "supabase"
  const mode: AuthMode = searchParams.get("mode") === "request" ? "request" : "signin"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
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
  const formId = useId()
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
      await supabase.auth.signOut().catch(() => undefined)
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

  return (
    <AuthSplit
      wide={isRequest && !requestSubmitted}
      photo={isRequest ? AUTH_PHOTOS.lanes : AUTH_PHOTOS.blocks}
      headline={isRequest ? "Put your whole club on one plan." : "See who is ready before the first rep."}
      body={
        isRequest
          ? "Coaches write the training, athletes log it, and you see every team from one place."
          : "Build the week, run test weeks and read every athlete's check-in, all in one place."
      }
    >
      {!isRequest ? (
        <div className="space-y-8">
          <header className="space-y-3">
            <h1 className="sk-title">Sign in</h1>
            <p className="sk-lede">Coaches, athletes and club admins all start here.</p>
          </header>

          <form className="grid gap-5" onSubmit={handleSubmit}>
            <TextField
              id="email"
              label="Email"
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

            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label htmlFor="password" className="text-sm font-semibold text-sk-ink-2">
                  Password
                </label>
                <Link to="/reset-password" className="rounded text-sm font-bold text-sk-blue hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="sk-field pr-[4.5rem] text-base sm:text-[0.95rem]"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-pressed={showPassword}
                  aria-controls="password"
                  onClick={() => setShowPassword((previous) => !previous)}
                  className="absolute inset-y-1 right-1 inline-flex items-center gap-1.5 rounded-[10px] px-2.5 text-sm font-bold text-sk-ink-2 hover:bg-sk-canvas hover:text-sk-ink focus-visible:outline-2 focus-visible:outline-sk-blue"
                >
                  {showPassword ? <EyeSlash className="size-4" weight="bold" aria-hidden /> : <Eye className="size-4" weight="bold" aria-hidden />}
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-sm font-semibold text-sk-ink-2">
              <input
                type="checkbox"
                className="size-[18px] rounded accent-sk-blue"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              Keep me signed in on this device
            </label>

            {error ? <FormAlert>{error}</FormAlert> : null}

            <button type="submit" disabled={isSigningIn} className="sk-btn sk-btn-primary h-12 w-full text-base">
              {isSigningIn ? <CircleNotch className="size-5 animate-spin" weight="bold" aria-hidden /> : null}
              {isSigningIn ? "Signing in..." : "Sign in"}
            </button>
            <p className="sr-only" aria-live="polite">
              {isSigningIn ? "Signing in. Checking your account." : ""}
            </p>
          </form>

          <section aria-labelledby={`${formId}-new`} className="flex flex-col gap-3 border-t border-sk-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id={`${formId}-new`} className="sk-h3">
                New to SKTR Coach?
              </h2>
              <p className="text-sm text-sk-mute">Clubs join by request. It takes about two minutes.</p>
            </div>
            <button type="button" className="sk-btn sk-btn-quiet shrink-0" onClick={() => switchMode("request")}>
              Request access for your club
            </button>
          </section>

          {!isSupabaseMode ? (
            <section aria-labelledby={`${formId}-demo`} className="sk-well space-y-3">
              <div>
                <h2 id={`${formId}-demo`} className="sk-h3">
                  Try the demo
                </h2>
                <p className="text-sm text-sk-mute">Open a sample club as any role. Nothing here touches real data.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {demoAccounts.map((account) => (
                  <button
                    key={account.key}
                    type="button"
                    disabled={!demoCredentials || isSigningIn}
                    onClick={() => handleDemoSignIn(account.key)}
                    className="flex min-h-[60px] items-center gap-3 rounded-[14px] border border-sk-line bg-white px-3 py-2.5 text-left transition-colors hover:border-sk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue disabled:pointer-events-none disabled:opacity-45"
                  >
                    <account.icon className="size-6 shrink-0 text-sk-blue" weight="bold" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[0.95rem] font-bold leading-tight text-sk-ink">{account.label}</span>
                      <span className="block text-xs leading-snug text-sk-mute">{account.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : requestSubmitted ? (
        <div className="space-y-7">
          <header className="space-y-4">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-sk-green-tint text-sk-green">
              <CheckCircle className="size-8" weight="fill" aria-hidden />
            </span>
            <h1 className="sk-title">
              We have your access request.
            </h1>
            <p className="sk-lede">
              {isSupabaseMode
                ? "Thanks. A real person reads every request, so there is nothing more to do right now."
                : "Demo mode: this request is now in the platform-admin queue. Sign in as Platform admin to review and approve it."}
            </p>
          </header>

          <section aria-labelledby={`${formId}-next`}>
            <h2 id={`${formId}-next`} className="sk-h3">
              What happens next
            </h2>
            <ol className="mt-3 space-y-4">
              {[
                {
                  title: "We review your request",
                  body: "Usually within two working days. If we need anything else we will email you.",
                },
                {
                  title: "You get a setup link by email",
                  body: submittedEmail
                    ? `We send it to ${submittedEmail}. Use it to create your club admin sign-in.`
                    : "Use it to create your club admin sign-in.",
                },
                {
                  title: "You invite your coaches and athletes",
                  body: "Set up your teams, then send invites from your club dashboard.",
                },
              ].map((step, index) => (
                <li key={step.title} className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sk-yellow text-sm font-extrabold text-sk-ink">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-sk-ink">{step.title}</p>
                    <p className="break-words text-sm leading-relaxed text-sk-mute">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="sk-btn sk-btn-primary" onClick={() => switchMode("signin")}>
              <ArrowLeft className="size-5" weight="bold" aria-hidden />
              Back to sign in
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <header className="space-y-3">
            <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -ml-3" onClick={() => switchMode("signin")}>
              <ArrowLeft className="size-4" weight="bold" aria-hidden />
              Back to sign in
            </button>
            <h1 className="sk-title">Request access for your club</h1>
            <p className="sk-lede">
              Tell us who you are and how big your club is. We review each request and email you a setup link, usually within two working days.
            </p>
          </header>

          <form className="grid gap-9" onSubmit={handleRequestSubmit} noValidate>
            <fieldset className="grid gap-4">
              <legend className="sk-h2 mb-4">About you</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="request-first-name"
                  maxLength={60}
                  label="First name"
                  autoComplete="given-name"
                  placeholder="Jordan"
                  value={requestForm.firstName}
                  error={requestErrors.firstName}
                  onChange={(event) => updateRequestField("firstName", event.target.value)}
                />
                <TextField
                  id="request-last-name"
                  maxLength={60}
                  label="Last name"
                  autoComplete="family-name"
                  placeholder="Davis"
                  value={requestForm.lastName}
                  error={requestErrors.lastName}
                  onChange={(event) => updateRequestField("lastName", event.target.value)}
                />
              </div>
              <TextField
                id="request-email"
                maxLength={254}
                label="Work email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="jordan@club.com"
                hint="Your setup link goes here, so use one you check."
                value={requestForm.email}
                error={requestErrors.email}
                onChange={(event) => updateRequestField("email", event.target.value)}
              />
              <TextField
                id="request-job-title"
                maxLength={120}
                label="Job title"
                autoComplete="organization-title"
                placeholder="Head coach"
                value={requestForm.jobTitle}
                error={requestErrors.jobTitle}
                onChange={(event) => updateRequestField("jobTitle", event.target.value)}
              />
            </fieldset>

            <fieldset className="grid gap-4">
              <legend className="sk-h2 mb-4">Your club</legend>
              <TextField
                id="request-organization"
                label="Club or organization name"
                maxLength={160}
                autoComplete="organization"
                placeholder="Elite Track Club"
                value={requestForm.organization}
                error={requestErrors.organization}
                onChange={(event) => updateRequestField("organization", event.target.value)}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldShell id="request-organization-type" label="Organization type" error={requestErrors.organizationType}>
                  <Select value={requestForm.organizationType} onValueChange={(value) => updateRequestField("organizationType", value)}>
                    <SelectTrigger
                      id="request-organization-type"
                      aria-label="Organization type"
                      aria-invalid={requestErrors.organizationType ? "true" : undefined}
                      aria-describedby={requestErrors.organizationType ? "request-organization-type-error" : undefined}
                      className={cn(
                        "!h-11 w-full rounded-[14px] border-[#d5d9e3] bg-white px-3.5 py-0 text-base text-sk-ink shadow-none focus:border-sk-blue focus:ring-2 focus:ring-sk-blue/20 data-[placeholder]:text-[#9aa2b1] sm:text-[0.95rem]",
                        requestErrors.organizationType && "border-sk-coral",
                      )}
                    >
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizationTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldShell>
                <TextField
                  id="request-region"
                  maxLength={120}
                  label="Country or region"
                  autoComplete="country-name"
                  placeholder="Jamaica"
                  value={requestForm.region}
                  error={requestErrors.region}
                  onChange={(event) => updateRequestField("region", event.target.value)}
                />
              </div>
              <TextField
                id="request-organization-website"
                maxLength={290}
                label="Website"
                optional
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="yourclub.com"
                value={requestForm.organizationWebsite}
                error={requestErrors.organizationWebsite}
                onChange={(event) => updateRequestField("organizationWebsite", event.target.value)}
              />
            </fieldset>

            <fieldset className="grid gap-4">
              <legend className="sk-h2 mb-1">Size and timing</legend>
              <p className="mb-3 text-sm text-sk-mute">A rough guess is fine. It helps us suggest the right package.</p>
              <div className="grid grid-cols-2 gap-4">
                <TextField
                  id="request-expected-coaches"
                  label="Expected coaches"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_HEADCOUNT}
                  step={1}
                  placeholder="4"
                  value={requestForm.expectedCoachCount}
                  error={requestErrors.expectedCoachCount}
                  onChange={(event) => updateRequestField("expectedCoachCount", event.target.value)}
                />
                <TextField
                  id="request-expected-athletes"
                  label="Expected athletes"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_HEADCOUNT}
                  step={1}
                  placeholder="60"
                  value={requestForm.expectedAthleteCount}
                  error={requestErrors.expectedAthleteCount}
                  onChange={(event) => updateRequestField("expectedAthleteCount", event.target.value)}
                />
              </div>
              <TextField
                id="request-desired-start"
                label="Target start date"
                optional
                type="date"
                min={todayIsoDate()}
                hint="When you would like your coaches using it."
                wrapperClassName="sm:max-w-[280px]"
                value={requestForm.desiredStartDate}
                error={requestErrors.desiredStartDate}
                onChange={(event) => updateRequestField("desiredStartDate", event.target.value)}
              />
            </fieldset>

            <fieldset
              role="radiogroup"
              aria-invalid={requestErrors.requestedPlan ? "true" : undefined}
              aria-describedby={requestErrors.requestedPlan ? "request-package-error" : undefined}
            >
              <legend className="sk-h2 mb-1">Package</legend>
              <p className="mb-4 text-sm text-sk-mute">Pick where you want to start. You can change it later.</p>
              <div className={cn("overflow-hidden rounded-[20px] border", requestErrors.requestedPlan ? "border-sk-coral" : "border-sk-line")}>
                {packageOptions.map((option) => {
                  const isSelected = requestForm.requestedPlan === option.id
                  const hasLimits = Number.isFinite(option.limits.coaches) && Number.isFinite(option.limits.athletes)
                  const limitsLabel = hasLimits
                    ? `Up to ${option.limits.coaches} coaches and ${option.limits.athletes} athletes`
                    : "No set limit on coaches or athletes"
                  return (
                    <label
                      key={option.id}
                      htmlFor={`request-package-${option.id}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3.5 border-b border-sk-line px-4 py-4 transition-colors last:border-b-0 sm:px-5",
                        isSelected ? "bg-sk-blue-tint" : "bg-white hover:bg-sk-canvas",
                      )}
                    >
                      <input
                        type="radio"
                        id={`request-package-${option.id}`}
                        name="request-package"
                        value={option.id}
                        checked={isSelected}
                        onChange={() => updateRequestField("requestedPlan", option.id)}
                        className="mt-0.5 size-5 shrink-0 accent-sk-blue"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-bold text-sk-ink">{option.label}</span>
                          {hasHeadcount && recommendedPackageId === option.id ? <Tag tone="blue">Fits your numbers</Tag> : null}
                        </span>
                        <span className="mt-0.5 block text-sm leading-relaxed text-sk-ink-2">{packageCopy[option.id]}</span>
                        <span className="mt-1 block text-sm font-semibold text-sk-mute">{limitsLabel}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              {requestErrors.requestedPlan ? (
                <p id="request-package-error" className="mt-1.5 text-sm font-semibold text-[#b32a0c]">
                  {requestErrors.requestedPlan}
                </p>
              ) : null}
              {packageFitWarnings.length > 0 ? (
                <div className="mt-3">
                  <FormAlert tone="yellow">
                    <p className="font-bold text-[#7a5600]">
                      Your club looks bigger than this package. {getPackageById(recommendedPackageId)?.label ?? "A larger package"} is a better fit.
                    </p>
                    <ul className="mt-1 list-disc pl-5">
                      {packageFitWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                    <p className="mt-1">You can still send the request as it is.</p>
                  </FormAlert>
                </div>
              ) : null}
            </fieldset>

            <FieldShell id="request-notes" label="Notes" optional hint="Anything that helps us set you up: events you coach, a deadline, questions.">
              <textarea
                id="request-notes"
                rows={3}
                maxLength={1000}
                aria-describedby="request-notes-hint"
                className="sk-field h-auto min-h-[96px] py-2.5 text-base leading-relaxed sm:text-[0.95rem]"
                value={requestForm.notes}
                onChange={(event) => updateRequestField("notes", event.target.value)}
              />
            </FieldShell>

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

            <div className="space-y-4">
              {error ? <FormAlert>{error}</FormAlert> : null}
              {Object.values(requestErrors).some(Boolean) ? (
                <FormAlert>Some answers need another look. Fix the fields marked above, then send again.</FormAlert>
              ) : null}
              <button type="submit" disabled={isSubmittingRequest} className="sk-btn sk-btn-primary h-12 w-full text-base sm:w-auto sm:px-8">
                {isSubmittingRequest ? <CircleNotch className="size-5 animate-spin" weight="bold" aria-hidden /> : null}
                {isSubmittingRequest ? "Submitting request..." : "Submit request"}
              </button>
              <p className="text-sm text-sk-mute">We only use these details to review your request and set up your club.</p>
            </div>
          </form>
        </div>
      )}
    </AuthSplit>
  )
}
