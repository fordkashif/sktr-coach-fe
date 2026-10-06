"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DownloadSimple, PencilSimple, Plus } from "@phosphor-icons/react"
import { Link, useLocation, useParams } from "react-router-dom"
import { EntryResultDialog, type EntryResultOutcome } from "@/components/athlete/entry-result-dialog"
import { RelayList } from "@/components/athlete/relay-parts"
import { markText, meetDatesText, ordinal, ResultMark } from "@/components/athlete/results-parts"
import { COMPETITIONS_PATH, competitionPath, plural, scopeText, whereText } from "@/components/coach/competitions/competition-parts"
import { RelayDialog, type RelayDialogOutcome } from "@/components/coach/competitions/relay-dialog"
import { ResultsGrid } from "@/components/coach/competitions/results-grid"
import {
  Avatar,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Fact,
  FactList,
  Field,
  Input,
  InlineConfirm,
  LinkButton,
  Notice,
  RowMenu,
  Screen,
  ScreenHeader,
  Section,
  Segmented,
  Select,
  SkeletonRows,
  StatusText,
  Tag,
  type DataTableColumn,
} from "@/components/sk"
import { useAvatarLookup } from "@/lib/account-store"
import { useCoachTeamScope } from "@/lib/coach-teams"
import { csvFileName, downloadCsv } from "@/lib/csv"
import { availabilityCovers, describeAvailability, listAthleteAvailability, type AthleteAvailability } from "@/lib/data/athlete/availability-data"
import {
  competitionResultsRows,
  getCompetitionForStaff,
  getEntryStandings,
  removeCompetitionEntry,
  saveCompetitionEntryResultForStaff,
  updateCompetitionEntry,
  type EntryStanding,
} from "@/lib/data/competition/competition-data"
import { getRelaysForStaff } from "@/lib/data/competition/relay-data"
import { relayTeamRecords } from "@/lib/data/competition/relay-logic"
import { getStaffAthletes, getStaffTeams, type StaffAthlete, type StaffTeam } from "@/lib/data/competition/staff-roster"
import { COMPETITION_LEVELS, type CompetitionEntryWithResult, type CompetitionWithEntries, type RelayEntry } from "@/lib/data/competition/types"
import { formatMarkWithUnit, formatWind, headlineResult, roundLabel, sortRounds, type AthleteResult, type RoundSlot } from "@/lib/data/pr/marks"
import { localDayKey, parseLocalDay } from "@/lib/data/pr/pr-display"
import { getResultsSeason, localToday, type SeriesVerdict } from "@/lib/data/pr/results-data"
import { ok } from "@/lib/data/result"

type SavedNotice = { tone: "success" | "warning" | "info"; text: string }
type Mode = "entries" | "results"

const GRID_ROUNDS: Array<{ value: RoundSlot; label: string }> = [
  { value: "final", label: "Final or only round" },
  { value: "heat", label: "Heats" },
  { value: "quarter_final", label: "Quarter finals" },
  { value: "semi_final", label: "Semi finals" },
]

/** An entry with one of its rounds added, replaced or (with `removedId`) taken away. */
function withRound(entry: CompetitionEntryWithResult, result: AthleteResult | null, removedId?: string): CompetitionEntryWithResult {
  const others = (entry.rounds ?? (entry.result ? [entry.result] : [])).filter((round) => round.id !== (result?.id ?? removedId))
  const rounds = sortRounds(result ? [...others, result] : others)
  return { ...entry, rounds, result: headlineResult(rounds) }
}

/** What a result saved from the detail dialog means, in one line for the coach. */
function savedNotice(name: string, result: AthleteResult, verdict: SeriesVerdict | null): SavedNotice {
  const shown = verdict?.legal ?? result
  const mark = markText(shown)
  if (verdict?.kind === "personal-best" || verdict?.kind === "first") return { tone: "success", text: `Saved. Personal best for ${name} in the ${result.eventLabel}: ${mark}.` }
  if (verdict?.kind === "season-best") return { tone: "success", text: `Saved. Season best for ${name} in the ${result.eventLabel}: ${mark}.` }
  if (verdict?.kind === "wind-assisted") return { tone: "warning", text: `Saved. ${name}'s ${mark} is wind assisted (over +2.0). It is kept, but does not count as a best.` }
  return { tone: "info", text: `Saved. ${name}, ${result.eventLabel}${result.round ? ` (${roundLabel(result.round).toLowerCase()})` : ""}: ${mark}.` }
}

