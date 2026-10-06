import { clubToday } from "@/lib/club-day"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { repeatTarget, setCount, setKey, type LogField } from "@/components/athlete/log/use-session-log"
import { cleanMinutes } from "@/lib/data/load/training-load"
import { loadAthleteSessionForCoach, saveAthleteCompletionForCoach, saveAthleteRowLogsForCoach, type CoachLogDay } from "@/lib/data/coach/athlete-log-data"
import { cleanEffort, NOTE_MAX_LENGTH } from "@/lib/data/session/log-assist"
import { MAX_SETS, targetValues } from "@/lib/data/session/session-from-plan"
import type { LoggableRow, SessionRowLog } from "@/lib/data/session/types"
import { useViewerBlocks } from "@/lib/use-viewer-session"

type LogMap = Record<string, SessionRowLog>
export type CoachLogSaveState = { status: "idle" | "saving" | "saved" | "error"; message: string | null }

const SEND_DELAY_MS = 500

function emptyLog(rowId: string, setIndex: number): SessionRowLog {
  return { rowId, setIndex, completed: false, reps: null, loadKg: null, timeSeconds: null, distanceM: null, mark: null, rpe: null, note: null }
}

/**
 * A coach entering one athlete's session of one day. The same moves as the athlete's own log
 * (tick, type, same as target, repeat a set, effort, note) and the same save as you go, but sent
 * straight to the backend: a coach at a desk does not need the athlete's offline outbox. What has
 * not been sent yet is kept in memory and sent again by "Try again" or by finishing.
 */
