import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Minus } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { useCoachTeamScope } from "@/lib/coach-teams"
import {
  Button,
  DataTable,
  EmptyState,
  LinkButton,
  List,
  ListRow,
  Notice,
  ReadinessText,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  Split,
  Stat,
  StatStrip,
  TableSub,
  type DataTableColumn,
} from "@/components/sk"
import type { Athlete, PR, Team, TestWeekResult } from "@/lib/mock-data"
import {
  getCoachDashboardSnapshotForCurrentUser,
  peekCachedCoachDashboardSnapshot,
  type CoachDashboardSnapshot,
} from "@/lib/data/coach/dashboard-data"
import {
  getCurrentCoachOnboardingState,
  setCurrentCoachSetupGuideDismissed,
} from "@/lib/data/coach/invite-claim-data"
import { getCurrentPlanWeekForCoachTeam, pickTeamPlanWeek, type TeamPlanWeek } from "@/lib/data/training-plan/training-plan-data"
import { dateKeyLocal } from "@/lib/athlete-session"
import { getBackendMode } from "@/lib/supabase/config"

const TEST_COLUMNS: Array<{ header: string; pick: (row: TestWeekResult) => TestWeekResult["thirtyM"] }> = [
  { header: "30m", pick: (row) => row.thirtyM },
  { header: "Flying 30m", pick: (row) => row.flyingThirtyM },
  { header: "150m", pick: (row) => row.oneHundredFiftyM },
  { header: "Squat 1RM", pick: (row) => row.squat1RM },
  { header: "CMJ", pick: (row) => row.cmj },
]

function Change({ change }: { change: "up" | "down" | "same" }) {
  if (change === "up") return <ArrowUp className="size-4 text-sk-green" weight="bold" aria-label="Improved" />
  if (change === "down") return <ArrowDown className="size-4 text-sk-coral" weight="bold" aria-label="Dropped" />
  return <Minus className="size-4 text-sk-mute" weight="bold" aria-label="No change" />
}

/** Athletes who need a look come first, then by name. */
function byAttention(left: Athlete, right: Athlete) {
  const rank = (athlete: Athlete) => (athlete.readiness === "red" ? 0 : athlete.readiness === "yellow" ? 1 : athlete.adherence < 75 ? 2 : 3)
  return rank(left) - rank(right) || left.name.localeCompare(right.name)
}

export default function CoachDashboardPage() {
  const { role, coachTeamId } = useCoachTeamScope()
  // One dashboard per team: switching team starts from a clean screen, never the last team's numbers.
  return <CoachDashboard key={coachTeamId ?? "all"} role={role} coachTeamId={coachTeamId} />
}

