"use client"

import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getBackendMode, isSupabaseEnabled } from "@/lib/supabase/config"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"

type FormState = {
  fullName: string
  email: string
  password: string
  organizationName: string
  shortName: string
  primaryColor: string
  seasonYear: string
  seasonStart: string
  seasonEnd: string
}

const today = new Date()
const year = today.getFullYear().toString()

const initialForm: FormState = {
  fullName: "",
  email: "",
  password: "",
  organizationName: "",
  shortName: "",
  primaryColor: "#16a34a",
  seasonYear: year,
  seasonStart: `${year}-01-10`,
  seasonEnd: `${year}-10-30`,
}

export default function CreateClubAccountPage() {
  const navigate = useNavigate()
  const isSupabaseMode = getBackendMode() === "supabase"
  const [form, setForm] = useState<FormState>(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setSuccess("")

    if (!isSupabaseMode) {
      setError("Create club account is only enabled in Supabase mode.")
      return
    }

    if (!isSupabaseEnabled()) {
      setError("Supabase mode is enabled but URL/key are missing in environment.")
      return
    }

    if (form.seasonStart > form.seasonEnd) {
      setError("Season start must be before season end.")
      return
    }

    const supabase = getBrowserSupabaseClient()
    if (!supabase) {
      setError("Supabase client failed to initialize.")
      return
    }

    setSubmitting(true)

    const signUpResult = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      options: {
        data: {
          display_name: form.fullName.trim(),
          role: "club-admin",
        },
      },
    })

    if (signUpResult.error) {
      setSubmitting(false)
      setError(signUpResult.error.message)
      return
    }

    if (!signUpResult.data.session) {
      setSubmitting(false)
      setSuccess("Account created. Check your email verification link, then sign in to continue setup.")
      return
    }

    const provisionResult = await supabase.rpc("provision_club_admin_tenant", {
      p_organization_name: form.organizationName.trim(),
      p_short_name: form.shortName.trim(),
      p_primary_color: form.primaryColor,
      p_season_year: form.seasonYear.trim(),
      p_season_start: form.seasonStart,
      p_season_end: form.seasonEnd,
    })

    if (provisionResult.error) {
      setSubmitting(false)
      setError(provisionResult.error.message)
      return
    }

    setSubmitting(false)
    navigate("/club-admin/dashboard")
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <section className="page-intro">
        <div className="space-y-2">
          <h1 className="page-intro-title">Create Club Account</h1>
          <p className="page-intro-copy">Set up a new club workspace with initial admin identity, branding, and season settings.</p>
        </div>
      </section>

      <section className="mobile-card-primary">
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="full-name">Full name</Label>
              <Input id="full-name" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required minLength={8} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="organization">Organization name</Label>
              <Input id="organization" value={form.organizationName} onChange={(event) => setForm((current) => ({ ...current, organizationName: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="short-name">Short name</Label>
              <Input id="short-name" value={form.shortName} onChange={(event) => setForm((current) => ({ ...current, shortName: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="primary-color">Primary color</Label>
              <Input id="primary-color" type="color" value={form.primaryColor} onChange={(event) => setForm((current) => ({ ...current, primaryColor: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="season-year">Season year</Label>
              <Input id="season-year" value={form.seasonYear} onChange={(event) => setForm((current) => ({ ...current, seasonYear: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="season-start">Season start</Label>
              <Input id="season-start" type="date" value={form.seasonStart} onChange={(event) => setForm((current) => ({ ...current, seasonStart: event.target.value }))} required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="season-end">Season end</Label>
              <Input id="season-end" type="date" value={form.seasonEnd} onChange={(event) => setForm((current) => ({ ...current, seasonEnd: event.target.value }))} required />
            </div>
          </div>

          {error ? <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          {success ? <div className="rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" className="h-12 rounded-full px-5" disabled={submitting}>
              {submitting ? "Creating account..." : "Create club account"}
            </Button>
            <Button asChild type="button" variant="outline" className="h-12 rounded-full px-5">
              <Link to="/login">Back to login</Link>
            </Button>
          </div>
        </form>
      </section>
    </main>
  )
}
