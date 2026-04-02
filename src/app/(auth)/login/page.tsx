"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { setSessionCookies } from "@/lib/auth-session"
import { getPackageById, getRecommendedPackage, packageOptions, type PackageId } from "@/lib/billing/package-catalog"
import { getCoachTeamsSnapshotForCurrentUser } from "@/lib/data/coach/teams-data"
import { submitMockTenantProvisionRequest } from "@/lib/mock-platform-admin"
import type { AccountRequest } from "@/lib/mock-club-admin"
import { loadAccountRequests, saveAccountRequests } from "@/lib/mock-club-admin"
import { MOCK_CREDENTIALS, resolveMockLogin } from "@/lib/mock-auth"
import { getBackendMode, isSupabaseEnabled } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { resolveSessionActor } from "@/lib/supabase/actor"

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
  fullName: string
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

type RequestField =
  | "fullName"
  | "email"
  | "jobTitle"
  | "organization"
  | "organizationType"
  | "requestedPlan"
  | "organizationWebsite"
  | "region"
  | "expectedCoachCount"
  | "expectedAthleteCount"
  | "desiredStartDate"
  | "notes"

const organizationTypeOptions = [
  { value: "school", label: "School" },
  { value: "club", label: "Club" },
  { value: "university", label: "University" },
  { value: "private-coaching-group", label: "Private coaching group" },
  { value: "federation", label: "Federation" },
] as const

