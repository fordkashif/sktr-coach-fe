/**
 * Rows pasted from a spreadsheet (Excel, Google Sheets, Numbers) turned into plan blocks.
 *
 * What it understands, in the shape coaches already keep their weeks:
 * - one row per exercise: Exercise, Sets, Reps, Load (or %), Notes, split by tabs,
 * - a header row ("Exercise, Sets, Reps, %, Notes") which also says which column is which,
 * - a row with only a word in capitals ("CORE") or ending in a colon: a new section,
 * - a row with no name but sets or reps: another set of the exercise above (Back squat 1 x 6, then 1 x 3),
 * - a row naming a weekday ("Monday"): the rows under it belong to that day,
 * - a title row ("November 9-13, 2026") is skipped,
 * - text with no tabs: "Back squat 3 x 5 @ 80%" or a plain name.
 * Everything in this file is pure so it can be tested without a browser.
 */

export type PastedExercise = { name: string; sets: string; reps: string; load: string; notes: string }
export type PastedBlock = { title: string; exercises: PastedExercise[] }
export type PastedDay = {
  /** 0 (Sunday) to 6, when the rows were under a weekday row. Null when no weekday was named. */
  weekday: number | null
  blocks: PastedBlock[]
}
export type PastedSheet = {
  days: PastedDay[]
  exerciseCount: number
  /** True when the rows had a weekday row or a header row: they look like a training sheet. */
  looksLikePlan: boolean
}

type Column = "name" | "sets" | "reps" | "load" | "notes" | "skip"

const DEFAULT_COLUMNS: Column[] = ["name", "sets", "reps", "load", "notes"]
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
const WEEKDAY_ROW = /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|rsday|urday)?\b[\s,.]*(\d{1,2}(st|nd|rd|th)?)?[\s,.]*([a-z]{3,9}\.?)?[\s,.]*(\d{1,2})?$/i
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i
const INLINE = /^(.*?)\s+(\d{1,2})\s*[x×]\s*([^\s@]+)(?:\s*@\s*(.+))?$/i
const NOTE_WORDS = /\b(each|per|side|leg|arm|alternate|both)\b/i

/** What a header cell names, or null when the cell is not a header word. */
function columnOf(cell: string): Column | null {
  const text = cell.trim().toLowerCase()
  if (!text) return "skip"
  if (/^(exercise|exercises|movement|lift|name|drill)$/.test(text)) return "name"
  if (/^sets?$/.test(text)) return "sets"
  if (/^(reps?|repetitions|distance|time|duration)$/.test(text)) return "reps"
  if (/^(%|percent|percentage|load|weight|intensity|kg|lbs?|rpe)$/.test(text)) return "load"
  if (/^(notes?|comments?|cues?|coaching notes?)$/.test(text)) return "notes"
  return null
}

function headerColumns(cells: string[]): Column[] | null {
  const columns = cells.map(columnOf)
  if (columns.some((column) => column === null)) return null
  const named = columns.filter((column): column is Column => column !== null && column !== "skip")
  // A header names at least the exercise and one of sets or reps.
  if (!named.includes("name") || !(named.includes("sets") || named.includes("reps"))) return null
  return columns as Column[]
}

function weekdayOf(text: string): number | null {
  const match = WEEKDAY_ROW.exec(text.trim())
  if (!match) return null
  return WEEKDAYS.indexOf(match[1].slice(0, 3).toLowerCase())
}

