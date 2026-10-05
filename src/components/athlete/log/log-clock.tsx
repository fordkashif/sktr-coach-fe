import { useCallback, useEffect, useState } from "react"
import { Timer, X } from "@phosphor-icons/react"
import { Button, Meter, Sheet, StatusText } from "@/components/sk"
import { REST_CHOICES_SECONDS } from "@/lib/data/session/log-assist"
import {
  extendRest,
  formatCountdown,
  formatStopwatch,
  newStopwatch,
  restChoiceLabel,
  restIsOver,
  restProgress,
  restRemainingMs,
  reviveClock,
  startRest,
  startStopwatch,
  stopStopwatch,
  stopwatchElapsedMs,
  stopwatchRunning,
  stopwatchSeconds,
  type LogClock,
} from "@/lib/data/session/log-clock"
import { tenantStorageKey } from "@/lib/tenant-storage"

const STORAGE_KEY = "pacelab:session-log-clock:v1"
/** A rest that ended this long ago, or a stopwatch left running this long, is forgotten on open. */
const STALE_REST_MS = 10 * 60 * 1000
const STALE_STOPWATCH_MS = 6 * 60 * 60 * 1000
const CHOICE_LABELS: Record<number, string> = { 30: "30 s", 60: "60 s", 90: "90 s", 120: "2 min", 180: "3 min" }

function readClock(): LogClock {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(STORAGE_KEY))
    const clock = reviveClock(raw ? JSON.parse(raw) : null)
    const now = Date.now()
    if (clock.mode === "rest" && now - clock.endsAt > STALE_REST_MS) return { mode: "idle" }
    if (clock.mode === "stopwatch" && clock.startedAt !== null && now - clock.startedAt > STALE_STOPWATCH_MS) return { mode: "idle" }
    return clock
  } catch {
    return { mode: "idle" }
  }
}

function writeClock(clock: LogClock) {
  try {
    if (clock.mode === "idle") window.localStorage.removeItem(tenantStorageKey(STORAGE_KEY))
    else window.localStorage.setItem(tenantStorageKey(STORAGE_KEY), JSON.stringify(clock))
  } catch {
    // Best effort: the clock still runs from memory.
  }
}

/**
 * The rest timer and stopwatch of the log screen. The clock is a pair of timestamps kept in
 * state and on the phone, and what shows is worked out from Date.now() on every repaint, so a
 * locked screen, a backgrounded tab or a reload never lose time.
 */
export function useLogClock() {
  const [clock, setClockState] = useState<LogClock>(() => (typeof window === "undefined" ? { mode: "idle" } : readClock()))
  const [now, setNow] = useState(() => Date.now())

  const setClock = useCallback((next: LogClock | ((current: LogClock) => LogClock)) => {
    setClockState((current) => {
      const resolved = typeof next === "function" ? next(current) : next
      writeClock(resolved)
      return resolved
    })
    setNow(Date.now())
  }, [])

  const ticking = clock.mode === "rest" || (clock.mode === "stopwatch" && stopwatchRunning(clock))
  const fast = clock.mode === "stopwatch"
  useEffect(() => {
    if (!ticking) return
    const refresh = () => setNow(Date.now())
    // The interval only repaints. Browsers slow or pause it in the background, which is fine:
    // the next repaint reads the real time again.
    const interval = window.setInterval(refresh, fast ? 47 : 250)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("focus", refresh)
    window.addEventListener("pageshow", refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("pageshow", refresh)
    }
  }, [fast, ticking])

  // The finish cue, once per rest: a buzz where the phone supports it. The bar pulses as well.
  const restOver = clock.mode === "rest" && restIsOver(clock, now)
  const cued = clock.mode === "rest" && clock.cued
  useEffect(() => {
    if (!restOver || cued) return
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate([220, 120, 220])
    } catch {
      // No vibration on this device.
    }
    setClock((current) => (current.mode === "rest" ? { ...current, cued: true } : current))
  }, [cued, restOver, setClock])

  return {
    clock,
    now,
    startRest: useCallback((seconds: number, label: string | null = null) => setClock(startRest(Date.now(), seconds, label)), [setClock]),
    addRest: useCallback((seconds: number) => setClock((current) => (current.mode === "rest" ? extendRest(current, seconds) : current)), [setClock]),
    openStopwatch: useCallback(
      (rowId: string | null) => setClock((current) => (current.mode === "stopwatch" ? { ...current, rowId: rowId ?? current.rowId } : newStopwatch(rowId))),
      [setClock],
    ),
    toggleStopwatch: useCallback(
      () =>
        setClock((current) => {
          if (current.mode !== "stopwatch") return current
          return stopwatchRunning(current) ? stopStopwatch(current, Date.now()) : startStopwatch(current, Date.now())
        }),
      [setClock],
    ),
    resetStopwatch: useCallback(() => setClock((current) => (current.mode === "stopwatch" ? newStopwatch(current.rowId) : current)), [setClock]),
    close: useCallback(() => setClock({ mode: "idle" }), [setClock]),
  }
}

export type LogClockController = ReturnType<typeof useLogClock>

export type RestSuggestion = { seconds: number; prescribed: boolean; label: string | null }
export type StopwatchTarget = { rowLabel: string; setIndex: number }

/**
 * The clock row of the sticky bar. Idle: start a rest in one tap, or open the stopwatch.
 * Resting: the countdown with a thin bar, then "Rest over". Stopwatch: start, stop and
 * "Use for rep 2", which types the time into that rep.
 */
