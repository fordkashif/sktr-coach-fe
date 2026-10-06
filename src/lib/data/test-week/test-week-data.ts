import { guardStamp, staleWriteError, type EditGuard } from "@/lib/data/edit-conflict-data"
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import { kickNotificationEmails } from "@/lib/data/notifications-data"
import { err, mapPostgrestError, ok, type DataError, type Result } from "@/lib/data/result"
import { eventGroupKey, formatMarkWithUnit, resolveEventByName, seasonFor, selectBests, type MarkUnit } from "@/lib/data/pr/marks"
import { loadMockResultsState } from "@/lib/data/pr/mock-results-store"
import { mapResultRow, RESULT_COLUMNS, type ResultRow } from "@/lib/data/pr/results-data"
import type {
  ActiveTestDefinition,
  AthleteTestWeekHistoryItem,
  CurrentAthleteTestWeekContext,
  LatestBenchmarkSnapshot,
  TestDefinitionUnit,
  TestBenchmarkResult,
  TestWeekSubmissionResult,
} from "@/lib/data/test-week/types"
import { checkTestResultEntry } from "@/lib/data/test-week/result-entry"
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

type AthleteWeekRow = WeekMetaRow & { status: "published" | "closed" }

function localIsoDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * The one test week an athlete should see. Drafts and archived weeks are never returned.
 * Order of preference: a published week running today, the next published week,
 * the most recent published week, then the most recent closed week (read only).
 */