const emptyRequestForm: RequestFormState = {
  fullName: "",
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

const MOCK_ROLE_STORAGE_KEY = "pacelab:mock-role"
const MOCK_USER_EMAIL_STORAGE_KEY = "pacelab:mock-user-email"
const MOCK_COACH_TEAM_STORAGE_KEY = "pacelab:mock-coach-team"

async function resolveInitialCoachTeamId() {
  const snapshot = await getCoachTeamsSnapshotForCurrentUser()
  if (!snapshot.ok) return undefined
  return snapshot.data.teams[0]?.id
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isSupabaseMode = getBackendMode() === "supabase"
  const initialMode = searchParams.get("mode") === "request" ? "request" : "signin"
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState("")
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false)
  const [requestForm, setRequestForm] = useState<RequestFormState>(emptyRequestForm)
  const [requestErrors, setRequestErrors] = useState<Partial<Record<RequestField, string>>>({})
  const [requestSubmitted, setRequestSubmitted] = useState(false)
  const [demoCredentials, setDemoCredentials] = useState<DemoCredentialMap | null>(null)
  const parsedCoachCount = Number.parseInt(requestForm.expectedCoachCount || "0", 10)
  const parsedAthleteCount = Number.parseInt(requestForm.expectedAthleteCount || "0", 10)
  const selectedPackage = getPackageById(requestForm.requestedPlan)
  const recommendedPackageId =
    parsedCoachCount >= 0 && parsedAthleteCount >= 0 ? getRecommendedPackage(parsedCoachCount, parsedAthleteCount) : null
  const packageFitWarnings =
    selectedPackage &&
    Number.isFinite(selectedPackage.limits.coaches) &&
    Number.isFinite(selectedPackage.limits.athletes)
      ? [
          ...(parsedCoachCount > selectedPackage.limits.coaches
            ? [`Projected coach count exceeds ${selectedPackage.label} capacity.`]
            : []),
          ...(parsedAthleteCount > selectedPackage.limits.athletes
            ? [`Projected athlete count exceeds ${selectedPackage.label} capacity.`]
            : []),
        ]
      : []
  const safeRedirect = (() => {
    const candidate = searchParams.get("redirect")
    return candidate && candidate.startsWith("/") ? candidate : null
  })()

  useEffect(() => {
    if (isSupabaseMode) return
    setDemoCredentials(MOCK_CREDENTIALS)
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
        setError("Unexpected hash-based auth callback. This flow should complete through a code exchange instead.")
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
          setError(exchangeResult.error.message)
          return
        }

        currentUrl.searchParams.delete("code")
        currentUrl.searchParams.delete("type")
        window.history.replaceState({}, document.title, currentUrl.toString())
      }

      await routeActor()
    }

    void handleAuthCallback()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void routeActor()
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [isSupabaseMode, navigate, rememberMe, safeRedirect])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSigningIn(true)
    setError("")

    if (isSupabaseMode) {
      if (!isSupabaseEnabled()) {
        setError("Supabase mode is enabled but URL/key are missing in environment.")
        setIsSigningIn(false)
        return
      }

      const supabase = getBrowserSupabaseClient()
      if (!supabase) {
        setError("Supabase client failed to initialize.")
        setIsSigningIn(false)
        return
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (signInError || !data.session) {
        setError(signInError?.message ?? "Sign in failed.")
        setIsSigningIn(false)
        return
      }

      const actor = await resolveSessionActor(supabase, data.session)
      if (!actor) {
        setError("Sign in succeeded, but your account is not mapped to an application role.")
        setIsSigningIn(false)
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
        navigate("/platform-admin/requests")
        return
      }
      navigate("/club-admin/dashboard")
      return
    }

    const match = resolveMockLogin(email, password)

    if (!match) {
      setError("Use a valid mock account from demo access.")
      setIsSigningIn(false)
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

  const handleRequestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")

    const nextErrors: Partial<Record<RequestField, string>> = {}
    const normalizedEmail = requestForm.email.trim().toLowerCase()
    const normalizedWebsite = requestForm.organizationWebsite.trim()
    const coachCount = Number.parseInt(requestForm.expectedCoachCount || "0", 10)
    const athleteCount = Number.parseInt(requestForm.expectedAthleteCount || "0", 10)

    if (!requestForm.fullName.trim()) nextErrors.fullName = "Full name is required."
    if (!normalizedEmail) {
      nextErrors.email = "Work email is required."
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = "Enter a valid work email."
    }
    if (!requestForm.jobTitle.trim()) nextErrors.jobTitle = "Job title is required."
    if (!requestForm.organization.trim()) nextErrors.organization = "Organization name is required."
    if (!requestForm.organizationType.trim()) nextErrors.organizationType = "Organization type is required."
    if (!requestForm.requestedPlan.trim()) nextErrors.requestedPlan = "Select the package you want to start with."
    if (!requestForm.region.trim()) nextErrors.region = "Country or region is required."
    if (!requestForm.expectedCoachCount.trim()) {
      nextErrors.expectedCoachCount = "Expected coach count is required."
    } else if (Number.isNaN(coachCount) || coachCount < 0) {
      nextErrors.expectedCoachCount = "Enter a valid coach count."
    }
    if (!requestForm.expectedAthleteCount.trim()) {
      nextErrors.expectedAthleteCount = "Expected athlete count is required."
    } else if (Number.isNaN(athleteCount) || athleteCount < 0) {
      nextErrors.expectedAthleteCount = "Enter a valid athlete count."
    }
    if (normalizedWebsite) {
      try {
        const parsedWebsite = new URL(normalizedWebsite)
        if (!(parsedWebsite.protocol === "http:" || parsedWebsite.protocol === "https:")) {
          nextErrors.organizationWebsite = "Enter a valid website URL."
        }
      } catch {
        nextErrors.organizationWebsite = "Enter a valid website URL."
      }
    }

    setRequestErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setIsSubmittingRequest(true)
    if (isSupabaseMode) {
      const supabase = getBrowserSupabaseClient()
      if (!supabase) {
        setError("Supabase client is not configured.")
        setIsSubmittingRequest(false)
        return
      }

      const result = await supabase.rpc("submit_tenant_provision_request", {
        p_requestor_name: requestForm.fullName.trim(),
        p_requestor_email: normalizedEmail,
        p_organization_name: requestForm.organization.trim(),
        p_notes: requestForm.notes.trim() || null,
        p_requested_plan: requestForm.requestedPlan.trim(),
        p_expected_seats: Math.max(0, coachCount) + Math.max(0, athleteCount),
        p_job_title: requestForm.jobTitle.trim(),
        p_organization_type: requestForm.organizationType.trim(),
        p_organization_website: normalizedWebsite || null,
        p_region: requestForm.region.trim(),
        p_expected_coach_count: Math.max(0, coachCount),
        p_expected_athlete_count: Math.max(0, athleteCount),
        p_desired_start_date: requestForm.desiredStartDate || null,
      })

      if (result.error) {
        setError(result.error.message)
        setIsSubmittingRequest(false)
        return
      }

      setError("")
      setRequestErrors({})
      setRequestForm(emptyRequestForm)
      setRequestSubmitted(true)
      setIsSubmittingRequest(false)
      return
    }

    submitMockTenantProvisionRequest({
      fullName: requestForm.fullName,
      email: requestForm.email,
      jobTitle: requestForm.jobTitle,
      organization: requestForm.organization,
      organizationType: requestForm.organizationType,
      requestedPlan: requestForm.requestedPlan as PackageId,
      organizationWebsite: requestForm.organizationWebsite,
      region: requestForm.region,
      expectedCoachCount: Math.max(0, coachCount),
      expectedAthleteCount: Math.max(0, athleteCount),
      desiredStartDate: requestForm.desiredStartDate,
      notes: requestForm.notes,
    })

    const existingRequests = loadAccountRequests()
    const nextRequest: AccountRequest = {
      id: `request-${Date.now()}`,
      fullName: requestForm.fullName.trim(),
      email: requestForm.email.trim().toLowerCase(),
      organization: requestForm.organization.trim(),
      role: "club-admin",
      notes: requestForm.notes.trim() || undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
    }
    saveAccountRequests([nextRequest, ...existingRequests])
    setError("")
    setRequestErrors({})
    setRequestForm(emptyRequestForm)
    setRequestSubmitted(true)
    setIsSubmittingRequest(false)
  }

  const applyDemoCredentials = (accountKey: DemoAccountKey) => {
    const account = demoCredentials?.[accountKey]
    if (!account) return
    setEmail(account.email)
    setPassword(account.password)
    setError("")
    setMode("signin")
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setError("")
    setRequestErrors({})
    if (nextMode === "request") {
      setRequestSubmitted(false)
    }
  }

  return (
    <main className="auth-login-shell min-h-screen bg-[#050b16] text-white xl:h-screen xl:overflow-hidden">
      <div className="relative isolate min-h-screen overflow-hidden xl:h-screen">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(31,140,255,0.22),_transparent_36%),linear-gradient(180deg,_rgba(8,15,28,0.96)_0%,_rgba(4,9,18,1)_58%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:72px_72px] opacity-[0.16]" />
        <div className="relative mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-1 overflow-hidden xl:h-screen xl:grid-cols-[minmax(0,1.15fr)_minmax(440px,520px)] xl:gap-10 xl:px-8 2xl:px-12">
          <section className="flex min-h-[160px] flex-col justify-between px-6 pb-5 pt-8 sm:min-h-[176px] sm:px-8 sm:pb-6 md:pb-8 xl:sticky xl:top-0 xl:h-screen xl:px-6 xl:pb-14 xl:pt-12 2xl:px-10">
            <div className="space-y-6 md:space-y-8 xl:max-w-[620px] xl:space-y-10">
              <div className="space-y-4">
                <img src="/app-icon.png" alt="SKTR Coach" className="h-16 w-16 object-contain" />
                <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#6fb6ff]">SKTR Coach</p>
              </div>

              <div className="space-y-3 lg:space-y-4">
                <div className="space-y-2 xl:hidden">
                  <h1 className="max-w-[10ch] text-[clamp(2.5rem,9vw,3.5rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-white">
                    {mode === "signin" ? "Welcome back" : "Request account"}
                  </h1>
                  <p className="max-w-[560px] text-sm leading-6 text-white/68 md:text-base">
                    {mode === "signin"
                      ? "Sign in to continue into your athlete, coach, or club admin workspace."
                      : "Request a club admin account for your organization from this form."}
                  </p>
                </div>

                <div className="hidden space-y-4 xl:block">
                  <h1 className="max-w-[10ch] text-[clamp(3rem,8vw,6rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-white">
                    {mode === "signin"
                      ? "Performance operations for athletes, coaches, and clubs."
                      : "Request a club admin workspace for your organization."}
                  </h1>
                  <p className="max-w-[520px] text-sm leading-7 text-white/68 sm:text-base">
                    {mode === "signin"
                      ? "Enter one shared system for training plans, readiness, testing, and team coordination. The product should feel operational, not generic. This surface now carries that same bar."
                      : "Use this request form to start a new club tenant request with the operational details required for review."}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section
            className={`relative flex items-end md:px-6 md:pb-8 xl:min-h-0 xl:h-screen xl:justify-end xl:px-0 xl:py-10 ${
              mode === "request" ? "xl:items-start xl:overflow-y-auto" : "xl:items-center xl:overflow-hidden"
            }`}
          >
            <div className="w-full md:mx-auto md:max-w-[760px] xl:mx-0 xl:flex xl:justify-end">
              <div className="w-full rounded-t-[36px] border-x border-t border-white/10 bg-[linear-gradient(180deg,#f8fafc_0%,#edf2f7_100%)] px-5 pb-8 pt-6 text-slate-950 shadow-[0_-24px_80px_rgba(0,0,0,0.24)] sm:px-8 sm:pb-10 sm:pt-8 md:rounded-[36px] md:border md:px-8 md:shadow-[0_24px_80px_rgba(0,0,0,0.24)] xl:w-full xl:max-w-[500px] xl:px-8 xl:pb-8 2xl:max-w-[520px] 2xl:px-10">
                <div className="space-y-6">
                <div className="space-y-4">
                  <div className="inline-flex w-full max-w-[340px] rounded-full border border-slate-200 bg-slate-100 p-1 text-sm font-medium text-slate-600 sm:w-auto">
                    <button
                      type="button"
                      onClick={() => switchMode("signin")}
                      className={mode === "signin" ? "flex-1 rounded-full bg-white px-4 py-2 text-center text-slate-950 shadow-sm sm:flex-none" : "flex-1 rounded-full px-4 py-2 text-center transition hover:text-slate-950 sm:flex-none"}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode("request")}
                      className={mode === "request" ? "flex-1 rounded-full bg-white px-4 py-2 text-center text-slate-950 shadow-sm sm:flex-none" : "flex-1 rounded-full px-4 py-2 text-center transition hover:text-slate-950 sm:flex-none"}
                    >
                      Request account
                    </button>
                  </div>
                </div>

                {mode === "signin" ? (
                  <>
                    <form className="space-y-5" onSubmit={handleSubmit}>
                      <div className="space-y-2.5">
                        <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                          Email
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          required
                          placeholder="coach@pacelab.local"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
                      </div>

                      <div className="space-y-2.5">
                        <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                          Password
                        </Label>
                        <Input
                          id="password"
                          type="password"
                          required
                          placeholder="Password123!"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
                      </div>

                      <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <label className="flex items-center gap-2">
                          <Checkbox checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked === true)} />
                          <span>Remember me</span>
                        </label>
                        <div className="flex flex-col items-start gap-1 sm:items-end">
                          <Link to="/reset-password" className="text-sm font-medium text-[#1368ff] hover:underline">
                            Forgot password?
                          </Link>
                        </div>
                      </div>

                      {error ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                          {error}
                        </div>
                      ) : null}

                      {isSigningIn ? (
                        <div
                          className="rounded-2xl border border-[#cfe2ff] bg-[linear-gradient(135deg,#eff6ff_0%,#f8fbff_100%)] px-4 py-3 text-sm text-[#1f5fd1]"
                          aria-live="polite"
                        >
                          <div className="flex items-center gap-3">
                            <span className="inline-flex size-4 animate-spin rounded-full border-2 border-[#1f8cff]/25 border-t-[#1f8cff]" />
                            <span className="font-medium">Signing in. Checking your account and workspace access.</span>
                          </div>
                        </div>
                      ) : null}

                      <Button
                        type="submit"
                        disabled={isSigningIn}
                        className="h-14 w-full rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#2f80ff_100%)] text-base font-semibold shadow-[0_12px_36px_rgba(28,101,255,0.32)] hover:opacity-95"
                      >
                        <span className="flex items-center justify-center gap-3">
                          {isSigningIn ? (
                            <span className="inline-flex size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                          ) : null}
                          {isSigningIn ? "Signing in..." : "Sign in"}
                        </span>
                      </Button>
                    </form>

                    {!isSupabaseMode ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-4 text-xs uppercase tracking-[0.24em] text-slate-400">
                          <Separator className="bg-slate-200" />
                          Demo access
                          <Separator className="bg-slate-200" />
                        </div>

                        <Accordion type="single" collapsible className="rounded-[28px] border border-slate-200 bg-white px-5">
                          <AccordionItem value="demo-access" className="border-none">
                            <AccordionTrigger className="py-5 text-base font-semibold text-slate-950 hover:no-underline">
                              Use a mock account
                            </AccordionTrigger>
                            <AccordionContent className="space-y-3 pb-5 text-slate-600">
                              <p className="text-sm leading-6">
                                Load credentials for the exact workspace you want to inspect, then submit normally.
                              </p>
                              <div className="grid gap-3">
                                <button
                                  type="button"
                                  onClick={() => applyDemoCredentials("athlete")}
                                  disabled={!demoCredentials}
                                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <span>
                                    <span className="block text-sm font-semibold text-slate-950">Athlete</span>
                                    <span className="block text-xs text-slate-500">{demoCredentials?.athlete.email ?? "Loading..."}</span>
                                  </span>
                                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#1368ff]">Use</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => applyDemoCredentials("coach")}
                                  disabled={!demoCredentials}
                                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <span>
                                    <span className="block text-sm font-semibold text-slate-950">Coach</span>
                                    <span className="block text-xs text-slate-500">{demoCredentials?.coach.email ?? "Loading..."}</span>
                                  </span>
                                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#1368ff]">Use</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => applyDemoCredentials("clubAdmin")}
                                  disabled={!demoCredentials}
                                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <span>
                                    <span className="block text-sm font-semibold text-slate-950">Club Admin</span>
                                    <span className="block text-xs text-slate-500">{demoCredentials?.clubAdmin.email ?? "Loading..."}</span>
                                  </span>
                                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#1368ff]">Use</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => applyDemoCredentials("platformAdmin")}
                                  disabled={!demoCredentials}
                                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <span>
                                    <span className="block text-sm font-semibold text-slate-950">Platform Admin</span>
                                    <span className="block text-xs text-slate-500">{demoCredentials?.platformAdmin.email ?? "Loading..."}</span>
                                  </span>
                                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#1368ff]">Use</span>
                                </button>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                    ) : null}
                  </>
                ) : requestSubmitted ? (
                  <div className="space-y-4 rounded-[28px] border border-[#cfe2ff] bg-[linear-gradient(135deg,#eff6ff_0%,#f8fbff_100%)] px-5 py-5 text-slate-950 shadow-[0_12px_28px_rgba(31,140,255,0.12)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1f8cff]">Request received</p>
                    <h2 className="text-2xl font-semibold tracking-[-0.04em]">We have your access request.</h2>
                    <p className="text-sm leading-6 text-slate-600">
                      {isSupabaseMode
                        ? "Your request was submitted for platform-admin review. You'll be contacted after approval."
                        : "This demo now stores the request in the platform-admin queue so approval, provisioning, and audit flow can be exercised locally."}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => switchMode("signin")}
                      className="h-12 rounded-full border-slate-200 bg-white px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff] hover:text-slate-950"
                    >
                      Back to sign in
                    </Button>
                  </div>
                ) : (
                  <form className="space-y-5" onSubmit={handleRequestSubmit}>
                    <div className="space-y-2.5">
                      <Label htmlFor="request-full-name" className="text-sm font-medium text-slate-700">
                        Full name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="request-full-name"
                        value={requestForm.fullName}
                        aria-invalid={requestErrors.fullName ? "true" : "false"}
                        onChange={(event) => {
                          setRequestForm((previous) => ({ ...previous, fullName: event.target.value }))
                          setRequestErrors((previous) => ({ ...previous, fullName: undefined }))
                        }}
                        placeholder="Jordan Davis"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                      {requestErrors.fullName ? <p className="text-sm text-red-600">{requestErrors.fullName}</p> : null}
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-email" className="text-sm font-medium text-slate-700">
                        Work email <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="request-email"
                        type="email"
                        value={requestForm.email}
                        aria-invalid={requestErrors.email ? "true" : "false"}
                        onChange={(event) => {
                          setRequestForm((previous) => ({ ...previous, email: event.target.value }))
                          setRequestErrors((previous) => ({ ...previous, email: undefined }))
                        }}
                        placeholder="jordan@club.com"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                      {requestErrors.email ? <p className="text-sm text-red-600">{requestErrors.email}</p> : null}
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-job-title" className="text-sm font-medium text-slate-700">
                        Job title <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="request-job-title"
                        value={requestForm.jobTitle}
                        aria-invalid={requestErrors.jobTitle ? "true" : "false"}
                        onChange={(event) => {
                          setRequestForm((previous) => ({ ...previous, jobTitle: event.target.value }))
                          setRequestErrors((previous) => ({ ...previous, jobTitle: undefined }))
                        }}
                        placeholder="Head coach"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                      {requestErrors.jobTitle ? <p className="text-sm text-red-600">{requestErrors.jobTitle}</p> : null}
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-organization" className="text-sm font-medium text-slate-700">
                        Organization <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="request-organization"
                        value={requestForm.organization}
                        aria-invalid={requestErrors.organization ? "true" : "false"}
                        onChange={(event) => {
                          setRequestForm((previous) => ({ ...previous, organization: event.target.value }))
                          setRequestErrors((previous) => ({ ...previous, organization: undefined }))
                        }}
                        placeholder="Elite Track Club"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                      {requestErrors.organization ? <p className="text-sm text-red-600">{requestErrors.organization}</p> : null}
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2.5">
                        <Label htmlFor="request-organization-type" className="text-sm font-medium text-slate-700">
                          Organization type <span className="text-red-500">*</span>
                        </Label>
                        <Select
                          value={requestForm.organizationType}
                          onValueChange={(value) => {
                            setRequestForm((previous) => ({ ...previous, organizationType: value }))
                            setRequestErrors((previous) => ({ ...previous, organizationType: undefined }))
                          }}
                        >
                          <SelectTrigger
                            id="request-organization-type"
                            aria-invalid={requestErrors.organizationType ? "true" : "false"}
                            className="h-14 w-full rounded-full border-slate-200 bg-white px-5 text-base shadow-none focus:ring-[#1368ff]/20"
                            aria-label="Organization type"
                          >
                            <SelectValue placeholder="Select organization type" />
                          </SelectTrigger>
                          <SelectContent>
                            {organizationTypeOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {requestErrors.organizationType ? <p className="text-sm text-red-600">{requestErrors.organizationType}</p> : null}
                      </div>
                      <div className="space-y-2.5">
                        <Label htmlFor="request-region" className="text-sm font-medium text-slate-700">
                          Country or region <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="request-region"
                          value={requestForm.region}
                          aria-invalid={requestErrors.region ? "true" : "false"}
                          onChange={(event) => {
                            setRequestForm((previous) => ({ ...previous, region: event.target.value }))
                            setRequestErrors((previous) => ({ ...previous, region: undefined }))
                          }}
                          placeholder="Jamaica"
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
                        {requestErrors.region ? <p className="text-sm text-red-600">{requestErrors.region}</p> : null}
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-package" className="text-sm font-medium text-slate-700">
                        Package <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={requestForm.requestedPlan}
                        onValueChange={(value) => {
                          setRequestForm((previous) => ({ ...previous, requestedPlan: value }))
                          setRequestErrors((previous) => ({ ...previous, requestedPlan: undefined }))
                        }}
                      >
                        <SelectTrigger
                          id="request-package"
                          aria-invalid={requestErrors.requestedPlan ? "true" : "false"}
                          className="h-14 w-full rounded-full border-slate-200 bg-white px-5 text-base shadow-none focus:ring-[#1368ff]/20"
                          aria-label="Package"
                        >
                          <SelectValue placeholder="Select package" />
                        </SelectTrigger>
                          <SelectContent>
                            {packageOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                      </Select>
                      <p className="text-sm leading-6 text-slate-500">
                        {getPackageById(requestForm.requestedPlan)?.description ??
                          "Choose the package that best matches your rollout scope."}
                      </p>
                      {requestErrors.requestedPlan ? <p className="text-sm text-red-600">{requestErrors.requestedPlan}</p> : null}
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-organization-website" className="text-sm font-medium text-slate-700">
                        Organization website
                      </Label>
                      <Input
                        id="request-organization-website"
                        type="url"
                        value={requestForm.organizationWebsite}
                        aria-invalid={requestErrors.organizationWebsite ? "true" : "false"}
                        onChange={(event) => {
                          setRequestForm((previous) => ({ ...previous, organizationWebsite: event.target.value }))
                          setRequestErrors((previous) => ({ ...previous, organizationWebsite: undefined }))
                        }}
                        placeholder="https://jamaicacollege.edu.jm"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                      {requestErrors.organizationWebsite ? <p className="text-sm text-red-600">{requestErrors.organizationWebsite}</p> : null}
                    </div>

                    <div className="grid gap-5 sm:grid-cols-3">
                      <div className="space-y-2.5">
                        <Label htmlFor="request-expected-coaches" className="text-sm font-medium text-slate-700">
                          Expected coaches <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="request-expected-coaches"
                          type="number"
                          min="0"
                          value={requestForm.expectedCoachCount}
                          aria-invalid={requestErrors.expectedCoachCount ? "true" : "false"}
                          onChange={(event) => {
                            setRequestForm((previous) => ({ ...previous, expectedCoachCount: event.target.value }))
                            setRequestErrors((previous) => ({ ...previous, expectedCoachCount: undefined }))
                          }}
                          placeholder="4"
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
                        {requestErrors.expectedCoachCount ? <p className="text-sm text-red-600">{requestErrors.expectedCoachCount}</p> : null}
                      </div>
                      <div className="space-y-2.5">
                        <Label htmlFor="request-expected-athletes" className="text-sm font-medium text-slate-700">
                          Expected athletes <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="request-expected-athletes"
                          type="number"
                          min="0"
                          value={requestForm.expectedAthleteCount}
                          aria-invalid={requestErrors.expectedAthleteCount ? "true" : "false"}
                          onChange={(event) => {
                            setRequestForm((previous) => ({ ...previous, expectedAthleteCount: event.target.value }))
                            setRequestErrors((previous) => ({ ...previous, expectedAthleteCount: undefined }))
                          }}
                          placeholder="60"
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
                        {requestErrors.expectedAthleteCount ? <p className="text-sm text-red-600">{requestErrors.expectedAthleteCount}</p> : null}
                      </div>
                      <div className="space-y-2.5">
                        <Label htmlFor="request-desired-start" className="text-sm font-medium text-slate-700">
                          Target start date
                        </Label>
                        <Input
                          id="request-desired-start"
                          type="date"
                          value={requestForm.desiredStartDate}
                          onChange={(event) => setRequestForm((previous) => ({ ...previous, desiredStartDate: event.target.value }))}
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
                      </div>
                    </div>

                    {packageFitWarnings.length > 0 ? (
                      <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                        <p className="font-semibold">Package fit warning</p>
                        <p>
                          Your projected rollout is larger than the selected package. You can still submit this request, but we recommend{" "}
                          {getPackageById(recommendedPackageId)?.label ?? "a higher package"}.
                        </p>
                        <ul className="mt-2 list-disc pl-5">
                          {packageFitWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="space-y-2.5">
                      <Label htmlFor="request-notes" className="text-sm font-medium text-slate-700">
                        Notes
                      </Label>
                      <Textarea
                        id="request-notes"
                        rows={4}
                        value={requestForm.notes}
                        onChange={(event) => setRequestForm((previous) => ({ ...previous, notes: event.target.value }))}
                        placeholder="Tell us which club, team, or access context this request belongs to."
                        className="rounded-[24px] border-slate-200 bg-white px-5 py-4 text-base shadow-none placeholder:text-slate-400"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmittingRequest}
                      className="h-14 w-full rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#2f80ff_100%)] text-base font-semibold shadow-[0_12px_36px_rgba(28,101,255,0.32)] hover:opacity-95"
                    >
                      {isSubmittingRequest ? "Submitting request..." : "Submit request"}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </div>
          </section>
        </div>
      </div>
    </main>
  )
}

