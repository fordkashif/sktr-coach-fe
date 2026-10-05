"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowLeft, CheckCircle, CircleNotch, Copy, EnvelopeSimple, Eye, EyeSlash, WarningCircle } from "@phosphor-icons/react"
import { AUTH_PHOTOS, AuthSplit } from "@/layouts/auth-layout"
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

  const errorAlert = error ? (
    <div className="flex items-start gap-3 rounded-2xl bg-sk-coral-tint p-4 text-sm" role="alert">
      <WarningCircle className="mt-0.5 size-5 shrink-0 text-[#b32a0c]" weight="fill" aria-hidden />
      <p className="min-w-0 font-semibold leading-relaxed text-[#b32a0c]">{error}</p>
    </div>
  ) : null

  const backToLogin = (
    <Link to="/login" className="sk-btn sk-btn-ghost">
      <ArrowLeft className="size-5" weight="bold" aria-hidden />
      Back to login
    </Link>
  )

  return (
    <AuthSplit
      photo={AUTH_PHOTOS.blocks}
      headline="Back on the track in a minute."
      body="One sign-in covers coaches, athletes and club admins, so this works for any SKTR Coach account."
    >
      <div className="space-y-7">
        <header className="space-y-3">
          <h1 className="sk-title">{title}</h1>
          <p className="sk-lede" aria-live="polite">
            {checkingLink
              ? "One moment while we confirm this reset link."
              : stage === "update"
                ? "Choose a new password for this account. You will be signed in straight after."
                : showSent
                  ? absoluteLocalResetLink
                    ? "This preview does not send email, so open the link below to carry on."
                    : message === "Password updated."
                      ? "Taking you to your workspace."
                      : `If ${sentTo || "that email"} has an account, a reset link is on its way. It can take a couple of minutes, so check your spam folder too.`
                  : "Enter the email you sign in with and we will send you a link to choose a new password."}
          </p>
        </header>

        {checkingLink ? (
          <p className="flex items-center gap-2.5 text-sm font-semibold text-sk-ink-2" role="status">
            <CircleNotch className="size-5 animate-spin text-sk-blue" weight="bold" aria-hidden />
            Checking reset link...
          </p>
        ) : stage === "update" ? (
          <form className="grid gap-5" onSubmit={handleUpdateSubmit} noValidate>
            <div>
              <label htmlFor="reset-account-email" className="mb-1.5 block text-sm font-semibold text-sk-ink-2">
                Account
              </label>
              <input
                id="reset-account-email"
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                readOnly
                className="sk-field bg-sk-canvas text-base text-sk-ink-2 sm:text-[0.95rem]"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label htmlFor="reset-new-password" className="text-sm font-semibold text-sk-ink-2">
                  New password
                </label>
                <button
                  type="button"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((previous) => !previous)}
                  className="inline-flex items-center gap-1.5 rounded text-sm font-bold text-sk-blue hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue"
                >
                  {showPassword ? <EyeSlash className="size-4" weight="bold" aria-hidden /> : <Eye className="size-4" weight="bold" aria-hidden />}
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="reset-new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                aria-invalid={fieldError.password ? "true" : undefined}
                aria-describedby="reset-new-password-note"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setFieldError((previous) => ({ ...previous, password: undefined }))
                }}
                className="sk-field text-base sm:text-[0.95rem]"
              />
              <p
                id="reset-new-password-note"
                className={fieldError.password ? "mt-1.5 text-sm font-semibold text-[#b32a0c]" : "mt-1.5 text-sm text-sk-mute"}
              >
                {fieldError.password ?? `At least ${MIN_PASSWORD_LENGTH} characters.`}
              </p>
            </div>
            <div>
              <label htmlFor="reset-confirm-password" className="mb-1.5 block text-sm font-semibold text-sk-ink-2">
                Confirm password
              </label>
              <input
                id="reset-confirm-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                aria-invalid={fieldError.confirm ? "true" : undefined}
                aria-describedby={fieldError.confirm ? "reset-confirm-password-error" : undefined}
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  setFieldError((previous) => ({ ...previous, confirm: undefined }))
                }}
                className="sk-field text-base sm:text-[0.95rem]"
              />
              {fieldError.confirm ? (
                <p id="reset-confirm-password-error" className="mt-1.5 text-sm font-semibold text-[#b32a0c]">
                  {fieldError.confirm}
                </p>
              ) : null}
            </div>
            {errorAlert}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={loading} className="sk-btn sk-btn-primary">
                {loading ? "Saving..." : "Update password"}
              </button>
              {backToLogin}
            </div>
          </form>
        ) : showSent ? (
          <div className="space-y-5">
            {absoluteLocalResetLink ? (
              <section className="sk-well space-y-3" aria-label="Reset link">
                <p className="break-all rounded-xl bg-white px-3 py-2.5 text-sm text-sk-ink-2" data-testid="local-reset-link">
                  {absoluteLocalResetLink}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link to={localResetLink ?? "/reset-password"} className="sk-btn sk-btn-primary">
                    Open link
                  </Link>
                  <button type="button" onClick={handleCopyLocalResetLink} className="sk-btn sk-btn-quiet">
                    <Copy className="size-5" weight="bold" aria-hidden />
                    {copyStatus === "done" ? "Copied" : "Copy link"}
                  </button>
                </div>
                {copyStatus === "failed" ? (
                  <p className="text-sm font-semibold text-[#b32a0c]">Copying did not work here. Open the link instead.</p>
                ) : null}
              </section>
            ) : message === "Password updated." ? (
              <p className="flex items-center gap-2 text-sm font-bold text-[#07673f]" role="status">
                <CheckCircle className="size-5" weight="fill" aria-hidden />
                Password updated.
              </p>
            ) : (
              <p className="flex items-start gap-3 rounded-2xl bg-sk-green-tint p-4 text-sm font-semibold leading-relaxed text-[#07673f]" role="status">
                <EnvelopeSimple className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden />
                The link works once and opens this page so you can choose a new password. Open it in this same browser.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="sk-btn sk-btn-quiet" onClick={useDifferentEmail}>
                {absoluteLocalResetLink ? "Use a different email" : "Send again or change email"}
              </button>
              {backToLogin}
            </div>
          </div>
        ) : (
          <form className="grid gap-5" onSubmit={handleRequestSubmit} noValidate>
            {errorAlert}
            <div>
              <label htmlFor="reset-request-email" className="mb-1.5 block text-sm font-semibold text-sk-ink-2">
                Email
              </label>
              <input
                id="reset-request-email"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@yourclub.com"
                className="sk-field text-base sm:text-[0.95rem]"
                required
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={loading} className="sk-btn sk-btn-primary">
                {loading ? "Sending..." : "Send reset link"}
              </button>
              {backToLogin}
            </div>
          </form>
        )}
      </div>
    </AuthSplit>
  )
}
