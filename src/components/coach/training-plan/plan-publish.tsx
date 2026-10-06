import { PaperPlaneTilt } from "@phosphor-icons/react"
import { useEffect, useMemo, useState } from "react"
import {
  ActionBar,
  Button,
  CheckRow,
  EmptyState,
  Field,
  GroupDot,
  Input,
  LinkButton,
  List,
  ListRow,
  Notice,
  Screen,
  ScreenHeader,
  SearchInput,
  Section,
  Segmented,
  Select,
  Split,
  StatusText,
} from "@/components/sk"
import { PersonAvatar } from "@/components/account/person-avatar"
import { currentAvailability, describeAvailability, listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import { dayClashText, findDayClashes, liveSquadIds, type PlanDays, type Squad } from "@/lib/data/coach/squads"
import type { Result } from "@/lib/data/result"
import { planBlueprints } from "@/lib/data/session/session-from-plan"
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
import { assignedAthletes, type AthleteOption, type TeamOption } from "./storage"
import { plural } from "./ui"

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function PlanPublish({
  plan,
  teams,
  athletes,
  squads,
  listTeamPlanDays,
  busy,
  error,
  onChange,
  onBack,
  onPublish,
}: {
  plan: PlanDraft
  teams: TeamOption[]
  athletes: AthleteOption[]
  /** The live squads of the coach's teams. */
  squads: Squad[]
  /** The team's published plans with their session days, to warn about two sessions on one day. */
  listTeamPlanDays: (teamId: string) => Promise<Result<PlanDays[]>>
  busy: boolean
  error: string | null
  onChange: (updater: (plan: PlanDraft) => PlanDraft) => void
  onBack: () => void
  onPublish: () => void
}) {
  const [search, setSearch] = useState("")
  const [availability, setAvailability] = useState<Record<string, AthleteAvailability>>({})
  const team = teams.find((candidate) => candidate.id === plan.teamId) ?? null
  const teamAthletes = athletes.filter((athlete) => athlete.teamId === plan.teamId)
  const teamSquads = squads.filter((squad) => squad.teamId === plan.teamId)
  // A squad archived since the plan was last saved is no longer a choice.
  const chosenSquadIds = liveSquadIds(plan.assign.squadIds, squads, plan.teamId)
  const chosenSquads = new Set(chosenSquadIds)
  const recipients = assignedAthletes({ ...plan, assign: { ...plan.assign, squadIds: chosenSquadIds } }, athletes, squads)
  const assignedCount = recipients.length
  const blocker = validateForPublish({ ...plan, assign: { ...plan.assign, squadIds: chosenSquadIds } }, assignedCount)
  const isUpdate = plan.status === "published"
  const groupsInTeam = EVENT_GROUPS.filter((group) => teamAthletes.some((athlete) => athlete.eventGroup === group.value))
  const query = search.trim().toLowerCase()
  const selected = new Set(plan.assign.athleteIds)
  const picking = plan.assign.target === "selected"
  const listed = (picking ? teamAthletes : recipients).filter((athlete) => !query || athlete.name.toLowerCase().includes(query))

  // Who is injured, sick or away right now. They still get the plan; the coach just sees it here.
  const athleteIdsKey = teamAthletes.map((athlete) => athlete.id).join(",")
  useEffect(() => {
    if (!athleteIdsKey) return
    let cancelled = false
    void listAthleteAvailability(athleteIdsKey.split(","), { from: todayIso() }).then((result) => {
      if (cancelled || !result.ok) return
      const byAthlete: Record<string, AthleteAvailability> = {}
      for (const athleteId of athleteIdsKey.split(",")) {
        const current = currentAvailability(result.data.filter((period) => period.athleteId === athleteId))
        if (current) byAthlete[athleteId] = current
      }
      setAvailability(byAthlete)
    })
    return () => {
      cancelled = true
    }
  }, [athleteIdsKey])

  // Other published plans of this team: an athlete on two of them gets two sessions on a shared day.
  const [otherPlans, setOtherPlans] = useState<PlanDays[]>([])
  useEffect(() => {
    if (!plan.teamId) return
    let cancelled = false
    void listTeamPlanDays(plan.teamId).then((result) => {
      if (!cancelled && result.ok) setOtherPlans(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [listTeamPlanDays, plan.teamId])
  const recipientKey = recipients.map((athlete) => athlete.id).join(",")
  const clash = useMemo(() => {
    const from = plan.assign.visibilityStart === "scheduled" && plan.assign.visibilityDate && plan.assign.visibilityDate > todayIso() ? plan.assign.visibilityDate : todayIso()
    return findDayClashes(
      { id: plan.id, name: plan.name, dates: planBlueprints(plan).map((blueprint) => blueprint.date), athleteIds: recipientKey ? recipientKey.split(",") : [] },
      otherPlans.filter((other) => other.id !== plan.id),
      from,
    )
  }, [otherPlans, plan, recipientKey])

  // Forget a chosen squad that no longer exists, so the publish does not ask the server for it.
  const staleSquads = squads.length > 0 && chosenSquadIds.length !== plan.assign.squadIds.length
  useEffect(() => {
    if (staleSquads) onChange((current) => ({ ...current, assign: { ...current.assign, squadIds: liveSquadIds(current.assign.squadIds, squads, current.teamId) } }))
  }, [onChange, squads, staleSquads])

  const toggleSquad = (squadId: string) =>
    setAssign({ squadIds: chosenSquads.has(squadId) ? chosenSquadIds.filter((id) => id !== squadId) : [...chosenSquadIds, squadId] })

  const availabilityText = (athleteId: string) => {
    const period = availability[athleteId]
    return period ? <StatusText tone="amber">{sentenceCase(describeAvailability(period))}</StatusText> : null
  }

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
    <Screen>
      <ScreenHeader
        back={{ onClick: onBack, label: "Back to the plan" }}
        title={isUpdate ? "Update plan" : "Publish plan"}
        lede={`${plan.name || "Untitled plan"}, ${formatDateRange(plan.startDate, planEndDate(plan))}.`}
      />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Split
        main={
          <>
            <Section
              title="Who gets it"
              hint={team ? `${team.name} has ${plural(teamAthletes.length, "athlete")}.` : "Choose a team in plan details first."}
              meta={team ? `${assignedCount} selected` : undefined}
            >
              <Segmented<AssignTarget>
                label="Assign to"
                className="mt-2 self-start"
                value={plan.assign.target}
                onChange={setTarget}
                options={[
                  { value: "team" as const, label: "Whole team" },
                  { value: "squads" as const, label: "Squads" },
                  // An event group only narrows a team whose athletes are in more than one.
                  ...(groupsInTeam.length > 1 || plan.assign.target === "subgroup" ? [{ value: "subgroup" as const, label: "Event group" }] : []),
                  { value: "selected" as const, label: "Athletes" },
                ]}
              />

              {plan.assign.target === "subgroup" ? (
                <Field label="Event group" className="mt-4 max-w-xs">
                  <Select value={plan.assign.subgroup ?? ""} onChange={(event) => setAssign({ subgroup: (event.target.value || null) as EventGroup | null })}>
                    {EVENT_GROUPS.map((group) => (
                      <option key={group.value} value={group.value}>
                        {group.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {plan.assign.target === "squads" ? (
                teamSquads.length === 0 ? (
                  <EmptyState
                    className="mt-3"
                    title="This team has no squads yet"
                    body="A squad is a small group inside the team, such as Short sprints or 400m. Make one on the team page, then send it this plan."
                    action={
                      team ? (
                        <LinkButton size="sm" to={`/coach/teams/${team.id}`}>
                          Open the team page
                        </LinkButton>
                      ) : undefined
                    }
                  />
                ) : (
                  <>
                    <List className="mt-2" aria-label="Choose squads">
                      {teamSquads.map((squad) => (
                        <CheckRow
                          key={squad.id}
                          checked={chosenSquads.has(squad.id)}
                          onChange={() => toggleSquad(squad.id)}
                          leading={<GroupDot color={squad.color} />}
                          title={squad.name}
                          subtitle={squad.note ?? undefined}
                          trailing={plural(squad.athleteIds.length, "athlete")}
                        />
                      ))}
                    </List>
                    <p className="mt-3 text-[0.9375rem] text-sk-mute" data-squad-hint>
                      Athletes you add to {chosenSquadIds.length === 1 ? "this squad" : "these squads"} later get the upcoming sessions too. Anyone you take out stops getting new ones.
                    </p>
                  </>
                )
              ) : null}

              {clash ? (
                <Notice tone="info" className="mt-3">
                  <span data-plan-clash>{dayClashText(clash)}</span>
                </Notice>
              ) : null}

              {teamAthletes.length > 8 ? (
                <Field label="Find an athlete" className="mt-4 max-w-sm">
                  <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name" />
                </Field>
              ) : null}

              {plan.assign.target === "squads" && (teamSquads.length === 0 || chosenSquadIds.length === 0) ? null : teamAthletes.length === 0 ? (
                <EmptyState className="mt-3" title="No athletes on this team yet" body="Add or invite athletes from the team page, then come back to publish." />
              ) : listed.length === 0 ? (
                <EmptyState
                  className="mt-3"
                  title={query ? "Nobody matches that name" : plan.assign.target === "squads" ? "Nobody in these squads yet" : "Nobody in this event group"}
                  body={
                    query
                      ? "Check the spelling or clear the search."
                      : plan.assign.target === "squads"
                        ? "You can still publish. Athletes get the plan when you add them to a squad."
                        : "Pick another group, or choose athletes one by one."
                  }
                />
              ) : (
                <List className="mt-2" aria-label={picking ? "Choose athletes" : "Athletes who get this plan"}>
                  {listed.map((athlete) =>
                    picking ? (
                      <CheckRow
                        key={athlete.id}
                        checked={selected.has(athlete.id)}
                        onChange={() => toggleAthlete(athlete.id)}
                        leading={<PersonAvatar name={athlete.name} athleteId={athlete.id} size="sm" />}
                        title={athlete.name}
                        subtitle={athlete.primaryEvent}
                        trailing={availabilityText(athlete.id)}
                      />
                    ) : (
                      <ListRow
                        key={athlete.id}
                        leading={<PersonAvatar name={athlete.name} athleteId={athlete.id} size="sm" />}
                        title={athlete.name}
                        subtitle={athlete.primaryEvent}
                        trailing={availabilityText(athlete.id)}
                      />
                    ),
                  )}
                </List>
              )}
            </Section>

            <Section title="When they see it">
              <Segmented<"immediate" | "scheduled">
                label="Visibility"
                className="mt-2 self-start"
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
                  <Input type="date" value={plan.assign.visibilityDate ?? ""} onChange={(event) => setAssign({ visibilityDate: event.target.value || null })} />
                </Field>
              ) : (
                <p className="mt-3 text-[0.9375rem] text-sk-mute">Athletes with an account are told as soon as you publish.</p>
              )}
            </Section>
          </>
        }
        side={
          <Section title="What is in it" meta={`${plural(plan.sessions.length, "session")}, ${plural(plan.weeks, "week")}`}>
            <List>
              {Array.from({ length: plan.weeks }, (_, index) => index + 1).map((week) => {
                const sessions = weekSessions(plan, week)
                return (
                  <ListRow
                    key={week}
                    title={`Week ${week}`}
                    subtitle={plan.weekFocus[String(week)] || formatDateRange(slotDate(plan, week, 0), slotDate(plan, week, 6))}
                    trailing={sessions.length === 0 ? <StatusText tone="amber">No sessions</StatusText> : plural(sessions.length, "session")}
                  />
                )
              })}
            </List>
          </Section>
        }
      />

      <ActionBar aria-label="Publish">
        <p aria-live="polite" className="min-w-0 text-sm font-semibold text-sk-mute">
          {blocker ?? (isUpdate ? "Athletes already on this plan are not told again." : "")}
        </p>
        <Button variant="primary" onClick={onPublish} disabled={busy || Boolean(blocker)}>
          <PaperPlaneTilt className="size-5" weight="bold" aria-hidden />
          {busy ? "Publishing..." : isUpdate ? `Save for ${plural(assignedCount, "athlete")}` : `Publish to ${plural(assignedCount, "athlete")}`}
        </Button>
      </ActionBar>
    </Screen>
  )
}

export function PlanPublished({
  plan,
  count,
  wasUpdate,
  onBackToList,
  onKeepEditing,
  onPrint,
}: {
  plan: PlanDraft
  count: number
  wasUpdate: boolean
  onBackToList: () => void
  onKeepEditing: () => void
  onPrint: () => void
}) {
  const scheduled = plan.assign.visibilityStart === "scheduled" && plan.assign.visibilityDate
  return (
    <Screen width="narrow">
      <ScreenHeader
        fact={<StatusText tone="green">{wasUpdate ? "Updated" : "Published"}</StatusText>}
        title={plan.name || "Training plan"}
        lede={`${wasUpdate ? "Plan updated for" : "Plan published to"} ${plural(count, "athlete")}. ${
          scheduled ? `They see it in their training plan from ${formatDayMonth(plan.assign.visibilityDate as string)}.` : "They can open it in their training plan now."
        }`}
      />
      <Section title="What next">
        <List>
          <ListRow onClick={onBackToList} chevron title="Back to plans" subtitle="See every plan and who it goes to." />
          <ListRow onClick={onKeepEditing} chevron title="Keep editing this plan" subtitle="Changes reach athletes when you update it." />
          <ListRow onClick={onPrint} chevron title="Print or save as PDF" subtitle="One week or the whole plan, for the wall or a parent." />
        </List>
      </Section>
    </Screen>
  )
}
