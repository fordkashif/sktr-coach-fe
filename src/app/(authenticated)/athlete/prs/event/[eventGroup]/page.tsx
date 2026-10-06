"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { Link, useLocation, useParams } from "react-router-dom"
import { hasDetailToShow, ResultDetailView } from "@/components/athlete/result-detail"
import { dayText, markText, ordinal, StandingTag, whenAndWhere } from "@/components/athlete/results-parts"
import { GoalList, useGoals } from "@/components/goals/goals-parts"
import {
  DataTable,
  EmptyState,
  LinkButton,
  Mark,
  Notice,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  Stat,
  StatStrip,
  TableSub,
  TrendLine,
  type DataTableColumn,
} from "@/components/sk"
import {
  findResultEvent,
  formatMark,
  formatMarkWithUnit,
  formatWind,
  markUnitLabel,
  RESULT_SOURCE_LABELS,
  roundLabel,
  standingsOverTime,
  type AthleteResult,
} from "@/lib/data/pr/marks"
import { getCurrentAthleteGoals } from "@/lib/data/goals/goals-data"
import { parseLocalDay } from "@/lib/data/pr/pr-display"
import { canViewerEditResult, getCurrentAthleteRecords, type AthleteRecords } from "@/lib/data/pr/results-data"

type SavedNotice = { tone: "success" | "warning" | "info"; text: string }

