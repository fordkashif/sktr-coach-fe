import { dataRightsClient, isMockMode, mapDataRightsError } from "@/lib/data/account/data-rights-data"
import { err, ok, type Result } from "@/lib/data/result"
import { isTypedConfirmation } from "@/lib/data-rights"
import { deleteMockClosedClub, loadMockClubClosures, reopenMockClub } from "@/lib/mock-data-rights"
import { invokeSignedIn } from "@/lib/supabase/invoke"

/**
 * Closed clubs, for the platform admin: a club its owner closed, with the date after which it is
 * deleted for good. A platform admin can reopen one before that date or delete it now.
 * Supabase mode: get_closed_clubs, reopen_closed_club and delete_closed_club (20261014120000).
 */

export type ClosedClub = {
  tenantId: string
  clubName: string
  closedAt: string
  deleteAfter: string
  closedByName: string | null
  memberCount: number
  athleteCount: number
}

export async function getClosedClubs(): Promise<Result<ClosedClub[]>> {
  if (isMockMode()) {
    return ok(
      loadMockClubClosures()
        .filter((closure) => !closure.reopenedAt && !closure.deletedAt)
        .map((closure) => ({
          tenantId: closure.tenantId,
          clubName: closure.clubName,
          closedAt: closure.closedAt,
          deleteAfter: closure.deleteAfter,
          closedByName: closure.closedByName,
          memberCount: closure.memberCount,
          athleteCount: closure.athleteCount,
        })),
    )
  }
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("get_closed_clubs")
  if (error) return { ok: false, error: mapDataRightsError(error) }
  return ok(
    ((data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
      tenantId: String(row.tenant_id),
      clubName: String(row.club_name ?? "Club"),
      closedAt: String(row.closed_at),
      deleteAfter: String(row.delete_after),
      closedByName: (row.closed_by_name as string | null) ?? null,
      memberCount: Number(row.member_count) || 0,
      athleteCount: Number(row.athlete_count) || 0,
    })),
  )
}

/** Opens a closed club again. Its members can sign in as before and the deletion date is gone. */
export async function reopenClosedClub(tenantId: string): Promise<Result<null>> {
  if (isMockMode()) return reopenMockClub(tenantId) ? ok(null) : err("NOT_FOUND", "This club is not closed.")
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.rpc("reopen_closed_club", { p_tenant_id: tenantId })
  if (error) return { ok: false, error: mapDataRightsError(error) }
  return ok(null)
}

export type ClubDeletionResult = {
  accountsDeleted: number
  /** Photo and logo files waiting to be removed from storage. */
  filesQueued: number
  /** False when the storage clean-up could not be started; it runs again with the daily job. */
  filesRemovedNow: boolean
}

/**
 * Deletes a closed club for good: every row, its members' logins, and (through the storage
 * clean-up function) its files. `typedName` is the club's name as typed; the database checks it,
 * the caller and that the club is still closed.
 */
export async function deleteClosedClub(club: Pick<ClosedClub, "tenantId" | "clubName">, typedName: string): Promise<Result<ClubDeletionResult>> {
  if (!isTypedConfirmation(club.clubName, typedName)) return err("VALIDATION", "Type the club's name exactly to delete it.")
  if (isMockMode()) {
    return deleteMockClosedClub(club.tenantId) ? ok({ accountsDeleted: 0, filesQueued: 0, filesRemovedNow: true }) : err("NOT_FOUND", "This club is not closed, so it cannot be deleted.")
  }
  const client = dataRightsClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("delete_closed_club", { p_tenant_id: club.tenantId, p_confirm_name: typedName })
  if (error) return { ok: false, error: mapDataRightsError(error) }
  const row = data as { accounts_deleted?: number; files_queued?: number } | null
  const filesQueued = Number(row?.files_queued) || 0

  // SQL cannot remove storage files. The clean-up function does, with the Storage API.
  let filesRemovedNow = filesQueued === 0
  if (filesQueued > 0) {
    try {
      const purge = await invokeSignedIn<{ ok?: boolean; failed?: number }>(client, "purge-deleted-storage", { body: { source: "platform-admin" } })
      filesRemovedNow = !purge.error && purge.data?.ok === true && (purge.data.failed ?? 0) === 0
    } catch {
      filesRemovedNow = false
    }
  }
  return ok({ accountsDeleted: Number(row?.accounts_deleted) || 0, filesQueued, filesRemovedNow })
}
