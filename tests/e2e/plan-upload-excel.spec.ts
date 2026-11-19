import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"
import { boardDay } from "./helpers/plan-board"

const BLOCK = "tests/fixtures/plan-block.xlsx"

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport })

    test("a new plan is filled from an Excel workbook, one tab per week", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t4" })
      await page.goto("/coach/training-plan")
      await page.getByRole("button", { name: "New plan" }).first().click()
      await page.getByLabel("Plan name").fill("Block from Excel")
      await page.getByRole("button", { name: "Next" }).click()

      const chooser = page.waitForEvent("filechooser")
      await page.getByRole("button", { name: "Upload Excel" }).click()
      await (await chooser).setFiles(BLOCK)

      const tabs = page.getByRole("list", { name: "Tabs in the file" })
      await expect(page.locator("[data-file-name]")).toHaveText("plan-block.xlsx")
      await expect(tabs.locator('[data-tab="Nov 9-13"]')).toContainText("Week 1")
      await expect(tabs.locator('[data-tab="Nov 9-13"]')).toContainText("2 days, 7 exercises")
      await expect(tabs.locator('[data-tab="Nov 16-20"]')).toContainText("Week 2")
      await expect(tabs.locator('[data-tab="Maxes"]')).toContainText("No training days found")
      await expect(tabs.locator('[data-tab="Maxes"]')).toContainText("Skipped")

      // Leaving out the first tab moves the next one up to week 1.
      await tabs.locator('[data-tab="Nov 9-13"]').getByRole("checkbox").uncheck({ force: true })
      await expect(tabs.locator('[data-tab="Nov 16-20"]')).toContainText("Week 1")
      await expect(page.getByRole("button", { name: "Fill week 1" })).toBeVisible()
      await tabs.locator('[data-tab="Nov 9-13"]').getByRole("checkbox").check({ force: true })
      await page.getByRole("button", { name: "Fill weeks 1 to 2" }).click()

      await expect(page.getByRole("heading", { level: 1, name: "Block from Excel" })).toBeVisible()
      await expect(boardDay(page, 0)).toHaveAttribute("data-has-session", "true")
      await expect(boardDay(page, 0)).toContainText("Back Squat")
      await expect(boardDay(page, 0)).toContainText("50%")
      await expect(boardDay(page, 0)).toContainText("Each Side")
      await expect(boardDay(page, 1)).toContainText("Snatch Complex (2/1)")
      await expect(page.locator('[data-has-session="true"]')).toHaveCount(2)
      await page.getByRole("tab", { name: "Week 2" }).click()
      await expect(page.locator('[data-has-session="true"]')).toHaveCount(2)
      await page.getByRole("tab", { name: "Week 3" }).click()
      await expect(page.locator('[data-has-session="true"]')).toHaveCount(0)
    })

    test("an open plan takes a CSV into the week on screen, and an old .xls is refused", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t4" })
      await page.goto("/coach/training-plan")
      await page.getByRole("button", { name: "New plan" }).first().click()
      await page.getByLabel("Plan name").fill("CSV week")
      await page.getByRole("button", { name: "Next" }).click()
      await page.getByRole("button", { name: "Blank week" }).click()
      await page.getByRole("tab", { name: "Week 2" }).click()

      let chooser = page.waitForEvent("filechooser")
      await page.getByRole("button", { name: "Upload Excel" }).click()
      await (await chooser).setFiles({ name: "week.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("x") })
      await expect(page.locator("#main-content")).toContainText("This is the old Excel format. Save it as .xlsx in Excel, then choose it again.")

      chooser = page.waitForEvent("filechooser")
      await page.getByRole("button", { name: "Upload Excel" }).click()
      await (await chooser).setFiles({ name: "Strength week.csv", mimeType: "text/csv", buffer: Buffer.from('Wednesday\nExercise,Sets,Reps,%,Notes\nFront Squats,3,4,85%,\nDips,4,4,Bodyweight,\n') })
      const dialog = page.getByRole("dialog", { name: "Upload Excel" })
      await expect(dialog.locator('[data-tab="Strength week"]')).toContainText("Week 2")
      await dialog.getByRole("button", { name: "Fill week 2" }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator("body")).toContainText("Filled week 2 from Strength week.csv.")
      await expect(boardDay(page, 2)).toContainText("Front Squats")
      await expect(boardDay(page, 2)).toContainText("Bodyweight")
    })
  })
}
