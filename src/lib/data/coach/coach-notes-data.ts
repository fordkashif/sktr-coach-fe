import { getCurrentAccount } from "@/lib/data/account/account-data"
import { mockSessionIdentity } from "@/lib/data/coach/roster-mock"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { todayIso } from "@/lib/data/training-plan/plan-builder-model"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Private notes coaches keep about an athlete (public.coach_athlete_notes, 20261012100000).
 *
 * Staff only. The database returns them to the coaches of the athlete's current team and to club
 * admins, and to nobody else: there is no athlete policy at all. Nothing in the athlete's side of
 * the app reads this module, and no export includes these notes. Mock mode keeps them in their own
 * key in this browser, apart from everything the demo athlete reads.
 */

export const COACH_NOTE_MAX_LENGTH = 2000

export type CoachNote = {
  id: string
  athleteId: string
  authorName: string
  /** ISO day the note is about. */
  date: string
  body: string
  pinned: boolean
  createdAt: string
  /** Set when the text or day was changed after it was written. */
  edited: boolean
  /** The signed-in person wrote it: they may change it and pin it. */
  canEdit: boolean
  /** The author, or a club admin. */
  canDelete: boolean
}

export type CoachNoteInput = { body: string; date: string; pinned: boolean }

/** Pinned first, then the newest day, then the newest written. */
export function sortCoachNotes(notes: CoachNote[]): CoachNote[] {
  return [...notes].sort(
    (left, right) => Number(right.pinned) - Number(left.pinned) || right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt),
  )
}

function validate(input: Partial<CoachNoteInput>): string | null {
  if (input.body !== undefined) {
    const body = input.body.trim()
    if (!body) return "Write the note first."
    if (body.length > COACH_NOTE_MAX_LENGTH) return `Keep the note under ${COACH_NOTE_MAX_LENGTH} characters.`
  }
  if (input.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Choose the day the note is about."
    if (input.date > todayIso()) return "The day cannot be in the future."
  }
  return null
}

/* Mock mode ------------------------------------------------------------------------------------- */

const MOCK_KEY = "pacelab:coach-athlete-notes:v1"

type MockNote = { id: string; athleteId: string; authorEmail: string; authorName: string; date: string; body: string; pinned: boolean; createdAt: string; updatedAt: string }

function readMock(): MockNote[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_KEY)) ?? "[]") as unknown
    return Array.isArray(parsed) ? (parsed as MockNote[]) : []
  } catch {
    return []
  }
}

function writeMock(notes: MockNote[]): boolean {
  try {
    window.localStorage.setItem(tenantStorageKey(MOCK_KEY), JSON.stringify(notes))
    return true
  } catch {
    return false
  }
}

const STORAGE_BLOCKED = "Could not save in this browser. Storage may be full or blocked."

function mockStaff(): { email: string; isAdmin: boolean } | null {
  const identity = mockSessionIdentity()
  if (identity.role !== "coach" && identity.role !== "club-admin") return null
  return { email: (identity.email ?? "").toLowerCase(), isAdmin: identity.role === "club-admin" }
}

function fromMock(note: MockNote, staff: { email: string; isAdmin: boolean }): CoachNote {
  const mine = note.authorEmail === staff.email
  return {
    id: note.id,
    athleteId: note.athleteId,
    authorName: note.authorName,
    date: note.date,
    body: note.body,
    pinned: note.pinned,
    createdAt: note.createdAt,
    edited: note.updatedAt !== note.createdAt,
    canEdit: mine,
    canDelete: mine || staff.isAdmin,
  }
}

/* Supabase -------------------------------------------------------------------------------------- */

const COLUMNS = "id, athlete_id, author_user_id, note_date, body, pinned, created_at, updated_at"

type Row = { id: string; athlete_id: string; author_user_id: string | null; note_date: string; body: string; pinned: boolean; created_at: string; updated_at: string }

async function staffContext() {
  const client = getBrowserSupabaseClient()
  if (!client) return err<never>("UNKNOWN", "Supabase client is not configured.")
  const { data } = await client.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) return err<never>("UNAUTHORIZED", "You are signed out. Sign in again.")
  const { data: profile } = await client.from("profiles").select("role").eq("user_id", userId).maybeSingle()
  return ok({ client, userId, isAdmin: (profile?.role as string | undefined) === "club-admin" })
}

function fromRow(row: Row, names: Map<string, string>, userId: string, isAdmin: boolean): CoachNote {
  const mine = row.author_user_id === userId
  return {
    id: row.id,
    athleteId: row.athlete_id,
    authorName: (row.author_user_id ? names.get(row.author_user_id) : null) ?? "A former coach",
    date: row.note_date,
    body: row.body,
    pinned: row.pinned,
    createdAt: row.created_at,
    // The pin does not count as an edit, so compare loosely: a change within the first minute is the same writing.
    edited: new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 60_000,
    canEdit: mine,
    canDelete: mine || isAdmin,
  }
}

/* The four things a coach does -------------------------------------------------------------------- */

