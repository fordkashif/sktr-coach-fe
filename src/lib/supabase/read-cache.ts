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
  "get_announcement_recipients",
  "get_announcements",
  "get_athlete_guardians",
  "get_athlete_invite_preview",
  "get_calendar_feed_status",
  "get_closed_clubs",
  "get_club_guardians",
  "get_club_ownership",
  "get_current_account",
  "get_current_athlete_team_coaches",
  "get_current_athlete_team_context",
  "get_current_club_brand",
  "get_current_club_closure",
  "get_current_results_season",
  "get_current_tenant_package",
  "get_guardian_child_attendance",
  "get_guardian_child_coaches",
  "get_guardian_child_details",
  "get_guardian_child_sessions",
  "get_guardian_children",
  "get_message_oversight_threads",
  "get_message_thread",
  "get_message_threads",
  "get_message_unread_counts",
  "get_my_account_deletion_check",
  "get_my_guardian_sharing",
  "get_my_last_exercise_logs",
  "get_my_last_exercise_results",
  "get_my_platform_notices",
  "get_platform_failed_notification_emails",
  "get_platform_notification_email_stats",
  "get_platform_system_status",
  "get_platform_tenant_sizes",
  "get_platform_usage",
  "get_public_coach_invite_role",
  "get_public_guardian_invite",
  "get_relay_entries",
  "get_roster_capacity",
  "get_session_logged_by",
  "get_tenant_member_emails",
  "get_visible_avatars",
  "guardian_athlete_plan_ids",
  "guardian_athlete_test_week_ids",
  "list_platform_admins",
  "list_platform_notices",
  "search_everything",
  "training_load_sessions",
  "training_load_weeks",
])

/** How long a read is kept. Short on purpose: long enough to move between screens, short enough not to matter. */
export const READ_KEEP_MS = 30_000
/** Badge counts and inbox reads are kept for less, so a new notification or message shows up soon. */
export const LIVE_READ_KEEP_MS = 10_000
const LIVE_READS = /\/rest\/v1\/(user_notifications|messages|message_threads|rpc\/get_message_unread_counts|rpc\/get_announcements|rpc\/get_message_threads|rpc\/get_message_thread|rpc\/get_message_oversight_threads)\b/
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

import { answerFromBundle, bundleTarget, type AppStartBundle } from "./app-start"
import { batchableRead, type BatchRead } from "./batch-reads"

/** Plain reads that start within this many ms of each other are sent together. */
const BATCH_WINDOW_MS = 20
/** batch_reads takes at most this many reads per request. */
const BATCH_MAX = 40

/** After the start-up bundle is found missing (database not updated yet), wait this long before trying again. */
const BUNDLE_RETRY_MS = 10 * 60_000

export type ReadCacheOptions = {
  now?: () => number
  /**
   * Answer the app's start-up questions from one get_app_start request (see app-start.ts).
   * Off unless asked for.
   */
  appStart?: boolean
  /** A request was answered from the bundle (for the on-phone timing view). */
  onBundleAnswer?: (init: RequestInit | undefined) => void
  /** The bundle request itself finished (for the on-phone timing view). */
  onBundleFetched?: (startedAt: number, status: number) => void
  /** Send plain reads that start together as one batch_reads request (see batch-reads.ts). Off unless asked for. */
  batch?: boolean
  /** A request was answered from a batch (for the on-phone timing view). */
  onBatchAnswer?: (init: RequestInit | undefined) => void
  /** A batch request finished (for the on-phone timing view). */
  onBatchFetched?: (startedAt: number, status: number, reads: number) => void
}

export type ReadCache = {
  fetch: typeof fetch
  /** Forget every kept read and make reads already on their way not be kept. */
  clear: () => void
  /** For tests and diagnostics. */
  size: () => number
}

