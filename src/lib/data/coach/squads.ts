/**
 * Squads: small named groups inside ONE team ("Short sprints", "400m", "Juniors").
 *
 * An athlete is on one team. A squad never changes that and never changes who can see the athlete:
 * it is only a way for the team's coaches to send work to part of the team. An athlete can be in
 * several squads of their team, or in none.
 *
 * Everything in this file is pure, so it runs in unit tests without a browser or a database.
 */

/** The colours a squad's dot can have. They are the kit's own avatar colours. */
export const SQUAD_COLORS = ["blue", "green", "yellow", "coral", "ink"] as const
export type SquadColor = (typeof SQUAD_COLORS)[number]

export const SQUAD_COLOR_LABELS: Record<SquadColor, string> = {
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
  coral: "Coral",
  ink: "Black",
}

export const SQUAD_NAME_MAX = 60
export const SQUAD_NOTE_MAX = 280

export type Squad = {
  id: string
  teamId: string
  name: string
  color: SquadColor | null
  note: string | null
  /** Athletes of the squad's team who are in it. */
  athleteIds: string[]
}

export type SquadInput = {
  name: string
  color: SquadColor | null
  note: string | null
}

export function isSquadColor(value: unknown): value is SquadColor {
  return typeof value === "string" && (SQUAD_COLORS as readonly string[]).includes(value)
}

/** Trims a name the way the database does: outer spaces off, runs of spaces to one. */
export function cleanSquadName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, SQUAD_NAME_MAX)
}

/**
 * Checks a new or renamed squad. `others` are the team's other live squads: two squads of a team
 * cannot share a name (compared without case). Returns the cleaned input or the message to show.
 */
export function validateSquadInput(input: SquadInput, others: Array<Pick<Squad, "name">>): { ok: true; data: SquadInput } | { ok: false; message: string } {
  const name = cleanSquadName(input.name)
  if (!name) return { ok: false, message: "Give the squad a name." }
  if (others.some((squad) => cleanSquadName(squad.name).toLowerCase() === name.toLowerCase())) {
    return { ok: false, message: `This team already has a squad called ${name}.` }
  }
  const note = (input.note ?? "").trim().slice(0, SQUAD_NOTE_MAX) || null
  return { ok: true, data: { name, color: isSquadColor(input.color) ? input.color : null, note } }
}

/** A squad can only hold athletes of its own team. Anyone else is dropped, and nobody is listed twice. */
export function membersOnTeam(athleteIds: string[], teamAthleteIds: Iterable<string>): string[] {
  const onTeam = new Set(teamAthleteIds)
  return [...new Set(athleteIds)].filter((id) => onTeam.has(id))
}

/** What changes when a squad's members are set to `next`. */
export function memberChanges(current: string[], next: string[]): { added: string[]; removed: string[] } {
  const before = new Set(current)
  const after = new Set(next)
  return { added: [...after].filter((id) => !before.has(id)), removed: [...before].filter((id) => !after.has(id)) }
}

/** After an athlete leaves a team (moved, removed), their memberships on that team end. */
export function withoutAthlete(squads: Squad[], athleteId: string, stillOnTeamId: string | null): Squad[] {
  return squads.map((squad) =>
    squad.teamId === stillOnTeamId || !squad.athleteIds.includes(athleteId) ? squad : { ...squad, athleteIds: squad.athleteIds.filter((id) => id !== athleteId) },
  )
}

/** The squads each athlete is in, in the order the squads are given. */
export function squadsByAthlete<T extends Pick<Squad, "athleteIds">>(squads: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const squad of squads) {
    for (const athleteId of squad.athleteIds) {
      const list = map.get(athleteId)
      if (list) list.push(squad)
      else map.set(athleteId, [squad])
    }
  }
  return map
}

/** "400m and Juniors", "400m, Juniors and Relay". */
export function squadNamesText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/* ---------- Who a piece of work reaches ---------------------------------------------------------- */

export type ReachTarget = "team" | "squads" | "subgroup" | "selected"

export type ReachAthlete = { id: string; teamId: string; eventGroup?: string | null }

