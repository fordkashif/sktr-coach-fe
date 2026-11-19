import { Check } from "@phosphor-icons/react"
import { useMemo, useRef, useState } from "react"
import { Button, Notice } from "@/components/sk"
import { readSpreadsheetFile, rowsToText } from "@/lib/data/training-plan/excel-import"
import { getSession, putSession, setPlanWeeks, weekdayLabel, MAX_WEEKS, type PlanDraft } from "@/lib/data/training-plan/plan-builder-model"
import { parsePastedSheet, type PastedSheet } from "@/lib/data/training-plan/plan-paste"
import { placePastedDays, sessionsFromPlaced } from "./plan-sheet"
import { plural } from "./ui"

export type ReadSpreadsheet = { fileName: string; tabs: Array<{ name: string; sheet: PastedSheet }> }

const ACCEPT = ".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/**
 * A hidden file input and a way to open it. The chosen file is read into tabs, each tab read like
 * pasted rows. Opening it straight from the button keeps it one tap on a phone.
 */
export function useSpreadsheetPicker(onRead: (read: ReadSpreadsheet) => void) {
  const input = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const element = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-spreadsheet-input
      onChange={async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ""
        if (!file) return
        setError(null)
        setReading(true)
        try {
          const tabs = await readSpreadsheetFile(file)
          if (tabs.length === 0) throw new Error("There is nothing in this file.")
          onRead({ fileName: file.name, tabs: tabs.map((tab) => ({ name: tab.name, sheet: parsePastedSheet(rowsToText(tab.rows)) })) })
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "This file could not be read.")
        } finally {
          setReading(false)
        }
      }}
    />
  )

  return { element, open: () => input.current?.click(), error, reading, clearError: () => setError(null) }
}

/** A tab is used when it reads like a training sheet and has rows in it. */
function usable(sheet: PastedSheet) {
  return sheet.looksLikePlan && sheet.exerciseCount > 0
}

/**
 * What a file holds, tab by tab, and which weeks each tab fills: the first ticked tab fills
 * `startWeek`, the next the week after, and so on. A tab of best lifts or notes is left out.
 */
export function SpreadsheetImport({
  plan,
  read,
  startWeek,
  onChooseAnother,
  onApply,
}: {
  plan: PlanDraft
  read: ReadSpreadsheet
  startWeek: number
  onChooseAnother: () => void
  onApply: (next: PlanDraft, weeksFilled: number[]) => void
}) {
  const [chosen, setChosen] = useState<boolean[]>(() => read.tabs.map((tab) => usable(tab.sheet)))
  const roomFor = MAX_WEEKS - startWeek + 1

  const targets = useMemo(() => {
    let week = startWeek - 1
    return read.tabs.map((tab, index) => (chosen[index] && week - startWeek + 1 < roomFor ? (week += 1) : null))
  }, [chosen, read.tabs, roomFor, startWeek])
  const weeks = targets.filter((week): week is number => week !== null)
  const lastWeek = weeks.length > 0 ? weeks[weeks.length - 1] : startWeek
  const grown = setPlanWeeks(plan, Math.max(plan.weeks, lastWeek))

  const replaced = read.tabs.reduce((sum, tab, index) => {
    const week = targets[index]
    if (week === null) return sum
    return sum + placePastedDays(grown, week, tab.sheet).placed.filter((entry) => getSession(grown, week, entry.slot.index)).length
  }, 0)

  const apply = () => {
    let next = grown
    read.tabs.forEach((tab, index) => {
      const week = targets[index]
      if (week === null) return
      const sessions = sessionsFromPlaced(next, week, placePastedDays(next, week, tab.sheet).placed)
      next = sessions.reduce((current, session) => putSession(current, session), next)
    })
    onApply(next, weeks)
  }

  const fillLabel = weeks.length === 0 ? "Tick a tab to fill" : weeks.length === 1 ? `Fill week ${weeks[0]}` : `Fill weeks ${weeks[0]} to ${lastWeek}`

  return (
    <div className="flex flex-col gap-3" data-spreadsheet-import>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 break-words text-lg font-extrabold" data-file-name>
          {read.fileName}
        </p>
        <button type="button" className="sk-link text-[0.9375rem] font-bold" onClick={onChooseAnother}>
          Another file
        </button>
      </div>
      <ul className="flex flex-col gap-2" aria-label="Tabs in the file">
        {read.tabs.map((tab, index) => {
          const ok = usable(tab.sheet)
          const on = chosen[index]
          const week = targets[index]
          const placed = ok ? placePastedDays(grown, week ?? startWeek, tab.sheet).placed : []
          return (
            <li key={`${index}:${tab.name}`} className="sk-import-tab" data-on={on ? "" : undefined} data-tab={tab.name}>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={on}
                  disabled={!ok}
                  onChange={(event) => setChosen((current) => current.map((value, position) => (position === index ? event.target.checked : value)))}
                />
                <span className="sk-import-check" aria-hidden>
                  {on ? <Check className="size-4" weight="bold" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold">{tab.name}</span>
                  <span className="block text-sm text-sk-mute">
                    {ok ? `${plural(placed.length, "day")}, ${plural(tab.sheet.exerciseCount, "exercise")}` : "No training days found"}
                  </span>
                </span>
                <span className="sk-import-week">{week !== null ? `Week ${week}` : "Skipped"}</span>
              </label>
              {ok && on ? (
                <span className="mt-2.5 flex flex-wrap gap-1" aria-label={`${tab.name} days`}>
                  {placed.map(({ slot, count }) => (
                    <span key={slot.index} className="sk-board-chip">
                      {weekdayLabel(slot.date)} {count}
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
      {replaced > 0 ? <Notice tone="warning">{plural(replaced, "day")} already {replaced === 1 ? "has a session" : "have sessions"}. Filling replaces them.</Notice> : null}
      <Button variant="primary" disabled={weeks.length === 0} onClick={apply}>
        {fillLabel}
      </Button>
    </div>
  )
}
