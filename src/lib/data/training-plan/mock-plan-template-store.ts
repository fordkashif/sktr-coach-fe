import { ROLE_COOKIE, USER_COOKIE, getCookieValue } from "@/lib/auth-session"
import { createSkeletonSessions, makeId, type SessionDraft } from "@/lib/data/training-plan/plan-builder-model"
import {
  asEventGroup,
  asTemplatePhase,
  copyName,
  sanitizeTemplateStructure,
  type PlanTemplate,
  type PlanTemplateDetails,
  type PlanTemplateSummary,
  type TemplateStructure,
} from "@/lib/data/training-plan/plan-templates"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode: the club's plan templates, kept in this browser per club. Starts with two demo
 * templates so the screen is not empty (the real backend starts empty, nothing is seeded there).
 */

const STORAGE_KEY = "pacelab:plan-templates:v1"
const MOCK_COACH_USER_ID = "mock-coach-user"

type Stored = Omit<PlanTemplate, "canManage">
type StoredState = { templates: Stored[]; removedSeedIds: string[] }

/** Who is signed in, in mock mode: the demo coach, the demo club admin, or someone else by email. */
function viewer() {
  const role = getCookieValue(ROLE_COOKIE)
  const email = getCookieValue(USER_COOKIE) ?? ""
  if (role === "club-admin") return { userId: `mock-user:${email || "clubadmin"}`, name: "Club Admin", isAdmin: true, isStaff: true }
  if (role === "coach") {
    const isDemoCoach = !email || email === "coach@pacelab.local"
    return { userId: isDemoCoach ? MOCK_COACH_USER_ID : `mock-user:${email}`, name: isDemoCoach ? "Demo Coach" : email.split("@")[0], isAdmin: false, isStaff: true }
  }
  return { userId: "", name: "", isAdmin: false, isStaff: false }
}

function gymSession(week: number, dayIndex: number, squat: string, clean: string): SessionDraft {
  return {
    id: makeId("session"),
    week,
    dayIndex,
    title: "Max strength",
    sessionType: "Gym",
    location: "Weights room",
    durationMinutes: "75",
    notes: "",
    blocks: [
      {
        id: makeId("block"),
        title: "Strength",
        notes: "Full rest between sets",
        exercises: [
          { id: makeId("ex"), name: "Back squat", sets: "4", reps: "4", load: squat, libraryId: "seed-ex-back-squat", cue: "Brace before you go down. Knees track over toes." },
          { id: makeId("ex"), name: "Power clean", sets: "5", reps: "2", load: clean, libraryId: "seed-ex-power-clean", cue: "Fast elbows. Catch tall." },
          { id: makeId("ex"), name: "Front squat", sets: "3", reps: "5", load: "60%", percentOf: "Back squat" },
        ],
      },
      { id: makeId("block"), title: "Mobility", notes: "10 minutes, hips and ankles", exercises: [] },
    ],
  }
}

function seedTemplates(): Stored[] {
  const sprintSessions = createSkeletonSessions(4, "Sprint", 4)
  const squat = ["70%", "75%", "80%", "65%"]
  const withGym = [...sprintSessions.filter((session) => session.dayIndex !== 3), ...squat.map((load, index) => gymSession(index + 1, 3, load, "70%"))]
  return [
    {
      id: "seed-template-sprint-general-prep",
      name: "Sprint general prep, 4 weeks",
      description: "Acceleration and tempo with one heavy gym day. Loads build for three weeks, then ease off.",
      phase: "general-prep",
      eventGroup: "Sprint",
      weeks: 4,
      sessionCount: withGym.length,
      startWeekday: 1,
      createdByUserId: MOCK_COACH_USER_ID,
      createdByName: "Demo Coach",
      archived: false,
      lastUsedAt: "2026-09-14T09:00:00.000Z",
      updatedAt: "2026-08-30T09:00:00.000Z",
      structure: { version: 1, weekFocus: { "1": "Build the base", "2": "Add volume", "3": "Peak week", "4": "Ease off" }, sessions: withGym },
    },
    {
      id: "seed-template-throws-taper",
      name: "Throws taper, 2 weeks",
      description: "Fewer throws, full intent. For the two weeks before a main competition.",
      phase: "taper",
      eventGroup: "Throws",
      weeks: 2,
      sessionCount: 6,
      startWeekday: 1,
      createdByUserId: "mock-other-coach",
      createdByName: "Dana Brooks",
      archived: false,
      lastUsedAt: null,
      updatedAt: "2026-07-02T09:00:00.000Z",
      structure: { version: 1, weekFocus: { "1": "Sharpen", "2": "Competition week" }, sessions: createSkeletonSessions(2, "Throws", 3) },
    },
  ]
}

// Built once, so the ids inside the demo templates stay the same while the page is open.
let seeds: Stored[] | null = null
const getSeeds = () => (seeds ??= seedTemplates())

function parseStored(value: unknown): Stored | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null
  const weeks = typeof raw.weeks === "number" && Number.isInteger(raw.weeks) && raw.weeks > 0 ? raw.weeks : 1
  const structure = sanitizeTemplateStructure(raw.structure, weeks)
  return {
    id: raw.id,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    phase: asTemplatePhase(raw.phase),
    eventGroup: asEventGroup(raw.eventGroup),
    weeks,
    sessionCount: structure.sessions.length,
    startWeekday: typeof raw.startWeekday === "number" && raw.startWeekday >= 0 && raw.startWeekday <= 6 ? raw.startWeekday : null,
    createdByUserId: typeof raw.createdByUserId === "string" ? raw.createdByUserId : null,
    createdByName: typeof raw.createdByName === "string" ? raw.createdByName : "",
    archived: raw.archived === true,
    lastUsedAt: typeof raw.lastUsedAt === "string" ? raw.lastUsedAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    structure,
  }
}

