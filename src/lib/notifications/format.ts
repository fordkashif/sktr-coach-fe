/** "Just now", "12m ago", "2h ago", "Yesterday", then the full local date. */
export function formatNotificationTime(value: string, now: Date = new Date()): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000))
  if (seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24 && isSameLocalDay(date, now)) return `${hours}h ago`
  if (isSameLocalDay(date, addDays(now, -1))) return `Yesterday, ${formatClock(date)}`
  if (hours < 24) return `${hours}h ago`
  return formatNotificationDate(date, now)
}

/** "6 October" for this year, "6 October 2025" for another. */
export function formatNotificationDate(date: Date, now: Date = new Date()): string {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  })
}

/** Full local date and time, for a screen reader and the title of a time. */
export function formatNotificationExact(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })
}

/** Heading for a day in the full history: "Today", "Yesterday", "Monday 5 October". */
export function formatNotificationDayHeading(value: string, now: Date = new Date()): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Earlier"
  if (isSameLocalDay(date, now)) return "Today"
  if (isSameLocalDay(date, addDays(now, -1))) return "Yesterday"
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  })
}

/** Local calendar day, as a grouping key. */
export function notificationDayKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "unknown"
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function formatClock(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

function isSameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
