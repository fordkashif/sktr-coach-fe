"use client"

import { useCallback, useEffect, useState } from "react"
import { Button, DataTable, EmptyState, InlineConfirm, Notice, Section, SkeletonRows, TableSub, Tag, notify, notifyError, type DataTableColumn } from "@/components/sk"
import { cancelGuardianInvite, GUARDIANS_CHANGED_EVENT, listClubGuardians, revokeGuardianLink } from "@/lib/data/guardian/guardian-admin-data"
import type { ClubGuardianRow } from "@/lib/data/guardian/types"

function shortDate(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

/**
 * Club admin, People: every parent or guardian with access to an athlete of the club, and every
 * open guardian invite, in their own list. Guardians are not staff and take no seat. Access is
 * given by invite from the athlete's page and removed here or there, at once.
 */
export function ClubGuardiansView({ onCount }: { onCount?: (count: number) => void }) {
  const [rows, setRows] = useState<ClubGuardianRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await listClubGuardians()
    if (result.ok) {
      setRows(result.data)
      setError(null)
      onCount?.(result.data.length)
    } else {
      setRows([])
      setError(result.error.message)
    }
  }, [onCount])

  useEffect(() => {
    void load()
    const onChange = () => void load()
    window.addEventListener(GUARDIANS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(GUARDIANS_CHANGED_EVENT, onChange)
  }, [load])

  const remove = async (row: ClubGuardianRow) => {
    if (busy) return
    setBusy(true)
    const result = row.kind === "link" ? await revokeGuardianLink(row.id) : await cancelGuardianInvite(row.id)
    setBusy(false)
    if (!result.ok) return notifyError(result.error.message)
    setConfirm(null)
    notify(row.kind === "link" ? "Access removed" : "Invite cancelled")
  }

  const key = (row: ClubGuardianRow) => `${row.kind}-${row.id}`

  const columns: DataTableColumn<ClubGuardianRow>[] = [
    {
      key: "guardian",
      header: "Guardian",
      cell: (row) => (
        <>
          {row.guardianName ?? row.email ?? "Guardian"}
          <TableSub>{[row.relationship, row.guardianName ? row.email : null].filter(Boolean).join(", ")}</TableSub>
        </>
      ),
    },
    {
      key: "athlete",
      header: "Athlete",
      cell: (row) => (
        <>
          {row.athleteName}
          <TableSub>{row.teamName ?? "No team"}</TableSub>
        </>
      ),
    },
    {
      key: "state",
      header: "Access",
      phone: "trailing",
      cell: (row) => (row.kind === "link" ? <Tag tone="green">Has access</Tag> : row.expired ? <Tag tone="coral">Invite expired</Tag> : <Tag tone="yellow">Invited</Tag>),
    },
    { key: "since", header: "Since", phone: "hide", cell: (row) => shortDate(row.since) },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      phone: "plain",
      cell: (row) => (
        <Button size="sm" variant="quiet" onClick={() => setConfirm(key(row))} aria-label={`${row.kind === "link" ? "Remove access" : "Cancel invite"} for ${row.guardianName ?? row.email ?? "guardian"} and ${row.athleteName}`}>
          {row.kind === "link" ? "Remove access" : "Cancel invite"}
        </Button>
      ),
    },
  ]

  return (
    <Section
      aria-label="Guardians"
      title="Parents and guardians"
      hint="People who can read about one athlete: the plan, results and team news. They are not staff and take no seat. A coach or a club admin invites them from the athlete's page."
      data-club-guardians
    >
      {error ? <Notice tone="error">{`Guardians could not be loaded. ${error}`}</Notice> : null}
      {rows === null ? (
        <SkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState title="No guardian has access" body="Open an athlete from their team and choose Invite a guardian. Each guardian gets their own sign-in and sees only the athletes they were invited for." />
      ) : (
        <DataTable
          caption="Parents and guardians with access, and open invites"
          columns={columns}
          rows={rows}
          rowKey={key}
          rowProps={(row) => ({ "data-guardian-row": `${row.email ?? ""}|${row.athleteName}` })}
          rowBelow={(row) =>
            confirm === key(row) ? (
              <InlineConfirm
                question={row.kind === "link" ? `Remove ${row.guardianName ?? "this guardian"}'s access to ${row.athleteName}? It ends at once.` : `Cancel the invite to ${row.email}? The link in their email stops working.`}
                confirmLabel={row.kind === "link" ? "Remove access" : "Cancel invite"}
                cancelLabel="Keep it"
                onConfirm={() => void remove(row)}
                onCancel={() => setConfirm(null)}
                busy={busy}
              />
            ) : null
          }
        />
      )}
    </Section>
  )
}
