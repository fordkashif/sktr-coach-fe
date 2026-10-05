"use client"

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react"
import { CheckCircle, PencilSimple, WarningCircle } from "@phosphor-icons/react"
import { Initials, PageHeader, Panel, Tag } from "@/components/sk"
import { DEFAULT_CLUB_ADMIN_PROFILE, useClubAdmin } from "@/lib/club-admin-context"
import { insertAuditEvent, upsertClubAdminProfileRecord } from "@/lib/data/club-admin/ops-data"
import { getBackendMode } from "@/lib/supabase/config"
import { formatDay, localIsoDay, parseLocalDay, type MockAuditLogger } from "../ops-format"
import { loadProfileSafe, persistProfile } from "../state"

type ClubProfileForm = {
  clubName: string
  shortName: string
  primaryColor: string
  seasonYear: string
  seasonStart: string
  seasonEnd: string
}
type Field = keyof ClubProfileForm

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function validate(draft: ClubProfileForm): { ok: true; data: ClubProfileForm } | { ok: false; errors: Partial<Record<Field, string>> } {
  const data: ClubProfileForm = {
    clubName: draft.clubName.trim(),
    shortName: draft.shortName.trim(),
    primaryColor: draft.primaryColor.trim().toLowerCase(),
    seasonYear: draft.seasonYear.trim(),
    seasonStart: draft.seasonStart,
    seasonEnd: draft.seasonEnd,
  }
  const errors: Partial<Record<Field, string>> = {}
  if (!data.clubName) errors.clubName = "Enter the club name."
  else if (data.clubName.length > 80) errors.clubName = "Keep the club name to 80 characters or fewer."
  if (!data.shortName) errors.shortName = "Enter a short name, like ETC."
  else if (data.shortName.length > 12) errors.shortName = "Keep the short name to 12 characters or fewer."
  if (!HEX_COLOR.test(data.primaryColor)) errors.primaryColor = "Use a six digit hex colour, like #2152ff."
  if (!data.seasonYear) errors.seasonYear = "Enter a season, like 2026 or 2025/26."
  else if (data.seasonYear.length > 20) errors.seasonYear = "Keep the season to 20 characters or fewer."
  const start = parseLocalDay(data.seasonStart)
  const end = parseLocalDay(data.seasonEnd)
  if (!start) errors.seasonStart = "Pick the first day of the season."
  if (!end) errors.seasonEnd = "Pick the last day of the season."
  if (start && end && data.seasonStart > data.seasonEnd) errors.seasonEnd = "The season must end on or after the day it starts."
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data }
}

function seasonStatus(start: string, end: string): { label: string; tone: "green" | "blue" | "plain" } | null {
  const startDay = parseLocalDay(start)
  const endDay = parseLocalDay(end)
  if (!startDay || !endDay) return null
  const today = localIsoDay()
  const todayDay = parseLocalDay(today) as Date
  const dayMs = 24 * 60 * 60 * 1000
  if (today < start) {
    const days = Math.round((startDay.getTime() - todayDay.getTime()) / dayMs)
    return { label: days === 1 ? "Starts tomorrow" : `Starts in ${days} days`, tone: "blue" }
  }
  if (today > end) return { label: "Season ended", tone: "plain" }
  const left = Math.round((endDay.getTime() - todayDay.getTime()) / dayMs)
  return { label: left === 0 ? "Last day of the season" : `In season, ${left} ${left === 1 ? "day" : "days"} left`, tone: "green" }
}

function DetailRow({ label, children, muted = false }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="sk-row items-baseline">
      <dt className="sk-label shrink-0">{label}</dt>
      <dd className={muted ? "min-w-0 text-right text-sk-mute" : "min-w-0 break-words text-right font-bold text-sk-ink"}>{children}</dd>
    </div>
  )
}

