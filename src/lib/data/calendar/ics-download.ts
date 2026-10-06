import { buildIcsCalendar, icsFileName } from "../../../../supabase/functions/_shared/calendar-feed"
import { icsEventForItem, type CalendarItem } from "./model"

/** The .ics text for one competition, test week or club event, or null for anything else. */
export function icsFileForItem(item: CalendarItem, timezone: string, now: Date = new Date()): { filename: string; content: string } | null {
  const event = icsEventForItem(item)
  if (!event) return null
  return { filename: icsFileName(item.title), content: buildIcsCalendar({ name: item.title, timezone, events: [event], now }) }
}

/** Hands the file to the browser. A phone offers to add it to the calendar. Returns false when there is nothing to add. */
export function downloadIcsForItem(item: CalendarItem, timezone: string): boolean {
  const file = icsFileForItem(item, timezone)
  if (!file || typeof document === "undefined") return false
  const url = URL.createObjectURL(new Blob([file.content], { type: "text/calendar;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = file.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
