"use client"

import { ArrowRight } from "@phosphor-icons/react"
import { useCallback, useEffect, useState, type FormEvent } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { InviteFrame, InviteSteps } from "@/components/auth/invite-frame"
import { Button, Fact, FactList, Field, Input, LinkButton, Notice, ScreenHeader, Section, Segmented, SkeletonRows } from "@/components/sk"
import { setSessionCookies } from "@/lib/auth-session"
import { completeCurrentAthleteOnboarding, getCurrentAthleteOnboardingState } from "@/lib/data/athlete/invite-claim-data"
import { eventGroupLabel } from "@/lib/data/athlete/profile-data"
import { getPublicJoinCode, joinLinkPath, joinProblem, joinTeamWithCode, normalizeJoinCode, type JoinOutcome, type PublicJoinCode } from "@/lib/data/coach/join-code-data"
import { mockSessionIdentity } from "@/lib/data/coach/roster-mock"
import { resolveSessionActor } from "@/lib/supabase/actor"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

type Stage =
  | { kind: "loading" }
  | { kind: "problem"; title: string; body: string; canSwitchAccount?: boolean }
  /** Signed out: explain, then create an account or sign in. */
  | { kind: "signed-out" }
  | { kind: "check-email"; email: string }
  /** Signed in: one press joins. */
  | { kind: "ready"; email: string | null }
  | { kind: "setup"; teamName: string }
  | { kind: "done"; teamName: string; already: boolean }

const STEPS = [
  { title: "Check in before you train", body: "A quick wellness check each day tells your coach how you feel." },
  { title: "Open today's session", body: "Your plan shows what to do today. Log each set as you go." },
  { title: "Watch your numbers move", body: "Test weeks and personal bests build up under Progress." },
]

function expiryText(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
}

/**
 * The page a team join code (the QR code a coach shows at practice) opens. Signed out it says what
 * the code is and leads to an account; signed in it joins the team with one press. A wrong code
 * shows nothing about any team.
 */
