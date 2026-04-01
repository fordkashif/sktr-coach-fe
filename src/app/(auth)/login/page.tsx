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
  organizationWebsite: string
  region: string
  expectedCoachCount: string
  expectedAthleteCount: string
  desiredStartDate: string
  notes: string
}

const featurePillars = [
  {
    label: "Programs",
    copy: "Build training blocks, test weeks, and athlete-ready schedules from one system.",
  },
  {
    label: "Readiness",
    copy: "Track wellness, plan adherence, and performance signals without leaving the workflow.",
  },
  {
    label: "Teams",
    copy: "Move between athlete, coach, and club admin workspaces with one shared operating model.",
  },
] as const

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
  const [requestForm, setRequestForm] = useState<RequestFormState>(emptyRequestForm)
  const [requestSubmitted, setRequestSubmitted] = useState(false)
  const [demoCredentials, setDemoCredentials] = useState<DemoCredentialMap | null>(null)
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
    if (isSupabaseMode) {
      if (!isSupabaseEnabled()) {
        setError("Supabase mode is enabled but URL/key are missing in environment.")
        return
      }

      const supabase = getBrowserSupabaseClient()
      if (!supabase) {
        setError("Supabase client failed to initialize.")
        return
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (signInError || !data.session) {
        setError(signInError?.message ?? "Sign in failed.")
        return
      }

      const actor = await resolveSessionActor(supabase, data.session)
      if (!actor) {
        setError("Sign in succeeded, but your account is not mapped to an application role.")
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
    if (isSupabaseMode) {
      const supabase = getBrowserSupabaseClient()
      if (!supabase) {
        setError("Supabase client is not configured.")
        return
      }

      const result = await supabase.rpc("submit_tenant_provision_request", {
        p_requestor_name: requestForm.fullName.trim(),
        p_requestor_email: requestForm.email.trim().toLowerCase(),
        p_organization_name: requestForm.organization.trim(),
        p_notes: requestForm.notes.trim() || null,
        p_requested_plan: "starter",
        p_expected_seats:
          Math.max(0, Number.parseInt(requestForm.expectedCoachCount || "0", 10)) +
          Math.max(0, Number.parseInt(requestForm.expectedAthleteCount || "0", 10)),
        p_job_title: requestForm.jobTitle.trim(),
        p_organization_type: requestForm.organizationType.trim(),
        p_organization_website: requestForm.organizationWebsite.trim() || null,
        p_region: requestForm.region.trim(),
        p_expected_coach_count: Math.max(0, Number.parseInt(requestForm.expectedCoachCount || "0", 10)),
        p_expected_athlete_count: Math.max(0, Number.parseInt(requestForm.expectedAthleteCount || "0", 10)),
        p_desired_start_date: requestForm.desiredStartDate || null,
      })

      if (result.error) {
        setError(result.error.message)
        return
      }

      setError("")
      setRequestForm(emptyRequestForm)
      setRequestSubmitted(true)
      return
    }

    submitMockTenantProvisionRequest({
      fullName: requestForm.fullName,
      email: requestForm.email,
      jobTitle: requestForm.jobTitle,
      organization: requestForm.organization,
      organizationType: requestForm.organizationType,
      organizationWebsite: requestForm.organizationWebsite,
      region: requestForm.region,
      expectedCoachCount: Math.max(0, Number.parseInt(requestForm.expectedCoachCount || "0", 10)),
      expectedAthleteCount: Math.max(0, Number.parseInt(requestForm.expectedAthleteCount || "0", 10)),
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
    setRequestForm(emptyRequestForm)
    setRequestSubmitted(true)
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
    if (nextMode === "request") {
      setRequestSubmitted(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#050b16] text-white">
      <div className="relative isolate min-h-screen overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(31,140,255,0.22),_transparent_36%),linear-gradient(180deg,_rgba(8,15,28,0.96)_0%,_rgba(4,9,18,1)_58%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:72px_72px] opacity-[0.16]" />
        <div className="relative mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1.15fr)_minmax(440px,520px)] xl:gap-10 xl:px-8 2xl:px-12">
          <section className="flex min-h-[160px] flex-col justify-between px-6 pb-5 pt-8 sm:min-h-[176px] sm:px-8 sm:pb-6 md:pb-8 xl:min-h-screen xl:px-6 xl:pb-14 xl:pt-12 2xl:px-10">
            <div className="space-y-6 md:space-y-8 xl:max-w-[620px] xl:space-y-10">
              <div className="space-y-4">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] shadow-[0_12px_40px_rgba(31,140,255,0.35)]">
                  <div className="h-5 w-5 rotate-12 rounded-sm bg-white/95" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#6fb6ff]">PaceLab</p>
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
                      : "Use this request form when your organization needs a new club admin account. The request lands in the platform-admin review queue so provisioning can be exercised end to end."}
                  </p>
                </div>
              </div>
            </div>

            <div className="hidden gap-3 md:grid md:grid-cols-3 md:max-w-[900px] md:gap-4 xl:max-w-[720px]">
              {featurePillars.map((pillar) => (
                <div
                  key={pillar.label}
                  className="rounded-[24px] border border-white/12 bg-white/[0.05] p-4 backdrop-blur-sm"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6fb6ff]">{pillar.label}</p>
                  <p className="mt-3 text-sm leading-6 text-white/70">{pillar.copy}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="relative flex items-end md:px-6 md:pb-8 xl:min-h-screen xl:items-center xl:justify-end xl:px-0 xl:py-10">
            <div className="w-full rounded-t-[36px] border-x border-t border-white/10 bg-[linear-gradient(180deg,#f8fafc_0%,#edf2f7_100%)] px-5 pb-8 pt-6 text-slate-950 shadow-[0_-24px_80px_rgba(0,0,0,0.24)] sm:px-8 sm:pb-10 sm:pt-8 md:mx-auto md:max-w-[760px] md:rounded-[36px] md:border md:px-8 md:shadow-[0_24px_80px_rgba(0,0,0,0.24)] xl:mx-0 xl:w-full xl:max-w-[500px] xl:px-8 xl:pb-8 2xl:max-w-[520px] 2xl:px-10">
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

                      <Button
                        type="submit"
                        className="h-14 w-full rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#2f80ff_100%)] text-base font-semibold shadow-[0_12px_36px_rgba(28,101,255,0.32)] hover:opacity-95"
                      >
                        Sign in
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
                        Full name
                      </Label>
                      <Input
                        id="request-full-name"
                        required
                        value={requestForm.fullName}
                        onChange={(event) => setRequestForm((previous) => ({ ...previous, fullName: event.target.value }))}
                        placeholder="Jordan Davis"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-email" className="text-sm font-medium text-slate-700">
                        Work email
                      </Label>
                      <Input
                        id="request-email"
                        type="email"
                        required
                        value={requestForm.email}
                        onChange={(event) => setRequestForm((previous) => ({ ...previous, email: event.target.value }))}
                        placeholder="jordan@club.com"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-job-title" className="text-sm font-medium text-slate-700">
                        Job title
                      </Label>
                      <Input
                        id="request-job-title"
                        required
                        value={requestForm.jobTitle}
                        onChange={(event) => setRequestForm((previous) => ({ ...previous, jobTitle: event.target.value }))}
                        placeholder="Head coach"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-organization" className="text-sm font-medium text-slate-700">
                        Organization
                      </Label>
                      <Input
                        id="request-organization"
                        required
                        value={requestForm.organization}
                        onChange={(event) => setRequestForm((previous) => ({ ...previous, organization: event.target.value }))}
                          placeholder="Elite Track Club"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2.5">
                        <Label htmlFor="request-organization-type" className="text-sm font-medium text-slate-700">
                          Organization type
                        </Label>
                        <Select
                          value={requestForm.organizationType}
                          onValueChange={(value) => setRequestForm((previous) => ({ ...previous, organizationType: value }))}
                        >
                          <SelectTrigger
                            id="request-organization-type"
                            className="h-14 w-full rounded-full border-slate-200 bg-white px-5 text-base shadow-none"
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
                      </div>
                      <div className="space-y-2.5">
                        <Label htmlFor="request-region" className="text-sm font-medium text-slate-700">
                          Country or region
                        </Label>
                        <Input
                          id="request-region"
                          required
                          value={requestForm.region}
                          onChange={(event) => setRequestForm((previous) => ({ ...previous, region: event.target.value }))}
                          placeholder="Jamaica"
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <Label htmlFor="request-organization-website" className="text-sm font-medium text-slate-700">
                        Organization website
                      </Label>
                      <Input
                        id="request-organization-website"
                        type="url"
                        value={requestForm.organizationWebsite}
                        onChange={(event) => setRequestForm((previous) => ({ ...previous, organizationWebsite: event.target.value }))}
                        placeholder="https://jamaicacollege.edu.jm"
                        className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                      />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-3">
                      <div className="space-y-2.5">
                        <Label htmlFor="request-expected-coaches" className="text-sm font-medium text-slate-700">
                          Expected coaches
                        </Label>
                        <Input
                          id="request-expected-coaches"
                          type="number"
                          min="0"
                          required
                          value={requestForm.expectedCoachCount}
                          onChange={(event) => setRequestForm((previous) => ({ ...previous, expectedCoachCount: event.target.value }))}
                          placeholder="4"
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
                      </div>
                      <div className="space-y-2.5">
                        <Label htmlFor="request-expected-athletes" className="text-sm font-medium text-slate-700">
                          Expected athletes
                        </Label>
                        <Input
                          id="request-expected-athletes"
                          type="number"
                          min="0"
                          required
                          value={requestForm.expectedAthleteCount}
                          onChange={(event) => setRequestForm((previous) => ({ ...previous, expectedAthleteCount: event.target.value }))}
                          placeholder="60"
                          className="h-14 rounded-full border-slate-200 bg-white px-5 text-base shadow-none placeholder:text-slate-400"
                        />
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

                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                      {isSupabaseMode
                        ? "This submits a tenant provisioning request for platform-admin approval."
                        : "This submits a club admin account request into the review queue. Approval remains mock-backed for now, but the workflow is no longer a dead end."}
                    </div>

                    <Button
                      type="submit"
                      className="h-14 w-full rounded-full bg-[linear-gradient(135deg,#1368ff_0%,#2f80ff_100%)] text-base font-semibold shadow-[0_12px_36px_rgba(28,101,255,0.32)] hover:opacity-95"
                    >
                      Submit request
                    </Button>
                  </form>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

