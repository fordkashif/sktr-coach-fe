/**
 * Plan phases (periodisation), week types and planned load. Pure, no imports from the builder
 * model, so the model can use these helpers without a circular import.
 *
 * A plan may have named phases, each covering consecutive weeks, never overlapping. Weeks outside
 * every phase are fine: phases are optional and a plan saved before they existed has none.
 */

/** The kit's dot colours (the same five a squad can have). They tell phases apart and say nothing about state. */
export const PHASE_COLORS = ["blue", "green", "yellow", "coral", "ink"] as const
export type PhaseColor = (typeof PHASE_COLORS)[number]

export const PHASE_COLOR_LABELS: Record<PhaseColor, string> = { blue: "Blue", green: "Green", yellow: "Yellow", coral: "Coral", ink: "Black" }

export const PHASE_PRESETS = ["General prep", "Specific prep", "Pre-competition", "Competition", "Taper", "Transition"]
export const PHASE_NAME_MAX = 60
export const TARGET_LOAD_MAX = 30000

export type PlanPhase = {
  id: string
  name: string
  color: PhaseColor
  /** 1-based, inclusive. */
  startWeek: number
  endWeek: number
}

export const WEEK_TYPES = [
  { value: "build", label: "Build" },
  { value: "hold", label: "Hold" },
  { value: "deload", label: "Deload" },
  { value: "test", label: "Test" },
  { value: "competition", label: "Competition" },
] as const
export type WeekType = (typeof WEEK_TYPES)[number]["value"]

export function isWeekType(value: unknown): value is WeekType {
  return WEEK_TYPES.some((entry) => entry.value === value)
}

export function weekTypeLabel(type: WeekType | null | undefined): string | null {
  return WEEK_TYPES.find((entry) => entry.value === type)?.label ?? null
}

export function isPhaseColor(value: unknown): value is PhaseColor {
  return (PHASE_COLORS as readonly string[]).includes(value as string)
}

function phaseId() {
  return `phase-${Math.random().toString(36).slice(2, 10)}`
}

function byStart(phases: PlanPhase[]) {
  return [...phases].sort((left, right) => left.startWeek - right.startWeek)
}

export function phaseForWeek(phases: PlanPhase[] | undefined, week: number): PlanPhase | null {
  return (phases ?? []).find((phase) => week >= phase.startWeek && week <= phase.endWeek) ?? null
}

/** Takes the weeks from..to out of every phase: a phase is shortened, cut in two, or removed. */
export function clearPhaseRange(phases: PlanPhase[], fromWeek: number, toWeek: number): PlanPhase[] {
  const from = Math.min(fromWeek, toWeek)
  const to = Math.max(fromWeek, toWeek)
  const kept: PlanPhase[] = []
  for (const phase of phases) {
    if (phase.endWeek < from || phase.startWeek > to) {
      kept.push(phase)
      continue
    }
    if (phase.startWeek < from) kept.push({ ...phase, endWeek: from - 1 })
    // The part after the range. When the phase was cut in the middle this is a second phase with its own id.
    if (phase.endWeek > to) kept.push({ ...phase, id: phase.startWeek < from ? phaseId() : phase.id, startWeek: to + 1 })
  }
  return byStart(kept)
}

/**
 * Gives the weeks from..to to a phase. Whatever was on those weeks makes room. A neighbour with
 * the same name and colour that touches the range is joined to it, so painting week 5 onto a
 * phase that ends on week 4 extends that phase instead of making a second one.
 */
export function assignPhase(
  phases: PlanPhase[],
  input: { name: string; color: PhaseColor; fromWeek: number; toWeek: number },
  totalWeeks: number,
): PlanPhase[] {
  let name = input.name.trim().replace(/\s+/g, " ").slice(0, PHASE_NAME_MAX)
  let from = Math.max(1, Math.min(input.fromWeek, input.toWeek))
  let to = Math.min(totalWeeks, Math.max(input.fromWeek, input.toWeek))
  if (!name || from > to) return byStart(phases)
  let rest = clearPhaseRange(phases, from, to)
  let id = phaseId()
  const wanted = name.toLowerCase()
  const same = (phase: PlanPhase) => phase.name.toLowerCase() === wanted && phase.color === input.color
  const before = rest.find((phase) => phase.endWeek === from - 1 && same(phase))
  if (before) {
    from = before.startWeek
    id = before.id
    // The phase that was there keeps its spelling.
    name = before.name
    rest = rest.filter((phase) => phase !== before)
  }
  const after = rest.find((phase) => phase.startWeek === to + 1 && same(phase))
  if (after) {
    to = after.endWeek
    rest = rest.filter((phase) => phase !== after)
  }
  return byStart([...rest, { id, name, color: input.color, startWeek: from, endWeek: to }])
}

export function removePhase(phases: PlanPhase[], id: string): PlanPhase[] {
  return phases.filter((phase) => phase.id !== id)
}

/** Changes a phase's name or colour. Its weeks stay. */
export function updatePhase(phases: PlanPhase[], id: string, patch: { name?: string; color?: PhaseColor }): PlanPhase[] {
  return phases.map((phase) => {
    if (phase.id !== id) return phase
    const name = patch.name === undefined ? phase.name : patch.name.trim().replace(/\s+/g, " ").slice(0, PHASE_NAME_MAX)
    return { ...phase, name: name || phase.name, color: patch.color ?? phase.color }
  })
}

/** After the plan got shorter: phases past the end are dropped, one that runs over it is shortened. */
export function clipPhases(phases: PlanPhase[], totalWeeks: number): PlanPhase[] {
  return byStart(phases.filter((phase) => phase.startWeek <= totalWeeks).map((phase) => (phase.endWeek > totalWeeks ? { ...phase, endWeek: totalWeeks } : phase)))
}

