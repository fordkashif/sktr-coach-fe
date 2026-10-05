import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Camera, Eye, EyeSlash } from "@phosphor-icons/react"
import { Avatar, Button, Field, InlineConfirm, Input, List, ListRow, Notice, Section, notify } from "@/components/sk"
import { refreshAccount, useCurrentAccount } from "@/lib/account-store"
import { clearSessionCookies } from "@/lib/auth-session"
import {
  DISPLAY_NAME_MAX_LENGTH,
  MIN_PASSWORD_LENGTH,
  changePassword,
  removeAvatar,
  requestEmailChange,
  signOutOtherDevices,
  updateDisplayName,
  uploadAvatar,
  validateDisplayName,
  validateNewEmail,
  validateNewPassword,
} from "@/lib/data/account/account-data"
import { getCurrentCoachContactVisibility, setCurrentCoachContactVisibility } from "@/lib/data/athlete/profile-data"
import { prepareAvatarImage, type AvatarImageError } from "@/lib/image-resize"
import { MOCK_COACH_TEAM_STORAGE_KEY, MOCK_ROLE_STORAGE_KEY } from "@/lib/mock-auth"
import { useRole } from "@/lib/role-context"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

/**
 * The parts of "Your account". Each one is a Section, so a screen lists the ones it needs:
 * /account shows all of them, the athlete profile shows the photo and links to the rest.
 */

const IMAGE_ERRORS: Record<AvatarImageError, string> = {
  "wrong-type": "That file is not a photo we can use. Choose a JPEG, PNG or WebP image.",
  "too-large": "That photo is too large. Choose one under 20 MB.",
  unreadable: "We could not open that photo. Try a different one.",
}

/** Photo: choose from the library or take one on a phone, replace, remove. */
export function PhotoSection({ hint = "Your club sees this next to your name." }: { hint?: string }) {
  const { displayName, avatarUrl, loaded } = useCurrentAccount()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Clear the input so choosing the same file again still fires a change.
    event.target.value = ""
    if (!file || busy) return

    setError(null)
    setConfirmingRemove(false)
    setBusy("upload")
    const prepared = await prepareAvatarImage(file)
    if (!prepared.ok) {
      setBusy(null)
      setError(IMAGE_ERRORS[prepared.error])
      return
    }
    const result = await uploadAvatar(prepared.data)
    if (!result.ok) {
      setBusy(null)
      setError(result.error.message)
      return
    }
    await refreshAccount()
    setBusy(null)
    notify("Photo updated")
  }

  const handleRemove = async () => {
    setError(null)
    setBusy("remove")
    const result = await removeAvatar()
    if (!result.ok) {
      setBusy(null)
      setConfirmingRemove(false)
      setError(`Could not remove your photo. ${result.error.message}`)
      return
    }
    await refreshAccount()
    setBusy(null)
    setConfirmingRemove(false)
    notify("Photo removed")
  }

  return (
    <Section title="Photo" hint={hint}>
      <div className="flex items-center gap-4">
        <Avatar name={displayName} src={avatarUrl} size="xl" className="size-20 text-2xl" />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Choose a profile photo"
            data-testid="avatar-file-input"
            tabIndex={-1}
            onChange={(event) => void handleFile(event)}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={!loaded || busy !== null}>
            <Camera className="size-5" weight="bold" aria-hidden />
            {busy === "upload" ? "Uploading..." : avatarUrl ? "Change photo" : "Add photo"}
          </Button>
          {avatarUrl && !confirmingRemove ? (
            <Button variant="quiet" onClick={() => setConfirmingRemove(true)} disabled={busy !== null}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {busy === "upload" ? (
        <p role="status" className="sk-field-hint mt-3">
          Uploading your photo...
        </p>
      ) : null}
      {confirmingRemove ? (
        <InlineConfirm
          className="mt-4"
          question="Remove your photo? Your initials are shown instead."
          confirmLabel="Remove photo"
          cancelLabel="Keep it"
          busy={busy === "remove"}
          onConfirm={() => void handleRemove()}
          onCancel={() => setConfirmingRemove(false)}
        />
      ) : null}
      {error ? (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      ) : null}
    </Section>
  )
}

/** Name: for coaches, club admins and platform admins. Athletes edit first and last name on their profile. */
export function NameSection() {
  const { account, displayName, hasName, loaded } = useCurrentAccount()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const current = account?.displayName ?? ""
  const value = draft ?? current
  const changed = value.replace(/\s+/g, " ").trim() !== current

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const problem = validateDisplayName(value)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const result = await updateDisplayName(value)
    if (!result.ok) {
      setSaving(false)
      setError(result.error.code === "VALIDATION" ? result.error.message : `Could not save your name. ${result.error.message}`)
      return
    }
    await refreshAccount()
    setSaving(false)
    setDraft(null)
    setSaved(true)
  }

  return (
    <Section title="Name" hint={hasName || !loaded ? "How you appear to your club and in emails we send for you." : `You have not added a name yet, so we show "${displayName}" from your email.`}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Field label="Full name" error={error}>
          <Input
            name="name"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            value={value}
            disabled={!loaded}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
              setSaved(false)
            }}
          />
        </Field>
        {saved && !changed ? <Notice tone="success">Name saved.</Notice> : null}
        <div>
          <Button type="submit" disabled={!loaded || saving || !changed}>
            {saving ? "Saving..." : "Save name"}
          </Button>
        </div>
      </form>
    </Section>
  )
}

function ShowPasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <Button variant="quiet" size="sm" aria-pressed={shown} onClick={onToggle}>
      {shown ? <EyeSlash className="size-5" weight="bold" aria-hidden /> : <Eye className="size-5" weight="bold" aria-hidden />}
      {shown ? "Hide passwords" : "Show passwords"}
    </Button>
  )
}

/** Email and password, each behind a "Change" button so the screen stays short. */
export function SignInSection() {
  const { account } = useCurrentAccount()
  const { userEmail } = useRole()
  const email = account?.email ?? userEmail
  const [open, setOpen] = useState<"email" | "password" | null>(null)

  const [newEmail, setNewEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailBusy, setEmailBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const pendingEmail = sentTo ?? account?.pendingEmail ?? null

  const [currentPassword, setCurrentPassword] = useState("")
  const [nextPassword, setNextPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<{ current?: string; password?: string; confirm?: string }>({})
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)

  const closeForms = () => {
    setOpen(null)
    setNewEmail("")
    setEmailError(null)
    setCurrentPassword("")
    setNextPassword("")
    setConfirmPassword("")
    setPasswordErrors({})
    setPasswordError(null)
    setShowPasswords(false)
  }

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (emailBusy) return
    const problem = validateNewEmail(newEmail, email)
    if (problem) {
      setEmailError(problem)
      return
    }
    setEmailBusy(true)
    setEmailError(null)
    const result = await requestEmailChange(newEmail, email)
    setEmailBusy(false)
    if (!result.ok) {
      setEmailError(result.error.message)
      return
    }
    setSentTo(result.data.pendingEmail)
    closeForms()
  }

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (passwordBusy) return
    const errors: { current?: string; password?: string; confirm?: string } = validateNewPassword(nextPassword, confirmPassword)
    if (!currentPassword) errors.current = "Enter your current password."
    setPasswordErrors(errors)
    if (errors.current || errors.password || errors.confirm) {
      setPasswordError(null)
      return
    }
    setPasswordBusy(true)
    setPasswordError(null)
    const result = await changePassword(currentPassword, nextPassword)
    setPasswordBusy(false)
    if (!result.ok) {
      if (result.error.code === "FORBIDDEN") setPasswordErrors({ current: result.error.message })
      else setPasswordError(result.error.message)
      return
    }
    closeForms()
    setPasswordChanged(true)
  }

  const passwordType = showPasswords ? "text" : "password"

  return (
    <Section title="Sign-in">
      {open === "email" ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleEmailSubmit(event)} noValidate>
          <p className="sk-list-sub">
            You sign in with <span className="break-all font-semibold text-sk-ink">{email ?? "your current email"}</span>. We will send a confirmation link to the new address, and you may get one at your current address too, to check it is really you. Your email changes only after the links are opened. Until then you keep signing in with the current one.
          </p>
          <Field label="New email" error={emailError}>
            <Input
              type="email"
              name="new-email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={newEmail}
              onChange={(event) => {
                setNewEmail(event.target.value)
                setEmailError(null)
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={emailBusy}>
              {emailBusy ? "Sending..." : "Send confirmation link"}
            </Button>
            <Button variant="quiet" onClick={closeForms} disabled={emailBusy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : open === "password" ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handlePasswordSubmit(event)} noValidate>
          {/* Lets password managers attach the new password to the right account. */}
          <input type="email" name="username" autoComplete="username" value={email ?? ""} readOnly hidden />
          <Field label="Current password" error={passwordErrors.current}>
            <Input
              type={passwordType}
              name="current-password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value)
                setPasswordErrors((previous) => ({ ...previous, current: undefined }))
              }}
            />
          </Field>
          <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} error={passwordErrors.password}>
            <Input
              type={passwordType}
              name="new-password"
              autoComplete="new-password"
              value={nextPassword}
              onChange={(event) => {
                setNextPassword(event.target.value)
                setPasswordErrors((previous) => ({ ...previous, password: undefined }))
              }}
            />
          </Field>
          <Field label="Confirm new password" error={passwordErrors.confirm}>
            <Input
              type={passwordType}
              name="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value)
                setPasswordErrors((previous) => ({ ...previous, confirm: undefined }))
              }}
            />
          </Field>
          <div>
            <ShowPasswordToggle shown={showPasswords} onToggle={() => setShowPasswords((previous) => !previous)} />
          </div>
          {passwordError ? <Notice tone="error">{passwordError}</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={passwordBusy}>
              {passwordBusy ? "Saving..." : "Change password"}
            </Button>
            <Button variant="quiet" onClick={closeForms} disabled={passwordBusy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {pendingEmail ? (
            <Notice tone="info" className="mb-3">
              Check {pendingEmail} for a confirmation link (and your current inbox, in case we sent one there too). Your email changes once the links are opened. Until then you sign in with {email ?? "your current email"}.
            </Notice>
          ) : null}
          {passwordChanged ? (
            <Notice tone="success" className="mb-3">
              Password changed. Use the new one next time you sign in.
            </Notice>
          ) : null}
          <List>
            <ListRow
              title="Email"
              subtitle={<span className="break-all">{email ?? "Not available"}</span>}
              trailing={
                <Button
                  size="sm"
                  onClick={() => {
                    setPasswordChanged(false)
                    setOpen("email")
                  }}
                >
                  Change<span className="sr-only"> email</span>
                </Button>
              }
            />
            <ListRow
              title="Password"
              subtitle="Choose a new password for this account."
              trailing={
                <Button
                  size="sm"
                  onClick={() => {
                    setPasswordChanged(false)
                    setOpen("password")
                  }}
                >
                  Change<span className="sr-only"> password</span>
                </Button>
              }
            />
          </List>
        </>
      )}
    </Section>
  )
}

