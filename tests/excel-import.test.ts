import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { readSpreadsheetFile, rowsFromCsv, rowsToText, tabsFromWorkbookParts } from "../src/lib/data/training-plan/excel-import"
import { parsePastedSheet } from "../src/lib/data/training-plan/plan-paste"

async function fixture(name: string, type: string) {
  const bytes = await readFile(`tests/fixtures/${name}`)
  return new File([bytes], name, { type })
}

test("an Excel workbook reads tab by tab, with percentages as the sheet shows them", async () => {
  const tabs = await readSpreadsheetFile(await fixture("plan-block.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
  assert.deepEqual(tabs.map((tab) => tab.name), ["Nov 9-13", "Nov 16-20", "Maxes"])
  const text = rowsToText(tabs[0].rows)
  assert.match(text, /Back Squat\t1\t6\t50%/)
  assert.match(text, /\t1\t3\t75%/)
  const sheet = parsePastedSheet(text)
  assert.deepEqual(sheet.days.map((day) => day.weekday), [1, 2])
  assert.deepEqual(sheet.days[0].blocks.map((block) => block.title), ["Main", "Core"])
  assert.deepEqual(sheet.days[0].blocks[0].exercises.map((row) => [row.name, row.sets, row.reps, row.load]), [
    ["Back Squat", "1", "6", "50%"],
    ["Back Squat", "1", "3", "75%"],
    ["Back Squat", "1", "AMRAP", "Last week adjusted"],
    ["Bench Press", "3", "5", "80%"],
  ])
  assert.equal(sheet.days[0].blocks[1].exercises[0].notes, "Each Side")
  // A tab of best lifts has no training days in it.
  assert.equal(parsePastedSheet(rowsToText(tabs[2].rows)).looksLikePlan, false)
  assert.equal(sheet.looksLikePlan, true)
})

test("an old .xls file and other files are refused with a reason", async () => {
  await assert.rejects(readSpreadsheetFile(new File(["x"], "week.xls")), /old Excel format/)
  await assert.rejects(readSpreadsheetFile(new File(["x"], "week.pdf")), /Excel \(\.xlsx\) or CSV/)
  await assert.rejects(readSpreadsheetFile(new File(["not a zip"], "week.xlsx")), /could not be opened/)
})

test("a CSV file is one tab, quotes and semicolons included", async () => {
  const tabs = await readSpreadsheetFile(new File(['Monday\nBack squat,3,5,80%,"Brace, then go"\n'], "Strength week.csv"))
  assert.equal(tabs[0].name, "Strength week")
  assert.deepEqual(tabs[0].rows[1], ["Back squat", "3", "5", "80%", "Brace, then go"])
  assert.deepEqual(rowsFromCsv("a;b;c\n1;2;3"), [["a", "b", "c"], ["1", "2", "3"]])
  assert.deepEqual(rowsFromCsv('"say ""hi"""\r\nx'), [['say "hi"'], ["x"]])
})

test("cells land in their columns, with gaps and inline text", () => {
  const tabs = tabsFromWorkbookParts({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Week &amp; more" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>Plank</t></is></c><c r="C2"><v>45</v></c></row></sheetData></worksheet>',
  })
  assert.equal(tabs[0].name, "Week & more")
  assert.deepEqual(tabs[0].rows, [[], ["Plank", "", "45"]])
})
