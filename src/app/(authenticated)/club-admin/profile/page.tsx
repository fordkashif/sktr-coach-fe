import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { ImageSquare, PencilSimple } from "@phosphor-icons/react"
import {
  Button,
  ClubMark,
  Fact,
  FactList,
  Field,
  FormActions,
  FormGrid,
  InlineConfirm,
  Input,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  Split,
  notify,
} from "@/components/sk"
import { ClubSeasonSection } from "@/components/club-admin/club-season-section"
import { ClubDataAndOwnership } from "@/components/club-admin/club-data-ownership"
import { ClubTimezoneSection } from "@/components/club-admin/club-timezone-section"
import { DEFAULT_CLUB_ADMIN_PROFILE, useClubAdmin } from "@/lib/club-admin-context"
import { refreshClubBrand, useClubBrand } from "@/lib/club-brand-store"
import {
  EMPTY_CLUB_CONTACT,
  formatClubLocation,
  getClubContactDetails,
  removeClubLogo,
  saveClubContactDetails,
  uploadClubLogo,
  validateClubContact,
  type ClubContactDetails,
} from "@/lib/data/club-admin/club-profile-data"
import { insertAuditEvent, upsertClubAdminProfileRecord } from "@/lib/data/club-admin/ops-data"
import { prepareAvatarImage, type AvatarImageError } from "@/lib/image-resize"
import { getBackendMode } from "@/lib/supabase/config"
import { parseLocalDay } from "../ops-format"
import { loadProfileSafe, persistProfile } from "../state"

type ClubProfileForm = {
  clubName: string
  shortName: string
  primaryColor: string
  seasonYear: string
  seasonStart: string
  seasonEnd: string
}
type ProfileField = keyof ClubProfileForm
type Errors<T> = Partial<Record<keyof T, string>>
type Editing = "club" | "contact" | "season" | null

const HEX_COLOR = /^#[0-9a-f]{6}$/i

const IMAGE_ERRORS: Record<AvatarImageError, string> = {
  "wrong-type": "That file is not an image we can use. Choose a JPEG, PNG or WebP image.",
  "too-large": "That image is too large. Choose one under 20 MB.",
  unreadable: "We could not open that image. Try a different one.",
}

function validateProfile(draft: ClubProfileForm, fields: ProfileField[]): { ok: true; data: ClubProfileForm } | { ok: false; errors: Errors<ClubProfileForm> } {
  const data: ClubProfileForm = {
    clubName: draft.clubName.trim(),
    shortName: draft.shortName.trim(),
    primaryColor: draft.primaryColor.trim().toLowerCase(),
    seasonYear: draft.seasonYear.trim(),
    seasonStart: draft.seasonStart,
    seasonEnd: draft.seasonEnd,
  }
  const errors: Errors<ClubProfileForm> = {}
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
  // Only the fields of the section being saved can block it.
  const relevant = Object.fromEntries(Object.entries(errors).filter(([field]) => fields.includes(field as ProfileField))) as Errors<ClubProfileForm>
  return Object.keys(relevant).length > 0 ? { ok: false, errors: relevant } : { ok: true, data }
}

