import { Flag, Trophy } from "@phosphor-icons/react"
import { useEffect, useId, useMemo, useState } from "react"
import { Button, Field, GroupDot, Input, List, ListRow, Section, Select } from "@/components/sk"
import { loadTeamCalendar } from "@/lib/data/calendar/calendar-data"
import { formatDateRange, slotDate, type PlanDraft } from "@/lib/data/training-plan/plan-builder-model"
import {
  PHASE_COLORS,
  PHASE_COLOR_LABELS,
  PHASE_NAME_MAX,
  PHASE_PRESETS,
  assignPhase,
  nextPhaseColor,
  phaseForWeek,
  phaseWeeksText,
  plannedWeekLoad,
  removePhase,
  weekTypeLabel,
  weeksTouched,
  type PhaseColor,
} from "@/lib/data/training-plan/plan-phases"
import { cn } from "@/lib/utils"
import { plural } from "./ui"

/** A competition or test week of the plan's team that falls inside the plan. Read only here. */
export type PlanMarker = { kind: "competition" | "test-week"; title: string; startsOn: string; endsOn: string }

const PHASE_BAR: Record<PhaseColor, string> = { blue: "bg-sk-blue", green: "bg-sk-green", yellow: "bg-sk-yellow", coral: "bg-sk-coral", ink: "bg-sk-ink" }
const TYPE_SHORT: Record<string, string> = { build: "Build", hold: "Hold", deload: "Deload", test: "Test", competition: "Comp" }

/** Competitions and test weeks of the team in the plan's dates, from the team calendar. Nothing is shown if they cannot be read. */
export function usePlanMarkers(plan: Pick<PlanDraft, "teamId" | "startDate" | "weeks">, teamName: string | null): PlanMarker[] {
  const [markers, setMarkers] = useState<PlanMarker[]>([])
  const { teamId, startDate, weeks } = plan
  useEffect(() => {
    let cancelled = false
    if (!teamId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setMarkers([])
      return
    }
    const range = { from: startDate, to: slotDate({ startDate }, weeks, 6) }
    void loadTeamCalendar({ team: { id: teamId, name: teamName ?? "Team" }, range }).then((result) => {
      if (cancelled) return
      setMarkers(
        result.ok
          ? result.data.items.flatMap((item): PlanMarker[] => (item.kind === "competition" || item.kind === "test-week" ? [{ kind: item.kind, title: item.title, startsOn: item.startsOn, endsOn: item.endsOn }] : []))
          : [],
      )
    })
    return () => {
      cancelled = true
    }
  }, [teamId, teamName, startDate, weeks])
  return markers
}

/**
 * The whole plan at a glance: one column per week with its phase, the kind of week, a bar for the
 * planned load and marks for competitions and test weeks. A week is a button that opens it.
 * "Phases" opens the editor under the strip: pick a range of weeks (in the strip or in the two
 * fields) and give it a phase.
 */
