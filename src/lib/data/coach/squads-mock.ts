import { loadMockRoster, mergeMockAthletes } from "@/lib/data/coach/roster-mock"
import { isSquadColor, membersOnTeam, type Squad } from "@/lib/data/coach/squads"
import { mockAthletes } from "@/lib/mock-data"
import { tenantStorageKey } from "@/lib/tenant-storage"

/**
 * Mock mode only: the squads of the demo club, kept in this browser. Two example squads on the
 * sprint team to start with. Behaves like the real backend: a squad only holds athletes who are on
 * its team right now, so an athlete who is moved or taken off the team drops out of its squads.
 */

const STORAGE_KEY = "pacelab:coach-squads:v1"
export const SQUADS_CHANGED_EVENT = "pacelab:squads-changed"

type StoredSquad = Squad & { archived: boolean }

function seedSquads(): StoredSquad[] {
  return [
    { id: "sq-short", teamId: "t1", name: "Short sprints", color: "blue", note: "100m and 200m, block work on Tuesdays.", athleteIds: ["a1", "a2", "a10"], archived: false },
    { id: "sq-400", teamId: "t1", name: "400m", color: "coral", note: null, athleteIds: ["a3"], archived: false },
  ]
}

function read(): StoredSquad[] {
  if (typeof window === "undefined") return seedSquads()
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    if (!raw) return seedSquads()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return seedSquads()
    return parsed.flatMap((item): StoredSquad[] => {
      if (!item || typeof item !== "object") return []
      const squad = item as Partial<StoredSquad>
      if (typeof squad.id !== "string" || typeof squad.teamId !== "string" || typeof squad.name !== "string") return []
      return [
        {
          id: squad.id,
          teamId: squad.teamId,
          name: squad.name,
          color: isSquadColor(squad.color) ? squad.color : null,
          note: typeof squad.note === "string" && squad.note ? squad.note : null,
          athleteIds: Array.isArray(squad.athleteIds) ? squad.athleteIds.filter((id): id is string => typeof id === "string") : [],
          archived: squad.archived === true,
        },
      ]
    })
  } catch {
    return seedSquads()
  }
}

function write(squads: StoredSquad[], announce = true) {
  window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(squads))
  if (announce) window.dispatchEvent(new CustomEvent(SQUADS_CHANGED_EVENT))
}

/** Every squad with only the members who are on its team now. Memberships that ended are forgotten for good. */
function current(): StoredSquad[] {
  const stored = read()
  const roster = mergeMockAthletes(mockAthletes, loadMockRoster())
  const pruned = stored.map((squad) => {
    const athleteIds = membersOnTeam(
      squad.athleteIds,
      roster.filter((athlete) => athlete.teamId === squad.teamId).map((athlete) => athlete.id),
    )
    return athleteIds.length === squad.athleteIds.length ? squad : { ...squad, athleteIds }
  })
  if (typeof window !== "undefined" && pruned.some((squad, index) => squad !== stored[index])) {
    try {
      write(pruned, false)
    } catch {
      // Storage can be full or blocked. The pruned list is still what is shown.
    }
  }
  return pruned
}

function strip(squad: StoredSquad): Squad {
  return { id: squad.id, teamId: squad.teamId, name: squad.name, color: squad.color, note: squad.note, athleteIds: squad.athleteIds }
}

/** Live squads. Pass a team to get that team's only. */
export function loadMockSquads(teamId?: string | null): Squad[] {
  return current()
    .filter((squad) => !squad.archived && (!teamId || squad.teamId === teamId))
    .map(strip)
}

/** Applies a change to the stored squads and saves it. Throws when the browser refuses to store. */
export function updateMockSquads(change: (squads: Squad[]) => Squad[], archiveId?: string) {
  const before = current()
  const archived = before.filter((squad) => squad.archived || squad.id === archiveId).map((squad) => ({ ...squad, archived: true, athleteIds: [] }))
  const live = change(before.filter((squad) => !squad.archived && squad.id !== archiveId).map(strip)).map((squad) => ({ ...squad, archived: false }))
  write([...live, ...archived])
}
