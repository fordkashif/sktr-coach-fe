import { useCallback, useEffect, useState } from "react"
import { Button, DataTable, EmptyState, Field, FormActions, FormGrid, InlineConfirm, Input, Notice, Screen, ScreenHeader, Section, SkeletonRows, StatusText, TableSub, notify, type DataTableColumn } from "@/components/sk"
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

  const columns: Array<DataTableColumn<PlatformAdminContact>> = [
    {
      key: "who",
      header: "Platform admin",
      cell: (admin) => (
        <>
          <span className="break-words font-bold text-sk-ink">
            {admin.displayName ?? admin.email}
            {admin.isSelf ? <span className="font-normal text-sk-mute"> (you)</span> : null}
          </span>
          {admin.displayName ? (
            <TableSub>
              <span className="break-all">{admin.email}</span>
            </TableSub>
          ) : null}
        </>
      ),
    },
    {
      key: "state",
      header: "Access",
      phone: "plain",
      cell: (admin) =>
        admin.isActive ? (
          <StatusText tone="green">Active</StatusText>
        ) : (
          <StatusText tone="neutral">Switched off{admin.deactivatedAt ? ` ${formatLocalDate(admin.deactivatedAt)}` : ""}</StatusText>
        ),
    },
    {
      key: "added",
      header: "Added",
      cell: (admin) => (
        <span className="block">
          {formatLocalDate(admin.addedAt)}
          <span className="block text-sm text-sk-mute [overflow-wrap:anywhere]">{admin.addedByEmail ? `by ${admin.addedByEmail}` : "when the platform was set up"}</span>
        </span>
      ),
    },
    {
      key: "signin",
      header: "Last sign-in",
      cell: (admin) => (admin.lastSignInAt ? formatLocalDateTime(admin.lastSignInAt) : <span className="text-sk-mute">{admin.hasAccount ? "Not recorded" : "Has not signed in yet"}</span>),
    },
    {
      key: "action",
      header: "Change",
      align: "right",
      phone: "plain",
      cell: (admin) => {
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
      },
    },
  ]

  return (
    <Screen>
      <ScreenHeader
        title="Platform admins"
        lede={admins === null ? "Who can use these screens." : `${plural(activeCount, "person", "people")} can use these screens. Every change here is written to the platform activity.`}
      />
      <PlatformHomeTabs />

      {error ? <Notice tone="error">Could not load platform admins: {error}</Notice> : null}

      <Section title="Who has access" meta={admins ? `${activeCount} active of ${list.length}` : undefined}>
        {admins === null ? (
          <SkeletonRows rows={3} label="Loading platform admins" />
        ) : list.length === 0 ? (
          <EmptyState title="No platform admins to show" body="The list could not be read. Check again in a moment." />
        ) : (
          <DataTable
            caption="Platform admins"
            columns={columns}
            rows={list}
            rowKey={(admin) => admin.id}
            rowProps={(admin) => ({ "data-admin": admin.email })}
            rowBelow={(admin) =>
              confirmId === admin.id ? (
                <InlineConfirm
                  question={`Switch off platform access for ${admin.email}? They are signed out of these screens straight away. You can switch them back on later.`}
                  confirmLabel="Deactivate"
                  cancelLabel="Keep access"
                  busy={busy}
                  onConfirm={() => void handleActive(admin, false)}
                  onCancel={() => setConfirmId(null)}
                />
              ) : rowError?.id === admin.id ? (
                <Notice tone="error">{rowError.text}</Notice>
              ) : null
            }
          />
        )}
      </Section>

      <Section
        title="Add a platform admin"
        hint="They get in by signing in with an account whose confirmed email is this one, an account they have already or a new one. The email must not be used by anyone in a club."
      >
        <form noValidate onSubmit={(event) => void handleAdd(event)} className="mt-3 flex max-w-[720px] flex-col gap-4">
          <FormGrid>
            <Field label="Email" error={formError ?? undefined}>
              <Input
                type="email"
                autoComplete="off"
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
          </FormGrid>
          <FormActions>
            <Button type="submit" variant="primary" disabled={busy || email.trim() === ""}>
              {busy ? "Saving..." : "Add platform admin"}
            </Button>
          </FormActions>
        </form>
      </Section>
    </Screen>
  )
}
