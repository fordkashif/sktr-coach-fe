import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("coach can review athlete detail, export reports, and publish a test week", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t4" })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto("/coach/athletes/a8")
  await expect(page).toHaveURL(/\/coach\/athletes\/a8$/)
  await expect(page.getByRole("heading", { name: "Mia Anderson" })).toBeVisible()
  await expect(page.locator("body")).toContainText("Coach Summary")
  await expect(page.locator("body")).toContainText("Performance Summary")

  await page.goto("/coach/reports")
  await expect(page).toHaveURL(/\/coach\/reports$/)
  await expect(page.locator("#main-content").getByRole("heading", { name: "Reports", exact: true })).toBeVisible()

  const adherenceDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("button", { name: /^Adherence CSV$/ }).first().click()
  expect((await adherenceDownload).suggestedFilename()).toBe("coach-athlete-adherence.csv")

  const prDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("button", { name: /^PR CSV$/ }).first().click()
  expect((await prDownload).suggestedFilename()).toBe("coach-pr-report.csv")

  const wellnessDownload = page.waitForEvent("download")
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
  await expect(page.getByRole("heading", { name: "Test Weeks" })).toBeVisible()
  await page.getByRole("button", { name: /Create test/i }).click()
  await expect(page.getByRole("heading", { name: "Create test" })).toBeVisible()

  await page.getByLabel("Name").fill("Throws Benchmark Week")
  await page.getByRole("button", { name: /Continue to build/i }).click()
  await expect(page.getByRole("heading", { name: "Build" })).toBeVisible()
  await page.getByRole("button", { name: /Continue to publish/i }).click()
  await expect(page.getByRole("heading", { name: "Publish", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Publish Test Week" }).click()
  await expect(page.locator("body")).toContainText("Test week published to")
})
