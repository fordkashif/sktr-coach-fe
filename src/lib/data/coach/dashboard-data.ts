import type { SupabaseClient } from "@supabase/supabase-js"
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

export async function getCoachDashboardSnapshotForCurrentUser(options?: ScopedOptions): Promise<Result<CoachDashboardSnapshot>> {
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
  const scopedTeamId = options?.scopeTeamId ?? null
  const teamsQuery = clientResult.client.from("teams").select("id, name, event_group").eq("tenant_id", tenantId).eq("is_archived", false)
  const athletesQuery = clientResult.client
    .from("athletes")
    .select("id, team_id, first_name, last_name, event_group, primary_event, readiness, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
  if (scopedTeamId) athletesQuery.eq("team_id", scopedTeamId)

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
    .filter((row) => (scopedTeamId ? row.id === scopedTeamId : true))
    .map((row) => ({
      id: row.id,
      name: row.name,
      eventGroup: toEventGroup(row.event_group),
      athleteCount: countByTeam[row.id] ?? 0,
      disciplines: undefined,
    }))

  if (athleteIds.length === 0) {
    return ok({ teams, athletes: [], prs: [], tests: [], trendSeries: {} })
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
    test_definitions: Array<{ name: string }> | null
  }> | null) ?? []).reduce<Record<string, TestWeekResult>>((acc, row) => {
    const metricName = row.test_definitions?.[0]?.name
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

  return ok({
    teams,
    athletes,
    prs,
    tests,
    trendSeries: wellnessByAthlete,
  })
}

export async function getCoachWellnessEntriesForCurrentUser(options?: ScopedOptions): Promise<Result<WellnessEntry[]>> {
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
  const athleteQuery = clientResult.client
    .from("athletes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
  if (options?.scopeTeamId) athleteQuery.eq("team_id", options.scopeTeamId)

  const { data: athleteRows, error: athleteError } = await athleteQuery
  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }

  const athleteIds = ((athleteRows as Array<{ id: string }> | null) ?? []).map((row) => row.id)
  if (athleteIds.length === 0) return ok([])

  const { data: wellnessRows, error: wellnessError } = await clientResult.client
    .from("wellness_entries")
    .select("id, athlete_id, entry_date, sleep_hours, soreness, fatigue, mood, stress, notes, readiness")
    .in("athlete_id", athleteIds)
    .order("entry_date", { ascending: false })
    .limit(500)

  if (wellnessError) return { ok: false, error: mapPostgrestError(wellnessError) }

  return ok(
    ((wellnessRows as Array<{
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
    })),
  )
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

  const athleteQuery = clientResult.client
    .from("athletes")
    .select("id, team_id")
    .eq("tenant_id", profile.tenant_id as string)
    .eq("id", athleteId)
    .maybeSingle()
  const { data: athleteRow, error: athleteError } = await athleteQuery
  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
  if (!athleteRow) return err("NOT_FOUND", "Athlete not found in current tenant.")
  if (options?.scopeTeamId && athleteRow.team_id !== options.scopeTeamId) {
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
