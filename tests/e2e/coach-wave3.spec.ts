import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("coach can review athlete detail, export reports, and publish a test week", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t4" })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto("/coach/athletes/a8")
  await expect(page).toHaveURL(/\/coach\/athletes\/a8$/)
  await expect(page.getByRole("heading", { name: "Mia Anderson" })).toBeVisible()
  await expect(page.locator("body")).toContainText("Plan adherence")
  await expect(page.locator("body")).toContainText("Recent sessions")
  // The athlete screen has four sections, each one a tab.
  await page.getByRole("tab", { name: "Results" }).click()
  await expect(page.locator("#main-content")).toContainText(/No results yet|Bests/)
  await page.getByRole("tab", { name: "Details" }).click()
  await expect(page.locator("#main-content")).toContainText("Only Mia's coaches and your club admins can see this")

  await page.goto("/coach/reports")
  await expect(page).toHaveURL(/\/coach\/reports$/)
  await expect(page.locator("#main-content").getByRole("heading", { name: "Reports", exact: true })).toBeVisible()

  const adherenceDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("button", { name: /^Adherence CSV$/ }).first().click()
  // The file name carries the team and the period (the last 28 days unless changed).
  expect((await adherenceDownload).suggestedFilename()).toMatch(/^throws-group-adherence-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/)

  const prDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("tab", { name: "Records", exact: true }).click()
  await page.locator("#main-content").getByRole("button", { name: /^Records CSV$/ }).first().click()
  expect((await prDownload).suggestedFilename()).toMatch(/^throws-group-records-.*\.csv$/)

  const wellnessDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("tab", { name: "Wellness", exact: true }).click()
  await page.locator("#main-content").getByRole("button", { name: /^Wellness CSV$/ }).first().click()
  expect((await wellnessDownload).suggestedFilename()).toMatch(/^throws-group-wellness-.*\.csv$/)

  await page.addInitScript(() => {
    window.print = () => {
      ;(window as typeof window & { __PACELAB_PRINT_TRIGGERED?: boolean }).__PACELAB_PRINT_TRIGGERED = true
    }
  })
  await page.reload()
  await page.getByRole("button", { name: "Print / PDF" }).click()
  await expect
    .poll(() => page.evaluate(() => Boolean((window as typeof window & { __PACELAB_PRINT_TRIGGERED?: boolean }).__PACELAB_PRINT_TRIGGERED)))
    .toBe(true)

  await page.goto("/coach/test-week")
  await expect(page).toHaveURL(/\/coach\/test-week$/)
  await expect(page.getByRole("heading", { name: "Test weeks" })).toBeVisible()
  await page.getByRole("button", { name: "New test week" }).click()
  await expect(page.getByRole("heading", { name: "New test week" })).toBeVisible()

  await page.getByLabel("Test week name").fill("Throws Benchmark Week")
  await expect(page.getByRole("heading", { name: "Tests", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Publish test week" }).click()
  await expect(page.getByRole("heading", { name: "Throws Benchmark Week" })).toBeVisible()
  await expect(page.locator("body")).toContainText("Test week published to")
})

test("coach can build a plan with week tools, save a draft, reload, and publish it", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t4" })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto("/coach/training-plan")
  await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()

  // Create the plan.
  await page.getByRole("button", { name: "New plan" }).click()
  await page.getByLabel("Plan name").fill("Wave 3 draft block")
  await page.getByRole("button", { name: "Continue to build" }).click()
  await expect(page.getByRole("heading", { name: "Wave 3 draft block" })).toBeVisible()
  await expect(page.locator('[data-has-session="true"]')).toHaveCount(0)

  // Add a session on the first day of week 1.
  await page.locator('[data-day-index="0"]').click()
  await page.getByLabel("Session title").fill("Full throws and strength")
  await page.getByRole("button", { name: "Strength", exact: true }).click()
  await page.getByRole("button", { name: "Add exercise" }).click()
  await page.getByLabel("Block 1 exercise 1 name").fill("Back squat")
  await expect(page.locator('[data-day-index="0"]')).toHaveAttribute("data-has-session", "true")

  // Copy it to the next day.
  await page.getByRole("button", { name: "Copy to next day" }).click()
  await expect(page.locator('[data-day-index="1"]')).toHaveAttribute("data-has-session", "true")
  await expect(page.locator('[data-day-index="1"]')).toContainText("Full throws and strength")

  // Duplicate week 1 into week 2.
  await page.getByRole("tab", { name: "Week 2" }).click()
  await expect(page.locator('[data-has-session="true"]')).toHaveCount(0)
  await page.getByRole("button", { name: "Duplicate last week" }).click()
  await expect(page.locator('[data-has-session="true"]')).toHaveCount(2)

  // A/B days across four days of week 2.
  await page.getByRole("button", { name: "A/B days" }).click()
  const abTool = page.getByRole("group", { name: "A/B days" })
  await abTool.getByRole("checkbox").nth(3).check()
  await abTool.getByRole("checkbox").nth(4).check()
  await abTool.getByRole("button", { name: "Apply A/B days" }).click()
  await expect(page.locator('[data-has-session="true"]')).toHaveCount(4)

  // Save the draft, reload, and find it again.
  await page.getByRole("button", { name: "Save draft" }).click()
  await expect(page.locator("body")).toContainText("Draft saved at")
  await page.reload()
  await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()
  const draftRow = page.locator('li[data-plan-status="draft"]', { hasText: "Wave 3 draft block" })
  await expect(draftRow).toBeVisible()
  await expect(draftRow).toContainText("Draft")

  // Reopen the draft: the work is still there.
  await draftRow.getByRole("button", { name: /Wave 3 draft block/ }).first().click()
  await expect(page.getByRole("heading", { name: "Wave 3 draft block" })).toBeVisible()
  await expect(page.locator('[data-has-session="true"]')).toHaveCount(2)
  await page.getByRole("tab", { name: "Week 2" }).click()
  await expect(page.locator('[data-has-session="true"]')).toHaveCount(4)

  // Publish.
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Publish plan" })).toBeVisible()
  await page.getByRole("button", { name: /^Publish to/ }).click()
  await expect(page.locator("body")).toContainText("Plan published to")
  await page.getByRole("button", { name: "Back to plans" }).click()
  await expect(page.locator('li[data-plan-status="published"]', { hasText: "Wave 3 draft block" })).toBeVisible()
  await expect(page.locator('li[data-plan-status="draft"]')).toHaveCount(0)
})

test("coach reports follow the chosen date range, in the numbers and in the export", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t4" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/reports")
  const main = page.locator("#main-content")
  await expect(main.getByRole("heading", { name: "Reports", exact: true })).toBeVisible()
  await expect(main.getByRole("table")).toContainText("Mia Anderson")

  const sessionsDone = main.locator(".sk-stat", { hasText: "Sessions done" })
  const defaultRange = await sessionsDone.innerText()

  // Two weeks in September: fewer sessions were due, so the figures change.
  await main.getByLabel("From").fill("2026-09-01")
  await main.getByLabel("To").fill("2026-09-14")
  await expect(sessionsDone).not.toHaveText(defaultRange)
  await expect(sessionsDone).toContainText("of 24")
  await expect(main).toContainText("1 Sept to 14 Sept 2026")

  const download = page.waitForEvent("download")
  await main.getByRole("button", { name: /^Adherence CSV$/ }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("throws-group-adherence-2026-09-01-to-2026-09-14.csv")
  const csv = await (await import("node:fs/promises")).readFile(await file.path(), "utf8")
  expect(csv).toContain('"Period","2026-09-01 to 2026-09-14"')
  expect(csv).toContain("Mia Anderson")

  // Records: only bests set inside the period are listed. A wider period brings them back.
  await main.getByRole("tab", { name: "Records", exact: true }).click()
  await expect(main).toContainText("No new bests in this period")
  await main.getByRole("button", { name: "Last 90 days" }).first().click()
  await expect(main.getByRole("table")).toContainText("Shot Put")

  // An end date before the start date is not possible: the other end moves with it.
  await main.getByLabel("To").fill("2026-06-01")
  await expect(main.getByLabel("From")).toHaveValue("2026-06-01")
})