/** "CORE" reads "Core" and "UPPER BODY" reads "Upper body"; anything with lower case letters keeps its own spelling. */
export function tidyHeading(text: string) {
  const clean = text.trim().replace(/:$/, "").trim()
  if (clean !== clean.toUpperCase()) return clean
  const lower = clean.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function isSectionHeading(name: string) {
  const text = name.trim()
  if (!text || text.length > 40) return false
  if (text.endsWith(":")) return true
  return /[A-Z]/.test(text) && text === text.toUpperCase() && /^[A-Z0-9 &/+()-]+$/.test(text) && /[A-Z]{4}|[A-Z]{2,} [A-Z]{2,}/.test(text)
}

/** "> Countermovement jump" or "- Plank": the marks people use to tuck one row under another. */
function cleanName(raw: string) {
  return raw.replace(/^[\s>•\-–*·]+/, "").replace(/\s+/g, " ").trim()
}

function cleanReps(raw: string) {
  return raw
    .trim()
    .replace(/^(\d+)\s*(secs?|seconds?)$/i, "$1s")
    .replace(/^(\d+)\s*(mins?|minutes?)$/i, "$1 min")
}

function splitCells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t")
  // Rows copied from some apps keep the columns as runs of spaces.
  if (/\S {3,}\S/.test(line.trim())) return line.trim().split(/ {3,}/)
  return [line]
}

export function looksLikeRows(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  return lines.length > 1 || text.includes("\t")
}

export function parsePastedSheet(text: string): PastedSheet {
  const days: PastedDay[] = []
  let day: PastedDay | null = null
  let block: PastedBlock | null = null
  let columns = DEFAULT_COLUMNS
  let lastName = ""
  let exerciseCount = 0
  let looksLikePlan = false

  const currentDay = () => {
    if (!day) {
      day = { weekday: null, blocks: [] }
      days.push(day)
    }
    return day
  }
  const currentBlock = () => {
    const target = currentDay()
    if (!block) {
      block = { title: "Main", exercises: [] }
      target.blocks.push(block)
    }
    return block
  }

  for (const line of text.split(/\r?\n/)) {
    const cells = splitCells(line)
    const values = cells.map((cell) => cell.trim())
    if (values.every((value) => !value)) continue

    const header = headerColumns(values)
    if (header) {
      columns = header
      looksLikePlan = true
      continue
    }

    const filled = values.filter(Boolean)
    if (filled.length === 1) {
      const only = filled[0]
      const weekday = weekdayOf(only)
      if (weekday !== null) {
        day = { weekday, blocks: [] }
        days.push(day)
        block = null
        lastName = ""
        looksLikePlan = true
        continue
      }
      // A title row such as "November 9-13, 2026".
      if (MONTHS.test(only) && /\d/.test(only) && values.indexOf(only) === 0) continue
    }

    const row: PastedExercise = { name: "", sets: "", reps: "", load: "", notes: "" }
    values.forEach((value, index) => {
      const column = columns[index] ?? (index === 0 ? "name" : "notes")
      if (column === "skip" || !value) return
      if (column === "name") row.name = cleanName(cells[index])
      else if (column === "notes") row.notes = row.notes ? `${row.notes}. ${value}` : value
      else row[column] = value
    })

    // A single cell: maybe "Back squat 3 x 5 @ 80% (each leg)".
    if (cells.length === 1 && row.name) {
      const note = /^(.*\S)\s*\(([^()]+)\)$/.exec(row.name)
      if (note && !/^\d+\/\d+$/.test(note[2].trim())) {
        row.name = note[1].trim()
        row.notes = note[2].trim()
      }
      const inline = INLINE.exec(row.name)
      if (inline) {
        row.name = cleanName(inline[1])
        row.sets = inline[2]
        row.reps = inline[3]
        row.load = inline[4]?.trim() ?? ""
      }
    }

    if (row.name && !row.sets && !row.reps && !row.load && !row.notes && isSectionHeading(row.name)) {
      block = { title: tidyHeading(row.name), exercises: [] }
      currentDay().blocks.push(block)
      lastName = ""
      continue
    }

    if (!row.name) {
      // Another set of the exercise above.
      if (!lastName || !(row.sets || row.reps || row.load)) continue
      row.name = lastName
    }
    lastName = row.name

    // "Each leg" typed into the load column is a note.
    if (row.load && !/\d/.test(row.load) && NOTE_WORDS.test(row.load) && !row.notes) {
      row.notes = row.load
      row.load = ""
    }
    if (row.load === "-") row.load = ""
    // "LAST WEEK ADJUSTED" reads "Last week adjusted".
    if (/[A-Z]{3}/.test(row.load) && row.load === row.load.toUpperCase() && !/\d/.test(row.load)) row.load = row.load.charAt(0) + row.load.slice(1).toLowerCase()
    row.reps = cleanReps(row.reps)
    currentBlock().exercises.push(row)
    exerciseCount += 1
  }

  return {
    days: days.map((entry) => ({ ...entry, blocks: entry.blocks.filter((item) => item.exercises.length > 0 || item.title !== "Main") })).filter((entry) => entry.blocks.length > 0),
    exerciseCount,
    looksLikePlan,
  }
}

