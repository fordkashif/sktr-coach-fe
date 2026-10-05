import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Demo data: t1 "Sprint Group" (Marcus Johnson, Sarah Chen, ...) and t4 "Throws Group" (Mia Anderson, Liam Patel).
// The coach is put on both teams with the mock mechanism in tests/e2e/helpers/session.ts (coachTeamIds).

const main = (page: Page) => page.locator("#main-content")
const topBar = (page: Page) => page.locator("header[data-shell='topbar']")
const switcher = (page: Page) => page.getByRole("button", { name: /^Switch team/ })

async function switchTo(page: Page, teamName: string) {
  await switcher(page).click()
  await page.getByRole("menuitemradio", { name: new RegExp(teamName) }).click()
  await expect(switcher(page)).toContainText(teamName)
}

test("a coach on two teams can switch team and every screen follows", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1", coachTeamIds: ["t1", "t4"] })
  await page.setViewportSize({ width: 1440, height: 900 })

  // Team A on the dashboard.
  await page.goto("/coach/dashboard")
  await expect(switcher(page)).toBeVisible()
  await expect(switcher(page)).toContainText("Sprint Group")
  await expect(main(page).getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()
  await expect(main(page)).toContainText("Marcus Johnson")
  await expect(main(page)).not.toContainText("Mia Anderson")

  // The menu lists both teams with their event group and marks the current one.
  await switcher(page).click()
  const sprintItem = page.getByRole("menuitemradio", { name: /Sprint Group/ })
  const throwsItem = page.getByRole("menuitemradio", { name: /Throws Group/ })
  await expect(page.getByRole("menuitemradio")).toHaveCount(2)
  await expect(sprintItem).toHaveAttribute("aria-checked", "true")
  await expect(throwsItem).toHaveAttribute("aria-checked", "false")
  await expect(throwsItem).toContainText("Throws")

  // Switch to team B: the dashboard changes in place, with no reload and nothing left from team A.
  await page.evaluate(() => {
    ;(window as typeof window & { __NO_RELOAD_MARK?: boolean }).__NO_RELOAD_MARK = true
  })
  await throwsItem.click()
  await expect(page).toHaveURL(/\/coach\/dashboard$/)
  await expect(main(page).getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()
  await expect(main(page)).toContainText("Mia Anderson")
  await expect(main(page)).not.toContainText("Marcus Johnson")
  expect(await page.evaluate(() => (window as typeof window & { __NO_RELOAD_MARK?: boolean }).__NO_RELOAD_MARK)).toBe(true)

  // The roster is team B's.
  await topBar(page).getByRole("link", { name: "Athletes" }).click()
  await expect(page).toHaveURL(/\/coach\/teams\/t4$/)
  await expect(main(page).getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()
  await expect(main(page)).toContainText("Liam Patel")
  await expect(main(page)).not.toContainText("Sarah Chen")

  // A reload keeps team B.
  await page.reload()
  await expect(switcher(page)).toContainText("Throws Group")
  await expect(main(page).getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()
  await page.goto("/coach/dashboard")
  await expect(main(page).getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()

  // Plans: only team B's. "Spring Build Phase" is a Sprint Group plan.
  await page.goto("/coach/training-plan")
  await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()
  await expect(page.locator("li[data-plan-status]", { hasText: "General preparation block" })).toBeVisible()
  await expect(main(page)).not.toContainText("Spring Build Phase")

  // A new plan starts on the selected team, and the picker offers both of the coach's teams.
  await page.getByRole("button", { name: "New plan" }).click()
  const planTeam = main(page).getByLabel(/^Team/)
  await expect(planTeam).toBeEnabled()
  await expect(planTeam).toHaveValue("t4")
  await expect(planTeam.locator("option")).toHaveText(["Sprint Group", "Throws Group"])
  await page.getByRole("button", { name: "Cancel" }).click()

  // Switching on the plans screen swaps the list without a reload.
  await switchTo(page, "Sprint Group")
  await expect(page.locator("li[data-plan-status]", { hasText: "Spring Build Phase" })).toBeVisible()

  // Test weeks follow too: the seeded sprint week, not the throws one.
  await page.goto("/coach/test-week")
  await expect(main(page)).toContainText("January Speed Testing")
  await expect(main(page)).not.toContainText("March Throwing Benchmark")
  await switchTo(page, "Throws Group")
  await expect(main(page)).toContainText("March Throwing Benchmark")
  await expect(main(page)).not.toContainText("January Speed Testing")

  // Reports follow too.
  await page.goto("/coach/reports")
  await expect(main(page)).toContainText("Mia Anderson")
  await expect(main(page)).not.toContainText("Marcus Johnson")

  // A deep link to team A's page selects team A.
  await page.goto("/coach/teams/t1")
  await expect(main(page).getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()
  await expect(switcher(page)).toContainText("Sprint Group")
  await topBar(page).getByRole("link", { name: "Dashboard" }).click()
  await expect(main(page).getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()

  // Switching while on a team page moves to the new team's page.
  await page.goto("/coach/teams/t1")
  await switchTo(page, "Throws Group")
  await expect(page).toHaveURL(/\/coach\/teams\/t4$/)
  await expect(main(page).getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()

  // A deep link to an athlete on team A selects team A. Switching away goes to the new team's roster.
  await page.goto("/coach/athletes/a1")
  await expect(page.getByRole("heading", { name: "Marcus Johnson" })).toBeVisible()
  await expect(switcher(page)).toContainText("Sprint Group")
  await switchTo(page, "Throws Group")
  await expect(page).toHaveURL(/\/coach\/teams\/t4$/)

  // A team the coach is not assigned to stays closed, and the selection does not move.
  await page.goto("/coach/teams/t2")
  await expect(main(page)).toContainText("Team unavailable")
  await expect(switcher(page)).toContainText("Throws Group")
})

test("the plan builder asks before switching team with unsaved work", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t4", coachTeamIds: ["t1", "t4"] })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/training-plan")

  await page.getByRole("button", { name: "New plan" }).click()
  await page.getByLabel("Plan name").fill("Switcher guard block")
  await page.getByRole("button", { name: "Continue to build" }).click()
  await expect(page.getByRole("heading", { name: "Switcher guard block" })).toBeVisible()

  // Cancel: stay in the builder on the same team.
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("unsaved changes")
    void dialog.dismiss()
  })
  await switcher(page).click()
  await page.getByRole("menuitemradio", { name: /Sprint Group/ }).click()
  await expect(page.getByRole("heading", { name: "Switcher guard block" })).toBeVisible()
  await expect(switcher(page)).toContainText("Throws Group")

  // Confirm: the team changes and the work can be picked up again from the list.
  page.once("dialog", (dialog) => void dialog.accept())
  await switchTo(page, "Sprint Group")
  await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()
  await expect(main(page)).toContainText("Switcher guard block")
})

test("on a phone the switcher opens a sheet", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1", coachTeamIds: ["t1", "t4"] })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/coach/dashboard")

  await expect(switcher(page)).toBeVisible()
  await switcher(page).click()
  const sheet = page.getByRole("dialog", { name: "Switch team" })
  await expect(sheet.getByRole("button", { name: /Sprint Group/ })).toHaveAttribute("aria-current", "true")
  await sheet.getByRole("button", { name: /Throws Group/ }).click()
  await expect(sheet).toBeHidden()
  await expect(main(page).getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()
  await expect(main(page)).not.toContainText("Marcus Johnson")

  // Nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("a coach with one team sees no switcher", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t4" })

  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size)
    await page.goto("/coach/dashboard")
    await expect(main(page).getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()
    await expect(switcher(page)).toHaveCount(0)
  }

  await page.goto("/coach/teams")
  await expect(page).toHaveURL(/\/coach\/teams\/t4$/)
})

test("a club admin on the coach screens gets no coach switcher and still sees every team", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin" })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto("/coach/teams/t1")
  await expect(main(page).getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()
  await expect(switcher(page)).toHaveCount(0)

  await page.goto("/coach/teams/t4")
  await expect(main(page).getByRole("heading", { level: 1, name: "Throws Group" })).toBeVisible()

  await page.goto("/coach/training-plan")
  await expect(page.locator("li[data-plan-status]", { hasText: "Spring Build Phase" })).toBeVisible()
  await expect(page.locator("li[data-plan-status]", { hasText: "Jump Power Microcycle" })).toBeVisible()
})
