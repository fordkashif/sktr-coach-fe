import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import {
  PAIN_MAX_AREAS,
  PAIN_NOTE_MAX_LENGTH,
  isBodyAreaKey,
  type PainReport,
  type PainReportField,
  type PainReportInput,
  type PainTrainingImpact,
  type TeamPainReport,
} from "@/lib/data/wellness/pain-report-types"
import { localWellnessDate } from "@/lib/data/wellness/wellness-data"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Pain and injury reports.
 *
 * Who can read them is decided by the database (pain_reports row policies): the athlete, the coaches
 * of the athlete's current team and club admins. Nothing here widens that, and nothing here writes a
 * report's content anywhere else (no audit text, no analytics).
 *
 * Athlete side: getCurrentAthletePainReports, submitCurrentAthletePainReport, resolveCurrentAthletePainReport.
 * Coach side (read only): getOpenPainReportsForAthlete, getOpenPainReportsForTeam, getPainReportsForAthlete.
 * Every function works in mock mode too, against this browser's storage.
 */

const COLUMNS = "id, athlete_id, body_areas, severity, started_on, training_impact, note, status, resolved_at, created_at"

type PainReportRow = {
  id: string
  athlete_id: string
  body_areas: string[] | null
  severity: number
  started_on: string
  training_impact: PainTrainingImpact
  note: string | null
  status: "open" | "resolved"
  resolved_at: string | null
  created_at: string
}

function mapRow(row: PainReportRow): PainReport {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    bodyAreas: row.body_areas ?? [],
    severity: row.severity,
    startedOn: row.started_on,
    trainingImpact: row.training_impact,
    note: row.note,
    status: row.status,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  }
}

function isSupabaseMode() {
  return getBackendMode() === "supabase"
}

function requireClient(operation: string): Result<SupabaseClient> {
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", `[${operation}] Supabase client is not configured.`)
  return ok(client)
}

export type ValidPainReportInput = {
  bodyAreas: string[]
  severity: number
  startedOn: string
  trainingImpact: PainTrainingImpact
  note: string | null
}

/** Mirrors the pain_reports constraints so a bad answer is caught before the round trip. */
export function validatePainReportInput(
  input: PainReportInput,
):
  | { ok: true; data: ValidPainReportInput }
  | { ok: false; fieldErrors: Partial<Record<PainReportField, string>> } {
  const fieldErrors: Partial<Record<PainReportField, string>> = {}
  const bodyAreas = [...new Set(input.bodyAreas)].filter(isBodyAreaKey)
  const note = input.note?.trim() || null
  const today = localWellnessDate()

  if (bodyAreas.length === 0) fieldErrors.bodyAreas = "Pick at least one area."
  else if (bodyAreas.length > PAIN_MAX_AREAS) fieldErrors.bodyAreas = `Pick ${PAIN_MAX_AREAS} areas at most.`

  if (input.severity === null || !Number.isInteger(input.severity) || input.severity < 1 || input.severity > 5) {
    fieldErrors.severity = "Say how bad it is, from 1 to 5."
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startedOn) || Number.isNaN(new Date(`${input.startedOn}T00:00:00`).getTime())) {
    fieldErrors.startedOn = "Enter the day it started."
  } else if (input.startedOn > today) {
    fieldErrors.startedOn = "The start date cannot be in the future."
  } else if (input.startedOn < "2000-01-01") {
    fieldErrors.startedOn = "Enter a real date."
  }

  if (!input.trainingImpact) fieldErrors.trainingImpact = "Say whether it stops you training."
  if (note && note.length > PAIN_NOTE_MAX_LENGTH) fieldErrors.note = `Keep the note under ${PAIN_NOTE_MAX_LENGTH} characters.`

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  return {
    ok: true,
    data: {
      bodyAreas,
      severity: input.severity as number,
      startedOn: input.startedOn,
      trainingImpact: input.trainingImpact as PainTrainingImpact,
      note,
    },
  }
}

/* ---------------------------------------------------------------------------
   Mock mode: the demo athlete's reports, kept in localStorage per tenant.
--------------------------------------------------------------------------- */