async function getAthleteFacingTestWeekForTeam(client: SupabaseClient, teamId: string): Promise<Result<AthleteWeekRow | null>> {
  const { data, error } = await client
    .from("test_weeks")
    .select("id, name, start_date, end_date, status")
    .eq("team_id", teamId)
    .in("status", ["published", "closed"])
    .eq("is_archived", false)
    .order("start_date", { ascending: false })
    .limit(25)

  if (error) return { ok: false, error: mapPostgrestError(error) }
  const rows = ((data as AthleteWeekRow[] | null) ?? []).filter((row) => row.status === "published" || row.status === "closed")
  if (rows.length === 0) return ok(null)

  const today = localIsoDate()
  const published = rows.filter((row) => row.status === "published")
  const running = published.find((row) => row.start_date <= today && row.end_date >= today)
  if (running) return ok(running)
  const upcoming = published.filter((row) => row.start_date > today).sort((x, y) => x.start_date.localeCompare(y.start_date))[0]
  if (upcoming) return ok(upcoming)
  if (published[0]) return ok(published[0])
  return ok(rows[0])
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

function parseNumericValue(valueText: string) {
  const normalized = valueText.replace(",", ".")
  const numeric = Number.parseFloat(normalized)
  return Number.isFinite(numeric) ? numeric : null
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

  const latestWeek = await getAthleteFacingTestWeekForTeam(clientResult.client, athleteContext.data.teamId)
  if (!latestWeek.ok) return latestWeek
  if (!latestWeek.data) return ok(null)

  const testsResult = await getTestDefinitionsForWeek(clientResult.client, latestWeek.data.id)
  if (!testsResult.ok) return testsResult

  type OwnResultRow = {
    test_week_id: string
    test_definition_id: string
    value_text: string
    value_numeric: number | string | null
    submitted_at: string
    test_definitions: { name: string } | Array<{ name: string }> | null
  }

  // One read covers this week's saved answers and the most recent earlier result per test name.
  const { data: ownRows, error: ownRowsError } = await clientResult.client
    .from("test_results")
    .select("test_week_id, test_definition_id, value_text, value_numeric, submitted_at, test_definitions(name)")
    .eq("athlete_id", athleteContext.data.athleteId)
    .order("submitted_at", { ascending: false })
    .limit(500)

  if (ownRowsError) return { ok: false, error: mapPostgrestError(ownRowsError) }

  const results: CurrentAthleteTestWeekContext["results"] = {}
  const previousByName = new Map<string, { valueText: string; submittedAt: string }>()
  let lastSubmittedAt: string | null = null

  for (const row of (ownRows as OwnResultRow[] | null) ?? []) {
    if (row.test_week_id === latestWeek.data.id) {
      const numeric = row.value_numeric === null ? null : Number(row.value_numeric)
      results[row.test_definition_id] = {
        valueText: row.value_text,
        valueNumeric: numeric !== null && Number.isFinite(numeric) ? numeric : null,
        submittedAt: row.submitted_at,
      }
      if (!lastSubmittedAt || row.submitted_at > lastSubmittedAt) lastSubmittedAt = row.submitted_at
      continue
    }
    const name = firstEmbedded(row.test_definitions)?.name?.trim().toLowerCase()
    if (name && !previousByName.has(name)) {
      previousByName.set(name, { valueText: row.value_text, submittedAt: row.submitted_at })
    }
  }

  const previous: CurrentAthleteTestWeekContext["previous"] = {}
  for (const test of testsResult.data) {
    const match = previousByName.get(test.name.trim().toLowerCase())
    if (match) previous[test.id] = match
  }

  return ok({
    athleteId: athleteContext.data.athleteId,
    testWeekId: latestWeek.data.id,
    testWeekName: latestWeek.data.name,
    startDate: latestWeek.data.start_date,
    endDate: latestWeek.data.end_date,
    status: latestWeek.data.status,
    tests: testsResult.data,
    lastSubmittedAt,
    results,
    previous,
  })
}

const TEST_WEEK_NOT_OPEN_MESSAGE =
  "These results were not saved because this test week is not open for your team right now. Your coach may have closed it. Reload the page, and ask your coach to reopen it if you still need to enter results."

/** value_numeric is numeric(10, 3): keep entries inside what the column can hold. */
const MAX_TEST_RESULT_VALUE = 100000

export async function submitCurrentAthleteTestWeekResults(
  valuesByDefinitionId: Record<string, string>,
): Promise<Result<TestWeekSubmissionResult>> {
  const clientResult = requireSupabaseClient("submitCurrentAthleteTestWeekResults")
  if (!clientResult.ok) return clientResult

  const contextResult = await getCurrentAthleteActiveTestWeekContext()
  if (!contextResult.ok) return contextResult
  if (!contextResult.data) return err("NOT_FOUND", "There is no open test week for your team right now.")

  const context = contextResult.data
  if (context.status !== "published") {
    return err("VALIDATION", "This test week is closed, so results can no longer be changed. Ask your coach to reopen it.")
  }
  if (context.startDate > localIsoDate()) {
    return err("VALIDATION", "This test week has not started yet.")
  }

  const trimmedEntries = Object.entries(valuesByDefinitionId).map(([definitionId, value]) => [definitionId.trim(), value.trim()] as const)
  const nonEmptyEntries = trimmedEntries.filter(([, value]) => value.length > 0)
  if (nonEmptyEntries.length === 0) {
    return err("VALIDATION", "Enter at least one test result before submitting.")
  }

  // Test weeks run over several days, so a submission may cover only the tests done so far.
  // Required tests are tracked on screen (and by the coach) rather than blocking a partial save.
  const invalid: string[] = []
  const toPersist = nonEmptyEntries
    .map(([definitionId, value]) => {
      const definition = context.tests.find((test) => test.id === definitionId)
      if (!definition) return null
      const numeric = parseNumericValue(value)
      if (numeric === null || numeric <= 0 || numeric >= MAX_TEST_RESULT_VALUE) {
        invalid.push(definition.name)
        return null
      }
      return {
        test_week_id: context.testWeekId,
        test_definition_id: definition.id,
        athlete_id: context.athleteId,
        test_name: definition.name,
        test_unit: definition.unit,
        value_text: value,
        value_numeric: Math.round(numeric * 1000) / 1000,
      }
    })
    .filter((item): item is {
      test_week_id: string
      test_definition_id: string
      athlete_id: string
      test_name: string
      test_unit: ActiveTestDefinition["unit"]
      value_text: string
      value_numeric: number
    } => Boolean(item))

  if (invalid.length > 0) {
    return err("VALIDATION", `Enter a number greater than 0 for: ${invalid.join(", ")}`)
  }

  if (toPersist.length === 0) {
    return err("VALIDATION", "No submitted tests matched the active test-week definitions.")
  }

  const { data: athleteRow, error: athleteRowError } = await clientResult.client
    .from("athletes")
    .select("tenant_id")
    .eq("id", context.athleteId)
    .single()

  if (athleteRowError) return { ok: false, error: mapPostgrestError(athleteRowError) }

  const { data: authSession } = await clientResult.client.auth.getSession()
  const submittedByUserId = authSession.session?.user.id ?? null

  const submittedAt = new Date().toISOString()
  const payload = toPersist.map((row) => ({
    tenant_id: athleteRow.tenant_id as string,
    test_week_id: row.test_week_id,
    test_definition_id: row.test_definition_id,
    athlete_id: row.athlete_id,
    value_text: row.value_text,
    value_numeric: row.value_numeric,
    submitted_by_user_id: submittedByUserId,
    submitted_at: submittedAt,
  }))

  const { data: savedRows, error: upsertError } = await clientResult.client
    .from("test_results")
    .upsert(payload, { onConflict: "test_week_id,test_definition_id,athlete_id" })
    .select("id, test_definition_id")

  if (upsertError) {
    const mapped = mapPostgrestError(upsertError)
    // The database only accepts an athlete's results while the week is open for their team
    // (published, not archived, started). The coach may have closed it since the page loaded.
    if (mapped.code === "FORBIDDEN") return { ok: false, error: { ...mapped, message: TEST_WEEK_NOT_OPEN_MESSAGE } }
    return { ok: false, error: mapped }
  }

  // Results are saved at this point, and the database has already copied them into the results
  // history and refreshed the athlete's bests (20261008100000). All that is left is to tell the
  // athlete which of these are personal bests. A failure to read that must not make them think
  // the submission was lost, so it is reported as a warning.
  let prWarning: string | null = null
  const personalBests: TestWeekSubmissionResult["personalBests"] = []

  const { data: historyRows, error: historyError } = await clientResult.client
    .from("athlete_results")
    .select(RESULT_COLUMNS)
    .eq("athlete_id", context.athleteId)
    .limit(2000)

  if (historyError) {
    prWarning = mapPostgrestError(historyError).message
  } else {
    const history = ((historyRows as ResultRow[] | null) ?? []).map(mapResultRow)
    const season = seasonFor(localIsoDate())
    const savedIdByDefinition = new Map(
      ((savedRows as Array<{ id: string; test_definition_id: string }> | null) ?? []).map((saved) => [saved.test_definition_id, saved.id]),
    )
    for (const row of toPersist) {
      const resolved = resolveEventByName(row.test_name, UNIT_BY_TEST_UNIT[row.test_unit])
      const group = eventGroupKey(resolved.eventKey, resolved.label)
      const sameEvent = history.filter((item) => item.eventGroup === group)
      const best = selectBests(sameEvent, season).personalBest
      // A personal best when the best mark in the history is the row of the result just saved.
      if (!best || !best.testResultId || best.testResultId !== savedIdByDefinition.get(row.test_definition_id)) continue
      const earlier = selectBests(sameEvent.filter((item) => item.id !== best.id), season).personalBest
      personalBests.push({
        testName: row.test_name,
        mark: formatMarkWithUnit(best.display, best.unit),
        previous: earlier ? formatMarkWithUnit(earlier.display, earlier.unit) : null,
      })
    }
  }

  return ok({
    athleteId: context.athleteId,
    testWeekId: context.testWeekId,
    submittedAt,
    submittedCount: payload.length,
    newPersonalBests: personalBests.map((item) => item.testName),
    personalBests,
    prWarning,
  })
}

const UNIT_BY_TEST_UNIT: Record<TestDefinitionUnit, MarkUnit> = { time: "s", distance: "m", weight: "kg", height: "cm", score: "pts" }

/** "0.05s faster", "5kg more", "2cm lower". Null when the two marks are equal. */
export function describeTestChange(unit: TestDefinitionUnit, current: number, previous: number): { text: string; improved: boolean } | null {
  const diff = Math.round((current - previous) * 1000) / 1000
  if (diff === 0) return null
  const amount = Math.abs(diff)
  if (unit === "time") return { text: `${amount.toFixed(2)}s ${diff < 0 ? "faster" : "slower"}`, improved: diff < 0 }
  const improved = diff > 0
  if (unit === "distance") return { text: `${amount.toFixed(2)}m ${improved ? "further" : "shorter"}`, improved }
  if (unit === "height") return { text: `${Number(amount.toFixed(1))}cm ${improved ? "higher" : "lower"}`, improved }
  if (unit === "weight") return { text: `${Number(amount.toFixed(2))}kg ${improved ? "more" : "less"}`, improved }
  return { text: `${Number(amount.toFixed(2))} pts ${improved ? "more" : "less"}`, improved }
}

type HistoryRow = {
  test_week_id: string
  test_definition_id: string
  value_text: string
  value_numeric: number | string | null
  submitted_at: string
  test_definitions: { name: string; unit: TestDefinitionUnit; scheduled_date: string; day_index: number; sort_order: number } | Array<{ name: string; unit: TestDefinitionUnit; scheduled_date: string; day_index: number; sort_order: number }> | null
  test_weeks: { name: string; start_date: string; end_date: string; status: string } | Array<{ name: string; start_date: string; end_date: string; status: string }> | null
}

/** Adds the change against the previous test week that had a test of the same name. Weeks must be newest first. */
export function withChangesBetweenWeeks(weeks: AthleteTestWeekHistoryItem[]): AthleteTestWeekHistoryItem[] {
  return weeks.map((week, index) => ({
    ...week,
    results: week.results.map((result) => {
      const key = result.name.trim().toLowerCase()
      let previous: AthleteTestWeekHistoryItem["results"][number] | null = null
      for (const older of weeks.slice(index + 1)) {
        previous = older.results.find((item) => item.name.trim().toLowerCase() === key && item.unit === result.unit) ?? null
        if (previous) break
      }
      const change =
        previous && result.valueNumeric !== null && previous.valueNumeric !== null
          ? describeTestChange(result.unit, result.valueNumeric, previous.valueNumeric)
          : null
      return { ...result, previousValueText: previous?.valueText ?? null, change }
    }),
  }))
}

/**
 * Every test week the athlete has results in, newest first, with each result and how it moved
 * against the test week before it. The week that is still open is included once it has a result.
 */
export async function getCurrentAthleteTestWeekHistory(): Promise<Result<AthleteTestWeekHistoryItem[]>> {
  if (getBackendMode() !== "supabase") {
    const state = loadMockResultsState()
    const weeks: AthleteTestWeekHistoryItem[] = state.testWeeks
      .map((week) => ({
        testWeekId: week.id,
        name: week.name,
        startDate: week.startDate,
        endDate: week.endDate,
        status: week.status,
        results: state.results
          .filter((result) => result.source === "test_week" && (result.testResultId ?? "").startsWith(`${week.id}:`))
          .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
          .map((result) => ({
            testDefinitionId: result.testResultId ?? result.id,
            name: result.eventLabel,
            unit: (Object.entries(UNIT_BY_TEST_UNIT).find(([, unit]) => unit === result.unit)?.[0] ?? "score") as TestDefinitionUnit,
            valueText: formatMarkWithUnit(result.display, result.unit),
            valueNumeric: result.value,
            scheduledDate: result.date,
            submittedAt: result.createdAt,
            previousValueText: null,
            change: null,
          })),
      }))
      .filter((week) => week.results.length > 0)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
    return ok(withChangesBetweenWeeks(weeks))
  }

  const clientResult = requireSupabaseClient("getCurrentAthleteTestWeekHistory")
  if (!clientResult.ok) return clientResult
  const athleteIdResult = await getCurrentAthleteId(clientResult.client)
  if (!athleteIdResult.ok) return athleteIdResult

  const { data, error } = await clientResult.client
    .from("test_results")
    .select("test_week_id, test_definition_id, value_text, value_numeric, submitted_at, test_definitions(name, unit, scheduled_date, day_index, sort_order), test_weeks(name, start_date, end_date, status)")
    .eq("athlete_id", athleteIdResult.data)
    .order("submitted_at", { ascending: false })
    .limit(1000)
  if (error) return { ok: false, error: mapPostgrestError(error) }

  const weeks = new Map<string, AthleteTestWeekHistoryItem & { order: Map<string, number> }>()
  for (const row of (data as HistoryRow[] | null) ?? []) {
    const definition = firstEmbedded(row.test_definitions)
    const week = firstEmbedded(row.test_weeks)
    if (!definition || !week) continue
    const item =
      weeks.get(row.test_week_id) ??
      ({
        testWeekId: row.test_week_id,
        name: week.name,
        startDate: week.start_date.slice(0, 10),
        endDate: week.end_date.slice(0, 10),
        status: week.status === "published" ? "published" : "closed",
        results: [],
        order: new Map<string, number>(),
      } satisfies AthleteTestWeekHistoryItem & { order: Map<string, number> })
    const numeric = row.value_numeric === null ? null : Number(row.value_numeric)
    item.results.push({
      testDefinitionId: row.test_definition_id,
      name: definition.name,
      unit: definition.unit,
      valueText: row.value_text,
      valueNumeric: numeric !== null && Number.isFinite(numeric) ? numeric : null,
      scheduledDate: definition.scheduled_date.slice(0, 10),
      submittedAt: row.submitted_at,
      previousValueText: null,
      change: null,
    })
    item.order.set(row.test_definition_id, definition.day_index * 1000 + definition.sort_order)
    weeks.set(row.test_week_id, item)
  }

  const ordered = [...weeks.values()]
    .map(({ order, ...week }) => ({
      ...week,
      results: [...week.results].sort((a, b) => (order.get(a.testDefinitionId) ?? 0) - (order.get(b.testDefinitionId) ?? 0)),
    }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
  return ok(withChangesBetweenWeeks(ordered))
}

export type CoachTestWeekListItem = {
  id: string
  name: string
  teamId: string | null
  startDate: string
  endDate: string
  status: "draft" | "published" | "closed"
  isArchived: boolean
  /** Squads of the team this week is for. Empty means the whole team. */
  squadIds: string[]
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
    .select("id, name, team_id, start_date, end_date, status, is_archived, squad_ids")
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
    squad_ids: string[] | null
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
      squadIds: row.squad_ids ?? [],
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

  // Sends the emails this just queued without waiting for the scheduler (and where there is no scheduler).
  kickNotificationEmails()
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
export type TestResultEnteredBy = "athlete" | "coach" | "club-admin"

export type CoachTestWeekAthleteRow = {
  athleteId: string
  name: string
  primaryEvent: string | null
  /** False when the athlete has results here but is no longer on the assigned team. */
  onRoster: boolean
  submittedAt: string | null
  resultsByDefinitionId: Record<
    string,
    {
      valueText: string
      valueNumeric: number | null
      submittedAt: string
      change: CoachTestWeekResultChange | null
      /** Who typed it: the athlete, or a coach or club admin on their behalf. Null for old rows. */
      enteredByRole: TestResultEnteredBy | null
    }
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
  /** Squads of the team this week is for. Empty means the whole team. */
  squadIds: string[]
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
    .select("id, name, team_id, start_date, end_date, status, is_archived, squad_ids")
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
    entered_by_role: TestResultEnteredBy | null
  }>((from, to) =>
    client
      .from("test_results")
      .select("athlete_id, test_definition_id, value_text, value_numeric, submitted_at, entered_by_role")
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
  // A week for chosen squads lists their members only. Anyone else with a result still shows, below.
  const squadIds = ((week.squad_ids as string[] | null) ?? []).filter(Boolean)
  if (squadIds.length > 0) {
    const { data, error } = await client.from("team_squad_members").select("athlete_id").in("squad_id", squadIds)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    const inSquads = new Set(((data as Array<{ athlete_id: string }> | null) ?? []).map((row) => row.athlete_id))
    rosterRows = rosterRows.filter((row) => inSquads.has(row.id))
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
      enteredByRole: row.entered_by_role ?? null,
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
    squadIds,
    tests: testsResult.data,
    athletes: [...athleteRows.values()],
  })
}

export type SaveCoachTestWeekInput = {
  /** Omit to create a new test week. */
  testWeekId?: string | null
  name: string
  teamId: string
  /** Squads of that team the week is for. Empty or left out means the whole team. */
  squadIds?: string[]
  startDate: string
  endDate: string
  /** True publishes (or keeps published). False saves a new week as a draft and leaves an existing status alone. */
  publish: boolean
  tests: Array<{ id?: string | null; name: string; unit: TestDefinitionUnit; scheduledDate: string; dayIndex: number }>
  /** Refuse to save over someone else's change (see src/lib/data/edit-conflict-data.ts). */
  guard?: EditGuard
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
        squad_ids: [...new Set(input.squadIds ?? [])],
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

  // With a stamp, the update only lands on the version this coach opened. The week row is written
  // first, so a refused save has changed none of its tests.
  const stamp = guardStamp(input.guard)
  let updateWeek = client
    .from("test_weeks")
    .update({
      team_id: input.teamId,
      squad_ids: [...new Set(input.squadIds ?? [])],
      name: input.name.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      status: input.publish ? "published" : (existingWeek.status as string),
    })
    .eq("id", testWeekId)
    .eq("tenant_id", tenantId)
  if (typeof stamp === "string") updateWeek = updateWeek.eq("updated_at", stamp)
  const { data: updatedWeeks, error: updateWeekError } = await updateWeek.select("id")
  if (updateWeekError) return { ok: false, error: mapPostgrestError(updateWeekError) }
  if (!updatedWeeks || updatedWeeks.length === 0) {
    const conflict = await staleWriteError("test-week", testWeekId, stamp)
    if (conflict) return { ok: false, error: conflict }
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

  // Sends the emails this just queued without waiting for the scheduler (and where there is no scheduler).
  kickNotificationEmails()
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
  if (next.status === "published") kickNotificationEmails()
  return ok({ testWeekId })
}

/**
 * Close a published test week (athletes can no longer enter results) or reopen a closed one.
 * The database checks who is asking, writes the audit entry and, on a reopen, tells the team's
 * athletes in the app (set_test_week_open, 20261009100000).
 */
export async function setTestWeekOpenForCurrentCoach(
  testWeekId: string,
  open: boolean,
): Promise<Result<{ testWeekId: string; status: "published" | "closed" }>> {
  const clientResult = requireSupabaseClient("setTestWeekOpenForCurrentCoach")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.client.rpc("set_test_week_open", { p_test_week_id: testWeekId, p_open: open })
  if (error) {
    const mapped = mapPostgrestError(error)
    // The function says exactly why (a draft, an archived week, not your team): keep its words.
    if (mapped.code === "FORBIDDEN" && error.message && !/access is paused/i.test(error.message) && !/row-level security/i.test(error.message)) {
      return { ok: false, error: { ...mapped, message: error.message } }
    }
    return { ok: false, error: mapped }
  }
  return ok({ testWeekId, status: data === "closed" ? "closed" : "published" })
}

export type CoachSavedTestResult = {
  valueText: string
  valueNumeric: number
  submittedAt: string
  enteredByRole: TestResultEnteredBy | null
}

/**
 * A coach or club admin types one result for one athlete (C16). An empty value removes the result.
 * Works for athletes with no login and on closed weeks (corrections). The value is checked the way
 * the athlete form checks it; the database repeats the checks, marks the row "entered by coach" and
 * copies it into the results history like any other result. Returns the saved result, or null when
 * it was removed.
 */
export async function saveTestResultForAthleteAsCoach(input: {
  testWeekId: string
  testDefinitionId: string
  athleteId: string
  unit: TestDefinitionUnit
  value: string
}): Promise<Result<CoachSavedTestResult | null>> {
  const clientResult = requireSupabaseClient("saveTestResultForAthleteAsCoach")
  if (!clientResult.ok) return clientResult
  const client = clientResult.client

  const coachContext = await getCurrentCoachContext(client)
  if (!coachContext.ok) return coachContext

  if (!input.value.trim()) {
    const { error } = await client
      .from("test_results")
      .delete()
      .eq("tenant_id", coachContext.data.tenantId)
      .eq("test_week_id", input.testWeekId)
      .eq("test_definition_id", input.testDefinitionId)
      .eq("athlete_id", input.athleteId)
    if (error) return { ok: false, error: mapPostgrestError(error) }
    return ok(null)
  }

  const checked = checkTestResultEntry(input.value, input.unit)
  if (!checked.ok) return err("VALIDATION", checked.message)

  const submittedAt = new Date().toISOString()
  const { data, error } = await client
    .from("test_results")
    .upsert(
      {
        tenant_id: coachContext.data.tenantId,
        test_week_id: input.testWeekId,
        test_definition_id: input.testDefinitionId,
        athlete_id: input.athleteId,
        value_text: checked.valueText,
        value_numeric: Math.round(checked.numeric * 1000) / 1000,
        submitted_by_user_id: coachContext.data.userId,
        submitted_at: submittedAt,
      },
      { onConflict: "test_week_id,test_definition_id,athlete_id" },
    )
    .select("value_text, value_numeric, submitted_at, entered_by_role")
    .single()
  if (error) {
    const mapped = mapPostgrestError(error)
    // The guard on test_results explains itself ("Publish this test week before entering results.").
    if (error.code === "42501" && error.message && !/row-level security/i.test(error.message) && !/access is paused/i.test(error.message)) {
      return { ok: false, error: { ...mapped, message: error.message } }
    }
    return { ok: false, error: mapped }
  }
  return ok({
    valueText: data.value_text as string,
    valueNumeric: Number(data.value_numeric),
    submittedAt: data.submitted_at as string,
    enteredByRole: (data.entered_by_role as TestResultEnteredBy | null) ?? null,
  })
}
