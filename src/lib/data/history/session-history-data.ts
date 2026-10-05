import { summariseLogged, type SessionHistoryEntry } from "@/lib/data/history/session-history"
import { mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { listAthleteSessions } from "@/lib/data/session/session-log-data"
import { listMockLoggedSessions, MOCK_ATHLETE_ID } from "@/lib/data/session/session-mock"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The signed-in athlete's sessions between two days (inclusive), newest first, each with a few
 * words on what was logged. Read only: it uses the session log's own list (listAthleteSessions)
 * and adds the summary from session_row_logs. Nothing is stored for the history screen.
 */
export async function loadSessionHistory(from: string, to: string): Promise<Result<SessionHistoryEntry[]>> {
  const sessionsResult = await listAthleteSessions(from, to)
  if (!sessionsResult.ok) return sessionsResult
  const sessions = sessionsResult.data
  if (sessions.length === 0) return ok([])

  if (getBackendMode() !== "supabase") {
    const logged = new Map(listMockLoggedSessions(MOCK_ATHLETE_ID).map((session) => [session.id, session.results]))
    return ok(
      sessions.map((session) => ({
        ...session,
        summary: summariseLogged((logged.get(session.id)?.exercises ?? []).map((exercise) => ({ label: exercise.label, sets: exercise.sets.length }))),
      })),
    )
  }

  const client = getBrowserSupabaseClient()
  // The list loaded, so a client exists; without one the sessions are still worth showing.
  if (!client) return ok(sessions.map((session) => ({ ...session, summary: null })))

  type LogRow = {
    session_id: string
    session_block_row_id: string
    session_block_rows: { label: string; sort_order: number } | Array<{ label: string; sort_order: number }> | null
  }
  const bySession = new Map<string, Map<string, { label: string; order: number; sets: number }>>()
  const ids = sessions.map((session) => session.id)
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await client
      .from("session_row_logs")
      .select("session_id, session_block_row_id, session_block_rows(label, sort_order)")
      .in("session_id", ids.slice(index, index + 100))
      .limit(5000)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    for (const row of (data as LogRow[] | null) ?? []) {
      const exercise = Array.isArray(row.session_block_rows) ? row.session_block_rows[0] : row.session_block_rows
      if (!exercise) continue
      const rows = bySession.get(row.session_id) ?? new Map<string, { label: string; order: number; sets: number }>()
      const entry = rows.get(row.session_block_row_id) ?? { label: exercise.label, order: exercise.sort_order, sets: 0 }
      entry.sets += 1
      rows.set(row.session_block_row_id, entry)
      bySession.set(row.session_id, rows)
    }
  }

  return ok(
    sessions.map((session) => ({
      ...session,
      summary: summariseLogged([...(bySession.get(session.id)?.values() ?? [])].sort((a, b) => a.order - b.order)),
    })),
  )
}
