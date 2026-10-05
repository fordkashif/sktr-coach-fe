/**
 * Rest timer and stopwatch maths. Everything is worked out from wall clock timestamps
 * (Date.now()), never from counting interval ticks, so the time is still right after the
 * phone screen locks or the tab sits in the background.
 */

export type RestClock = { mode: "rest"; startedAt: number; endsAt: number; durationMs: number; label: string | null; cued: boolean }
export type StopwatchClock = { mode: "stopwatch"; startedAt: number | null; accumulatedMs: number; rowId: string | null }
export type LogClock = { mode: "idle" } | RestClock | StopwatchClock

export function startRest(now: number, seconds: number, label: string | null = null): RestClock {
  const durationMs = Math.max(1, Math.round(seconds)) * 1000
  return { mode: "rest", startedAt: now, endsAt: now + durationMs, durationMs, label, cued: false }
}

/** Milliseconds left. Negative once the rest is over (how far past the end). */
export function restRemainingMs(clock: Pick<RestClock, "endsAt">, now: number) {
  return clock.endsAt - now
}

export function restIsOver(clock: Pick<RestClock, "endsAt">, now: number) {
  return now >= clock.endsAt
}

/** 0 to 100, for the thin bar. */
export function restProgress(clock: Pick<RestClock, "endsAt" | "durationMs">, now: number) {
  const done = clock.durationMs - restRemainingMs(clock, now)
  return Math.max(0, Math.min(100, (done / clock.durationMs) * 100))
}

/** Add (or take off) time on a running rest. */
export function extendRest(clock: RestClock, seconds: number): RestClock {
  return { ...clock, endsAt: clock.endsAt + seconds * 1000, durationMs: Math.max(1000, clock.durationMs + seconds * 1000), cued: false }
}

export function newStopwatch(rowId: string | null = null): StopwatchClock {
  return { mode: "stopwatch", startedAt: null, accumulatedMs: 0, rowId }
}

export function stopwatchRunning(clock: Pick<StopwatchClock, "startedAt">) {
  return clock.startedAt !== null
}

export function stopwatchElapsedMs(clock: Pick<StopwatchClock, "startedAt" | "accumulatedMs">, now: number) {
  return clock.accumulatedMs + (clock.startedAt === null ? 0 : Math.max(0, now - clock.startedAt))
}

export function startStopwatch(clock: StopwatchClock, now: number): StopwatchClock {
  return clock.startedAt === null ? { ...clock, startedAt: now } : clock
}

export function stopStopwatch(clock: StopwatchClock, now: number): StopwatchClock {
  return clock.startedAt === null ? clock : { ...clock, startedAt: null, accumulatedMs: stopwatchElapsedMs(clock, now) }
}

/** The stopwatch reading as the seconds typed into a time field, to a hundredth. */
export function stopwatchSeconds(elapsedMs: number) {
  return Math.round(Math.max(0, elapsedMs) / 10) / 100
}

/** "1:30", "0:07". Rounds up so the display reaches 0:00 exactly when the rest ends. */
export function formatCountdown(remainingMs: number) {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

/** "0:12.34", "2:05.10". */
export function formatStopwatch(elapsedMs: number) {
  const hundredths = Math.floor(Math.max(0, elapsedMs) / 10)
  const minutes = Math.floor(hundredths / 6000)
  const seconds = Math.floor((hundredths % 6000) / 100)
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`
}

/** "30 s", "1 min", "1:30", "2 min". */
export function restChoiceLabel(seconds: number) {
  if (seconds < 60) return `${seconds} s`
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** A clock read back from storage: anything that is not a well formed clock becomes idle. */
export function reviveClock(value: unknown): LogClock {
  if (!value || typeof value !== "object") return { mode: "idle" }
  const clock = value as Record<string, unknown>
  const isNumber = (entry: unknown): entry is number => typeof entry === "number" && Number.isFinite(entry)
  if (clock.mode === "rest" && isNumber(clock.startedAt) && isNumber(clock.endsAt) && isNumber(clock.durationMs) && clock.durationMs > 0) {
    return {
      mode: "rest",
      startedAt: clock.startedAt,
      endsAt: clock.endsAt,
      durationMs: clock.durationMs,
      label: typeof clock.label === "string" ? clock.label : null,
      cued: clock.cued === true,
    }
  }
  if (clock.mode === "stopwatch" && isNumber(clock.accumulatedMs) && (clock.startedAt === null || isNumber(clock.startedAt))) {
    return { mode: "stopwatch", startedAt: clock.startedAt, accumulatedMs: clock.accumulatedMs, rowId: typeof clock.rowId === "string" ? clock.rowId : null }
  }
  return { mode: "idle" }
}
