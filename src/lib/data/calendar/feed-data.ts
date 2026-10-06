import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode, getSupabasePublicConfig } from "@/lib/supabase/config"
import { calendarFeedUrl } from "../../../../supabase/functions/_shared/calendar-feed"
import { readMockFeed, writeMockFeed } from "./mock-calendar-store"

/**
 * The private calendar feed link of the signed-in person.
 *
 * Supabase mode (migration 20261014100000): get_calendar_feed_status, turn_on_calendar_feed and
 * turn_off_calendar_feed. The database keeps a hash of the link only, so the link can be shown once,
 * right after it is made. Making a new link stops the old one. The link is served by the
 * calendar-feed server function.
 * Mock mode: the switch is remembered in this browser and the link is a sample that goes nowhere.
 */

export type CalendarFeedStatus = { on: boolean; linkMadeAt: string | null }

/** A new link. `sample` is true in mock mode, where nothing serves it. */
export type CalendarFeedLink = { url: string; sample: boolean; linkMadeAt: string }

const SAMPLE_URL = "https://your-club.example/functions/v1/calendar-feed/sample-link-only-works-in-the-live-app.ics"

export async function getCalendarFeedStatus(): Promise<Result<CalendarFeedStatus>> {
  if (getBackendMode() !== "supabase") {
    const state = readMockFeed()
    return ok({ on: state.on, linkMadeAt: state.madeAt })
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("get_calendar_feed_status")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  const row = (Array.isArray(data) ? data[0] : data) as { is_on?: boolean; link_made_at?: string | null } | null
  return ok({ on: Boolean(row?.is_on), linkMadeAt: row?.link_made_at ?? null })
}

/** Turns the feed on, or replaces the link when it is already on. The old link stops working. */
export async function makeCalendarFeedLink(): Promise<Result<CalendarFeedLink>> {
  const now = new Date().toISOString()
  if (getBackendMode() !== "supabase") {
    try {
      writeMockFeed({ on: true, madeAt: now })
      return ok({ url: SAMPLE_URL, sample: true, linkMadeAt: now })
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
  }
  const client = getBrowserSupabaseClient()
  const config = getSupabasePublicConfig()
  if (!client || !config) return err("UNKNOWN", "Supabase client is not configured.")
  const { data, error } = await client.rpc("turn_on_calendar_feed")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (typeof data !== "string" || !data) return err("UNKNOWN", "The link could not be made. Try again.")
  return ok({ url: calendarFeedUrl(`${config.url.replace(/\/+$/, "")}/functions/v1`, data), sample: false, linkMadeAt: now })
}

export async function turnOffCalendarFeed(): Promise<Result<null>> {
  if (getBackendMode() !== "supabase") {
    try {
      writeMockFeed({ on: false, madeAt: null })
      return ok(null)
    } catch {
      return err("UNKNOWN", "Could not save in this browser. Storage may be full or blocked.")
    }
  }
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { error } = await client.rpc("turn_off_calendar_feed")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(null)
}
