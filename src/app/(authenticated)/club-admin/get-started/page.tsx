"use client"

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FirstAccessSetupPanel } from "@/components/club-admin/first-access-setup-panel"
import {
  completeClubAdminFirstAccessSetup,
  getClubAdminProfileRecord,
  type ClubAdminProfileRecord,
} from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"

const defaultProfile: ClubAdminProfileRecord = {
  clubName: "",
  shortName: "",
  primaryColor: "#1368ff",
  seasonYear: "2026",
  seasonStart: "2026-01-10",
  seasonEnd: "2026-10-30",
  passwordSetAt: null,
  onboardingCompletedAt: null,
}

export default function ClubAdminGetStartedPage() {
  const navigate = useNavigate()
  const isSupabaseMode = getBackendMode() === "supabase"
  const [profile, setProfile] = useState<ClubAdminProfileRecord>(defaultProfile)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(isSupabaseMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      const result = await getClubAdminProfileRecord()
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        setLoading(false)
        return
      }
      if (result.data.passwordSetAt && result.data.onboardingCompletedAt) {
        navigate("/club-admin/dashboard", { replace: true })
        return
      }
      setProfile(result.data)
      setError(null)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode, navigate])

  const handleSubmit = async () => {
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setSaving(true)
    const result = await completeClubAdminFirstAccessSetup({
      password,
      profile,
    })
    setSaving(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    setError(null)
    navigate("/club-admin/dashboard", { replace: true })
  }

  return (
    loading ? (
      <section className="mx-auto mt-6 w-full max-w-4xl rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
        Loading first-access setup...
      </section>
    ) : (
      <FirstAccessSetupPanel
        profile={profile}
        password={password}
        confirmPassword={confirmPassword}
        saving={saving}
        error={error}
        loadingCopy="Completing setup..."
        submitLabel="Complete setup"
        title="Finish club setup before you enter the workspace"
        intro="This account was provisioned from an approved organization request. Set your password and complete the minimum club setup now. The dashboard stays locked until this is done."
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onProfileChange={setProfile}
        onSubmit={() => void handleSubmit()}
      />
    )
  )
}
