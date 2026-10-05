import type { SupabaseClient } from "@supabase/supabase-js"
import { err, mapPostgrestError, ok, type Result } from "@/lib/data/result"
import {
  asEventGroup,
  asTemplatePhase,
  cleanTemplateDetails,
  copyName,
  sanitizeTemplateStructure,
  templateStructureFromPlan,
  validateTemplateDetails,
  weekdayOfIso,
  type PlanTemplate,
  type PlanTemplateDetails,
  type PlanTemplateSummary,
} from "@/lib/data/training-plan/plan-templates"
import type { PlanDraft } from "@/lib/data/training-plan/plan-builder-model"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * The club's plan templates. One API for both backends.
 * The real backend reads and writes plan_templates (migration 20261012090000), where row level
 * security decides who may do what: every coach and club admin of the club reads and uses every
 * template; only its creator or a club admin changes or deletes it; athletes and other clubs see
 * nothing. Mock mode keeps the same shape in this browser (mock-plan-template-store.ts, loaded
 * only in mock mode).
 */

const isMock = () => getBackendMode() !== "supabase"
const mockStore = () => import("@/lib/data/training-plan/mock-plan-template-store")

const NOT_FOUND = "This template is gone, or you no longer have access to it."
const NOT_YOURS = "Only the coach who made this template, or a club admin, can change it."

type Context = { client: SupabaseClient; userId: string; tenantId: string; isAdmin: boolean }

async function getContext(): Promise<Result<Context>> {
  const client = getBrowserSupabaseClient()
  if (!client) return err("UNKNOWN", "Supabase client is not configured.")
  const { data: authSession } = await client.auth.getSession()
  const userId = authSession.session?.user.id
  if (!userId) return err("UNAUTHORIZED", "No authenticated Supabase session found.")
  const { data: profile, error } = await client.from("profiles").select("tenant_id, role").eq("user_id", userId).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!profile) return err("NOT_FOUND", "No profile found for current user.")
  return ok({ client, userId, tenantId: profile.tenant_id as string, isAdmin: profile.role === "club-admin" })
}

const SUMMARY_COLUMNS = "id, name, description, phase, event_group, weeks, session_count, start_weekday, is_archived, created_by_user_id, created_by_name, last_used_at, updated_at"

type SummaryRow = {
  id: string
  name: string
  description: string | null
  phase: string | null
  event_group: string | null
  weeks: number
  session_count: number
  start_weekday: number | null
  is_archived: boolean
  created_by_user_id: string | null
  created_by_name: string | null
  last_used_at: string | null
  updated_at: string | null
}

function mapSummary(row: SummaryRow, context: Pick<Context, "userId" | "isAdmin">): PlanTemplateSummary {
  const mine = row.created_by_user_id !== null && row.created_by_user_id === context.userId
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    phase: asTemplatePhase(row.phase),
    eventGroup: asEventGroup(row.event_group),
    weeks: row.weeks,
    sessionCount: row.session_count,
    startWeekday: row.start_weekday,
    createdByUserId: row.created_by_user_id,
    createdByName: mine ? "You" : row.created_by_name || "A coach",
    archived: row.is_archived,
    lastUsedAt: row.last_used_at,
    updatedAt: row.updated_at,
    canManage: mine || context.isAdmin,
  }
}

function fromMock<T>(result: { ok: true; data: T } | { ok: false; reason: "not-found" | "forbidden" }): Result<T> {
  if (result.ok) return ok(result.data)
  return result.reason === "forbidden" ? err("FORBIDDEN", NOT_YOURS) : err("NOT_FOUND", NOT_FOUND)
}

/** Every template of the club, archived ones included. */
export async function listPlanTemplates(): Promise<Result<PlanTemplateSummary[]>> {
  if (isMock()) return ok((await mockStore()).listMockTemplates())
  const context = await getContext()
  if (!context.ok) return context
  const { data, error } = await context.data.client.from("plan_templates").select(SUMMARY_COLUMNS).order("name", { ascending: true }).limit(500)
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(((data as SummaryRow[] | null) ?? []).map((row) => mapSummary(row, context.data)))
}

/** One template with its whole structure, for the preview and for starting a plan from it. */
export async function getPlanTemplate(id: string): Promise<Result<PlanTemplate>> {
  if (isMock()) return fromMock((await mockStore()).getMockTemplate(id))
  const context = await getContext()
  if (!context.ok) return context
  const { data, error } = await context.data.client.from("plan_templates").select(`${SUMMARY_COLUMNS}, structure`).eq("id", id).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("NOT_FOUND", NOT_FOUND)
  const row = data as SummaryRow & { structure: unknown }
  return ok({ ...mapSummary(row, context.data), structure: sanitizeTemplateStructure(row.structure, row.weeks) })
}

