import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { dateKeyLocal, parseSessionCompletions, SESSION_COMPLETIONS_STORAGE_KEY } from "@/lib/athlete-session"
import {
  addExtraExercise,
  deleteExtraSession,
  loadAthleteSessionDay,
  loadLastTime,
  skipSession,
  unskipSession,
} from "@/lib/data/session/session-log-data"
import {
  flushSessionOutbox,
  getSyncState,
  pendingForSession,
  queueCompletion,
  queueRowLog,
  resumeSessionOutbox,
  subscribeSyncState,
} from "@/lib/data/session/session-log-sync"
import type { Result } from "@/lib/data/result"
import { exerciseKey, MAX_SETS, targetValues } from "@/lib/data/session/session-from-plan"
import type {
  AthleteSession,
  AthleteSessionDay,
  ExtraExerciseInput,
  LastTimeResult,
  LoggableRow,
  SessionRowLog,
  SkipReason,
} from "@/lib/data/session/types"
import { getBackendMode } from "@/lib/supabase/config"
import { tenantStorageKey } from "@/lib/tenant-storage"

const DAY_CACHE_KEY = "pacelab:session-day-cache:v2"
const WRAP_UP_KEY = "pacelab:session-wrap-up:v1"

type LogMap = Record<string, SessionRowLog>
type WrapUp = { rpe: number | null; comment: string }
export type LogField = "reps" | "loadKg" | "timeSeconds" | "mark"

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(key))
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(tenantStorageKey(key), JSON.stringify(value))
  } catch {
    // Best effort only.
  }
}

/** Last few loaded days, so the session still opens with no signal. */
function cacheKey(date: string, sessionId: string | null) {
  return sessionId ? `${date}|${sessionId}` : date
}

function cacheDay(day: AthleteSessionDay, sessionId: string | null) {
  const cache = readJson<Record<string, AthleteSessionDay>>(DAY_CACHE_KEY, {})
  cache[cacheKey(day.date, sessionId)] = day
  const keep = Object.keys(cache).sort().slice(-10)
  writeJson(DAY_CACHE_KEY, Object.fromEntries(keep.map((key) => [key, cache[key]])))
}

export function setKey(rowId: string, setIndex: number) {
  return `${rowId}:${setIndex}`
}

function emptyLog(rowId: string, setIndex: number): SessionRowLog {
  return { rowId, setIndex, completed: false, reps: null, loadKg: null, timeSeconds: null, distanceM: null, mark: null }
}

function toMap(logs: SessionRowLog[]): LogMap {
  return Object.fromEntries(logs.map((log) => [setKey(log.rowId, log.setIndex), log]))
}

/** Unsent local entries win over what the backend returned. */
function withPending(day: AthleteSessionDay): AthleteSessionDay {
  if (!day.session) return day
  const pending = pendingForSession(day.session.id)
  if (pending.logs.length === 0 && !pending.completion) return day
  const merged = { ...toMap(day.session.logs), ...toMap(pending.logs) }
  const session: AthleteSession = {
    ...day.session,
    logs: Object.values(merged),
    ...(pending.completion
      ? {
          skipReason: null,
          skipNote: null,
          status: "completed" as const,
          completedOn: day.session.completedOn ?? pending.completion.completionDate,
          overallRpe: pending.completion.rpe,
          athleteComment: pending.completion.comment,
        }
      : {}),
  }
  return { ...day, session }
}

export function setCount(row: LoggableRow, logs: LogMap) {
  let highest = row.targetSets
  for (const log of Object.values(logs)) if (log.rowId === row.id && log.setIndex > highest) highest = log.setIndex
  return Math.min(highest, MAX_SETS)
}

function hasValues(log: SessionRowLog | undefined) {
  return Boolean(log && (log.reps !== null || log.loadKg !== null || log.timeSeconds !== null || log.mark !== null))
}

/**
 * "Repeat set 2": the last set that was ticked with numbers in it, and the next open set it would be
 * copied into. Null when there is nothing to copy or nowhere to put it.
 */
export function repeatTarget(row: LoggableRow, logs: LogMap, count: number): { from: number; to: number } | null {
  if (row.kind === "check") return null
  let from = 0
  for (let setIndex = 1; setIndex <= count; setIndex += 1) {
    const log = logs[setKey(row.id, setIndex)]
    if (log?.completed && hasValues(log)) from = setIndex
  }
  if (from === 0) return null
  for (let setIndex = from + 1; setIndex <= count; setIndex += 1) {
    if (!logs[setKey(row.id, setIndex)]?.completed) return { from, to: setIndex }
  }
  for (let setIndex = 1; setIndex < from; setIndex += 1) {
    if (!logs[setKey(row.id, setIndex)]?.completed) return { from, to: setIndex }
  }
  return count < MAX_SETS ? { from, to: count + 1 } : null
}

