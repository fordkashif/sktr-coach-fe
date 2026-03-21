import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import type {
  ActiveTestDefinition,
  CurrentAthleteTestWeekContext,
  LatestBenchmarkSnapshot,
  TestDefinitionUnit,
  TestBenchmarkResult,
  TestWeekSubmissionResult,
} from "@/lib/data/test-week/types"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: DataError }

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

async function getCurrentAthleteId(client: SupabaseClient): Promise<Result<string>> {
  const context = await getCurrentAthleteContext(client)
  if (!context.ok) return context
  return ok(context.data.athleteId)
}

type AthleteContext = {
  athleteId: string
  tenantId: string
  teamId: string | null
}

type CoachContext = {
  userId: string
  tenantId: string
  role: "coach" | "club-admin"
}

async function getCurrentAthleteContext(client: SupabaseClient): Promise<Result<AthleteContext>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: athlete, error: athleteError } = await client
    .from("athletes")
    .select("id, tenant_id, team_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (athleteError) return { ok: false, error: mapPostgrestError(athleteError) }
  if (!athlete) return err("NOT_FOUND", "No athlete profile found for current user.")

  return ok({
    athleteId: athlete.id,
    tenantId: athlete.tenant_id,
    teamId: athlete.team_id,
  })
}

async function getCurrentCoachContext(client: SupabaseClient): Promise<Result<CoachContext>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data: profile, error } = await client
    .from("profiles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  if (profile.role !== "coach" && profile.role !== "club-admin") {
    return err("FORBIDDEN", "Only coach or club-admin users can manage test weeks.")
  }

  return ok({
    userId,
    tenantId: profile.tenant_id as string,
    role: profile.role as "coach" | "club-admin",
  })
}

type WeekMetaRow = {
  id: string
  name: string
  start_date: string
  end_date: string
}

type BenchmarkRow = {
  athlete_id: string
  test_week_id: string
  value_text: string
  value_numeric: number | null
  submitted_at: string
  test_definitions: Array<{
    id: string
    name: string
    unit: TestBenchmarkResult["unit"]
  }> | null
}

async function getLatestTestWeekForAthlete(client: SupabaseClient, athleteId: string): Promise<Result<WeekMetaRow | null>> {
  const { data: recentResult, error: recentError } = await client
    .from("test_results")
    .select("test_week_id, submitted_at")
    .eq("athlete_id", athleteId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recentError) return { ok: false, error: mapPostgrestError(recentError) }
  if (!recentResult) return ok(null)

  const { data: week, error: weekError } = await client
    .from("test_weeks")
    .select("id, name, start_date, end_date")
    .eq("id", recentResult.test_week_id)
    .maybeSingle()

  if (weekError) return { ok: false, error: mapPostgrestError(weekError) }
  if (!week) return ok(null)
  return ok(week as WeekMetaRow)
}

async function getBenchmarkSnapshotForAthlete(client: SupabaseClient, athleteId: string): Promise<Result<LatestBenchmarkSnapshot | null>> {
  const latestWeek = await getLatestTestWeekForAthlete(client, athleteId)
  if (!latestWeek.ok) return latestWeek
  if (!latestWeek.data) return ok(null)

  const { data: rows, error } = await client
    .from("test_results")
    .select("athlete_id, test_week_id, value_text, value_numeric, submitted_at, test_definitions(id, name, unit)")
    .eq("athlete_id", athleteId)
    .eq("test_week_id", latestWeek.data.id)
    .order("submitted_at", { ascending: false })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  const results = ((rows as BenchmarkRow[] | null) ?? [])
    .map((row) => {
      const definition = row.test_definitions?.[0]
      if (!definition) return null
      return {
        testDefinitionId: definition.id,
        label: definition.name,
        unit: definition.unit,
        valueText: row.value_text,
        valueNumeric: row.value_numeric,
        submittedAt: row.submitted_at,
      }
    })
    .filter((row): row is TestBenchmarkResult => Boolean(row))

  return ok({
    athleteId,
    testWeekId: latestWeek.data.id,
    testWeekName: latestWeek.data.name,
    startDate: latestWeek.data.start_date,
    endDate: latestWeek.data.end_date,
    results,
  })
}

