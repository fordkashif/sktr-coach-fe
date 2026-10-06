import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  Button,
  CheckRow,
  Fact,
  FactList,
  Field,
  FormActions,
  FormGrid,
  Input,
  LinkButton,
  List,
  Notice,
  RadioRow,
  Screen,
  ScreenHeader,
  Section,
  SkeletonRows,
  StatusText,
  StepIndicator,
  notify,
} from "@/components/sk"
import {
  currentSeason,
  SEASON_NAME_MAX,
  summarizeRollover,
  validateRolloverDraft,
  type SeasonDraft,
  type SeasonDraftErrors,
  type TeamChoice,
} from "@/lib/data/club-admin/season-logic"
import { getRolloverContext, seasonsToday, startClubSeason, type RolloverContext } from "@/lib/data/club-admin/seasons-data"
import { formatDay, plural } from "../../ops-format"

const SEASONS_PATH = "/club-admin/profile/seasons"

const STEPS = [
  { id: "season", label: "Season" },
  { id: "teams", label: "Teams" },
  { id: "plans", label: "Plans" },
  { id: "confirm", label: "Check and start" },
] as const

type StepId = (typeof STEPS)[number]["id"]

/**
 * The year end rollover, as four steps. Nothing is saved until the last button: every choice lives
 * on this screen, so going back, or leaving, changes nothing.
 */