/**
 * Everything the log screen needs for one day. `sessionId` opens a specific session of that day
 * (one the athlete added themselves); without it the day's planned session is used.
 */
export function useSessionLog(date: string, sessionId: string | null = null) {
  const [day, setDay] = useState<AthleteSessionDay | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [logs, setLogs] = useState<LogMap>({})
  const [wrapUp, setWrapUp] = useState<WrapUp>({ rpe: null, comment: "" })
  const [extraSets, setExtraSets] = useState<Record<string, number>>({})
  const [reloadToken, setReloadToken] = useState(0)
  const [lastTime, setLastTime] = useState<Record<string, LastTimeResult>>({})
  const sync = useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState)
  const sessionRef = useRef<AthleteSession | null>(null)
  // Mirrors `logs` so handlers fired back to back always read the latest entry.
  const logsRef = useRef<LogMap>({})

  useEffect(() => {
    resumeSessionOutbox()
  }, [])

  useEffect(() => {
    let cancelled = false
    setDay(null)
    setLoadError(null)

    void loadAthleteSessionDay(date, sessionId).then((result) => {
      if (cancelled) return
      let loaded: AthleteSessionDay | null = null
      if (result.ok) {
        loaded = result.data
        cacheDay(loaded, sessionId)
        setFromCache(false)
      } else {
        loaded = readJson<Record<string, AthleteSessionDay>>(DAY_CACHE_KEY, {})[cacheKey(date, sessionId)] ?? null
        setFromCache(Boolean(loaded))
        if (!loaded) {
          setLoadError(result.error.message)
          return
        }
      }
      const merged = withPending(loaded)
      sessionRef.current = merged.session
      setDay(merged)
      logsRef.current = toMap(merged.session?.logs ?? [])
      setLogs(logsRef.current)
      setExtraSets({})
      const draft = merged.session ? readJson<Record<string, WrapUp>>(WRAP_UP_KEY, {})[merged.session.id] : undefined
      setWrapUp({
        rpe: draft?.rpe ?? merged.session?.overallRpe ?? null,
        comment: draft?.comment ?? merged.session?.athleteComment ?? "",
      })
    })

    return () => {
      cancelled = true
    }
  }, [date, sessionId, reloadToken])

  // What they did last time for the same exercises. A hint only: if it cannot be read, nothing shows.
  const loadedSessionId = day?.session?.id ?? null
  const loadedLabels = (day?.session?.blocks ?? []).flatMap((block) => block.rows.filter((row) => row.kind !== "check").map((row) => row.label)).join("|")
  useEffect(() => {
    setLastTime({})
    if (!loadedSessionId || !loadedLabels) return
    let cancelled = false
    void loadLastTime(loadedLabels.split("|"), date, loadedSessionId).then((result) => {
      if (!cancelled && result.ok) setLastTime(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [date, loadedLabels, loadedSessionId])

  const commit = useCallback((next: SessionRowLog) => {
    const session = sessionRef.current
    if (!session) return
    logsRef.current = { ...logsRef.current, [setKey(next.rowId, next.setIndex)]: next }
    setLogs(logsRef.current)
    queueRowLog(session.id, next)
  }, [])

  const currentLog = useCallback(
    (rowId: string, setIndex: number) => logsRef.current[setKey(rowId, setIndex)] ?? emptyLog(rowId, setIndex),
    [],
  )

  /** Fills blanks from the coach target, or failing that from the set before. */
  const filled = useCallback(
    (row: LoggableRow, setIndex: number, base: SessionRowLog, previous: SessionRowLog | null): SessionRowLog => {
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
    },
    [],
  )

  const toggleSet = useCallback(
    (row: LoggableRow, setIndex: number) => {
      const existing = currentLog(row.id, setIndex)
      if (existing.completed) {
        commit({ ...existing, completed: false })
        return
      }
      const previous = setIndex > 1 ? currentLog(row.id, setIndex - 1) : null
      commit(filled(row, setIndex, existing, previous))
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

  const fillRowFromTarget = useCallback(
    (row: LoggableRow) => {
      const count = setCount(row, logsRef.current)
      let previous: SessionRowLog | null = null
      for (let setIndex = 1; setIndex <= count; setIndex += 1) {
        const existing = currentLog(row.id, setIndex)
        const next: SessionRowLog = existing.completed ? existing : filled(row, setIndex, existing, previous)
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
      commit({ ...source, setIndex: target.to, completed: true })
    },
    [commit, currentLog],
  )

  const addSet = useCallback((row: LoggableRow) => {
    setExtraSets((current) => ({ ...current, [row.id]: (current[row.id] ?? 0) + 1 }))
  }, [])

  const updateWrapUp = useCallback((patch: Partial<WrapUp>) => {
    setWrapUp((current) => {
      const next = { ...current, ...patch }
      const session = sessionRef.current
      if (session) {
        const drafts = readJson<Record<string, WrapUp>>(WRAP_UP_KEY, {})
        const keep = Object.fromEntries(Object.entries(drafts).slice(-9))
        writeJson(WRAP_UP_KEY, { ...keep, [session.id]: next })
      }
      return next
    })
  }, [])

  /** Marks the session done. Resolves true when everything reached the backend. */
  const finish = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return false
    const completionDate = session.completedOn ?? dateKeyLocal(new Date())
    const comment = wrapUp.comment.trim() || null
    queueCompletion(session.id, { completionDate, rpe: wrapUp.rpe, comment })

    const finished: AthleteSession = {
      ...session,
      status: "completed",
      completedOn: completionDate,
      overallRpe: wrapUp.rpe,
      athleteComment: comment,
    }
    sessionRef.current = finished
    setDay((current) =>
      current
        ? {
            ...current,
            session: finished,
            // A session the athlete added does not tick off the planned session of that day.
            week: current.week.map((entry) =>
              entry.date === current.date && (finished.origin !== "athlete" || entry.kind !== "session") ? { ...entry, done: true, skipped: false } : entry,
            ),
          }
        : current,
    )

    if (getBackendMode() !== "supabase" && session.origin !== "athlete") {
      // The mock home screen reads its week streak from this key.
      const key = tenantStorageKey(SESSION_COMPLETIONS_STORAGE_KEY)
      const dates = parseSessionCompletions(window.localStorage.getItem(key))
      if (!dates.includes(completionDate)) window.localStorage.setItem(key, JSON.stringify([...dates, completionDate]))
    }
    return flushSessionOutbox()
  }, [wrapUp.comment, wrapUp.rpe])

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  /** "Can't do this one". Needs a connection: it is a decision, not a result typed at the track. */
  const skip = useCallback(
    async (reason: SkipReason, note: string | null): Promise<Result<null>> => {
      const session = sessionRef.current
      if (!session) return { ok: false, error: { code: "NOT_FOUND", message: "There is no session to skip." } }
      const result = await skipSession(session.id, reason, note)
      if (result.ok) reload()
      return result
    },
    [reload],
  )

  const unskip = useCallback(async (): Promise<Result<null>> => {
    const session = sessionRef.current
    if (!session) return { ok: false, error: { code: "NOT_FOUND", message: "There is no session to change." } }
    const result = await unskipSession(session.id)
    if (result.ok) reload()
    return result
  }, [reload])

  /** Adds an exercise to a session the athlete added themselves. */
  const addExercise = useCallback(async (input: ExtraExerciseInput): Promise<Result<LoggableRow>> => {
    const session = sessionRef.current
    const block = session?.blocks[0]
    if (!session || !block || session.origin !== "athlete") {
      return { ok: false, error: { code: "FORBIDDEN", message: "Exercises can only be added to a session you added yourself." } }
    }
    const result = await addExtraExercise(session.id, block.id, block.rows.length, input)
    if (!result.ok) return result
    const next: AthleteSession = { ...session, blocks: [{ ...block, rows: [...block.rows, result.data] }, ...session.blocks.slice(1)] }
    sessionRef.current = next
    setDay((current) => {
      if (!current) return current
      const updated = { ...current, session: next }
      cacheDay(updated, next.id)
      return updated
    })
    return result
  }, [])

  const removeExtraSession = useCallback(async (): Promise<Result<null>> => {
    const session = sessionRef.current
    if (!session) return { ok: false, error: { code: "NOT_FOUND", message: "There is no session to remove." } }
    return deleteExtraSession(session.id)
  }, [])

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

  return {
    day,
    session: day?.session ?? null,
    loadError,
    fromCache,
    reload,
    lastTime: (label: string) => lastTime[exerciseKey(label)] ?? null,
    repeatLastSet,
    skip,
    unskip,
    addExercise,
    removeExtraSession,
    logs,
    extraSets,
    wrapUp,
    updateWrapUp,
    toggleSet,
    setValue,
    fillRowFromTarget,
    addSet,
    finish,
    totals,
    sync,
    retrySync: () => void flushSessionOutbox(),
  }
}

export type SessionLogController = ReturnType<typeof useSessionLog>
