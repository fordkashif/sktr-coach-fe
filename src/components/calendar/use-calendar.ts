import { clubToday } from "@/lib/club-day"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { cleanClubTimezone, DEFAULT_CLUB_TIMEZONE } from "@/lib/club-timezone"
import type { CalendarData, CalendarRange } from "@/lib/data/calendar/calendar-data"
import { CLUB_EVENTS_CHANGED_EVENT } from "@/lib/data/calendar/club-events-data"
import { gridBounds, isMonthKey, monthOf } from "@/lib/data/calendar/model"
import { getClubTimezone } from "@/lib/data/club-admin/club-timezone-data"
import type { Result } from "@/lib/data/result"

/** Which month is showing, kept in the address (?month=2026-11) so back, reload and links keep it. */
export function useCalendarMonth() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [today] = useState(() => clubToday())
  const param = searchParams.get("month")
  const month = isMonthKey(param) ? param : monthOf(today)
  const setMonth = useCallback(
    (next: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          if (next === monthOf(today)) params.delete("month")
          else params.set("month", next)
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams, today],
  )
  return { month, setMonth, today }
}

/**
 * Loads a calendar for the weeks the month grid shows, again whenever the month, the `key` (team) or
 * a club event changes. `data` keeps the last loaded month while the next one loads, so the screen
 * does not jump; `loading` is true only until the first answer.
 */
export function useCalendarData(month: string, key: string, load: (range: CalendarRange) => Promise<Result<CalendarData>>) {
  const range = useMemo(() => gridBounds(month), [month])
  const [state, setState] = useState<{ key: string; data: CalendarData | null; error: string | null }>({ key: "", data: null, error: null })
  const [token, setToken] = useState(0)
  const reload = useCallback(() => setToken((value) => value + 1), [])
  const requestKey = `${key}|${range.from}|${range.to}`

  useEffect(() => {
    let cancelled = false
    void load(range).then((result) => {
      if (cancelled) return
      setState(result.ok ? { key: requestKey, data: result.data, error: null } : { key: requestKey, data: null, error: result.error.message })
    })
    return () => {
      cancelled = true
    }
    // `load` is rebuilt by the screen on every render; `key` says when it really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, token])

  useEffect(() => {
    window.addEventListener(CLUB_EVENTS_CHANGED_EVENT, reload)
    return () => window.removeEventListener(CLUB_EVENTS_CHANGED_EVENT, reload)
  }, [reload])

  // Another team's data is never shown under this team's name: only a change of month keeps the old list up.
  const sameScope = state.key.split("|")[0] === key
  return { data: sameScope ? state.data : null, error: sameScope ? state.error : null, loading: !sameScope || (state.data === null && state.error === null), reload, range }
}

/** The club's time zone, for the times written into calendar files. */
export function useClubTimezone() {
  const [timezone, setTimezone] = useState(DEFAULT_CLUB_TIMEZONE)
  useEffect(() => {
    let cancelled = false
    void getClubTimezone().then((result) => {
      if (!cancelled && result.ok) setTimezone(cleanClubTimezone(result.data))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return timezone
}