export function createReadCache(baseFetch: typeof fetch, options: ReadCacheOptions = {}): ReadCache {
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

  // The start-up bundle: one per sign-in and generation, asked for by the first request it can
  // answer, shared by every request that arrives while it is on its way.
  let bundle: { generation: number; auth: string; at: number | null; promise: Promise<AppStartBundle | null> } | null = null
  let bundleMissingUntil = 0

  const startBundle = (url: string, headers: Headers): NonNullable<typeof bundle> => {
    const origin = new URL(url).origin
    const send = new Headers({ "content-type": "application/json", accept: "application/json" })
    for (const name of ["apikey", "authorization", "x-client-info"]) {
      const value = headers.get(name)
      if (value) send.set(name, value)
    }
    const startedAt = typeof performance !== "undefined" ? performance.now() : 0
    const state: NonNullable<typeof bundle> = { generation, auth: headers.get("authorization") ?? "", at: null, promise: Promise.resolve(null) }
    state.promise = (async () => {
      try {
        const response = await baseFetch(`${origin}/rest/v1/rpc/get_app_start`, { method: "POST", headers: send, body: "{}" })
        options.onBundleFetched?.(startedAt, response.status)
        if (!response.ok) {
          // Not on this database yet: do not ask again for a while.
          if (response.status === 404) bundleMissingUntil = now() + BUNDLE_RETRY_MS
          return null
        }
        const value = (await response.json()) as AppStartBundle | null
        state.at = now()
        return value && typeof value === "object" && !Array.isArray(value) ? value : null
      } catch {
        return null
      }
    })()
    return state
  }

  // Batches: one open group per sign-in, sent BATCH_WINDOW_MS after its first read.
  type Waiting = { read: BatchRead; resolve: (rows: unknown[] | null) => void }
  const groups = new Map<string, { origin: string; headers: Headers; items: Waiting[] }>()
  let batchMissingUntil = 0

  const sendGroup = async (group: { origin: string; headers: Headers; items: Waiting[] }) => {
    // A read on its own gains nothing from a batch: it goes out as it is.
    if (group.items.length === 1) {
      group.items[0].resolve(null)
      return
    }
    for (let start = 0; start < group.items.length; start += BATCH_MAX) {
      const chunk = group.items.slice(start, start + BATCH_MAX)
      const send = new Headers({ "content-type": "application/json", accept: "application/json" })
      for (const name of ["apikey", "authorization", "x-client-info"]) {
        const value = group.headers.get(name)
        if (value) send.set(name, value)
      }
      const startedAt = typeof performance !== "undefined" ? performance.now() : 0
      try {
        const response = await baseFetch(`${group.origin}/rest/v1/rpc/batch_reads`, {
          method: "POST",
          headers: send,
          body: JSON.stringify({ p_reads: chunk.map((item) => item.read) }),
        })
        options.onBatchFetched?.(startedAt, response.status, chunk.length)
        if (!response.ok) {
          if (response.status === 404) batchMissingUntil = now() + BUNDLE_RETRY_MS
          chunk.forEach((item) => item.resolve(null))
          continue
        }
        const results = (await response.json()) as Array<{ ok?: boolean; rows?: unknown[] }> | null
        chunk.forEach((item, index) => {
          const result = Array.isArray(results) ? results[index] : null
          item.resolve(result?.ok === true && Array.isArray(result.rows) ? result.rows : null)
        })
      } catch {
        chunk.forEach((item) => item.resolve(null))
      }
    }
  }

  const answerWithBatch = (url: string, method: string, headers: Headers, body: string | null): Promise<unknown[] | null> | null => {
    if (now() < batchMissingUntil) return null
    const read = batchableRead(url, method, headers, body, (name) => READ_ONLY_RPCS.has(name))
    if (!read) return null
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      return null
    }
    const groupKey = [origin, headers.get("authorization") ?? "", headers.get("apikey") ?? ""].join("\u0000")
    return new Promise((resolve) => {
      let group = groups.get(groupKey)
      if (!group) {
        group = { origin, headers, items: [] }
        groups.set(groupKey, group)
        const open = group
        setTimeout(() => {
          if (groups.get(groupKey) === open) groups.delete(groupKey)
          void sendGroup(open)
        }, BATCH_WINDOW_MS)
      }
      group.items.push({ read, resolve })
    })
  }

  const answerWithBundle = async (url: string, method: string, headers: Headers, body: string | null): Promise<unknown[] | null> => {
    const target = bundleTarget(url, method, headers, body)
    if (!target) return null
    const auth = headers.get("authorization") ?? ""
    const maxAge = target.live ? LIVE_READ_KEEP_MS : READ_KEEP_MS
    const usable = (state: typeof bundle) =>
      state !== null && state.generation === generation && state.auth === auth && (state.at === null || now() - state.at < maxAge)
    if (!usable(bundle)) {
      // Live counts never start a bundle on their own, and a missing function is not asked for again soon.
      if (target.live || now() < bundleMissingUntil) return null
      bundle = startBundle(url, headers)
    }
    const state = bundle as NonNullable<typeof bundle>
    const value = await state.promise
    if (!value || (state.at !== null && now() - state.at >= maxAge)) return null
    return answerFromBundle(value, target)
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
      if (options.appStart) {
        const answer = await answerWithBundle(String(input), (init?.method ?? "GET").toUpperCase(), new Headers(init?.headers), typeof init?.body === "string" ? init.body : null)
        if (answer) {
          options.onBundleAnswer?.(init)
          const snapshot: Snapshot = {
            status: 200,
            statusText: "OK",
            headers: [
              ["content-type", "application/json; charset=utf-8"],
              ["content-range", answer.length > 0 ? `0-${answer.length - 1}/*` : "*/*"],
            ],
            body: JSON.stringify(answer),
          }
          if (generation === startedIn) kept.set(key, { at: now(), keepMs, snapshot })
          return snapshot
        }
      }
      if (options.batch) {
        const batched = answerWithBatch(String(input), (init?.method ?? "GET").toUpperCase(), new Headers(init?.headers), typeof init?.body === "string" ? init.body : null)
        const rows = batched ? await batched : null
        if (rows) {
          options.onBatchAnswer?.(init)
          const snapshot: Snapshot = {
            status: 200,
            statusText: "OK",
            headers: [
              ["content-type", "application/json; charset=utf-8"],
              ["content-range", rows.length > 0 ? `0-${rows.length - 1}/*` : "*/*"],
            ],
            body: JSON.stringify(rows),
          }
          if (generation === startedIn) kept.set(key, { at: now(), keepMs, snapshot })
          return snapshot
        }
      }
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
