import { Fragment, useEffect, useState, type ReactNode } from "react"
import { getTenantIdFromCookie } from "@/lib/auth-session"
import { CLUB_DAY_CHANGED_EVENT, clubToday } from "@/lib/club-day"
import { getClubTimezone } from "@/lib/data/club-admin/club-timezone-data"

/**
 * Keeps "today" on the club's day. Reads the club's time zone once per visit (it is then kept on
 * the device) and, in the rare case that this moves today to another date (someone far from their
 * club, on a device that had not seen the zone yet, or an admin changing the zone), shows the
 * current screen again so nothing keeps the device's date.
 */
export function ClubDayBoundary({ children }: { children: ReactNode }) {
  const [day, setDay] = useState(() => clubToday())

  useEffect(() => {
    const refresh = () => setDay(clubToday())
    window.addEventListener(CLUB_DAY_CHANGED_EVENT, refresh)
    const tenantId = getTenantIdFromCookie()
    // A platform admin has no club.
    if (tenantId && tenantId !== "platform-admin") void getClubTimezone()
    return () => window.removeEventListener(CLUB_DAY_CHANGED_EVENT, refresh)
  }, [])

  return <Fragment key={day}>{children}</Fragment>
}
