import { expect, type Page } from "@playwright/test"

/** "New plan", a name, then a blank week: the board opens. */
export async function newBlankPlan(page: Page, name: string, options?: { weeks?: number; startToday?: boolean }) {
  await page.getByRole("button", { name: "New plan" }).first().click()
  await page.getByLabel("Plan name").fill(name)
  // "Pick a date" starts on today; the plan otherwise starts on the coming Monday.
  if (options?.startToday) await page.getByRole("radio", { name: "Pick a date" }).click()
  if (options?.weeks) {
    const current = Number(await page.locator("output[aria-label='Weeks']").innerText())
    const step = options.weeks > current ? "More weeks" : "Fewer weeks"
    for (let index = 0; index < Math.abs(options.weeks - current); index += 1) await page.getByRole("button", { name: step }).click()
  }
  await page.getByRole("button", { name: "Next" }).click()
  await page.getByRole("button", { name: "Blank week" }).click()
  await expect(page.getByRole("heading", { name })).toBeVisible()
}

export function boardDay(page: Page, dayIndex: number) {
  return page.locator(`[data-board-day="${dayIndex}"]`)
}

/** Starts a session on a rest day, then types rows into it ("Back squat 3x5 @80%", "CORE"). */
export async function addRows(page: Page, dayIndex: number, lines: string[]) {
  const day = boardDay(page, dayIndex)
  if ((await day.getAttribute("data-has-session")) === "false") await day.getByRole("button", { name: /Add a session/ }).click()
  const line = day.locator("[data-board-line]")
  for (const text of lines) {
    await line.fill(text)
    await line.press("Enter")
  }
}

/** A day's menu: "Open as a table", "Session details", "Copy to next day", "Remove session". */
export async function dayMenu(page: Page, dayIndex: number, item: string) {
  await boardDay(page, dayIndex).getByRole("button", { name: /^More for / }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

/** The week's menu: "Week focus and load", "Duplicate last week", "A/B days". */
export async function weekTool(page: Page, item: string) {
  await page.getByRole("button", { name: /^Tools for week / }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

/**
 * A session on a day with one section, opened as a table with an empty first row, ready for the
 * row labels the table uses ("Block 1 exercise 1 name").
 */
export async function openDayTable(page: Page, dayIndex: number, options: { title?: string; section?: string } = {}) {
  await addRows(page, dayIndex, [(options.section ?? "Main").toUpperCase()])
  if (options.title) await boardDay(page, dayIndex).getByLabel(/session title/).fill(options.title)
  await dayMenu(page, dayIndex, "Open as a table")
  const dialog = page.getByRole("dialog")
  await dialog.locator("[data-sheet-new-row]").fill("x")
  await expect(dialog.getByLabel("Block 1 exercise 1 name", { exact: true })).toBeVisible()
  return dialog
}

/** Closes the day table. */
export async function closeDayTable(page: Page) {
  // A row menu used inside the table may still hold the first Escape.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Escape")
    await page.waitForTimeout(200)
    if ((await page.getByRole("dialog").count()) === 0) break
  }
  await expect(page.getByRole("dialog")).toHaveCount(0)
}
