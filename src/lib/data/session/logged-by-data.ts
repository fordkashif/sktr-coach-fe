import { err, ok, type Result } from "@/lib/data/result"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Who entered a session when it was not the athlete: a coach or club admin logging it for them.
 * Supabase: get_session_logged_by (20261012100000), which answers the athlete of the session, the
 * coaches of their team and club admins. Mock: kept in this browser when the demo coach logs.
 */

export type SessionLoggedBy = { name: string | null; role: string | null }

/** The signed-in athlete of mock mode (the same id session-mock.ts uses). */
const MOCK_SELF_ATHLETE_ID = "a1"
const MOCK_KEY = "pacelab:session-logged-by:v1"

function readMock(): Record<string, SessionLoggedBy> {
  if (typeof window === "undefined") return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_KEY)) ?? "{}") as Record<string, SessionLoggedBy>
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Mock mode: the session ids of one athlete that a staff member entered. */
export function mockStaffEnteredSessionIds(athleteId: string): Set<string> {
  const prefix = `${athleteId}|`
  return new Set(
    Object.keys(readMock())
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  )
}

/** Mock mode: remembers that a staff member entered this session. The first one to do so stays, as on the real backend. */
export function recordMockLoggedBy(athleteId: string, sessionId: string, by: SessionLoggedBy) {
  try {
    const all = readMock()
    const key = `${athleteId}|${sessionId}`
    if (all[key]) return
    window.localStorage.setItem(tenantStorageKey(MOCK_KEY), JSON.stringify({ ...all, [key]: by }))
  } catch {
    // Best effort: the log itself is saved elsewhere.
  }
}

/** Null when the athlete logged it themselves, or nothing is logged yet. */
export async function getSessionLoggedBy(sessionId: string, athleteId: string = MOCK_SELF_ATHLETE_ID): Promise<Result<SessionLoggedBy | null>> {
  if (getBackendMode() !== "supabase") return ok(readMock()[`${athleteId}|${sessionId}`] ?? null)
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  try {
    const { data, error } = await client.rpc("get_session_logged_by", { p_session_id: sessionId })
    // A hint only. A database without the function yet, or a refusal, shows nothing.
    if (error) return ok(null)
    const row = ((data as Array<{ display_name: string | null; role: string | null }> | null) ?? [])[0]
    return ok(row ? { name: row.display_name, role: row.role } : null)
  } catch (cause) {
    return err("UNKNOWN", "Could not reach the server.", cause)
  }
}
