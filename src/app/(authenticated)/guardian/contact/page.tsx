"use client"

import { useEffect, useState, type FormEvent } from "react"
import { GuardianChildScreen } from "@/components/guardian/guardian-frame"
import { Button, Field, Input, Notice, Screen, ScreenHeader, Section, SkeletonRows, notify } from "@/components/sk"
import { getGuardianContact, updateGuardianContact, validateGuardianContact } from "@/lib/data/guardian/guardian-data"
import type { GuardianChild } from "@/lib/data/guardian/types"

function ChildContact({ child }: { child: GuardianChild }) {
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: "name" | "phone" | "email"; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError(null)
    setFieldError(null)
    void getGuardianContact(child.athleteId).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setName(result.data.name ?? "")
        setPhone(result.data.phone ?? "")
        setEmail(result.data.email ?? "")
      } else {
        setError(result.error.message)
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [child.athleteId])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setError(null)
    const checked = validateGuardianContact({ name, phone, email })
    if (!checked.ok) {
      setFieldError({ field: checked.field, message: checked.message })
      return
    }
    setFieldError(null)
    setSaving(true)
    const result = await updateGuardianContact(child.athleteId, checked.contact)
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setName(result.data.name ?? "")
    setPhone(result.data.phone ?? "")
    setEmail(result.data.email ?? "")
    notify("Contact details saved")
  }

  return (
    <Screen width="narrow">
      <ScreenHeader back={{ to: "/guardian/home", label: "Home" }} title="Your contact details" lede={`How the coach and the club reach you about ${child.firstName}. This is the only thing you can change here.`} />
      <Section title={`Guardian contact for ${child.firstName}`} hint="The coaches of the team and the club's admins can see this.">
        {!loaded ? (
          <SkeletonRows rows={3} />
        ) : (
          <form className="flex flex-col gap-4 pt-3" onSubmit={save} noValidate>
            <Field label="Name" error={fieldError?.field === "name" ? fieldError.message : undefined}>
              <Input autoComplete="name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Phone" optional error={fieldError?.field === "phone" ? fieldError.message : undefined}>
              <Input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
            <Field label="Email" optional hint="This does not change the email you sign in with." error={fieldError?.field === "email" ? fieldError.message : undefined}>
              <Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving..." : "Save contact details"}
              </Button>
            </div>
          </form>
        )}
      </Section>
    </Screen>
  )
}

/** The one thing a guardian can change: the guardian contact the club holds for their child. */
export default function GuardianContactPage() {
  return <GuardianChildScreen title="Your contact details">{(child) => <ChildContact child={child} />}</GuardianChildScreen>
}