/** The club's own details: logo, name and colour, how to reach it, and its season. */
export default function ClubAdminProfilePage() {
  const isSupabaseMode = getBackendMode() === "supabase"
  const clubAdmin = useClubAdmin()
  const { brand } = useClubBrand()
  const logoInput = useRef<HTMLInputElement>(null)

  const [mockProfile, setMockProfile] = useState<ClubProfileForm>(() => (isSupabaseMode ? DEFAULT_CLUB_ADMIN_PROFILE : loadProfileSafe()))
  const [contact, setContact] = useState<ClubContactDetails | null>(null)
  const [contactLoadError, setContactLoadError] = useState<string | null>(null)

  const [editing, setEditing] = useState<Editing>(null)
  const [draft, setDraft] = useState<ClubProfileForm | null>(null)
  const [contactDraft, setContactDraft] = useState<ClubContactDetails>(EMPTY_CLUB_CONTACT)
  const [errors, setErrors] = useState<Errors<ClubProfileForm>>({})
  const [contactErrors, setContactErrors] = useState<Errors<ClubContactDetails>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [logoBusy, setLogoBusy] = useState<"upload" | "remove" | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getClubContactDetails().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setContact(result.data)
        setContactLoadError(null)
      } else {
        setContactLoadError(result.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const profile: ClubProfileForm | null = isSupabaseMode ? clubAdmin.profile : mockProfile
  const loading = isSupabaseMode && !clubAdmin.profile && clubAdmin.profileLoading
  const loadError = isSupabaseMode ? clubAdmin.profileError : null

  const audit = async (action: string, detail?: string) => {
    if (isSupabaseMode) {
      const result = await insertAuditEvent({ action, target: "club-profile", detail })
      setAuditError(result.ok ? null : result.error.message)
      return
    }
    const mockAudit = await import("@/lib/mock-audit")
    mockAudit.logAuditEvent({ actor: "club-admin", action, target: "club-profile", detail })
  }

  const startEditing = (section: Exclude<Editing, null>) => {
    if (!profile) return
    setDraft({ ...profile, primaryColor: HEX_COLOR.test(profile.primaryColor) ? profile.primaryColor : DEFAULT_CLUB_ADMIN_PROFILE.primaryColor })
    setContactDraft(contact ?? EMPTY_CLUB_CONTACT)
    setErrors({})
    setContactErrors({})
    setSaveError(null)
    setEditing(section)
  }

  const stopEditing = () => {
    setEditing(null)
    setDraft(null)
    setErrors({})
    setContactErrors({})
    setSaveError(null)
  }

  const updateDraft = (field: ProfileField, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current))
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const updateContactDraft = (field: keyof ClubContactDetails, value: string) => {
    setContactDraft((current) => ({ ...current, [field]: value }))
    setContactErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>, section: "club" | "season") => {
    event.preventDefault()
    if (!draft || saving) return
    const validation = validateProfile(draft, section === "club" ? ["clubName", "shortName", "primaryColor"] : ["seasonYear", "seasonStart", "seasonEnd"])
    if (!validation.ok) {
      setErrors(validation.errors)
      setSaveError(null)
      return
    }
    // The other section's fields are saved as they already are.
    const next: ClubProfileForm = profile
      ? section === "club"
        ? { ...profile, clubName: validation.data.clubName, shortName: validation.data.shortName, primaryColor: validation.data.primaryColor }
        : { ...profile, seasonYear: validation.data.seasonYear, seasonStart: validation.data.seasonStart, seasonEnd: validation.data.seasonEnd }
      : validation.data

    setSaving(true)
    setSaveError(null)
    if (isSupabaseMode) {
      const result = await upsertClubAdminProfileRecord(next)
      if (!result.ok) {
        setSaving(false)
        setSaveError(
          result.error.code === "FORBIDDEN" || result.error.code === "UNAUTHORIZED"
            ? "You are not allowed to change the club's details. Sign in again and retry."
            : `Could not save. ${result.error.message}`,
        )
        return
      }
      clubAdmin.updateCachedProfile({
        ...next,
        passwordSetAt: clubAdmin.profile?.passwordSetAt ?? null,
        onboardingCompletedAt: clubAdmin.profile?.onboardingCompletedAt ?? null,
        setupGuideDismissedAt: clubAdmin.profile?.setupGuideDismissedAt ?? null,
      })
    } else {
      try {
        persistProfile(next)
      } catch {
        setSaving(false)
        setSaveError("Could not save on this device.")
        return
      }
      setMockProfile(next)
    }
    await audit("profile_update", section === "club" ? `${next.clubName} (${next.shortName})` : `Season ${next.seasonYear}, ${next.seasonStart} to ${next.seasonEnd}`)
    await refreshClubBrand()
    setSaving(false)
    stopEditing()
    notify(section === "club" ? "Club details saved" : "Season saved")
  }

  const saveContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const validation = validateClubContact(contactDraft)
    if (!validation.ok) {
      setContactErrors(validation.errors)
      setSaveError(null)
      return
    }
    setSaving(true)
    setSaveError(null)
    const result = await saveClubContactDetails(validation.data)
    if (!result.ok) {
      setSaving(false)
      setSaveError(`Could not save. ${result.error.message}`)
      return
    }
    setContact(result.data)
    await audit("profile_update", "Contact details and location")
    setSaving(false)
    stopEditing()
    notify("Contact details saved")
  }

  const handleLogoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Clear the input so choosing the same file again still fires a change.
    event.target.value = ""
    if (!file || logoBusy) return
    setLogoError(null)
    setConfirmRemoveLogo(false)
    setLogoBusy("upload")
    const prepared = await prepareAvatarImage(file, 512, "contain")
    if (!prepared.ok) {
      setLogoBusy(null)
      setLogoError(IMAGE_ERRORS[prepared.error])
      return
    }
    const result = await uploadClubLogo(prepared.data)
    if (!result.ok) {
      setLogoBusy(null)
      setLogoError(result.error.message)
      return
    }
    await audit("club_logo_update")
    await refreshClubBrand()
    setLogoBusy(null)
    notify("Club logo updated")
  }

  const handleLogoRemove = async () => {
    setLogoError(null)
    setLogoBusy("remove")
    const result = await removeClubLogo()
    if (!result.ok) {
      setLogoBusy(null)
      setConfirmRemoveLogo(false)
      setLogoError(`Could not remove the logo. ${result.error.message}`)
      return
    }
    await audit("club_logo_remove")
    await refreshClubBrand()
    setLogoBusy(null)
    setConfirmRemoveLogo(false)
    notify("Club logo removed")
  }

  const clubName = profile?.clubName.trim() || "Your club"
  const logoUrl = brand?.logoUrl ?? null
  const location = contact ? formatClubLocation(contact) : ""
  const editAction = (section: Exclude<Editing, null>, label: string) =>
    profile && editing === null ? (
      <Button variant="quiet" size="sm" className="-my-2" onClick={() => startEditing(section)} aria-label={label}>
        <PencilSimple className="size-4" weight="bold" aria-hidden />
        Edit
      </Button>
    ) : null
  const formEnd = (saveLabel: string) => (
    <>
      {saveError ? <Notice tone="error">{saveError}</Notice> : null}
      <FormActions>
        <Button variant="quiet" onClick={stopEditing} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving..." : saveLabel}
        </Button>
      </FormActions>
    </>
  )

  return (
    <Screen>
      <ScreenHeader
        title={clubName}
        lede={
          profile
            ? profile.clubName.trim()
              ? "Your club's logo, name, contact details and season."
              : "Add your club's name and season dates to finish setting up."
            : undefined
        }
      />

      {loadError ? (
        <Notice tone="error">
          {profile ? "We could not refresh the club's details. You may be looking at an older copy." : "We could not load the club's details."} {loadError}
        </Notice>
      ) : null}
      {auditError ? <Notice tone="warning">Your change was saved, but we could not add it to the activity log. {auditError}</Notice> : null}

      {loading ? (
        <Section title="Club">
          <SkeletonRows rows={3} label="Loading the club's details" />
        </Section>
      ) : null}

      {profile ? (
        <Split
          main={
            <>
              <Section title="Club" action={editAction("club", "Edit club name and colour")}>
                {editing === "club" && draft ? (
                  <form className="flex flex-col gap-4" onSubmit={(event) => void saveProfile(event, "club")} noValidate>
                    <FormGrid>
                      <Field label="Club name" error={errors.clubName} className="sm:col-span-2">
                        <Input autoComplete="organization" maxLength={80} value={draft.clubName} onChange={(event) => updateDraft("clubName", event.target.value)} />
                      </Field>
                      <Field label="Short name" error={errors.shortName} hint="A few letters, like ETC. Shown where there is no logo.">
                        <Input placeholder="ETC" maxLength={12} value={draft.shortName} onChange={(event) => updateDraft("shortName", event.target.value)} />
                      </Field>
                      <Field label="Club colour" error={errors.primaryColor} hint="Sits behind your short name where there is no logo, and marks printed plans. It never changes buttons or links.">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            aria-label="Pick the club colour"
                            className="h-11 w-14 shrink-0 cursor-pointer rounded-[12px] border border-sk-line-strong bg-white p-1"
                            value={HEX_COLOR.test(draft.primaryColor) ? draft.primaryColor : "#2152ff"}
                            onChange={(event) => updateDraft("primaryColor", event.target.value)}
                          />
                          <Input placeholder="#2152ff" maxLength={7} spellCheck={false} value={draft.primaryColor} onChange={(event) => updateDraft("primaryColor", event.target.value)} />
                        </div>
                      </Field>
                    </FormGrid>
                    {formEnd("Save club details")}
                  </form>
                ) : (
                  <FactList aria-label="Club">
                    <Fact label="Club name" empty="Not added yet">
                      {profile.clubName.trim()}
                    </Fact>
                    <Fact label="Short name" empty="Not added yet">
                      {profile.shortName.trim()}
                    </Fact>
                    <Fact label="Club colour">
                      <span className="inline-flex items-center gap-2">
                        <ClubMark name={clubName} shortName={profile.shortName} color={profile.primaryColor} className="size-6 rounded-[6px] text-[0.5rem]" />
                        <span className="tabular-nums">{profile.primaryColor}</span>
                      </span>
                    </Fact>
                  </FactList>
                )}
              </Section>

              <Section title="Contact and location" hint="Only club admins and the SKTR team see these." action={editAction("contact", "Edit contact and location")}>
                {contactLoadError ? <Notice tone="error">We could not load the contact details. {contactLoadError}</Notice> : null}
                {editing === "contact" ? (
                  <form className="mt-2 flex flex-col gap-4" onSubmit={(event) => void saveContact(event)} noValidate>
                    <FormGrid>
                      <Field label="Contact email" optional error={contactErrors.contactEmail}>
                        <Input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" maxLength={254} value={contactDraft.contactEmail} onChange={(event) => updateContactDraft("contactEmail", event.target.value)} />
                      </Field>
                      <Field label="Phone" optional error={contactErrors.contactPhone}>
                        <Input type="tel" inputMode="tel" autoComplete="tel" maxLength={40} placeholder="+1 876 555 0100" value={contactDraft.contactPhone} onChange={(event) => updateContactDraft("contactPhone", event.target.value)} />
                      </Field>
                      <Field label="City or town" optional error={contactErrors.city}>
                        <Input autoComplete="address-level2" maxLength={80} value={contactDraft.city} onChange={(event) => updateContactDraft("city", event.target.value)} />
                      </Field>
                      <Field label="Parish, state or region" optional error={contactErrors.region}>
                        <Input autoComplete="address-level1" maxLength={80} value={contactDraft.region} onChange={(event) => updateContactDraft("region", event.target.value)} />
                      </Field>
                      <Field label="Country" optional error={contactErrors.country}>
                        <Input autoComplete="country-name" maxLength={80} value={contactDraft.country} onChange={(event) => updateContactDraft("country", event.target.value)} />
                      </Field>
                      <Field label="Website" optional error={contactErrors.website}>
                        <Input type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={200} placeholder="yourclub.com" value={contactDraft.website} onChange={(event) => updateContactDraft("website", event.target.value)} />
                      </Field>
                    </FormGrid>
                    {formEnd("Save contact details")}
                  </form>
                ) : contact ? (
                  <FactList aria-label="Contact and location">
                    <Fact label="Contact email" empty="Not added yet">
                      {contact.contactEmail ? (
                        <a className="sk-link break-all" href={`mailto:${contact.contactEmail}`}>
                          {contact.contactEmail}
                        </a>
                      ) : null}
                    </Fact>
                    <Fact label="Phone" empty="Not added yet">
                      {contact.contactPhone}
                    </Fact>
                    <Fact label="Location" empty="Not added yet">
                      {location}
                    </Fact>
                    <Fact label="Website" empty="Not added yet">
                      {contact.website ? (
                        <a className="sk-link break-all" href={contact.website} target="_blank" rel="noreferrer noopener">
                          {contact.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : null}
                    </Fact>
                  </FactList>
                ) : contactLoadError ? null : (
                  <SkeletonRows rows={3} label="Loading contact details" />
                )}
              </Section>
            </>
          }
          side={
            <>
              <Section title="Logo" hint="Everyone in your club sees it at the top of the app, and it goes on printed plans.">
                <div className="flex items-center gap-4">
                  <ClubMark name={clubName} shortName={profile.shortName} color={profile.primaryColor} logoUrl={logoUrl} size="lg" />
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <input
                      ref={logoInput}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      aria-label="Choose a club logo"
                      data-testid="club-logo-file-input"
                      tabIndex={-1}
                      onChange={(event) => void handleLogoFile(event)}
                    />
                    <Button onClick={() => logoInput.current?.click()} disabled={logoBusy !== null}>
                      <ImageSquare className="size-5" weight="bold" aria-hidden />
                      {logoBusy === "upload" ? "Uploading..." : logoUrl ? "Change logo" : "Add logo"}
                    </Button>
                    {logoUrl && !confirmRemoveLogo ? (
                      <Button variant="quiet" onClick={() => setConfirmRemoveLogo(true)} disabled={logoBusy !== null}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                {confirmRemoveLogo ? (
                  <InlineConfirm
                    className="mt-4"
                    question="Remove the club logo? Your short name on the club colour is shown instead."
                    confirmLabel="Remove logo"
                    cancelLabel="Keep it"
                    busy={logoBusy === "remove"}
                    onConfirm={() => void handleLogoRemove()}
                    onCancel={() => setConfirmRemoveLogo(false)}
                  />
                ) : null}
                {logoError ? (
                  <Notice tone="error" className="mt-4">
                    {logoError}
                  </Notice>
                ) : null}
              </Section>

              <ClubSeasonSection fallback={{ name: profile.seasonYear, start: profile.seasonStart, end: profile.seasonEnd }} />

              <ClubTimezoneSection />
            </>
          }
        />
      ) : null}

      {profile ? <ClubDataAndOwnership /> : null}
    </Screen>
  )
}
