import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { readMockEvents, writeMockEvents } from "./mock-calendar-store"
import { canManageEvent, eventVisibleTo, validateClubEvent, type CalendarViewer, type ClubEvent, type ClubEventInput } from "./model"

/**
 * Club events: dated things of the club that are not training (a parents' meeting, a camp, a closure).
 *
 * Supabase mode (migration 20261014100000): tables club_events and club_event_teams, read through
 * row policies (club admins: every event of their club; coaches: whole club events and those of the
 * teams they coach; athletes: whole club events and those of their team). Writes go through
 * save_club_event and delete_club_event, which let a coach change events of their own teams only.
 * Mock mode keeps the events in this browser and applies the same rules from model.ts.
 */

export const CLUB_EVENTS_CHANGED_EVENT = "pacelab:club-events-changed"

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLUB_EVENTS_CHANGED_EVENT))
}

type Row = {
  id: string
  title: string
  starts_on: string
  ends_on: string
  start_time: string | null
  end_time: string | null
  place: string | null
  note: string | null
  audience: "club" | "teams"
  created_by_role: string | null
  club_event_teams: Array<{ team_id: string }> | null
}

function mapRow(row: Row): ClubEvent {
  return {
    id: row.id,
    title: row.title,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    endTime: row.end_time ? row.end_time.slice(0, 5) : null,
    place: row.place,
    note: row.note,
    audience: row.audience,
    teamIds: (row.club_event_teams ?? []).map((link) => link.team_id),
    createdByRole: row.created_by_role,
  }
}

/** The events the viewer may see that touch the range, oldest first. `viewer` filters in mock mode; the database filters otherwise. */
export async function listClubEvents(range: { from: string; to: string }, viewer: CalendarViewer): Promise<Result<ClubEvent[]>> {
  if (getBackendMode() !== "supabase") {
    return ok(
      readMockEvents()
        .filter((event) => event.endsOn >= range.from && event.startsOn <= range.to && eventVisibleTo(event, viewer))
        .sort((left, right) => left.startsOn.localeCompare(right.startsOn)),
    )
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client
    .from("club_events")
    .select("id, title, starts_on, ends_on, start_time, end_time, place, note, audience, created_by_role, club_event_teams(team_id)")
    .gte("ends_on", range.from)
    .lte("starts_on", range.to)
    .order("starts_on", { ascending: true })
    .limit(500)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as Row[] | null) ?? []).map(mapRow))
}

function clean(input: ClubEventInput): ClubEventInput {
  return {
    ...input,
    title: input.title.trim(),
    endsOn: input.endsOn || input.startsOn,
    startTime: input.startTime || null,
    endTime: input.startTime ? input.endTime || null : null,
    place: input.place?.trim() || null,
    note: input.note?.trim() || null,
    teamIds: input.audience === "teams" ? [...new Set(input.teamIds)] : [],
  }
}

/** Adds an event, or changes the one with `input.id`. */
export async function saveClubEvent(raw: ClubEventInput, viewer: CalendarViewer): Promise<Result<{ id: string }>> {
  const input = clean(raw)
  const problem = validateClubEvent(input, viewer)
  if (problem) return err("VALIDATION", problem)

  if (getBackendMode() !== "supabase") {
    try {
      const events = readMockEvents()
      const existing = input.id ? events.find((event) => event.id === input.id) : null
      if (input.id && !existing) return err("NOT_FOUND", "This event is not here any more.")
      if (existing && !canManageEvent(existing, viewer)) return err("FORBIDDEN", "You cannot change this event.")
      const id = existing?.id ?? `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const saved: ClubEvent = { ...input, id, createdByRole: existing?.createdByRole ?? viewer.role }
      writeMockEvents(existing ? events.map((event) => (event.id === id ? saved : event)) : [...events, saved])
      announce()
      return ok({ id })
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("save_club_event", {
    p_id: input.id ?? null,
    p_title: input.title,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_place: input.place,
    p_note: input.note,
    p_audience: input.audience,
    p_team_ids: input.teamIds,
  })
  if (error) {
    // The database writes its refusals in plain words (22023: something to fix, 42501: not allowed).
    if (error.code === "22023") return err("VALIDATION", error.message, error)
    if (error.code === "42501" && /event|coach/i.test(error.message) && !/paused/i.test(error.message)) return err("FORBIDDEN", error.message, error)
    return { ok: false, error: mapPostgrestError(error) }
  }
  announce()
  return ok({ id: String(data) })
}

export async function deleteClubEvent(id: string, viewer: CalendarViewer): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") {
    try {
      const events = readMockEvents()
      const existing = events.find((event) => event.id === id)
      if (existing && !canManageEvent(existing, viewer)) return err("FORBIDDEN", "You cannot delete this event.")
      writeMockEvents(events.filter((event) => event.id !== id))
      announce()
      return ok(null)
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.rpc("delete_club_event", { p_id: id })
  if (error) {
    if (error.code === "42501" && /event/i.test(error.message)) return err("FORBIDDEN", error.message, error)
    return { ok: false, error: mapPostgrestError(error) }
  }
  announce()
  return ok(null)
}
