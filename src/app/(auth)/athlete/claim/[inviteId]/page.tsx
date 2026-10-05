"use client"

import { useEffect, useId, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowClockwise, ArrowLeft, ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { acceptAthleteInviteForCurrentUser } from "@/lib/data/athlete/invite-data"
import {
  claimAthleteInviteAccount,
  completeCurrentAthleteOnboarding,
  getCurrentAthleteOnboardingState,
  getPublicAthleteInvitePreview,
  type AthleteInvitePreview,
} from "@/lib/data/athlete/invite-claim-data"
import { setSessionCookies } from "@/lib/auth-session"
import { MOCK_ORGANIZATION_NAME, eventGroupLabel } from "@/lib/data/athlete/profile-data"
import { resolveSessionActor } from "@/lib/supabase/actor"
import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type PageStage = "loading" | "needs-auth" | "setup" | "accepted" | "error" | "demo"

/** Plain-language versions of the invite errors the database and edge function return. */
function friendlyInviteError(message: string) {
  const text = message.toLowerCase()
  if (text.includes("expired")) return "This invite has expired. Ask your coach to send a new one."
  if (text.includes("not pending")) return "This invite has already been used or was cancelled. Ask your coach to send a new one."
  if (text.includes("not found") || text.includes("invalid input syntax")) {
    return "We could not find this invite. Check that you opened the full link from your email."
  }
  if (text.includes("different email")) return "This invite was sent to a different email address."
  if (text.includes("only athlete users")) {
    return "This invite is for an athlete account, and you are signed in with a coach or club admin account. Sign in with the invited athlete email."
  }
  if (text.includes("tenant")) return "This invite is for a different club than the one your account belongs to."
  if (text.includes("already exists")) {
    return "An account already exists for this email. Sign in with it, then open this invite link again."
  }
  return message
}

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
  const formId = useId()

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!isSupabaseMode) {
        // Demo mode has no accounts to create. Show the team the link points at and hand over to the join screen.
        const mockData = await import("@/lib/mock-data")
        if (cancelled) return
        const team = mockData.mockTeams.find((item) => item.id.toLowerCase() === inviteId.toLowerCase())
        if (!team) {
          setStage("error")
          setMessage("We could not find this invite. Check that you opened the full link from your coach.")
          return
        }
        setPreview({
          inviteId,
          tenantId: "",
          teamId: team.id,
          teamName: team.name,
          organizationName: MOCK_ORGANIZATION_NAME,
          eventGroup: team.eventGroup,
          status: "pending",
          email: null,
          hasExistingAccount: true,
        })
        setStage("demo")
        setMessage(`You have been invited to train with ${team.name}.`)
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
          setMessage(friendlyInviteError(previewResult.error.message))
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
          setFullName("")
          setError(null)
          if (invitePreview.hasExistingAccount) {
            setRequiresPassword(false)
            setStage("needs-auth")
            setMessage(`This invite is for ${invitePreview.email ?? "the invited athlete email"}. Sign in with that account to continue.`)
          } else {
            setRequiresPassword(true)
            setStage("setup")
            setMessage("Set a password to create your account and join the team.")
          }
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

      // Accepting comes first: for a new athlete the database creates the profile from this invite.
      // The browser cannot create one itself.
      const acceptResult = await acceptAthleteInviteForCurrentUser(inviteId)
      if (!acceptResult.ok) {
        if (!cancelled) {
          setStage("error")
          setMessage(friendlyInviteError(acceptResult.error.message))
        }
        return
      }

      const actor = await resolveSessionActor(supabase, sessionData.session)
      if (!actor || actor.role !== "athlete") {
        if (!cancelled) {
          setStage("error")
          setMessage("The invite was accepted, but your session did not open as an athlete account. Sign in again.")
        }
        return
      }
      // The profile did not exist when the app first looked at this session, so record the role now.
      setSessionCookies(actor.role, actor.tenantId ?? "", sessionData.session.user.email ?? sessionData.session.user.id)

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
        setMessage("You are on the team. Confirm your name to finish.")
        return
      }

      if (!cancelled) {
        setStage("accepted")
        setMessage("Your invite is accepted and your training is ready.")
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
      setError(friendlyInviteError(claimResult.error.message))
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

    // Accepting comes first: the database creates the athlete profile from this invite.
    const acceptResult = await acceptAthleteInviteForCurrentUser(inviteId)
    if (!acceptResult.ok) {
      setSubmitting(false)
      setError(friendlyInviteError(acceptResult.error.message))
      return
    }

    const actor = await resolveSessionActor(supabase, signInResult.data.session)
    if (!actor || actor.role !== "athlete") {
      setSubmitting(false)
      setError("Claim succeeded, but the session did not resolve to an athlete account.")
      return
    }
    // The profile did not exist when the app first looked at this session, so record the role now.
    setSessionCookies(actor.role, actor.tenantId ?? "", signInResult.data.session.user.email ?? signInResult.data.session.user.id)

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

  const handleSetupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void (requiresPassword ? handleClaim() : handleExistingAthleteSetup())
  }

  const title =
    stage === "accepted"
      ? "You are in"
      : stage === "error"
        ? "This invite needs a second look"
        : preview
          ? `Join ${preview.teamName}`
          : "Your team invite"

  const steps = [
    {
      title: "Check in before you train",
      body: "A quick wellness check each day tells your coach how you feel.",
    },
    {
      title: "Open today's session",
      body: "Your plan shows what to do today. Log each set as you go.",
    },
    {
      title: "Watch your numbers move",
      body: "Test weeks and personal bests build up under Progress.",
    },
  ]

  const showDetails = Boolean(preview) || stage === "loading"

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
        {showDetails ? (
          <dl>
            <div className="sk-row items-baseline pt-0">
              <dt className="sk-label shrink-0">Team</dt>
              <dd className="min-w-0 break-words text-right font-bold text-sk-ink">{preview?.teamName ?? "Loading..."}</dd>
            </div>
            {preview ? (
              <>
                <div className="sk-row items-baseline">
                  <dt className="sk-label shrink-0">Club</dt>
                  <dd className="min-w-0 break-words text-right font-bold text-sk-ink">{preview.organizationName}</dd>
                </div>
                {preview.eventGroup ? (
                  <div className="sk-row items-baseline">
                    <dt className="sk-label shrink-0">Event group</dt>
                    <dd className="min-w-0 text-right font-bold text-sk-ink">{eventGroupLabel(preview.eventGroup)}</dd>
                  </div>
                ) : null}
                {preview.email ? (
                  <div className="sk-row items-baseline">
                    <dt className="sk-label shrink-0">Invited email</dt>
                    <dd className="min-w-0 break-all text-right font-bold text-sk-ink">{preview.email}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
        ) : null}

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
              This email already has a SKTR Coach account. Sign in with it and you are added to the team straight away.
            </p>
            <Link to={`/login?redirect=${encodeURIComponent(`/athlete/claim/${inviteId}`)}`} className="sk-btn sk-btn-primary">
              Sign in to continue
              <ArrowRight className="size-5" weight="bold" />
            </Link>
          </div>
        ) : null}

        {stage === "demo" ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-relaxed text-sk-ink-2">
              This is the demo workspace, so there is no account to create. Continue to confirm the team.
            </p>
            <Link to={`/athlete/join/${encodeURIComponent(inviteId)}`} className="sk-btn sk-btn-primary">
              Continue to join
              <ArrowRight className="size-5" weight="bold" />
            </Link>
          </div>
        ) : null}

        {stage === "accepted" ? (
          <div className="mt-5 space-y-4">
            <p className="flex items-center gap-2 text-sm font-bold text-[#07673f]">
              <CheckCircle className="size-5 shrink-0" weight="fill" aria-hidden />
              {inviteSummary ? `You now train with ${inviteSummary}.` : "Your invite is accepted."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="sk-btn sk-btn-primary" onClick={() => navigate("/athlete/home")}>
                Open today
                <ArrowRight className="size-5" weight="bold" />
              </button>
              <Link to="/athlete/training-plan" className="sk-btn sk-btn-quiet">
                Open plan
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
                placeholder="First and last name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </div>
            {requiresPassword ? (
              <>
                {preview?.email ? (
                  <input type="email" autoComplete="username" value={preview.email} readOnly hidden aria-hidden tabIndex={-1} />
                ) : null}
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

      {stage !== "error" ? (
        <section aria-labelledby={`${formId}-steps`} className="px-1">
          <h2 id={`${formId}-steps`} className="sk-h3">
            Your first week
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
