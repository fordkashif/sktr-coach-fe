"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowClockwise, ArrowRight } from "@phosphor-icons/react"
import { InviteFrame, InviteSteps } from "@/components/auth/invite-frame"
import { Button, Fact, FactList, Field, Input, LinkButton, Notice, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
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
            setMessage(invitePreview.role === "club-admin" ? "Create your account to claim this invite and open your club." : "Complete your coach setup to claim this invite and enter the workspace.")
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
        setMessage(invitePreview.role === "club-admin" ? "Confirm your name before opening your club." : "Complete your coach setup before entering the workspace.")
        return
      }

      if (!cancelled) {
        setStage("accepted")
        setMessage(invitePreview.role === "club-admin" ? "Invite accepted. You are a club admin now." : "Invite accepted. Your coach workspace is ready.")
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

  // A club admin lands on the club dashboard, a coach on theirs.
  const isAdminInvite = preview?.role === "club-admin"
  const homeAfterJoining = isAdminInvite ? "/club-admin/dashboard" : "/coach/dashboard"

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

    navigate(homeAfterJoining, { replace: true })
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

    navigate(homeAfterJoining, { replace: true })
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
          : "Your invite"

  const steps = [
    {
      title: "We check the invited email",
      body: "If it already has an account you sign in. If not, you set a password here.",
    },
    {
      title: "You accept with that same email",
      body: isAdminInvite ? "Your access to the club is tied to the exact email this invite was sent to." : "Your team access is tied to the exact email this invite was sent to.",
    },
    {
      title: "You land on your dashboard",
      body: isAdminInvite ? "From there you manage the club's people, teams and billing." : "It walks you through your roster, your first plan and your first test week.",
    },
  ]

  return (
    <InviteFrame>
      <ScreenHeader
        title={title}
        lede={<span aria-live="polite">{stage === "error" ? "Something stopped this invite from opening. Nothing has been changed on your account." : message}</span>}
      />

      {stage === "loading" ? (
        <Section title="Your invite">
          <SkeletonRows rows={3} label="Checking invite" />
        </Section>
      ) : preview ? (
        <Section title="Your invite">
          <FactList>
            <Fact label="Invited email">
              <span className="break-all">{preview.email}</span>
            </Fact>
            <Fact label="Club">{preview.organizationName}</Fact>
            <Fact label="Joining as">{isAdminInvite ? "Club admin" : "Coach"}</Fact>
            <Fact label="Team access">{preview.teamName ?? (isAdminInvite ? "Every team, as club admin" : "General coach access")}</Fact>
          </FactList>
        </Section>
      ) : null}

      {stage === "error" ? (
        <>
          <Notice tone="error">
            {error ?? message}
            <span className="mt-0.5 block font-normal">Open the newest invite link from your email, or sign in with the exact email the invite was sent to.</span>
          </Notice>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              <ArrowClockwise className="size-5" weight="bold" aria-hidden />
              Try again
            </Button>
            <LinkButton to="/login" variant="quiet">
              Back to login
            </LinkButton>
          </div>
        </>
      ) : null}

      {stage === "needs-auth" ? (
        <Section title="Sign in to join" hint="This email already has a SKTR Coach account. Sign in with it and the invite attaches itself.">
          <div className="pt-3">
            <LinkButton to={`/login?redirect=${encodeURIComponent(`/invite/coach/${inviteId}`)}`} variant="primary" size="lg" block>
              Sign in to continue
              <ArrowRight className="size-5" weight="bold" aria-hidden />
            </LinkButton>
          </div>
        </Section>
      ) : null}

      {stage === "accepted" ? (
        <>
          <Notice tone="success">
            {isAdminInvite && preview ? `You are now a club admin of ${preview.organizationName}.` : inviteSummary ? `You now coach at ${inviteSummary}.` : "Your invite is accepted."}
          </Notice>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => navigate(homeAfterJoining)}>
              {isAdminInvite ? "Open club dashboard" : "Open coach dashboard"}
              <ArrowRight className="size-5" weight="bold" aria-hidden />
            </Button>
            <LinkButton to={isAdminInvite ? "/club-admin/teams" : "/coach/teams"}>Open teams</LinkButton>
          </div>
        </>
      ) : null}

      {stage === "setup" ? (
        <Section
          title={requiresPassword ? "Create your account" : "Finish your profile"}
          hint={requiresPassword ? "There is no account for this email yet, so this creates one." : "Your account is already linked. Confirm your name and you are done."}
        >
          <form className="flex flex-col gap-4 pt-3" onSubmit={handleSetupSubmit} noValidate>
            <Field label="Full name">
              <Input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </Field>
            {requiresPassword ? (
              <>
                <Field label="Password" hint="At least 8 characters.">
                  <Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </Field>
                <Field label="Confirm password">
                  <Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                </Field>
              </>
            ) : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" variant="primary" size="lg" disabled={submitting} className="sm:flex-1">
                {submitting ? "Saving..." : requiresPassword ? "Create account and join" : "Finish setup"}
              </Button>
              <LinkButton to="/login" variant="quiet" size="lg">
                Back to login
              </LinkButton>
            </div>
          </form>
        </Section>
      ) : null}

      {stage !== "setup" && stage !== "accepted" ? <InviteSteps title="How joining works" steps={steps} /> : null}
    </InviteFrame>
  )
}