const MOCK_PAIN_STORAGE_KEY = "pacelab:pain-reports"
const MOCK_ATHLETE_ID = "a1"

function readMockReports(): PainReport[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tenantStorageKey(MOCK_PAIN_STORAGE_KEY)) ?? "[]") as PainReport[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeMockReports(reports: PainReport[]): Result<void> {
  try {
    window.localStorage.setItem(tenantStorageKey(MOCK_PAIN_STORAGE_KEY), JSON.stringify(reports.slice(0, 200)))
    return ok(undefined)
  } catch {
    return err("UNKNOWN", "Could not save on this device. Check that storage is not blocked.")
  }
}

function newestFirst(reports: PainReport[]) {
  return [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/* ---------------------------------------------------------------------------
   Athlete side
--------------------------------------------------------------------------- */

async function getCurrentAthleteIds(client: SupabaseClient): Promise<Result<{ athleteId: string; tenantId: string; userId: string }>> {
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")

  const { data, error } = await client.from("athletes").select("id, tenant_id").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "No athlete profile found for current user.")
  return ok({ athleteId: data.id as string, tenantId: data.tenant_id as string, userId })
}

/** The signed-in athlete's own reports, newest first. `status: "open"` leaves out resolved ones. */
export async function getCurrentAthletePainReports(options?: { status?: "open" | "all"; limit?: number }): Promise<Result<PainReport[]>> {
  const status = options?.status ?? "all"
  const limit = options?.limit ?? 100

  if (!isSupabaseMode()) {
    const reports = newestFirst(readMockReports())
    return ok((status === "open" ? reports.filter((report) => report.status === "open") : reports).slice(0, limit))
  }

  const clientResult = requireClient("getCurrentAthletePainReports")
  if (!clientResult.ok) return clientResult
  const ids = await getCurrentAthleteIds(clientResult.data)
  if (!ids.ok) return ids

  let query = clientResult.data.from("pain_reports").select(COLUMNS).eq("athlete_id", ids.data.athleteId)
  if (status === "open") query = query.eq("status", "open")
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as PainReportRow[] | null) ?? []).map(mapRow))
}

/** Saves a new report for the signed-in athlete. Coaches of their team are told when training is affected. */
export async function submitCurrentAthletePainReport(input: PainReportInput): Promise<Result<PainReport>> {
  const validation = validatePainReportInput(input)
  if (!validation.ok) {
    return err("VALIDATION", Object.values(validation.fieldErrors)[0] ?? "Check the highlighted answers.", validation.fieldErrors)
  }
  const clean = validation.data

  if (!isSupabaseMode()) {
    const report: PainReport = {
      id: `mock-pain-${Date.now()}`,
      athleteId: MOCK_ATHLETE_ID,
      bodyAreas: clean.bodyAreas,
      severity: clean.severity,
      startedOn: clean.startedOn,
      trainingImpact: clean.trainingImpact,
      note: clean.note,
      status: "open",
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    }
    const saved = writeMockReports([report, ...readMockReports()])
    return saved.ok ? ok(report) : saved
  }

  const clientResult = requireClient("submitCurrentAthletePainReport")
  if (!clientResult.ok) return clientResult
  const ids = await getCurrentAthleteIds(clientResult.data)
  if (!ids.ok) return ids

  const { data, error } = await clientResult.data
    .from("pain_reports")
    .insert({
      tenant_id: ids.data.tenantId,
      athlete_id: ids.data.athleteId,
      body_areas: clean.bodyAreas,
      severity: clean.severity,
      started_on: clean.startedOn,
      training_impact: clean.trainingImpact,
      note: clean.note,
      reported_by_user_id: ids.data.userId,
    })
    .select(COLUMNS)
    .single()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(mapRow(data as PainReportRow))
}

