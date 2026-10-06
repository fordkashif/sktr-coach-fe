import { Printer } from "@phosphor-icons/react"
import { useState } from "react"
import { Button, Dialog, Field, PrintHeading, PrintSheet, PrintTable, Segmented, Select, printPage } from "@/components/sk"
import { PrintClubBrand } from "@/components/club/club-brand"
import {
  formatDateRange,
  formatDayMonth,
  getSession,
  planEndDate,
  slotDate,
  summarizeExercise,
  weekSessions,
  weekdayLabel,
  type PlanDraft,
  type SessionDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import type { Squad } from "@/lib/data/coach/squads"
import { assignedAthletes, type AthleteOption, type TeamOption } from "./storage"
import { plural } from "./ui"
import { viewTarget } from "@/lib/units-view"

type Scope = "week" | "plan"

function SessionCell({ session }: { session: SessionDraft }) {
  const facts = [session.sessionType, session.durationMinutes ? `${session.durationMinutes} min` : null, session.location.trim() || null].filter(Boolean).join(", ")
  return (
    <>
      <strong>{session.title.trim() || "Session"}</strong>
      <br />
      {facts}
    </>
  )
}

function DetailCell({ session }: { session: SessionDraft }) {
  return (
    <>
      {session.blocks.map((block, index) => {
        // Loads are printed in the unit of the coach who prints the sheet.
        const lines = [block.notes.trim(), ...block.exercises.map((exercise) => viewTarget(summarizeExercise(exercise)))].filter(Boolean)
        return (
          <p key={block.id} style={index > 0 ? { marginTop: "1.2mm" } : undefined}>
            <strong>{block.title.trim() || `Block ${index + 1}`}</strong>
            {lines.length > 0 ? `: ${lines.join("; ")}` : ""}
          </p>
        )
      })}
      {session.notes.trim() ? <p style={{ marginTop: session.blocks.length > 0 ? "1.2mm" : undefined, fontStyle: "italic" }}>Note: {session.notes.trim()}</p> : null}
    </>
  )
}

/** The plan on paper: one table per week, a row per day. */
export function PlanPrintSheet({
  plan,
  team,
  weeks,
  athleteNames,
}: {
  plan: PlanDraft
  team: TeamOption | null
  weeks: number[]
  /** Printed under the title when given. */
  athleteNames: string[] | null
}) {
  const whole = weeks.length === plan.weeks && plan.weeks > 1
  return (
    <PrintSheet
      brand={<PrintClubBrand />}
      title={plan.name || "Training plan"}
      meta={[
        [team?.name, whole ? `${plural(plan.weeks, "week")}, ${formatDateRange(plan.startDate, planEndDate(plan))}` : null].filter(Boolean).join(", "),
        athleteNames && athleteNames.length > 0 ? `For: ${athleteNames.join(", ")}` : null,
        plan.notes.trim() || null,
      ]}
    >
      {weeks.map((week) => (
        <section key={week} data-print-week={week}>
          <PrintHeading note={[formatDateRange(slotDate(plan, week, 0), slotDate(plan, week, 6)), plan.weekFocus[String(week)]?.trim()].filter(Boolean).join(", ")}>
            Week {week} of {plan.weeks}
          </PrintHeading>
          <PrintTable
            columns={["Day", "Session", "What to do"]}
            widths={["16%", "28%", undefined]}
            rows={[0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
              const date = slotDate(plan, week, dayIndex)
              const session = getSession(plan, week, dayIndex)
              return [
                `${weekdayLabel(date)} ${formatDayMonth(date)}`,
                session ? <SessionCell key="s" session={session} /> : "Rest",
                session ? <DetailCell key="d" session={session} /> : "",
              ]
            })}
          />
        </section>
      ))}
    </PrintSheet>
  )
}

/**
 * "Print" for a plan: choose one week or the whole plan, with or without the athletes' names,
 * then the browser's print dialog opens (which is also how it is saved as a PDF).
 */
export function PlanPrintDialog({
  plan,
  team,
  athletes,
  squads,
  initialWeek,
  onClose,
}: {
  plan: PlanDraft
  team: TeamOption | null
  athletes: AthleteOption[]
  squads?: Squad[]
  initialWeek: number
  onClose: () => void
}) {
  const [scope, setScope] = useState<Scope>(plan.weeks > 1 ? "week" : "plan")
  const [week, setWeek] = useState(Math.min(Math.max(1, initialWeek), plan.weeks))
  const [withNames, setWithNames] = useState(false)
  const [printing, setPrinting] = useState(false)
  const recipients = assignedAthletes(plan, athletes, squads)
  const weeks = scope === "week" ? [week] : Array.from({ length: plan.weeks }, (_, index) => index + 1)
  const sessionCount = weeks.reduce((sum, item) => sum + weekSessions(plan, item).length, 0)

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title="Print plan"
        description={`${plan.name || "Untitled plan"}. The print dialog also lets you save it as a PDF.`}
        footer={
          <>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setPrinting(true)
                printPage(() => setPrinting(false))
              }}
            >
              <Printer className="size-5" weight="bold" aria-hidden />
              Print
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {plan.weeks > 1 ? (
            <Segmented<Scope>
              label="What to print"
              className="self-start"
              value={scope}
              onChange={setScope}
              options={[
                { value: "week", label: "One week" },
                { value: "plan", label: `Whole plan (${plan.weeks} weeks)` },
              ]}
            />
          ) : null}
          {scope === "week" && plan.weeks > 1 ? (
            <Field label="Week">
              <Select value={week} onChange={(event) => setWeek(Number(event.target.value))}>
                {Array.from({ length: plan.weeks }, (_, index) => index + 1).map((item) => (
                  <option key={item} value={item}>
                    Week {item}, {formatDateRange(slotDate(plan, item, 0), slotDate(plan, item, 6))}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.9375rem] font-semibold text-sk-ink">
            <input type="checkbox" className="size-5 shrink-0 accent-sk-blue" checked={withNames} onChange={(event) => setWithNames(event.target.checked)} />
            <span>
              Include athlete names
              <span className="block text-sm font-normal text-sk-mute">
                {recipients.length > 0 ? `${plural(recipients.length, "athlete")} this plan goes to.` : "Nobody is assigned yet, so there are no names to add."}
              </span>
            </span>
          </label>
          <p className="text-sm text-sk-mute" aria-live="polite">
            {sessionCount === 0 ? "There are no sessions here yet. Every day prints as a rest day." : `${plural(sessionCount, "session")} on ${plural(weeks.length, "page section", "page sections")}.`}
          </p>
        </div>
      </Dialog>
      {printing ? <PlanPrintSheet plan={plan} team={team} weeks={weeks} athleteNames={withNames ? recipients.map((athlete) => athlete.name) : null} /> : null}
    </>
  )
}
