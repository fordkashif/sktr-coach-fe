/**
 * Pure logic behind personal data rights and club exit: the shape of "Download your data", the
 * whole club export (CSV files in one zip), what blocks deleting an account per role, and the
 * typed confirmations. No imports and no browser APIs beyond TextEncoder, so it is unit tested
 * (tests/data-rights.test.ts) and used by both the mock stores and the Supabase data functions.
 */

/* ---------------------------------------------------------------------------
   Zip: a minimal writer. Files are stored, not compressed (CSV for a club is small, and this
   keeps the app free of a zip dependency). Names are UTF-8.
--------------------------------------------------------------------------- */

let crcTable: Uint32Array | null = null

function getCrcTable() {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  crcTable = table
  return table
}

/** CRC-32 (the zip and PNG one) of some bytes, as an unsigned 32 bit number. */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: Uint8Array | string }

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** Keeps a file name inside the archive: no drive, no leading slash, no "..". */
export function safeZipName(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
  return parts.join("/") || "file"
}

/** Builds a zip archive in memory. Every file is stored as is, with its CRC-32. */
export function buildZip(entries: ZipEntry[], date: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const stamp = dosDateTime(date)
  const used = new Set<string>()
  const files = entries.map((entry) => {
    let name = safeZipName(entry.name)
    // Two files with one name would hide each other when the archive is opened.
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = safeZipName(entry.name).replace(/(\.[^./]+)?$/, `-${n}$1`)
    used.add(name.toLowerCase())
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data
    return { nameBytes: encoder.encode(name), data, crc: crc32(data) }
  })

  const localSize = files.reduce((sum, file) => sum + 30 + file.nameBytes.length + file.data.length, 0)
  const centralSize = files.reduce((sum, file) => sum + 46 + file.nameBytes.length, 0)
  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let offset = 0
  const offsets: number[] = []

  for (const file of files) {
    offsets.push(offset)
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true) // version needed
    view.setUint16(offset + 6, 0x0800, true) // names are UTF-8
    view.setUint16(offset + 8, 0, true) // stored
    view.setUint16(offset + 10, stamp.time, true)
    view.setUint16(offset + 12, stamp.date, true)
    view.setUint32(offset + 14, file.crc, true)
    view.setUint32(offset + 18, file.data.length, true)
    view.setUint32(offset + 22, file.data.length, true)
    view.setUint16(offset + 26, file.nameBytes.length, true)
    view.setUint16(offset + 28, 0, true)
    out.set(file.nameBytes, offset + 30)
    out.set(file.data, offset + 30 + file.nameBytes.length)
    offset += 30 + file.nameBytes.length + file.data.length
  }

  const centralStart = offset
  files.forEach((file, index) => {
    view.setUint32(offset, 0x02014b50, true)
    view.setUint16(offset + 4, 20, true) // made by
    view.setUint16(offset + 6, 20, true) // version needed
    view.setUint16(offset + 8, 0x0800, true)
    view.setUint16(offset + 10, 0, true)
    view.setUint16(offset + 12, stamp.time, true)
    view.setUint16(offset + 14, stamp.date, true)
    view.setUint32(offset + 16, file.crc, true)
    view.setUint32(offset + 20, file.data.length, true)
    view.setUint32(offset + 24, file.data.length, true)
    view.setUint16(offset + 28, file.nameBytes.length, true)
    // extra, comment, disk, internal attributes, external attributes: all zero
    view.setUint32(offset + 42, offsets[index], true)
    out.set(file.nameBytes, offset + 46)
    offset += 46 + file.nameBytes.length
  })

  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 8, files.length, true)
  view.setUint16(offset + 10, files.length, true)
  view.setUint32(offset + 12, offset - centralStart, true)
  view.setUint32(offset + 16, centralStart, true)
  return out
}

/* ---------------------------------------------------------------------------
   CSV
--------------------------------------------------------------------------- */

/**
 * One CSV cell. Objects and lists are written as JSON. A cell typed by a person that starts with
 * =, +, - or @ would run as a formula in a spreadsheet, so it gets a leading apostrophe; plain
 * numbers such as -0.4 are left alone.
 */
export function csvCell(value: unknown): string {
  let text: string
  if (value === null || value === undefined) text = ""
  else if (typeof value === "string") text = value
  else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") text = String(value)
  else if (value instanceof Date) text = value.toISOString()
  else text = JSON.stringify(value)
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+([.,]\d+)?$/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/** The columns of a list of rows: every key that appears, in the order first seen. */
export function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  return columns
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

/** A CSV file as text, with a header row. Starts with a byte order mark so Excel reads accents. */
export function rowsToCsv(rows: Array<Record<string, unknown>>, columns: string[] = columnsOf(rows)): string {
  const lines = [columns.map(csvCell).join(",")]
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","))
  return `${BYTE_ORDER_MARK}${lines.join("\r\n")}\r\n`
}