/** The athlete's availability period that covers a day of the meet, if any. */
function unavailableOn(periods: AthleteAvailability[], athleteId: string, competition: Pick<CompetitionWithEntries, "startDate" | "endDate">) {
  return periods.find((period) => period.athleteId === athleteId && period.endedAt === null && (availabilityCovers(period, competition.startDate) || availabilityCovers(period, competition.endDate))) ?? null
}

function NoteDialog({ entry, onClose, onSaved }: { entry: CompetitionEntryWithResult; onClose: () => void; onSaved: (notice: SavedNotice) => void }) {
  const [notes, setNotes] = useState(entry.notes ?? "")
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    const result = await updateCompetitionEntry(entry.id, { notes })
    setBusy(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onSaved({ tone: "success", text: `Note saved for ${entry.athleteName ?? "the athlete"}, ${entry.eventLabel}.` })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`${entry.athleteName ?? "Athlete"}, ${entry.eventLabel}`}
      description="The athlete sees this note on their competition screen."
      footer={
        <>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving..." : "Save note"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Heat, lane or flight" optional hint="Whatever they need on the day: heat 2 lane 4, flight B, call room 10:15.">
          <Input value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
        </Field>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
      </div>
    </Dialog>
  )
}

export default function CoachCompetitionDetailPage() {
  const { competitionId = "" } = useParams()
  const location = useLocation()
  const { coachTeamId, coachTeamsLoading } = useCoachTeamScope()
  const avatarOf = useAvatarLookup()
  const [competition, setCompetition] = useState<CompetitionWithEntries | null | undefined>(undefined)
  const [standings, setStandings] = useState<Record<string, EntryStanding>>({})
  const [availability, setAvailability] = useState<AthleteAvailability[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<SavedNotice | null>((location.state as { saved?: SavedNotice } | null)?.saved ?? null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [noteEntryId, setNoteEntryId] = useState<string | null>(null)
  const [removeEntryId, setRemoveEntryId] = useState<string | null>(null)
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null)
  // Rounds and detail of one entry, and the round the grid is typing.
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null)
  const [gridSlot, setGridSlot] = useState<RoundSlot>("final")
  const [gridVersion, setGridVersion] = useState(0)
  // Relay teams at this meet, and who can be named in one.
  const [relays, setRelays] = useState<RelayEntry[]>([])
  const [relayDialog, setRelayDialog] = useState<RelayEntry | "new" | null>(null)
  const [roster, setRoster] = useState<StaffAthlete[]>([])
  const [teams, setTeams] = useState<StaffTeam[]>([])
  // What the last save from the detail dialog meant for the athlete, so the notice can say it.
  const lastVerdict = useRef<SeriesVerdict | null>(null)

  const load = useCallback(async (): Promise<CompetitionWithEntries | null> => {
    const [result, relaysResult] = await Promise.all([getCompetitionForStaff(competitionId, { teamId: coachTeamId }), getRelaysForStaff({ competitionId })])
    if (relaysResult.ok) setRelays(relaysResult.data)
    if (!result.ok) {
      setError(result.error.message)
      return null
    }
    setError(null)
    setCompetition(result.data)
    if (!result.data) return null
    const athleteIds = [...new Set(result.data.entries.map((entry) => entry.athleteId))]
    const [standingsResult, availabilityResult] = await Promise.all([getEntryStandings(result.data), listAthleteAvailability(athleteIds, { from: result.data.startDate })])
    if (standingsResult.ok) setStandings(standingsResult.data)
    if (availabilityResult.ok) setAvailability(availabilityResult.data)
    return result.data
  }, [competitionId, coachTeamId])

  useEffect(() => {
    if (coachTeamsLoading) return
    void load()
  }, [coachTeamsLoading, load])

  // The team a relay runs for: this meet's team, or the coach's selected team for a club wide meet.
  const relayTeamId = competition ? (competition.scope === "team" ? competition.teamId : coachTeamId) : null
  useEffect(() => {
    if (coachTeamsLoading || !competition) return
    let cancelled = false
    void Promise.all([getStaffAthletes({ teamId: relayTeamId }), getStaffTeams()]).then(([athletes, teamList]) => {
      if (cancelled) return
      if (athletes.ok) setRoster(athletes.data)
      if (teamList.ok) setTeams(relayTeamId ? teamList.data.filter((team) => team.id === relayTeamId) : teamList.data)
    })
    return () => {
      cancelled = true
    }
    // Only the identity of the competition matters here, not every change to its entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachTeamsLoading, competition?.id, relayTeamId])

  const today = useMemo(() => localDayKey(new Date()), [])

  if (competition === undefined && !error) {
    return (
      <Screen>
        <ScreenHeader back={{ to: COMPETITIONS_PATH, label: "Competitions" }} title="Competition" />
        <Section title="Entries">
          <SkeletonRows rows={4} leading label="Loading the competition" />
        </Section>
      </Screen>
    )
  }

  if (!competition) {
    return (
      <Screen>
        <ScreenHeader back={{ to: COMPETITIONS_PATH, label: "Competitions" }} title="Competition" />
        {error ? <Notice tone="error">This competition could not be loaded. {error}</Notice> : null}
        {!error ? (
          <Section title="This competition is not on your calendar">
            <EmptyState
              title="It may have been removed"
              body="Or it belongs to a team you do not coach. Your calendar shows every meet you can see."
              action={
                <LinkButton to={COMPETITIONS_PATH} size="sm">
                  Back to competitions
                </LinkButton>
              }
            />
          </Section>
        ) : null}
      </Screen>
    )
  }

  const started = competition.startDate <= today
  const over = competition.endDate < today
  const startDay = parseLocalDay(competition.startDate)
  const daysAway = startDay ? Math.round((startDay.getTime() - (parseLocalDay(today) ?? new Date()).getTime()) / 86_400_000) : 0
  const level = COMPETITION_LEVELS.find((item) => item.value === competition.level)?.label ?? null
  const entered = competition.entries.filter((entry) => entry.status === "entered")
  const athleteCount = new Set(entered.map((entry) => entry.athleteId)).size
  const withResult = entered.filter((entry) => entry.result).length
  const activeMode: Mode = started ? (mode ?? "results") : "entries"
  const noteEntry = competition.entries.find((entry) => entry.id === noteEntryId) ?? null
  const detailEntry = competition.entries.find((entry) => entry.id === detailEntryId) ?? null

  const afterDetail = async ({ notice: outcomeNotice, resultId }: EntryResultOutcome) => {
    const entry = detailEntry
    setDetailEntryId(null)
    const verdict = lastVerdict.current
    lastVerdict.current = null
    const fresh = await load()
    // The grid keeps its own copy of what is saved: start it again from the fresh results.
    setGridVersion((version) => version + 1)
    const saved = resultId ? (fresh?.entries.flatMap((item) => item.rounds ?? []).find((round) => round.id === resultId) ?? null) : null
    setNotice(saved && entry ? savedNotice(entry.athleteName ?? "The athlete", saved, verdict) : (outcomeNotice ?? { tone: "success", text: "Result saved." }))
  }

  const afterRelay = async ({ relay, deleted, label }: RelayDialogOutcome) => {
    setRelayDialog(null)
    const [here, all, season] = await Promise.all([getRelaysForStaff({ competitionId }), getRelaysForStaff(), getResultsSeason()])
    if (here.ok) setRelays(here.data)
    if (deleted || !relay) {
      setNotice({ tone: "info", text: `${label} deleted.` })
      return
    }
    if (relay.value === null || relay.display === null) {
      setNotice({ tone: "success", text: `${label} is entered. Add the time once they have run.` })
      return
    }
    // Is it the team's fastest in this relay?
    const today = localToday()
    const record = all.ok ? relayTeamRecords(all.data, season.ok ? season.data : { start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31` }).find((item) => item.teamId === relay.teamId && item.eventKey === relay.eventKey) : null
    const mark = formatMarkWithUnit(relay.display, "s")
    setNotice({
      tone: "success",
      text:
        record && record.best.id === relay.id
          ? record.count > 1
            ? `${label}: ${mark}. That is the fastest ${relay.eventLabel} on record for ${record.teamName}.`
            : `${label}: ${mark}. It is the first ${relay.eventLabel} on record for ${record.teamName}.`
          : `${label}: ${mark} saved.`,
    })
  }
  // By athlete, then by event, the same order as the results grid.
  const sortedEntries = [...competition.entries].sort((a, b) => (a.athleteName ?? "").localeCompare(b.athleteName ?? "") || a.eventLabel.localeCompare(b.eventLabel, undefined, { numeric: true }))

  const patchEntry = (entryId: string, patch: Partial<CompetitionEntryWithResult>) =>
    setCompetition((current) => (current ? { ...current, entries: current.entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)) } : current))

  const setStatus = async (entry: CompetitionEntryWithResult, status: "entered" | "scratched") => {
    setBusyEntryId(entry.id)
    const result = await updateCompetitionEntry(entry.id, { status })
    setBusyEntryId(null)
    if (!result.ok) {
      setNotice({ tone: "warning", text: result.error.message })
      return
    }
    patchEntry(entry.id, { status })
    setNotice({ tone: "info", text: status === "scratched" ? `${entry.athleteName ?? "The athlete"} is scratched from the ${entry.eventLabel}.` : `${entry.athleteName ?? "The athlete"} is back in the ${entry.eventLabel}.` })
  }

  const removeEntry = async (entry: CompetitionEntryWithResult) => {
    setBusyEntryId(entry.id)
    const result = await removeCompetitionEntry(entry.id)
    setBusyEntryId(null)
    setRemoveEntryId(null)
    if (!result.ok) {
      setNotice({ tone: "warning", text: result.error.message })
      return
    }
    setCompetition((current) => (current ? { ...current, entries: current.entries.filter((item) => item.id !== entry.id) } : current))
    setNotice({ tone: "info", text: `${entry.athleteName ?? "The athlete"} is no longer entered in the ${entry.eventLabel}.` })
  }

  const exportResults = () => downloadCsv(csvFileName(competition.name, competition.startDate, "results"), competitionResultsRows(competition, standings, relays))

  const columns: Array<DataTableColumn<CompetitionEntryWithResult>> = [
    {
      key: "athlete",
      header: "Athlete",
      cell: (entry) => {
        const away = unavailableOn(availability, entry.athleteId, competition)
        return (
          <span className="flex items-center gap-3">
            <Avatar name={entry.athleteName ?? "Athlete"} src={avatarOf({ athleteId: entry.athleteId })} size="sm" />
            <span className="min-w-0">
              <Link to={`/coach/athletes/${entry.athleteId}`} className="hover:text-sk-blue-link">
                {entry.athleteName ?? "Athlete"}
              </Link>
              {away ? (
                <span className="block text-sm font-normal">
                  <StatusText tone="amber">{describeAvailability(away, today).replace(/^./, (letter) => letter.toUpperCase())}</StatusText>
                </span>
              ) : null}
            </span>
          </span>
        )
      },
    },
    { key: "event", header: "Event", strong: true, phone: "plain", cell: (entry) => entry.eventLabel },
    { key: "note", header: "Heat, lane or flight", phone: "line", cell: (entry) => entry.notes ?? <span className="text-sk-mute">None</span> },
    {
      key: "status",
      header: started ? "Result" : "Status",
      phone: "trailing",
      cell: (entry) =>
        entry.status === "scratched" ? (
          <Tag tone="coral">Scratched</Tag>
        ) : entry.result ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <ResultMark result={entry.result} size="sm" />
            {standings[entry.id] === "personal-best" ? <Tag tone="green">Personal best</Tag> : standings[entry.id] === "season-best" ? <Tag tone="blue">Season best</Tag> : null}
          </span>
        ) : (
          <Tag tone={started ? "yellow" : "plain"}>{started ? "No result yet" : "Entered"}</Tag>
        ),
    },
    {
      key: "detail",
      header: "Wind and place",
      phone: started ? "line" : "hide",
      className: started ? undefined : "hidden",
      cell: (entry) =>
        entry.result
          ? [entry.result.wind !== null ? `Wind ${formatWind(entry.result.wind)}` : null, !entry.result.windLegal ? "wind assisted" : null, entry.result.place ? `${ordinal(entry.result.place)} place` : null].filter(Boolean).join(", ") || "None recorded"
          : "",
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      phone: "plain",
      cell: (entry) =>
        removeEntryId === entry.id ? (
          <InlineConfirm
            className="border-y-0 py-0"
            question="Remove this entry?"
            confirmLabel="Remove entry"
            busy={busyEntryId === entry.id}
            onConfirm={() => void removeEntry(entry)}
            onCancel={() => setRemoveEntryId(null)}
          />
        ) : (
          <RowMenu
            label={`More for ${entry.athleteName ?? "athlete"}, ${entry.eventLabel}`}
            items={[
              entry.status === "entered"
                ? { label: "Scratch from this event", onSelect: () => void setStatus(entry, "scratched"), disabled: busyEntryId === entry.id }
                : { label: "Enter again", onSelect: () => void setStatus(entry, "entered"), disabled: busyEntryId === entry.id },
              { label: "Edit heat, lane or flight", onSelect: () => setNoteEntryId(entry.id) },
              ...(started && entry.status === "entered" ? [{ label: "Rounds and detail", onSelect: () => setDetailEntryId(entry.id) }] : []),
              { label: "Remove entry", danger: true, disabled: Boolean(entry.result), onSelect: () => setRemoveEntryId(entry.id) },
            ]}
          />
        ),
    },
  ]

  return (
    <Screen>
      <ScreenHeader
        back={{ to: COMPETITIONS_PATH, label: "Competitions" }}
        fact={over ? "Past competition" : started ? "On now" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`}
        title={competition.name}
        lede={[meetDatesText(competition.startDate, competition.endDate), whereText(competition), scopeText(competition)].filter(Boolean).join(", ")}
        actions={
          <>
            {competition.canManage ? (
              <LinkButton to={competitionPath(competition.id, "edit")}>
                <PencilSimple className="size-[18px]" weight="bold" aria-hidden />
                Edit
              </LinkButton>
            ) : null}
            <LinkButton to={competitionPath(competition.id, "enter")} variant={started ? "secondary" : "primary"}>
              <Plus className="size-[18px]" weight="bold" aria-hidden />
              Enter athletes
            </LinkButton>
          </>
        }
      />

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {error ? <Notice tone="error">The latest changes could not be loaded. {error}</Notice> : null}

      {started ? (
        <Segmented
          label="Entries or results"
          value={activeMode}
          onChange={setMode}
          className="self-start"
          options={[
            { value: "results", label: "Results" },
            { value: "entries", label: "Entries" },
          ]}
        />
      ) : null}

      {activeMode === "results" ? (
        <Section
          title="Results"
          hint="Type a mark like 10.84, 1:52.30 or 7.42. Tab goes across to wind and place, Enter goes down. Each cell saves as you leave it and the result goes straight into the athlete's records. For splits, every attempt or every height, open Rounds and detail on a row."
          meta={entered.length > 0 ? `${withResult} of ${entered.length} in` : undefined}
        >
          {entered.length > 0 ? (
            <>
              <Field label="Round to type" className="mb-1 sm:max-w-xs" hint={gridSlot === "final" ? undefined : "Marks typed now are saved as this round. The final stays its own result."}>
                <Select value={gridSlot} onChange={(event) => setGridSlot(event.target.value as RoundSlot)}>
                  {GRID_ROUNDS.map((round) => (
                    <option key={round.value} value={round.value}>
                      {round.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <ResultsGrid
                key={`${competition.id}:${gridSlot}:${gridVersion}`}
                competition={competition}
                standings={standings}
                slot={gridSlot}
                avatarFor={(athleteId) => avatarOf({ athleteId })}
                onOpenDetail={setDetailEntryId}
                onSaved={(entryId, result, standing, removedResultId) => {
                  // The grid speaks for itself from here on: one message at a time on the screen.
                  setNotice(null)
                  setCompetition((current) => (current ? { ...current, entries: current.entries.map((entry) => (entry.id === entryId ? withRound(entry, result, removedResultId) : entry)) } : current))
                  // The entry is known by its last round; an earlier round only adds a best, it never takes one away.
                  setStandings((current) => ({ ...current, ...(result ? { [result.id]: standing } : {}), [entryId]: gridSlot === "final" ? standing : (standing ?? current[entryId] ?? null) }))
                }}
              />
              <Button className="mt-4 self-start" size="sm" onClick={exportResults}>
                <DownloadSimple className="size-[18px]" weight="bold" aria-hidden />
                Export results (CSV)
              </Button>
            </>
          ) : (
            <EmptyState
              title="No one is entered"
              body="Enter the athletes who competed, then type their results here."
              action={
                <LinkButton to={competitionPath(competition.id, "enter")} size="sm">
                  Enter athletes
                </LinkButton>
              }
            />
          )}
        </Section>
      ) : (
        <Section title="Entries" meta={competition.entries.length > 0 ? `${plural(athleteCount, "athlete", "athletes")}, ${plural(entered.length, "event", "events")}` : undefined}>
          {competition.entries.length > 0 ? (
            <DataTable caption={`Entries for ${competition.name}`} columns={columns.filter((column) => column.key !== "detail" || started)} rows={sortedEntries} rowKey={(entry) => entry.id} />
          ) : (
            <EmptyState
              title="No one is entered yet"
              body="Pick athletes from your roster and their events in one go. Each athlete is told they are entered."
              action={
                <LinkButton to={competitionPath(competition.id, "enter")} size="sm">
                  Enter athletes
                </LinkButton>
              }
            />
          )}
        </Section>
      )}

      <Section
        title="Relays"
        meta={relays.length > 0 ? plural(relays.length, "team", "teams") : undefined}
        hint="A relay team is four athletes in running order and one time. It counts for the team's relay records, never as an athlete's own record."
      >
        {relays.length > 0 ? (
          <RelayList
            aria-label={`Relay teams at ${competition.name}`}
            relays={relays}
            actions={(relay) =>
              relay.canManage ? (
                <Button size="sm" aria-label={`Change ${relay.teamLabel}, ${relay.eventLabel}`} onClick={() => setRelayDialog(relay)}>
                  {relay.value === null && started ? "Add time" : "Change"}
                </Button>
              ) : null
            }
          />
        ) : (
          <p className="sk-list-sub">No relay teams yet.</p>
        )}
        <Button className="mt-3 self-start" size="sm" onClick={() => setRelayDialog("new")}>
          <Plus className="size-[18px]" weight="bold" aria-hidden />
          Add a relay team
        </Button>
      </Section>

      <Section title="Details">
        <FactList aria-label="Competition details">
          <Fact label="Date">{meetDatesText(competition.startDate, competition.endDate)}</Fact>
          <Fact label="Venue" empty="Not set">
            {competition.venue}
          </Fact>
          <Fact label="Town or city" empty="Not set">
            {competition.location}
          </Fact>
          <Fact label="Indoors or outdoors">{competition.environment === "indoor" ? "Indoors" : "Outdoors"}</Fact>
          <Fact label="Level" empty="Not set">
            {level}
          </Fact>
          <Fact label="Set up by">{competition.scope === "athlete" ? (competition.ownerName ?? "An athlete") : competition.scope === "club" ? "The club" : "A coach of this team"}</Fact>
          {competition.notes ? (
            <Fact label="Note" stack>
              {competition.notes}
            </Fact>
          ) : null}
        </FactList>
      </Section>

      {detailEntry ? (
        <EntryResultDialog
          key={detailEntry.id}
          entry={detailEntry}
          competition={competition}
          audience="staff"
          canEdit={(result) => result.source !== "test_week"}
          save={async (entry, input) => {
            const saved = await saveCompetitionEntryResultForStaff(entry, competition, input)
            if (!saved.ok) return saved
            lastVerdict.current = saved.data.verdict
            return ok(saved.data.result)
          }}
          onClose={() => setDetailEntryId(null)}
          onSaved={(outcome) => void afterDetail(outcome)}
        />
      ) : null}
      {relayDialog ? (
        <RelayDialog
          key={relayDialog === "new" ? "new" : relayDialog.id}
          competition={competition}
          relay={relayDialog === "new" ? null : relayDialog}
          roster={roster}
          teams={teams}
          defaultTeamId={relayTeamId}
          started={started}
          onClose={() => setRelayDialog(null)}
          onDone={(outcome) => void afterRelay(outcome)}
        />
      ) : null}
      {noteEntry ? (
        <NoteDialog
          key={noteEntry.id}
          entry={noteEntry}
          onClose={() => setNoteEntryId(null)}
          onSaved={(savedNotice) => {
            setNoteEntryId(null)
            setNotice(savedNotice)
            void load()
          }}
        />
      ) : null}
    </Screen>
  )
}
