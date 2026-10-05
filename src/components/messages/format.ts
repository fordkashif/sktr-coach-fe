import { formatNotificationDayHeading, formatNotificationExact, formatNotificationTime, notificationDayKey } from "@/lib/notifications/format"

/** How the messaging screens write times. The same words the notifications use. */

/** "9:14 AM" */
export function clockTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

/**
 * When something happened, short enough to sit at the end of a list row on a phone:
 * "Just now", "12m ago", "2h ago", "Yesterday", then "3 Oct" (with the year when it is not this one).
 */
export function listTime(value: string, now: Date = new Date()): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const startOfDay = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (daysAgo <= 0) return formatNotificationTime(value, now)
  if (daysAgo === 1) return "Yesterday"
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) })
}
/** The full date and time, for a tooltip. */
export const exactTime = formatNotificationExact
/** "Today", "Yesterday", "Monday 5 October": the heading of a day of messages. */
export const dayHeading = formatNotificationDayHeading
export const dayKey = notificationDayKey

/** The first line of a longer text, cut to a length that fits a list row. */
export function firstLine(text: string, max = 90): string {
  const line = text.split("\n")[0].trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}
