"use client"

import { useEffect, useState } from "react"
import { ClubAdminNav } from "@/components/club-admin/admin-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getClubAdminProfileRecord,
  insertAuditEvent,
  upsertClubAdminProfileRecord,
} from "@/lib/data/club-admin/ops-data"
import { logAuditEvent } from "@/lib/mock-audit"
import { getBackendMode } from "@/lib/supabase/config"
import { loadProfileSafe, persistProfile } from "../state"

export default function ClubAdminProfilePage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const [profile, setProfile] = useState(() =>
    isSupabaseMode
      ? {
          clubName: "",
          shortName: "",
          primaryColor: "#16a34a",
          seasonYear: "2026",
          seasonStart: "2026-01-10",
          seasonEnd: "2026-10-30",
        }
      : loadProfileSafe(),
  )
  const [saved, setSaved] = useState(false)
  const [backendLoading, setBackendLoading] = useState(isSupabaseMode)
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const load = async () => {
      setBackendLoading(true)
      const result = await getClubAdminProfileRecord()
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        setBackendLoading(false)
        return
      }
      setProfile(result.data)
      setBackendError(null)
      setBackendLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="page-intro">
        <div className="space-y-3">
          <div>
            <h1 className="page-intro-title">Club Profile</h1>
            <p className="page-intro-copy">Manage branding, season configuration, and the club identity used across the tenant.</p>
          </div>
          <ClubAdminNav />
        </div>
      </section>

      {backendError ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Backend sync issue: {backendError}
        </section>
      ) : null}
      {isSupabaseMode && backendLoading ? (
        <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Loading club profile...
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Branding & Season</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Tenant Identity</h2>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Club name</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" value={profile.clubName} onChange={(event) => setProfile((current) => ({ ...current, clubName: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Short name</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" value={profile.shortName} onChange={(event) => setProfile((current) => ({ ...current, shortName: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Primary color</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" type="color" value={profile.primaryColor} onChange={(event) => setProfile((current) => ({ ...current, primaryColor: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Season year</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" value={profile.seasonYear} onChange={(event) => setProfile((current) => ({ ...current, seasonYear: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Season start</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" type="date" value={profile.seasonStart} onChange={(event) => setProfile((current) => ({ ...current, seasonStart: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Season end</Label>
              <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" type="date" value={profile.seasonEnd} onChange={(event) => setProfile((current) => ({ ...current, seasonEnd: event.target.value }))} />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Button
              type="button"
              className="h-12 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white shadow-[0_12px_28px_rgba(31,140,255,0.22)] hover:opacity-95"
              onClick={async () => {
                if (isSupabaseMode) {
                  const saveResult = await upsertClubAdminProfileRecord(profile)
                  if (!saveResult.ok) {
                    setBackendError(saveResult.error.message)
                    return
                  }
                  const auditResult = await insertAuditEvent({
                    action: "profile_update",
                    target: "club-profile",
                    detail: `${profile.clubName} (${profile.seasonYear})`,
                  })
                  if (!auditResult.ok) setBackendError((current) => current ?? auditResult.error.message)
                  setSaved(true)
                  return
                }

                persistProfile(profile)
                setSaved(true)
                logAuditEvent({ actor: "club-admin", action: "profile_update", target: "club-profile", detail: `${profile.clubName} (${profile.seasonYear})` })
              }}
            >
              Save profile
            </Button>
            {saved ? <p className="text-sm text-[#1f8cff]">Saved.</p> : null}
          </div>
        </div>

        <div className="mobile-card-primary">
          <div className="space-y-1 border-b border-slate-200 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Preview</p>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Identity Summary</h2>
          </div>
          <div className="mt-4 rounded-[22px] bg-[linear-gradient(135deg,#031733_0%,#0b2d63_100%)] p-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8db8ff]">{profile.shortName}</p>
            <h3 className="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.05em]">{profile.clubName}</h3>
            <p className="mt-3 text-sm text-white/72">Season {profile.seasonYear}</p>
          </div>
          <div className="mt-4 grid gap-2">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Primary Color</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="size-8 rounded-full border border-slate-200" style={{ backgroundColor: profile.primaryColor }} />
                <span className="text-sm font-medium text-slate-950">{profile.primaryColor}</span>
              </div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              {profile.seasonStart} to {profile.seasonEnd}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