/** Every note about this athlete the caller may read, pinned first then newest first. */
export async function listCoachNotes(athleteId: string): Promise<Result<CoachNote[]>> {
  if (getBackendMode() !== "supabase") {
    const staff = mockStaff()
    if (!staff) return err("FORBIDDEN", "Only coaches and club admins can see coach notes.")
    return ok(sortCoachNotes(readMock().filter((note) => note.athleteId === athleteId).map((note) => fromMock(note, staff))))
  }
  try {
    const context = await staffContext()
    if (!context.ok) return context
    const { client, userId, isAdmin } = context.data
    const { data, error } = await client.from("coach_athlete_notes").select(COLUMNS).eq("athlete_id", athleteId).order("note_date", { ascending: false }).limit(300)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const rows = (data as Row[] | null) ?? []
    const authorIds = [...new Set(rows.map((row) => row.author_user_id).filter((id): id is string => Boolean(id)))]
    const names = new Map<string, string>()
    if (authorIds.length > 0) {
      const profiles = await client.from("profiles").select("user_id, display_name").in("user_id", authorIds)
      for (const profile of (profiles.data as Array<{ user_id: string; display_name: string | null }> | null) ?? []) {
        if (profile.display_name?.trim()) names.set(profile.user_id, profile.display_name.trim())
      }
    }
    return ok(sortCoachNotes(rows.map((row) => fromRow(row, names, userId, isAdmin))))
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

export async function addCoachNote(athleteId: string, input: CoachNoteInput): Promise<Result<null>> {
  const problem = validate(input)
  if (problem) return err("VALIDATION", problem)
  const body = input.body.trim()
  if (getBackendMode() !== "supabase") {
    const staff = mockStaff()
    if (!staff) return err("FORBIDDEN", "Only coaches and club admins can add coach notes.")
    const account = await getCurrentAccount()
    const now = new Date().toISOString()
    const note: MockNote = {
      id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      athleteId,
      authorEmail: staff.email,
      authorName: (account.ok ? account.data.displayName : null) ?? (staff.isAdmin ? "Club admin" : "Coach"),
      date: input.date,
      body,
      pinned: input.pinned,
      createdAt: now,
      updatedAt: now,
    }
    return writeMock([...readMock(), note]) ? ok(null) : err("UNKNOWN", STORAGE_BLOCKED)
  }
  try {
    const context = await staffContext()
    if (!context.ok) return context
    // The database stamps the club and the author (coach_athlete_notes_normalise); they are sent so the policy can be checked.
    const { data: athlete, error: athleteError } = await context.data.client.from("athletes").select("tenant_id").eq("id", athleteId).maybeSingle()
    if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
    if (!athlete) return err("NOT_FOUND", "This athlete is not on a team you coach.")
    const { error } = await context.data.client
      .from("coach_athlete_notes")
      .insert({ tenant_id: athlete.tenant_id as string, athlete_id: athleteId, author_user_id: context.data.userId, note_date: input.date, body, pinned: input.pinned })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

/** Changes the text, the day or the pin of a note the caller wrote. */
export async function updateCoachNote(noteId: string, patch: Partial<CoachNoteInput>): Promise<Result<null>> {
  const problem = validate(patch)
  if (problem) return err("VALIDATION", problem)
  if (getBackendMode() !== "supabase") {
    const staff = mockStaff()
    const notes = readMock()
    const existing = notes.find((note) => note.id === noteId)
    if (!staff || !existing || existing.authorEmail !== staff.email) return err("FORBIDDEN", "Only the person who wrote a note can change it.")
    const textChanged = (patch.body !== undefined && patch.body.trim() !== existing.body) || (patch.date !== undefined && patch.date !== existing.date)
    const next: MockNote = {
      ...existing,
      body: patch.body !== undefined ? patch.body.trim() : existing.body,
      date: patch.date ?? existing.date,
      pinned: patch.pinned ?? existing.pinned,
      updatedAt: textChanged ? new Date().toISOString() : existing.updatedAt,
    }
    return writeMock(notes.map((note) => (note.id === noteId ? next : note))) ? ok(null) : err("UNKNOWN", STORAGE_BLOCKED)
  }
  try {
    const context = await staffContext()
    if (!context.ok) return context
    const change: Record<string, unknown> = {}
    if (patch.body !== undefined) change.body = patch.body.trim()
    if (patch.date !== undefined) change.note_date = patch.date
    if (patch.pinned !== undefined) change.pinned = patch.pinned
    const { data, error } = await context.data.client.from("coach_athlete_notes").update(change).eq("id", noteId).select("id")
    if (error) return { ok: false, error: mapPostgrestError(error) }
    if (((data as unknown[] | null) ?? []).length === 0) return err("FORBIDDEN", "Only the person who wrote a note can change it.")
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}

export async function deleteCoachNote(noteId: string): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") {
    const staff = mockStaff()
    const notes = readMock()
    const existing = notes.find((note) => note.id === noteId)
    if (!staff || !existing || (existing.authorEmail !== staff.email && !staff.isAdmin)) return err("FORBIDDEN", "Only the person who wrote a note can remove it.")
    return writeMock(notes.filter((note) => note.id !== noteId)) ? ok(null) : err("UNKNOWN", STORAGE_BLOCKED)
  }
  try {
    const context = await staffContext()
    if (!context.ok) return context
    const { data, error } = await context.data.client.from("coach_athlete_notes").delete().eq("id", noteId).select("id")
    if (error) return { ok: false, error: mapPostgrestError(error) }
    if (((data as unknown[] | null) ?? []).length === 0) return err("FORBIDDEN", "Only the person who wrote a note can remove it.")
    return ok(null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}
