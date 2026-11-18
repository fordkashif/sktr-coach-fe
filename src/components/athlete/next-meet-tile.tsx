import { Link } from "react-router-dom"
import { meetDatesText } from "@/components/athlete/results-parts"
import type { CompetitionWithEntries } from "@/lib/data/competition/types"
import { parseLocalDay } from "@/lib/data/pr/pr-display"

function whereText(competition: CompetitionWithEntries): string {
  return [competition.venue, competition.location].filter(Boolean).join(", ")
}

/** The next meet as the accent tile: name, dates and place, the events, and the days to go as a scoreboard number. */
export function NextMeetTile({ competition, today }: { competition: CompetitionWithEntries; today: Date }) {
  const day = parseLocalDay(competition.startDate)
  const days = day ? Math.round((day.getTime() - today.getTime()) / 86_400_000) : null
  const entered = competition.entries.filter((entry) => entry.status === "entered")
  return (
    <Link
      to={`/athlete/competitions/${competition.id}`}
      className="sk-tile sk-tile-accent flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between"
      data-next-meet={competition.name}
    >
      <span className="min-w-0">
        <span className="block text-[0.75rem] font-extrabold uppercase tracking-[0.04em] opacity-85">Next up</span>
        <span className="mt-1 block font-display text-[2rem] font-black uppercase leading-[0.9]">{competition.name}</span>
        <span className="mt-1.5 block text-sm opacity-90">{[meetDatesText(competition.startDate, competition.endDate), whereText(competition)].filter(Boolean).join(", ")}</span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          {entered.length > 0 ? (
            entered.map((entry, index) => (
              <span key={entry.id} className="rounded-full bg-white px-3 py-1 text-sm font-bold text-sk-ink">
                {index > 0 ? <span className="sr-only">, </span> : null}
                {entry.eventLabel}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold">You are not entered yet</span>
          )}
        </span>
      </span>
      {days !== null ? (
        <span className="shrink-0 sm:text-right">
          {days <= 0 ? (
            <span className="block font-display text-[2.75rem] font-black uppercase leading-[0.9]">On now</span>
          ) : days === 1 ? (
            <span className="block font-display text-[2.75rem] font-black uppercase leading-[0.9]">Tomorrow</span>
          ) : (
            <span className="block font-display text-[3.5rem] font-black leading-[0.85] tabular-nums">
              {days}
              <span className="ml-1 text-[1.25rem] uppercase">days</span>
            </span>
          )}
        </span>
      ) : null}
    </Link>
  )
}