export function PlanOverview({
  plan,
  activeWeek,
  markers,
  onSelectWeek,
  onChange,
}: {
  plan: PlanDraft
  activeWeek: number
  markers: PlanMarker[]
  onSelectWeek: (week: number) => void
  onChange: (updater: (plan: PlanDraft) => PlanDraft) => void
}) {
  const [editing, setEditing] = useState(false)
  const [range, setRange] = useState<{ from: number; to: number }>({ from: 1, to: 1 })
  // True after one click in the strip: the next click sets the other end of the range.
  const [anchored, setAnchored] = useState(false)
  const [name, setName] = useState("")
  const [color, setColor] = useState<PhaseColor>("blue")
  const presetsId = useId()

  const phases = useMemo(() => plan.phases ?? [], [plan.phases])
  const weeks = Array.from({ length: plan.weeks }, (_, index) => index + 1)
  const loads = weeks.map((week) => plannedWeekLoad(plan.sessions, week))
  const targets = weeks.map((week) => plan.weekTargetLoad?.[String(week)] ?? null)
  const peak = Math.max(1, ...loads.map((entry) => entry.load ?? 0), ...targets.map((target) => target ?? 0))
  const markersByWeek = new Map<number, PlanMarker[]>()
  for (const marker of markers) {
    for (const week of weeksTouched(plan.startDate, plan.weeks, marker.startsOn, marker.endsOn)) markersByWeek.set(week, [...(markersByWeek.get(week) ?? []), marker])
  }
  const hasLoad = loads.some((entry) => entry.load !== null) || targets.some((target) => target !== null)
  const from = Math.min(range.from, range.to, plan.weeks)
  const to = Math.min(Math.max(range.from, range.to), plan.weeks)

  const openEditor = () => {
    setEditing(true)
    setRange({ from: activeWeek, to: activeWeek })
    setAnchored(false)
    setName("")
    setColor(nextPhaseColor(phases))
  }

  const clickWeek = (week: number) => {
    onSelectWeek(week)
    if (!editing) return
    if (anchored) {
      setRange((current) => ({ from: Math.min(current.from, week), to: Math.max(current.from, week) }))
      setAnchored(false)
    } else {
      setRange({ from: week, to: week })
      setAnchored(true)
    }
  }

  const assign = () => {
    const clean = name.trim()
    if (!clean) return
    onChange((current) => ({ ...current, phases: assignPhase(current.phases ?? [], { name: clean, color, fromWeek: from, toWeek: to }, current.weeks) }))
    setName("")
    setAnchored(false)
    setColor(nextPhaseColor([...phases, { id: "new", name: clean, color, startWeek: from, endWeek: to }]))
  }

  // Phase bands: one cell per run of weeks, so a phase is one piece across its weeks.
  const bands: Array<{ key: string; span: number; phaseId: string | null }> = []
  for (const week of weeks) {
    const phase = phaseForWeek(phases, week)
    const last = bands[bands.length - 1]
    if (last && last.phaseId === (phase?.id ?? null)) last.span += 1
    else bands.push({ key: `band-${week}`, span: 1, phaseId: phase?.id ?? null })
  }

  // Columns stay narrow enough to read as a strip: a short plan sits on the left, a long one scrolls inside the strip.
  const columns = { gridTemplateColumns: `repeat(${plan.weeks}, minmax(3rem, 6rem))` }

  return (
    <Section
      title="Plan overview"
      hint={hasLoad ? "Bars are the planned load of each week: minutes times intended effort. A line marks a target." : "Every week at a glance. Pick a week to open it."}
      action={
        <Button variant="quiet" size="sm" aria-expanded={editing} onClick={() => (editing ? setEditing(false) : openEditor())}>
          {editing ? "Close phases" : phases.length > 0 ? "Edit phases" : "Add phases"}
        </Button>
      }
      aria-label="Plan overview"
    >
      <div className="overflow-x-auto pb-1 [scrollbar-width:thin]" data-plan-overview>
        <div className="min-w-full" style={{ width: "max-content" }}>
          {phases.length > 0 ? (
            <div className="grid gap-x-1" style={columns} aria-hidden>
              {bands.map((band) => {
                const phase = phases.find((entry) => entry.id === band.phaseId)
                return (
                  <div key={band.key} style={{ gridColumn: `span ${band.span}` }} className="min-w-0 pb-1.5">
                    {phase ? (
                      <>
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-sk-ink" title={phase.name}>
                          <GroupDot color={phase.color} />
                          <span className="truncate">{phase.name}</span>
                        </p>
                        <div className={cn("mt-1 h-1 rounded-full", PHASE_BAR[phase.color])} />
                      </>
                    ) : (
                      <div className="mt-6 h-1 rounded-full bg-sk-soft-2" />
                    )}
                  </div>
                )
              })}
            </div>
          ) : null}

          <ol className="grid gap-x-1" style={columns} aria-label="Weeks of the plan">
            {weeks.map((week, index) => {
              const phase = phaseForWeek(phases, week)
              const type = plan.weekTypes?.[String(week)] ?? null
              const load = loads[index]
              const target = targets[index]
              const weekMarkers = markersByWeek.get(week) ?? []
              const hasCompetition = weekMarkers.some((marker) => marker.kind === "competition")
              const hasTest = weekMarkers.some((marker) => marker.kind === "test-week")
              const selected = editing && week >= from && week <= to
              const words = [
                `Open week ${week}`,
                formatDateRange(slotDate(plan, week, 0), slotDate(plan, week, 6)),
                phase ? phase.name : null,
                type ? `${weekTypeLabel(type)} week` : null,
                load.sessions === 0 ? "no sessions" : plural(load.sessions, "session"),
                load.load !== null ? `planned load ${load.load}` : null,
                target !== null ? `target ${target}` : null,
                ...weekMarkers.map((marker) => `${marker.kind === "competition" ? "Competition" : "Test week"}: ${marker.title}`),
              ]
                .filter(Boolean)
                .join(", ")
              return (
                <li key={week} className="min-w-0">
                  <button
                    type="button"
                    data-overview-week={week}
                    data-week-type={type ?? undefined}
                    data-phase={phase?.name}
                    aria-label={words}
                    aria-current={week === activeWeek ? "true" : undefined}
                    aria-pressed={editing ? selected : undefined}
                    title={words}
                    onClick={() => clickWeek(week)}
                    className={cn(
                      "flex w-full cursor-pointer flex-col items-center gap-1 rounded-[10px] px-0.5 pb-1.5 pt-1 transition-colors hover:bg-sk-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sk-blue",
                      selected ? "bg-sk-blue-tint hover:bg-sk-blue-tint" : null,
                    )}
                  >
                    {/* The bar: planned load from the bottom, the target as a line across. */}
                    <span className="relative flex h-12 w-full items-end justify-center border-b border-sk-line" aria-hidden>
                      {load.load !== null ? <span className="w-5 rounded-t-[3px] bg-sk-faint" style={{ height: `${Math.max(6, Math.round((load.load / peak) * 100))}%` }} /> : null}
                      {target !== null ? <span className="absolute inset-x-1 h-0.5 bg-sk-ink" style={{ bottom: `${Math.round((target / peak) * 100)}%` }} /> : null}
                    </span>
                    <span className={cn("text-[0.9375rem] font-bold tabular-nums", week === activeWeek ? "text-sk-blue-ink" : "text-sk-ink")}>{week}</span>
                    <span className="h-4 text-xs font-medium leading-4 text-sk-mute">{type ? TYPE_SHORT[type] : ""}</span>
                    <span className="flex h-4 items-center gap-0.5 text-sk-ink-2" aria-hidden>
                      {hasCompetition ? <Trophy className="size-3.5" weight="fill" /> : null}
                      {hasTest ? <Flag className="size-3.5" weight="fill" /> : null}
                    </span>
                    <span className={cn("h-0.5 w-6 rounded-full", week === activeWeek ? "bg-sk-blue" : "bg-transparent")} aria-hidden />
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </div>

      {markers.length > 0 ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-sk-mute">
          <span className="inline-flex items-center gap-1">
            <Trophy className="size-3.5 text-sk-ink-2" weight="fill" aria-hidden />
            Competition
          </span>
          <span className="inline-flex items-center gap-1">
            <Flag className="size-3.5 text-sk-ink-2" weight="fill" aria-hidden />
            Test week
          </span>
          <span>From the team calendar.</span>
        </p>
      ) : null}

      {editing ? (
        <div className="mt-3 border-t border-sk-line pt-3" role="group" aria-label="Phases">
          {phases.length > 0 ? (
            <List aria-label="Phases of this plan">
              {phases.map((phase) => (
                <ListRow
                  key={phase.id}
                  leading={<GroupDot color={phase.color} />}
                  title={phase.name}
                  subtitle={phaseWeeksText(phase)}
                  trailing={
                    <Button variant="quiet" size="sm" aria-label={`Remove the phase ${phase.name}`} onClick={() => onChange((current) => ({ ...current, phases: removePhase(current.phases ?? [], phase.id) }))}>
                      Remove
                    </Button>
                  }
                />
              ))}
            </List>
          ) : null}
          <p className="mt-2 text-[0.9375rem] text-sk-ink-2">
            <span className="font-semibold text-sk-ink">Give a run of weeks a phase.</span> Click the first and the last week above, or pick them here. Weeks that already have a phase make room.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Field label="Phase name" className="col-span-2 lg:col-span-1">
              <Input value={name} maxLength={PHASE_NAME_MAX} list={presetsId} placeholder="General prep" autoComplete="off" onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="From week">
              <Select value={from} onChange={(event) => setRange({ from: Number(event.target.value), to: Math.max(Number(event.target.value), to) })}>
                {weeks.map((week) => (
                  <option key={week} value={week}>
                    Week {week}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To week">
              <Select value={to} onChange={(event) => setRange({ from: Math.min(from, Number(event.target.value)), to: Number(event.target.value) })}>
                {weeks.map((week) => (
                  <option key={week} value={week}>
                    Week {week}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dot colour" className="col-span-2 lg:col-span-1">
              <Select value={color} onChange={(event) => setColor(event.target.value as PhaseColor)}>
                {PHASE_COLORS.map((option) => (
                  <option key={option} value={option}>
                    {PHASE_COLOR_LABELS[option]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <datalist id={presetsId}>
            {PHASE_PRESETS.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!name.trim()} onClick={assign}>
              {from === to ? `Set phase for week ${from}` : `Set phase for weeks ${from} to ${to}`}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  )
}