/** The athlete says it no longer hurts. The report stays in their history. */
export async function resolveCurrentAthletePainReport(reportId: string): Promise<Result<PainReport>> {
  if (!isSupabaseMode()) {
    const reports = readMockReports()
    const target = reports.find((report) => report.id === reportId)
    if (!target) return err("NOT_FOUND", "That report is no longer there.")
    const resolved: PainReport = { ...target, status: "resolved", resolvedAt: new Date().toISOString() }
    const saved = writeMockReports(reports.map((report) => (report.id === reportId ? resolved : report)))
    return saved.ok ? ok(resolved) : saved
  }

  const clientResult = requireClient("resolveCurrentAthletePainReport")
  if (!clientResult.ok) return clientResult

  const { data, error } = await clientResult.data
    .from("pain_reports")
    .update({ status: "resolved" })
    .eq("id", reportId)
    .select(COLUMNS)
    .maybeSingle()

  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", "That report is no longer there.")
  return ok(mapRow(data as PainReportRow))
}

/* ---------------------------------------------------------------------------
   Coach side: read only. The row policies return nothing for an athlete who is
   not on one of the coach's teams, so these never need a scope check of their own.
--------------------------------------------------------------------------- */

/** One athlete's reports, newest first, for a coach of their team or a club admin. */
export async function getPainReportsForAthlete(
  athleteId: string,
  options?: { status?: "open" | "all"; limit?: number },
): Promise<Result<PainReport[]>> {
  const status = options?.status ?? "all"
  const limit = options?.limit ?? 50

  if (!isSupabaseMode()) {
    if (athleteId !== MOCK_ATHLETE_ID) return ok([])
    const reports = newestFirst(readMockReports())
    return ok((status === "open" ? reports.filter((report) => report.status === "open") : reports).slice(0, limit))
  }

  const clientResult = requireClient("getPainReportsForAthlete")
  if (!clientResult.ok) return clientResult

  let query = clientResult.data.from("pain_reports").select(COLUMNS).eq("athlete_id", athleteId)
  if (status === "open") query = query.eq("status", "open")
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as PainReportRow[] | null) ?? []).map(mapRow))
}

/** The open reports of one athlete. */
export function getOpenPainReportsForAthlete(athleteId: string): Promise<Result<PainReport[]>> {
  return getPainReportsForAthlete(athleteId, { status: "open" })
}

/** The open reports of everyone currently on a team, worst first, with the athlete's name. */
export async function getOpenPainReportsForTeam(teamId: string): Promise<Result<TeamPainReport[]>> {
  if (!isSupabaseMode()) {
    const mockData = await import("@/lib/mock-data")
    const athlete = mockData.mockAthletes.find((item) => item.id === MOCK_ATHLETE_ID)
    if (!athlete || athlete.teamId !== teamId) return ok([])
    return ok(
      newestFirst(readMockReports())
        .filter((report) => report.status === "open")
        .map((report) => ({ ...report, athleteName: athlete.name })),
    )
  }

  const clientResult = requireClient("getOpenPainReportsForTeam")
  if (!clientResult.ok) return clientResult

  const { data: athletes, error: athletesError } = await clientResult.data
    .from("athletes")
    .select("id, first_name, last_name")
    .eq("team_id", teamId)
  if (athletesError) return { ok: false, error: mapPostgrestError(athletesError) }

  const names = new Map(
    ((athletes as Array<{ id: string; first_name: string | null; last_name: string | null }> | null) ?? []).map((athlete) => [
      athlete.id,
      `${athlete.first_name ?? ""} ${athlete.last_name ?? ""}`.trim() || "Athlete",
    ]),
  )
  if (names.size === 0) return ok([])

  const { data, error } = await clientResult.data
    .from("pain_reports")
    .select(COLUMNS)
    .in("athlete_id", [...names.keys()])
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) return { ok: false, error: mapPostgrestError(error) }

  const impactRank: Record<PainTrainingImpact, number> = { cannot_train: 0, modified: 1, none: 2 }
  return ok(
    ((data as PainReportRow[] | null) ?? [])
      .map(mapRow)
      .map((report) => ({ ...report, athleteName: names.get(report.athleteId) ?? "Athlete" }))
      .sort((a, b) => impactRank[a.trainingImpact] - impactRank[b.trainingImpact] || b.severity - a.severity),
  )
}
