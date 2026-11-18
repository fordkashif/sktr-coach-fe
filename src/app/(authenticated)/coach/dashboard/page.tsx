import { clubToday, weekdayShortOf } from "@/lib/club-day"
import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, CheckSquare, Minus } from "@phosphor-icons/react"
import { Link } from "react-router-dom"
import { useCoachPermissions, useCoachTeamScope } from "@/lib/coach-teams"
import { PersonAvatar } from "@/components/account/person-avatar"
import {
  Button,
  Countdown,
  DataTable,
  EmptyState,
  HeroAction,
  LinkButton,
  List,
  ListRow,
  Notice,
  PersonTile,
  ReadinessText,
  Ring,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  Split,
  Stat,
  StatStrip,
  StatusDot,
  StatusText,
  TileGrid,
  WeekRail,
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
import { describeAvailability } from "@/lib/data/athlete/availability-data"
import { getCoachTodaySnapshot, type CoachTodaySnapshot, type TodaySessionRow } from "@/lib/data/coach/dashboard-today"
import { PAIN_SEVERITY_WORDS, bodyAreasSummary, painImpactLabel } from "@/lib/data/wellness/pain-report-types"
import { averageAdherence, NO_SESSIONS_DUE } from "@/lib/data/session/adherence"
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

/** The coach competitions screens (src/app/(authenticated)/coach/competitions). */
const COMPETITIONS_PATH = "/coach/competitions"

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function dayDate(isoDay: string) {
  return new Date(`${isoDay.slice(0, 10)}T00:00:00`)
}

/** "today", "tomorrow", "in 12 days". */
function daysUntil(isoDay: string, todayKey: string) {
  return Math.round((dayDate(isoDay).getTime() - dayDate(todayKey).getTime()) / 86_400_000)
}

/** The photo behind today's session (public/images/athlete, from Unsplash). */
const TODAY_PHOTO = "/images/athlete/race.webp"

function names(rows: TodaySessionRow[]) {
  return rows.map((row) => (row.reason ? `${row.name} (${row.reason})` : row.name)).join(", ")
}

/** Athletes who need a look come first, then by name. */
function byAttention(left: Athlete, right: Athlete) {
  const rank = (athlete: Athlete) => (athlete.readiness === "red" ? 0 : athlete.readiness === "yellow" ? 1 : athlete.adherence !== null && athlete.adherence < 75 ? 2 : 3)
  return rank(left) - rank(right) || left.name.localeCompare(right.name)
}

export default function CoachDashboardPage() {
  const { role, coachTeamId } = useCoachTeamScope()
  // One dashboard per team: switching team starts from a clean screen, never the last team's numbers.
  return <CoachDashboard key={coachTeamId ?? "all"} role={role} coachTeamId={coachTeamId} />
}

function CoachDashboard({ role, coachTeamId }: { role: string | null; coachTeamId: string | null }) {
  // An assistant coach sees and records, and does not plan, invite or (unless the team allows it) see health.
  const permissions = useCoachPermissions(coachTeamId)
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
  const todayKey = clubToday()
  // Availability, today's session, pain reports and the next competition. Null while loading.
  const [today, setToday] = useState<CoachTodaySnapshot | null>(null)

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

  // Loaded once the squad is known. Each part is optional: a failed read leaves that part empty.
  const todaySessionTitle = planWeek
    ? (planWeek.days.find((day) => (backendMode === "supabase" ? day.date === todayKey : day.dayLabel === weekdayShortOf(todayKey)))?.title ?? null)
    : null
  const squadKey = scopedAthletes.length > 0 ? JSON.stringify(scopedAthletes.map((athlete) => [athlete.id, athlete.name, athlete.adherence])) : ""
  const planReady = planWeek !== undefined
  useEffect(() => {
    if (!squadKey || !planReady) return
    let cancelled = false
    void getCoachTodaySnapshot({
      teamId: role === "coach" ? coachTeamId : null,
      todayKey,
      athletes: (JSON.parse(squadKey) as Array<[string, string, number | null]>).map(([id, name, adherence]) => ({ id, name, adherence })),
      mockSessionTitle: todaySessionTitle,
    }).then((result) => {
      if (!cancelled && result.ok) setToday(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [coachTeamId, planReady, role, squadKey, todayKey, todaySessionTitle])

  const sessionRows = today?.todaySession?.rows ?? []
  const sessionDone = sessionRows.filter((row) => row.state === "done")
  const sessionOpen = sessionRows.filter((row) => row.state === "not-done")
  const sessionSkipped = sessionRows.filter((row) => row.state === "skipped")
  const sessionExcused = sessionRows.filter((row) => row.state === "excused")
  // Attendance is taken per team: the coach's selected team, or the only team a club admin has.
  const attendanceTeamId = role === "coach" ? coachTeamId : sourceTeams.length === 1 ? sourceTeams[0].id : null

  const readyCount = scopedAthletes.filter((athlete) => athlete.readiness === "green").length
  const needLookCount = scopedAthletes.filter((athlete) => athlete.readiness !== "green" || (athlete.adherence !== null && athlete.adherence < 75)).length
  // Athletes with no sessions due have no figure and are left out of the average.
  const adherenceAverage = averageAdherence(scopedAthletes.map((athlete) => athlete.adherence))
  const athleteTotal = scopedAthletes.length

  const rosterHref = role === "coach" && coachTeamId ? `/coach/teams/${coachTeamId}` : "/coach/teams"
  const coachNeedsGuide =
    !permissions.isAssistant && backendMode === "supabase" && (sourceTeams.length === 0 || scopedAthletes.length === 0 || scopedTests.length === 0)

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
        ? permissions.canManageRoster
          ? "No athletes on your roster yet. Invite your squad to start seeing readiness and adherence here."
          : "No athletes on this team yet."
        : !permissions.canSeeHealth
          ? `${weekLine}${athleteTotal} ${athleteTotal === 1 ? "athlete" : "athletes"} on the team.`
        : needLookCount === 0
          ? `${weekLine}${athleteTotal} ${athleteTotal === 1 ? "athlete" : "athletes"}, all on track today.`
          : `${weekLine}${needLookCount} ${needLookCount === 1 ? "athlete needs" : "athletes need"} a look today.`


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
          permissions.canEditPlans ? (
            <>
              <LinkButton to="/coach/test-week">New test week</LinkButton>
              <LinkButton to="/coach/training-plan" variant="primary">
                Build a plan
              </LinkButton>
            </>
          ) : undefined
        }
      />

      {permissions.isAssistant ? (
        <p className="text-sm text-sk-mute" data-assistant-line>
          You are an assistant coach on this team.
        </p>
      ) : null}

      {backendError ? <Notice tone="error">Could not load the latest data: {backendError}</Notice> : null}

      {permissions.canSeeHealth && today && today.painReports.length > 0 ? (
        <Section title="Needs you" hint="Open pain reports that change training." meta={`${today.painReports.length} open`}>
          <List>
            {today.painReports.slice(0, 5).map((report) => (
              <ListRow
                key={report.id}
                to={`/coach/athletes/${report.athleteId}`}
                leading={<StatusDot tone="coral" />}
                title={report.athleteName}
                subtitle={`${bodyAreasSummary(report.bodyAreas)}, ${(PAIN_SEVERITY_WORDS[report.severity - 1] ?? "pain").toLowerCase()}. Since ${dayDate(report.startedOn).toLocaleDateString(undefined, { day: "numeric", month: "short" })}.`}
                trailing={<StatusText tone={report.trainingImpact === "cannot_train" ? "coral" : "amber"}>{painImpactLabel(report.trainingImpact)}</StatusText>}
              />
            ))}
          </List>
        </Section>
      ) : null}

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

      <section aria-labelledby="coach-today-heading" data-coach-today className="sk-hero-wrap">
        <img src={TODAY_PHOTO} alt="" aria-hidden className="sk-hero-photo" loading="eager" decoding="async" />
        <div className="sk-hero sk-hero-over">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="coach-today-heading" className="sk-hero-label">
              Today&apos;s session
            </h2>
            {planWeek ? <p className="sk-hero-label shrink-0">Week {planWeek.weekNumber} of {planWeek.totalWeeks}</p> : null}
          </div>
          {today === null && scopedAthletes.length > 0 ? (
            <SkeletonRows rows={2} label="Loading today's session" />
          ) : today?.todaySession ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
              <div className="min-w-0">
                <p className="sk-hero-title">{today.todaySession.title}</p>
                <ul className="mt-3 flex flex-col gap-1.5 text-[0.9375rem]" aria-label="Who has done it">
                  <li className="flex gap-2">
                    <span className="font-extrabold">Done</span>
                    <span className="min-w-0 opacity-90">{sessionDone.length > 0 ? names(sessionDone) : "Nobody yet"}</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-extrabold">Not yet</span>
                    <span className="min-w-0 opacity-90">{sessionOpen.length > 0 ? names(sessionOpen) : "Nobody left"}</span>
                  </li>
                  {sessionSkipped.length > 0 ? (
                    <li className="flex gap-2">
                      <span className="shrink-0 font-extrabold">Skipped</span>
                      <span className="min-w-0 opacity-90">{names(sessionSkipped)}</span>
                    </li>
                  ) : null}
                  {sessionExcused.length > 0 ? (
                    <li className="flex gap-2">
                      <span className="shrink-0 font-extrabold">Excused</span>
                      <span className="min-w-0 opacity-90">{names(sessionExcused)}</span>
                    </li>
                  ) : null}
                </ul>
              </div>
              <div className="flex items-center gap-4">
                <span className="shrink-0 rounded-full bg-white p-1.5">
                  <Ring progress={sessionDone.length + sessionOpen.length > 0 ? sessionDone.length / (sessionDone.length + sessionOpen.length) : 0} size={80}>
                    <span className="font-display text-[1.75rem] font-black leading-none text-sk-ink">
                      {sessionDone.length}
                      <span className="text-[1rem]">/{sessionDone.length + sessionOpen.length}</span>
                    </span>
                  </Ring>
                </span>
                {attendanceTeamId && scopedAthletes.length > 0 ? (
                  <span className="min-w-0 flex-1 lg:flex-none">
                    <HeroAction to={`/coach/teams/${attendanceTeamId}/attendance`}>
                      <CheckSquare className="size-[18px] shrink-0" weight="bold" aria-hidden />
                      Take attendance
                    </HeroAction>
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <p className="sk-hero-title">Rest day</p>
              <p className="sk-hero-body">No session planned today. A rest day, or the plan has nothing on this date.</p>
            </>
          )}
        </div>
      </section>

      <StatStrip aria-label="Today at a glance">
        {adherenceAverage === null ? (
          <Stat label="Plan adherence" value="None" hint={NO_SESSIONS_DUE} />
        ) : (
          <Stat label="Plan adherence" value={adherenceAverage} unit="%" />
        )}
        {permissions.canSeeHealth ? <Stat label="Ready to train" value={readyCount} of={athleteTotal} /> : null}
        {permissions.canSeeHealth ? <Stat label="Need a look" value={needLookCount} /> : <Stat label="Athletes" value={athleteTotal} />}
        <Stat label="Personal records" value={scopedPrs.length} />
      </StatStrip>

      <Section title="Athletes" action={<Link to={rosterHref} className="sk-link">Open roster</Link>}>
        {loading ? (
          <SkeletonRows rows={4} label="Loading athletes" />
        ) : scopedAthletes.length > 0 ? (
          <TileGrid label="Athletes on this team" wide className="mt-1">
            {scopedAthletes.map((athlete) => {
              const period = today?.availability[athlete.id]
              const needsLook = permissions.canSeeHealth && (athlete.readiness !== "green" || (athlete.adherence !== null && athlete.adherence < 75))
              return (
                <PersonTile
                  key={athlete.id}
                  to={`/coach/athletes/${athlete.id}`}
                  name={athlete.name}
                  detail={athlete.primaryEvent}
                  avatar={<PersonAvatar name={athlete.name} athleteId={athlete.id} size="md" />}
                  adherence={athlete.adherence}
                  flag={needsLook}
                  status={
                    permissions.canSeeHealth ? (
                      period ? <StatusText tone="amber">{sentenceCase(describeAvailability(period, todayKey))}</StatusText> : <ReadinessText status={athlete.readiness} />
                    ) : undefined
                  }
                  meta={permissions.canSeeHealth ? (athlete.lastWellness ? athlete.lastWellness : "No check-in") : undefined}
                />
              )
            })}
          </TileGrid>
        ) : (
          <EmptyState
            title="No athletes yet"
            body={permissions.canManageRoster ? "Readiness and adherence show up here once athletes are on your roster." : "Athletes show up here once the lead coach has added them to the team."}
            action={
              permissions.canManageRoster ? (
                <LinkButton to={rosterHref} size="sm">
                  Invite athletes
                </LinkButton>
              ) : undefined
            }
          />
        )}
      </Section>

      <Section title="This week's plan" action={permissions.canEditPlans ? <Link to="/coach/training-plan/calendar" className="sk-link">Calendar</Link> : undefined}>
        {planWeek === undefined ? (
          <SkeletonRows rows={2} label="Loading this week's plan" />
        ) : planWeek && planWeek.days.length > 0 ? (
          <WeekRail
            label="This week's sessions"
            className="mt-1"
            days={planWeek.days.map((day) => {
              const isToday = backendMode === "supabase" ? day.date === todayKey : day.dayLabel === weekdayShortOf(todayKey)
              return { key: day.id, day: day.dayLabel, title: day.title, detail: day.summary, today: isToday }
            })}
          />
        ) : (
          <EmptyState
            title="No plan this week"
            body={permissions.canEditPlans ? "Publish a training plan and the week's sessions are listed here." : "Once the lead coach publishes a plan, the week's sessions are listed here."}
            action={
              permissions.canEditPlans ? (
                <LinkButton to="/coach/training-plan" size="sm">
                  Open plans
                </LinkButton>
              ) : undefined
            }
          />
        )}
      </Section>

      <Split
        main={
          <Section title="Latest test results" action={<Link to="/coach/test-week" className="sk-link">Test weeks</Link>}>
            {loading ? (
              <SkeletonRows rows={3} label="Loading test results" />
            ) : scopedTests.length > 0 ? (
              <DataTable caption="Latest test results by athlete" columns={testColumns} rows={scopedTests} rowKey={(row) => row.athleteId} />
            ) : (
              <EmptyState title="No test results yet" body="Publish a test week and results appear here as athletes submit them." />
            )}
          </Section>
        }
        side={
          permissions.canEditAthleteRecords && today?.nextCompetition ? (
            <Section title="Next competition" action={<Link to={COMPETITIONS_PATH} className="sk-link">All competitions</Link>}>
              <Link to={`${COMPETITIONS_PATH}/${today.nextCompetition.id}`} className="sk-tile mt-1 flex flex-col gap-3 p-5" data-next-competition>
                <Countdown days={daysUntil(today.nextCompetition.startDate, todayKey)} />
                <span>
                  <span className="block text-lg font-bold leading-tight text-sk-ink">{today.nextCompetition.name}</span>
                  <span className="block text-sm text-sk-mute">
                    {sentenceCase(
                      [
                        dayDate(today.nextCompetition.startDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
                        today.nextCompetition.venue,
                        today.nextCompetition.enteredCount > 0 ? `${today.nextCompetition.enteredCount} entered` : "nobody entered yet",
                      ]
                        .filter(Boolean)
                        .join(", "),
                    )}
                  </span>
                </span>
              </Link>
            </Section>
          ) : (
            <Section title="Next competition" action={<Link to={COMPETITIONS_PATH} className="sk-link">All competitions</Link>}>
              <EmptyState title="Nothing on the calendar" body="Meets you enter your athletes in show up here with a countdown." />
            </Section>
          )
        }
      />
    </Screen>
  )
}
