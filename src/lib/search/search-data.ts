import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import { cleanQuery, GROUP_LIMIT, hitsFromRows, isSearchable, type SearchHit, type SearchRole } from "@/lib/search/model"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

export type SearchContext = {
  role: SearchRole
  /** Coach: an assistant on the selected team has no plans, library or competitions screens. */
  assistant: boolean
  /** Coach, demo data only: the teams the coach is on. The database works this out itself. */
  coachTeamIds: string[]
}

/**
 * Everything the signed-in person may see that matches the query, except screens (those come from
 * the static index). In supabase mode this is one call to search_everything(), which reads through
 * row level security. Pass an AbortSignal to drop a request the person has typed past.
 */
export async function searchEverything(rawQuery: string, context: SearchContext, signal?: AbortSignal): Promise<Result<SearchHit[]>> {
  const query = cleanQuery(rawQuery)
  if (!isSearchable(query)) return ok([])

  if (getBackendMode() !== "supabase") {
    const { searchMock } = await import("@/lib/search/mock-search")
    const hits = await searchMock(context.role, query, { coachTeamIds: context.coachTeamIds })
    return ok(hits.filter((hit) => !(context.assistant && ["plan", "template", "exercise", "competition"].includes(hit.kind))))
  }

  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Search is not available right now.")
  let request = client.rpc("search_everything", { p_query: query, p_limit: GROUP_LIMIT })
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(hitsFromRows(context.role, data, { assistant: context.assistant }))
}
