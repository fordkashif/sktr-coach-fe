import { useEffect, useState } from "react"
import { getCurrentAthleteTeam, hasMockAthleteLeftTeam, loadMockJoinedTeamId, MOCK_ATHLETE_ID } from "@/lib/data/athlete/profile-data"
import { getBackendMode } from "@/lib/supabase/config"

/**
 * Whether the signed-in athlete is on a team: true, false, or null while unknown (or for anyone
 * who is not an athlete). An athlete is on one team at a time and only a coach or the club moves
 * them, so "Join a team" is offered only to an athlete with no team. Asked again when `refreshKey`
 * changes (the app passes the current page, so joining a team shows up on the next screen).
 */
export function useAthleteOnTeam(isAthlete: boolean, refreshKey?: string): boolean | null {
  const [onTeam, setOnTeam] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isAthlete) {
      setOnTeam(null)
      return
    }
    let cancelled = false
    if (getBackendMode() === "supabase") {
      void getCurrentAthleteTeam().then((result) => {
        if (!cancelled && result.ok) setOnTeam(Boolean(result.data.teamId))
      })
    } else {
      void import("@/lib/mock-data").then((module) => {
        if (cancelled) return
        const athlete = module.mockAthletes.find((item) => item.id === MOCK_ATHLETE_ID)
        setOnTeam(Boolean(hasMockAthleteLeftTeam() ? null : (loadMockJoinedTeamId() ?? athlete?.teamId ?? null)))
      })
    }
    return () => {
      cancelled = true
    }
  }, [isAthlete, refreshKey])

  return onTeam
}
