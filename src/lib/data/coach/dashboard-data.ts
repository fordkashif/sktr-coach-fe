import type { SupabaseClient } from "@supabase/supabase-js"
import { formatSetLog, isLogEmpty, logKindForBlockType } from "@/lib/data/session/session-from-plan"
import type { LogKind, LoggedSessionResults, SessionBlockType } from "@/lib/data/session/types"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import type {
  Athlete,
  EventGroup,
  LogEntry,
  PR,
  Team,
  TestWeekResult,
  TrendPoint,
  WellnessEntry,
} from "@/lib/mock-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

export type CoachDashboardSnapshot = {
  teams: Team[]
  athletes: Athlete[]
  prs: PR[]
  tests: TestWeekResult[]
  trendSeries: Record<string, TrendPoint[]>
}

type ScopedOptions = {
  scopeTeamId?: string | null
}

const COACH_SNAPSHOT_CACHE_TTL_MS = 30_000

type CoachSnapshotCacheEntry = {
  data: CoachDashboardSnapshot
  cachedAt: number
}

const coachDashboardSnapshotCache = new Map<string, CoachSnapshotCacheEntry>()
const coachDashboardSnapshotInflight = new Map<string, Promise<Result<CoachDashboardSnapshot>>>()
const coachWellnessEntriesCache = new Map<string, { data: WellnessEntry[]; cachedAt: number }>()
const coachWellnessEntriesInflight = new Map<string, Promise<Result<WellnessEntry[]>>>()

function coachSnapshotCacheKey(scopeTeamId?: string | null) {
  return scopeTeamId?.trim() || "__all__"
}

function getFreshCoachSnapshotCache(scopeTeamId?: string | null) {
  const cacheKey = coachSnapshotCacheKey(scopeTeamId)
  const cached = coachDashboardSnapshotCache.get(cacheKey)
  if (!cached) return null
  if (Date.now() - cached.cachedAt > COACH_SNAPSHOT_CACHE_TTL_MS) {
    coachDashboardSnapshotCache.delete(cacheKey)
    return null
  }
  return cached.data
}

export function peekCachedCoachDashboardSnapshot(scopeTeamId?: string | null) {
  return getFreshCoachSnapshotCache(scopeTeamId)
}

