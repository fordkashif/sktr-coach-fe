/**
 * Reading a coach's spreadsheet file (.xlsx or .csv) into rows of text, one list of rows per tab,
 * so each tab can go through the same reader as pasted rows (see plan-paste.ts).
 *
 * An .xlsx file is a zip of XML parts. Only what a training sheet needs is read: the tabs in their
 * order, the text and numbers in the cells, and which cells are shown as percentages (0.8 shown as
 * 80% reads "80%"). Formulas count by their last saved value. The parsing is plain string work so
 * it can be tested without a browser.
 */

export type ImportedTab = { name: string; rows: string[][] }

const XML_ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" }

function decodeXml(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (entity) => XML_ENTITIES[entity])
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return match ? decodeXml(match[1]) : null
}

/** Every text run of a shared string or inline string, joined. */
function textOf(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("")
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]))
}

/** Which cell styles (by index) show a number as a percentage. */
function percentStyles(xml: string | undefined): Set<number> {
  const percent = new Set<number>()
  if (!xml) return percent
  const custom = new Map<number, string>()
  for (const match of xml.matchAll(/<numFmt\s[^>]*\/?>/g)) {
    const id = Number(attribute(match[0], "numFmtId"))
    custom.set(id, attribute(match[0], "formatCode") ?? "")
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ""
  ;[...cellXfs.matchAll(/<xf\s[^>]*?(?:\/>|>)/g)].forEach((match, index) => {
    const id = Number(attribute(match[0], "numFmtId") ?? 0)
    // 9 and 10 are Excel's built-in 0% and 0.00%.
    if (id === 9 || id === 10 || /%/.test(custom.get(id) ?? "")) percent.add(index)
  })
  return percent
}

function columnIndex(reference: string) {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "A"
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/** A number as a sheet shows it: 6, 2.5, 0.85 shown as 85%. */
function numberText(raw: string, asPercent: boolean) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw
  const shown = asPercent ? value * 100 : value
  const rounded = Math.round(shown * 100) / 100
  return `${rounded}${asPercent ? "%" : ""}`
}

function sheetRows(xml: string, strings: string[], percent: Set<number>): string[][] {
  const rows: string[][] = []
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const rowNumber = Number(attribute(rowMatch[0], "r") ?? rows.length + 1)
    const cells: string[] = []
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${cellMatch[1]}>`
      const body = cellMatch[2] ?? ""
      const type = attribute(tag, "t")
      const style = Number(attribute(tag, "s") ?? 0)
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let text = ""
      if (type === "s" && value !== undefined) text = strings[Number(value)] ?? ""
      else if (type === "inlineStr") text = textOf(body)
      else if (type === "str" || type === "e") text = value !== undefined ? decodeXml(value) : ""
      else if (type === "b") text = value === "1" ? "TRUE" : "FALSE"
      else if (value !== undefined) text = numberText(value, percent.has(style))
      const index = columnIndex(attribute(tag, "r") ?? "")
      while (cells.length < index) cells.push("")
      cells[index] = text
    }
    while (rows.length < rowNumber - 1) rows.push([])
    rows[rowNumber - 1] = cells
  }
  return rows
}

/** The tabs of an unzipped workbook, in the order they appear in Excel. */
export function tabsFromWorkbookParts(parts: Record<string, string>): ImportedTab[] {
  const workbook = parts["xl/workbook.xml"]
  if (!workbook) throw new Error("This is not an Excel workbook.")
  const relations = new Map<string, string>()
  for (const match of (parts["xl/_rels/workbook.xml.rels"] ?? "").matchAll(/<Relationship\s[^>]*\/?>/g)) {
    const id = attribute(match[0], "Id")
    const target = attribute(match[0], "Target")
    if (id && target) relations.set(id, target.replace(/^\/?(xl\/)?/, "xl/"))
  }
  const strings = sharedStrings(parts["xl/sharedStrings.xml"])
  const percent = percentStyles(parts["xl/styles.xml"])
  const tabs: ImportedTab[] = []
  ;[...workbook.matchAll(/<sheet\s[^>]*\/?>/g)].forEach((match, index) => {
    const name = attribute(match[0], "name") ?? `Sheet${index + 1}`
    const id = attribute(match[0], "r:id")
    const path = (id && relations.get(id)) || `xl/worksheets/sheet${index + 1}.xml`
    const xml = parts[path]
    if (xml) tabs.push({ name, rows: sheetRows(xml, strings, percent) })
  })
  return tabs
}

/** Rows of a CSV file. Quoted cells may hold commas, quotes ("") and line breaks. */
export function rowsFromCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const clean = text.replace(/^\uFEFF/, "")
  // Some spreadsheets save "CSV" with semicolons.
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ""
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ","
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === separator) {
      row.push(cell)
      cell = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[index + 1] === "\n") index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += char
  }
  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** Rows as the tab separated text the paste reader takes. Tabs inside cells become spaces. */
export function rowsToText(rows: string[][]) {
  return rows.map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n")
}

/** Reads a chosen file into its tabs. A CSV file is one tab named after the file. */
export async function readSpreadsheetFile(file: File): Promise<ImportedTab[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".csv")) return [{ name: file.name.replace(/\.csv$/i, ""), rows: rowsFromCsv(await file.text()) }]
  if (name.endsWith(".xls")) throw new Error("This is the old Excel format. Save it as .xlsx in Excel, then choose it again.")
  if (!name.endsWith(".xlsx") && !name.endsWith(".xlsm")) throw new Error("Choose an Excel (.xlsx) or CSV file.")
  const { unzipSync, strFromU8 } = await import("fflate")
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => entry.name.startsWith("xl/") && entry.name.endsWith(".xml") || entry.name.endsWith(".rels"),
    })
  } catch {
    throw new Error("This file could not be opened. Save it again in Excel and choose it again.")
  }
  const parts: Record<string, string> = {}
  for (const [path, bytes] of Object.entries(files)) parts[path] = strFromU8(bytes)
  return tabsFromWorkbookParts(parts)
}
