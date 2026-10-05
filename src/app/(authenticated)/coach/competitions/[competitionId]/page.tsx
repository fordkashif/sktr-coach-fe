"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DownloadSimple, PencilSimple, Plus } from "@phosphor-icons/react"
import { Link, useLocation, useParams } from "react-router-dom"
import { meetDatesText, ordinal, ResultMark } from "@/components/athlete/results-parts"
import { COMPETITIONS_PATH, competitionPath, plural, scopeText, whereText } from "@/components/coach/competitions/competition-parts"
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
  updateCompetitionEntry,
  type EntryStanding,
} from "@/lib/data/competition/competition-data"
import { COMPETITION_LEVELS, type CompetitionEntryWithResult, type CompetitionWithEntries } from "@/lib/data/competition/types"
import { formatWind } from "@/lib/data/pr/marks"
import { localDayKey, parseLocalDay } from "@/lib/data/pr/pr-display"

type SavedNotice = { tone: "success" | "warning" | "info"; text: string }
type Mode = "entries" | "results"

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

  const load = useCallback(async () => {
    const result = await getCompetitionForStaff(competitionId, { teamId: coachTeamId })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setError(null)
    setCompetition(result.data)
    if (!result.data) return
    const athleteIds = [...new Set(result.data.entries.map((entry) => entry.athleteId))]
    const [standingsResult, availabilityResult] = await Promise.all([getEntryStandings(result.data), listAthleteAvailability(athleteIds, { from: result.data.startDate })])
    if (standingsResult.ok) setStandings(standingsResult.data)
    if (availabilityResult.ok) setAvailability(availabilityResult.data)
  }, [competitionId, coachTeamId])

  useEffect(() => {
    if (coachTeamsLoading) return
    void load()
  }, [coachTeamsLoading, load])

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

  const exportResults = () => downloadCsv(csvFileName(competition.name, competition.startDate, "results"), competitionResultsRows(competition, standings))

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
          hint="Type a mark like 10.84, 1:52.30 or 7.42. Tab goes across to wind and place, Enter goes down. Each cell saves as you leave it and the result goes straight into the athlete's records."
          meta={entered.length > 0 ? `${withResult} of ${entered.length} in` : undefined}
        >
          {entered.length > 0 ? (
            <>
              <ResultsGrid
                key={competition.id}
                competition={competition}
                standings={standings}
                avatarFor={(athleteId) => avatarOf({ athleteId })}
                onSaved={(entryId, result, standing) => {
                  // The grid speaks for itself from here on: one message at a time on the screen.
                  setNotice(null)
                  patchEntry(entryId, { result })
                  setStandings((current) => ({ ...current, [entryId]: standing }))
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
