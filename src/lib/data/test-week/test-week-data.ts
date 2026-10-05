import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
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

type BenchmarkDefinition = {
  id: string
  name: string
  unit: TestBenchmarkResult["unit"]
}

type BenchmarkRow = {
  athlete_id: string
  test_week_id: string
  value_text: string
  value_numeric: number | null
  submitted_at: string
  test_definitions: BenchmarkDefinition | BenchmarkDefinition[] | null
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
      // PostgREST returns a to-one embed as an object, not an array.
      const definition = firstEmbedded(row.test_definitions)
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
    .select("id, name, unit, is_required, sort_order, scheduled_date, day_index")
    .eq("test_week_id", testWeekId)
    .order("day_index", { ascending: true })
    .order("sort_order", { ascending: true })

  if (error) return { ok: false, error: mapPostgrestError(error) }

  return ok(
    ((data as Array<{
      id: string
      name: string
      unit: ActiveTestDefinition["unit"]
      is_required: boolean
      sort_order: number
      scheduled_date: string
      day_index: number
    }> | null) ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      isRequired: row.is_required,
      scheduledDate: row.scheduled_date,
      dayIndex: row.day_index,
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
  valuesByDefinitionId: Record<string, string>,
): Promise<Result<TestWeekSubmissionResult>> {
  const clientResult = requireSupabaseClient("submitCurrentAthleteTestWeekResults")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentAthleteActiveTestWeekContext()
  if (!contextResult.ok) return contextResult
  if (!contextResult.data) return err("NOT_FOUND", "No active published test week found for current athlete.")

  const context = contextResult.data
  const trimmedEntries = Object.entries(valuesByDefinitionId).map(([definitionId, value]) => [definitionId.trim(), value.trim()] as const)
  const nonEmptyEntries = trimmedEntries.filter(([, value]) => value.length > 0)
  if (nonEmptyEntries.length === 0) {
    return err("VALIDATION", "Enter at least one test result before submitting.")
  }

  const requiredMissing = context.tests
    .filter((test) => test.isRequired)
    .filter((test) => {
      const input = valuesByDefinitionId[test.id] ?? ""
      return !input.trim()
    })
    .map((test) => `${test.name} (${test.scheduledDate})`)

  if (requiredMissing.length > 0) {
    return err("VALIDATION", `Missing required tests: ${requiredMissing.join(", ")}`)
  }

  const toPersist = nonEmptyEntries
    .map(([definitionId, value]) => {
      const definition = context.tests.find((test) => test.id === definitionId)
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
  isArchived: boolean
  testCount: number
  /** Distinct athletes with at least one submitted result for this week. */
  submittedAthleteCount: number
}

const PAGE_SIZE = 1000
const MAX_PAGES = 10

/** PostgREST caps a response at 1000 rows by default, so result reads are paged. */
async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<Result<T[]>> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await loadPage(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const pageRows = (data as T[] | null) ?? []
    rows.push(...pageRows)
    if (pageRows.length < PAGE_SIZE) break
  }
  return ok(rows)
}

export async function getCoachTestWeeksForCurrentUser(params?: {
  scopeTeamId?: string | null
  includeArchived?: boolean
}): Promise<Result<CoachTestWeekListItem[]>> {
  const clientResult = requireSupabaseClient("getCoachTestWeeksForCurrentUser")
  if (!clientResult.ok) return clientResult

  const coachContext = await getCurrentCoachContext(clientResult.client)
  if (!coachContext.ok) return coachContext

  const query = clientResult.client
    .from("test_weeks")
    .select("id, name, team_id, start_date, end_date, status, is_archived")
    .eq("tenant_id", coachContext.data.tenantId)
    .order("start_date", { ascending: false })
    .limit(100)
  if (!params?.includeArchived) query.eq("is_archived", false)
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
    is_archived: boolean
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

  const weekIds = weekRows.map((row) => row.id)
  const submissionRows = await fetchAllPages<{ test_week_id: string; athlete_id: string }>((from, to) =>
    clientResult.client
      .from("test_results")
      .select("test_week_id, athlete_id")
      .eq("tenant_id", coachContext.data.tenantId)
      .in("test_week_id", weekIds)
      .order("id", { ascending: true })
      .range(from, to),
  )
  if (!submissionRows.ok) return submissionRows

  const submittedByWeek = new Map<string, Set<string>>()
  for (const row of submissionRows.data) {
    const athletes = submittedByWeek.get(row.test_week_id) ?? new Set<string>()
    athletes.add(row.athlete_id)
    submittedByWeek.set(row.test_week_id, athletes)
  }

  return ok(
    weekRows.map((row) => ({
      id: row.id,
      name: row.name,
      teamId: row.team_id,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      isArchived: Boolean(row.is_archived),
      testCount: countByWeek[row.id] ?? 0,
      submittedAthleteCount: submittedByWeek.get(row.id)?.size ?? 0,
    })),
  )
}

export async function getCoachTestWeekDefinitions(testWeekId: string): Promise<Result<ActiveTestDefinition[]>> {
  const clientResult = requireSupabaseClient("getCoachTestWeekDefinitions")
  if (!clientResult.ok) return clientResult

  const coachContext = await getCurrentCoachContext(clientResult.client)
  if (!coachContext.ok) return coachContext

  return getTestDefinitionsForWeek(clientResult.client, testWeekId)
}

export async function createPublishedTestWeekForCurrentCoach(input: {
  name: string
  teamId: string
  startDate: string
  endDate: string
  tests: Array<{ name: string; unit: TestDefinitionUnit; scheduledDate: string; dayIndex: number }>
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
      scheduled_date: test.scheduledDate,
      day_index: test.dayIndex,
    })),
  )
  if (definitionError) return { ok: false, error: mapPostgrestError(definitionError) }

  return ok({ testWeekId })
}