async function getLatestPublishedTestWeekForTeam(client: SupabaseClient, teamId: string): Promise<Result<WeekMetaRow | null>> {
  const { data, error } = await client
    .from("test_weeks")
    .select("id, name, start_date, end_date")
    .eq("team_id", teamId)
    .eq("status", "published")
    .eq("is_archived", false)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return ok(null)
  return ok(data as WeekMetaRow)
}

async function getTestDefinitionsForWeek(client: SupabaseClient, testWeekId: string): Promise<Result<ActiveTestDefinition[]>> {
  const { data, error } = await client
    .from("test_definitions")
    .select("id, name, unit, is_required, sort_order")
    .eq("test_week_id", testWeekId)
    .order("sort_order", { ascending: true })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      name: string
      unit: ActiveTestDefinition["unit"]
      is_required: boolean
      sort_order: number
    }> | null) ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      isRequired: row.is_required,
    })),
  )
}

async function getLatestSubmissionStamp(
  client: SupabaseClient,
  athleteId: string,
  testWeekId: string,
): Promise<Result<string | null>> {
  const { data, error } = await client
    .from("test_results")
    .select("submitted_at")
    .eq("athlete_id", athleteId)
    .eq("test_week_id", testWeekId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return ok(null)
  return ok(data.submitted_at as string)
}

function parseNumericValue(valueText: string) {
  const normalized = valueText.replace(",", ".")
  const numeric = Number.parseFloat(normalized)
  return Number.isFinite(numeric) ? numeric : null
}

function categoryForTestUnit(unit: ActiveTestDefinition["unit"]): string {
  if (unit === "weight") return "Strength"
  if (unit === "height") return "Jumps"
  if (unit === "distance") return "Distance"
  if (unit === "time") return "Sprint"
  return "Performance"
}

function parseComparableNumericFromText(value: string): number | null {
  const normalized = value.replace(",", ".").replace(/[^\d.-]/g, "")
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function isBetterPerformance(unit: ActiveTestDefinition["unit"], candidate: number | null, baseline: number | null): boolean {
  if (candidate === null) return false
  if (baseline === null) return true
  if (unit === "time") return candidate < baseline
  return candidate > baseline
}

export async function getLatestBenchmarkSnapshotForCurrentAthlete(): Promise<Result<LatestBenchmarkSnapshot | null>> {
  const clientResult = requireSupabaseClient("getLatestBenchmarkSnapshotForCurrentAthlete")
  if (!clientResult.ok) return clientResult

  const athleteIdResult = await getCurrentAthleteId(clientResult.client)
  if (!athleteIdResult.ok) return athleteIdResult

  return getBenchmarkSnapshotForAthlete(clientResult.client, athleteIdResult.data)
}

export async function getLatestBenchmarkSnapshotForAthlete(athleteId: string): Promise<Result<LatestBenchmarkSnapshot | null>> {
  const clientResult = requireSupabaseClient("getLatestBenchmarkSnapshotForAthlete")
  if (!clientResult.ok) return clientResult

  return getBenchmarkSnapshotForAthlete(clientResult.client, athleteId)
}

export async function getCurrentAthleteActiveTestWeekContext(): Promise<Result<CurrentAthleteTestWeekContext | null>> {
  const clientResult = requireSupabaseClient("getCurrentAthleteActiveTestWeekContext")
  if (!clientResult.ok) return clientResult

  const athleteContext = await getCurrentAthleteContext(clientResult.client)
  if (!athleteContext.ok) return athleteContext
  if (!athleteContext.data.teamId) return ok(null)

  const latestWeek = await getLatestPublishedTestWeekForTeam(clientResult.client, athleteContext.data.teamId)
  if (!latestWeek.ok) return latestWeek
  if (!latestWeek.data) return ok(null)

  const testsResult = await getTestDefinitionsForWeek(clientResult.client, latestWeek.data.id)
  if (!testsResult.ok) return testsResult

  const submissionStampResult = await getLatestSubmissionStamp(
    clientResult.client,
    athleteContext.data.athleteId,
    latestWeek.data.id,
  )
  if (!submissionStampResult.ok) return submissionStampResult

  return ok({
    athleteId: athleteContext.data.athleteId,
    testWeekId: latestWeek.data.id,
    testWeekName: latestWeek.data.name,
    startDate: latestWeek.data.start_date,
    endDate: latestWeek.data.end_date,
    tests: testsResult.data,
    lastSubmittedAt: submissionStampResult.data,
  })
}

export async function submitCurrentAthleteTestWeekResults(
  valuesByTestName: Record<string, string>,
): Promise<Result<TestWeekSubmissionResult>> {
  const clientResult = requireSupabaseClient("submitCurrentAthleteTestWeekResults")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentAthleteActiveTestWeekContext()
  if (!contextResult.ok) return contextResult
  if (!contextResult.data) return err("NOT_FOUND", "No active published test week found for current athlete.")

  const context = contextResult.data
  const trimmedEntries = Object.entries(valuesByTestName).map(([name, value]) => [name.trim(), value.trim()] as const)
  const nonEmptyEntries = trimmedEntries.filter(([, value]) => value.length > 0)
  if (nonEmptyEntries.length === 0) {
    return err("VALIDATION", "Enter at least one test result before submitting.")
  }

  const definitionByName = new Map(context.tests.map((test) => [test.name.toLowerCase(), test]))
  const requiredMissing = context.tests
    .filter((test) => test.isRequired)
    .filter((test) => {
      const input = valuesByTestName[test.name] ?? valuesByTestName[test.name.toLowerCase()] ?? ""
      return !input.trim()
    })
    .map((test) => test.name)

  if (requiredMissing.length > 0) {
    return err("VALIDATION", `Missing required tests: ${requiredMissing.join(", ")}`)
  }

  const toPersist = nonEmptyEntries
    .map(([name, value]) => {
      const definition = definitionByName.get(name.toLowerCase())
      if (!definition) return null
      return {
        test_week_id: context.testWeekId,
        test_definition_id: definition.id,
        athlete_id: context.athleteId,
        test_name: definition.name,
        test_unit: definition.unit,
        value_text: value,
        value_numeric: parseNumericValue(value),
      }
    })
    .filter((item): item is {
      test_week_id: string
      test_definition_id: string
      athlete_id: string
      test_name: string
      test_unit: ActiveTestDefinition["unit"]
      value_text: string
      value_numeric: number | null
    } => Boolean(item))

  if (toPersist.length === 0) {
    return err("VALIDATION", "No submitted tests matched the active test-week definitions.")
  }

  const { data: athleteRow, error: athleteRowError } = await clientResult.client
    .from("athletes")
    .select("tenant_id")
    .eq("id", context.athleteId)
    .single()

  if (athleteRowError) return { ok: false, error: mapPostgrestError(athleteRowError) }

  const submittedAt = new Date().toISOString()
  const payload = toPersist.map((row) => ({
    tenant_id: athleteRow.tenant_id as string,
    test_week_id: row.test_week_id,
    test_definition_id: row.test_definition_id,
    athlete_id: row.athlete_id,
    value_text: row.value_text,
    value_numeric: row.value_numeric,
    submitted_at: submittedAt,
  }))

  const { error: upsertError } = await clientResult.client
    .from("test_results")
    .upsert(payload, { onConflict: "test_week_id,test_definition_id,athlete_id" })

  if (upsertError) return { ok: false, error: mapPostgrestError(upsertError) }

  for (const row of toPersist) {
    const { data: existingPr, error: existingPrError } = await clientResult.client
      .from("pr_records")
      .select("id, best_value")
      .eq("athlete_id", context.athleteId)
      .eq("event", row.test_name)
      .maybeSingle()

    if (existingPrError) return { ok: false, error: mapPostgrestError(existingPrError) }

    const existingNumeric = existingPr ? parseComparableNumericFromText(existingPr.best_value as string) : null
    if (!isBetterPerformance(row.test_unit, row.value_numeric, existingNumeric)) continue

    const { error: prUpsertError } = await clientResult.client
      .from("pr_records")
      .upsert(
        {
          tenant_id: athleteRow.tenant_id as string,
          athlete_id: context.athleteId,
          event: row.test_name,
          category: categoryForTestUnit(row.test_unit),
          best_value: row.value_text,
          previous_value: existingPr?.best_value ?? null,
          measured_on: submittedAt.slice(0, 10),
          source_type: "test-week",
          source_ref: `${context.testWeekId}:${row.test_definition_id}`,
          is_legal: true,
          recorded_by_user_id: null,
        },
        { onConflict: "athlete_id,event" },
      )

    if (prUpsertError) return { ok: false, error: mapPostgrestError(prUpsertError) }
  }

  return ok({
    athleteId: context.athleteId,
    testWeekId: context.testWeekId,
    submittedAt,
    submittedCount: payload.length,
  })
}

export type CoachTestWeekListItem = {
  id: string
  name: string
  teamId: string | null
  startDate: string
  endDate: string
  status: "draft" | "published" | "closed"
  testCount: number
}

export async function getCoachTestWeeksForCurrentUser(params?: {
  scopeTeamId?: string | null
}): Promise<Result<CoachTestWeekListItem[]>> {
  const clientResult = requireSupabaseClient("getCoachTestWeeksForCurrentUser")
  if (!clientResult.ok) return clientResult

  const coachContext = await getCurrentCoachContext(clientResult.client)
  if (!coachContext.ok) return coachContext

  const query = clientResult.client
    .from("test_weeks")
    .select("id, name, team_id, start_date, end_date, status")
    .eq("tenant_id", coachContext.data.tenantId)
    .eq("is_archived", false)
    .order("start_date", { ascending: false })
    .limit(100)
  if (params?.scopeTeamId) query.eq("team_id", params.scopeTeamId)

  const { data: weeks, error: weeksError } = await query
  if (weeksError) return { ok: false, error: mapPostgrestError(weeksError) }

  const weekRows = (weeks as Array<{
    id: string
    name: string
    team_id: string | null
    start_date: string
    end_date: string
    status: "draft" | "published" | "closed"
  }> | null) ?? []
  if (weekRows.length === 0) return ok([])

  const { data: definitions, error: definitionsError } = await clientResult.client
    .from("test_definitions")
    .select("test_week_id")
    .in("test_week_id", weekRows.map((row) => row.id))
  if (definitionsError) return { ok: false, error: mapPostgrestError(definitionsError) }

  const countByWeek = ((definitions as Array<{ test_week_id: string }> | null) ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.test_week_id] = (acc[row.test_week_id] ?? 0) + 1
      return acc
    },
    {},
  )

  return ok(
    weekRows.map((row) => ({
      id: row.id,
      name: row.name,
      teamId: row.team_id,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      testCount: countByWeek[row.id] ?? 0,
    })),
  )
}