/**
 * Saves a plan as a template. Only the structure is kept: the team, the dates, who the plan is
 * assigned to and the changes for single athletes are left out.
 */
export async function savePlanAsTemplate(plan: PlanDraft, details: PlanTemplateDetails): Promise<Result<PlanTemplateSummary>> {
  const invalid = validateTemplateDetails(details)
  if (invalid) return err("VALIDATION", invalid)
  const clean = cleanTemplateDetails(details)
  const structure = templateStructureFromPlan(plan)
  if (structure.sessions.length === 0) return err("VALIDATION", "Add at least one session to the plan before saving it as a template.")
  return insertTemplate(clean, plan.weeks, weekdayOfIso(plan.startDate), structure)
}

async function insertTemplate(details: PlanTemplateDetails, weeks: number, startWeekday: number | null, structure: PlanTemplate["structure"]): Promise<Result<PlanTemplateSummary>> {
  if (isMock()) return fromMock((await mockStore()).createMockTemplate(details, weeks, startWeekday, structure))
  const context = await getContext()
  if (!context.ok) return context
  const { client, tenantId, userId } = context.data
  const { data, error } = await client
    .from("plan_templates")
    .insert({
      tenant_id: tenantId,
      created_by_user_id: userId,
      name: details.name,
      description: details.description || null,
      phase: details.phase,
      event_group: details.eventGroup,
      weeks,
      start_weekday: startWeekday,
      structure,
    })
    .select(SUMMARY_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data) return err("FORBIDDEN", "The template was not saved. You may not have access.")
  return ok(mapSummary(data as SummaryRow, context.data))
}

async function updateTemplate(id: string, fields: Record<string, unknown>): Promise<Result<PlanTemplateSummary>> {
  const context = await getContext()
  if (!context.ok) return context
  const { data, error } = await context.data.client.from("plan_templates").update(fields).eq("id", id).select(SUMMARY_COLUMNS).maybeSingle()
  if (error) return { ok: false, error: mapPostgrestError(error) }
  // Row level security hides the row from an update by anyone but its creator or a club admin.
  if (!data) return err("FORBIDDEN", NOT_YOURS)
  return ok(mapSummary(data as SummaryRow, context.data))
}

/** Rename, describe and tag. Creator or club admin only. */
export async function updatePlanTemplateDetails(id: string, details: PlanTemplateDetails): Promise<Result<PlanTemplateSummary>> {
  const invalid = validateTemplateDetails(details)
  if (invalid) return err("VALIDATION", invalid)
  const clean = cleanTemplateDetails(details)
  if (isMock()) return fromMock((await mockStore()).updateMockTemplateDetails(id, clean))
  return updateTemplate(id, { name: clean.name, description: clean.description || null, phase: clean.phase, event_group: clean.eventGroup })
}

/** Archive or restore. Creator or club admin only. */
export async function setPlanTemplateArchived(id: string, archived: boolean): Promise<Result<PlanTemplateSummary>> {
  if (isMock()) return fromMock((await mockStore()).setMockTemplateArchived(id, archived))
  return updateTemplate(id, { is_archived: archived })
}

/** A copy that belongs to whoever made the copy, so any coach can adapt a colleague's template. */
export async function duplicatePlanTemplate(id: string): Promise<Result<PlanTemplateSummary>> {
  if (isMock()) return fromMock((await mockStore()).duplicateMockTemplate(id))
  const source = await getPlanTemplate(id)
  if (!source.ok) return source
  const { name, description, phase, eventGroup, weeks, startWeekday, structure } = source.data
  return insertTemplate({ name: copyName(name), description, phase, eventGroup }, weeks, startWeekday, structure)
}

/** Deletes for good. Creator or club admin only. Plans that were started from it are not touched. */
export async function deletePlanTemplate(id: string): Promise<Result<null>> {
  if (isMock()) return fromMock((await mockStore()).deleteMockTemplate(id))
  const context = await getContext()
  if (!context.ok) return context
  const { data, error } = await context.data.client.from("plan_templates").delete().eq("id", id).select("id")
  if (error) return { ok: false, error: mapPostgrestError(error) }
  if (!data || data.length === 0) return err("FORBIDDEN", NOT_YOURS)
  return ok(null)
}

/** Records that a plan was started from the template. Any coach or club admin of the club. */
export async function markPlanTemplateUsed(id: string): Promise<Result<null>> {
  if (isMock()) return fromMock((await mockStore()).markMockTemplateUsed(id))
  const context = await getContext()
  if (!context.ok) return context
  const { error } = await context.data.client.rpc("mark_plan_template_used", { p_template_id: id })
  if (error) return { ok: false, error: mapPostgrestError(error) }
  return ok(null)
}
