import { useEffect, useState } from "react"
import { LoadBars, Notice, Section, SkeletonRows } from "@/components/sk"
import { getMyLoad } from "@/lib/data/load/training-load-data"
import { athleteLoadSummary, currentWeek, formatLoad, weekLabel, type AthleteLoad } from "@/lib/data/load/training-load"
import { LoadExplainer } from "./load-parts"

/** The athlete's own weekly load: bars and one plain line. No bands, no warnings. */
export function MyLoadSection() {
  const [data, setData] = useState<{ asOf: string; load: AthleteLoad } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getMyLoad().then((result) => {
      if (cancelled) return
      if (result.ok) setData(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const week = data ? currentWeek(data.load) : null
  return (
    <Section
      title="Training load"
      hint={data ? athleteLoadSummary(data.load, data.asOf) : "How hard times how long, for each session you finish."}
      meta={week && data?.load.firstLoadOn ? `${formatLoad(week.load)} this week` : undefined}
      aria-label="Training load"
    >
      {error ? <Notice tone="error">Your training load could not be loaded. {error}</Notice> : null}
      {!data && !error ? <SkeletonRows rows={3} label="Loading your training load" /> : null}
      {data && data.load.firstLoadOn ? (
        <LoadBars
          points={data.load.weeks.map((entry) => ({ x: weekLabel(entry.weekStart), actual: entry.load }))}
          label={`Your training load per week over ${data.load.weeks.length} weeks. This week ${formatLoad(week?.load ?? 0)}.`}
        />
      ) : null}
      {data ? <LoadExplainer audience="athlete" /> : null}
    </Section>
  )
}
