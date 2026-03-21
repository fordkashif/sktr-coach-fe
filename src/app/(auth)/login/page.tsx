"use client"

import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { loadAccountRequests, saveAccountRequests, type AccountRequest } from "@/lib/mock-club-admin"
import { setSessionCookies } from "@/lib/auth-session"
import { getBackendMode, isSupabaseEnabled } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { ensureProfileForSession } from "@/lib/supabase/profile-bootstrap"
import {
  MOCK_COACH_TEAM_STORAGE_KEY,
  MOCK_CREDENTIALS,
  MOCK_ROLE_STORAGE_KEY,
  MOCK_USER_EMAIL_STORAGE_KEY,
  resolveMockLogin,
} from "@/lib/mock-auth"

type DemoAccountKey = keyof typeof MOCK_CREDENTIALS
type AuthMode = "signin" | "request"

type RequestFormState = {
  fullName: string
  email: string
  organization: string
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

const emptyRequestForm: RequestFormState = {
  fullName: "",
  email: "",
  organization: "",
  notes: "",
}

export default function LoginPage() {
  const navigate = useNavigate()
  const isSupabaseMode = getBackendMode() === "supabase"
  const [mode, setMode] = useState<AuthMode>("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState("")
  const [requestForm, setRequestForm] = useState<RequestFormState>(emptyRequestForm)
  const [requestSubmitted, setRequestSubmitted] = useState(false)

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

      const profile = await ensureProfileForSession(supabase, data.session)
      if (!profile) {
        setError("Sign in succeeded, but your profile is missing tenant/role metadata.")
        return
      }

      window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_USER_EMAIL_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
      window.localStorage.setItem("pacelab-remember-me", rememberMe ? "true" : "false")

      setError("")
      if (profile.role === "athlete") {
        navigate("/athlete/home")
        return
      }
      if (profile.role === "coach") {
        navigate("/coach/dashboard")
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

      const result = await supabase.rpc("submit_account_request", {
        p_full_name: requestForm.fullName.trim(),
        p_email: requestForm.email.trim().toLowerCase(),
        p_organization: requestForm.organization.trim(),
        p_notes: requestForm.notes.trim() || null,
        p_desired_role: "club-admin",
      })

      if (result.error) {
        setError(result.error.message)
        return
      }

      setError("")
      setRequestSubmitted(true)
      return
    }

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
    setRequestSubmitted(true)
  }

  const applyDemoCredentials = (accountKey: DemoAccountKey) => {
    const account = MOCK_CREDENTIALS[accountKey]
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
        <div className="relative mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1.15fr)_minmax(440px,520px)] lg:gap-10 lg:px-8 xl:px-12">
          <section className="flex min-h-[160px] flex-col justify-between px-6 pb-5 pt-8 sm:min-h-[176px] sm:px-8 sm:pb-6 lg:min-h-screen lg:px-6 lg:pb-14 lg:pt-12 xl:px-10">
            <div className="space-y-6 lg:max-w-[620px] lg:space-y-10">
              <div className="space-y-4">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] shadow-[0_12px_40px_rgba(31,140,255,0.35)]">
                  <div className="h-5 w-5 rotate-12 rounded-sm bg-white/95" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#6fb6ff]">PaceLab</p>
              </div>

              <div className="space-y-3 lg:space-y-4">
                <div className="space-y-2 lg:hidden">
                  <h1 className="max-w-[10ch] text-[clamp(2.5rem,9vw,3.5rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-white">
                    {mode === "signin" ? "Welcome back" : "Request account"}
                  </h1>
                  <p className="max-w-[320px] text-sm leading-6 text-white/68">
                    {mode === "signin"
                      ? "Sign in to continue into your athlete, coach, or club admin workspace."
                      : "Request a club admin account for your organization from this form."}
                  </p>
                </div>

                <div className="hidden space-y-4 lg:block">
                  <h1 className="max-w-[10ch] text-[clamp(3rem,8vw,6rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-white">
                    {mode === "signin"
                      ? "Performance operations for athletes, coaches, and clubs."
                      : "Request a club admin workspace for your organization."}
                  </h1>
                  <p className="max-w-[520px] text-sm leading-7 text-white/68 sm:text-base">
                    {mode === "signin"
                      ? "Enter one shared system for training plans, readiness, testing, and team coordination. The product should feel operational, not generic. This surface now carries that same bar."
                      : "Use this request form when your organization needs a new club admin account. The request lands in the club-admin review queue so the approval flow can be exercised end to end."}
                  </p>
                </div>
              </div>
            </div>

            <div className="hidden gap-3 sm:grid-cols-3 lg:grid lg:max-w-[720px] lg:gap-4">
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

          <section className="relative flex items-end lg:min-h-screen lg:items-center lg:justify-end lg:py-10">
            <div className="w-full rounded-t-[36px] border-x border-t border-white/10 bg-[linear-gradient(180deg,#f8fafc_0%,#edf2f7_100%)] px-5 pb-8 pt-6 text-slate-950 shadow-[0_-24px_80px_rgba(0,0,0,0.24)] sm:px-8 sm:pb-10 sm:pt-8 lg:w-full lg:max-w-[500px] lg:rounded-[36px] lg:border lg:px-8 lg:pb-8 xl:max-w-[520px] xl:px-10">
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
                        <p className="text-xs leading-5 text-slate-500 sm:max-w-[220px] sm:text-right sm:text-sm">
                          {isSupabaseMode
                            ? "Supabase mode enabled. Use your real account credentials."
                            : "Demo build. Use the access panel below for role-specific credentials."}
                        </p>
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
                                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <span>
                                    <span className="block text-sm font-semibold text-slate-950">Athlete</span>
                                    <span className="block text-xs text-slate-500">{MOCK_CREDENTIALS.athlete.email}</span>
                                  </span>
                                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#1368ff]">Use</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => applyDemoCredentials("coach")}
                                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <span>
                                    <span className="block text-sm font-semibold text-slate-950">Coach</span>
                                    <span className="block text-xs text-slate-500">{MOCK_CREDENTIALS.coach.email}</span>
                                  </span>
                                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#1368ff]">Use</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => applyDemoCredentials("clubAdmin")}
                                  className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <span>
                                    <span className="block text-sm font-semibold text-slate-950">Club Admin</span>
                                    <span className="block text-xs text-slate-500">{MOCK_CREDENTIALS.clubAdmin.email}</span>
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
                        ? "Your request was submitted to the backend queue for club-admin review."
                        : "This demo stores the request locally for now. The next backend pass should send it to club-admin review, email notification, or a dedicated request queue."}
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
                        ? "This submits directly to the Supabase account request queue for your organization."
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