function requireSupabaseClient(operation: string): ClientResolution {
  if (getBackendMode() !== "supabase") {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] backend mode is not 'supabase'.` },
    }
  }

  const client = getBrowserSupabaseClient()
  if (!client) {
    return {
      ok: false,
      error: { code: "UNKNOWN", message: `[${operation}] Supabase client is not configured.` },
    }
  }

  return { ok: true, client }
}

function toEventGroup(value: string | null | undefined): EventGroup {
  if (value === "Sprint" || value === "Mid" || value === "Distance" || value === "Jumps" || value === "Throws") return value
  return "Sprint"
}

function toLocaleShortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function toCategory(value: string | null | undefined): PR["category"] {
  if (value === "Strength") return value
  return toEventGroup(value)
}

function metricKey(testName: string): "thirtyM" | "flyingThirtyM" | "oneHundredFiftyM" | "squat1RM" | "cmj" | null {
  const normalized = testName.trim().toLowerCase()
  if (normalized === "30m") return "thirtyM"
  if (normalized === "flying 30m") return "flyingThirtyM"
  if (normalized === "150m") return "oneHundredFiftyM"
  if (normalized === "squat 1rm") return "squat1RM"
  if (normalized === "cmj") return "cmj"
  return null
}

function metricChange(current: number | null, previous: number | null): "up" | "down" | "same" {
  if (current === null || previous === null) return "same"
  if (current > previous) return "up"
  if (current < previous) return "down"
  return "same"
}

function parseNumericValue(value: string): number | null {
  const match = value.match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

async function resolveScopedCoachTeamIds(
  client: SupabaseClient,
  tenantId: string,
  userId: string,
  role: "coach" | "club-admin",
  requestedScopeTeamId?: string | null,
): Promise<Result<string[] | null>> {
  if (role !== "coach") {
    return ok(requestedScopeTeamId ? [requestedScopeTeamId] : null)
  }

  const membershipResult = await client
    .from("team_coaches")
    .select("team_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (membershipResult.error) return { ok: false, error: mapPostgrestError(membershipResult.error) }

  const membershipTeamIds = ((membershipResult.data as Array<{ team_id: string }> | null) ?? []).map((row) => row.team_id)
  if (membershipTeamIds.length === 0) return ok([])
  if (requestedScopeTeamId) {
    return ok(membershipTeamIds.includes(requestedScopeTeamId) ? [requestedScopeTeamId] : [])
  }
  return ok(membershipTeamIds)
}

export async function getCoachDashboardSnapshotForCurrentUser(options?: ScopedOptions): Promise<Result<CoachDashboardSnapshot>> {
  const cached = getFreshCoachSnapshotCache(options?.scopeTeamId)
  if (cached) return ok(cached)

  const cacheKey = coachSnapshotCacheKey(options?.scopeTeamId)
  const inflight = coachDashboardSnapshotInflight.get(cacheKey)
  if (inflight) return inflight

  const requestPromise = (async (): Promise<Result<CoachDashboardSnapshot>> => {
  const clientResult = requireSupabaseClient("getCoachDashboardSnapshotForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach and club-admin users can access coach dashboard data.")
  }

  const tenantId = profile.tenant_id as string
  const scopedTeamIdsResult = await resolveScopedCoachTeamIds(
    clientResult.client,
    tenantId,
    userId,
    profile.role,
    options?.scopeTeamId,
  )
  if (!scopedTeamIdsResult.ok) return scopedTeamIdsResult

  const scopedTeamIds = scopedTeamIdsResult.data
  if (Array.isArray(scopedTeamIds) && scopedTeamIds.length === 0) {
    const emptySnapshot = { teams: [], athletes: [], prs: [], tests: [], trendSeries: {} }
    coachDashboardSnapshotCache.set(cacheKey, { data: emptySnapshot, cachedAt: Date.now() })
    return ok(emptySnapshot)
  }

  const teamsQuery = clientResult.client
    .from("teams")
    .select("id, name, event_group")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("is_archived", false)
  const athletesQuery = clientResult.client
    .from("athletes")
    .select("id, team_id, first_name, last_name, event_group, primary_event, readiness, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
  if (scopedTeamIds) {
    teamsQuery.in("id", scopedTeamIds)
    athletesQuery.in("team_id", scopedTeamIds)
  }

  const [{ data: teamRows, error: teamError }, { data: athleteRows, error: athleteError }] = await Promise.all([
    teamsQuery,
    athletesQuery,
  ])
  if (teamError) return { ok: false, error: mapPostgrestError(teamError) }
  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }

  const athletesBase = ((athleteRows as Array<{
    id: string
    team_id: string | null
    first_name: string
    last_name: string
    event_group: string | null
    primary_event: string | null
    readiness: "green" | "yellow" | "red" | null
  }> | null) ?? [])
    .filter((row) => Boolean(row.team_id))
    .map((row) => ({
      id: row.id,
      teamId: row.team_id as string,
      name: `${row.first_name} ${row.last_name}`.trim(),
      eventGroup: toEventGroup(row.event_group),
      primaryEvent: row.primary_event ?? "Unassigned",
      readiness: row.readiness ?? "yellow",
    }))

  const athleteIds = athletesBase.map((row) => row.id)
  const countByTeam = athletesBase.reduce<Record<string, number>>((acc, athlete) => {
    acc[athlete.teamId] = (acc[athlete.teamId] ?? 0) + 1
    return acc
  }, {})

  const teams = ((teamRows as Array<{ id: string; name: string; event_group: string | null }> | null) ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      eventGroup: toEventGroup(row.event_group),
      athleteCount: countByTeam[row.id] ?? 0,
      disciplines: undefined,
    }))

  if (athleteIds.length === 0) {
    const emptyAthleteSnapshot = { teams, athletes: [], prs: [], tests: [], trendSeries: {} }
    coachDashboardSnapshotCache.set(cacheKey, { data: emptyAthleteSnapshot, cachedAt: Date.now() })
    return ok(emptyAthleteSnapshot)
  }

  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - 28)
  const sinceIsoDate = sinceDate.toISOString().slice(0, 10)

  const [
    { data: wellnessRows, error: wellnessError },
    { data: prRows, error: prError },
    { data: testRows, error: testError },
    { data: sessionRows, error: sessionError },
    { data: completionRows, error: completionError },
  ] = await Promise.all([
    clientResult.client
      .from("wellness_entries")
      .select("athlete_id, entry_date, readiness, readiness_score, training_load")
      .in("athlete_id", athleteIds)
      .gte("entry_date", sinceIsoDate)
      .order("entry_date", { ascending: true }),
    clientResult.client
      .from("pr_records")
      .select("id, athlete_id, event, category, best_value, previous_value, measured_on, is_legal, wind")
      .in("athlete_id", athleteIds)
      .order("measured_on", { ascending: false })
      .limit(200),
    clientResult.client
      .from("test_results")
      .select("athlete_id, value_text, value_numeric, submitted_at, test_definitions(name)")
      .in("athlete_id", athleteIds)
      .order("submitted_at", { ascending: false })
      .limit(600),
    clientResult.client
      .from("sessions")
      .select("id, athlete_id")
      .in("athlete_id", athleteIds)
      .gte("scheduled_for", sinceIsoDate),
    clientResult.client
      .from("session_completions")
      .select("session_id, athlete_id")
      .in("athlete_id", athleteIds)
      .gte("completion_date", sinceIsoDate),
  ])
  if (wellnessError) return { ok: false, error: mapPostgrestError(wellnessError) }
  if (prError) return { ok: false, error: mapPostgrestError(prError) }
  if (testError) return { ok: false, error: mapPostgrestError(testError) }
  if (sessionError) return { ok: false, error: mapPostgrestError(sessionError) }
  if (completionError) return { ok: false, error: mapPostgrestError(completionError) }

  const wellnessByAthlete = ((wellnessRows as Array<{
    athlete_id: string
    entry_date: string
    readiness: "green" | "yellow" | "red"
    readiness_score: number
    training_load: number
  }> | null) ?? []).reduce<Record<string, TrendPoint[]>>((acc, row) => {
    const current = acc[row.athlete_id] ?? []
    current.push({
      date: row.entry_date,
      readiness: row.readiness_score,
      fatigue: 0,
      trainingLoad: row.training_load,
    })
    acc[row.athlete_id] = current
    return acc
  }, {})

  const latestWellness = Object.fromEntries(
    Object.entries(wellnessByAthlete).map(([athleteId, series]) => [athleteId, series[series.length - 1]]),
  )

  const sessionsByAthlete = ((sessionRows as Array<{ id: string; athlete_id: string }> | null) ?? []).reduce<
    Record<string, Set<string>>
  >((acc, row) => {
    const current = acc[row.athlete_id] ?? new Set<string>()
    current.add(row.id)
    acc[row.athlete_id] = current
    return acc
  }, {})

  const completionCountByAthlete = ((completionRows as Array<{ session_id: string; athlete_id: string }> | null) ?? []).reduce<
    Record<string, number>
  >((acc, row) => {
    const hasSession = sessionsByAthlete[row.athlete_id]?.has(row.session_id)
    if (!hasSession) return acc
    acc[row.athlete_id] = (acc[row.athlete_id] ?? 0) + 1
    return acc
  }, {})

  const athletes: Athlete[] = athletesBase.map((row) => {
    const sessionCount = sessionsByAthlete[row.id]?.size ?? 0
    const completionCount = completionCountByAthlete[row.id] ?? 0
    const adherence = sessionCount > 0 ? Math.min(Math.round((completionCount / sessionCount) * 100), 100) : 100
    const latest = latestWellness[row.id]
    return {
      id: row.id,
      name: row.name,
      age: 0,
      eventGroup: row.eventGroup,
      primaryEvent: row.primaryEvent,
      readiness: latest ? (latest.readiness >= 75 ? "green" : latest.readiness >= 55 ? "yellow" : "red") : row.readiness,
      adherence,
      lastWellness: latest ? toLocaleShortDate(latest.date) : "-",
      teamId: row.teamId,
    }
  })

  const prs: PR[] = ((prRows as Array<{
    id: string
    athlete_id: string
    event: string
    category: string
    best_value: string
    previous_value: string | null
    measured_on: string
    is_legal: boolean
    wind: string | null
  }> | null) ?? []).map((row) => {
    const athlete = athletes.find((item) => item.id === row.athlete_id)
    return {
      id: row.id,
      athleteId: row.athlete_id,
      athleteName: athlete?.name ?? "Athlete",
      event: row.event,
      category: toCategory(row.category),
      bestValue: row.best_value,
      previousValue: row.previous_value ?? undefined,
      date: toLocaleShortDate(row.measured_on),
      legal: row.is_legal,
      wind: row.wind ?? undefined,
      type: "Training",
    }
  })

  const testsByAthlete = ((testRows as Array<{
    athlete_id: string
    value_text: string
    value_numeric: number | null
    submitted_at: string
    test_definitions: Array<{ name: string }> | { name: string } | null
  }> | null) ?? []).reduce<Record<string, TestWeekResult>>((acc, row) => {
    // PostgREST returns a single object for this many-to-one embed, not an array.
    const metricName = firstRelation(row.test_definitions)?.name
    if (!metricName) return acc
    const key = metricKey(metricName)
    if (!key) return acc

    const current = acc[row.athlete_id] ?? {
      athleteId: row.athlete_id,
      athleteName: athletes.find((item) => item.id === row.athlete_id)?.name ?? "Athlete",
    }

    const existing = current[key]
    if (!existing) {
      current[key] = { value: row.value_text, change: "same" }
    } else {
      current[key] = {
        value: existing.value,
        change: metricChange(parseNumericValue(existing.value), row.value_numeric),
      }
    }
    acc[row.athlete_id] = current
    return acc
  }, {})

  const tests = Object.values(testsByAthlete)

  const snapshot = {
    teams,
    athletes,
    prs,
    tests,
    trendSeries: wellnessByAthlete,
  }
  coachDashboardSnapshotCache.set(cacheKey, { data: snapshot, cachedAt: Date.now() })
  return ok(snapshot)
  })()

  coachDashboardSnapshotInflight.set(cacheKey, requestPromise)
  try {
    return await requestPromise
  } finally {
    coachDashboardSnapshotInflight.delete(cacheKey)
  }
}

export async function getCoachWellnessEntriesForCurrentUser(options?: ScopedOptions): Promise<Result<WellnessEntry[]>> {
  const cacheKey = coachSnapshotCacheKey(options?.scopeTeamId)
  const cached = coachWellnessEntriesCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt <= COACH_SNAPSHOT_CACHE_TTL_MS) {
    return ok(cached.data)
  }

  const inflight = coachWellnessEntriesInflight.get(cacheKey)
  if (inflight) return inflight

  const requestPromise = (async (): Promise<Result<WellnessEntry[]>> => {
  const clientResult = requireSupabaseClient("getCoachWellnessEntriesForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach and club-admin users can access coach reports data.")
  }

  const tenantId = profile.tenant_id as string
  const scopedTeamIdsResult = await resolveScopedCoachTeamIds(
    clientResult.client,
    tenantId,
    userId,
    profile.role,
    options?.scopeTeamId,
  )
  if (!scopedTeamIdsResult.ok) return scopedTeamIdsResult

  const scopedTeamIds = scopedTeamIdsResult.data
  if (Array.isArray(scopedTeamIds) && scopedTeamIds.length === 0) {
    coachWellnessEntriesCache.set(cacheKey, { data: [], cachedAt: Date.now() })
    return ok([])
  }

  const athleteQuery = clientResult.client
    .from("athletes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
  if (scopedTeamIds) athleteQuery.in("team_id", scopedTeamIds)

  const { data: athleteRows, error: athleteError } = await athleteQuery
  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }

  const athleteIds = ((athleteRows as Array<{ id: string }> | null) ?? []).map((row) => row.id)
  if (athleteIds.length === 0) {
    coachWellnessEntriesCache.set(cacheKey, { data: [], cachedAt: Date.now() })
    return ok([])
  }

  const { data: wellnessRows, error: wellnessError } = await clientResult.client
    .from("wellness_entries")
    .select("id, athlete_id, entry_date, sleep_hours, soreness, fatigue, mood, stress, notes, readiness")
    .in("athlete_id", athleteIds)
    .order("entry_date", { ascending: false })
    .limit(500)

  if (wellnessError) return { ok: false, error: mapPostgrestError(wellnessError) }

  const entries = ((wellnessRows as Array<{
      id: string
      athlete_id: string
      entry_date: string
      sleep_hours: number
      soreness: number
      fatigue: number
      mood: number
      stress: number
      notes: string | null
      readiness: "green" | "yellow" | "red"
    }> | null) ?? []).map((row) => ({
      id: row.id,
      athleteId: row.athlete_id,
      date: row.entry_date,
      sleep: row.sleep_hours,
      soreness: row.soreness,
      fatigue: row.fatigue,
      mood: row.mood,
      stress: row.stress,
      notes: row.notes ?? undefined,
      readiness: row.readiness,
    }))
  coachWellnessEntriesCache.set(cacheKey, { data: entries, cachedAt: Date.now() })
  return ok(entries)
  })()

  coachWellnessEntriesInflight.set(cacheKey, requestPromise)
  try {
    return await requestPromise
  } finally {
    coachWellnessEntriesInflight.delete(cacheKey)
  }
}

function inferLogType(title: string): LogEntry["type"] {
  const normalized = title.toLowerCase()
  if (normalized.includes("strength") || normalized.includes("lift") || normalized.includes("squat")) return "Strength"
  if (normalized.includes("jump") || normalized.includes("bound")) return "Jumps"
  if (normalized.includes("throw")) return "Throws"
  if (normalized.includes("split")) return "Splits"
  return "Run"
}

export async function getCoachAthleteSessionLogsForCurrentUser(
  athleteId: string,
  options?: ScopedOptions,
): Promise<Result<LogEntry[]>> {
  const clientResult = requireSupabaseClient("getCoachAthleteSessionLogsForCurrentUser")
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()
  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach and club-admin users can access athlete session logs.")
  }

  const scopedTeamIdsResult = await resolveScopedCoachTeamIds(
    clientResult.client,
    profile.tenant_id as string,
    userId,
    profile.role,
    options?.scopeTeamId,
  )
  if (!scopedTeamIdsResult.ok) return scopedTeamIdsResult

  const scopedTeamIds = scopedTeamIdsResult.data
  if (Array.isArray(scopedTeamIds) && scopedTeamIds.length === 0) {
    return err("FORBIDDEN", "No team is assigned for this coach profile.")
  }

  const athleteQuery = clientResult.client
    .from("athletes")
    .select("id, team_id")
    .eq("tenant_id", profile.tenant_id as string)
    .eq("id", athleteId)
    .maybeSingle()
  const { data: athleteRow, error: athleteError } = await athleteQuery
  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
  if (!athleteRow) return err("NOT_FOUND", "Athlete not found in current tenant.")
  if (scopedTeamIds && !scopedTeamIds.includes(athleteRow.team_id as string)) {
    return err("FORBIDDEN", "Athlete is outside the assigned coach team scope.")
  }

  const { data: sessionsRows, error: sessionsError } = await clientResult.client
    .from("sessions")
    .select("id, athlete_id, title, scheduled_for, status")
    .eq("athlete_id", athleteId)
    .order("scheduled_for", { ascending: false })
    .limit(50)
  if (sessionsError) return { ok: false, error: mapPostgrestError(sessionsError) }

  return ok(
    ((sessionsRows as Array<{
      id: string
      athlete_id: string
      title: string
      scheduled_for: string
      status: "scheduled" | "in-progress" | "completed"
    }> | null) ?? []).map((row) => ({
      id: row.id,
      athleteId: row.athlete_id,
      type: inferLogType(row.title),
      title: row.title,
      date: toLocaleShortDate(row.scheduled_for),
      details: row.status === "completed" ? "Session completed." : row.status === "in-progress" ? "Session in progress." : "Session scheduled.",
    })),
  )
}

function firstRelation<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export type CoachAthleteWellnessRow = WellnessEntry & {
  readinessScore: number
  trainingLoad: number
}

export type CoachAthleteSessionRow = LogEntry & {
  /** What the athlete logged: sets per exercise, effort and comment. Null when nothing was logged. */
  results: LoggedSessionResults | null
  isoDate: string
  status: "scheduled" | "in-progress" | "completed"
  coachNote: string | null
  completedOn: string | null
  durationMinutes: number | null
}

export type CoachAthletePrRow = PR & {
  isoDate: string
  note: string | null
  source: "manual" | "test-week" | "import"
}

export type CoachAthleteTestRow = {
  id: string
  testName: string
  unit: "time" | "distance" | "weight" | "height" | "score"
  value: string
  previousValue: string | null
  change: "up" | "down" | "same" | null
  submittedAt: string
  testWeekName: string | null
}

export type CoachAthleteDetail = {
  dateOfBirth: string | null
  /** The readiness flag stored on the athlete row, null when nobody has set one. */
  readinessFlag: "green" | "yellow" | "red" | null
  wellness: CoachAthleteWellnessRow[]
  sessions: CoachAthleteSessionRow[]
  prs: CoachAthletePrRow[]
  tests: CoachAthleteTestRow[]
}

type CoachAthleteAccess = {
  client: SupabaseClient
  tenantId: string
  dateOfBirth: string | null
  readinessFlag: "green" | "yellow" | "red" | null
  athleteName: string
}

async function resolveCoachAthleteAccess(
  operation: string,
  athleteId: string,
  options?: ScopedOptions,
): Promise<Result<CoachAthleteAccess>> {
  const clientResult = requireSupabaseClient(operation)
  if (!clientResult.ok) return clientResult

  const { data: authSession } = await clientResult.client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error: profileError } = await clientResult.client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()
  if (profileError) return { ok: false, error: mapPostgrestError(profileError) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach and club-admin users can access athlete details.")
  }

  const tenantId = profile.tenant_id as string
  const scopedTeamIdsResult = await resolveScopedCoachTeamIds(clientResult.client, tenantId, userId, profile.role, options?.scopeTeamId)
  if (!scopedTeamIdsResult.ok) return scopedTeamIdsResult
  const scopedTeamIds = scopedTeamIdsResult.data
  if (Array.isArray(scopedTeamIds) && scopedTeamIds.length === 0) {
    return err("FORBIDDEN", "No team is assigned for this coach profile.")
  }

  const { data: athleteRow, error: athleteError } = await clientResult.client
    .from("athletes")
    .select("id, team_id, first_name, last_name, date_of_birth, readiness")
    .eq("tenant_id", tenantId)
    .eq("id", athleteId)
    .maybeSingle()
  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
  if (!athleteRow) return err("NOT_FOUND", "Athlete not found in current tenant.")
  if (scopedTeamIds && !scopedTeamIds.includes(athleteRow.team_id as string)) {
    return err("FORBIDDEN", "Athlete is outside the assigned coach team scope.")
  }

  return ok({
    client: clientResult.client,
    tenantId,
    dateOfBirth: (athleteRow.date_of_birth as string | null) ?? null,
    readinessFlag: (athleteRow.readiness as "green" | "yellow" | "red" | null) ?? null,
    athleteName: `${athleteRow.first_name as string} ${athleteRow.last_name as string}`.trim(),
  })
}

/** Lower is better for timed tests, higher is better for everything else. */
function testChange(unit: CoachAthleteTestRow["unit"], current: number | null, previous: number | null): CoachAthleteTestRow["change"] {
  if (current === null || previous === null) return null
  if (current === previous) return "same"
  const improved = unit === "time" ? current < previous : current > previous
  return improved ? "up" : "down"
}

/**
 * Everything the backend holds for one athlete, for the coach athlete screen:
 * wellness check-ins, sessions with completion state and coach note, PRs and test results.
 */
export async function getCoachAthleteDetailForCurrentUser(
  athleteId: string,
  options?: ScopedOptions,
): Promise<Result<CoachAthleteDetail>> {
  const access = await resolveCoachAthleteAccess("getCoachAthleteDetailForCurrentUser", athleteId, options)
  if (!access.ok) return access
  const { client, dateOfBirth, readinessFlag, athleteName } = access.data

  const [wellnessResult, sessionsResult, completionsResult, prResult, testResult] = await Promise.all([
    client
      .from("wellness_entries")
      .select("id, athlete_id, entry_date, sleep_hours, soreness, fatigue, mood, stress, training_load, readiness, readiness_score, notes")
      .eq("athlete_id", athleteId)
      .order("entry_date", { ascending: false })
      .limit(60),
    client
      .from("sessions")
      .select("id, athlete_id, title, scheduled_for, status, coach_note, estimated_duration_minutes, completed_at")
      .eq("athlete_id", athleteId)
      .order("scheduled_for", { ascending: false })
      .limit(60),
    client
      .from("session_completions")
      .select("session_id, completion_date")
      .eq("athlete_id", athleteId)
      .order("completion_date", { ascending: false })
      .limit(200),
    client
      .from("pr_records")
      .select("id, athlete_id, event, category, best_value, previous_value, measured_on, is_legal, wind, note, source_type")
      .eq("athlete_id", athleteId)
      .order("measured_on", { ascending: false })
      .limit(100),
    client
      .from("test_results")
      .select("id, value_text, value_numeric, submitted_at, test_definitions(name, unit), test_weeks(name)")
      .eq("athlete_id", athleteId)
      .order("submitted_at", { ascending: false })
      .limit(200),
  ])
  if (wellnessResult.error) return { ok: false, error: mapPostgrestError(wellnessResult.error) }
  if (sessionsResult.error) return { ok: false, error: mapPostgrestError(sessionsResult.error) }
  if (completionsResult.error) return { ok: false, error: mapPostgrestError(completionsResult.error) }
  if (prResult.error) return { ok: false, error: mapPostgrestError(prResult.error) }
  if (testResult.error) return { ok: false, error: mapPostgrestError(testResult.error) }

  const wellness: CoachAthleteWellnessRow[] = ((wellnessResult.data as Array<{
    id: string
    athlete_id: string
    entry_date: string
    sleep_hours: number
    soreness: number
    fatigue: number
    mood: number
    stress: number
    training_load: number
    readiness: "green" | "yellow" | "red"
    readiness_score: number
    notes: string | null
  }> | null) ?? []).map((row) => ({
    id: row.id,
    athleteId: row.athlete_id,
    date: row.entry_date,
    sleep: Number(row.sleep_hours),
    soreness: row.soreness,
    fatigue: row.fatigue,
    mood: row.mood,
    stress: row.stress,
    notes: row.notes ?? undefined,
    readiness: row.readiness,
    readinessScore: row.readiness_score,
    trainingLoad: row.training_load,
  }))

  const completionBySession = new Map<string, string>()
  for (const row of (completionsResult.data as Array<{ session_id: string; completion_date: string }> | null) ?? []) {
    if (!completionBySession.has(row.session_id)) completionBySession.set(row.session_id, row.completion_date)
  }

  const sessions: CoachAthleteSessionRow[] = ((sessionsResult.data as Array<{
    id: string
    athlete_id: string
    title: string
    scheduled_for: string
    status: "scheduled" | "in-progress" | "completed"
    coach_note: string | null
    estimated_duration_minutes: number | null
    completed_at: string | null
  }> | null) ?? []).map((row) => {
    const completedOn = completionBySession.get(row.id) ?? (row.completed_at ? row.completed_at.slice(0, 10) : null)
    const status = completedOn ? "completed" : row.status
    return {
      id: row.id,
      athleteId: row.athlete_id,
      type: inferLogType(row.title),
      title: row.title,
      date: toLocaleShortDate(row.scheduled_for),
      details: status === "completed" ? "Session completed." : status === "in-progress" ? "Session in progress." : "Session scheduled.",
      isoDate: row.scheduled_for,
      status,
      coachNote: row.coach_note,
      completedOn,
      durationMinutes: row.estimated_duration_minutes,
      results: null,
    }
  })

  // What the athlete logged. Extra detail only: if it cannot be read the session list still shows.
  const loggedIds = sessions.filter((session) => session.status !== "scheduled").slice(0, 20).map((session) => session.id)
  if (loggedIds.length > 0) {
    const [blocksResult, logsResult, effortResult] = await Promise.all([
      client
        .from("session_blocks")
        .select("id, session_id, sort_order, block_type, name, session_block_rows(id, sort_order, label, target, log_kind)")
        .in("session_id", loggedIds)
        .order("sort_order", { ascending: true }),
      client
        .from("session_row_logs")
        .select("session_id, session_block_row_id, set_index, completed, reps, load_kg, time_seconds, distance_m, mark")
        .in("session_id", loggedIds)
        .limit(2000),
      client.from("session_completions").select("session_id, rpe, athlete_comment").in("session_id", loggedIds),
    ])
    if (blocksResult.error || logsResult.error || effortResult.error) {
      console.warn("[coach] could not read logged session results", blocksResult.error ?? logsResult.error ?? effortResult.error)
    } else {
      const num = (value: unknown) => (value === null || value === undefined ? null : Number(value))
      const logRows = (logsResult.data as Array<Record<string, unknown>> | null) ?? []
      const effortBySession = new Map(
        ((effortResult.data as Array<{ session_id: string; rpe: number | null; athlete_comment: string | null }> | null) ?? []).map((row) => [
          row.session_id,
          row,
        ]),
      )
      type BlockRow = {
        id: string
        session_id: string
        sort_order: number
        block_type: SessionBlockType
        name: string
        session_block_rows: Array<{ id: string; sort_order: number; label: string; target: string; log_kind: string | null }> | null
      }
      const blockRows = (blocksResult.data as BlockRow[] | null) ?? []
      for (const session of sessions) {
        if (!loggedIds.includes(session.id)) continue
        const exercises = blockRows
          .filter((block) => block.session_id === session.id)
          .flatMap((block) =>
            [...(block.session_block_rows ?? [])]
              .sort((left, right) => left.sort_order - right.sort_order)
              .flatMap((row) => {
                const kind: LogKind =
                  row.log_kind === "strength" || row.log_kind === "time" || row.log_kind === "mark" || row.log_kind === "check"
                    ? row.log_kind
                    : logKindForBlockType(block.block_type)
                const sets = logRows
                  .filter((log) => log.session_block_row_id === row.id)
                  .map((log) => ({
                    rowId: row.id,
                    setIndex: Number(log.set_index),
                    completed: log.completed !== false,
                    reps: num(log.reps),
                    loadKg: num(log.load_kg),
                    timeSeconds: num(log.time_seconds),
                    distanceM: num(log.distance_m),
                    mark: num(log.mark),
                  }))
                  .filter((log) => !isLogEmpty(log))
                  .sort((left, right) => left.setIndex - right.setIndex)
                  .map((log) => formatSetLog(kind, log))
                  .filter(Boolean)
                return sets.length > 0 ? [{ id: row.id, blockName: block.name, label: row.label, target: row.target, sets }] : []
              }),
          )
        const effort = effortBySession.get(session.id)
        if (exercises.length > 0 || effort?.rpe || effort?.athlete_comment) {
          session.results = { rpe: effort?.rpe ?? null, comment: effort?.athlete_comment ?? null, exercises }
        }
      }
    }
  }

  const prs: CoachAthletePrRow[] = ((prResult.data as Array<{
    id: string
    athlete_id: string
    event: string
    category: string
    best_value: string
    previous_value: string | null
    measured_on: string
    is_legal: boolean
    wind: string | null
    note: string | null
    source_type: "manual" | "test-week" | "import"
  }> | null) ?? []).map((row) => ({
    id: row.id,
    athleteId: row.athlete_id,
    athleteName,
    event: row.event,
    category: toCategory(row.category),
    bestValue: row.best_value,
    previousValue: row.previous_value ?? undefined,
    date: toLocaleShortDate(row.measured_on),
    legal: row.is_legal,
    wind: row.wind ?? undefined,
    type: "Training",
    isoDate: row.measured_on,
    note: row.note,
    source: row.source_type,
  }))

  // Rows arrive newest first: the first hit per test is the latest result, the second is what it is compared with.
  const testsByName = new Map<string, CoachAthleteTestRow & { latestNumeric: number | null; compared: boolean }>()
  for (const row of (testResult.data as Array<{
    id: string
    value_text: string
    value_numeric: number | null
    submitted_at: string
    test_definitions: Array<{ name: string; unit: CoachAthleteTestRow["unit"] }> | { name: string; unit: CoachAthleteTestRow["unit"] } | null
    test_weeks: Array<{ name: string }> | { name: string } | null
  }> | null) ?? []) {
    const definition = firstRelation(row.test_definitions)
    if (!definition?.name) continue
    const key = definition.name.trim().toLowerCase()
    const numeric = row.value_numeric === null ? parseNumericValue(row.value_text) : Number(row.value_numeric)
    const existing = testsByName.get(key)
    if (!existing) {
      testsByName.set(key, {
        id: row.id,
        testName: definition.name,
        unit: definition.unit,
        value: row.value_text,
        previousValue: null,
        change: null,
        submittedAt: row.submitted_at,
        testWeekName: firstRelation(row.test_weeks)?.name ?? null,
        latestNumeric: numeric,
        compared: false,
      })
    } else if (!existing.compared) {
      existing.previousValue = row.value_text
      existing.change = testChange(existing.unit, existing.latestNumeric, numeric)
      existing.compared = true
    }
  }
  const tests: CoachAthleteTestRow[] = [...testsByName.values()].map((row) => ({
    id: row.id,
    testName: row.testName,
    unit: row.unit,
    value: row.value,
    previousValue: row.previousValue,
    change: row.change,
    submittedAt: row.submittedAt,
    testWeekName: row.testWeekName,
  }))

  return ok({ dateOfBirth, readinessFlag, wellness, sessions, prs, tests })
}

/** Saves the coach note on one of the athlete's sessions. The athlete sees it when they open that session. */
export async function updateCoachSessionNoteForCurrentUser(
  athleteId: string,
  sessionId: string,
  note: string,
  options?: ScopedOptions,
): Promise<Result<{ coachNote: string | null }>> {
  const access = await resolveCoachAthleteAccess("updateCoachSessionNoteForCurrentUser", athleteId, options)
  if (!access.ok) return access

  const coachNote = note.trim() ? note.trim() : null
  const { data, error } = await access.data.client
    .from("sessions")
    .update({ coach_note: coachNote })
    .eq("id", sessionId)
    .eq("athlete_id", athleteId)
    .eq("tenant_id", access.data.tenantId)
    .select("id")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("NOT_FOUND", "That session could not be updated.")
  return ok({ coachNote })
}
