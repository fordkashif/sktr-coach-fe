/**
 * Shared reads for the Supabase client.
 *
 * Every screen asks the database its own questions, and many of them are the same question:
 * opening the app asked "who is this, which club, what role" 11 times, word for word, and every
 * screen change looked the athlete up again. This sits under the Supabase client (its `fetch`) so
 * all of those share one answer, without touching the data files that ask:
 *
 *   - Identical reads that are in flight at the same time share one request.
 *   - A read that came back fine is kept for a short while, so the next screen asking the same
 *     thing gets it straight away.
 *   - Anything that is not a known read empties the store first (inserts, updates, deletes, any
 *     database function not listed below, edge functions, uploads), so a save is never followed by
 *     an out-of-date screen. A read that was already on its way when the store was emptied is
 *     not kept.
 *
 * The app also empties the store when the person comes back to the app, signs in or out, when a
 * live update arrives (notifications, messages) and when access is paused (see client.ts).
 *
 * Only `/rest/v1/` reads are kept: table reads (GET, and HEAD for counts) and the read-only
 * database functions below. Each one is declared `stable` in the database, which means Postgres
 * does not let it change anything.
 */

/** Read-only database functions (all declared `stable` in supabase/migrations). Anything else counts as a write. */
export const READ_ONLY_RPCS = new Set([
  "current_tenant_athlete_count",
  "get_announcements",
  "get_calendar_feed_status",
  "get_current_account",
  "get_current_athlete_team_coaches",
  "get_current_athlete_team_context",
  "get_current_club_brand",
  "get_current_club_closure",
  "get_current_results_season",
  "get_current_tenant_package",
  "get_message_unread_counts",
  "get_my_account_deletion_check",
  "get_my_guardian_sharing",
  "get_my_last_exercise_logs",
  "get_my_last_exercise_results",
  "get_my_platform_notices",
  "get_relay_entries",
  "get_session_logged_by",
  "get_visible_avatars",
  "training_load_sessions",
  "training_load_weeks",
])

/** How long a read is kept. Short on purpose: long enough to move between screens, short enough not to matter. */
export const READ_KEEP_MS = 30_000
/** Badge counts and inbox reads are kept for less, so a new notification or message shows up soon. */
export const LIVE_READ_KEEP_MS = 10_000
const LIVE_READS = /\/rest\/v1\/(user_notifications|messages|message_threads|rpc\/get_message_unread_counts|rpc\/get_announcements)\b/
/** Never keep more than this many answers. The oldest go first. */
export const MAX_KEPT_READS = 300

type Kind = { kind: "read"; key: string; keepMs: number } | { kind: "write" } | { kind: "other" }

type Snapshot = { status: number; statusText: string; headers: [string, string][]; body: string | null }

function urlOf(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return null
}

/** Works out whether a request is a read that can be shared, a write that empties the store, or neither. */
export function classifyRequest(input: RequestInfo | URL, init?: RequestInit): Kind {
  const url = urlOf(input)
  // A Request object or a cancellable request is passed through untouched. The app does not send
  // these for reads it repeats, and sharing them would mix up who cancelled what.
  if (url === null || init?.signal) return { kind: "other" }
  const method = (init?.method ?? "GET").toUpperCase()
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return { kind: "other" }
  }

  if (path.includes("/auth/v1/")) return { kind: "other" }
  const isRead = method === "GET" || method === "HEAD"
  if (!path.includes("/rest/v1/")) return isRead ? { kind: "other" } : { kind: "write" }

  const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path)
  const readable = rpc ? method === "POST" && READ_ONLY_RPCS.has(rpc[1]) : isRead
  if (!readable) return { kind: "write" }

  const headers = new Headers(init?.headers)
  const key = [
    method,
    url,
    typeof init?.body === "string" ? init.body : "",
    headers.get("authorization") ?? "",
    headers.get("apikey") ?? "",
    headers.get("accept") ?? "",
    headers.get("accept-profile") ?? "",
    headers.get("content-profile") ?? "",
    headers.get("prefer") ?? "",
    headers.get("range") ?? "",
  ].join("\u0000")
  // A read body that is not a string (a stream, form data) cannot be compared: do not share it.
  if (init?.body !== undefined && init?.body !== null && typeof init.body !== "string") return { kind: "other" }
  return { kind: "read", key, keepMs: LIVE_READS.test(path) ? LIVE_READ_KEEP_MS : READ_KEEP_MS }
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

function toResponse(snapshot: Snapshot): Response {
  return new Response(NULL_BODY_STATUSES.has(snapshot.status) ? null : snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  })
}

export type ReadCache = {
  fetch: typeof fetch
  /** Forget every kept read and make reads already on their way not be kept. */
  clear: () => void
  /** For tests and diagnostics. */
  size: () => number
}

export function createReadCache(baseFetch: typeof fetch, options: { now?: () => number } = {}): ReadCache {
  const now = options.now ?? (() => Date.now())
  const kept = new Map<string, { at: number; keepMs: number; snapshot: Snapshot }>()
  const inFlight = new Map<string, Promise<Snapshot | Response>>()
  // Bumped by every clear. A read that started before a clear is still answered, but not kept or shared.
  let generation = 0

  const clear = () => {
    generation += 1
    kept.clear()
    inFlight.clear()
  }

  const cachedFetch: typeof fetch = async (input, init) => {
    const request = classifyRequest(input, init)
    if (request.kind === "other") return baseFetch(input, init)
    if (request.kind === "write") {
      clear()
      try {
        return await baseFetch(input, init)
      } finally {
        // Reads that went out while the write was on its way may have seen the old data.
        clear()
      }
    }

    const { key, keepMs } = request
    const hit = kept.get(key)
    if (hit && now() - hit.at < hit.keepMs) return toResponse(hit.snapshot)
    if (hit) kept.delete(key)

    const pending = inFlight.get(key)
    if (pending) {
      const shared = await pending
      return shared instanceof Response ? shared.clone() : toResponse(shared)
    }

    const startedIn = generation
    const run = (async (): Promise<Snapshot | Response> => {
      const response = await baseFetch(input, init)
      // Only a good answer is shared or kept. Errors go back to the caller as they came.
      if (!response.ok) return response
      const snapshot: Snapshot = {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        body: NULL_BODY_STATUSES.has(response.status) ? null : await response.text(),
      }
      if (generation === startedIn) {
        kept.set(key, { at: now(), keepMs, snapshot })
        while (kept.size > MAX_KEPT_READS) kept.delete(kept.keys().next().value as string)
      }
      return snapshot
    })()

    inFlight.set(key, run)
    try {
      const result = await run
      return result instanceof Response ? result.clone() : toResponse(result)
    } finally {
      if (inFlight.get(key) === run) inFlight.delete(key)
    }
  }

  return { fetch: cachedFetch, clear, size: () => kept.size }
}