export default function AthleteEventHistoryPage() {
  const { eventGroup = "" } = useParams()
  const location = useLocation()
  const saved = (location.state as { saved?: SavedNotice } | null)?.saved ?? null
  const [records, setRecords] = useState<AthleteRecords | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The one result whose detail (round, splits, attempts) is open under its row.
  const [openDetailId, setOpenDetailId] = useState<string | null>(null)
  const goals = useGoals(getCurrentAthleteGoals)

  useEffect(() => {
    let cancelled = false
    void getCurrentAthleteRecords().then((result) => {
      if (cancelled) return
      if (result.ok) setRecords(result.data)
      else setError(result.error.message)
    })
    return () => {
      cancelled = true
    }
  }, [eventGroup])

  const event = records?.events.find((item) => item.group === eventGroup) ?? null
  const standings = useMemo(() => (event ? standingsOverTime(event.results) : new Map()), [event])
  const listed = event ? findResultEvent(event.eventKey) : null
  const showWind = Boolean(listed?.windApplies) || Boolean(event?.results.some((result) => result.wind !== null))
  const showPlace = Boolean(event?.results.some((result) => result.place !== null))
  const showDetail = Boolean(event?.results.some(hasDetailToShow))
  const addPath = event && event.eventKey !== "other" ? `/athlete/prs/add?event=${event.eventKey}` : "/athlete/prs/add"

  if (records === null && !error) {
    return (
      <Screen>
        <ScreenHeader back={{ to: "/athlete/prs", label: "Records" }} title="Results" />
        <Section title="Loading results">
          <SkeletonRows rows={5} label="Loading results" />
        </Section>
      </Screen>
    )
  }

  if (!event) {
    return (
      <Screen>
        <ScreenHeader back={{ to: "/athlete/prs", label: "Records" }} title="Results" />
        {error ? <Notice tone="error">These results could not be loaded. {error}</Notice> : null}
        {saved ? <Notice tone={saved.tone}>{saved.text}</Notice> : null}
        {!error ? (
          <Section title="No results in this event">
            <EmptyState
              title="There is nothing here yet"
              body="You have no results in this event, or the last one was removed."
              action={
                <LinkButton to="/athlete/prs" size="sm">
                  Back to records
                </LinkButton>
              }
            />
          </Section>
        ) : null}
      </Screen>
    )
  }

  const { personalBest, seasonBest, windAssistedBest } = event.bests
  const unitFor = (result: AthleteResult) => markUnitLabel(result.display, result.unit)
  const legalOldestFirst = event.results.filter((result) => result.windLegal).slice().reverse()
  const first = event.results[event.results.length - 1]
  const firstDay = parseLocalDay(first.date)

  const columns: Array<DataTableColumn<AthleteResult>> = [
    {
      key: "date",
      header: "Date",
      cell: (result) => (
        <>
          {dayText(result.date)}
          <TableSub>
            {[result.location, RESULT_SOURCE_LABELS[result.source], result.derivedFromResultId ? "best wind legal jump of a series" : roundLabel(result.round).toLowerCase()].filter(Boolean).join(", ")}
          </TableSub>
        </>
      ),
    },
    {
      key: "mark",
      header: "Mark",
      align: "right",
      strong: true,
      phone: "trailing",
      cell: (result) => <Mark size="sm" value={result.display} unit={unitFor(result)} />,
    },
    ...(showWind || showPlace
      ? [
          {
            key: "conditions",
            header: showWind && showPlace ? "Wind and place" : showWind ? "Wind" : "Place",
            phone: "plain" as const,
            cell: (result: AthleteResult) =>
              [
                showWind ? (result.wind !== null ? `Wind ${formatWind(result.wind)}` : result.environment === "indoor" ? "Indoor" : "No wind reading") : null,
                result.place !== null ? `${ordinal(result.place)} place` : null,
              ]
                .filter(Boolean)
                .join(", "),
          },
        ]
      : []),
    {
      key: "standing",
      header: "On the day",
      phone: "plain",
      cell: (result) => <StandingTag standing={standings.get(result.id) ?? null} />,
    },
    ...(showDetail
      ? [
          {
            key: "detail",
            header: "Detail",
            phone: "plain" as const,
            cell: (result: AthleteResult) =>
              hasDetailToShow(result) ? (
                <button
                  type="button"
                  className="sk-link"
                  aria-expanded={openDetailId === result.id}
                  aria-label={`${openDetailId === result.id ? "Hide" : "Show"} the detail of ${markText(result)} from ${dayText(result.date)}`}
                  onClick={() => setOpenDetailId(openDetailId === result.id ? null : result.id)}
                >
                  {openDetailId === result.id ? "Hide detail" : "Show detail"}
                </button>
              ) : null,
          },
        ]
      : []),
    {
      key: "edit",
      header: "Change",
      align: "right",
      phone: "plain",
      cell: (result) =>
        canViewerEditResult(result, records?.viewerUserId ?? null) && !result.competitionEntryId ? (
          <Link className="sk-link" to={`/athlete/prs/edit/${result.id}`} aria-label={`Edit ${markText(result)} from ${dayText(result.date)}`}>
            Edit
          </Link>
        ) : result.competitionId && result.competitionEntryId ? (
          <Link className="sk-link" to={`/athlete/competitions/${result.competitionId}`} aria-label={`Open the competition for ${markText(result)}`}>
            Meet
          </Link>
        ) : null,
    },
  ]

  return (
    <Screen>
      <ScreenHeader
        back={{ to: "/athlete/prs", label: "Records" }}
        title={event.label}
        lede={`${event.results.length} ${event.results.length === 1 ? "result" : "results"}${firstDay ? ` since ${firstDay.toLocaleDateString(undefined, { month: "long", year: "numeric" })}` : ""}. ${
          event.lowerIsBetter ? "Lower is better." : "Higher is better."
        }`}
        actions={
          <LinkButton to={addPath}>
            <Plus className="size-[18px]" weight="bold" aria-hidden />
            Add a result
          </LinkButton>
        }
      />

      {saved ? <Notice tone={saved.tone}>{saved.text}</Notice> : null}

      <StatStrip aria-label="Bests">
        <Stat
          label="Personal best"
          value={personalBest ? personalBest.display : "None"}
          unit={personalBest ? unitFor(personalBest) : undefined}
          hint={personalBest ? `${whenAndWhere(personalBest)}${personalBest.wind !== null ? `, wind ${formatWind(personalBest.wind)}` : ""}` : "No wind legal mark yet"}
        />
        <Stat
          label="Season best"
          value={seasonBest ? seasonBest.display : "None"}
          unit={seasonBest ? unitFor(seasonBest) : undefined}
          hint={
            seasonBest
              ? personalBest && seasonBest.id === personalBest.id
                ? "Same mark as your personal best"
                : `${whenAndWhere(seasonBest)}${seasonBest.wind !== null ? `, wind ${formatWind(seasonBest.wind)}` : ""}`
              : `No mark since ${dayText(records?.season.start ?? "")}`
          }
        />
        {windAssistedBest ? (
          <Stat
            label="Wind assisted"
            value={windAssistedBest.display}
            unit={unitFor(windAssistedBest)}
            hint={`${whenAndWhere(windAssistedBest)}, wind ${formatWind(windAssistedBest.wind)}. Not a record.`}
          />
        ) : null}
      </StatStrip>

      {legalOldestFirst.length >= 2 ? (
        <Section
          title="Progression"
          hint={`Every wind legal mark, oldest to newest. ${event.lowerIsBetter ? "The line going down is you getting faster." : "The line going up is you improving."}`}
        >
          <TrendLine
            className="mt-2"
            points={legalOldestFirst.map((result) => ({ x: parseLocalDay(result.date) ?? new Date(result.date), y: result.value }))}
            seriesName={event.label}
            formatValue={(value) => formatMarkWithUnit(formatMark(value, event.unit), event.unit)}
            label={`${event.label} progression over ${legalOldestFirst.length} wind legal results, from ${markText(legalOldestFirst[0])} on ${dayText(legalOldestFirst[0].date)} to ${markText(
              legalOldestFirst[legalOldestFirst.length - 1],
            )} on ${dayText(legalOldestFirst[legalOldestFirst.length - 1].date)}.${personalBest ? ` Personal best ${markText(personalBest)}.` : ""}`}
          />
        </Section>
      ) : null}

      {goals.view ? (
        (() => {
          const eventGoals = goals.view.goals.filter((goal) => goal.eventGroup === event.group)
          return (
            <Section
              title={eventGoals.length === 1 ? "Goal" : "Goals"}
              action={
                <Link className="sk-link" to="/athlete/goals">
                  {eventGoals.length > 0 ? "All goals" : "Set a goal"}
                </Link>
              }
            >
              {eventGoals.length > 0 ? (
                <GoalList aria-label={`Your ${event.label} goals`} view={goals.view} goals={eventGoals} audience="athlete" onChanged={goals.reload} />
              ) : (
                <p className="sk-list-sub">No goal in this event. Set a mark to aim for and follow how close you are.</p>
              )}
            </Section>
          )
        })()
      ) : null}

      <Section title="All results" meta="Newest first">
        <DataTable
          caption={`Every ${event.label} result, newest first`}
          columns={columns}
          rows={event.results}
          rowKey={(result) => result.id}
          rowBelow={(result) =>
            openDetailId === result.id ? <ResultDetailView result={result} legalMark={event.results.find((item) => item.derivedFromResultId === result.id) ?? null} className="max-w-xl" /> : null
          }
        />
      </Section>
    </Screen>
  )
}
