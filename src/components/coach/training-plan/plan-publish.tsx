import { ArrowLeft, CheckCircle, MagnifyingGlass, PaperPlaneTilt } from "@phosphor-icons/react"
import { useState } from "react"
import { Initials, PageHeader, Panel, Segmented, Tag } from "@/components/sk"
import {
  EVENT_GROUPS,
  formatDateRange,
  formatDayMonth,
  planEndDate,
  slotDate,
  todayIso,
  validateForPublish,
  weekSessions,
  type AssignTarget,
  type PlanDraft,
} from "@/lib/data/training-plan/plan-builder-model"
import type { EventGroup } from "@/lib/mock-data"
import { countAssignedAthletes, type AthleteOption, type TeamOption } from "./storage"
import { ErrorNote, Field, STICKY_PAGE, StickyBar, plural } from "./ui"

export function PlanPublish({
  plan,
  teams,
  athletes,
  busy,
  error,
  onChange,
  onBack,
  onPublish,
}: {
  plan: PlanDraft
  teams: TeamOption[]
  athletes: AthleteOption[]
  busy: boolean
  error: string | null
  onChange: (updater: (plan: PlanDraft) => PlanDraft) => void
  onBack: () => void
  onPublish: () => void
}) {
  const [search, setSearch] = useState("")
  const team = teams.find((candidate) => candidate.id === plan.teamId) ?? null
  const teamAthletes = athletes.filter((athlete) => athlete.teamId === plan.teamId)
  const assignedCount = countAssignedAthletes(plan, athletes)
  const blocker = validateForPublish(plan, assignedCount)
  const isUpdate = plan.status === "published"
  const groupsInTeam = EVENT_GROUPS.filter((group) => teamAthletes.some((athlete) => athlete.eventGroup === group.value))
  const filteredAthletes = teamAthletes.filter((athlete) => athlete.name.toLowerCase().includes(search.trim().toLowerCase()))
  const selected = new Set(plan.assign.athleteIds)

  const setAssign = (patch: Partial<PlanDraft["assign"]>) => onChange((current) => ({ ...current, assign: { ...current.assign, ...patch } }))

  const setTarget = (target: AssignTarget) =>
    setAssign({
      target,
      subgroup: target === "subgroup" ? (plan.assign.subgroup ?? groupsInTeam[0]?.value ?? team?.eventGroup ?? null) : plan.assign.subgroup,
    })

  const toggleAthlete = (athleteId: string) =>
    setAssign({
      athleteIds: selected.has(athleteId) ? plan.assign.athleteIds.filter((id) => id !== athleteId) : [...plan.assign.athleteIds, athleteId],
    })

  return (
    <div className={STICKY_PAGE}>
      <button type="button" className="sk-btn sk-btn-ghost sk-btn-sm -ml-3 hidden self-start lg:inline-flex" onClick={onBack}>
        <ArrowLeft className="size-4" weight="bold" />
        Back to the week planner
      </button>

      <PageHeader
        title={isUpdate ? "Update plan" : "Publish plan"}
        lede={`${plan.name || "Untitled plan"}, ${formatDateRange(plan.startDate, planEndDate(plan))}.`}
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Who gets it" hint={team ? `${team.name} has ${plural(teamAthletes.length, "athlete")}.` : "Choose a team in plan details first."}>
            <Segmented<AssignTarget>
              label="Assign to"
              value={plan.assign.target}
              onChange={setTarget}
              options={[
                { value: "team", label: "Whole team" },
                { value: "subgroup", label: "Event group" },
                { value: "selected", label: "Athletes" },
              ]}
              className="max-w-full overflow-x-auto [&_.sk-seg-item]:whitespace-nowrap [&_.sk-seg-item]:px-3 sm:[&_.sk-seg-item]:px-4"
            />

            {plan.assign.target === "subgroup" ? (
              <Field label="Event group" className="mt-4 max-w-xs">
                <select
                  className="sk-field"
                  value={plan.assign.subgroup ?? ""}
                  onChange={(event) => setAssign({ subgroup: (event.target.value || null) as EventGroup | null })}
                >
                  {EVENT_GROUPS.map((group) => (
                    <option key={group.value} value={group.value}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {plan.assign.target === "selected" ? (
              <div className="mt-4">
                {teamAthletes.length > 8 ? (
                  <div className="relative mb-2 max-w-sm">
                    <MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-sk-mute" weight="bold" />
                    <input
                      className="sk-field pl-10"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Find an athlete"
                      aria-label="Find an athlete"
                    />
                  </div>
                ) : null}
                {teamAthletes.length === 0 ? (
                  <p className="text-sm text-sk-mute">This team has no athletes yet. Invite them from the team page first.</p>
                ) : (
                  <ul className="max-h-[360px] overflow-y-auto">
                    {filteredAthletes.map((athlete) => (
                      <li key={athlete.id} className="border-b border-sk-line last:border-b-0">
                        <label className="flex min-h-[52px] cursor-pointer items-center gap-3 py-2">
                          <input
                            type="checkbox"
                            className="size-5 shrink-0 accent-[#2152ff]"
                            checked={selected.has(athlete.id)}
                            onChange={() => toggleAthlete(athlete.id)}
                          />
                          <Initials name={athlete.name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-sk-ink">{athlete.name}</span>
                            <span className="block truncate text-sm text-sk-mute">{athlete.primaryEvent}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </Panel>

          <Panel title="When they see it">
            <Segmented<"immediate" | "scheduled">
              label="Visibility"
              value={plan.assign.visibilityStart}
              onChange={(visibilityStart) =>
                setAssign({
                  visibilityStart,
                  visibilityDate: visibilityStart === "scheduled" ? (plan.assign.visibilityDate ?? todayIso()) : plan.assign.visibilityDate,
                })
              }
              options={[
                { value: "immediate", label: "Right away" },
                { value: "scheduled", label: "From a date" },
              ]}
            />
            {plan.assign.visibilityStart === "scheduled" ? (
              <Field label="Visible from" className="mt-4 max-w-xs">
                <input
                  type="date"
                  className="sk-field"
                  value={plan.assign.visibilityDate ?? ""}
                  onChange={(event) => setAssign({ visibilityDate: event.target.value || null })}
                />
              </Field>
            ) : (
              <p className="mt-3 text-sm text-sk-mute">Athletes are notified as soon as you publish.</p>
            )}
          </Panel>
        </div>

        <Panel title="What is in it" hint={`${plural(plan.sessions.length, "session")} over ${plural(plan.weeks, "week")}`}>
          <ul>
            {Array.from({ length: plan.weeks }, (_, index) => index + 1).map((week) => {
              const sessions = weekSessions(plan, week)
              return (
                <li key={week} className="sk-row">
                  <span className="min-w-0">
                    <span className="block font-bold text-sk-ink">Week {week}</span>
                    <span className="block truncate text-sm text-sk-mute">
                      {plan.weekFocus[String(week)] || formatDateRange(slotDate(plan, week, 0), slotDate(plan, week, 6))}
                    </span>
                  </span>
                  {sessions.length === 0 ? (
                    <Tag tone="yellow">No sessions</Tag>
                  ) : (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-sk-ink-2">{plural(sessions.length, "session")}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      </div>

      <StickyBar status={blocker ?? (isUpdate ? "Athletes already on this plan are not notified again." : null)}>
        <button type="button" className="sk-btn sk-btn-quiet" onClick={onBack} disabled={busy}>
          Back to build
        </button>
        <button type="button" className="sk-btn sk-btn-primary" onClick={onPublish} disabled={busy || Boolean(blocker)}>
          <PaperPlaneTilt className="size-5" weight="bold" />
          {busy ? "Publishing..." : isUpdate ? `Save for ${plural(assignedCount, "athlete")}` : `Publish to ${plural(assignedCount, "athlete")}`}
        </button>
      </StickyBar>
    </div>
  )
}

export function PlanPublished({
  plan,
  count,
  wasUpdate,
  onBackToList,
  onKeepEditing,
}: {
  plan: PlanDraft
  count: number
  wasUpdate: boolean
  onBackToList: () => void
  onKeepEditing: () => void
}) {
  const scheduled = plan.assign.visibilityStart === "scheduled" && plan.assign.visibilityDate
  return (
    <div className="sk-page">
      <PageHeader title={plan.name || "Training plan"} />
      <section className="sk-card max-w-2xl">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-sk-green-tint text-sk-green">
          <CheckCircle className="size-7" weight="fill" />
        </span>
        <h2 className="sk-h2 mt-4">
          {wasUpdate ? "Plan updated for" : "Plan published to"} {plural(count, "athlete")}
        </h2>
        <p className="mt-2 max-w-[52ch] text-sk-mute">
          {scheduled
            ? `They will see it in their training plan from ${formatDayMonth(plan.assign.visibilityDate as string)}.`
            : "They can open it in their training plan now."}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="sk-btn sk-btn-primary" onClick={onBackToList}>
            Back to plans
          </button>
          <button type="button" className="sk-btn sk-btn-quiet" onClick={onKeepEditing}>
            Keep editing this plan
          </button>
        </div>
      </section>
    </div>
  )
}
