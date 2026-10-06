import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { PersonAvatar } from "@/components/account/person-avatar"
import { LoadBandText, LoadExplainer } from "@/components/load/load-parts"
import { ReportsNav } from "@/components/load/reports-nav"
import { DataTable, EmptyState, FilterBar, FilterChips, LinkButton, Notice, Screen, ScreenHeader, Section, SkeletonRows, Sparkline, Stat, StatStrip, TableSub, type DataTableColumn } from "@/components/sk"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { getTeamLoad, TEAM_LOAD_WEEKS, type TeamLoad, type TeamLoadRow } from "@/lib/data/load/training-load-data"
import { currentWeek, formatLoad, loadBand, previousWeek, sortLoadRows, weekLabel } from "@/lib/data/load/training-load"

export default function CoachLoadPage() {
  const { role, coachTeamId, coachTeams } = useCoachTeamScope()
  const scopeTeamId = role === "coach" ? coachTeamId : null
  const teamName = coachTeams.find((team) => team.id === scopeTeamId)?.name ?? null
  // One screen per team: switching team reloads the table and clears the squad filter.
  return <TeamLoadScreen key={scopeTeamId ?? "all"} teamId={scopeTeamId} teamName={teamName} />
}

type Row = TeamLoadRow & { band: ReturnType<typeof loadBand>; unavailable: boolean }

function TeamLoadScreen({ teamId, teamName }: { teamId: string | null; teamName: string | null }) {
  const [data, setData] = useState<TeamLoad | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [squadId, setSquadId] = useState("all")

  useEffect(() => {
    let cancelled = false
    void getTeamLoad({ teamId }).then((result) => {
      if (cancelled) return
      if (result.ok) setData(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [teamId])

  const squads = useMemo(() => (data?.squads ?? []).filter((squad) => squad.athleteIds.length > 0), [data])
  const rows = useMemo(() => {
    const squad = squads.find((entry) => entry.id === squadId)
    const all: Row[] = (data?.rows ?? [])
      .filter((row) => !squad || squad.athleteIds.includes(row.athleteId))
      .map((row) => ({ ...row, band: loadBand(currentWeek(row.load)?.ratio ?? null), unavailable: row.availability !== null }))
    return sortLoadRows(all)
  }, [data, squadId, squads])

  const flagged = (band: Row["band"]) => rows.filter((row) => !row.unavailable && row.band === band).length
  const noLoadThisWeek = rows.filter((row) => (currentWeek(row.load)?.sessionsWithLoad ?? 0) === 0).length
  const anyPlanned = rows.some((row) => currentWeek(row.load)?.planned !== null)
  const thisWeekStart = data?.rows[0] ? currentWeek(data.rows[0].load)?.weekStart : null

  const columns: Array<DataTableColumn<Row>> = [
    {
      key: "athlete",
      header: "Athlete",
      cell: (row) => (
        <Link to={`/coach/athletes/${row.athleteId}`} className="flex items-center gap-3 hover:text-sk-blue-link">
          <PersonAvatar name={row.name} athleteId={row.athleteId} size="sm" />
          <span className="min-w-0">{row.name}</span>
        </Link>
      ),
    },
    { key: "band", header: "Last 7 days against usual", phone: "plain", cell: (row) => <LoadBandText load={row.load} asOf={data?.asOf ?? ""} availability={row.availability} /> },
    {
      key: "this",
      header: "This week",
      align: "right",
      strong: true,
      phone: "trailing",
      cell: (row) => {
        const week = currentWeek(row.load)
        const missing = week?.sessionsWithoutLoad ?? 0
        return (
          <span data-load-this-week>
            {formatLoad(week?.load ?? 0)}
            {missing > 0 ? <TableSub>{`${missing} ${missing === 1 ? "session" : "sessions"} with no load recorded`}</TableSub> : null}
          </span>
        )
      },
    },
    ...(anyPlanned
      ? [
          {
            key: "planned",
            header: "Planned this week",
            align: "right" as const,
            cell: (row: Row) => {
              const planned = currentWeek(row.load)?.planned ?? null
              return planned === null ? <span className="text-sk-faint">None</span> : formatLoad(planned)
            },
          },
        ]
      : []),
    { key: "last", header: "Last week", align: "right", cell: (row) => formatLoad(previousWeek(row.load)?.load ?? 0) },
    {
      key: "spark",
      header: `${TEAM_LOAD_WEEKS - 1} weeks before`,
      phone: "hide",
      className: "w-36",
      cell: (row) => {
        // Full weeks only: the week still running would always end the line with a dive.
        const values = row.load.weeks.slice(0, -1).map((week) => week.load)
        if (!row.load.firstLoadOn || values.length === 0) return <span className="text-sk-faint">None</span>
        return <Sparkline className="h-9 w-32" min={0} values={values} label={`Load per week over the ${values.length} full weeks before this one, from ${formatLoad(values[0] ?? 0)} to ${formatLoad(values[values.length - 1] ?? 0)}`} />
      },
    },
  ]

  return (
    <Screen>
      <ScreenHeader
        title="Load"
        lede={`${teamName ? `${teamName}. ` : ""}Training load per athlete${thisWeekStart ? `, week of ${weekLabel(thisWeekStart)}` : ""}. Effort times minutes for each finished session.`}
      />
      <ReportsNav />

      {error ? <Notice tone="error">The load could not be loaded. {error}</Notice> : null}

      {data && data.rows.length > 0 ? (
        <StatStrip aria-label="This team's load at a glance">
          <Stat label="Athletes" value={rows.length} />
          <Stat label="Well above usual" value={flagged("well-above")} hint="Last 7 days" />
          <Stat label="Above usual" value={flagged("above")} hint="Last 7 days" />
          <Stat label="No load this week" value={noLoadThisWeek} hint="Nothing finished with effort and time" />
        </StatStrip>
      ) : null}

      <Section title="Athletes" hint="Well above usual first. An athlete who is injured, sick or away is marked and not flagged." aria-label="Load per athlete">
        {squads.length > 0 ? (
          <FilterBar activeCount={squadId === "all" ? 0 : 1} onClear={() => setSquadId("all")} className="mb-2">
            <FilterChips label="Squad" value={squadId} onChange={setSquadId} options={[{ value: "all", label: "All" }, ...squads.map((squad) => ({ value: squad.id, label: squad.name }))]} />
          </FilterBar>
        ) : null}
        {!data && !error ? <SkeletonRows rows={6} label="Loading training load" /> : null}
        {data && rows.length > 0 ? <DataTable caption="Training load per athlete" columns={columns} rows={rows} rowKey={(row) => row.athleteId} rowProps={(row) => ({ "data-athlete-id": row.athleteId })} /> : null}
        {data && rows.length === 0 ? (
          <EmptyState
            title={data.rows.length === 0 ? "No athletes yet" : "No athletes in this squad"}
            body={data.rows.length === 0 ? "Load shows here once athletes on your team finish sessions with an effort and a time." : "Pick another squad, or All."}
            action={data.rows.length === 0 ? <LinkButton to="/coach/teams" size="sm">Open the team</LinkButton> : undefined}
          />
        ) : null}
        {data ? <LoadExplainer audience="coach" /> : null}
      </Section>
    </Screen>
  )
}
