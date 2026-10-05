/** Small formatting and export helpers shared by the club admin reports, activity, profile and billing screens. */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Today as YYYY-MM-DD on the viewer's own calendar (never UTC). */
export function localIsoDay(date: Date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Parses a date-only value as a local calendar day. Returns null for anything else. */
export function parseLocalDay(value: string | null | undefined) {
  if (!value || !ISO_DAY.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** "Oct 4, 2026" for a YYYY-MM-DD value. Anything that is not a date-only value is returned as given. */
export function formatDay(value: string | null | undefined) {
  if (!value) return ""
  const parsed = parseLocalDay(value)
  return parsed ? parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : value
}

/** "Oct 4, 2026, 3:42 PM" in the viewer's time zone for an ISO timestamp. */
export function formatDateTime(value: string | null | undefined) {
  if (!value) return ""
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export type MockAuditLogger = (event: { actor: string; action: string; target: string; detail?: string }) => void
