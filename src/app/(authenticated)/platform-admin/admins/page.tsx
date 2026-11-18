import { useCallback, useEffect, useState } from "react"
import { Avatar, Button, Dialog, EmptyState, Field, FormActions, InlineConfirm, Input, Notice, Screen, ScreenHeader, Section, SkeletonRows, StatusText, TileGrid, notify } from "@/components/sk"
import { cn } from "@/lib/utils"
import { UserPlus } from "@phosphor-icons/react"
import { PlatformHomeTabs } from "@/components/ops/platform-tabs"
import { formatLocalDate, formatLocalDateTime } from "@/lib/data/platform-admin/tenants-data"
import { addPlatformAdmin, listPlatformAdmins, setPlatformAdminActive } from "@/lib/data/platform-admin/tools-data"
import { addAdminProblem, deactivateAdminProblem, type PlatformAdminContact } from "@/lib/data/platform-admin/tools-logic"
import { plural } from "@/lib/format/ops-format"

/** Who can use the platform admin screens. Add by email, switch off, switch back on. Every change is in the platform activity. */
export default function PlatformAdminAdminsPage() {
  const [admins, setAdmins] = useState<PlatformAdminContact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    const result = await listPlatformAdmins()
    if (result.ok) {
      setAdmins(result.data)
      setError(null)
    } else {
      setError(result.error.message)
      setAdmins((current) => current ?? [])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault()
    // The database checks again, and also knows every club member's email.
    const problem = addAdminProblem(email, admins ?? [])
    if (problem) {
      setFormError(problem)
      return
    }
    setBusy(true)
    const result = await addPlatformAdmin(email, name)
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    notify(`${email.trim().toLowerCase()} is now a platform admin`)
    setEmail("")
    setName("")
    setFormError(null)
    setAddOpen(false)
    await load()
  }

  const handleActive = async (admin: PlatformAdminContact, active: boolean) => {
    setBusy(true)
    setRowError(null)
    const result = await setPlatformAdminActive(admin.id, active)
    setBusy(false)
    if (!result.ok) {
      setRowError({ id: admin.id, text: result.error.message })
      setConfirmId(null)
      return
    }
    setConfirmId(null)
    notify(active ? `${admin.email} can use the platform screens again` : `${admin.email} can no longer use the platform screens`)
    await load()
  }

  const list = admins ?? []
  const activeCount = list.filter((admin) => admin.isActive).length

  const actionFor = (admin: PlatformAdminContact) => {
    if (!admin.isActive) {
      return (
        <Button size="sm" disabled={busy} onClick={() => void handleActive(admin, true)} aria-label={`Reactivate ${admin.email}`}>
          Reactivate
        </Button>
      )
    }
    const problem = deactivateAdminProblem(admin, list)
    if (problem) return <span className="text-sm text-sk-mute">{admin.isSelf && activeCount > 1 ? "You cannot switch yourself off" : "The last active admin"}</span>
    return (
      <Button size="sm" variant="danger" disabled={busy} aria-expanded={confirmId === admin.id} onClick={() => setConfirmId((current) => (current === admin.id ? null : admin.id))} aria-label={`Deactivate ${admin.email}`}>
        Deactivate
      </Button>
    )
  }


  return (
    <Screen>
      <ScreenHeader
        title="Platform admins"
        lede={admins === null ? "Who can use these screens." : `${plural(activeCount, "person", "people")} can use these screens. Every change here is written to the platform activity.`}
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <UserPlus className="size-5" weight="bold" aria-hidden />
            New admin
          </Button>
        }
      />
      <PlatformHomeTabs />

      {error ? <Notice tone="error">Could not load platform admins: {error}</Notice> : null}

      <Section title="Who has access" meta={admins ? `${activeCount} active of ${list.length}` : undefined}>
        {admins === null ? (
          <SkeletonRows rows={3} label="Loading platform admins" />
        ) : list.length === 0 ? (
          <EmptyState title="No platform admins to show" body="The list could not be read. Check again in a moment." />
        ) : (
          <TileGrid label="Platform admins">
            {list.map((admin) => (
              <li key={admin.id} className="sk-tile-item flex flex-col" data-admin={admin.email}>
                <div className={cn("sk-tile flex flex-1 flex-col gap-3 p-4", !admin.isActive && "opacity-70")}>
                  <div className="flex items-start justify-between gap-3">
                    <Avatar name={admin.displayName ?? admin.email} size="lg" className={admin.isActive ? "bg-sk-ink text-white" : "bg-sk-soft-2 text-sk-mute"} />
                    {admin.isActive ? <StatusText tone="green">Active</StatusText> : <StatusText tone="neutral">Switched off{admin.deactivatedAt ? ` ${formatLocalDate(admin.deactivatedAt)}` : ""}</StatusText>}
                  </div>
                  <div className="min-w-0">
                    <p className="break-words font-display text-[1.5rem] font-black uppercase leading-none text-sk-ink">
                      {admin.displayName ?? admin.email}
                      {admin.isSelf ? <span className="ml-1.5 align-middle font-sans text-sm font-bold normal-case text-sk-mute">(you)</span> : null}
                    </p>
                    {admin.displayName ? <p className="mt-1 break-all text-sm text-sk-mute">{admin.email}</p> : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-[14px] bg-white px-3 py-2">
                      <dt className="text-[0.6875rem] font-extrabold uppercase tracking-[0.04em] text-sk-mute">Added</dt>
                      <dd className="font-semibold text-sk-ink">{formatLocalDate(admin.addedAt)}</dd>
                      <dd className="text-[0.8125rem] text-sk-mute [overflow-wrap:anywhere]">{admin.addedByEmail ? `by ${admin.addedByEmail}` : "when the platform was set up"}</dd>
                    </div>
                    <div className="rounded-[14px] bg-white px-3 py-2">
                      <dt className="text-[0.6875rem] font-extrabold uppercase tracking-[0.04em] text-sk-mute">Last sign-in</dt>
                      <dd className="font-semibold text-sk-ink">{admin.lastSignInAt ? formatLocalDateTime(admin.lastSignInAt) : <span className="font-normal text-sk-mute">{admin.hasAccount ? "Not recorded" : "Has not signed in yet"}</span>}</dd>
                    </div>
                  </dl>
                  <div className="mt-auto flex justify-end">{actionFor(admin)}</div>
                </div>
                {confirmId === admin.id ? (
                  <InlineConfirm
                    className="mt-2"
                    question={`Switch off platform access for ${admin.email}? They are signed out of these screens straight away. You can switch them back on later.`}
                    confirmLabel="Deactivate"
                    cancelLabel="Keep access"
                    busy={busy}
                    onConfirm={() => void handleActive(admin, false)}
                    onCancel={() => setConfirmId(null)}
                  />
                ) : rowError?.id === admin.id ? (
                  <Notice tone="error" className="mt-2">
                    {rowError.text}
                  </Notice>
                ) : null}
              </li>
            ))}
          </TileGrid>
        )}
      </Section>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (busy) return
          setAddOpen(open)
          if (!open) setFormError(null)
        }}
        title="Add a platform admin"
        description="They get in by signing in with an account whose confirmed email is this one, an account they have already or a new one. The email must not be used by anyone in a club."
        className="sm:max-w-lg"
      >
        <form noValidate onSubmit={(event) => void handleAdd(event)} className="flex flex-col gap-4" data-add-admin>
          <Field label="Email" error={formError ?? undefined}>
            <Input
              type="email"
              autoComplete="off"
              autoFocus
              value={email}
              disabled={busy}
              onChange={(event) => {
                setEmail(event.target.value)
                setFormError(null)
              }}
            />
          </Field>
          <Field label="Name" optional>
            <Input value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} />
          </Field>
          <FormActions>
            <Button variant="quiet" disabled={busy} onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || email.trim() === ""}>
              {busy ? "Saving..." : "Add platform admin"}
            </Button>
          </FormActions>
        </form>
      </Dialog>
    </Screen>
  )
}