export default function ClubAdminStartSeasonPage() {
  const { seasonId = "" } = useParams()
  const navigate = useNavigate()
  const [context, setContext] = useState<RolloverContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<StepId>("season")
  const [draft, setDraft] = useState<SeasonDraft>({ name: "", start: "", end: "" })
  const [errors, setErrors] = useState<SeasonDraftErrors>({})
  const [teamChoices, setTeamChoices] = useState<Record<string, TeamChoice>>({})
  const [endPlans, setEndPlans] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getRolloverContext().then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.error.message)
        return
      }
      setContext(result.data)
      const season = result.data.seasons.find((candidate) => candidate.id === seasonId)
      if (season) setDraft({ name: season.name, start: season.start, end: season.end })
    })
    return () => {
      cancelled = true
    }
  }, [seasonId])

  const season = context?.seasons.find((candidate) => candidate.id === seasonId) ?? null
  const old = context ? currentSeason(context.seasons) : null
  const summary = useMemo(
    () => (context ? summarizeRollover({ seasonId, draft, teamChoices, endPlans }, context.seasons, context.teams, context.publishedPlans) : null),
    [context, seasonId, draft, teamChoices, endPlans],
  )
  const stepIndex = STEPS.findIndex((candidate) => candidate.id === step)
  const today = seasonsToday()

  const update = (field: keyof SeasonDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const goTo = (next: StepId) => {
    setStartError(null)
    setStep(next)
    window.scrollTo({ top: 0 })
  }

  const next = () => {
    if (!context) return
    if (step === "season") {
      const checked = validateRolloverDraft(draft, context.seasons, seasonId)
      if (!checked.ok) {
        setErrors(checked.errors)
        return
      }
      setDraft(checked.data)
    }
    goTo(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id)
  }

  const start = async () => {
    if (starting) return
    setStarting(true)
    setStartError(null)
    const result = await startClubSeason({ seasonId, draft, teamChoices, endPlans })
    setStarting(false)
    if (!result.ok) {
      setStartError(`The season was not started and nothing was changed. ${result.error.message}`)
      return
    }
    notify(`${draft.name} is now the current season`)
    navigate(SEASONS_PATH)
  }

  const back = { to: SEASONS_PATH, label: "Seasons" }

  if (loadError) {
    return (
      <Screen width="narrow">
        <ScreenHeader back={back} title="Start a season" />
        <Notice tone="error">This could not be loaded. {loadError}</Notice>
      </Screen>
    )
  }

  if (!context || !summary) {
    return (
      <Screen width="narrow">
        <ScreenHeader back={back} title="Start a season" />
        <Section title="Getting your teams and plans">
          <SkeletonRows rows={4} label="Loading" />
        </Section>
      </Screen>
    )
  }

  if (!season || season.status !== "upcoming") {
    return (
      <Screen width="narrow">
        <ScreenHeader back={back} title="Start a season" />
        <Notice
          tone="info"
          action={
            <LinkButton to={SEASONS_PATH} size="sm">
              Back to seasons
            </LinkButton>
          }
        >
          {season ? `${season.name} has already started, so there is nothing to do here.` : "This season no longer exists."}
        </Notice>
      </Screen>
    )
  }

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={back}
        fact={`Step ${stepIndex + 1} of ${STEPS.length}: ${STEPS[stepIndex].label}`}
        title={`Start ${draft.name.trim() || season.name}`}
        lede="Nothing changes until you press Start the season on the last step. Nothing is ever deleted."
      />
      <StepIndicator steps={[...STEPS]} current={step} label="Steps to start the season" />

      {step === "season" ? (
        <Section title="Name and dates" hint="Season bests will count from the first day. Personal bests stay as they are.">
          <div className="flex flex-col gap-4">
            <Field label="Name" error={errors.name}>
              <Input name="season-name" maxLength={SEASON_NAME_MAX} autoComplete="off" value={draft.name} onChange={(event) => update("name", event.target.value)} />
            </Field>
            <FormGrid>
              <Field label="First day" error={errors.start}>
                <Input name="season-start" type="date" value={draft.start} onChange={(event) => update("start", event.target.value)} />
              </Field>
              <Field label="Last day" error={errors.end}>
                <Input name="season-end" type="date" min={draft.start || undefined} value={draft.end} onChange={(event) => update("end", event.target.value)} />
              </Field>
            </FormGrid>
            {old && draft.start && old.end >= draft.start && old.start < draft.start ? (
              <Notice tone="info">
                {old.name} is due to end on {formatDay(old.end)}. Starting this season makes it end on {formatDay(summary.oldSeason?.end)} instead, the day before.
              </Notice>
            ) : null}
            {draft.start > today ? (
              <Notice tone="info">The first day is still to come. Until {formatDay(draft.start)} no result counts as a season best.</Notice>
            ) : null}
          </div>
        </Section>
      ) : null}

      {step === "teams" ? (
        <Section
          title="Teams"
          hint="Tick a team to archive it. Every other team carries on with its coaches and athletes exactly as they are. An archived team keeps all its history, and its athletes stay in the club with no team until a coach or club admin places them."
          meta={context.teams.length > 0 ? `${summary.archivedTeams.length} of ${context.teams.length} to archive` : undefined}
        >
          {context.teams.length === 0 ? (
            <p className="sk-list-sub">Your club has no teams yet, so there is nothing to choose here.</p>
          ) : (
            <List aria-label="Teams to archive">
              {context.teams.map((team) => (
                <CheckRow
                  key={team.id}
                  checked={teamChoices[team.id] === "archive"}
                  onChange={(archive) => setTeamChoices((current) => ({ ...current, [team.id]: archive ? "archive" : "carry" }))}
                  title={team.name}
                  subtitle={plural(team.athleteCount, "athlete")}
                  trailing={
                    teamChoices[team.id] === "archive" ? <StatusText tone="amber">Archive</StatusText> : <span className="text-sk-mute">Carries on</span>
                  }
                />
              ))}
            </List>
          )}
        </Section>
      ) : null}

      {step === "plans" ? (
        <Section
          title="Published plans"
          hint={
            context.publishedPlans === 0
              ? "Your club has no published plans right now, so either answer changes nothing."
              : `Your club has ${plural(context.publishedPlans, "published plan")}. Draft plans are never touched.`
          }
        >
          <div role="radiogroup" aria-label="What happens to published plans">
            <List>
              <RadioRow
                name="plans"
                value="carry"
                checked={!endPlans}
                onChange={() => setEndPlans(false)}
                title="Plans carry on"
                subtitle="Athletes keep the sessions they have now. Coaches end each plan when they are ready."
              />
              <RadioRow
                name="plans"
                value="end"
                checked={endPlans}
                onChange={() => setEndPlans(true)}
                title={old ? `Plans end with ${old.name}` : "Plans end now"}
                subtitle="Every published plan is moved to archived. Athletes stop seeing its sessions. Coaches can still open it and copy it for the new season."
              />
            </List>
          </div>
        </Section>
      ) : null}

      {step === "confirm" ? (
        <>
          <Section title="What will change" hint="Check each line. This is everything that happens when you start the season.">
            <FactList aria-label="What will change">
              <Fact label="New current season" stack>
                {`${summary.newSeason.name}, ${formatDay(summary.newSeason.start)} to ${formatDay(summary.newSeason.end)}`}
              </Fact>
              <Fact label="Season that ends" stack>
                {summary.oldSeason
                  ? `${summary.oldSeason.name} becomes a past season${summary.oldSeason.endsEarly ? ` and now ends on ${formatDay(summary.oldSeason.end)}` : `, ${formatDay(summary.oldSeason.start)} to ${formatDay(summary.oldSeason.end)}`}`
                  : "None. This is your first season."}
              </Fact>
              <Fact label="Season bests" stack>
                {`Counted from ${formatDay(summary.newSeason.start)}. Personal bests and every past result stay as they are.`}
              </Fact>
              <Fact label="Teams archived" stack>
                {summary.archivedTeams.length === 0 ? "None" : summary.archivedTeams.map((team) => team.name).join(", ")}
              </Fact>
              <Fact label="Athletes left without a team" stack>
                {summary.athletesUnassigned === 0 ? "None" : `${summary.athletesUnassigned}. They stay in the club for a coach or club admin to place.`}
              </Fact>
              <Fact label="Teams carrying on" stack>
                {summary.carriedTeams.length === 0 ? "None" : summary.carriedTeams.map((team) => team.name).join(", ")}
              </Fact>
              <Fact label="Published plans" stack>
                {context.publishedPlans === 0 ? "None to change" : endPlans ? `${plural(summary.plansEnded, "plan")} moved to archived` : `${plural(summary.plansCarried, "plan")} carry on unchanged`}
              </Fact>
              <Fact label="Deleted">Nothing</Fact>
            </FactList>
          </Section>
          {startError ? <Notice tone="error">{startError}</Notice> : null}
        </>
      ) : null}

      <FormActions>
        {stepIndex > 0 ? (
          <Button variant="quiet" onClick={() => goTo(STEPS[stepIndex - 1].id)} disabled={starting}>
            Back
          </Button>
        ) : (
          <LinkButton to={SEASONS_PATH} variant="quiet">
            Cancel
          </LinkButton>
        )}
        {step === "confirm" ? (
          <Button variant="primary" onClick={() => void start()} disabled={starting}>
            {starting ? "Starting..." : "Start the season"}
          </Button>
        ) : (
          <Button variant="primary" onClick={next}>
            Continue
          </Button>
        )}
      </FormActions>
    </Screen>
  )
}
