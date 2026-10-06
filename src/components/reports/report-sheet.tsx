import type { CSSProperties, ReactNode } from "react"
import { ClubMark, PrintSheet, SheetBars, SheetLine } from "@/components/sk"
import { reportDayText, reportRangeText, type AthleteReportSnapshot, type ReportClub } from "@/lib/data/reports/athlete-report"
import "./report-sheet.css"

/**
 * The athlete report as a sheet: the club, the athlete, the period, the coach, then the sections
 * that were ticked. `ReportSheet` shows it on screen (the live preview, a saved report, a shared
 * link) and `ReportPrintSheet` puts the same content on paper through the kit's PrintSheet.
 * Both draw only what is in the snapshot, so a saved report always looks the way it was saved.
 */

type HeadingTag = "h2" | "h3"

function Heading({ as: Tag, children, note }: { as: HeadingTag; children: ReactNode; note?: ReactNode }) {
  return (
    <Tag className="sk-report-h2">
      {children}
      {note ? <span>{note}</span> : null}
    </Tag>
  )
}

function Stats({ children }: { children: ReactNode }) {
  return <dl className="sk-report-stats">{children}</dl>
}

function StatItem({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="sk-report-stat">
      <dt>{label}</dt>
      <dd>
        <span className="sk-report-stat-value">{value}</span>
        {hint ? <span className="sk-report-stat-hint">{hint}</span> : null}
      </dd>
    </div>
  )
}