/** Pasted blocks as plan blocks, with fresh ids. Notes go in the row's note for athletes. */
export function pastedToBlocks(blocks: PastedBlock[], makeId: (prefix: string) => string): BlockDraftLike[] {
  return blocks.map((block) => ({
    id: makeId("block"),
    title: block.title,
    notes: "",
    exercises: block.exercises.map((row) => ({
      id: makeId("ex"),
      name: row.name,
      sets: row.sets,
      reps: row.reps,
      load: row.load,
      ...(row.notes ? { cue: row.notes } : {}),
    })),
  }))
}

type BlockDraftLike = {
  id: string
  title: string
  notes: string
  exercises: Array<{ id: string; name: string; sets: string; reps: string; load: string; cue?: string }>
}

/**
 * Blocks pasted into a day that already has some: rows with no section of their own ("Main")
 * carry on the last section of the day, the rest are added after it.
 */
export function mergePastedBlocks<B extends BlockDraftLike>(existing: B[], pasted: B[]): B[] {
  if (pasted.length === 0) return existing
  const [first, ...rest] = pasted
  const last = existing[existing.length - 1]
  if (first.title === "Main" && last) {
    return [...existing.slice(0, -1), { ...last, exercises: [...last.exercises, ...first.exercises] }, ...rest]
  }
  return [...existing, ...pasted]
}

/** "Back squat, bench press and deadlift": a session title from its first exercises. */
export function titleFromBlocks(blocks: Array<{ exercises: Array<{ name: string }> }>) {
  const names: string[] = []
  for (const block of blocks) {
    for (const exercise of block.exercises) {
      const name = exercise.name.trim()
      if (!name || names.some((seen) => seen.toLowerCase() === name.toLowerCase())) continue
      names.push(name)
      if (names.length === 3) break
    }
    if (names.length === 3) break
  }
  if (names.length === 0) return ""
  // "Back Squat" reads "back squat" in a title; "RDL" stays as it is.
  const lower = (name: string) => name.split(" ").map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase())).join(" ")
  const parts = names.map((name, index) => (index === 0 ? name.charAt(0).toUpperCase() + lower(name).slice(1) : lower(name)))
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

/** One row as a line you can type back in: "Back squat 3x5 @80% (each leg)". */
export function exerciseLine(row: { name: string; sets: string; reps: string; load: string; cue?: string }) {
  const volume = row.sets.trim() && row.reps.trim() ? `${row.sets.trim()}x${row.reps.trim()}` : row.reps.trim() || (row.sets.trim() ? `${row.sets.trim()}x` : "")
  return [row.name.trim(), volume, row.load.trim() ? `@${row.load.trim()}` : "", row.cue?.trim() ? `(${row.cue.trim()})` : ""].filter(Boolean).join(" ")
}

/** A typed line: an exercise, or a section heading ("CORE"). Null when there is nothing on it. */
export function parseLine(text: string): { heading: string } | { exercise: PastedExercise } | null {
  const sheet = parsePastedSheet(text.trim())
  const block = sheet.days[0]?.blocks[0]
  if (!block) return null
  if (block.exercises.length === 0) return block.title && block.title !== "Main" ? { heading: block.title } : null
  return { exercise: block.exercises[0] }
}