export function fileSlug(...parts: Array<string | null | undefined>): string {
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
  return slug || "export"
}

/* ---------------------------------------------------------------------------
   Download your data
--------------------------------------------------------------------------- */

export type ExportRole = "athlete" | "coach" | "club-admin" | "platform-admin"

export type PersonalExportArea = {
  /** Key in the file's "data" object, for example "wellness_check_ins". */
  key: string
  /** What a person calls it: "Wellness check-ins". */
  label: string
  rows: unknown[]
  /** Set when this area could not be read. The file still downloads and says so. */
  error?: string
}

/**
 * Notes a coach writes about an athlete are the coach's working notes. They are never part of
 * the athlete's own export, whatever the caller collected.
 */
export const COACH_NOTES_AREA_KEY = "coach_notes_you_wrote"
const NEVER_IN_AN_ATHLETE_EXPORT = new Set([COACH_NOTES_AREA_KEY, "coach_notes", "coach_athlete_notes"])

export type PersonalExportFile = {
  summary: {
    about: string
    generated_at: string
    account: { name: string | null; email: string | null; role: ExportRole | null; club: string | null }
    total_records: number
    counts: Array<{ area: string; key: string; records: number }>
    could_not_read: Array<{ area: string; reason: string }>
    not_included: string[]
  }
  data: Record<string, unknown[]>
}

export function buildPersonalExport(input: {
  generatedAt: string
  role: ExportRole | null
  account: { name: string | null; email: string | null; club: string | null }
  areas: PersonalExportArea[]
  sample?: boolean
}): PersonalExportFile {
  const areas = input.areas.filter((area) => !(input.role === "athlete" && NEVER_IN_AN_ATHLETE_EXPORT.has(area.key)))
  const data: Record<string, unknown[]> = {}
  for (const area of areas) data[area.key] = [...(data[area.key] ?? []), ...area.rows]

  const notIncluded = ["Your password. It is stored in scrambled form and nobody can read it."]
  if (input.role === "athlete") notIncluded.push("Private notes your coaches wrote for themselves. They are the coach's own working notes.")
  if (input.role === "coach" || input.role === "club-admin") {
    notIncluded.push("Your athletes' training, results and health information. That is their data and the club's, not yours. A club admin can export the whole club.")
  }

  return {
    summary: {
      about: input.sample
        ? "A SAMPLE of your SKTR Coach data export, made in the demo. The real file has the same shape."
        : "Everything SKTR Coach stores about you, as one file. The summary comes first, the records follow under data.",
      generated_at: input.generatedAt,
      account: { name: input.account.name, email: input.account.email, role: input.role, club: input.account.club },
      total_records: areas.reduce((sum, area) => sum + area.rows.length, 0),
      counts: areas.map((area) => ({ area: area.label, key: area.key, records: area.rows.length })),
      could_not_read: areas.filter((area) => area.error).map((area) => ({ area: area.label, reason: area.error as string })),
      not_included: notIncluded,
    },
    data,
  }
}

export function personalExportFileName(name: string | null, generatedAt: string): string {
  return `${fileSlug("sktr-coach-my-data", name, generatedAt.slice(0, 10))}.json`
}

/* ---------------------------------------------------------------------------
   Whole club export
--------------------------------------------------------------------------- */

export type ClubExportTable = {
  /** File name without the extension: "athletes". */
  file: string
  label: string
  rows: Array<Record<string, unknown>>
  /** The whole table is health data (wellness check-ins, pain reports). */
  health?: boolean
  /** Columns that are health data inside an ordinary table (medical notes). */
  healthColumns?: string[]
  error?: string
}

export const CLUB_EXPORT_HEALTH_REMINDER =
  "This export contains health information about your athletes. It is sensitive personal data: keep it somewhere safe, share it only with people who need it, and delete it when you no longer do."