/** The colour a new phase gets: the first one not used yet, otherwise the one after the last phase's. */
export function nextPhaseColor(phases: PlanPhase[]): PhaseColor {
  const unused = PHASE_COLORS.find((color) => !phases.some((phase) => phase.color === color))
  if (unused) return unused
  const last = byStart(phases)[phases.length - 1]
  return PHASE_COLORS[(PHASE_COLORS.indexOf(last.color) + 1) % PHASE_COLORS.length]
}

/** Rebuilds phases from stored data. Damaged entries are dropped; where two overlap the earlier one in the list keeps its weeks. */
export function sanitizePhases(value: unknown, totalWeeks: number): PlanPhase[] {
  if (!Array.isArray(value)) return []
  let phases: PlanPhase[] = []
  const taken = new Set<number>()
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const raw = entry as Record<string, unknown>
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, PHASE_NAME_MAX) : ""
    const start = Number(raw.startWeek)
    const end = Number(raw.endWeek)
    if (!name || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || start > totalWeeks) continue
    const clippedEnd = Math.min(end, totalWeeks)
    let overlaps = false
    for (let week = start; week <= clippedEnd; week += 1) if (taken.has(week)) overlaps = true
    if (overlaps) continue
    for (let week = start; week <= clippedEnd; week += 1) taken.add(week)
    const id = typeof raw.id === "string" && raw.id && !phases.some((phase) => phase.id === raw.id) ? raw.id : phaseId()
    phases = [...phases, { id, name, color: isPhaseColor(raw.color) ? raw.color : "blue", startWeek: start, endWeek: clippedEnd }]
  }
  return byStart(phases)
}

export function sanitizeWeekTypes(value: unknown, totalWeeks: number): Record<string, WeekType> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, WeekType> = {}
  for (const [week, type] of Object.entries(value as Record<string, unknown>)) {
    const number = Number(week)
    if (Number.isInteger(number) && number >= 1 && number <= totalWeeks && isWeekType(type)) result[String(number)] = type
  }
  return result
}

/** A target load typed by a coach: a whole number from 1 to TARGET_LOAD_MAX, otherwise null. */
export function cleanTargetLoad(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(number)) return null
  const rounded = Math.round(number)
  return rounded >= 1 && rounded <= TARGET_LOAD_MAX ? rounded : null
}

export function sanitizeWeekTargets(value: unknown, totalWeeks: number): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, number> = {}
  for (const [week, target] of Object.entries(value as Record<string, unknown>)) {
    const number = Number(week)
    const clean = cleanTargetLoad(target)
    if (Number.isInteger(number) && number >= 1 && number <= totalWeeks && clean !== null) result[String(number)] = clean
  }
  return result
}

/** "7" from a field: an effort from 1 to 10, otherwise null. */
export function cleanIntendedEffort(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  return Number.isInteger(number) && number >= 1 && number <= 10 ? number : null
}

type LoadSession = { week: number; durationMinutes: string; intendedEffort?: string }

/** Planned minutes x intended effort of one session, or null when either is missing. */
export function plannedSessionLoad(session: Pick<LoadSession, "durationMinutes" | "intendedEffort">): number | null {
  const minutes = Number.parseInt(session.durationMinutes, 10)
  const effort = cleanIntendedEffort(session.intendedEffort)
  return Number.isFinite(minutes) && minutes > 0 && effort !== null ? minutes * effort : null
}

export type PlannedWeekLoad = {
  /** Sum over the sessions that have both numbers. Null when none has. */
  load: number | null
  sessions: number
  /** How many of them count towards the load. */
  counted: number
}

export function plannedWeekLoad(sessions: LoadSession[], week: number): PlannedWeekLoad {
  const inWeek = sessions.filter((session) => session.week === week)
  const loads = inWeek.flatMap((session) => {
    const load = plannedSessionLoad(session)
    return load === null ? [] : [load]
  })
  return { load: loads.length > 0 ? loads.reduce((sum, load) => sum + load, 0) : null, sessions: inWeek.length, counted: loads.length }
}

/** "Specific prep, deload week", "Deload week", "Specific prep" or null: the quiet line on the athlete's plan. */
export function weekLine(phaseName: string | null | undefined, type: WeekType | null | undefined): string | null {
  const label = weekTypeLabel(type)
  const phase = phaseName?.trim() || null
  if (phase && label) return `${phase}, ${label.toLowerCase()} week`
  if (phase) return phase
  return label ? `${label} week` : null
}

function dayNumber(dateIso: string): number | null {
  const time = Date.parse(`${dateIso}T00:00:00Z`)
  return Number.isNaN(time) ? null : Math.round(time / 86_400_000)
}

/** The plan weeks (1-based) that a period from..to touches. Empty when it lies outside the plan. */
export function weeksTouched(planStart: string, totalWeeks: number, from: string, to: string): number[] {
  const start = dayNumber(planStart)
  const first = dayNumber(from)
  const last = dayNumber(to < from ? from : to)
  if (start === null || first === null || last === null) return []
  const firstWeek = Math.max(1, Math.floor((first - start) / 7) + 1)
  const lastWeek = Math.min(totalWeeks, Math.floor((last - start) / 7) + 1)
  const weeks: number[] = []
  for (let week = firstWeek; week <= lastWeek; week += 1) weeks.push(week)
  return weeks
}

/** "Weeks 1 to 4" or "Week 5". */
export function phaseWeeksText(phase: Pick<PlanPhase, "startWeek" | "endWeek">): string {
  return phase.startWeek === phase.endWeek ? `Week ${phase.startWeek}` : `Weeks ${phase.startWeek} to ${phase.endWeek}`
}
