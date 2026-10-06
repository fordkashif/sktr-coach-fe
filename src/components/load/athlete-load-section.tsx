import { useEffect, useState } from "react"
import { List, ListRow, LoadBars, Notice, RatioLine, Section, SkeletonRows } from "@/components/sk"
import type { AthleteAvailability } from "@/lib/data/athlete/availability-data"
import { getAthleteLoad, type AthleteLoadDetail } from "@/lib/data/load/training-load-data"
import { RATIO_USUAL_FROM, RATIO_USUAL_TO, RATIO_WELL_ABOVE, currentWeek, formatLoad, previousWeek, weekLabel } from "@/lib/data/load/training-load"
import { LoadBandText, LoadExplainer } from "./load-parts"

function dayText(dateIso: string) {
  const parsed = new Date(`${dateIso}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? dateIso : parsed.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}

/**
 * Training load of one athlete, for their coach: 12 weeks of weekly load (planned beside done
 * where the plan gives it), the last 7 days against the usual week, and the sessions behind the
 * last 7 days. Loads its own data, so the athlete screen only has to place it.
 */
export function AthleteLoadSection({ athleteId, athleteName, availability }: { athleteId: string; athleteName: string; availability?: AthleteAvailability | null }) {
  const [detail, setDetail] = useState<AthleteLoadDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const first = athleteName.split(" ")[0] || "This athlete"

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    void getAthleteLoad(athleteId).then((result) => {
      if (cancelled) return
      if (result.ok) setDetail(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [athleteId])

  const load = detail?.load ?? null
  const week = load ? currentWeek(load) : null
  const last = load ? previousWeek(load) : null
  const hasLoad = Boolean(load?.firstLoadOn)
  const hasRatio = Boolean(load?.weeks.some((entry) => entry.ratio !== null))

  return (
    <Section
      title="Training load"
      hint="Effort times minutes for each finished session, added up per week."
      meta={week ? `This week ${formatLoad(week.load)}${week.planned !== null ? ` of ${formatLoad(week.planned)} planned` : ""}` : undefined}
      aria-label="Training load"
    >
      {error ? <Notice tone="error">The load could not be loaded. {error}</Notice> : null}
      {!detail && !error ? <SkeletonRows rows={4} label="Loading training load" /> : null}

      {detail && load && week ? (
        <>
          {hasLoad ? (
            <>
              <div className="flex flex-wrap items-start gap-x-8 gap-y-2 pb-2 pt-1">
                <LoadBandText load={load} asOf={detail.asOf} availability={availability} />
                <p className="text-[0.9375rem] text-sk-ink-2">
                  Last 7 days {formatLoad(week.acute)}, usual week {formatLoad(week.chronic)}
                  {last ? `. Last week ${formatLoad(last.load)}` : ""}.
                </p>
              </div>
              <LoadBars
                points={load.weeks.map((entry) => ({ x: weekLabel(entry.weekStart), actual: entry.load, planned: entry.planned }))}
                label={`${first}'s load per week over ${load.weeks.length} weeks. This week ${formatLoad(week.load)}${week.planned !== null ? `, planned ${formatLoad(week.planned)}` : ""}.`}
              />
              <h3 className="mt-5 text-base font-bold text-sk-ink">Last 7 days against the usual week</h3>
              {hasRatio ? (
                <RatioLine
                  points={load.weeks.map((entry) => ({ x: weekLabel(entry.weekStart), y: entry.ratio }))}
                  usualFrom={RATIO_USUAL_FROM}
                  usualTo={RATIO_USUAL_TO}
                  wellAbove={RATIO_WELL_ABOVE}
                  label={`The last 7 days against the usual week, at the end of each of ${load.weeks.length} weeks. ${week.ratio !== null ? `Now ${week.ratio.toFixed(2)}.` : "Not shown yet for this week."}`}
                />
              ) : (
                <p className="py-2 text-[0.9375rem] text-sk-mute">Shown once {first} has 4 weeks of logged sessions with an effort and a time.</p>
              )}
            </>
          ) : (
            <p className="py-2 text-[0.9375rem] text-sk-mute">
              No load recorded yet. It appears when {first} finishes a session with how hard it was and how long it took.
            </p>
          )}

          <h3 className="mt-5 text-base font-bold text-sk-ink">Sessions in the last 7 days</h3>
          {detail.sessions.length > 0 ? (
            <List aria-label="Sessions in the last 7 days">
              {detail.sessions.map((session) => (
                <ListRow
                  key={session.id}
                  title={session.title}
                  subtitle={`${dayText(session.date)}. ${session.effort !== null ? `Effort ${session.effort}` : "No effort given"}, ${session.minutes !== null ? `${session.minutes} min` : "no time given"}`}
                  trailing={session.load !== null ? <span className="font-bold tabular-nums text-sk-ink">{formatLoad(session.load)}</span> : <span className="text-sm text-sk-mute">No load recorded</span>}
                />
              ))}
            </List>
          ) : (
            <p className="py-2 text-[0.9375rem] text-sk-mute">No finished sessions in the last 7 days.</p>
          )}
          <LoadExplainer audience="coach" />
        </>
      ) : null}
    </Section>
  )
}
