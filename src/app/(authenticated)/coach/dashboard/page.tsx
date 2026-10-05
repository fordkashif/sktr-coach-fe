import { useEffect, useState } from "react"
import { ArrowDown, ArrowRight, ArrowUp, CheckCircle, ClipboardText, Minus, Timer, Trophy } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { LineChart } from "@mui/x-charts"
import { COACH_TEAM_COOKIE, getCookieValue, ROLE_COOKIE } from "@/lib/auth-session"
import { EmptyState, Initials, Meter, PageHeader, Panel, ReadinessTag, Stat, scoreTone } from "@/components/sk"
import type { Athlete, PR, Team, TestWeekResult, TrendPoint } from "@/lib/mock-data"
import {
  getCoachDashboardSnapshotForCurrentUser,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import {
  getCurrentCoachOnboardingState,
  setCurrentCoachSetupGuideDismissed,
} from "@/lib/data/coach/invite-claim-data"
import { getBackendMode } from "@/lib/supabase/config"
import { cn } from "@/lib/utils"

const chartSx = {
  "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { stroke: "transparent" },
  "& .MuiChartsAxis-tickLabel": { fill: "#6a7385", fontSize: 12, fontFamily: "inherit", fontWeight: 600 },
  "& .MuiChartsGrid-line": { stroke: "#e3e6ee" },
  "& .MuiMarkElement-root": { strokeWidth: 2, fill: "#ffffff" },
  "& .MuiLineElement-root": { strokeLinecap: "round", strokeWidth: 3 },
}

function Change({ change }: { change: "up" | "down" | "same" }) {
  if (change === "up") return <ArrowUp className="size-4 text-sk-green" weight="bold" aria-label="Improved" />
  if (change === "down") return <ArrowDown className="size-4 text-sk-coral" weight="bold" aria-label="Dropped" />
  return <Minus className="size-4 text-sk-mute" weight="bold" aria-label="No change" />
}

function shortDay(date: string) {
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { weekday: "short" })
}