function CoachDashboard({ role, coachTeamId }: { role: string | null; coachTeamId: string | null }) {
  const backendMode = getBackendMode()
  const [backendSnapshot, setBackendSnapshot] = useState<CoachDashboardSnapshot | null>(() =>
    backendMode === "supabase" ? peekCachedCoachDashboardSnapshot(role === "coach" ? coachTeamId : null) : null,
  )
  const [backendError, setBackendError] = useState<string | null>(null)
  const [setupGuideDismissedAt, setSetupGuideDismissedAt] = useState<string | null>(null)
  const [setupGuideSaving, setSetupGuideSaving] = useState(false)
  const [mockData, setMockData] = useState<{
    athletes: Athlete[]
    prs: PR[]
    teams: Team[]
    tests: TestWeekResult[]
  } | null>(null)
  // undefined while loading, null when no published plan covers this week.
  const [planWeek, setPlanWeek] = useState<TeamPlanWeek | null | undefined>(undefined)
  const todayKey = dateKeyLocal(new Date())

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

    const loadPlanWeek = async () => {
      const result = await getCurrentPlanWeekForCoachTeam({ scopeTeamId: role === "coach" ? coachTeamId : null, todayKey })
      if (cancelled) return
      // The plan list is secondary: if it fails the column says there is no plan, the rest still works.
      setPlanWeek(result.ok ? result.data : null)
    }

    void loadSnapshot()
    void loadPlanWeek()
    return () => {
      cancelled = true
    }
  }, [backendMode, coachTeamId, role, todayKey])

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
        })
        // Demo data: the team's plan, on the week marked current.
        const plan = module.mockTrainingPlans.find((item) => (coachTeamId ? item.teamId === coachTeamId : true))
        const detail = plan ? module.mockAthleteTrainingPlanDetails.find((item) => item.planId === plan.id) : undefined
        setPlanWeek(plan && detail ? pickTeamPlanWeek(plan, detail.weeks, todayKey, true) : null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [backendMode, coachTeamId, todayKey])

  const loading = backendMode === "supabase" ? backendSnapshot === null && !backendError : mockData === null
  const sourceAthletes = (backendMode === "supabase" ? backendSnapshot?.athletes : mockData?.athletes) ?? []
  const sourcePrs = (backendMode === "supabase" ? backendSnapshot?.prs : mockData?.prs) ?? []
  const sourceTests = (backendMode === "supabase" ? backendSnapshot?.tests : mockData?.tests) ?? []
  const sourceTeams = (backendMode === "supabase" ? backendSnapshot?.teams : mockData?.teams) ?? []

  const scopedAthletes = (
    role === "coach" && coachTeamId ? sourceAthletes.filter((athlete) => athlete.teamId === coachTeamId) : sourceAthletes
  )
    .slice()
    .sort(byAttention)
  const athleteIds = new Set(scopedAthletes.map((athlete) => athlete.id))
  const scopedPrs = sourcePrs.filter((pr) => athleteIds.has(pr.athleteId))
  const scopedTests = sourceTests.filter((row) => athleteIds.has(row.athleteId))
  const scopedTeam = sourceTeams.find((team) => team.id === coachTeamId)

  const readyCount = scopedAthletes.filter((athlete) => athlete.readiness === "green").length
  const needLookCount = scopedAthletes.filter((athlete) => athlete.readiness !== "green" || athlete.adherence < 75).length
  const adherenceAverage =
    scopedAthletes.length > 0
      ? Math.round(scopedAthletes.reduce((sum, athlete) => sum + athlete.adherence, 0) / scopedAthletes.length)
      : 0
  const athleteTotal = scopedAthletes.length

  const rosterHref = role === "coach" && coachTeamId ? `/coach/teams/${coachTeamId}` : "/coach/teams"
  const coachNeedsGuide =
    backendMode === "supabase" && (sourceTeams.length === 0 || scopedAthletes.length === 0 || scopedTests.length === 0)

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
  const weekLine = planWeek ? `Week ${planWeek.weekNumber} of ${planWeek.totalWeeks}${planWeek.emphasis ? `, ${planWeek.emphasis.toLowerCase()}` : ""}. ` : ""
  const lede = coachHasNoTeam
    ? "You are not assigned to a team yet. Ask a club admin to add you to one, then your roster, readiness and adherence show up here."
    : loading
      ? "Getting your squad..."
      : athleteTotal === 0
        ? "No athletes on your roster yet. Invite your squad to start seeing readiness and adherence here."
        : needLookCount === 0
          ? `${weekLine}${athleteTotal} ${athleteTotal === 1 ? "athlete" : "athletes"}, all on track today.`
          : `${weekLine}${needLookCount} ${needLookCount === 1 ? "athlete needs" : "athletes need"} a look today.`

  const athleteColumns: Array<DataTableColumn<Athlete>> = [
    {
      key: "athlete",
      header: "Athlete",
      cell: (athlete) => (
        <Link to={`/coach/athletes/${athlete.id}`} className="hover:text-sk-blue-link">
          {athlete.name}
          <TableSub>{athlete.primaryEvent}</TableSub>
        </Link>
      ),
    },
    { key: "readiness", header: "Readiness", phone: "plain", cell: (athlete) => <ReadinessText status={athlete.readiness} /> },
    { key: "checkin", header: "Last check-in", phone: "hide", cell: (athlete) => athlete.lastWellness || "None yet" },
    { key: "adherence", header: "Adherence", align: "right", strong: true, phone: "trailing", cell: (athlete) => `${athlete.adherence}%` },
  ]

  const testColumns: Array<DataTableColumn<TestWeekResult>> = [
    {
      key: "athlete",
      header: "Athlete",
      cell: (row) => (
        <Link to={`/coach/athletes/${row.athleteId}`} className="hover:text-sk-blue-link">
          {row.athleteName}
        </Link>
      ),
    },
    ...TEST_COLUMNS.map((column) => ({
      key: column.header,
      header: column.header,
      align: "right" as const,
      cell: (row: TestWeekResult) => {
        const metric = column.pick(row)
        return metric ? (
          <span className="inline-flex items-center gap-1 font-semibold text-sk-ink">
            {metric.value}
            <Change change={metric.change} />
          </span>
        ) : (
          "n/a"
        )
      },
    })),
  ]

  return (
    <Screen>
      <ScreenHeader
        title={scopedTeam?.name ?? "Your squad"}
        lede={lede}
        actions={
          <>
            <LinkButton to="/coach/test-week">New test week</LinkButton>
            <LinkButton to="/coach/training-plan" variant="primary">
              Build a plan
            </LinkButton>
          </>
        }
      />

      {backendError ? <Notice tone="error">Could not load the latest data: {backendError}</Notice> : null}

      {coachNeedsGuide && !setupGuideDismissedAt ? (
        <Section
          title="Get set up in three steps"
          hint="Do these in order and your dashboard fills itself in."
          action={
            <Button variant="quiet" size="sm" disabled={setupGuideSaving} onClick={() => void toggleGuide(true)}>
              {setupGuideSaving ? "Saving..." : "Hide for now"}
            </Button>
          }
        >
          <List ordered>
            {[
              { to: "/coach/teams", title: "Check your team", body: "See which squad and event groups you coach." },
              { to: rosterHref, title: "Invite your athletes", body: "Review the roster and send invite links to anyone missing." },
              { to: "/coach/training-plan", title: "Build the first cycle", body: "Publish a training plan, or set up a test week from Test weeks." },
            ].map((step, index) => (
              <ListRow key={step.title} to={step.to} leading={<span className="w-5 text-center font-bold text-sk-blue-link">{index + 1}</span>} title={step.title} subtitle={step.body} />
            ))}
          </List>
        </Section>
      ) : null}

      {coachNeedsGuide && setupGuideDismissedAt ? (
        <Notice
          action={
            <Button variant="quiet" size="sm" disabled={setupGuideSaving} onClick={() => void toggleGuide(false)}>
              {setupGuideSaving ? "Saving..." : "Show setup steps"}
            </Button>
          }
        >
          Setup is not finished yet.
        </Notice>
      ) : null}

      <StatStrip aria-label="Today at a glance">
        <Stat label="Plan adherence" value={adherenceAverage} unit="%" />
        <Stat label="Ready to train" value={readyCount} of={athleteTotal} />
        <Stat label="Need a look" value={needLookCount} />
        <Stat label="Personal records" value={scopedPrs.length} />
      </StatStrip>

      <Split
        main={
          <Section title="Athletes" action={<Link to={rosterHref} className="sk-link">Open roster</Link>}>
            {loading ? (
              <SkeletonRows rows={4} label="Loading athletes" />
            ) : scopedAthletes.length > 0 ? (
              <DataTable caption="Athletes on this team" columns={athleteColumns} rows={scopedAthletes} rowKey={(athlete) => athlete.id} />
            ) : (
              <EmptyState
                title="No athletes yet"
                body="Readiness and adherence show up here once athletes are on your roster."
                action={
                  <LinkButton to={rosterHref} size="sm">
                    Invite athletes
                  </LinkButton>
                }
              />
            )}
          </Section>
        }
        side={
          <Section title="This week's plan">
            {planWeek === undefined ? (
              <SkeletonRows rows={4} label="Loading this week's plan" />
            ) : planWeek && planWeek.days.length > 0 ? (
              <List>
                {planWeek.days.map((day) => {
                  const isToday = backendMode === "supabase" ? day.date === todayKey : day.dayLabel === new Date().toLocaleDateString("en-GB", { weekday: "short" })
                  return (
                    <ListRow
                      key={day.id}
                      className="items-start"
                      aria-current={isToday ? "date" : undefined}
                      leading={<span className={isToday ? "w-10 text-left font-bold text-sk-blue" : "w-10 text-left font-bold text-sk-mute"}>{day.dayLabel}</span>}
                      title={<span className="font-bold">{day.title}</span>}
                      subtitle={isToday && day.summary ? `Today. ${day.summary}` : isToday ? "Today" : day.summary}
                    />
                  )
                })}
              </List>
            ) : (
              <EmptyState
                title="No plan this week"
                body="Publish a training plan and the week's sessions are listed here."
                action={
                  <LinkButton to="/coach/training-plan" size="sm">
                    Open plans
                  </LinkButton>
                }
              />
            )}
          </Section>
        }
      />

      <Section title="Latest test results" action={<Link to="/coach/test-week" className="sk-link">Test weeks</Link>}>
        {loading ? (
          <SkeletonRows rows={3} label="Loading test results" />
        ) : scopedTests.length > 0 ? (
          <DataTable caption="Latest test results by athlete" columns={testColumns} rows={scopedTests} rowKey={(row) => row.athleteId} />
        ) : (
          <EmptyState title="No test results yet" body="Publish a test week and results appear here as athletes submit them." />
        )}
      </Section>
    </Screen>
  )
}