export function useCoachSessionLog(athleteId: string, date: string) {
  const [day, setDay] = useState<CoachLogDay | null>(null)
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null)
  const [logs, setLogs] = useState<LogMap>({})
  const [extraSets, setExtraSets] = useState<Record<string, number>>({})
  const [wrapUp, setWrapUp] = useState<{ rpe: number | null; comment: string; minutes: string }>({ rpe: null, comment: "", minutes: "" })
  const [save, setSave] = useState<CoachLogSaveState>({ status: "idle", message: null })
  const [reloadToken, setReloadToken] = useState(0)
  const logsRef = useRef<LogMap>({})
  const pending = useRef<Map<string, SessionRowLog>>(new Map())
  const timer = useRef<number | null>(null)
  const sending = useRef<Promise<boolean> | null>(null)
  const sessionId = day?.session?.id ?? null
  const sessionIdRef = useRef<string | null>(null)
  sessionIdRef.current = sessionId

  useEffect(() => {
    let cancelled = false
    setDay(null)
    setLoadError(null)
    pending.current = new Map()
    void loadAthleteSessionForCoach(athleteId, date).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setLoadError({ notFound: result.error.code === "NOT_FOUND" || result.error.code === "FORBIDDEN", message: result.error.message })
        return
      }
      setDay(result.data)
      logsRef.current = Object.fromEntries((result.data.session?.logs ?? []).map((log) => [setKey(log.rowId, log.setIndex), log]))
      setLogs(logsRef.current)
      setExtraSets({})
      setWrapUp({
        rpe: result.data.session?.overallRpe ?? null,
        comment: result.data.session?.athleteComment ?? "",
        minutes: String(result.data.session?.durationMinutes ?? result.data.session?.estimatedDurationMinutes ?? ""),
      })
      setSave({ status: "idle", message: null })
    })
    return () => {
      cancelled = true
    }
  }, [athleteId, date, reloadToken])

  /** Sends everything not sent yet. Resolves true when nothing is left. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (sending.current) await sending.current
    const id = sessionIdRef.current
    if (!id || pending.current.size === 0) return true
    const batch = new Map(pending.current)
    setSave({ status: "saving", message: null })
    const run = (async () => {
      const result = await saveAthleteRowLogsForCoach(athleteId, id, [...batch.values()])
      if (!result.ok) {
        setSave({ status: "error", message: result.error.message })
        return false
      }
      // Only drop what was sent and has not changed while the request was in the air.
      for (const [key, sent] of batch) if (pending.current.get(key) === sent) pending.current.delete(key)
      return true
    })()
    sending.current = run
    const sent = await run
    sending.current = null
    if (!sent) return false
    if (pending.current.size > 0) return flush()
    setSave({ status: "saved", message: null })
    return true
  }, [athleteId])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const commit = useCallback(
    (next: SessionRowLog) => {
      if (!sessionIdRef.current) return
      const key = setKey(next.rowId, next.setIndex)
      logsRef.current = { ...logsRef.current, [key]: next }
      setLogs(logsRef.current)
      pending.current.set(key, next)
      setSave((current) => (current.status === "error" ? current : { status: "saving", message: null }))
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        timer.current = null
        void flush()
      }, SEND_DELAY_MS)
    },
    [flush],
  )

  const currentLog = useCallback((rowId: string, setIndex: number) => logsRef.current[setKey(rowId, setIndex)] ?? emptyLog(rowId, setIndex), [])

  /** Fills blanks from the coach target, or failing that from the set before. */
  const filled = useCallback((row: LoggableRow, base: SessionRowLog, previous: SessionRowLog | null): SessionRowLog => {
    const target = targetValues(row)
    return {
      ...base,
      completed: true,
      reps: base.reps ?? target.reps ?? (row.kind === "strength" ? (previous?.reps ?? null) : null),
      loadKg: base.loadKg ?? target.loadKg ?? (row.kind === "strength" ? (previous?.loadKg ?? null) : null),
      timeSeconds: base.timeSeconds ?? target.timeSeconds ?? null,
      distanceM: base.distanceM ?? target.distanceM ?? null,
      mark: base.mark ?? target.mark ?? null,
    }
  }, [])

  const toggleSet = useCallback(
    (row: LoggableRow, setIndex: number) => {
      const existing = currentLog(row.id, setIndex)
      if (existing.completed) commit({ ...existing, completed: false })
      else commit(filled(row, existing, setIndex > 1 ? currentLog(row.id, setIndex - 1) : null))
    },
    [commit, currentLog, filled],
  )

  const setValue = useCallback(
    (row: LoggableRow, setIndex: number, field: LogField, value: number | null) => {
      const existing = currentLog(row.id, setIndex)
      if (existing[field] === value) return
      const next = { ...existing, [field]: value }
      // Typing a result counts as doing the set. Clearing it does not untick it.
      if (value !== null) next.completed = true
      if (value !== null && row.kind === "time" && next.distanceM === null) next.distanceM = targetValues(row).distanceM ?? null
      commit(next)
    },
    [commit, currentLog],
  )

  const setEffort = useCallback(
    (row: LoggableRow, setIndex: number, rpe: number | null) => {
      const existing = currentLog(row.id, setIndex)
      const next = cleanEffort(rpe)
      if ((existing.rpe ?? null) !== next) commit({ ...existing, rpe: next })
    },
    [commit, currentLog],
  )

  /** The note for one exercise. It lives on the lowest set that already has one, else on set 1. */
  const setRowNote = useCallback(
    (row: LoggableRow, text: string) => {
      const holder = Object.values(logsRef.current)
        .filter((log) => log.rowId === row.id && typeof log.note === "string" && log.note !== "")
        .sort((left, right) => left.setIndex - right.setIndex)[0]
      const existing = currentLog(row.id, holder?.setIndex ?? 1)
      const next = text.slice(0, NOTE_MAX_LENGTH) || null
      if ((existing.note ?? null) !== next) commit({ ...existing, note: next })
    },
    [commit, currentLog],
  )

  const fillRowFromTarget = useCallback(
    (row: LoggableRow) => {
      const count = setCount(row, logsRef.current)
      let previous: SessionRowLog | null = null
      for (let setIndex = 1; setIndex <= count; setIndex += 1) {
        const existing = currentLog(row.id, setIndex)
        const next: SessionRowLog = existing.completed ? existing : filled(row, existing, previous)
        if (!existing.completed) commit(next)
        previous = next
      }
    },
    [commit, currentLog, filled],
  )

  /** Copies the last ticked set into the next open one and ticks it. */
  const repeatLastSet = useCallback(
    (row: LoggableRow, shownCount: number) => {
      const target = repeatTarget(row, logsRef.current, shownCount)
      if (!target) return
      const source = currentLog(row.id, target.from)
      if (target.to > shownCount) setExtraSets((current) => ({ ...current, [row.id]: (current[row.id] ?? 0) + 1 }))
      commit({ ...source, setIndex: target.to, completed: true, rpe: currentLog(row.id, target.to).rpe ?? null, note: currentLog(row.id, target.to).note ?? null })
    },
    [commit, currentLog],
  )

  const addSet = useCallback((row: LoggableRow) => {
    setExtraSets((current) => ({ ...current, [row.id]: (current[row.id] ?? 0) + 1 }))
  }, [])

  /** Sends what is left, then marks the session done. Resolves true when both reached the backend. */
  const finish = useCallback(async (): Promise<boolean> => {
    const session = day?.session
    if (!session) return false
    if (!(await flush())) return false
    setSave({ status: "saving", message: null })
    const result = await saveAthleteCompletionForCoach(athleteId, session.id, {
      completionDate: session.completedOn ?? clubToday(),
      rpe: wrapUp.rpe,
      comment: wrapUp.comment.trim() || null,
      durationMinutes: cleanMinutes(wrapUp.minutes),
    })
    if (!result.ok) {
      setSave({ status: "error", message: result.error.message })
      return false
    }
    setSave({ status: "saved", message: null })
    return true
  }, [athleteId, day?.session, flush, wrapUp.comment, wrapUp.minutes, wrapUp.rpe])

  const totals = useMemo(() => {
    let total = 0
    let done = 0
    for (const block of day?.session?.blocks ?? []) {
      for (const row of block.rows) {
        const count = Math.min(setCount(row, logs) + (extraSets[row.id] ?? 0), MAX_SETS)
        total += count
        for (let setIndex = 1; setIndex <= count; setIndex += 1) if (logs[setKey(row.id, setIndex)]?.completed) done += 1
      }
    }
    return { total, done }
  }, [day?.session?.blocks, extraSets, logs])

  // Targets in the coach's own unit (kilograms or pounds). What is logged stays in kilograms.
  const viewBlocks = useViewerBlocks(day?.session?.blocks, athleteId)
  const viewDay = useMemo(() => (day?.session && viewBlocks !== day.session.blocks ? { ...day, session: { ...day.session, blocks: viewBlocks } } : day), [day, viewBlocks])

  return {
    day: viewDay,
    session: viewDay?.session ?? null,
    loadError,
    reload: () => setReloadToken((value) => value + 1),
    logs,
    extraSets,
    wrapUp,
    updateWrapUp: (patch: Partial<{ rpe: number | null; comment: string; minutes: string }>) => setWrapUp((current) => ({ ...current, ...patch })),
    toggleSet,
    setValue,
    setEffort,
    setRowNote,
    fillRowFromTarget,
    repeatLastSet,
    addSet,
    finish,
    retry: () => void flush(),
    save,
    totals,
  }
}
