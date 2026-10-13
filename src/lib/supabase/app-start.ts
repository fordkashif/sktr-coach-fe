/**
 * The start-up bundle (database function get_app_start, migration 20261022090000).
 *
 * When the app opens, every screen and the frame around it ask the database the same small
 * questions: who am I (profile and athlete record, each asked for in several shapes), units,
 * club brand, timezone, account, notices, unread counts. On a phone the server answered those 20
 * or so requests almost one at a time. The shared reads layer (read-cache.ts) now asks for the
 * bundle once and answers those requests from it, so they cost one round trip together.
 *
 * Only requests the bundle can answer exactly are answered: a plain column list, filters that are
 * all "equals", at most "limit 1", nothing else. Anything else (ordering, other filters, counts,
 * other embedded tables) goes to the server as before. This file holds the pure parts (which
 * requests, and the answer), so they can be tested without a network.
 */

export type AppStartBundle = Record<string, unknown> & { uid?: string | null }

type RowsTarget = {
  kind: "rows"
  table: string
  columns: string[] | "*"
  /** Embedded team name (athletes only): teams(name). */
  embedTeamName: boolean
  filters: Array<[string, string]>
  limitOne: boolean
}
type RpcTarget = { kind: "rpc"; name: string }
export type BundleTarget = (RowsTarget | RpcTarget) & { live: boolean }

/** Tables answered from rows the caller owns: the request must filter on user_id = the caller. */
const OWN_ROW_TABLES = new Set(["profiles", "athletes", "unit_preferences"])
/** Tables answered from every row the caller can see (the bundle holds them all when there are at most 2). */
const CLUB_TABLES = new Set(["club_unit_defaults", "club_profiles"])
const RPCS = new Set([
  "get_current_account",
  "get_visible_avatars",
  "get_current_club_brand",
  "get_my_platform_notices",
  "get_message_unread_counts",
  "get_current_tenant_package",
  "get_current_club_admin_activation_state",
  "get_current_athlete_team_context",
  "get_current_athlete_team_coaches",
])
/** Answered from the bundle only while it is very fresh, and never a reason to ask for it. */
const LIVE_RPCS = new Set(["get_message_unread_counts", "get_my_platform_notices"])

const COLUMN = /^[a-z_][a-z0-9_]*$/

function splitTopLevel(select: string): string[] | null {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const char of select) {
    if (char === "(") depth += 1
    if (char === ")") depth -= 1
    if (depth < 0) return null
    if (char === "," && depth === 0) {
      parts.push(current)
      current = ""
    } else current += char
  }
  if (depth !== 0) return null
  parts.push(current)
  return parts.map((part) => part.trim())
}

/** Which bundle part answers this request, or null when it must go to the server. */
export function bundleTarget(url: string, method: string, headers: Headers, body: string | null): BundleTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Counts, ranges and other schemas are never answered from the bundle.
  if (headers.get("prefer") || headers.get("range")) return null
  const profile = headers.get("accept-profile") ?? headers.get("content-profile")
  if (profile && profile !== "public") return null
  const accept = headers.get("accept") ?? ""
  if (accept.includes("vnd.pgrst") || accept.includes("csv")) return null

  const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(parsed.pathname)
  if (rpc) {
    if (method !== "POST" || !RPCS.has(rpc[1]) || parsed.search) return null
    if (body !== null && body.trim() !== "" && body.trim() !== "{}") return null
    return { kind: "rpc", name: rpc[1], live: LIVE_RPCS.has(rpc[1]) }
  }

  const table = /\/rest\/v1\/([a-z_]+)$/.exec(parsed.pathname)?.[1]
  if (!table || method !== "GET" || (!OWN_ROW_TABLES.has(table) && !CLUB_TABLES.has(table))) return null

  let columns: string[] | "*" | null = null
  let embedTeamName = false
  let limitOne = false
  const filters: Array<[string, string]> = []
  for (const [key, value] of parsed.searchParams) {
    if (key === "select") {
      const parts = splitTopLevel(value)
      if (!parts) return null
      const plain: string[] = []
      let star = false
      for (const part of parts) {
        if (part === "*") star = true
        else if (COLUMN.test(part)) plain.push(part)
        else if (table === "athletes" && part === "teams(name)") embedTeamName = true
        else return null
      }
      if (star && plain.length > 0) return null
      columns = star ? "*" : plain
    } else if (key === "limit") {
      if (value !== "1") return null
      limitOne = true
    } else if (COLUMN.test(key) && value.startsWith("eq.")) {
      filters.push([key, value.slice(3)])
    } else return null
  }
  if (columns === null) return null
  return { kind: "rows", table, columns, embedTeamName, filters, limitOne, live: false }
}

function project(row: Record<string, unknown>, target: RowsTarget): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  if (target.columns === "*") {
    for (const [key, value] of Object.entries(row)) if (key !== "teams" || target.table !== "athletes") out[key] = value
  } else {
    for (const column of target.columns) {
      if (!(column in row)) return null
      out[column] = row[column]
    }
  }
  if (target.embedTeamName) out.teams = row.teams ?? null
  return out
}

function matches(row: Record<string, unknown>, filters: Array<[string, string]>): boolean | null {
  for (const [column, value] of filters) {
    if (!(column in row)) return null
    const actual = row[column]
    const text = actual === null ? "null" : typeof actual === "object" ? null : String(actual)
    if (text === null || text !== value) return false
  }
  return true
}

/** The answer to a request from the bundle, as the JSON the server would send, or null. */
export function answerFromBundle(bundle: AppStartBundle, target: BundleTarget): unknown[] | null {
  if (target.kind === "rpc") {
    const value = bundle[`rpc:${target.name}`]
    return Array.isArray(value) ? value : null
  }

  const rows = bundle[target.table]
  if (!Array.isArray(rows)) return null
  if (OWN_ROW_TABLES.has(target.table)) {
    // The bundle holds the caller's own rows only: the request must ask for exactly those.
    const uid = typeof bundle.uid === "string" ? bundle.uid : null
    if (!uid || !target.filters.some(([column, value]) => column === "user_id" && value === uid)) return null
  } else if (rows.length > 2) {
    return null
  }

  const out: unknown[] = []
  for (const row of rows as Array<Record<string, unknown>>) {
    const hit = matches(row, target.filters)
    if (hit === null) return null
    if (!hit) continue
    const projected = project(row, target)
    if (!projected) return null
    out.push(projected)
  }
  // With "limit 1" and more than one row, only the server knows which one it would pick.
  if (target.limitOne && out.length > 1) return null
  return out
}
