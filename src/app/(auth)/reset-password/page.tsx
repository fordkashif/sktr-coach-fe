"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ArrowLeft, Copy } from "@phosphor-icons/react"
import { Button, Fact, FactList, Field, Input, LinkButton, Notice, PasswordInput, ScreenHeader, Section, SkeletonRows } from "@/components/sk"
import { AuthSplit } from "@/layouts/auth-layout"
import { describePasswordResetError } from "@/lib/auth-errors"
import { bootstrapPasswordReset, completePasswordReset, requestPasswordReset } from "@/lib/auth-recovery"

type Stage = "request" | "update" | "success"
type BootstrapResult = Awaited<ReturnType<typeof bootstrapPasswordReset>>

const MIN_PASSWORD_LENGTH = 8

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [stage, setStage] = useState<Stage>("request")
  const [email, setEmail] = useState("")
  const [sentTo, setSentTo] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [fieldError, setFieldError] = useState<{ password?: string; confirm?: string }>({})
  const [localResetLink, setLocalResetLink] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "failed">("idle")
  const bootstrapRun = useRef<{ key: string; promise: Promise<BootstrapResult> } | null>(null)
  const submitLock = useRef(false)

  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type")
  const mockToken = searchParams.get("mock_token")
  const hasLinkToken = Boolean(code || tokenHash || mockToken)
  const [checkingLink, setCheckingLink] = useState(hasLinkToken)
  const absoluteLocalResetLink = useMemo(() => {
    if (!localResetLink || typeof window === "undefined") return null
    return new URL(localResetLink, window.location.origin).toString()
  }, [localResetLink])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!code && !tokenHash && !mockToken) return

      setLoading(true)
      setCheckingLink(true)
      // A reset code can only be exchanged once. Reuse the in-flight check if this effect runs twice for the same link.
      const key = `${code ?? ""}|${tokenHash ?? ""}|${mockToken ?? ""}|${type ?? ""}`
      if (!bootstrapRun.current || bootstrapRun.current.key !== key) {
        bootstrapRun.current = {
          key,
          promise: bootstrapPasswordReset({
            code,
            tokenHash: tokenHash ?? mockToken,
            type,
          }).catch((caught): BootstrapResult => ({
            ok: false as const,
            message: caught instanceof Error ? caught.message : "Failed to fetch",
          })),
        }
      }
      const result = await bootstrapRun.current.promise
      if (cancelled) return

      setLoading(false)
      setCheckingLink(false)
      if (!result.ok) {
        setError(describePasswordResetError(result.message))
        setStage("request")
        return
      }

      setEmail(result.email)
      setError("")
      setMessage("")
      setLocalResetLink(null)
      setStage("update")
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete("code")
      cleanUrl.searchParams.delete("token_hash")
      cleanUrl.searchParams.delete("type")
      window.history.replaceState({}, document.title, cleanUrl.toString())
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [code, mockToken, tokenHash, type])

  const handleRequestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitLock.current) return
    if (!email.trim()) {
      setError("Enter the email you sign in with.")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("That does not look like an email address. Check for typos.")
      return
    }

    submitLock.current = true
    setLoading(true)
    setError("")
    let result: Awaited<ReturnType<typeof requestPasswordReset>>
    try {
      result = await requestPasswordReset(email)
    } catch (caught) {
      result = { ok: false as const, message: caught instanceof Error ? caught.message : "Failed to fetch" }
    }
    submitLock.current = false
    setLoading(false)

    if (!result.ok) {
      setError(describePasswordResetError(result.message))
      return
    }

    setMessage(result.message)
    setSentTo(email.trim().toLowerCase())
    if (result.actionLink) {
      setLocalResetLink(result.actionLink)
      setCopyStatus("idle")
      setStage("success")
      return
    }

    setLocalResetLink(null)
    setCopyStatus("idle")
    setStage("success")
  }

  const handleCopyLocalResetLink = async () => {
    if (!absoluteLocalResetLink) return
    try {
      await navigator.clipboard.writeText(absoluteLocalResetLink)
      setCopyStatus("done")
    } catch {
      setCopyStatus("failed")
    }
  }

  const handleUpdateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitLock.current) return
    const nextFieldError: { password?: string; confirm?: string } = {}
    if (password.trim().length < MIN_PASSWORD_LENGTH) {
      nextFieldError.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    }
    if (password !== confirmPassword) {
      nextFieldError.confirm = "Passwords do not match."
    }
    setFieldError(nextFieldError)
    if (nextFieldError.password || nextFieldError.confirm) {
      setError("")
      document.getElementById(nextFieldError.password ? "reset-new-password" : "reset-confirm-password")?.focus()
      return
    }

    submitLock.current = true
    setLoading(true)
    setError("")
    let result: Awaited<ReturnType<typeof completePasswordReset>>
    try {
      result = await completePasswordReset({ password, token: mockToken })
    } catch (caught) {
      result = { ok: false as const, message: caught instanceof Error ? caught.message : "Failed to fetch" }
    }
    submitLock.current = false
    setLoading(false)

    if (!result.ok) {
      setError(describePasswordResetError(result.message))
      return
    }

    setStage("success")
    setMessage("Password updated.")
    // Without an app role there is no workspace to open, so send them to sign in instead of a guarded page.
    navigate(result.actorRole ? result.redirectTo : "/login", { replace: true })
  }

  const useDifferentEmail = () => {
    setStage("request")
    setMessage("")
    setError("")
    setLocalResetLink(null)
  }

  const showSent = stage === "success" && !checkingLink
  const title = checkingLink
    ? "Checking your link"
    : stage === "update"
      ? "Set a new password"
      : showSent
        ? absoluteLocalResetLink
          ? "Your reset link is ready"
          : message === "Password updated."
            ? "Password updated"
            : "Check your email"
        : "Reset your password"

  const errorNotice = error ? <Notice tone="error">{error}</Notice> : null

  const backToLogin = (
    <LinkButton to="/login" variant="quiet">
      <ArrowLeft className="size-5" weight="bold" aria-hidden />
      Back to login
    </LinkButton>
  )

  const lede = checkingLink
    ? "One moment while we confirm this reset link."
    : stage === "update"
      ? "Choose a new password for this account. You will be signed in straight after."
      : showSent
        ? absoluteLocalResetLink
          ? "This preview does not send email, so open the link below to carry on."
          : message === "Password updated."
            ? "Taking you to your workspace."
            : `If ${sentTo || "that email"} has an account, a reset link is on its way. It can take a couple of minutes, so check your spam folder too.`
        : "Enter the email you sign in with and we will send you a link to choose a new password."

  return (
    <AuthSplit headline={["Back on the track", "in a minute."]} body="One sign-in covers coaches, athletes and club admins, so this works for any SKTR Coach account.">
      <ScreenHeader title={title} lede={<span aria-live="polite">{lede}</span>} />

      {checkingLink ? (
        <SkeletonRows rows={2} label="Checking reset link" />
      ) : stage === "update" ? (
        <form className="flex flex-col gap-4" onSubmit={handleUpdateSubmit} noValidate>
          <Field id="reset-account-email" label="Account">
            <Input type="email" name="email" autoComplete="username" value={email} readOnly />
          </Field>
          <Field id="reset-new-password" label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} error={fieldError.password}>
            <PasswordInput
              autoComplete="new-password"
              shown={showPassword}
              onShownChange={setShowPassword}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setFieldError((previous) => ({ ...previous, password: undefined }))
              }}
            />
          </Field>
          <Field id="reset-confirm-password" label="Confirm password" error={fieldError.confirm}>
            <PasswordInput
              autoComplete="new-password"
              shown={showPassword}
              onShownChange={setShowPassword}
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value)
                setFieldError((previous) => ({ ...previous, confirm: undefined }))
              }}
            />
          </Field>
          {errorNotice}
          <Button type="submit" variant="primary" size="lg" block disabled={loading}>
              {loading ? "Saving..." : "Update password"}
          </Button>
          {backToLogin}
        </form>
      ) : showSent ? (
        <>
          {absoluteLocalResetLink ? (
            <Section title="Reset link">
              <FactList>
                <Fact label="Link" stack>
                  <span className="break-all" data-testid="local-reset-link">
                    {absoluteLocalResetLink}
                  </span>
                </Fact>
              </FactList>
              <div className="flex flex-wrap gap-2 pt-4">
                <LinkButton to={localResetLink ?? "/reset-password"} variant="primary">
                  Open link
                </LinkButton>
                <Button onClick={() => void handleCopyLocalResetLink()}>
                  <Copy className="size-5" weight="bold" aria-hidden />
                  {copyStatus === "done" ? "Copied" : "Copy link"}
                </Button>
              </div>
              {copyStatus === "failed" ? <p className="sk-field-error mt-2">Copying did not work here. Open the link instead.</p> : null}
            </Section>
          ) : message === "Password updated." ? (
            <Notice tone="success">Password updated.</Notice>
          ) : (
            <Notice tone="success">The link works once and opens this page so you can choose a new password. Open it in this same browser.</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={useDifferentEmail}>{absoluteLocalResetLink ? "Use a different email" : "Send again or change email"}</Button>
            {backToLogin}
          </div>
        </>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleRequestSubmit} noValidate>
          {errorNotice}
          <Field id="reset-request-email" label="Email">
            <Input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@yourclub.com"
              required
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" block disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
          </Button>
          {backToLogin}
        </form>
      )}
    </AuthSplit>
  )
}
