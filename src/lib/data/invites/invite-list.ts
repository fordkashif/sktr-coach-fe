/**
 * Reads a pasted or uploaded list of people to invite. Pure: no network, no DOM.
 *
 * Accepted, one person per line:
 *   maya@example.com
 *   Maya Chen, maya@example.com
 *   Maya Chen <maya@example.com>
 *   maya@example.com, Maya Chen
 *   Maya;Chen;maya@example.com          (a spreadsheet export; tabs and semicolons work too)
 * A CSV file may start with a header row. Columns named "email" and "name" (or "first name" and
 * "last name") are found by name, in any order; other columns are ignored.
 */

export type ParsedInviteLine = {
  /** 1-based line of the pasted text, for "line 4". */
  line: number
  /** What the person typed, trimmed. */
  raw: string
  /** Lower-cased. Empty when the line has no usable email. */
  email: string
  name: string | null
  valid: boolean
  /** Why the line cannot be used, in plain words. Null when valid. */
  problem: string | null
}

/** The bulk invite functions take at most this many lines at once. */
export const INVITE_LIST_MAX = 200

const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

export function isInviteEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value)
}

function cleanName(value: string): string | null {
  const name = value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return name ? name.slice(0, 120) : null
}

/** Splits one CSV style line. Handles "quoted, cells" and the three separators a spreadsheet exports. */
function splitCells(line: string): string[] {
  const separator = line.includes("\t") ? "\t" : line.includes(";") && !line.includes(",") ? ";" : ","
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (char === separator && !quoted) {
      cells.push(current)
      current = ""
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

type Header = { email: number; name: number | null; first: number | null; last: number | null }

function readHeader(cells: string[]): Header | null {
  const names = cells.map((cell) => cell.toLowerCase().replace(/[^a-z]/g, ""))
  const email = names.findIndex((name) => name === "email" || name === "emailaddress" || name === "mail")
  if (email === -1) return null
  const find = (...options: string[]) => {
    const index = names.findIndex((name) => options.includes(name))
    return index === -1 ? null : index
  }
  return {
    email,
    name: find("name", "fullname", "athlete", "athletename"),
    first: find("firstname", "first", "givenname"),
    last: find("lastname", "last", "surname", "familyname"),
  }
}

function parseLine(raw: string, header: Header | null): { email: string; name: string | null } {
  // "Maya Chen <maya@example.com>"
  const angled = /^(.*)<\s*([^<>\s]+)\s*>\s*$/.exec(raw)
  if (angled) return { email: angled[2].trim().toLowerCase(), name: cleanName(angled[1].replace(/[,;]+\s*$/, "")) }

  const cells = splitCells(raw)
  if (header && cells.length > header.email) {
    const first = header.first !== null ? (cells[header.first] ?? "") : ""
    const last = header.last !== null ? (cells[header.last] ?? "") : ""
    const name = header.name !== null ? (cells[header.name] ?? "") : `${first} ${last}`
    return { email: cells[header.email].toLowerCase(), name: cleanName(name) }
  }

  const emailIndex = cells.findIndex((cell) => cell.includes("@"))
  if (emailIndex === -1) {
    // No separators and no @: a bare word, or "Maya Chen maya@example.com" typed with spaces.
    const words = raw.split(/\s+/)
    const emailWord = words.findIndex((word) => word.includes("@"))
    if (emailWord === -1) return { email: "", name: cleanName(raw) }
    return { email: words[emailWord].toLowerCase(), name: cleanName(words.filter((_, index) => index !== emailWord).join(" ")) }
  }
  let emailCell = cells[emailIndex]
  let nameFromEmailCell = ""
  if (/\s/.test(emailCell)) {
    // "Maya Chen maya@example.com" inside one cell.
    const words = emailCell.split(/\s+/)
    const at = words.findIndex((word) => word.includes("@"))
    emailCell = words[at]
    nameFromEmailCell = words.filter((_, index) => index !== at).join(" ")
  }
  const others = cells.filter((_, index) => index !== emailIndex).filter(Boolean)
  return { email: emailCell.toLowerCase(), name: cleanName([nameFromEmailCell, ...others].filter(Boolean).join(" ")) }
}

/**
 * One entry per non-empty line, in order. A second line with the same email is marked as a
 * duplicate here, so the coach sees it before anything is sent. A header row is skipped.
 */
export function parseInviteList(text: string): ParsedInviteLine[] {
  const rows = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\r|\n/)
  const result: ParsedInviteLine[] = []
  const seen = new Set<string>()
  let header: Header | null = null
  let sawContent = false

  rows.forEach((row, index) => {
    const raw = row.trim()
    if (!raw) return
    if (!sawContent) {
      sawContent = true
      // A header is a first line that names an email column and holds no address itself.
      if (!raw.includes("@")) {
        const candidate = readHeader(splitCells(raw))
        if (candidate) {
          header = candidate
          return
        }
      }
    }

    const { email, name } = parseLine(raw, header)
    let problem: string | null = null
    if (!email) problem = "No email address on this line"
    else if (!isInviteEmail(email)) problem = "This is not a valid email address"
    else if (seen.has(email)) problem = "Same email as a line above"
    if (!problem) seen.add(email)
    result.push({ line: index + 1, raw, email: problem && !email ? "" : email, name, valid: problem === null, problem })
  })

  return result
}