export async function createPublishedTestWeekForCurrentCoach(input: {
  name: string
  teamId: string
  startDate: string
  endDate: string
  tests: Array<{ name: string; unit: TestDefinitionUnit }>
}): Promise<Result<{ testWeekId: string }>> {
  const clientResult = requireSupabaseClient("createPublishedTestWeekForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const coachContext = await getCurrentCoachContext(clientResult.client)
  if (!coachContext.ok) return coachContext
  if (!input.tests.length) return err("VALIDATION", "At least one test is required.")

  const { data: insertedWeek, error: weekError } = await clientResult.client
    .from("test_weeks")
    .insert({
      tenant_id: coachContext.data.tenantId,
      team_id: input.teamId,
      name: input.name,
      start_date: input.startDate,
      end_date: input.endDate,
      status: "published",
      created_by_user_id: coachContext.data.userId,
    })
    .select("id")
    .single()
  if (weekError) return { ok: false, error: mapPostgrestError(weekError) }

  const testWeekId = insertedWeek.id as string
  const { error: definitionError } = await clientResult.client.from("test_definitions").insert(
    input.tests.map((test, index) => ({
      test_week_id: testWeekId,
      sort_order: index,
      name: test.name,
      unit: test.unit,
      is_required: true,
    })),
  )
  if (definitionError) return { ok: false, error: mapPostgrestError(definitionError) }

  return ok({ testWeekId })
}
