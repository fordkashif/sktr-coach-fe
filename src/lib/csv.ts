/** Small CSV helpers shared by the coach exports. Pure apart from downloadCsv. */

/**
 * A spreadsheet treats a cell that starts with =, +, - or @ as a formula. Names and notes are typed
 * by people, so those cells get a leading apostrophe. Plain numbers ("-0.4", "+1.2") are left alone.
 */
function safeCell(value: string) {
  return /^[=+\-@]/.test(value) && !/^[+-]?\d+([.,]\d+)?$/.test(value) ? `'${value}` : value
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows
    .map((row) => row.map((value) => `"${safeCell(value === null || value === undefined ? "" : String(value)).replaceAll('"', '""')}"`).join(","))
    .join("\r\n")
}

/** "sprint-group-adherence-2026-09-08-to-2026-10-05.csv": lower case, words joined by dashes. */
export function csvFileName(...parts: Array<string | null | undefined>): string {
  const slug = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("-")
  return `${slug || "export"}.csv`
}

export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  // The byte order mark makes Excel read accented names correctly.
  const blob = new Blob(["﻿", toCsv(rows)], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
