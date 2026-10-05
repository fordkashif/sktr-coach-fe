"use client"

import { useEffect, useId, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowClockwise, ArrowLeft, ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { acceptCoachInviteForCurrentUser } from "@/lib/data/club-admin/ops-data"
import {
  claimCoachInviteAccount,
  completeCurrentCoachOnboarding,
  getCurrentCoachOnboardingState,
  getPublicCoachInvitePreview,
  type CoachInvitePreview,
} from "@/lib/data/coach/invite-claim-data"
import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type PageStage = "loading" | "needs-auth" | "setup" | "accepted" | "error"

export default function CoachInviteAcceptPage() {
  const navigate = useNavigate()
  const { inviteId = "" } = useParams()
  const isSupabaseMode = getBackendMode() === "supabase"

  const [stage, setStage] = useState<PageStage>("loading")
  const [message, setMessage] = useState("Checking invite...")
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<CoachInvitePreview | null>(null)
  const [fullName, setFullName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [requiresPassword, setRequiresPassword] = useState(true)
  const formId = useId()

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!isSupabaseMode) {
        if (!cancelled) {
          setStage("error")
          setMessage("Coach invite acceptance is only available in Supabase mode.")
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

      const previewResult = await getPublicCoachInvitePreview(inviteId)
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

      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        if (!cancelled) {
          setFullName(invitePreview.email.split("@")[0] || "")
          setError(null)
          if (invitePreview.hasExistingAccount) {
            setRequiresPassword(false)
            setStage("needs-auth")
            setMessage(`This invite is for ${invitePreview.email}. Sign in with that account to continue.`)
          } else {
            setRequiresPassword(true)
            setStage("setup")
            setMessage("Complete your coach setup to claim this invite and enter the workspace.")
          }
        }
        return
      }

      if ((sessionData.session.user.email ?? "").trim().toLowerCase() !== invitePreview.email.trim().toLowerCase()) {
        if (!cancelled) {
          setStage("error")
          setMessage(`This invite is for ${invitePreview.email}. Sign in with that email to continue.`)
        }
        return
      }

      const acceptResult = await acceptCoachInviteForCurrentUser(inviteId)
      if (!acceptResult.ok) {
        if (!cancelled) {
          setStage("error")
          setMessage(acceptResult.error.message)
        }
        return
      }

      const onboardingResult = await getCurrentCoachOnboardingState()
      if (!onboardingResult.ok) {
        if (!cancelled) {
          setStage("error")
          setMessage(onboardingResult.error.message)
        }
        return
      }

      if (!cancelled && (!onboardingResult.data.displayName || !onboardingResult.data.onboardingCompletedAt)) {
        setFullName(onboardingResult.data.displayName || invitePreview.email.split("@")[0] || "")
        setRequiresPassword(false)
        setStage("setup")
        setMessage("Complete your coach setup before entering the workspace.")
        return
      }

      if (!cancelled) {
        setStage("accepted")
        setMessage("Invite accepted. Your coach workspace is ready.")
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
    return parts.join(", ")
  }, [preview])

  const handleClaimWithPassword = async () => {
    if (!preview) return
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }
    if (password.trim().length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    if (!fullName.trim()) {
      setError("Full name is required.")
      return
    }

    const supabase = getBrowserSupabaseClient()
    if (!supabase) {
      setError("Supabase client is not configured.")
      return
    }

    setSubmitting(true)
    setError(null)

    const claimResult = await claimCoachInviteAccount({
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
      setError(signInResult.error?.message ?? "Coach account claimed, but no session was established.")
      return
    }

    const acceptResult = await acceptCoachInviteForCurrentUser(inviteId)
    if (!acceptResult.ok) {
      setSubmitting(false)
      setError(acceptResult.error.message)
      return
    }

    const completeResult = await completeCurrentCoachOnboarding({
      displayName: fullName.trim(),
      password: password.trim(),
    })
    setSubmitting(false)

    if (!completeResult.ok) {
      setError(completeResult.error.message)
      return
    }

    navigate("/coach/dashboard", { replace: true })
  }

  const handleExistingCoachSetup = async () => {
    if (!fullName.trim()) {
      setError("Full name is required.")
      return
    }

    setSubmitting(true)
    const result = await completeCurrentCoachOnboarding({ displayName: fullName.trim() })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    navigate("/coach/dashboard", { replace: true })
  }

  const handleSetupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void (requiresPassword ? handleClaimWithPassword() : handleExistingCoachSetup())
  }

  const title =
    stage === "accepted"
      ? "You are in"
      : stage === "error"
        ? "This invite needs a second look"
        : preview
          ? `Join ${preview.organizationName}`
          : "Your coach invite"

  const steps = [
    {
      title: "We check the invited email",
      body: "If it already has an account you sign in. If not, you set a password here.",
    },
    {
      title: "You accept with that same email",
      body: "Your team access is tied to the exact email this invite was sent to.",
    },
    {
      title: "You land on your dashboard",
      body: "It walks you through your roster, your first plan and your first test week.",
    },
  ]

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-6 px-4 pb-12 pt-8 sm:px-6 sm:pt-14">
      <header className="space-y-3">
        <p className="text-lg font-extrabold tracking-[-0.03em] text-sk-blue">SKTR Coach</p>
        <h1 className="sk-title">{title}</h1>
        <p className="sk-lede" aria-live="polite">
          {stage === "error" ? "Something stopped this invite from opening. Nothing has been changed on your account." : message}
        </p>
      </header>

      <section className="sk-card" aria-label="Invite details">
        <dl className={stage === "error" && !preview ? "hidden" : undefined}>
          <div className="sk-row pt-0">
            <dt className="sk-label">Invited email</dt>
            <dd className="min-w-0 break-all text-right font-bold text-sk-ink">
              {preview?.email ?? (stage === "loading" ? "Loading..." : "Not available")}
            </dd>
          </div>
          {preview ? (
            <div className="sk-row">
              <dt className="sk-label">Club</dt>
              <dd className="min-w-0 text-right font-bold text-sk-ink">{preview.organizationName}</dd>
            </div>
          ) : null}
          <div className={stage === "loading" ? "sk-row pb-0" : "sk-row"}>
            <dt className="sk-label">Team access</dt>
            <dd className="min-w-0 text-right font-bold text-sk-ink">
              {preview ? (preview.teamName ?? "General coach access") : stage === "loading" ? "Loading..." : "Not available"}
            </dd>
          </div>
        </dl>

        {stage === "error" ? (
          <div className={preview ? "mt-5 space-y-4" : "space-y-4"}>
            <div className="flex items-start gap-3 rounded-2xl bg-sk-coral-tint p-4" role="alert">
              <WarningCircle className="mt-0.5 size-5 shrink-0 text-[#b32a0c]" weight="fill" aria-hidden />
              <div className="space-y-1 text-sm">
                <p className="font-bold text-[#b32a0c]">{error ?? message}</p>
                <p className="text-sk-ink-2">
                  Open the newest invite link from your email, or sign in with the exact email the invite was sent to.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="sk-btn sk-btn-primary" onClick={() => window.location.reload()}>
                <ArrowClockwise className="size-5" weight="bold" />
                Try again
              </button>
              <Link to="/login" className="sk-btn sk-btn-quiet">
                <ArrowLeft className="size-5" weight="bold" />
                Back to login
              </Link>
            </div>
          </div>
        ) : null}

        {stage === "needs-auth" ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-relaxed text-sk-ink-2">
              This email already has a SKTR Coach account. Sign in with it and the invite attaches itself.
            </p>
            <Link to={`/login?redirect=${encodeURIComponent(`/invite/coach/${inviteId}`)}`} className="sk-btn sk-btn-primary">
              Sign in to continue
              <ArrowRight className="size-5" weight="bold" />
            </Link>
          </div>
        ) : null}

        {stage === "accepted" ? (
          <div className="mt-5 space-y-4">
            <p className="flex items-center gap-2 text-sm font-bold text-[#07673f]">
              <CheckCircle className="size-5" weight="fill" aria-hidden />
              {inviteSummary ? `You now coach at ${inviteSummary}.` : "Your invite is accepted."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="sk-btn sk-btn-primary" onClick={() => navigate("/coach/dashboard")}>
                Open coach dashboard
                <ArrowRight className="size-5" weight="bold" />
              </button>
              <Link to="/coach/teams" className="sk-btn sk-btn-quiet">
                Open teams
              </Link>
            </div>
          </div>
        ) : null}

        {stage === "setup" ? (
          <form className="mt-5 grid gap-4" onSubmit={handleSetupSubmit} noValidate>
            <h2 className="sk-h2">{requiresPassword ? "Create your account" : "Finish your profile"}</h2>
            <p className="-mt-2 text-sm leading-relaxed text-sk-mute">
              {requiresPassword
                ? "There is no account for this email yet, so this creates one."
                : "Your account is already linked. Confirm your name and you are done."}
            </p>
            <div>
              <label htmlFor={`${formId}-name`} className="sk-label mb-1.5 block">
                Full name
              </label>
              <input
                id={`${formId}-name`}
                className="sk-field"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </div>
            {requiresPassword ? (
              <>
                <div>
                  <label htmlFor={`${formId}-password`} className="sk-label mb-1.5 block">
                    Password
                  </label>
                  <input
                    id={`${formId}-password`}
                    type="password"
                    className="sk-field"
                    autoComplete="new-password"
                    aria-describedby={`${formId}-password-hint`}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <p id={`${formId}-password-hint`} className="mt-1.5 text-sm text-sk-mute">
                    At least 8 characters.
                  </p>
                </div>
                <div>
                  <label htmlFor={`${formId}-confirm`} className="sk-label mb-1.5 block">
                    Confirm password
                  </label>
                  <input
                    id={`${formId}-confirm`}
                    type="password"
                    className="sk-field"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
              </>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={submitting} className="sk-btn sk-btn-primary">
                {submitting ? "Saving..." : requiresPassword ? "Create account and join" : "Finish setup"}
              </button>
              <button type="button" className="sk-btn sk-btn-ghost" onClick={() => navigate("/login")}>
                Back to login
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {stage !== "setup" && stage !== "accepted" ? (
        <section aria-labelledby={`${formId}-steps`} className="px-1">
          <h2 id={`${formId}-steps`} className="sk-h3">
            How joining works
          </h2>
          <ol className="mt-3 space-y-4">
            {steps.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sk-yellow text-sm font-extrabold text-sk-ink">
                  {index + 1}
                </span>
                <div>
                  <p className="font-bold text-sk-ink">{step.title}</p>
                  <p className="text-sm leading-relaxed text-sk-mute">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  )
}