function readState(): StoredState {
  if (typeof window === "undefined") return { templates: [], removedSeedIds: [] }
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (!raw) return { templates: [], removedSeedIds: [] }
    const parsed = JSON.parse(raw) as Partial<StoredState>
    return {
      templates: (Array.isArray(parsed.templates) ? parsed.templates : []).flatMap((value) => parseStored(value) ?? []),
      removedSeedIds: Array.isArray(parsed.removedSeedIds) ? parsed.removedSeedIds.filter((id) => typeof id === "string") : [],
    }
  } catch {
    return { templates: [], removedSeedIds: [] }
  }
}

function writeState(state: StoredState) {
  window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(state))
}

function all(): Stored[] {
  const state = readState()
  const storedIds = new Set(state.templates.map((template) => template.id))
  return [...state.templates, ...getSeeds().filter((seed) => !storedIds.has(seed.id) && !state.removedSeedIds.includes(seed.id))]
}

function put(template: Stored) {
  const state = readState()
  writeState({ ...state, templates: [template, ...state.templates.filter((existing) => existing.id !== template.id)] })
}

function withAccess(template: Stored): PlanTemplate {
  const me = viewer()
  const mine = me.userId !== "" && template.createdByUserId === me.userId
  return { ...template, createdByName: mine ? "You" : template.createdByName, canManage: me.isAdmin || mine }
}

function summary(template: PlanTemplate): PlanTemplateSummary {
  const { structure: _structure, ...rest } = template
  void _structure
  return rest
}

export type MockTemplateResult<T> = { ok: true; data: T } | { ok: false; reason: "not-found" | "forbidden" }

export function listMockTemplates(): PlanTemplateSummary[] {
  // An athlete sees nothing, as with the real backend.
  if (!viewer().isStaff) return []
  return all().map((template) => summary(withAccess(template)))
}

export function getMockTemplate(id: string): MockTemplateResult<PlanTemplate> {
  const found = viewer().isStaff ? all().find((template) => template.id === id) : undefined
  return found ? { ok: true, data: withAccess(found) } : { ok: false, reason: "not-found" }
}

export function createMockTemplate(details: PlanTemplateDetails, weeks: number, startWeekday: number | null, structure: TemplateStructure): MockTemplateResult<PlanTemplateSummary> {
  const me = viewer()
  if (!me.isStaff) return { ok: false, reason: "forbidden" }
  const clean = sanitizeTemplateStructure(structure, weeks)
  const template: Stored = {
    ...details,
    id: makeId("template"),
    weeks,
    sessionCount: clean.sessions.length,
    startWeekday,
    createdByUserId: me.userId,
    createdByName: me.name,
    archived: false,
    lastUsedAt: null,
    updatedAt: new Date().toISOString(),
    structure: clean,
  }
  put(template)
  return { ok: true, data: summary(withAccess(template)) }
}

function change(id: string, apply: (template: Stored) => Stored): MockTemplateResult<PlanTemplateSummary> {
  const found = getMockTemplate(id)
  if (!found.ok) return found
  if (!found.data.canManage) return { ok: false, reason: "forbidden" }
  const stored = all().find((template) => template.id === id)
  if (!stored) return { ok: false, reason: "not-found" }
  const next = apply(stored)
  put(next)
  return { ok: true, data: summary(withAccess(next)) }
}

export function updateMockTemplateDetails(id: string, details: PlanTemplateDetails) {
  return change(id, (template) => ({ ...template, ...details, updatedAt: new Date().toISOString() }))
}

export function setMockTemplateArchived(id: string, archived: boolean) {
  return change(id, (template) => ({ ...template, archived, updatedAt: new Date().toISOString() }))
}

export function duplicateMockTemplate(id: string): MockTemplateResult<PlanTemplateSummary> {
  const found = getMockTemplate(id)
  if (!found.ok) return found
  const { name, description, phase, eventGroup, weeks, startWeekday, structure } = found.data
  return createMockTemplate({ name: copyName(name), description, phase, eventGroup }, weeks, startWeekday, structure)
}

export function deleteMockTemplate(id: string): MockTemplateResult<null> {
  const found = getMockTemplate(id)
  if (!found.ok) return found
  if (!found.data.canManage) return { ok: false, reason: "forbidden" }
  const state = readState()
  const isSeed = getSeeds().some((seed) => seed.id === id)
  writeState({
    templates: state.templates.filter((template) => template.id !== id),
    removedSeedIds: isSeed ? [...new Set([...state.removedSeedIds, id])] : state.removedSeedIds,
  })
  return { ok: true, data: null }
}

/** Any coach or club admin of the club may use a template, so this needs no ownership. */
export function markMockTemplateUsed(id: string): MockTemplateResult<null> {
  const stored = viewer().isStaff ? all().find((template) => template.id === id) : undefined
  if (!stored) return { ok: false, reason: "not-found" }
  put({ ...stored, lastUsedAt: new Date().toISOString() })
  return { ok: true, data: null }
}
