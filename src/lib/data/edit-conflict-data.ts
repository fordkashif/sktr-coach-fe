import type { SupabaseClient } from "@supabase/supabase-js"
import { editConflictError, isStaleWrite, type EditConflict, type EditKind, type EditStamp } from "@/lib/data/edit-conflict"
import { mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Who changed a record last, and when, for the four things two people can have open at once:
 * a training plan, a test week's setup, a team's details and the club profile.
 *
 * Supabase mode: updated_at (kept by set_updated_at) and updated_by_user_id (stamped by trigger,
 * migration 20261017120000) on the row itself, read under the table's own select policy. The save
 * functions send their update with "where updated_at = <loaded>"; this file explains a save that
 * matched no row.
 * Mock mode: a small per-club map in localStorage, written on every mock save of those records, so
 * a second tab (or a test) changing the record is caught the same way.
 */

const TABLES: Record<EditKind, { table: string; key: string }> = {
  plan: { table: "training_plans", key: "id" },
  "test-week": { table: "test_weeks", key: "id" },
  team: { table: "teams", key: "id" },
  "club-profile": { table: "club_profiles", key: "tenant_id" },
}

/** The club profile is one row per club: its id here is always this. */
export const CLUB_PROFILE_EDIT_ID = "club"

const MOCK_KEY = "pacelab:edit-stamps:v1"
type MockStamp = { updatedAt: string; byName: string | null }

function readMockStamps(): Record<string, MockStamp> {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(MOCK_KEY))
    const parsed = raw ? (JSON.parse(raw) as Record<string, MockStamp>) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

const NEVER: EditStamp = { updatedAt: null, changedByName: null, changedBySelf: false }

function mockStamp(kind: EditKind, id: string): EditStamp {
  const stored = readMockStamps()[`${kind}:${id}`]
  if (!stored || typeof stored.updatedAt !== "string") return NEVER
  const name = typeof stored.byName === "string" && stored.byName.trim() ? stored.byName.trim() : null
  // With no name on it, the change came from this browser: the same demo account in another tab.
  return { updatedAt: stored.updatedAt, changedByName: name, changedBySelf: name === null }
}

/** Mock mode only: note that this record was just saved here. Returns the new stamp. */
export function recordMockEdit(kind: EditKind, id: string): string {
  const updatedAt = new Date().toISOString()
  try {
    const stamps = readMockStamps()
    stamps[`${kind}:${id}`] = { updatedAt, byName: null }
    window.localStorage.setItem(tenantStorageKey(MOCK_KEY), JSON.stringify(stamps))
  } catch {
    // Without storage there is nothing to compare against later; saving still works.
  }
  return updatedAt
}

async function supabaseStamp(client: SupabaseClient, kind: EditKind, id: string): Promise<Result<EditStamp>> {
  const { table, key } = TABLES[kind]
  let query = client.from(table).select("updated_at, updated_by_user_id")
  // The club profile is read by row policy (one row: the caller's own club).
  if (kind !== "club-profile") query = query.eq(key, id)
  const first = await query.limit(1).maybeSingle()
  let data: unknown = first.data
  if (first.error) {
    // Before migration 20261017120000 there is no updated_by_user_id: the time alone still tells a conflict.
    let fallback = client.from(table).select("updated_at")
    if (kind !== "club-profile") fallback = fallback.eq(key, id)
    const second = await fallback.limit(1).maybeSingle()
    if (second.error) return { ok: false, error: mapPostgrestError(second.error) }
    data = second.data ? { ...(second.data as { updated_at: string | null }), updated_by_user_id: null } : null
  }
  const row = data as { updated_at: string | null; updated_by_user_id: string | null } | null
  if (!row) return ok(NEVER)

  let changedByName: string | null = null
  let changedBySelf = false
  if (row.updated_by_user_id) {
    const { data: userData } = await client.auth.getUser()
    changedBySelf = userData.user?.id === row.updated_by_user_id
    if (!changedBySelf) {
      const profile = await client.from("profiles").select("display_name").eq("user_id", row.updated_by_user_id).maybeSingle()
      const name = (profile.data as { display_name: string | null } | null)?.display_name?.trim()
      // First name only: "Andre changed this plan".
      changedByName = name ? name.split(/\s+/)[0] : null
    }
  }
  return ok({ updatedAt: row.updated_at ?? null, changedByName, changedBySelf })
}

/** The record's stamp right now. Call it when an edit form opens and keep `updatedAt` for the save. */
export async function getEditStamp(kind: EditKind, id: string): Promise<Result<EditStamp>> {
  if (getBackendMode() !== "supabase") return ok(mockStamp(kind, id))
  const client = getBrowserSupabaseClient()
  if (!client) return ok(NEVER)
  return supabaseStamp(client, kind, id)
}

/**
 * The conflict, when the record is no longer the one that was loaded. Null when it is unchanged,
 * when the editor is not tracking it (`expectedUpdatedAt` undefined), or when the stamp cannot be
 * read (the save's own error is the one to show then).
 */
export async function findEditConflict(kind: EditKind, id: string, expectedUpdatedAt: string | null | undefined): Promise<EditConflict | null> {
  if (expectedUpdatedAt === undefined) return null
  const stamp = await getEditStamp(kind, id)
  if (!stamp.ok || !isStaleWrite(expectedUpdatedAt, stamp.data.updatedAt)) return null
  return { kind, changedAt: stamp.data.updatedAt, changedByName: stamp.data.changedByName, changedBySelf: stamp.data.changedBySelf }
}

/** The same check as an error, for a save function to return. */
export async function staleWriteError(kind: EditKind, id: string, expectedUpdatedAt: string | null | undefined): Promise<DataError | null> {
  const conflict = await findEditConflict(kind, id, expectedUpdatedAt)
  return conflict ? editConflictError(conflict) : null
}

/** What every save of these records may be given. */
export type EditGuard = {
  /** updated_at as loaded. Leave out to save without the check (new records). */
  expectedUpdatedAt?: string | null
  /** "Save mine anyway": skip the check. */
  overwrite?: boolean
}

/** The stamp to send with the update, or undefined when the save should not be checked. */
export function guardStamp(guard: EditGuard | undefined): string | null | undefined {
  if (!guard || guard.overwrite) return undefined
  return guard.expectedUpdatedAt
}