function Table({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <table className="sk-report-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((value, index) =>
              index === 0 ? (
                <th key={index} scope="row">
                  {value}
                </th>
              ) : (
                <td key={index} data-label={columns[index]}>
                  {value}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const percentText = (value: number | null) => (value === null ? "None" : `${value}%`)

const STANDING_TEXT = { "personal-best": "Personal best", "season-best": "Season best", "wind-assisted": "Wind assisted" } as const

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/** The sections of a report, in sheet order. Shared by the screen and the paper version. */
export function ReportBody({ snapshot, headingAs = "h2" }: { snapshot: AthleteReportSnapshot; headingAs?: HeadingTag }) {
  const { attendance, training, results, tests, goals, wellness, injuries } = snapshot
  const first = snapshot.athlete.name.split(" ")[0] || snapshot.athlete.name
  return (
    <>
      <section className="sk-report-section" data-report-section="summary">
        <Heading as={headingAs}>From {snapshot.coachName || "your coach"}</Heading>
        {snapshot.summary ? <p className="sk-report-summary">{snapshot.summary}</p> : <p className="sk-report-empty">No summary written yet.</p>}
      </section>

      {attendance ? (
        <section className="sk-report-section" data-report-section="attendance">
          <Heading as={headingAs}>Attendance and adherence</Heading>
          <Stats>
            <StatItem
              label="Plan adherence"
              value={percentText(attendance.adherence.percent)}
              hint={
                attendance.adherence.due > 0
                  ? `${attendance.adherence.done} of ${attendance.adherence.due} planned sessions done${attendance.adherence.excused > 0 ? `, ${attendance.adherence.excused} excused` : ""}`
                  : "No planned sessions were due"
              }
            />
            <StatItem
              label="Attendance"
              value={percentText(attendance.marks.percent)}
              hint={attendance.marks.counted > 0 ? `${attendance.marks.attended} of ${attendance.marks.counted} sessions attended` : "No attendance was taken"}
            />
            {attendance.marks.counted + attendance.marks.excused > 0 ? (
              <StatItem label="Late" value={attendance.marks.late} hint={`Absent ${attendance.marks.absent}, excused ${attendance.marks.excused}`} />
            ) : null}
          </Stats>
        </section>
      ) : null}

      {training ? (
        <section className="sk-report-section" data-report-section="training">
          <Heading as={headingAs} note={training.weeks.length > 1 ? "Sessions done each week" : undefined}>
            Training done
          </Heading>
          <Stats>
            <StatItem label="Sessions done" value={training.done} hint={training.planned > 0 ? `${training.planned} were planned` : "None were planned"} />
            <StatItem label="Weeks" value={training.weeks.length} hint={training.weeks.length > 0 ? `About ${Math.round((training.done / training.weeks.length) * 10) / 10} sessions a week` : undefined} />
            {training.minutes ? <StatItem label="Time" value={training.minutes >= 120 ? `${Math.round(training.minutes / 6) / 10}h` : `${training.minutes} min`} hint="Planned length of the sessions done" /> : null}
          </Stats>
          {training.weeks.length > 1 && training.weeks.some((week) => week.done > 0 || week.planned > 0) ? (
            <div className="sk-report-chart">
              <SheetBars
                bars={training.weeks.map((week) => ({ label: reportDayText(week.weekStart, false), value: week.done, of: week.planned }))}
                label={`Sessions done each week: ${training.weeks.map((week) => `week of ${reportDayText(week.weekStart, false)}, ${week.done} of ${week.planned} planned`).join("; ")}.`}
              />
              <p className="sk-report-note">Green is done, grey is what was planned. Weeks start on Monday.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {results ? (
        <section className="sk-report-section" data-report-section="results">
          <Heading as={headingAs} note={results.rows.length > 0 ? plural(results.rows.length + results.more, "result", "results") : undefined}>
            Results and bests
          </Heading>
          {results.rows.length > 0 ? (
            <>
              <Table
                caption={`Results of ${snapshot.athlete.name} in the period`}
                columns={["Event", "Mark", "Date", "On the day", "Season best", "All-time best"]}
                rows={results.rows.map((row) => [
                  <>
                    {row.event}
                    {row.where ? <span className="sk-report-sub">{row.where}</span> : null}
                  </>,
                  <strong>{row.mark}</strong>,
                  reportDayText(row.date),
                  row.standing ? <span className={row.standing === "wind-assisted" ? undefined : "sk-report-good"}>{STANDING_TEXT[row.standing]}</span> : null,
                  row.seasonBest,
                  row.personalBest,
                ])}
              />
              {results.more > 0 ? <p className="sk-report-note">And {plural(results.more, "more result", "more results")} in the period.</p> : null}
            </>
          ) : (
            <p className="sk-report-empty">No results in this period.</p>
          )}
        </section>
      ) : null}

      {tests ? (
        <section className="sk-report-section" data-report-section="tests">
          <Heading as={headingAs}>Test results</Heading>
          {tests.rows.length > 0 ? (
            <Table
              caption={`Test results of ${snapshot.athlete.name} in the period`}
              columns={["Test", "Result", "Date", "Last time", "Change"]}
              rows={tests.rows.map((row) => [
                row.name,
                <strong>{row.value}</strong>,
                reportDayText(row.date),
                row.previous ?? "First time",
                row.changeText ? <span className={row.change === "better" ? "sk-report-good" : row.change === "worse" ? "sk-report-watch" : undefined}>{row.changeText}</span> : null,
              ])}
            />
          ) : (
            <p className="sk-report-empty">No tests in this period.</p>
          )}
        </section>
      ) : null}

      {goals ? (
        <section className="sk-report-section" data-report-section="goals">
          <Heading as={headingAs}>Goals</Heading>
          {goals.rows.length > 0 ? (
            <Table
              caption={`Goals of ${snapshot.athlete.name}`}
              columns={["Goal", "Target", "Now", "Progress", "State"]}
              rows={goals.rows.map((row) => [
                <>
                  {row.event}
                  {row.targetDate ? <span className="sk-report-sub">By {reportDayText(row.targetDate)}</span> : null}
                </>,
                <strong>{row.target}</strong>,
                row.current ?? "No mark yet",
                <span className="sk-report-progress">
                  <span className="sk-report-meter" aria-hidden>
                    <i style={{ width: `${row.percent}%` }} />
                  </span>
                  {row.percent}%
                </span>,
                <span className={row.state === "achieved" ? "sk-report-good" : row.state === "past-date" ? "sk-report-watch" : undefined}>{row.stateLabel}</span>,
              ])}
            />
          ) : (
            <p className="sk-report-empty">No goals set.</p>
          )}
        </section>
      ) : null}

      {wellness ? (
        <section className="sk-report-section" data-report-section="wellness">
          <Heading as={headingAs} note="Health information">
            Wellness trend
          </Heading>
          {wellness.checkIns > 0 ? (
            <>
              <Stats>
                <StatItem label="Average readiness" value={wellness.averageReadiness ?? "None"} hint="Out of 100" />
                <StatItem label="Check-ins" value={wellness.checkIns} hint="Days with a check-in" />
                {wellness.averageSleep ? <StatItem label="Average sleep" value={`${wellness.averageSleep}h`} hint="A night" /> : null}
              </Stats>
              {wellness.points.length > 1 ? (
                <div className="sk-report-chart">
                  <SheetLine
                    values={wellness.points.map((point) => point.score)}
                    startLabel={reportDayText(wellness.points[0].date, false)}
                    endLabel={reportDayText(wellness.points[wellness.points.length - 1].date, false)}
                    label={`Readiness over ${wellness.points.length} check-ins, from ${wellness.points[0].score} to ${wellness.points[wellness.points.length - 1].score} out of 100.`}
                  />
                  <p className="sk-report-note">Readiness out of 100, from {first}'s own check-ins.</p>
                </div>
              ) : null}
            </>
          ) : (
            <p className="sk-report-empty">No check-ins in this period.</p>
          )}
        </section>
      ) : null}

      {injuries ? (
        <section className="sk-report-section" data-report-section="injuries">
          <Heading as={headingAs} note="Health information">
            Injury notes
          </Heading>
          {injuries.reports.length > 0 ? (
            <Table
              caption={`Pain and injury reports of ${snapshot.athlete.name}`}
              columns={["Where", "How bad", "Since", "Training", "Now"]}
              rows={injuries.reports.map((row) => [
                <>
                  {row.areas}
                  {row.note ? <span className="sk-report-sub">{row.note}</span> : null}
                </>,
                row.severity,
                reportDayText(row.since),
                row.impact,
                row.resolved ? "Resolved" : "Open",
              ])}
            />
          ) : (
            <p className="sk-report-empty">No pain or injury reported in this period.</p>
          )}
          {injuries.timeOut.length > 0 ? (
            <p className="sk-report-note">
              Time out: {injuries.timeOut.map((period) => `${period.kind.toLowerCase()} ${reportDayText(period.from, false)} ${period.to ? `to ${reportDayText(period.to, false)}` : "until further notice"}`).join("; ")}.
            </p>
          ) : null}
        </section>
      ) : null}

      <p className="sk-report-foot" data-report-foot>
        Numbers as they were on {reportDayText(snapshot.savedOn)}.{snapshot.club ? ` ${snapshot.club.name}.` : ""}
      </p>
    </>
  )
}

function Brand({ club }: { club: ReportClub }) {
  return (
    <div className="sk-report-brand" data-report-club style={{ "--sk-report-club": club.color } as CSSProperties}>
      <ClubMark name={club.name} shortName={club.shortName} color={club.color} logoUrl={club.logoUrl} size="md" />
      <span>{club.name}</span>
    </div>
  )
}

function metaLines(snapshot: AthleteReportSnapshot): string[] {
  return [
    [snapshot.athlete.teamName, snapshot.athlete.primaryEvent].filter(Boolean).join(", "),
    `Report for ${reportRangeText(snapshot.period)}`,
    snapshot.coachName ? `Coach: ${snapshot.coachName}` : "",
  ].filter(Boolean)
}

/**
 * The report on screen. `titleAs` is "h1" only where the sheet is the whole page (a shared link);
 * inside an app screen the screen already has its h1, so the name is a plain line.
 */
export function ReportSheet({ snapshot, titleAs = "p", headingAs = "h3" }: { snapshot: AthleteReportSnapshot; titleAs?: "h1" | "p"; headingAs?: HeadingTag }) {
  const Title = titleAs
  return (
    <article className="sk-report" data-report-sheet aria-label={`Report about ${snapshot.athlete.name}`}>
      {snapshot.club ? <Brand club={snapshot.club} /> : null}
      <Title className="sk-report-title">{snapshot.athlete.name}</Title>
      {metaLines(snapshot).map((line) => (
        <p key={line} className="sk-report-meta">
          {line}
        </p>
      ))}
      <ReportBody snapshot={snapshot} headingAs={headingAs} />
    </article>
  )
}

/**
 * The report on paper. Mount it on any screen that shows a report: printing from the browser
 * (or "Save as PDF") then gives this sheet and nothing else. Invisible on screen.
 */
export function ReportPrintSheet({ snapshot }: { snapshot: AthleteReportSnapshot }) {
  return (
    <PrintSheet title={snapshot.athlete.name} meta={metaLines(snapshot)} brand={snapshot.club ? <Brand club={snapshot.club} /> : undefined}>
      <div className="sk-report" data-report-print>
        <ReportBody snapshot={snapshot} headingAs="h2" />
      </div>
    </PrintSheet>
  )
}
