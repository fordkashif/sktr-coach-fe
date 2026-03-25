"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DEFAULT_CLUB_ADMIN_PROFILE,
  useClubAdmin,
} from "@/lib/club-admin-context"
import {
  insertAuditEvent,
  upsertClubAdminProfileRecord,
} from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"
import { loadProfileSafe, persistProfile } from "../state"

export default function ClubAdminProfilePage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const clubAdmin = useClubAdmin()
  const [profile, setProfile] = useState(() =>
    isSupabaseMode ? clubAdmin.profile ?? DEFAULT_CLUB_ADMIN_PROFILE : loadProfileSafe(),
  )
  const [saved, setSaved] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(clubAdmin.profileError)
  const [mockAuditLogger, setMockAuditLogger] = useState<((event: {
    actor: string
    action: string
    target: string
    detail?: string
  }) => void) | null>(null)

  useEffect(() => {
    if (!isSupabaseMode) return
    if (clubAdmin.profile) setProfile(clubAdmin.profile)
  }, [clubAdmin.profile, isSupabaseMode])

  useEffect(() => {
    if (!isSupabaseMode) return
    setBackendError(clubAdmin.profileError)
  }, [clubAdmin.profileError, isSupabaseMode])

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false

    void import("@/lib/mock-audit").then((module) => {
      if (!cancelled) {
        setMockAuditLogger(() => module.logAuditEvent)
      }
    })

    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  return (
    <div className="mx-auto w-full max-w-8xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="px-1 py-1 sm:px-2 lg:px-3">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <h1 className="max-w-[16ch] text-[clamp(2.2rem,5vw,4.75rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-slate-950">
              Club identity that stays consistent across the tenant.
            </h1>
            <p className="max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
              Manage branding, season configuration, and the club identity used across the tenant.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Club name", value: profile.clubName || "Not set" },
              { label: "Short name", value: profile.shortName || "Not set" },
              { label: "Season year", value: profile.seasonYear || "Not set" },
              {
                label: "Season range",
                value:
                  profile.seasonStart && profile.seasonEnd
                    ? `${profile.seasonStart} - ${profile.seasonEnd}`
                    : "Not set",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fc_100%)] px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1368ff]">
                  {item.label}
                </p>
                <p className="mt-2 line-clamp-3 text-base font-semibold tracking-[-0.03em] text-slate-950 sm:text-lg">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {backendError ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Backend sync issue: {backendError}
        </section>
      ) : null}
      {isSupabaseMode && clubAdmin.profileLoading ? (
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
              <Input
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
                value={profile.clubName}
                onChange={(event) => setProfile((current) => ({ ...current, clubName: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Short name</Label>
              <Input
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
                value={profile.shortName}
                onChange={(event) => setProfile((current) => ({ ...current, shortName: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Primary color</Label>
              <Input
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
                type="color"
                value={profile.primaryColor}
                onChange={(event) => setProfile((current) => ({ ...current, primaryColor: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Season year</Label>
              <Input
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
                value={profile.seasonYear}
                onChange={(event) => setProfile((current) => ({ ...current, seasonYear: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Season start</Label>
              <Input
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
                type="date"
                value={profile.seasonStart}
                onChange={(event) => setProfile((current) => ({ ...current, seasonStart: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-950">Season end</Label>
              <Input
                className="h-12 rounded-[16px] border-slate-200 bg-slate-50"
                type="date"
                value={profile.seasonEnd}
                onChange={(event) => setProfile((current) => ({ ...current, seasonEnd: event.target.value }))}
              />
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
                  clubAdmin.updateCachedProfile({
                    ...profile,
                    passwordSetAt: clubAdmin.profile?.passwordSetAt ?? null,
                    onboardingCompletedAt: clubAdmin.profile?.onboardingCompletedAt ?? null,
                    setupGuideDismissedAt: clubAdmin.profile?.setupGuideDismissedAt ?? null,
                  })
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
                mockAuditLogger?.({
                  actor: "club-admin",
                  action: "profile_update",
                  target: "club-profile",
                  detail: `${profile.clubName} (${profile.seasonYear})`,
                })
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