export type ReachInput = {
  teamId: string
  target: ReachTarget
  /** For "squads". Squads of another team are ignored. */
  squadIds?: string[]
  /** For "subgroup": the event group. */
  subgroup?: string | null
  /** For "selected": athletes picked by name. */
  athleteIds?: string[]
}

/**
 * The athletes a plan (or a test week) reaches right now: the whole team, the members of the
 * chosen squads (each athlete once, however many of the squads they are in), an event group, or
 * the athletes picked by name. Only ever athletes of the one team.
 */
export function reachedAthleteIds(input: ReachInput, athletes: ReachAthlete[], squads: Array<Pick<Squad, "id" | "teamId" | "athleteIds">>): string[] {
  const onTeam = athletes.filter((athlete) => athlete.teamId === input.teamId)
  if (input.target === "team") return onTeam.map((athlete) => athlete.id)
  if (input.target === "subgroup") return onTeam.filter((athlete) => athlete.eventGroup === input.subgroup).map((athlete) => athlete.id)
  if (input.target === "squads") {
    const chosen = new Set(input.squadIds ?? [])
    const inSquads = new Set(squads.filter((squad) => squad.teamId === input.teamId && chosen.has(squad.id)).flatMap((squad) => squad.athleteIds))
    return onTeam.filter((athlete) => inSquads.has(athlete.id)).map((athlete) => athlete.id)
  }
  const picked = new Set(input.athleteIds ?? [])
  return onTeam.filter((athlete) => picked.has(athlete.id)).map((athlete) => athlete.id)
}

/** The chosen squads that still exist on the team, in the team's order. Archived or foreign ids are dropped. */
export function liveSquadIds(squadIds: string[], squads: Array<Pick<Squad, "id" | "teamId">>, teamId: string): string[] {
  const chosen = new Set(squadIds)
  return squads.filter((squad) => squad.teamId === teamId && chosen.has(squad.id)).map((squad) => squad.id)
}

/* ---------- Two plans on the same day ---------------------------------------------------------------- */

export type PlanDays = {
  id: string | null
  name: string
  /** Days with a session, yyyy-mm-dd. */
  dates: string[]
  /** Athletes the plan reaches. */
  athleteIds: string[]
}

export type DayClash = {
  /** Athletes who get a session from both plans on at least one day. */
  athleteIds: string[]
  /** The days both plans have a session on, first to last. */
  dates: string[]
  /** The other plans involved, by name. */
  planNames: string[]
}

/**
 * Finds the athletes who would get two sessions on one day: one from `plan` and one from another
 * published plan (a team plan and a squad plan, say). Only days from `fromDate` on count; a plan
 * never clashes with itself. Returns null when nobody is doubled up.
 */
export function findDayClashes(plan: PlanDays, others: PlanDays[], fromDate: string): DayClash | null {
  const mine = new Set(plan.dates.filter((date) => date >= fromDate))
  const myAthletes = new Set(plan.athleteIds)
  if (mine.size === 0 || myAthletes.size === 0) return null

  const athleteIds = new Set<string>()
  const dates = new Set<string>()
  const planNames: string[] = []
  for (const other of others) {
    if (plan.id !== null && other.id === plan.id) continue
    const sharedDates = other.dates.filter((date) => mine.has(date))
    if (sharedDates.length === 0) continue
    const sharedAthletes = other.athleteIds.filter((id) => myAthletes.has(id))
    if (sharedAthletes.length === 0) continue
    for (const id of sharedAthletes) athleteIds.add(id)
    for (const date of sharedDates) dates.add(date)
    if (!planNames.includes(other.name)) planNames.push(other.name)
  }
  if (athleteIds.size === 0) return null
  return { athleteIds: [...athleteIds], dates: [...dates].sort(), planNames }
}

/** The one line the publish step shows when a clash will happen. */
export function dayClashText(clash: DayClash): string {
  const who = clash.athleteIds.length === 1 ? "1 athlete also has" : `${clash.athleteIds.length} athletes also have`
  const what = clash.planNames.length === 1 ? `a session from ${clash.planNames[0]}` : `sessions from ${squadNamesText(clash.planNames)}`
  const when = clash.dates.length === 1 ? "1 of these days" : `${clash.dates.length} of these days`
  return `${who} ${what} on ${when}. They will see both sessions.`
}