export default function TeamJoinCodePage() {
  const navigate = useNavigate()
  const { code: rawCode = "" } = useParams()
  const code = normalizeJoinCode(rawCode)
  const isSupabaseMode = getBackendMode() === "supabase"
  const selfPath = joinLinkPath(code || rawCode)

  const [stage, setStage] = useState<Stage>({ kind: "loading" })
  const [preview, setPreview] = useState<Extract<PublicJoinCode, { status: "active" }> | null>(null)
  const [mode, setMode] = useState<"new" | "existing">("new")
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    const result = await getPublicJoinCode(code || rawCode)
    if (!result.ok) {
      setStage({ kind: "problem", title: "We could not check this join code", body: "Check your connection and try again." })
      return
    }
    if (result.data.status !== "active") {
      setPreview(null)
      setStage({ kind: "problem", ...joinProblem(result.data.status) })
      return
    }
    setPreview(result.data)

    if (!isSupabaseMode) {
      const identity = mockSessionIdentity()
      setStage(identity.role ? { kind: "ready", email: identity.email } : { kind: "signed-out" })
      return
    }
    const supabase = getBrowserSupabaseClient()
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
    setStage(data.session ? { kind: "ready", email: data.session.user.email ?? null } : { kind: "signed-out" })
  }, [code, isSupabaseMode, rawCode])

  useEffect(() => {
    void check()
  }, [check])

  /** After a join: record the session as an athlete and see whether their name still needs confirming. */
  const finish = async (outcome: Extract<JoinOutcome, { status: "joined" | "already_member" }>) => {
    if (!isSupabaseMode) {
      setStage({ kind: "done", teamName: outcome.teamName, already: outcome.status === "already_member" })
      return
    }
    const supabase = getBrowserSupabaseClient()
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
    if (!supabase || !data.session) {
      setStage({ kind: "problem", title: "You are on the team, but your session ended", body: "Sign in again to open your training." })
      return
    }
    const actor = await resolveSessionActor(supabase, data.session)
    if (!actor || actor.role !== "athlete") {
      setStage({ kind: "problem", title: "You are on the team, but your session did not open", body: "Sign in again to open your training." })
      return
    }
    // The profile did not exist when the app first looked at this session, so record the role now.
    setSessionCookies(actor.role, actor.tenantId ?? "", data.session.user.email ?? data.session.user.id)

    const onboarding = await getCurrentAthleteOnboardingState()
    if (onboarding.ok && (!onboarding.data.displayName || !onboarding.data.onboardingCompletedAt)) {
      setFullName(onboarding.data.displayName || fullName)
      setStage({ kind: "setup", teamName: outcome.teamName })
      return
    }
    setStage({ kind: "done", teamName: outcome.teamName, already: outcome.status === "already_member" })
  }

  const join = async (options?: { newAthleteName?: string }) => {
    setBusy(true)
    setError(null)
    const result = await joinTeamWithCode(code || rawCode, options)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (result.data.status === "joined" || result.data.status === "already_member") {
      await finish(result.data)
      return
    }
    const problem = joinProblem(result.data.status)
    setStage({
      kind: "problem",
      ...problem,
      canSwitchAccount: ["not_athlete", "wrong_club", "other_team", "has_other_access", "unconfirmed_email", "inactive_athlete"].includes(result.data.status),
    })
  }

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!fullName.trim()) return setError("Enter your full name.")
    if (!isSupabaseMode) {
      // The demo has no accounts: add a demo athlete with this name straight away.
      await join({ newAthleteName: fullName })
      return
    }
    if (password.length < 8) return setError("Use a password of at least 8 characters.")
    const supabase = getBrowserSupabaseClient()
    if (!supabase) return setError("Sign up is not available right now.")
    setBusy(true)
    const cleanEmail = email.trim().toLowerCase()
    const result = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      // Only a display name. The club, the team and the role come from the join code on the server.
      options: { data: { display_name: fullName.trim() }, emailRedirectTo: new URL(selfPath, window.location.origin).toString() },
    })
    setBusy(false)
    if (result.error) {
      setError(/registered|exists/i.test(result.error.message) ? "This email already has an account. Choose \"I have an account\" and sign in." : result.error.message)
      return
    }
    // With a session the email is already confirmed (or confirmation is switched off): join now.
    if (result.data.session) {
      setStage({ kind: "ready", email: cleanEmail })
      await join()
      return
    }
    setStage({ kind: "check-email", email: cleanEmail })
  }

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const supabase = getBrowserSupabaseClient()
    if (!supabase) return setError("Sign in is not available right now.")
    setBusy(true)
    const result = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setBusy(false)
    if (result.error || !result.data.session) {
      setError(/confirm/i.test(result.error?.message ?? "") ? "Confirm your email first: open the email we sent you and tap the link in it." : "That email and password do not match an account.")
      return
    }
    setStage({ kind: "ready", email: result.data.session.user.email ?? null })
    await join()
  }

  const signOutAndRetry = async () => {
    if (isSupabaseMode) await getBrowserSupabaseClient()?.auth.signOut()
    setError(null)
    setStage({ kind: "loading" })
    if (isSupabaseMode) void check()
    else navigate(`/login?redirect=${encodeURIComponent(selfPath)}`)
  }

  const completeSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (stage.kind !== "setup") return
    if (!fullName.trim()) return setError("Enter your full name.")
    setBusy(true)
    setError(null)
    const result = await completeCurrentAthleteOnboarding({ displayName: fullName.trim() })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    navigate("/athlete/home", { replace: true })
  }

  const title =
    stage.kind === "done"
      ? "You are in"
      : stage.kind === "setup"
        ? `Welcome to ${stage.teamName}`
        : stage.kind === "problem"
          ? stage.title
          : stage.kind === "check-email"
            ? "Check your email"
            : preview
              ? `Join ${preview.teamName}`
              : "Join your team"

  const lede =
    stage.kind === "loading"
      ? "Checking the join code..."
      : stage.kind === "problem"
        ? stage.body
        : stage.kind === "check-email"
          ? `We sent a link to ${stage.email}. Open it on this phone to confirm your email, and you come straight back here to join.`
          : stage.kind === "done"
            ? stage.already
              ? `You were already on ${stage.teamName}. Nothing changed.`
              : `You now train with ${stage.teamName}.`
            : stage.kind === "setup"
              ? "You are on the team. Confirm your name to finish."
              : preview
                ? `Your coach shared this code so the squad can join ${preview.teamName} at ${preview.organizationName}. Joining makes you an athlete on this team, nothing else.`
                : ""

  return (
    <InviteFrame>
      <ScreenHeader title={title} lede={<span aria-live="polite">{lede}</span>} />

      {stage.kind === "loading" ? (
        <Section title="The team">
          <SkeletonRows rows={3} label="Checking the join code" />
        </Section>
      ) : null}

      {preview && (stage.kind === "signed-out" || stage.kind === "ready" || stage.kind === "check-email") ? (
        <Section title="The team">
          <FactList>
            <Fact label="Team">{preview.teamName}</Fact>
            <Fact label="Club">{preview.organizationName}</Fact>
            {preview.eventGroup ? <Fact label="Event group">{eventGroupLabel(preview.eventGroup)}</Fact> : null}
            {expiryText(preview.expiresAt) ? <Fact label="Code works until">{expiryText(preview.expiresAt)}</Fact> : null}
          </FactList>
        </Section>
      ) : null}

      {stage.kind === "problem" ? (
        <div className="flex flex-wrap gap-2">
          {stage.canSwitchAccount ? (
            <Button variant="primary" onClick={() => void signOutAndRetry()}>
              Use another account
            </Button>
          ) : (
            <Button variant="primary" onClick={() => window.location.reload()}>
              Try again
            </Button>
          )}
          <LinkButton to="/login" variant="quiet">
            Back to sign in
          </LinkButton>
        </div>
      ) : null}

      {stage.kind === "signed-out" ? (
        <Section title="Your account" hint={isSupabaseMode ? "You need your own SKTR Coach account to join. It takes a minute." : "This is the demo, so there is no account to create. Enter a name and you are added to the team."}>
          <div className="flex flex-col gap-4 pt-3">
            {isSupabaseMode ? (
              <Segmented
                label="New or existing account"
                value={mode}
                onChange={(next) => {
                  setMode(next)
                  setError(null)
                }}
                options={[
                  { value: "new", label: "I am new" },
                  { value: "existing", label: "I have an account" },
                ]}
              />
            ) : null}
            {mode === "new" ? (
              <form className="flex flex-col gap-4" onSubmit={(event) => void createAccount(event)} noValidate>
                <Field label="Full name">
                  <Input autoComplete="name" placeholder="First and last name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
                </Field>
                {isSupabaseMode ? (
                  <>
                    <Field label="Email" hint="We send one email to confirm it is yours.">
                      <Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                    </Field>
                    <Field label="Password" hint="At least 8 characters.">
                      <Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                    </Field>
                  </>
                ) : null}
                {error ? <Notice tone="error">{error}</Notice> : null}
                <Button type="submit" variant="primary" size="lg" block disabled={busy}>
                  {busy ? "Working..." : isSupabaseMode ? "Create account" : "Join the team"}
                  <ArrowRight className="size-5" weight="bold" aria-hidden />
                </Button>
              </form>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={(event) => void signIn(event)} noValidate>
                <Field label="Email">
                  <Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                </Field>
                <Field label="Password">
                  <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </Field>
                {error ? <Notice tone="error">{error}</Notice> : null}
                <Button type="submit" variant="primary" size="lg" block disabled={busy}>
                  {busy ? "Signing in..." : "Sign in and join"}
                  <ArrowRight className="size-5" weight="bold" aria-hidden />
                </Button>
                <LinkButton to="/reset-password" variant="quiet">
                  Forgot your password
                </LinkButton>
              </form>
            )}
          </div>
        </Section>
      ) : null}

      {stage.kind === "check-email" ? (
        <Notice>
          Nothing in your inbox after a minute? Look in spam, then come back to this page and choose "I have an account".
        </Notice>
      ) : null}

      {stage.kind === "ready" && preview ? (
        <Section title="Ready to join" hint={stage.email ? `Signed in as ${stage.email}.` : undefined}>
          <div className="flex flex-col gap-3 pt-3">
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button variant="primary" size="lg" block disabled={busy} onClick={() => void join()}>
              {busy ? "Joining..." : `Join ${preview.teamName}`}
              <ArrowRight className="size-5" weight="bold" aria-hidden />
            </Button>
            <Button variant="quiet" onClick={() => void signOutAndRetry()}>
              Not you? Use another account
            </Button>
          </div>
        </Section>
      ) : null}

      {stage.kind === "setup" ? (
        <Section title="Finish your profile" hint="Your coach sees this name on the roster.">
          <form className="flex flex-col gap-4 pt-3" onSubmit={(event) => void completeSetup(event)} noValidate>
            <Field label="Full name">
              <Input autoComplete="name" placeholder="First and last name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {busy ? "Saving..." : "Finish and open today"}
            </Button>
          </form>
        </Section>
      ) : null}

      {stage.kind === "done" ? (
        <>
          <Notice tone="success">{stage.already ? `You are on ${stage.teamName}.` : `Welcome to ${stage.teamName}. Your coach has been told you joined.`}</Notice>
          <div className="flex flex-wrap gap-2">
            <LinkButton to={isSupabaseMode || mockSessionIdentity().role === "athlete" ? "/athlete/home" : "/login"} variant="primary">
              {isSupabaseMode || mockSessionIdentity().role === "athlete" ? "Open today" : "Go to sign in"}
              <ArrowRight className="size-5" weight="bold" aria-hidden />
            </LinkButton>
          </div>
        </>
      ) : null}

      {stage.kind === "signed-out" || stage.kind === "ready" || stage.kind === "done" ? <InviteSteps title="Your first week" steps={STEPS} /> : null}
    </InviteFrame>
  )
}
