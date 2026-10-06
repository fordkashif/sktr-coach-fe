import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Fact, FactList, Section, SkeletonRows, StatusText, type StateTone } from "@/components/sk"
import { currentSeason, sortSeasons, type ClubSeason } from "@/lib/data/club-admin/season-logic"
import { listClubSeasons } from "@/lib/data/club-admin/seasons-data"
import { formatDay, localIsoDay, parseLocalDay } from "@/lib/format/ops-format"

function seasonNow(start: string, end: string): { label: string; tone: StateTone } | null {
  const startDay = parseLocalDay(start)
  const endDay = parseLocalDay(end)
  if (!startDay || !endDay) return null
  const today = localIsoDay()
  const todayDay = parseLocalDay(today)
  if (!todayDay) return null
  const dayMs = 24 * 60 * 60 * 1000
  if (today < start) {
    const until = Math.round((startDay.getTime() - todayDay.getTime()) / dayMs)
    return { label: `Starts in ${until} ${until === 1 ? "day" : "days"}`, tone: "neutral" }
  }
  if (today > end) return { label: "Past its last day", tone: "amber" }
  const left = Math.round((endDay.getTime() - todayDay.getTime()) / dayMs)
  return { label: left === 0 ? "Last day of the season" : `In season, ${left} ${left === 1 ? "day" : "days"} left`, tone: "green" }
}

/**
 * The Season part of the club profile: the current season, read only, with the way into the
 * Seasons screen where seasons are added, changed and started.
 * `fallback` is the season on the club profile, shown when the club has no season list yet.
 */
export function ClubSeasonSection({ fallback }: { fallback?: { name: string; start: string; end: string } | null }) {
  const [seasons, setSeasons] = useState<ClubSeason[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void listClubSeasons().then((result) => {
      if (!cancelled) setSeasons(result.ok ? result.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const current = seasons ? (currentSeason(seasons) ?? (fallback && fallback.start && fallback.end ? { id: "profile", status: "current" as const, ...fallback } : null)) : null
  const upcoming = seasons ? sortSeasons(seasons).filter((season) => season.status === "upcoming").at(-1) ?? null : null
  const now = current ? seasonNow(current.start, current.end) : null

  return (
    <Section
      title="Season"
      action={
        <Link className="sk-link" to="/club-admin/profile/seasons">
          Manage seasons
        </Link>
      }
    >
      {seasons === null ? (
        <SkeletonRows rows={3} label="Loading the season" />
      ) : (
        <FactList aria-label="Season">
          <Fact label="Current season" empty="Not set">
            {current?.name.trim()}
          </Fact>
          <Fact label="First day" empty="Not set">
            {formatDay(current?.start)}
          </Fact>
          <Fact label="Last day" empty="Not set">
            {formatDay(current?.end)}
          </Fact>
          {now ? (
            <Fact label="Now">
              <StatusText tone={now.tone}>{now.label}</StatusText>
            </Fact>
          ) : null}
          {upcoming ? <Fact label="Next season">{`${upcoming.name}, from ${formatDay(upcoming.start)}`}</Fact> : null}
        </FactList>
      )}
    </Section>
  )
}
