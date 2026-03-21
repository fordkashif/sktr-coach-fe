"use client"

import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { acceptCoachInviteForCurrentUser } from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type InviteState = "loading" | "needs-signin" | "accepted" | "error"

export default function CoachInviteAcceptPage() {
  const navigate = useNavigate()
  const { inviteId = "" } = useParams()
  const isSupabaseMode = getBackendMode() === "supabase"

  const [state, setState] = useState<InviteState>("loading")
  const [message, setMessage] = useState("Checking invite...")

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!isSupabaseMode) {
        if (!cancelled) {
          setState("error")
          setMessage("Coach invite acceptance is only available in Supabase mode.")
        }
        return
      }

      if (!inviteId) {
        if (!cancelled) {
          setState("error")
          setMessage("Invite id is missing.")
        }
        return
      }

      const supabase = getBrowserSupabaseClient()
      if (!supabase) {
        if (!cancelled) {
          setState("error")
          setMessage("Supabase client is not configured.")
        }
        return
      }

      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        if (!cancelled) {
          setState("needs-signin")
          setMessage("Sign in with the invited email to accept this invite.")
        }
        return
      }

      const result = await acceptCoachInviteForCurrentUser(inviteId)
      if (!cancelled && !result.ok) {
        setState("error")
        setMessage(result.error.message)
        return
      }

      if (!cancelled) {
        setState("accepted")
        setMessage("Invite accepted. Your coach workspace is ready.")
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [inviteId, isSupabaseMode])

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <section className="page-intro">
        <div className="space-y-2">
          <h1 className="page-intro-title">Coach Invite</h1>
          <p className="page-intro-copy">Accept your invite and enter the coach workspace.</p>
        </div>
      </section>

      <section className="mobile-card-primary space-y-4">
        <p className="text-sm text-slate-700">{message}</p>

        {state === "loading" ? <p className="text-sm text-slate-500">Please wait...</p> : null}

        {state === "needs-signin" ? (
          <div className="flex flex-wrap gap-3">
            <Button asChild className="h-11 rounded-full px-5">
              <Link to={`/login?redirect=${encodeURIComponent(`/invite/coach/${inviteId}`)}`}>Sign in to accept</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-full px-5">
              <Link to="/login">Back to login</Link>
            </Button>
          </div>
        ) : null}

        {state === "accepted" ? (
          <div className="flex flex-wrap gap-3">
            <Button type="button" className="h-11 rounded-full px-5" onClick={() => navigate("/coach/dashboard")}>
              Open coach dashboard
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-full px-5">
              <Link to="/coach/teams">Open teams</Link>
            </Button>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="h-11 rounded-full px-5">
              <Link to="/login">Back to login</Link>
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  )
}