export default function ClubAdminProfilePage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const clubAdmin = useClubAdmin()
  const formId = useId()
  const [mockProfile, setMockProfile] = useState<ClubProfileForm>(() => (isSupabaseMode ? DEFAULT_CLUB_ADMIN_PROFILE : loadProfileSafe()))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ClubProfileForm | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  const [mockAuditLogger, setMockAuditLogger] = useState<MockAuditLogger | null>(null)

  useEffect(() => {
    if (isSupabaseMode) return
    let cancelled = false
    void import("@/lib/mock-audit").then((module) => {
      if (!cancelled) setMockAuditLogger(() => module.logAuditEvent)
    })
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const profile: ClubProfileForm | null = isSupabaseMode ? clubAdmin.profile : mockProfile
  const loading = isSupabaseMode && !clubAdmin.profile && clubAdmin.profileLoading
  const loadError = isSupabaseMode ? clubAdmin.profileError : null

  const startEditing = () => {
    if (!profile) return
    setDraft({
      clubName: profile.clubName,
      shortName: profile.shortName,
      primaryColor: HEX_COLOR.test(profile.primaryColor) ? profile.primaryColor : DEFAULT_CLUB_ADMIN_PROFILE.primaryColor,
      seasonYear: profile.seasonYear,
      seasonStart: profile.seasonStart,
      seasonEnd: profile.seasonEnd,
    })
    setFieldErrors({})
    setSaveError(null)
    setSavedNotice(false)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setDraft(null)
    setFieldErrors({})
    setSaveError(null)
  }

  const updateDraft = (field: Field, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current))
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft || saving) return

    const validation = validate(draft)
    if (!validation.ok) {
      setFieldErrors(validation.errors)
      setSaveError(null)
      return
    }

    const next = validation.data
    const auditDetail = `${next.clubName} (${next.seasonYear})`
    setSaving(true)
    setSaveError(null)
    setAuditError(null)

    if (isSupabaseMode) {
      const saveResult = await upsertClubAdminProfileRecord(next)
      if (!saveResult.ok) {
        setSaving(false)
        setSaveError(
          saveResult.error.code === "FORBIDDEN" || saveResult.error.code === "UNAUTHORIZED"
            ? "You are not allowed to change the club profile. Sign in again and retry."
            : `Could not save the club profile. ${saveResult.error.message}`,
        )
        return
      }
      clubAdmin.updateCachedProfile({
        ...next,
        passwordSetAt: clubAdmin.profile?.passwordSetAt ?? null,
        onboardingCompletedAt: clubAdmin.profile?.onboardingCompletedAt ?? null,
        setupGuideDismissedAt: clubAdmin.profile?.setupGuideDismissedAt ?? null,
      })
      const auditResult = await insertAuditEvent({ action: "profile_update", target: "club-profile", detail: auditDetail })
      if (!auditResult.ok) setAuditError(auditResult.error.message)
    } else {
      try {
        persistProfile(next)
      } catch {
        setSaving(false)
        setSaveError("Could not save the club profile on this device.")
        return
      }
      setMockProfile(next)
      mockAuditLogger?.({ actor: "club-admin", action: "profile_update", target: "club-profile", detail: auditDetail })
    }

    setSaving(false)
    setEditing(false)
    setDraft(null)
    setFieldErrors({})
    setSavedNotice(true)
  }

  const fieldProps = (field: Field) => ({
    id: `${formId}-${field}`,
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `${formId}-${field}-error` : undefined,
  })

  const fieldError = (field: Field) =>
    fieldErrors[field] ? (
      <p id={`${formId}-${field}-error`} className="mt-1.5 text-sm font-semibold text-[#b32a0c]">
        {fieldErrors[field]}
      </p>
    ) : null

  const label = (field: Field, text: string) => (
    <label htmlFor={`${formId}-${field}`} className="sk-label mb-1.5 block">
      {text}
    </label>
  )

  const clubName = profile?.clubName.trim() || "Your club"
  const status = profile ? seasonStatus(profile.seasonStart, profile.seasonEnd) : null

  return (
    <div className="sk-page">
      <PageHeader
        title={
          <span className="flex items-center gap-3 sm:gap-4">
            {profile?.clubName.trim() ? <Initials name={clubName} size="lg" /> : null}
            <span className="min-w-0 break-words">{clubName}</span>
          </span>
        }
        lede={
          profile
            ? profile.clubName.trim()
              ? "Your club's name, short name and season dates."
              : "Add your club's name and season dates to finish setting up."
            : undefined
        }
        actions={
          profile && !editing ? (
            <button type="button" className="sk-btn sk-btn-primary" onClick={startEditing}>
              <PencilSimple className="size-5" weight="bold" aria-hidden />
              Edit club profile
            </button>
          ) : null
        }
      />

      {loading ? <p className="text-sk-mute" role="status">Loading the club profile...</p> : null}

      {loadError ? (
        <div className="flex items-start gap-3 rounded-2xl bg-sk-coral-tint p-4" role="alert">
          <WarningCircle className="mt-0.5 size-5 shrink-0 text-[#b32a0c]" weight="fill" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-bold text-[#b32a0c]">
              {profile ? "We could not refresh the club profile. You may be looking at an older copy." : "We could not load the club profile."}
            </p>
            <p className="text-sk-ink-2">{loadError}</p>
          </div>
        </div>
      ) : null}

      {savedNotice && !editing ? (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-sk-green-tint px-4 py-3 text-sm font-bold text-[#07673f]">
          <CheckCircle className="size-5 shrink-0" weight="fill" aria-hidden />
          Club profile saved.
        </p>
      ) : null}
      {auditError ? (
        <p role="alert" className="rounded-2xl bg-sk-yellow-tint px-4 py-3 text-sm font-semibold text-[#7a5600]">
          The profile was saved, but we could not add the change to the activity log. {auditError}
        </p>
      ) : null}

      {profile && editing && draft ? (
        <Panel title="Edit club profile" hint="All fields are needed.">
          <form className="grid gap-6" onSubmit={handleSave} noValidate>
            <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
              <fieldset className="grid content-start gap-4">
                <legend className="sk-h3 mb-3">Club</legend>
                <div>
                  {label("clubName", "Club name")}
                  <input
                    {...fieldProps("clubName")}
                    className="sk-field"
                    autoComplete="organization"
                    maxLength={80}
                    value={draft.clubName}
                    onChange={(event) => updateDraft("clubName", event.target.value)}
                  />
                  {fieldError("clubName")}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    {label("shortName", "Short name")}
                    <input
                      {...fieldProps("shortName")}
                      className="sk-field"
                      placeholder="ETC"
                      maxLength={12}
                      value={draft.shortName}
                      onChange={(event) => updateDraft("shortName", event.target.value)}
                    />
                    {fieldError("shortName")}
                  </div>
                  <div>
                    {label("primaryColor", "Club colour")}
                    <div className="flex gap-2">
                      <input
                        type="color"
                        aria-label="Pick the club colour"
                        className="h-11 w-14 shrink-0 cursor-pointer rounded-[14px] border border-[#d5d9e3] bg-white p-1"
                        value={HEX_COLOR.test(draft.primaryColor) ? draft.primaryColor : "#2152ff"}
                        onChange={(event) => updateDraft("primaryColor", event.target.value)}
                      />
                      <input
                        {...fieldProps("primaryColor")}
                        className="sk-field"
                        placeholder="#2152ff"
                        maxLength={7}
                        spellCheck={false}
                        value={draft.primaryColor}
                        onChange={(event) => updateDraft("primaryColor", event.target.value)}
                      />
                    </div>
                    {fieldError("primaryColor")}
                  </div>
                </div>
              </fieldset>

              <fieldset className="grid content-start gap-4">
                <legend className="sk-h3 mb-3">Season</legend>
                <div>
                  {label("seasonYear", "Season")}
                  <input
                    {...fieldProps("seasonYear")}
                    className="sk-field"
                    placeholder="2026"
                    maxLength={20}
                    value={draft.seasonYear}
                    onChange={(event) => updateDraft("seasonYear", event.target.value)}
                  />
                  {fieldError("seasonYear")}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    {label("seasonStart", "First day")}
                    <input
                      {...fieldProps("seasonStart")}
                      type="date"
                      className="sk-field"
                      max={draft.seasonEnd || undefined}
                      value={draft.seasonStart}
                      onChange={(event) => updateDraft("seasonStart", event.target.value)}
                    />
                    {fieldError("seasonStart")}
                  </div>
                  <div>
                    {label("seasonEnd", "Last day")}
                    <input
                      {...fieldProps("seasonEnd")}
                      type="date"
                      className="sk-field"
                      min={draft.seasonStart || undefined}
                      value={draft.seasonEnd}
                      onChange={(event) => updateDraft("seasonEnd", event.target.value)}
                    />
                    {fieldError("seasonEnd")}
                  </div>
                </div>
              </fieldset>
            </div>

            {saveError ? (
              <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
                {saveError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="sk-btn sk-btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Save club profile"}
              </button>
              <button type="button" className="sk-btn sk-btn-ghost" onClick={cancelEditing} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      {profile && !editing ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2 lg:gap-8">
          <Panel title="Club">
            <dl>
              <DetailRow label="Club name" muted={!profile.clubName.trim()}>
                {profile.clubName.trim() || "Not added yet"}
              </DetailRow>
              <DetailRow label="Short name" muted={!profile.shortName.trim()}>
                {profile.shortName.trim() || "Not added yet"}
              </DetailRow>
              <DetailRow label="Club colour">
                <span className="inline-flex items-center gap-2">
                  <span className="size-5 rounded-md border border-sk-line" style={{ backgroundColor: profile.primaryColor }} aria-hidden />
                  <span className="tabular-nums">{profile.primaryColor}</span>
                </span>
              </DetailRow>
            </dl>
            <p className="mt-3 text-sm leading-relaxed text-sk-mute">The club colour is saved with your profile. It does not change how the app looks yet.</p>
          </Panel>

          <Panel title="Season" action={status ? <Tag tone={status.tone}>{status.label}</Tag> : null}>
            <dl>
              <DetailRow label="Season" muted={!profile.seasonYear.trim()}>
                {profile.seasonYear.trim() || "Not set"}
              </DetailRow>
              <DetailRow label="First day" muted={!profile.seasonStart}>
                {formatDay(profile.seasonStart) || "Not set"}
              </DetailRow>
              <DetailRow label="Last day" muted={!profile.seasonEnd}>
                {formatDay(profile.seasonEnd) || "Not set"}
              </DetailRow>
            </dl>
          </Panel>
        </div>
      ) : null}
    </div>
  )
}
