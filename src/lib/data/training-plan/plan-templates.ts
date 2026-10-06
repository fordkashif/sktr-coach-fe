import type { EventGroup } from "@/lib/mock-data"
import { phaseForWeek, weekLine, type PlanPhase, type WeekType } from "./plan-phases"
import {
  EVENT_GROUPS,
  MAX_WEEKS,
  defaultAssign,
  makeId,
  planFromBuilderState,
  planStructureExtras,
  summarizeBlock,
  type PlanDraft,
  type SessionDraft,
  type SessionType,
} from "./plan-builder-model"

/**
 * Plan templates: a club's library of plans its coaches reuse across teams and seasons.
 * A template is the structure of a plan (weeks, days, sessions, blocks, exercise rows with their
 * library links and percentage loads) and nothing that belongs to one squad: no team, no dates,
 * no assignment and no changes for single athletes.
 * Everything in this file is pure so it can be tested without a browser or a database.
 */

export type TemplatePhase = "general-prep" | "specific-prep" | "competition" | "taper"

export const TEMPLATE_PHASES: Array<{ value: TemplatePhase; label: string }> = [
  { value: "general-prep", label: "General prep" },
  { value: "specific-prep", label: "Specific prep" },
  { value: "competition", label: "Competition" },
  { value: "taper", label: "Taper" },
]

export const TEMPLATE_NAME_MAX = 80
export const TEMPLATE_DESCRIPTION_MAX = 500

/** What is stored in plan_templates.structure. */
export type TemplateStructure = {
  version: 1
  weekFocus: Record<string, string>
  /** Phases, week types and target loads of the plan it was saved from. Missing on older templates. */
  phases?: PlanPhase[]
  weekTypes?: Record<string, WeekType>
  weekTargetLoad?: Record<string, number>
  sessions: SessionDraft[]
}

export type PlanTemplateDetails = {
  name: string
  description: string
  phase: TemplatePhase | null
  eventGroup: EventGroup | null
}

export type PlanTemplateSummary = PlanTemplateDetails & {
  id: string
  weeks: number
  sessionCount: number
  /** 0 (Sunday) to 6: the weekday the plan it was saved from started on. Null when not known. */
  startWeekday: number | null
  createdByUserId: string | null
  createdByName: string
  archived: boolean
  lastUsedAt: string | null
  updatedAt: string | null
  /** True for its creator and for club admins: they may change, archive or delete it. */
  canManage: boolean
}

export type PlanTemplate = PlanTemplateSummary & { structure: TemplateStructure }

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function phaseLabel(phase: TemplatePhase | null) {
  return TEMPLATE_PHASES.find((entry) => entry.value === phase)?.label ?? null
}

export function eventGroupLabel(group: EventGroup | null) {
  return EVENT_GROUPS.find((entry) => entry.value === group)?.label ?? null
}

export function asTemplatePhase(value: unknown): TemplatePhase | null {
  return TEMPLATE_PHASES.some((entry) => entry.value === value) ? (value as TemplatePhase) : null
}

export function asEventGroup(value: unknown): EventGroup | null {
  return EVENT_GROUPS.some((entry) => entry.value === value) ? (value as EventGroup) : null
}