export default function CoachDashboardPage() {
  const backendMode = getBackendMode()
  const role = getCookieValue(ROLE_COOKIE)
  const coachTeamId = getCookieValue(COACH_TEAM_COOKIE)
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [setupGuideDismissedAt, setSetupGuideDismissedAt] = useState<string | null>(null)
  const [setupGuideSaving, setSetupGuideSaving] = useState(false)
  const [mockData, setMockData] = useState<{
    athletes: Athlete[]
    prs: PR[]
    teams: Team[]
    tests: TestWeekResult[]
    trendSeries: Record<string, TrendPoint[]>
  }>({ athletes: [], prs: [], teams: [], tests: [], trendSeries: {} })

  useEffect(() => {
    if (backendMode !== "supabase") return
    let cancelled = false

    const loadSnapshot = async () => {
      const [result, onboardingResult] = await Promise.all([
        getCoachDashboardSnapshotForCurrentUser({ scopeTeamId: role === "coach" ? coachTeamId : null }),
        getCurrentCoachOnboardingState(),
      ])
      if (cancelled) return
      if (!result.ok) {
        setBackendError(result.error.message)
        return
      }
      setBackendError(null)
      setBackendSnapshot(result.data)
      if (onboardingResult.ok) {
        setSetupGuideDismissedAt(onboardingResult.data.setupGuideDismissedAt ?? null)
      }
    }

    void loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [backendMode, coachTeamId, role])

  useEffect(() => {
    if (backendMode === "supabase") return
    let cancelled = false

    void import("@/lib/mock-data").then((module) => {
      if (!cancelled) {
        setMockData({
          athletes: module.mockAthletes,
          prs: module.mockPRs,
          teams: module.mockTeams,
          tests: module.mockTestWeekResults,
          trendSeries: module.mockTrendSeries,
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [backendMode])

  const sourceAthletes = backendMode === "supabase" ? (backendSnapshot?.athletes ?? []) : mockData.athletes
  const sourcePrs = backendMode === "supabase" ? (backendSnapshot?.prs ?? []) : mockData.prs
  const sourceTests = backendMode === "supabase" ? (backendSnapshot?.tests ?? []) : mockData.tests
  const sourceTeams = backendMode === "supabase" ? (backendSnapshot?.teams ?? []) : mockData.teams
  const sourceTrends = backendMode === "supabase" ? (backendSnapshot?.trendSeries ?? {}) : mockData.trendSeries

  const scopedAthletes =
    role === "coach" && coachTeamId ? sourceAthletes.filter((athlete) => athlete.teamId === coachTeamId) : sourceAthletes
  const athleteIds = new Set(scopedAthletes.map((athlete) => athlete.id))
  const scopedPrs = sourcePrs.filter((pr) => athleteIds.has(pr.athleteId))
  const scopedTests = sourceTests.filter((row) => athleteIds.has(row.athleteId))
  const scopedTeam = sourceTeams.find((team) => team.id === coachTeamId)

  const readinessSummary = {
    green: scopedAthletes.filter((athlete) => athlete.readiness === "green").length,
    yellow: scopedAthletes.filter((athlete) => athlete.readiness === "yellow").length,
    red: scopedAthletes.filter((athlete) => athlete.readiness === "red").length,
  }

  const adherenceAverage =
    scopedAthletes.length > 0
      ? Math.round(scopedAthletes.reduce((sum, athlete) => sum + athlete.adherence, 0) / scopedAthletes.length)
      : 0

  const rosterHref = role === "coach" && coachTeamId ? `/coach/teams/${coachTeamId}` : "/coach/teams"
  const alertRows = scopedAthletes
    .filter((athlete) => athlete.readiness !== "green" || athlete.adherence < 75)
    .sort((left, right) => left.adherence - right.adherence)
    .slice(0, 5)

  const prMomentum = Object.entries(
    scopedPrs.reduce<Record<string, number>>((acc, pr) => {
      acc[pr.category] = (acc[pr.category] ?? 0) + 1
      return acc
    }, {}),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)

  const adherenceRows = [...scopedAthletes].sort((left, right) => right.adherence - left.adherence).slice(0, 6)

  const trendRows = scopedAthletes.map((athlete) => sourceTrends[athlete.id]).filter((series): series is NonNullable<
    typeof sourceTrends[string]
  > => Boolean(series))

  const trendDates = trendRows[0]?.map((point) => point.date) ?? []
  const readinessTrendValues = trendDates.map((date, index) => {
    const dayPoints = trendRows
      .map((series) => series[index])
      .filter((point) => point?.date === date)
    if (!dayPoints.length) return 0
    return Math.round(dayPoints.reduce((sum, point) => sum + point.readiness, 0) / dayPoints.length)
  })
  const trainingLoadValues = trendDates.map((date, index) => {
    const dayPoints = trendRows
      .map((series) => series[index])
      .filter((point) => point?.date === date)
    if (!dayPoints.length) return 0
    return Math.round(dayPoints.reduce((sum, point) => sum + point.trainingLoad, 0) / dayPoints.length)
  })
  const readinessTotal = scopedAthletes.length
  const prTotal = scopedPrs.length
  const coachNeedsGuide =
    backendMode === "supabase" && (sourceTeams.length === 0 || scopedAthletes.length === 0 || scopedTests.length === 0)
  const latestReadiness = readinessTrendValues.at(-1)

  const toggleGuide = async (dismissed: boolean) => {
    setSetupGuideSaving(true)
    const result = await setCurrentCoachSetupGuideDismissed(dismissed)
    setSetupGuideSaving(false)
    if (!result.ok) {
      setBackendError((current) => current ?? result.error.message)
      return
    }
    setSetupGuideDismissedAt(dismissed ? new Date().toISOString() : null)
  }

  // A coach only sees the teams a club admin assigned them to. With none, there is nothing to invite into yet.
  const coachHasNoTeam = backendMode === "supabase" && role === "coach" && backendSnapshot !== null && sourceTeams.length === 0
  const lede = coachHasNoTeam
    ? "You are not assigned to a team yet. Ask a club admin to add you to one, then your roster, readiness and adherence show up here."
    : readinessTotal === 0
      ? "No athletes on your roster yet. Invite your squad to start seeing readiness and adherence here."
      : alertRows.length === 0
        ? `${readinessTotal} ${readinessTotal === 1 ? "athlete" : "athletes"}, all on track today.`
        : `${readinessTotal} ${readinessTotal === 1 ? "athlete" : "athletes"}. ${alertRows.length} ${alertRows.length === 1 ? "needs" : "need"} a look today.`

  return (
    <div className="sk-page">
      {backendError ? (
        <p role="alert" className="rounded-2xl bg-sk-coral-tint px-4 py-3 text-sm font-semibold text-[#b32a0c]">
          Could not load the latest data: {backendError}
        </p>
      ) : null}

      <PageHeader
        title={scopedTeam?.name ?? "Your squad"}
        lede={lede}
        actions={
          <>
            <Link to="/coach/test-week" className="sk-btn sk-btn-quiet">
              <Timer className="size-5" weight="bold" />
              New test week
            </Link>
            <Link to="/coach/training-plan" className="sk-btn sk-btn-primary">
              <ClipboardText className="size-5" weight="bold" />
              Build a plan
            </Link>
          </>
        }
      />

      {coachNeedsGuide && !setupGuideDismissedAt ? (
        <section className="rounded-[20px] bg-sk-yellow p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="sk-h2">Get set up in three steps</h2>
              <p className="mt-1 max-w-[56ch] text-sk-ink-2">Do these in order and your dashboard fills itself in.</p>
            </div>
            <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm self-start" disabled={setupGuideSaving} onClick={() => void toggleGuide(true)}>
              {setupGuideSaving ? "Saving..." : "Hide for now"}
            </button>
          </div>
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              { step: 1, title: "Check your team", body: "See which squad and event groups you coach.", links: [{ to: "/coach/teams", label: "Open teams" }] },
              { step: 2, title: "Invite your athletes", body: "Review the roster and send invite links to anyone missing.", links: [{ to: rosterHref, label: "Open roster" }] },
              {
                step: 3,
                title: "Build the first cycle",
                body: "Publish a training plan or set up a test week.",
                links: [
                  { to: "/coach/training-plan", label: "Training plans" },
                  { to: "/coach/test-week", label: "Test weeks" },
                ],
              },
            ].map((item) => (
              <li key={item.step} className="flex flex-col gap-3 rounded-2xl bg-white p-4">
                <span className="flex size-9 items-center justify-center rounded-full bg-sk-ink text-sm font-extrabold text-white">{item.step}</span>
                <div>
                  <p className="sk-h3">{item.title}</p>
                  <p className="mt-1 text-sm text-sk-mute">{item.body}</p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  {item.links.map((link) => (
                    <Link key={link.to} to={link.to} className="sk-btn sk-btn-quiet sk-btn-sm">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {coachNeedsGuide && setupGuideDismissedAt ? (
        <div className="flex flex-col gap-3 rounded-[20px] border border-sk-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-sk-ink">Setup is not finished yet.</p>
          <button type="button" className="sk-btn sk-btn-quiet sk-btn-sm" disabled={setupGuideSaving} onClick={() => void toggleGuide(false)}>
            {setupGuideSaving ? "Saving..." : "Show setup steps"}
          </button>
        </div>
      ) : null}

      <section aria-label="Today at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="blue" label="Plan adherence" value={adherenceAverage} unit="%" hint="Squad average" />
        <Stat tone="green" label="Ready to train" value={readinessSummary.green} hint={`of ${readinessTotal}`} />
        <Stat
          tone={alertRows.length > 0 ? "coral" : "plain"}
          label="Need a look"
          value={alertRows.length}
          hint={alertRows.length > 0 ? "Readiness or adherence" : "Nobody flagged"}
        />
        <Stat tone="yellow" label="PRs logged" value={prTotal} hint={prMomentum[0] ? `Most in ${prMomentum[0][0]}` : "None yet"} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel
          title="Who needs you"
          hint="Athletes flagged on readiness, or under 75% adherence."
          action={
            <Link to={rosterHref} className="sk-btn sk-btn-ghost sk-btn-sm">
              Full roster
              <ArrowRight className="size-4" weight="bold" />
            </Link>
          }
        >
          {alertRows.length > 0 ? (
            <ul>
              {alertRows.map((athlete) => (
                <li key={athlete.id}>
                  <Link
                    to={`/coach/athletes/${athlete.id}`}
                    className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-sk-line py-4 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_minmax(140px,200px)_auto]"
                  >
                    <Initials name={athlete.name} />
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-sk-ink group-hover:text-sk-blue">{athlete.name}</span>
                      <span className="block truncate text-sm text-sk-mute">{athlete.primaryEvent}</span>
                    </span>
                    <span className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto">
                      <span className="mb-1.5 flex items-baseline justify-between text-sm">
                        <span className="text-sk-mute">Adherence</span>
                        <span className="font-bold tabular-nums text-sk-ink">{athlete.adherence}%</span>
                      </span>
                      <Meter value={athlete.adherence} tone={scoreTone(athlete.adherence)} />
                    </span>
                    <ReadinessTag status={athlete.readiness} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<CheckCircle className="size-6" weight="fill" />}
              title="Nobody is flagged"
              body="When an athlete reports low readiness or falls behind on the plan, they show up here."
              className="border-0 bg-sk-canvas"
            />
          )}
        </Panel>

        <Panel title="Readiness" hint={readinessTrendValues.length > 0 ? `Squad average, last ${readinessTrendValues.length} check-ins` : undefined}>
          {readinessTrendValues.length > 0 ? (
            <>
              <p className="sk-num text-[3.5rem]">
                {latestReadiness}
                <span className="ml-1 text-base font-bold tracking-normal text-sk-mute">/ 100 latest</span>
              </p>
              <div className="mt-5 flex h-36 items-end gap-2" role="img" aria-label={`Readiness by check-in: ${readinessTrendValues.join(", ")}`}>
                {readinessTrendValues.map((value, index) => {
                  const isLatest = index === readinessTrendValues.length - 1
                  return (
                    <div key={trendDates[index]} className="flex h-full flex-1 flex-col justify-end gap-2">
                      <div
                        className={cn("flex items-start justify-center rounded-xl pt-2 text-xs font-bold", isLatest ? "bg-sk-blue text-white" : "bg-sk-blue-tint text-[#1638b8]")}
                        style={{ height: `${Math.max(value, 18)}%` }}
                      >
                        {value}
                      </div>
                      <p className={cn("text-center text-xs font-semibold", isLatest ? "text-sk-ink" : "text-sk-mute")}>{shortDay(trendDates[index])}</p>
                    </div>
                  )
                })}
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-sk-line pt-4 text-center">
                {[
                  { label: "Ready", value: readinessSummary.green, dot: "bg-sk-green" },
                  { label: "Watch", value: readinessSummary.yellow, dot: "bg-sk-yellow" },
                  { label: "Review", value: readinessSummary.red, dot: "bg-sk-coral" },
                ].map((item) => (
                  <div key={item.label}>
                    <dd className="sk-num text-2xl">{item.value}</dd>
                    <dt className="mt-1 inline-flex items-center gap-1.5 text-sm text-sk-mute">
                      <span className={cn("size-2 rounded-full", item.dot)} />
                      {item.label}
                    </dt>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <EmptyState
              title="No check-ins yet"
              body="Readiness appears once athletes start submitting their daily wellness check-in."
              className="border-0 bg-sk-canvas"
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel
          title="Readiness against training load"
          action={
            <div className="flex items-center gap-4 text-sm font-semibold text-sk-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1 w-4 rounded-full bg-sk-blue" /> Readiness
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1 w-4 rounded-full bg-sk-ink" /> Load
              </span>
            </div>
          }
        >
          {readinessTrendValues.length > 1 ? (
            <LineChart
              xAxis={[
                {
                  scaleType: "point",
                  data: trendDates.map((date) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
                },
              ]}
              yAxis={[{ min: 0, max: 100 }]}
              series={[
                { data: readinessTrendValues, label: "Readiness", color: "#2152ff", curve: "monotoneX" },
                { data: trainingLoadValues, label: "Training load", color: "#0e1320", curve: "monotoneX" },
              ]}
              grid={{ horizontal: true }}
              margin={{ left: 28, right: 16, top: 12, bottom: 24 }}
              height={240}
              hideLegend
              sx={chartSx}
            />
          ) : (
            <EmptyState
              title="Not enough history yet"
              body="This chart needs at least two days of wellness and session data."
              className="border-0 bg-sk-canvas"
            />
          )}
        </Panel>

        <Panel title="Adherence by athlete" hint="Share of planned sessions completed.">
          {adherenceRows.length > 0 ? (
            <ul className="space-y-4">
              {adherenceRows.map((athlete) => (
                <li key={athlete.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <Link to={`/coach/athletes/${athlete.id}`} className="truncate font-semibold text-sk-ink hover:text-sk-blue">
                      {athlete.name}
                    </Link>
                    <span className="font-bold tabular-nums text-sk-ink">{athlete.adherence}%</span>
                  </div>
                  <Meter value={athlete.adherence} tone={scoreTone(athlete.adherence)} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No athletes yet" body="Adherence shows up once athletes are on your roster and have a plan." className="border-0 bg-sk-canvas" />
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Panel title="Where the PRs are" hint={prTotal > 0 ? `${prTotal} logged in total` : undefined}>
          {prMomentum.length > 0 ? (
            <ul className="space-y-4">
              {prMomentum.map(([category, count]) => (
                <li key={category} className="grid grid-cols-[minmax(72px,auto)_minmax(0,1fr)_auto] items-center gap-3">
                  <span className="font-semibold text-sk-ink">{category}</span>
                  <span className="h-7 rounded-lg bg-sk-canvas">
                    <span className="block h-full rounded-lg bg-sk-yellow" style={{ width: `${Math.max((count / Math.max(prMomentum[0][1], 1)) * 100, 8)}%` }} />
                  </span>
                  <span className="sk-num w-6 text-right text-xl">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Trophy className="size-6" weight="fill" />}
              title="No PRs logged yet"
              body="Personal records land here by category as athletes hit them."
              className="border-0 bg-sk-canvas"
            />
          )}
        </Panel>

        <Panel
          title="Latest test results"
          action={
            <Link to="/coach/test-week" className="sk-btn sk-btn-ghost sk-btn-sm">
              Test weeks
              <ArrowRight className="size-4" weight="bold" />
            </Link>
          }
        >
          {scopedTests.length > 0 ? (
            <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr className="border-b border-sk-line text-sm text-sk-mute">
                    <th scope="col" className="py-2 pr-4 font-semibold">Athlete</th>
                    {["30m", "Flying 30m", "150m", "Squat 1RM", "CMJ"].map((label) => (
                      <th key={label} scope="col" className="px-2 py-2 text-right font-semibold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scopedTests.map((row) => (
                    <tr key={row.athleteId} className="border-b border-sk-line last:border-b-0">
                      <th scope="row" className="py-3.5 pr-4 font-bold text-sk-ink">
                        <Link to={`/coach/athletes/${row.athleteId}`} className="hover:text-sk-blue">{row.athleteName}</Link>
                      </th>
                      {[row.thirtyM, row.flyingThirtyM, row.oneHundredFiftyM, row.squat1RM, row.cmj].map((metric, index) => (
                        <td key={index} className="px-2 py-3.5 text-right">
                          <span className="inline-flex items-center justify-end gap-1 font-semibold tabular-nums text-sk-ink">
                            {metric?.value ?? <span className="text-sk-mute">n/a</span>}
                            {metric ? <Change change={metric.change} /> : null}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<Timer className="size-6" weight="fill" />}
              title="No test results yet"
              body="Publish a test week and results appear here as athletes submit them."
              action={
                <Link to="/coach/test-week" className="sk-btn sk-btn-ink sk-btn-sm">
                  Set up a test week
                </Link>
              }
              className="border-0 bg-sk-canvas"
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