export async function archiveTestWeekForCurrentCoach(testWeekId: string): Promise<Result<{ testWeekId: string }>> {
  const clientResult = requireSupabaseClient("archiveTestWeekForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const coachContext = await getCurrentCoachContext(clientResult.client)
  if (!coachContext.ok) return coachContext

  const { error } = await clientResult.client
    .from("test_weeks")
    .update({ is_archived: true, archived_at: new Date().toISOString() })
    .eq("id", testWeekId)
    .eq("tenant_id", coachContext.data.tenantId)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok({ testWeekId })
}

export async function deleteTestWeekForCurrentCoach(testWeekId: string): Promise<Result<{ testWeekId: string }>> {
  const clientResult = requireSupabaseClient("deleteTestWeekForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const coachContext = await getCurrentCoachContext(clientResult.client)
  if (!coachContext.ok) return coachContext

  const { error } = await clientResult.client
    .from("test_weeks")
    .delete()
    .eq("id", testWeekId)
    .eq("tenant_id", coachContext.data.tenantId)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok({ testWeekId })
}

export type CoachTestWeekResultChange = "up" | "down" | "same"

export type CoachTestWeekAthleteRow = {
  athleteId: string
  name: string
  primaryEvent: string | null
  /** False when the athlete has results here but is no longer on the assigned team. */
  onRoster: boolean
  submittedAt: string | null
  resultsByDefinitionId: Record<
    string,
    { valueText: string; valueNumeric: number | null; submittedAt: string; change: CoachTestWeekResultChange | null }
  >
}

export type CoachTestWeekDetail = {
  id: string
  name: string
  teamId: string | null
  startDate: string
  endDate: string
  status: "draft" | "published" | "closed"
  isArchived: boolean
  tests: ActiveTestDefinition[]
  athletes: CoachTestWeekAthleteRow[]
}

type AthleteNameRow = {
  id: string
  first_name: string | null
  last_name: string | null
  primary_event: string | null
  team_id: string | null
}

type EmbeddedDefinition = { name: string; unit: TestDefinitionUnit }

/** PostgREST returns a to-one embed as an object; older typings describe it as an array. Accept both. */
function firstEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

/**
 * Everything a coach needs to review one test week: its tests by day, every athlete on the
 * assigned team, who has submitted, and each submitted value (with movement against that
 * athlete's previous result for a test of the same name).
 */
export async function getCoachTestWeekDetail(testWeekId: string): Promise<Result<CoachTestWeekDetail>> {
  const clientResult = requireSupabaseClient("getCoachTestWeekDetail")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const coachContext = await getCurrentCoachContext(client)
  if (!coachContext.ok) return coachContext
  const tenantId = coachContext.data.tenantId

  const { data: week, error: weekError } = await client
    .from("test_weeks")
    .select("id, name, team_id, start_date, end_date, status, is_archived")
    .eq("id", testWeekId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (weekError) return { ok: false, error: mapPostgrestError(weekError) }
  if (!week) return err("NOT_FOUND", "This test week no longer exists.")

  const testsResult = await getTestDefinitionsForWeek(client, testWeekId)
  if (!testsResult.ok) return testsResult

  const resultRows = await fetchAllPages<{
    athlete_id: string
    test_definition_id: string
    value_text: string
    value_numeric: number | string | null
    submitted_at: string
  }>((from, to) =>
    client
      .from("test_results")
      .select("athlete_id, test_definition_id, value_text, value_numeric, submitted_at")
      .eq("tenant_id", tenantId)
      .eq("test_week_id", testWeekId)
      .order("id", { ascending: true })
      .range(from, to),
  )
  if (!resultRows.ok) return resultRows

  const teamId = (week.team_id as string | null) ?? null
  let rosterRows: AthleteNameRow[] = []
  if (teamId) {
    const { data, error } = await client
      .from("athletes")
      .select("id, first_name, last_name, primary_event, team_id")
      .eq("tenant_id", tenantId)
      .eq("team_id", teamId)
      .eq("is_active", true)
      .order("first_name", { ascending: true })
    if (error) return { ok: false, error: mapPostgrestError(error) }
    rosterRows = (data as AthleteNameRow[] | null) ?? []
  }

  const rosterIds = new Set(rosterRows.map((row) => row.id))
  const offRosterIds = [...new Set(resultRows.data.map((row) => row.athlete_id))].filter((id) => !rosterIds.has(id))
  let offRosterRows: AthleteNameRow[] = []
  for (const ids of chunk(offRosterIds, 100)) {
    const { data, error } = await client
      .from("athletes")
      .select("id, first_name, last_name, primary_event, team_id")
      .eq("tenant_id", tenantId)
      .in("id", ids)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    offRosterRows = offRosterRows.concat((data as AthleteNameRow[] | null) ?? [])
  }

  const definitionById = new Map(testsResult.data.map((test) => [test.id, test]))

  // Previous marks, for movement. A failure here must not hide the results themselves,
  // so movement is simply left blank if this read does not succeed.
  const previousByAthleteAndTest = new Map<string, Array<{ submittedAt: string; value: number }>>()
  const submittedAthleteIds = [...new Set(resultRows.data.map((row) => row.athlete_id))]
  for (const ids of chunk(submittedAthleteIds, 100)) {
    const history = await fetchAllPages<{
      athlete_id: string
      value_numeric: number | string | null
      submitted_at: string
      test_definitions: EmbeddedDefinition | EmbeddedDefinition[] | null
    }>((from, to) =>
      client
        .from("test_results")
        .select("athlete_id, value_numeric, submitted_at, test_definitions(name, unit)")
        .eq("tenant_id", tenantId)
        .in("athlete_id", ids)
        .neq("test_week_id", testWeekId)
        .order("submitted_at", { ascending: false })
        .range(from, to),
    )
    if (!history.ok) break
    for (const row of history.data) {
      const definition = firstEmbedded(row.test_definitions)
      const value = row.value_numeric === null ? null : Number(row.value_numeric)
      if (!definition || value === null || !Number.isFinite(value)) continue
      const key = `${row.athlete_id}:${definition.name.trim().toLowerCase()}`
      const list = previousByAthleteAndTest.get(key) ?? []
      list.push({ submittedAt: row.submitted_at, value })
      previousByAthleteAndTest.set(key, list)
    }
  }

  const toRow = (athlete: AthleteNameRow, onRoster: boolean): CoachTestWeekAthleteRow => ({
    athleteId: athlete.id,
    name: [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim() || "Unnamed athlete",
    primaryEvent: athlete.primary_event,
    onRoster,
    submittedAt: null,
    resultsByDefinitionId: {},
  })
  const athleteRows = new Map<string, CoachTestWeekAthleteRow>()
  for (const athlete of rosterRows) athleteRows.set(athlete.id, toRow(athlete, true))
  for (const athlete of offRosterRows) athleteRows.set(athlete.id, toRow(athlete, false))

  for (const row of resultRows.data) {
    const athleteRow = athleteRows.get(row.athlete_id)
    const definition = definitionById.get(row.test_definition_id)
    if (!athleteRow || !definition) continue

    const valueNumeric = row.value_numeric === null ? null : Number(row.value_numeric)
    let change: CoachTestWeekResultChange | null = null
    if (valueNumeric !== null && Number.isFinite(valueNumeric)) {
      const previous = (previousByAthleteAndTest.get(`${row.athlete_id}:${definition.name.trim().toLowerCase()}`) ?? []).find(
        (candidate) => candidate.submittedAt < row.submitted_at,
      )
      if (previous) {
        if (previous.value === valueNumeric) change = "same"
        else change = isBetterPerformance(definition.unit, valueNumeric, previous.value) ? "up" : "down"
      }
    }

    athleteRow.resultsByDefinitionId[definition.id] = {
      valueText: row.value_text,
      valueNumeric: valueNumeric !== null && Number.isFinite(valueNumeric) ? valueNumeric : null,
      submittedAt: row.submitted_at,
      change,
    }
    if (!athleteRow.submittedAt || row.submitted_at > athleteRow.submittedAt) athleteRow.submittedAt = row.submitted_at
  }

  return ok({
    id: week.id as string,
    name: week.name as string,
    teamId,
    startDate: week.start_date as string,
    endDate: week.end_date as string,
    status: week.status as CoachTestWeekDetail["status"],
    isArchived: Boolean(week.is_archived),
    tests: testsResult.data,
    athletes: [...athleteRows.values()],
  })
}

export type SaveCoachTestWeekInput = {
  /** Omit to create a new test week. */
  testWeekId?: string | null
  name: string
  teamId: string
  startDate: string
  endDate: string
  /** True publishes (or keeps published). False saves a new week as a draft and leaves an existing status alone. */
  publish: boolean
  tests: Array<{ id?: string | null; name: string; unit: TestDefinitionUnit; scheduledDate: string; dayIndex: number }>
}

function validateTestWeekInput(input: SaveCoachTestWeekInput): DataError | null {
  if (!input.name.trim()) return { code: "VALIDATION", message: "Give the test week a name." }
  if (!input.teamId) return { code: "VALIDATION", message: "Choose a team for this test week." }
  if (!input.startDate || !input.endDate) return { code: "VALIDATION", message: "Set a start and end date." }
  if (input.endDate < input.startDate) return { code: "VALIDATION", message: "The end date cannot be before the start date." }
  if (input.tests.length === 0) return { code: "VALIDATION", message: "Add at least one test." }

  const seen = new Set<string>()
  for (const test of input.tests) {
    if (!test.name.trim()) return { code: "VALIDATION", message: "Every test needs a name." }
    if (test.dayIndex < 0 || test.dayIndex > 30) {
      return { code: "VALIDATION", message: "A test week can run for 31 days at most." }
    }
    const key = `${test.dayIndex}:${test.name.trim().toLowerCase()}`
    if (seen.has(key)) {
      return { code: "VALIDATION", message: `"${test.name.trim()}" is listed twice on day ${test.dayIndex + 1}.` }
    }
    seen.add(key)
  }
  return null
}

/**
 * Create or edit a test week together with its per-day tests.
 * Editing keeps existing test definitions (and the results attached to them) where the
 * id is passed back, inserts new ones, and deletes the ones that were removed. Deleting a
 * definition cascades to its submitted results.
 */
export async function saveTestWeekForCurrentCoach(input: SaveCoachTestWeekInput): Promise<Result<{ testWeekId: string }>> {
  const clientResult = requireSupabaseClient("saveTestWeekForCurrentCoach")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const coachContext = await getCurrentCoachContext(client)
  if (!coachContext.ok) return coachContext
  const tenantId = coachContext.data.tenantId

  const invalid = validateTestWeekInput(input)
  if (invalid) return { ok: false, error: invalid }

  const tests = input.tests.map((test, index) => ({
    id: test.id ?? null,
    row: {
      sort_order: index,
      name: test.name.trim(),
      unit: test.unit,
      is_required: true,
      scheduled_date: test.scheduledDate,
      day_index: test.dayIndex,
    },
  }))

  if (!input.testWeekId) {
    const { data: insertedWeek, error: weekError } = await client
      .from("test_weeks")
      .insert({
        tenant_id: tenantId,
        team_id: input.teamId,
        name: input.name.trim(),
        start_date: input.startDate,
        end_date: input.endDate,
        status: input.publish ? "published" : "draft",
        created_by_user_id: coachContext.data.userId,
      })
      .select("id")
      .single()
    if (weekError) return { ok: false, error: mapPostgrestError(weekError) }

    const testWeekId = insertedWeek.id as string
    const { error: definitionError } = await client
      .from("test_definitions")
      .insert(tests.map((test) => ({ test_week_id: testWeekId, ...test.row })))
    if (definitionError) {
      // Do not leave a week with no tests behind.
      await client.from("test_weeks").delete().eq("id", testWeekId).eq("tenant_id", tenantId)
      return { ok: false, error: mapPostgrestError(definitionError) }
    }
    return ok({ testWeekId })
  }

  const testWeekId = input.testWeekId
  const { data: existingWeek, error: existingWeekError } = await client
    .from("test_weeks")
    .select("id, status")
    .eq("id", testWeekId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (existingWeekError) return { ok: false, error: mapPostgrestError(existingWeekError) }
  if (!existingWeek) return err("NOT_FOUND", "This test week no longer exists.")

  const { data: existingDefinitions, error: existingDefinitionsError } = await client
    .from("test_definitions")
    .select("id")
    .eq("test_week_id", testWeekId)
  if (existingDefinitionsError) return { ok: false, error: mapPostgrestError(existingDefinitionsError) }
  const existingIds = new Set(((existingDefinitions as Array<{ id: string }> | null) ?? []).map((row) => row.id))

  const { data: updatedWeeks, error: updateWeekError } = await client
    .from("test_weeks")
    .update({
      team_id: input.teamId,
      name: input.name.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      status: input.publish ? "published" : (existingWeek.status as string),
    })
    .eq("id", testWeekId)
    .eq("tenant_id", tenantId)
    .select("id")
  if (updateWeekError) return { ok: false, error: mapPostgrestError(updateWeekError) }
  if (!updatedWeeks || updatedWeeks.length === 0) {
    return err("FORBIDDEN", "You do not have permission to edit this test week.")
  }

  const keptIds = new Set(tests.map((test) => test.id).filter((id): id is string => Boolean(id && existingIds.has(id))))
  const removedIds = [...existingIds].filter((id) => !keptIds.has(id))
  if (removedIds.length > 0) {
    const { error } = await client.from("test_definitions").delete().eq("test_week_id", testWeekId).in("id", removedIds)
    if (error) return { ok: false, error: mapPostgrestError(error) }
  }

  for (const test of tests) {
    if (!test.id || !existingIds.has(test.id)) continue
    const { error } = await client.from("test_definitions").update(test.row).eq("id", test.id).eq("test_week_id", testWeekId)
    if (error) return { ok: false, error: mapPostgrestError(error) }
  }

  const toInsert = tests.filter((test) => !test.id || !existingIds.has(test.id))
  if (toInsert.length > 0) {
    const { error } = await client
      .from("test_definitions")
      .insert(toInsert.map((test) => ({ test_week_id: testWeekId, ...test.row })))
    if (error) return { ok: false, error: mapPostgrestError(error) }
  }

  return ok({ testWeekId })
}

/** Publish a draft, or move a week into or out of the archive. */
export async function updateTestWeekStateForCurrentCoach(
  testWeekId: string,
  next: { status?: "draft" | "published" | "closed"; isArchived?: boolean },
): Promise<Result<{ testWeekId: string }>> {
  const clientResult = requireSupabaseClient("updateTestWeekStateForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const coachContext = await getCurrentCoachContext(clientResult.client)
  if (!coachContext.ok) return coachContext

  const patch: Record<string, unknown> = {}
  if (next.status) patch.status = next.status
  if (typeof next.isArchived === "boolean") {
    patch.is_archived = next.isArchived
    patch.archived_at = next.isArchived ? new Date().toISOString() : null
  }
  if (Object.keys(patch).length === 0) return ok({ testWeekId })

  if (next.status === "published") {
    const { count, error: countError } = await clientResult.client
      .from("test_definitions")
      .select("id", { count: "exact", head: true })
      .eq("test_week_id", testWeekId)
    if (countError) return { ok: false, error: mapPostgrestError(countError) }
    if (!count) return err("VALIDATION", "Add at least one test before publishing.")
  }

  const { data, error } = await clientResult.client
    .from("test_weeks")
    .update(patch)
    .eq("id", testWeekId)
    .eq("tenant_id", coachContext.data.tenantId)
    .select("id")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("NOT_FOUND", "This test week no longer exists, or you cannot change it.")
  return ok({ testWeekId })
}