/** 0 (Sunday) to 6 for a date like 2026-10-05, or null when it is not a date. */
export function weekdayOfIso(dateIso: string): number | null {
  const parsed = new Date(`${dateIso}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCDay()
}

export function weekdayName(weekday: number | null) {
  return weekday === null ? null : (WEEKDAY_NAMES[weekday] ?? null)
}

/**
 * Sessions with everything that belongs to one squad taken out: the changes for single athletes
 * ("except David: 70%") are dropped. Library links, cues and percentage loads stay.
 * Every session, block and row gets a fresh id, so the copy shares nothing with its source.
 */
export function stripSquadData(sessions: SessionDraft[]): SessionDraft[] {
  return sessions.map((session) => ({
    id: makeId("session"),
    week: session.week,
    dayIndex: session.dayIndex,
    title: session.title,
    sessionType: session.sessionType,
    location: session.location,
    durationMinutes: session.durationMinutes,
    ...(session.intendedEffort ? { intendedEffort: session.intendedEffort } : {}),
    notes: session.notes,
    blocks: session.blocks.map((block) => ({
      id: makeId("block"),
      title: block.title,
      notes: block.notes,
      exercises: block.exercises.map((exercise) => {
        // Named fields only, so nothing unknown (and no overrides) can ride along.
        const row: SessionDraft["blocks"][number]["exercises"][number] = {
          id: makeId("ex"),
          name: exercise.name,
          sets: exercise.sets,
          reps: exercise.reps,
          load: exercise.load,
        }
        if (exercise.libraryId) row.libraryId = exercise.libraryId
        if (exercise.cue) row.cue = exercise.cue
        if (exercise.link) row.link = exercise.link
        if (exercise.percentOf) row.percentOf = exercise.percentOf
        return row
      }),
    })),
  }))
}

/** How many changes for single athletes a plan carries (they are left out of a template). */
export function countAthleteAdjustments(plan: Pick<PlanDraft, "sessions">) {
  let count = 0
  for (const session of plan.sessions) for (const block of session.blocks) for (const exercise of block.exercises) count += exercise.overrides?.length ?? 0
  return count
}

/** The part of a plan a template keeps. Team, dates, assignment and per athlete changes are not in it. */
export function templateStructureFromPlan(plan: Pick<PlanDraft, "weeks" | "weekFocus" | "sessions" | "phases" | "weekTypes" | "weekTargetLoad">): TemplateStructure {
  const weeks = clampWeeks(plan.weeks)
  return {
    version: 1,
    weekFocus: Object.fromEntries(Object.entries(plan.weekFocus).filter(([week, focus]) => Number(week) >= 1 && Number(week) <= weeks && focus.trim().length > 0)),
    ...planStructureExtras({ ...plan, weeks }),
    sessions: stripSquadData(plan.sessions.filter((session) => session.week >= 1 && session.week <= weeks)),
  }
}

function clampWeeks(weeks: number) {
  return Math.max(1, Math.min(MAX_WEEKS, Math.round(weeks) || 1))
}

/** Rebuilds a structure from stored data. Damaged values are dropped, and squad data never survives. */
export function sanitizeTemplateStructure(value: unknown, weeks: number): TemplateStructure {
  const plan = planFromBuilderState({ id: null, status: "draft", name: "", teamId: "", startDate: "", weeks: clampWeeks(weeks), notes: "" }, value)
  return templateStructureFromPlan(plan)
}

/**
 * A new draft plan made from a template, for one team, starting on one date.
 * Sessions keep their week and day slot, so every date follows from the start date (see slotDate).
 * The draft shares no ids with the template: changing it never changes the template.
 */
export function planFromTemplate(
  template: Pick<PlanTemplate, "name" | "weeks" | "structure">,
  target: { teamId: string; startDate: string; name?: string; notes?: string },
): PlanDraft {
  const weeks = clampWeeks(template.weeks)
  const structure = sanitizeTemplateStructure(template.structure, weeks)
  return {
    id: null,
    status: "draft",
    name: target.name?.trim() || template.name,
    teamId: target.teamId,
    startDate: target.startDate,
    weeks,
    notes: target.notes ?? "",
    weekFocus: structure.weekFocus,
    // Phase ids are made fresh, like every other id: the draft shares nothing with the template.
    ...(structure.phases ? { phases: structure.phases.map((phase, index) => ({ ...phase, id: makeId(`phase${index}`) })) } : {}),
    ...(structure.weekTypes ? { weekTypes: { ...structure.weekTypes } } : {}),
    ...(structure.weekTargetLoad ? { weekTargetLoad: { ...structure.weekTargetLoad } } : {}),
    sessions: structure.sessions,
    assign: defaultAssign(),
  }
}

/** "4", "3.5": sessions in an average week. */
export function sessionsPerWeek(sessionCount: number, weeks: number) {
  if (weeks <= 0 || sessionCount <= 0) return "0"
  const value = Math.round((sessionCount / weeks) * 10) / 10
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export type TemplateOutlineWeek = {
  week: number
  focus: string | null
  /** "Specific prep, deload week", when the plan it was saved from had phases or week types. */
  phaseLine: string | null
  sessions: Array<{ id: string; dayLabel: string; title: string; sessionType: SessionType; lines: string[] }>
}

/** The read-only week by week outline. Days are named by weekday when the starting weekday is known. */
export function templateOutline(structure: TemplateStructure, weeks: number, startWeekday: number | null): TemplateOutlineWeek[] {
  return Array.from({ length: clampWeeks(weeks) }, (_, index) => index + 1).map((week) => ({
    week,
    focus: structure.weekFocus[String(week)]?.trim() || null,
    phaseLine: weekLine(phaseForWeek(structure.phases, week)?.name, structure.weekTypes?.[String(week)]),
    sessions: structure.sessions
      .filter((session) => session.week === week)
      .sort((left, right) => left.dayIndex - right.dayIndex)
      .map((session) => ({
        id: session.id,
        dayLabel: startWeekday === null ? `Day ${session.dayIndex + 1}` : WEEKDAY_SHORT[(startWeekday + session.dayIndex) % 7],
        title: session.title.trim() || `${session.sessionType} session`,
        sessionType: session.sessionType,
        lines: session.blocks.map(summarizeBlock),
      })),
  }))
}

/** Returns a message when the details cannot be saved, otherwise null. */
export function validateTemplateDetails(details: PlanTemplateDetails): string | null {
  const name = details.name.trim()
  if (!name) return "Give the template a name."
  if (name.length > TEMPLATE_NAME_MAX) return `Keep the name under ${TEMPLATE_NAME_MAX} characters.`
  if (details.description.trim().length > TEMPLATE_DESCRIPTION_MAX) return `Keep the description under ${TEMPLATE_DESCRIPTION_MAX} characters.`
  return null
}

export function cleanTemplateDetails(details: PlanTemplateDetails): PlanTemplateDetails {
  return { name: details.name.trim(), description: details.description.trim(), phase: asTemplatePhase(details.phase), eventGroup: asEventGroup(details.eventGroup) }
}

export type TemplateFilter = { query: string; phase: TemplatePhase | "all"; eventGroup: EventGroup | "all"; archived: boolean }

/** Search by name, description or who made it, and narrow by tag. Newest use first, then by name. */
export function filterTemplates<T extends PlanTemplateSummary>(templates: T[], filter: TemplateFilter): T[] {
  const query = filter.query.trim().toLowerCase()
  return templates
    .filter((template) => template.archived === filter.archived)
    .filter((template) => filter.phase === "all" || template.phase === filter.phase)
    .filter((template) => filter.eventGroup === "all" || template.eventGroup === filter.eventGroup)
    .filter((template) => !query || [template.name, template.description, template.createdByName].some((text) => text.toLowerCase().includes(query)))
    .sort((left, right) => (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "") || left.name.localeCompare(right.name))
}

/** "Not used yet", "Used today", "Used 3 days ago", "Used 12 Mar 2026". */
export function formatLastUsed(lastUsedAt: string | null, now: Date = new Date()) {
  if (!lastUsedAt) return "Not used yet"
  const used = new Date(lastUsedAt)
  if (Number.isNaN(used.getTime())) return "Not used yet"
  const days = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(used.getFullYear(), used.getMonth(), used.getDate())) / 86_400_000)
  if (days <= 0) return "Used today"
  if (days === 1) return "Used yesterday"
  if (days < 30) return `Used ${days} days ago`
  return `Used ${used.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
}

/** The name a copy of a template gets. */
export function copyName(name: string) {
  const suffix = " (copy)"
  return `${name.slice(0, TEMPLATE_NAME_MAX - suffix.length)}${suffix}`
}
