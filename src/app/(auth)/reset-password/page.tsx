"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { bootstrapPasswordReset, completePasswordReset, requestPasswordReset } from "@/lib/auth-recovery"

type Stage = "request" | "update" | "success"

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [stage, setStage] = useState<Stage>("request")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type")
  const mockToken = searchParams.get("mock_token")

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!code && !tokenHash && !mockToken) return

      setLoading(true)
      const result = await bootstrapPasswordReset({
        code,
        tokenHash: tokenHash ?? mockToken,
        type,
      })
      if (cancelled) return

      setLoading(false)
      if (!result.ok) {
        setError(result.message)
        setStage("request")
        return
      }

      setEmail(result.email)
      setError("")
      setMessage("")
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
    setLoading(true)
    setError("")
    const result = await requestPasswordReset(email)
    setLoading(false)

    if (!result.ok) {
      setError(result.message)
      return
    }

    setMessage(result.message)
    if (result.mode === "mock" && result.actionLink) {
      navigate(result.actionLink)
      return
    }
    setStage("success")
  }

  const handleUpdateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    setError("")
    const result = await completePasswordReset({ password, token: mockToken })
    setLoading(false)

    if (!result.ok) {
      setError(result.message)
      return
    }

    setStage("success")
    setMessage("Password updated.")
    navigate(result.redirectTo, { replace: true })
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center p-4 sm:p-6">
      <section className="w-full rounded-[28px] border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-8">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Account recovery</p>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
            {stage === "update" ? "Set a new password" : "Reset your password"}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            One recovery flow covers athlete, coach, club-admin, and platform-admin accounts because authentication is shared.
          </p>
        </div>

        {error ? (
          <div className="mt-5 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}
        {message && !error ? (
          <div className="mt-5 rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
        ) : null}

        {stage === "update" ? (
          <form className="mt-6 grid gap-4" onSubmit={handleUpdateSubmit}>
            <div className="space-y-2">
              <Label htmlFor="reset-account-email" className="text-sm font-medium text-slate-950">Account</Label>
              <Input id="reset-account-email" value={email} readOnly className="h-12 rounded-[16px] border-slate-200 bg-slate-50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-new-password" className="text-sm font-medium text-slate-950">New password</Label>
              <Input
                id="reset-new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-confirm-password" className="text-sm font-medium text-slate-950">Confirm password</Label>
              <Input
                id="reset-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={loading} className="h-11 rounded-full px-5">
                {loading ? "Saving..." : "Update password"}
              </Button>
              <Button asChild type="button" variant="outline" className="h-11 rounded-full px-5">
                <Link to="/login">Back to login</Link>
              </Button>
            </div>
          </form>
        ) : (
          <form className="mt-6 grid gap-4" onSubmit={handleRequestSubmit}>
            <div className="space-y-2">
              <Label htmlFor="reset-request-email" className="text-sm font-medium text-slate-950">Email</Label>
              <Input
                id="reset-request-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="coach@pacelab.local"
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
                required
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={loading} className="h-11 rounded-full px-5">
                {loading ? "Sending..." : "Send reset link"}
              </Button>
              <Button asChild type="button" variant="outline" className="h-11 rounded-full px-5">
                <Link to="/login">Back to login</Link>
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