/** Sign out here, or everywhere else (a lost phone, a shared computer). */
export function DevicesSection() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignOutOthers = async () => {
    setBusy(true)
    setError(null)
    const result = await signOutOtherDevices()
    setBusy(false)
    setConfirming(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setDone(true)
  }

  const handleSignOut = async () => {
    if (getBackendMode() === "supabase") {
      const supabase = getBrowserSupabaseClient()
      if (supabase) await supabase.auth.signOut()
    } else {
      window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    }
    clearSessionCookies()
    navigate("/login")
  }

  return (
    <Section title="Devices">
      {done ? (
        <Notice tone="success" className="mb-3">
          Your other devices are signed out. This one stays signed in.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}
      {confirming ? (
        <InlineConfirm
          question="Sign out everywhere except this device?"
          confirmLabel="Sign out others"
          cancelLabel="Cancel"
          busy={busy}
          onConfirm={() => void handleSignOutOthers()}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <List>
          <ListRow
            title="Other devices"
            subtitle="Sign out of every other phone and browser."
            trailing={
              <Button
                size="sm"
                onClick={() => {
                  setDone(false)
                  setConfirming(true)
                }}
              >
                Sign out others
              </Button>
            }
          />
          <ListRow
            title="This device"
            trailing={
              <Button size="sm" variant="danger" onClick={() => void handleSignOut()}>
                Sign out
              </Button>
            }
          />
        </List>
      )}
    </Section>
  )
}

/**
 * Coaches only: whether the athletes of their teams see their email address on the athlete profile.
 * Off until the coach turns it on. Their name and photo are shown either way.
 */
export function CoachContactSection() {
  const { account } = useCurrentAccount()
  const { userEmail } = useRole()
  const email = account?.email ?? userEmail
  const [shown, setShown] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCurrentCoachContactVisibility().then((result) => {
      if (cancelled) return
      // A database without this setting yet behaves as "off".
      setShown(result.ok ? result.data : false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = async () => {
    if (shown === null || busy) return
    const next = !shown
    setBusy(true)
    setError(null)
    const result = await setCurrentCoachContactVisibility(next)
    setBusy(false)
    if (!result.ok) {
      setError(`Could not change this. ${result.error.message}`)
      return
    }
    setShown(next)
    notify(next ? "Your athletes can now see your email" : "Your email is hidden from athletes")
  }

  return (
    <Section title="Contact for athletes" hint="Athletes on your teams always see your name and photo. Your email is shown only if you choose.">
      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}
      <List>
        <ListRow
          title="Show my email to my athletes"
          subtitle={
            shown === null ? "Checking..." : shown ? <span className="break-all">On. They see {email ?? "your email"} on their profile.</span> : "Off. Athletes cannot see your email."
          }
          trailing={
            <Button size="sm" aria-pressed={Boolean(shown)} disabled={shown === null || busy} onClick={() => void handleToggle()}>
              {busy ? "Saving..." : shown ? "Hide email" : "Show email"}
            </Button>
          }
        />
      </List>
    </Section>
  )
}

export function HelpSection() {
  return (
    <Section title="Help">
      <List>
        <ListRow href={SUPPORT_MAILTO} title="Email support" subtitle={SUPPORT_EMAIL} />
        <ListRow to="/privacy" title="Privacy" subtitle="What we store and who can see it" />
        <ListRow to="/terms" title="Terms" subtitle="The rules for using SKTR Coach" />
      </List>
    </Section>
  )
}
