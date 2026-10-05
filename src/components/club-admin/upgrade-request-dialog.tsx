"use client"

import { useState, type FormEvent } from "react"
import { Button, Dialog, Field, FormActions, Notice, Textarea } from "@/components/sk"
import { getPackageById, type PackageId } from "@/lib/billing/package-catalog"
import { submitClubAdminPackageUpgradeRequest } from "@/lib/data/club-admin/ops-data"

/**
 * "Request a package upgrade": the short form behind the package limit notices on People and Teams.
 * It files the request for the SKTR team to review; nothing changes on the club until they approve.
 */
export function UpgradeRequestDialog({
  open,
  onOpenChange,
  currentPackage,
  targetPackage,
  placeholder,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPackage: PackageId | null
  targetPackage: PackageId | null
  /** What to write in the reason box ("Tell us why your club needs more coaches."). */
  placeholder: string
  onSent: (requestedPackage: PackageId) => void
}) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentLabel = getPackageById(currentPackage)?.label ?? "your current package"
  const targetLabel = getPackageById(targetPackage)?.label ?? targetPackage ?? "the next package"

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!targetPackage) return
    setSaving(true)
    setError(null)
    const result = await submitClubAdminPackageUpgradeRequest({ requestedPackage: targetPackage, reason })
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setReason("")
    onSent(targetPackage)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setError(null)
      }}
      title="Request a package upgrade"
      description={`Ask to move your club from ${currentLabel} to ${targetLabel}. We review every request.`}
      className="sm:max-w-md"
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Field label="Reason" optional>
          <Textarea rows={4} className="h-auto py-3" value={reason} placeholder={placeholder} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <FormActions>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !targetPackage}>
            {saving ? "Sending..." : "Send upgrade request"}
          </Button>
        </FormActions>
      </form>
    </Dialog>
  )
}
