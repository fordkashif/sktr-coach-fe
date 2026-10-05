import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("coach can review athlete detail, export reports, and publish a test week", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t4" })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto("/coach/athletes/a8")
  await expect(page).toHaveURL(/\/coach\/athletes\/a8$/)
  await expect(page.getByRole("heading", { name: "Mia Anderson" })).toBeVisible()
  await expect(page.locator("body")).toContainText("Plan adherence")
  await expect(page.locator("body")).toContainText("Personal records")

  await page.goto("/coach/reports")
  await expect(page).toHaveURL(/\/coach\/reports$/)
  await expect(page.locator("#main-content").getByRole("heading", { name: "Reports", exact: true })).toBeVisible()

  const adherenceDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("button", { name: /^Adherence CSV$/ }).first().click()
  expect((await adherenceDownload).suggestedFilename()).toBe("coach-athlete-adherence.csv")

  const prDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("tab", { name: "PRs", exact: true }).click()
  await page.locator("#main-content").getByRole("button", { name: /^PR CSV$/ }).first().click()
  expect((await prDownload).suggestedFilename()).toBe("coach-pr-report.csv")

  const wellnessDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("tab", { name: "Wellness", exact: true }).click()
  await page.locator("#main-content").getByRole("button", { name: /^Wellness CSV$/ }).first().click()
  expect((await wellnessDownload).suggestedFilename()).toBe("coach-wellness-export.csv")

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
  await draftRow.getByRole("button", { name: "Continue" }).click()
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