export function ClockBar({
  control,
  suggestion,
  showStopwatch,
  target,
  onUseTime,
}: {
  control: LogClockController
  suggestion: RestSuggestion
  /** The session has something that is timed. */
  showStopwatch: boolean
  /** Where a stopwatch time goes. Null when there is no open rep to put it in. */
  target: StopwatchTarget | null
  onUseTime: (seconds: number) => void
}) {
  const { clock, now } = control
  const [choosing, setChoosing] = useState(false)
  const choices = [...new Set([...REST_CHOICES_SECONDS, suggestion.seconds])].sort((left, right) => left - right)

  const sheet = (
    <Sheet
      open={choosing}
      onOpenChange={setChoosing}
      side="bottom"
      title="Rest timer"
      description={
        suggestion.prescribed
          ? `Your coach set ${restChoiceLabel(suggestion.seconds)}${suggestion.label ? ` for ${suggestion.label}` : ""}. Tap a time to start.`
          : "Tap a time to start the countdown."
      }
    >
      <div className="grid grid-cols-3 gap-2 pb-2" role="group" aria-label="Rest time">
        {choices.map((seconds) => (
          <Button
            key={seconds}
            size="lg"
            className="tabular-nums"
            aria-label={`Rest ${CHOICE_LABELS[seconds] ?? restChoiceLabel(seconds)}`}
            onClick={() => {
              control.startRest(seconds, suggestion.label)
              setChoosing(false)
            }}
          >
            {CHOICE_LABELS[seconds] ?? restChoiceLabel(seconds)}
          </Button>
        ))}
      </div>
    </Sheet>
  )

  if (clock.mode === "rest") {
    const remaining = restRemainingMs(clock, now)
    const over = remaining <= 0
    return (
      <div data-clock={over ? "rest-over" : "rest"} className="flex items-center gap-2 pb-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 text-sm font-bold text-sk-ink">
            {over ? (
              <span className="motion-safe:animate-pulse">
                <StatusText tone="green">Rest over</StatusText>
              </span>
            ) : (
              <span>Rest</span>
            )}
            <span role="timer" aria-label={over ? "Time since the rest ended" : "Rest left"} className="text-2xl font-extrabold leading-none tabular-nums">
              {over ? `+${formatCountdown(Math.floor(-remaining / 1000) * 1000)}` : formatCountdown(remaining)}
            </span>
          </p>
          <Meter value={restProgress(clock, now)} tone={over ? "green" : "blue"} className={over ? "mt-1.5 motion-safe:animate-pulse" : "mt-1.5"} label="Rest done" />
          <span className="sr-only" role="status">
            {over ? "Rest over. Go again." : ""}
          </span>
        </div>
        {over ? (
          <Button size="sm" variant="quiet" onClick={() => control.startRest(clock.durationMs / 1000, clock.label)}>
            Again
          </Button>
        ) : (
          <Button size="sm" variant="quiet" onClick={() => control.addRest(30)}>
            +30 s
          </Button>
        )}
        <Button size="sm" onClick={control.close}>
          {over ? "Done" : "Stop"}
        </Button>
        {sheet}
      </div>
    )
  }

  if (clock.mode === "stopwatch") {
    const elapsed = stopwatchElapsedMs(clock, now)
    const running = stopwatchRunning(clock)
    return (
      <div data-clock={running ? "stopwatch-running" : "stopwatch"} className="pb-2">
        <div className="flex items-center gap-2">
          <p role="timer" aria-label="Stopwatch" className="text-2xl font-extrabold leading-none tabular-nums text-sk-ink">
            {formatStopwatch(elapsed)}
          </p>
          <p className="min-w-0 flex-1 truncate text-sm text-sk-mute">{target ? `${target.rowLabel}, rep ${target.setIndex}` : "Stopwatch"}</p>
          <button
            type="button"
            aria-label="Close stopwatch"
            onClick={control.close}
            className="-mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-sk-mute hover:text-sk-ink focus-visible:outline-2 focus-visible:outline-sk-blue"
          >
            <X className="size-5" weight="bold" aria-hidden />
          </button>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Button size="sm" className="min-w-20" onClick={control.toggleStopwatch}>
            {running ? "Stop" : elapsed > 0 ? "Resume" : "Start"}
          </Button>
          {!running && elapsed > 0 && target ? (
            <Button
              size="sm"
              onClick={() => {
                onUseTime(stopwatchSeconds(elapsed))
                control.resetStopwatch()
              }}
            >
              Use for rep {target.setIndex}
            </Button>
          ) : null}
          {!running && elapsed > 0 ? (
            <Button size="sm" variant="quiet" onClick={control.resetStopwatch}>
              Reset
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div data-clock="idle" className="-ml-2.5 flex items-center gap-x-1 pb-1">
      <Button size="sm" variant="quiet" className="tabular-nums" onClick={() => control.startRest(suggestion.seconds, suggestion.label)}>
        <Timer className="size-4" weight="bold" aria-hidden />
        Rest {formatCountdown(suggestion.seconds * 1000)}
      </Button>
      <Button size="sm" variant="quiet" aria-label="Choose another rest time" onClick={() => setChoosing(true)}>
        Change
      </Button>
      <span className="flex-1" />
      {showStopwatch ? (
        <Button size="sm" variant="quiet" onClick={() => control.openStopwatch(null)}>
          Stopwatch
        </Button>
      ) : null}
      {sheet}
    </div>
  )
}
