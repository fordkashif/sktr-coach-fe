"use client"

import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Alert02Icon, ArrowLeft01Icon, Link01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { EmptyStateCard } from "@/components/ui/empty-state-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { acceptAthleteInviteForCurrentUser } from "@/lib/data/athlete/invite-data"
import {
  claimAthleteInviteAccount,
  completeCurrentAthleteOnboarding,
  getCurrentAthleteOnboardingState,
  getPublicAthleteInvitePreview,
  type AthleteInvitePreview,
} from "@/lib/data/athlete/invite-claim-data"
import { resolveSessionActor } from "@/lib/supabase/actor"
import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type PageStage = "loading" | "needs-auth" | "setup" | "accepted" | "error"

export default function AthleteClaimPage() {
  const navigate = useNavigate()
  const { inviteId = "" } = useParams()
  const isSupabaseMode = getBackendMode() === "supabase"

  const [stage, setStage] = useState<PageStage>("loading")
  const [message, setMessage] = useState("Checking invite...")
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AthleteInvitePreview | null>(null)
  const [fullName, setFullName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [requiresPassword, setRequiresPassword] = useState(true)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!isSupabaseMode) {
        if (!cancelled) {
          setStage("error")
          setMessage("Athlete claim is only available in Supabase mode.")
        }
        return
      }

      if (!inviteId) {
        if (!cancelled) {
          setStage("error")
          setMessage("Invite id is missing.")
        }
        return
      }

      const supabase = getBrowserSupabaseClient()
      if (!supabase) {
        if (!cancelled) {
          setStage("error")
          setMessage("Supabase client is not configured.")
        }
        return
      }

      const previewResult = await getPublicAthleteInvitePreview(inviteId)
      if (!previewResult.ok) {
        if (!cancelled) {
          setStage("error")
          setMessage(previewResult.error.message)
        }
        return
      }

      const invitePreview = previewResult.data
      if (!cancelled) {
        setPreview(invitePreview)
      }

      if (!invitePreview.email) {
        if (!cancelled) {
          setStage("error")
          setMessage("This athlete invite is missing an invited email. Generate a new athlete invite.")
        }
        return
      }

      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        if (!cancelled) {
          setFullName(invitePreview.teamName ? `${invitePreview.teamName} Athlete` : "")
          setError(null)
          if (invitePreview.hasExistingAccount) {
            setRequiresPassword(false)
            setStage("needs-auth")
            setMessage(`This invite is for ${invitePreview.email ?? "the invited athlete email"}. Sign in with that account to continue.`)
          } else {
            setRequiresPassword(true)
            setStage("setup")
            setMessage("Complete your athlete setup to claim this invite and enter the workspace.")
          }
        }
        return
      }

      const actor = await resolveSessionActor(supabase, sessionData.session)
      if (!actor) {
        if (!cancelled) {
          setStage("error")
          setMessage("Sign-in succeeded, but your session did not resolve to an app role.")
        }
        return
      }

      if (actor.role !== "athlete") {
        if (!cancelled) {
          setStage("error")
          setMessage(`This invite must be claimed with an athlete account. Current role: ${actor.role}.`)
        }
        return
      }

      if (
        invitePreview.email &&
        (sessionData.session.user.email ?? "").trim().toLowerCase() !== invitePreview.email.trim().toLowerCase()
      ) {
        if (!cancelled) {
          setStage("error")
          setMessage(`This invite is for ${invitePreview.email}. Sign in with that email to continue.`)
        }
        return
      }

      const acceptResult = await acceptAthleteInviteForCurrentUser(inviteId)
      if (!acceptResult.ok) {
        if (!cancelled) {
          setStage("error")
          setMessage(acceptResult.error.message)
        }
        return
      }

      const onboardingResult = await getCurrentAthleteOnboardingState()
      if (!onboardingResult.ok) {
        if (!cancelled) {
          setStage("error")
          setMessage(onboardingResult.error.message)
        }
        return
      }

      if (!cancelled && (!onboardingResult.data.displayName || !onboardingResult.data.onboardingCompletedAt)) {
        setFullName(onboardingResult.data.displayName || "")
        setRequiresPassword(false)
        setStage("setup")
        setMessage("Complete your athlete setup before entering the workspace.")
        return
      }

      if (!cancelled) {
        setStage("accepted")
        setMessage("Invite accepted. Your athlete workspace is ready.")
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [inviteId, isSupabaseMode])

  const inviteSummary = useMemo(() => {
    if (!preview) return null
    const parts = [preview.organizationName]
    if (preview.teamName) parts.push(preview.teamName)
    if (preview.eventGroup) parts.push(preview.eventGroup)
    return parts.join(" | ")
  }, [preview])

  const handleClaim = async () => {
    if (!preview) return
    if (!preview.email) {
      setError("This athlete invite is missing an invited email. Generate a new athlete invite.")
      return
    }
    if (!fullName.trim()) {
      setError("Full name is required.")
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }
    if (password.trim().length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }

    const supabase = getBrowserSupabaseClient()
    if (!supabase) {
      setError("Supabase client is not configured.")
      return
    }

    setSubmitting(true)
    setError(null)

    const claimResult = await claimAthleteInviteAccount({
      inviteId,
      email: preview.email.trim().toLowerCase(),
      password: password.trim(),
      displayName: fullName.trim(),
    })

    if (!claimResult.ok) {
      setSubmitting(false)
      setError(claimResult.error.message)
      return
    }

    const signInResult = await supabase.auth.signInWithPassword({
      email: preview.email.trim().toLowerCase(),
      password: password.trim(),
    })
    if (signInResult.error || !signInResult.data.session) {
      setSubmitting(false)
      setError(signInResult.error?.message ?? "Athlete account claimed, but no session was established.")
      return
    }

    const actor = await resolveSessionActor(supabase, signInResult.data.session)
    if (!actor || actor.role !== "athlete") {
      setSubmitting(false)
      setError("Claim succeeded, but the session did not resolve to an athlete account.")
      return
    }

    const acceptResult = await acceptAthleteInviteForCurrentUser(inviteId)
    if (!acceptResult.ok) {
      setSubmitting(false)
      setError(acceptResult.error.message)
      return
    }

    const completeResult = await completeCurrentAthleteOnboarding({
      displayName: fullName.trim(),
    })

    setSubmitting(false)

    if (!completeResult.ok) {
      setError(completeResult.error.message)
      return
    }

    navigate("/athlete/home", { replace: true })
  }

  const handleExistingAthleteSetup = async () => {
    if (!fullName.trim()) {
      setError("Full name is required.")
      return
    }

    setSubmitting(true)
    const result = await completeCurrentAthleteOnboarding({ displayName: fullName.trim() })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    navigate("/athlete/home", { replace: true })
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-8">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Athlete invite</p>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">Claim athlete access</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            This invite should lead directly into a usable athlete account. Claim access here, set your password if you are new, and then continue into the athlete workspace.
          </p>
          {inviteSummary ? <p className="text-sm font-medium text-slate-950">{inviteSummary}</p> : null}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Invite status</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{message}</h2>
          </div>

          <div className="mt-4 space-y-4 text-sm text-slate-600">
            {stage === "error" ? (
              <EmptyStateCard
                eyebrow="Invite issue"
                title="This athlete invite cannot continue yet."
                description={error ?? message}
                hint="Use the latest athlete invite link, or sign in with the exact invited athlete email if the account already exists."
                icon={<HugeiconsIcon icon={Alert02Icon} className="size-5" />}
                className="rounded-[18px] bg-slate-50 px-4 py-5 shadow-none"
                contentClassName="gap-2"
                actions={
                  <div className="flex flex-wrap gap-3">
                    <Button asChild variant="outline" className="h-11 rounded-full px-5">
                      <Link to="/login">
                        <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
                        Back to login
                      </Link>
                    </Button>
                    <Button type="button" variant="outline" className="h-11 rounded-full px-5" onClick={() => window.location.reload()}>
                      <HugeiconsIcon icon={Link01Icon} className="size-4" />
                      Retry invite
                    </Button>
                  </div>
                }
              />
            ) : null}
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Team access</p>
              <p className="mt-1 text-sm font-medium text-slate-950">{preview?.teamName ?? "Loading..."}</p>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Invited email</p>
              <p className="mt-1 text-sm font-medium text-slate-950">{preview?.email ?? "Loading..."}</p>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Event group</p>
              <p className="mt-1 text-sm font-medium text-slate-950">{preview?.eventGroup ?? "General athlete access"}</p>
            </div>

            {stage === "needs-auth" ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  PaceLab found an existing athlete account for this invited email. Sign in with that account and the invite will attach automatically.
                </p>
                <Button asChild className="h-11 rounded-full px-5">
                  <Link to={`/login?redirect=${encodeURIComponent(`/athlete/claim/${inviteId}`)}`}>Sign in to continue</Link>
                </Button>
              </div>
            ) : null}

            {stage === "accepted" ? (
              <div className="flex flex-wrap gap-3">
                <Button type="button" className="h-11 rounded-full px-5" onClick={() => navigate("/athlete/home")}>
                  Open athlete home
                </Button>
                <Button asChild variant="outline" className="h-11 rounded-full px-5">
                  <Link to="/athlete/training-plan">Open plan</Link>
                </Button>
              </div>
            ) : null}

          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {stage === "setup" ? "First access" : "What happens next"}
            </p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">
              {stage === "setup" ? "Complete athlete setup" : "Athlete onboarding path"}
            </h2>
          </div>

          {stage === "setup" ? (
            <div className="mt-4 grid gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-slate-950">Full name</Label>
                <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" value={fullName} onChange={(event) => setFullName(event.target.value)} />
              </div>
              {requiresPassword ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-950">Password</Label>
                    <Input type="password" className="h-12 rounded-[16px] border-slate-200 bg-slate-50" value={password} onChange={(event) => setPassword(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-950">Confirm password</Label>
                    <Input type="password" className="h-12 rounded-[16px] border-slate-200 bg-slate-50" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                  </div>
                </>
              ) : null}
              <p className="text-sm text-slate-500">
                {requiresPassword
                  ? "No existing athlete account was found for this invited email, so this invite will create the athlete account directly."
                  : "Your athlete account is already attached. Finish the remaining profile details and continue into the workspace."}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" disabled={submitting} className="h-11 rounded-full px-5" onClick={() => void (requiresPassword ? handleClaim() : handleExistingAthleteSetup())}>
                  {submitting ? "Saving..." : "Complete athlete setup"}
                </Button>
                <Button type="button" variant="outline" className="h-11 rounded-full px-5" onClick={() => navigate("/login")}>
                  Back to login
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="font-medium text-slate-950">1. PaceLab checks the invited email first</p>
                <p className="mt-1">If the email already has an athlete account, the invite goes straight to sign-in. If not, the invite goes straight to first-time setup.</p>
              </div>
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="font-medium text-slate-950">2. Confirm the invited athlete email</p>
                <p className="mt-1">Invite acceptance binds the athlete record to the correct team and the exact invited email.</p>
              </div>
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="font-medium text-slate-950">3. Continue into the athlete workspace</p>
                <p className="mt-1">The athlete home view should guide the next steps so the invite does not end in a dead end.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
