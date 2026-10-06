"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowClockwise, ArrowRight } from "@phosphor-icons/react"
import { InviteFrame, InviteSteps } from "@/components/auth/invite-frame"
import { Button, Fact, FactList, Field, Input, LinkButton, Notice, PasswordInput, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { clearSessionCookies, setSessionCookies } from "@/lib/auth-session"
import { acceptGuardianInvite, claimGuardianInviteAccount, getPublicGuardianInvite, mockSignedInEmail } from "@/lib/data/guardian/guardian-admin-data"
import type { GuardianInvitePreview } from "@/lib/data/guardian/types"
import { MOCK_CREDENTIALS, MOCK_ROLE_STORAGE_KEY, MOCK_USER_EMAIL_STORAGE_KEY } from "@/lib/mock-auth"
import { resolveSessionActor } from "@/lib/supabase/actor"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

type Stage = "loading" | "setup" | "needs-auth" | "accepted" | "error"

/**
 * Where an invited parent or guardian lands (/guardian/claim/<invite id>). Same shape as the coach
 * and athlete claim pages: we look at the invited email, an email with no account sets a password
 * here, an email with an account signs in, and the invite is accepted with that same email.
 */
export default function GuardianClaimPage() {
  const navigate = useNavigate()
  const { inviteId = "" } = useParams()
  const isSupabaseMode = getBackendMode() === "supabase"

  const [stage, setStage] = useState<Stage>("loading")
  const [message, setMessage] = useState("Checking your invite.")
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GuardianInvitePreview | null>(null)
  const [fullName, setFullName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fail = (text: string) => {
      if (cancelled) return
      setStage("error")
      setMessage(text)
    }

    const run = async () => {
      const previewResult = await getPublicGuardianInvite(inviteId)
      if (!previewResult.ok) return fail(previewResult.error.code === "NOT_FOUND" ? "We could not find this invite." : previewResult.error.message)
      const invite = previewResult.data
      if (cancelled) return
      setPreview(invite)
      setFullName(invite.inviteeName ?? "")

      let signedInEmail: string | null = null
      if (isSupabaseMode) {
        const supabase = getBrowserSupabaseClient()
        if (!supabase) return fail("Sign in is not set up on this site yet.")
        const { data } = await supabase.auth.getSession()
        signedInEmail = data.session?.user.email?.trim().toLowerCase() ?? null
      } else {
        signedInEmail = mockSignedInEmail()
      }

      if (invite.status === "revoked") return fail("This invite was cancelled by the club. Ask them for a new one.")
      if (invite.status === "pending" && invite.expired) return fail("This invite has expired. Ask the club for a new one.")

      if (signedInEmail && signedInEmail === invite.email) {
        const accepted = await acceptGuardianInvite(inviteId)
        if (!accepted.ok) return fail(accepted.error.message)
        if (cancelled) return
        setStage("accepted")
        setMessage(`You can now follow ${invite.athleteFirstName}.`)
        return
      }
      if (signedInEmail && isSupabaseMode) return fail(`This invite is for ${invite.email}. Sign out, then sign in with that email to continue.`)
      if (invite.status === "accepted") {
        setStage("needs-auth")
        setMessage("This invite has already been accepted. Sign in to continue.")
        return
      }
      if (invite.hasExistingAccount) {
        setStage("needs-auth")
        setMessage(`This invite is for ${invite.email}. Sign in with that account to continue.`)
        return
      }
      setStage("setup")
      setMessage(`Create your account to follow ${invite.athleteFirstName} at ${invite.clubName}.`)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [inviteId, isSupabaseMode])

  const handleSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!preview || submitting) return
    if (!fullName.trim()) return setError("Add your full name.")
    if (password.length < 8) return setError("Password must be at least 8 characters.")
    if (password !== confirmPassword) return setError("The two passwords do not match.")
    setSubmitting(true)
    setError(null)

    if (!isSupabaseMode) {
      // Demo: there is no real account to create. The invite is accepted and the demo guardian shows the rest.
      const accepted = await acceptGuardianInvite(inviteId, fullName.trim())
      setSubmitting(false)
      if (!accepted.ok) return setError(accepted.error.message)
      setStage("accepted")
      setMessage(`You can now follow ${preview.athleteFirstName}.`)
      return
    }

    const supabase = getBrowserSupabaseClient()
    if (!supabase) {
      setSubmitting(false)
      return setError("Sign in is not set up on this site yet.")
    }
    const claimed = await claimGuardianInviteAccount({ inviteId, email: preview.email, password, displayName: fullName.trim() })
    if (!claimed.ok) {
      setSubmitting(false)
      return setError(claimed.error.message)
    }
    const signIn = await supabase.auth.signInWithPassword({ email: preview.email, password })
    if (signIn.error || !signIn.data.session) {
      setSubmitting(false)
      return setError("Your account was created, but we could not sign you in. Sign in from the sign in page, then open this invite link again.")
    }
    const accepted = await acceptGuardianInvite(inviteId)
    if (!accepted.ok) {
      setSubmitting(false)
      return setError(accepted.error.message)
    }
    const actor = await resolveSessionActor(supabase, signIn.data.session)
    setSubmitting(false)
    if (actor) setSessionCookies(actor.role, actor.tenantId ?? "", actor.userEmail ?? preview.email)
    navigate("/guardian/home", { replace: true })
  }

  const openHome = () => {
    if (!isSupabaseMode) {
      // Demo: look around as the demo guardian.
      const demo = MOCK_CREDENTIALS.guardian
      clearSessionCookies()
      window.localStorage.setItem(MOCK_ROLE_STORAGE_KEY, demo.role)
      window.localStorage.setItem(MOCK_USER_EMAIL_STORAGE_KEY, mockSignedInEmail() === preview?.email ? preview.email : demo.email)
      setSessionCookies("guardian", demo.tenantId, mockSignedInEmail() === preview?.email && preview ? preview.email : demo.email)
    }
    navigate("/guardian/home")
  }

  const title = stage === "accepted" ? "You are in" : stage === "error" ? "This invite needs a second look" : preview ? `Follow ${preview.athleteFirstName} at ${preview.clubName}` : "Your invite"

  const steps = [
    { title: "We check the invited email", body: "If it already has an account you sign in. If not, you set a password here." },
    { title: "You accept with that same email", body: "Your access is tied to the exact email the club sent this invite to." },
    { title: "You see how they are doing", body: "Their plan, results, team news and calendar. You read, the club decides who has access." },
  ]

  return (
    <InviteFrame>
      <ScreenHeader title={title} lede={<span aria-live="polite">{stage === "error" ? "Something stopped this invite from opening. Nothing has been changed." : message}</span>} />

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
            <Fact label="Club">{preview.clubName}</Fact>
            <Fact label="Athlete">{preview.athleteFirstName}</Fact>
            <Fact label="Joining as">{`Parent or guardian (${preview.relationship.toLowerCase()})`}</Fact>
          </FactList>
        </Section>
      ) : null}

      {stage === "error" ? (
        <>
          <Notice tone="error">
            {error ?? message}
            <span className="mt-0.5 block font-normal">Open the newest invite link from your email, or ask the coach who invited you.</span>
          </Notice>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              <ArrowClockwise className="size-5" weight="bold" aria-hidden />
              Try again
            </Button>
            <LinkButton to="/login" variant="quiet">
              Back to sign in
            </LinkButton>
          </div>
        </>
      ) : null}

      {stage === "needs-auth" ? (
        <Section title="Sign in to continue" hint="This email already has a SKTR Coach account. Sign in with it and the invite attaches itself.">
          <div className="pt-3">
            <LinkButton to={`/login?redirect=${encodeURIComponent(`/guardian/claim/${inviteId}`)}`} variant="primary" size="lg" block>
              Sign in to continue
              <ArrowRight className="size-5" weight="bold" aria-hidden />
            </LinkButton>
          </div>
        </Section>
      ) : null}

      {stage === "accepted" && preview ? (
        <>
          <Notice tone="success">{`You now follow ${preview.athleteFirstName} at ${preview.clubName}.`}</Notice>
          {!isSupabaseMode ? <p className="text-sm text-sk-mute">Demo: no real account was made. Open the demo guardian to look around.</p> : null}
          <div>
            <Button variant="primary" onClick={openHome}>
              Open your home
              <ArrowRight className="size-5" weight="bold" aria-hidden />
            </Button>
          </div>
        </>
      ) : null}

      {stage === "setup" ? (
        <Section title="Create your account" hint="There is no account for this email yet, so this creates one.">
          <form className="flex flex-col gap-4 pt-3" onSubmit={handleSetup} noValidate>
            <Field label="Full name">
              <Input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <PasswordInput autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Field label="Confirm password">
              <PasswordInput autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" variant="primary" size="lg" disabled={submitting} className="sm:flex-1">
                {submitting ? "Saving..." : "Create account and continue"}
              </Button>
              <LinkButton to="/login" variant="quiet" size="lg">
                Back to sign in
              </LinkButton>
            </div>
          </form>
        </Section>
      ) : null}

      {stage !== "setup" && stage !== "accepted" ? <InviteSteps title="How this works" steps={steps} /> : null}
    </InviteFrame>
  )
}
