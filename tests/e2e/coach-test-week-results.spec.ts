import { expect, test, type Download } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { seedMockSession } from "./helpers/session"

async function downloadText(download: Download) {
  const path = await download.path()
  return readFile(path, "utf8")
}

async function openSprintWeek(page: import("@playwright/test").Page) {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/test-week")
  await page.getByRole("button", { name: /January Speed Testing/ }).click()
  await expect(page.getByRole("heading", { level: 1, name: "January Speed Testing" })).toBeVisible()
}

test("coach can close a test week, keep correcting it, and reopen it", async ({ page }) => {
  await openSprintWeek(page)
  const main = page.locator("#main-content")
  const header = main.locator("header")
  await expect(header).toContainText("Open")

  // Closing asks first, in place.
  await header.getByRole("button", { name: "Close test week" }).click()
  const confirm = main.getByRole("group", { name: "Confirm" })
  await expect(confirm).toContainText("Athletes can no longer enter or change results")
  await confirm.getByRole("button", { name: "Keep it open" }).click()
  await expect(header).toContainText("Open")

  await header.getByRole("button", { name: "Close test week" }).click()
  await main.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Close test week" }).click()
  await expect(header).toContainText("Closed")
  await expect(main).toContainText("Athletes can no longer enter results")
  await expect(header.getByRole("button", { name: "Close test week" })).toHaveCount(0)

  // A closed week can still be corrected by the coach.
  await main.getByRole("tab", { name: "Enter results" }).click()
  const cell = main.getByLabel("Marcus Johnson, 30m")
  await cell.fill("3.97")
  await cell.press("Enter")
  await expect(main.getByRole("status").filter({ hasText: "All results saved" })).toBeVisible()

  // It stays closed after a reload, and the list says so.
  await page.reload()
  await expect(page.getByRole("table")).toContainText("Closed")
  await page.getByRole("button", { name: /January Speed Testing/ }).click()
  await expect(main.getByRole("table")).toContainText("3.97s")

  await main.locator("header").getByRole("button", { name: "Reopen" }).click()
  await expect(main.locator("header")).toContainText("Open")
  await expect(main).toContainText("Reopened. Athletes can enter results again")
  await expect(main.locator("header").getByRole("button", { name: "Close test week" })).toBeVisible()
})

test("coach can type and paste results for athletes in the entry grid and export them", async ({ page }) => {
  await openSprintWeek(page)
  const main = page.locator("#main-content")
  await main.getByRole("tab", { name: "Enter results" }).click()

  const grid = main.locator("[data-sk-entry-grid]")
  await expect(grid.getByRole("columnheader", { name: /30m/ }).first()).toBeVisible()
  // What athletes submitted is already there, as plain numbers.
  await expect(main.getByLabel("Marcus Johnson, 30m")).toHaveValue("4.05")

  // Enter saves and moves down, Tab moves across.
  await main.getByLabel("Marcus Johnson, 30m").fill("3.98")
  await page.keyboard.press("Enter")
  await expect(main.getByLabel("Sarah Chen, 30m")).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(main.getByLabel("Sarah Chen, Flying 30m")).toBeFocused()
  await expect(main.getByLabel("Marcus Johnson, 30m")).toHaveAttribute("data-state", "saved")

  // The same checks as the athlete form: a bad value is refused and nothing is saved.
  const bad = main.getByLabel("Sarah Chen, 30m")
  await bad.fill("fast")
  await page.keyboard.press("Tab")
  await expect(bad).toHaveAttribute("aria-invalid", "true")
  await bad.focus()
  await expect(main.getByRole("alert").filter({ hasText: "Numbers only, in seconds." })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(bad).toHaveValue("4.22")
  await expect(bad).not.toHaveAttribute("aria-invalid", "true")

  // A column copied from a spreadsheet fills down from the cell it is pasted into.
  await main.getByLabel("Marcus Johnson, Squat 1RM").focus()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData("text", "190\n125\n180kg\n")
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(main.getByLabel("Marcus Johnson, Squat 1RM")).toHaveValue("190")
  await expect(main.getByLabel("Sarah Chen, Squat 1RM")).toHaveValue("125")
  await expect(main.getByLabel("David Okafor, Squat 1RM")).toHaveValue("180")
  await expect(main.getByRole("status").filter({ hasText: "All results saved" })).toBeVisible()

  // Emptying a cell removes that result.
  const cmj = main.getByLabel("Sophia Kim, CMJ")
  await cmj.fill("")
  await cmj.press("Enter")

  // The results views show the new marks and who entered them.
  await main.getByRole("tab", { name: "By athlete" }).click()
  const table = main.getByRole("table")
  await expect(table).toContainText("3.98s")
  await expect(table).toContainText("190kg")
  await expect(table.getByRole("row", { name: /Marcus Johnson/ })).toContainText("2 by coach")

  const download = page.waitForEvent("download")
  await main.getByRole("button", { name: "Download results as CSV" }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("january-speed-testing-results.csv")
  const csv = await downloadText(file)
  expect(csv).toContain('"Test week","January Speed Testing"')
  expect(csv).toContain('"Marcus Johnson","100m","3.98"')
  expect(csv).toContain("Entered by coach")

  // Saved for good: still there after a reload.
  await page.reload()
  await page.getByRole("button", { name: /January Speed Testing/ }).click()
  await expect(page.locator("#main-content").getByRole("table")).toContainText("3.98s")
})

test("the entry grid works on a phone without scrolling the page sideways", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/coach/test-week")
  await page.getByRole("button", { name: /January Speed Testing/ }).click()
  const main = page.locator("#main-content")
  await main.getByRole("tab", { name: "Enter results" }).click()
  await expect(main.locator("[data-sk-entry-grid-hint]")).toBeVisible()
  await main.getByLabel("Sophia Kim, CMJ").fill("55")
  await page.keyboard.press("Enter")
  await expect(main.getByRole("status").filter({ hasText: "All results saved" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  expect(await main.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0)
})