export function buildClubExportFiles(input: {
  clubName: string
  generatedAt: string
  generatedBy: string | null
  includeHealth: boolean
  tables: ClubExportTable[]
  sample?: boolean
}): { files: ZipEntry[]; counts: Array<{ file: string; label: string; rows: number }>; zipName: string } {
  const files: ZipEntry[] = []
  const counts: Array<{ file: string; label: string; rows: number }> = []
  const leftOut: string[] = []
  const failed: string[] = []

  for (const table of input.tables) {
    if (table.health && !input.includeHealth) {
      leftOut.push(table.label)
      continue
    }
    const dropped = input.includeHealth ? [] : (table.healthColumns ?? [])
    const rows = dropped.length
      ? table.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !dropped.includes(key))))
      : table.rows
    if (dropped.length) leftOut.push(`${table.label}: ${dropped.join(", ")}`)
    if (table.error) failed.push(`${table.label}: ${table.error}`)
    const name = `${fileSlug(table.file)}.csv`
    files.push({ name, data: rowsToCsv(rows) })
    counts.push({ file: name, label: table.label, rows: rows.length })
  }

  const readme = [
    `${input.clubName}: club data export from SKTR Coach`,
    input.sample ? "SAMPLE made in the demo. The real export has the same files." : null,
    `Made ${input.generatedAt}${input.generatedBy ? ` by ${input.generatedBy}` : ""}`,
    "",
    "Files and the number of rows in each (not counting the header row):",
    ...counts.map((item) => `  ${item.file}  ${item.rows}  (${item.label})`),
    "",
    input.includeHealth ? `Health data: INCLUDED. ${CLUB_EXPORT_HEALTH_REMINDER}` : "Health data: not included. Tick the box before exporting to include it.",
    ...(leftOut.length ? ["Left out:", ...leftOut.map((item) => `  ${item}`)] : []),
    ...(failed.length ? ["", "Could not be read in full:", ...failed.map((item) => `  ${item}`)] : []),
    "",
    "Each file is a CSV that opens in Excel, Numbers or Google Sheets. Ids link the files: athlete_id in sessions.csv is id in athletes.csv.",
    "This file holds personal data about your members. Your club is responsible for how it is kept and shared.",
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\r\n")
  files.unshift({ name: "README.txt", data: readme })

  return { files, counts, zipName: `${fileSlug(input.clubName, "data-export", input.generatedAt.slice(0, 10))}.zip` }
}

/* ---------------------------------------------------------------------------
   Deleting your own account: what stands in the way
--------------------------------------------------------------------------- */

export type DeletionBlockReason = "platform_admin" | "club_owner" | "teams"

export type BlockingTeam = { teamId: string; teamName: string; reason: "lead" | "only_coach"; athletes: number }

export type DeletionCheck = {
  role: ExportRole | "none"
  canDelete: boolean
  reason: DeletionBlockReason | null
  blockingTeams: BlockingTeam[]
  /** What has to be typed to confirm. */
  email: string | null
}

export type CoachedTeam = {
  id: string
  name: string
  isLead: boolean
  /** Other active coaches assigned to the team. */
  otherCoaches: number
  /** Active athletes on the team. */
  athletes: number
  archived?: boolean
}

/**
 * The same rules as the database function get_my_account_deletion_check:
 *   platform admin   never in the app
 *   club owner       must transfer ownership or close the club first
 *   coach or admin   not while they lead a team, or are the only coach of a team with athletes
 *   athlete          nothing blocks it
 */
export function evaluateDeletion(input: { role: ExportRole | "none"; email: string | null; isClubOwner?: boolean; teams?: CoachedTeam[] }): DeletionCheck {
  const email = input.email?.trim().toLowerCase() || null
  if (input.role === "platform-admin") return { role: input.role, canDelete: false, reason: "platform_admin", blockingTeams: [], email }

  const blockingTeams: BlockingTeam[] =
    input.role === "coach" || input.role === "club-admin"
      ? (input.teams ?? [])
          .filter((team) => !team.archived && (team.isLead || (team.athletes > 0 && team.otherCoaches === 0)))
          .map((team): BlockingTeam => ({ teamId: team.id, teamName: team.name, reason: team.isLead ? "lead" : "only_coach", athletes: team.athletes }))
          .sort((a, b) => a.teamName.localeCompare(b.teamName))
      : []

  const reason: DeletionBlockReason | null = input.role === "club-admin" && input.isClubOwner ? "club_owner" : blockingTeams.length > 0 ? "teams" : null
  return { role: input.role, canDelete: reason === null, reason, blockingTeams, email }
}

/** One plain line per team that blocks the deletion. */
export function blockingTeamLine(team: BlockingTeam): string {
  if (team.reason === "lead") return `You are the lead coach of ${team.teamName}.`
  return `You are the only coach of ${team.teamName}, which has ${team.athletes} ${team.athletes === 1 ? "athlete" : "athletes"}.`
}

/** A typed confirmation matches when it is the same text, forgiving case and extra spaces. */
export function isTypedConfirmation(expected: string | null | undefined, typed: string): boolean {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase()
  const want = clean(expected ?? "")
  return want !== "" && want === clean(typed)
}

/* ---------------------------------------------------------------------------
   Closing a club
--------------------------------------------------------------------------- */

export const CLUB_DELETION_DAYS = 90

export function deletionDateAfter(closedAt: string | Date, days: number = CLUB_DELETION_DAYS): string {
  const date = new Date(closedAt)
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
  return date.toISOString()
}

/** Whole days until a closed club is deleted. 0 on the day itself and after it. */
export function daysUntilDeletion(deleteAfter: string, now: Date = new Date()): number {
  const ms = new Date(deleteAfter).getTime() - now.getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export function deletionCountdownText(deleteAfter: string, now: Date = new Date()): string {
  const days = daysUntilDeletion(deleteAfter, now)
  if (days === 0) return "Due for deletion now"
  return days === 1 ? "1 day left" : `${days} days left`
}
