import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/**
 * Squads: small named groups inside one team. The coach manages them on the roster and sends a
 * plan or a test week to them; the athlete sees the names of their own squads. Mock mode.
 * The demo sprint team starts with two squads: Short sprints (Marcus, Sarah, Sophia) and 400m (David).
 */

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
}

async function openSquads(page: Page) {
  await page.goto("/coach/teams/t1")
  await expect(page.getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()
  await page.getByRole("tab", { name: /Squads/ }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Squads" })).toBeVisible()
}

/** A one session plan that starts today, taken to the publish step. */
async function buildPlanToPublish(page: Page, name: string, sessionTitle: string) {
  await page.goto("/coach/training-plan")
  await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()
  await page.getByRole("button", { name: "New plan" }).click()
  await page.getByLabel("Plan name").fill(name)
  await page.getByRole("button", { name: "Continue to build" }).click()
  await expect(page.getByRole("heading", { name })).toBeVisible()
  await page.locator('[data-day-index="0"]').click()
  await page.getByLabel("Session title").fill(sessionTitle)
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Publish plan" })).toBeVisible()
}

test("the roster shows each athlete's squads and filters by squad", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/coach/teams/t1")
  const main = page.locator("#main-content")
  await expect(page.getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()

  await expect(main.getByRole("columnheader", { name: "Squads" })).toBeVisible()
  await expect(page.locator('[data-athlete-squads="a1"]')).toHaveText("Short sprints")
  await expect(page.locator('[data-athlete-squads="a3"]')).toHaveText("400m")

  const squadFilter = page.getByRole("radiogroup", { name: "Squad" })
  await squadFilter.getByRole("radio", { name: /Short sprints/ }).click()
  await expect(main.getByRole("row")).toHaveCount(4)
  await expect(main).toContainText("Showing 3 of 4")
  await expect(main).not.toContainText("David Okafor")
  await squadFilter.getByRole("radio", { name: /400m/ }).click()
  await expect(main.getByRole("row")).toHaveCount(2)
  await expect(main).toContainText("David Okafor")
  await squadFilter.getByRole("radio", { name: "No squad" }).click()
  await expect(main).toContainText("No athletes match")
  await page.getByRole("button", { name: "Show everyone" }).click()
  await expect(main.getByRole("row")).toHaveCount(5)
})

test("coach adds a squad, chooses its athletes, renames it and archives it", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await openSquads(page)
  const main = page.locator("#main-content")
  await expect(page.locator("[data-squad]")).toHaveCount(2)
  await expect(page.locator('[data-squad="Short sprints"] [data-squad-count]')).toHaveText("3 athletes")
  await expect(page.locator('[data-squad="400m"] [data-squad-count]')).toHaveText("1 athlete")

  // A name the team already uses is refused.
  await page.getByRole("button", { name: "New squad" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Name").fill("  short   SPRINTS ")
  await dialog.getByRole("button", { name: "Create squad" }).click()
  await expect(dialog).toContainText("already has a squad called")

  // Create it, then pick members from the roster. David is now in two squads.
  await dialog.getByLabel("Name").fill("Juniors")
  await dialog.getByLabel(/Colour dot/).selectOption("green")
  await dialog.getByLabel(/Note/).fill("Under 20s")
  await dialog.getByRole("button", { name: "Create squad" }).click()
  const members = page.getByRole("dialog", { name: "Athletes in Juniors" })
  await expect(members).toBeVisible()
  await members.getByRole("checkbox", { name: /David Okafor/ }).check()
  await members.getByRole("checkbox", { name: /Sophia Kim/ }).check()
  await members.getByRole("button", { name: "Save 2 athletes" }).click()
  await expect(page.locator('[data-squad="Juniors"] [data-squad-count]')).toHaveText("2 athletes")
  await expect(page.locator('[data-squad="Juniors"]')).toContainText("Under 20s")
  await expect(page.getByRole("tab", { name: /Squads/ })).toContainText("3")

  // The roster shows both of David's squads.
  await page.getByRole("tab", { name: /Athletes/ }).click()
  await expect(page.locator('[data-athlete-squads="a3"]')).toContainText("400m")
  await expect(page.locator('[data-athlete-squads="a3"]')).toContainText("Juniors")
  await expect(page.locator('[data-athlete-squads="a1"]')).toHaveText("Short sprints")

  // Take someone out, rename, and it is still there after a reload.
  await page.getByRole("tab", { name: /Squads/ }).click()
  await page.getByRole("button", { name: "More for Juniors" }).click()
  await page.getByRole("menuitem", { name: "Choose athletes" }).click()
  await page.getByRole("dialog").getByRole("checkbox", { name: /Sophia Kim/ }).uncheck()
  await page.getByRole("dialog").getByRole("button", { name: "Save 1 athlete" }).click()
  await expect(page.locator('[data-squad="Juniors"] [data-squad-count]')).toHaveText("1 athlete")
  await page.getByRole("button", { name: "More for Juniors" }).click()
  await page.getByRole("menuitem", { name: "Rename or edit" }).click()
  await page.getByRole("dialog").getByLabel("Name").fill("Under 20")
  await page.getByRole("dialog").getByRole("button", { name: "Save squad" }).click()
  await expect(page.locator('[data-squad="Under 20"]')).toBeVisible()
  await page.reload()
  await page.getByRole("tab", { name: /Squads/ }).click()
  await expect(page.locator('[data-squad="Under 20"] [data-squad-count]')).toHaveText("1 athlete")

  // Archive asks first, then the squad is gone from the list, the column and the filter.
  await page.getByRole("button", { name: "More for Under 20" }).click()
  await page.getByRole("menuitem", { name: "Archive squad" }).click()
  const confirm = page.getByRole("group", { name: "Confirm" })
  await expect(confirm).toContainText("Its 1 athlete leaves the squad")
  await confirm.getByRole("button", { name: "Keep it" }).click()
  await expect(page.locator('[data-squad="Under 20"]')).toBeVisible()
  await page.getByRole("button", { name: "More for Under 20" }).click()
  await page.getByRole("menuitem", { name: "Archive squad" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Archive squad" }).click()
  await expect(page.locator("[data-squad]")).toHaveCount(2)
  await page.getByRole("tab", { name: /Athletes/ }).click()
  await expect(page.locator('[data-athlete-squads="a3"]')).toHaveText("400m")
  await expect(main.getByRole("radiogroup", { name: "Squad" }).getByRole("radio")).toHaveCount(4)
})

test("an athlete who moves to another team leaves the squads of the old team", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1", coachTeamIds: ["t1", "t4"] })
  await page.setViewportSize({ width: 1280, height: 900 })
  await openSquads(page)
  await expect(page.locator('[data-squad="400m"] [data-squad-count]')).toHaveText("1 athlete")

  await page.goto("/coach/athletes/a3")
  await expect(page.getByRole("heading", { level: 1, name: "David Okafor" })).toBeVisible()
  await page.getByRole("tab", { name: "Details" }).click()
  await page.getByRole("button", { name: "Move to another team" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Move athlete" }).click()
  await expect(page.locator("#main-content")).toContainText("David Okafor moved to Throws Group")

  await openSquads(page)
  await expect(page.locator('[data-squad="400m"] [data-squad-count]')).toHaveText("0 athletes")
  await expect(page.locator('[data-squad="Short sprints"] [data-squad-count]')).toHaveText("3 athletes")

  // Moving back does not bring the old membership back.
  await page.goto("/coach/athletes/a3")
  await page.getByRole("tab", { name: "Details" }).click()
  await page.getByRole("button", { name: "Move to another team" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Move athlete" }).click()
  await expect(page.locator("#main-content")).toContainText("David Okafor moved to Sprint Group")
  await openSquads(page)
  await expect(page.locator('[data-squad="400m"] [data-squad-count]')).toHaveText("0 athletes")
})

test("a plan goes to a squad, reaches its athletes, and says when two sessions land on one day", async ({ page }) => {
  test.setTimeout(120_000)
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1280, height: 900 })

  // A team plan first, with a session today.
  await buildPlanToPublish(page, "Team base", "Team tempo")
  await expect(page.getByRole("button", { name: "Publish to 4 athletes" })).toBeVisible()
  await expect(page.locator("[data-plan-clash]")).toHaveCount(0)
  await page.getByRole("button", { name: /^Publish to/ }).click()
  await expect(page.locator("body")).toContainText("Plan published to 4 athletes")

  // A second plan on the same day, for one squad.
  await buildPlanToPublish(page, "Speed block", "Block starts")
  await page.getByRole("tab", { name: "Squads", exact: true }).click()
  await expect(page.locator("#main-content")).toContainText("Pick at least one squad.")
  await expect(page.getByRole("button", { name: /^Publish to/ })).toBeDisabled()
  const squads = page.getByRole("list", { name: "Choose squads" })
  await squads.getByRole("checkbox", { name: /Short sprints/ }).check()
  await expect(page.getByRole("button", { name: "Publish to 3 athletes" })).toBeEnabled()
  const reached = page.getByRole("list", { name: "Athletes who get this plan" })
  await expect(reached.getByRole("listitem")).toHaveCount(3)
  await expect(reached).not.toContainText("David Okafor")
  await expect(page.locator("[data-squad-hint]")).toContainText("Athletes you add to this squad later get the upcoming sessions too")
  await expect(page.locator("[data-plan-clash]")).toHaveText("3 athletes also have a session from Team base on 1 of these days. They will see both sessions.")

  // Both squads: David is added, each athlete counted once.
  await squads.getByRole("checkbox", { name: /400m/ }).check()
  await expect(page.getByRole("button", { name: "Publish to 4 athletes" })).toBeVisible()
  await expect(page.locator("[data-plan-clash]")).toContainText("4 athletes also have")
  await squads.getByRole("checkbox", { name: /400m/ }).uncheck()

  await page.getByRole("button", { name: "Publish to 3 athletes" }).click()
  await expect(page.locator("body")).toContainText("Plan published to 3 athletes")
  await page.getByRole("button", { name: "Back to plans" }).click()
  const row = page.locator('li[data-plan-status="published"]', { hasText: "Speed block" })
  await expect(row).toContainText("3 athletes")

  // Reopened, the plan is still for the squad.
  await row.getByRole("button", { name: /Speed block/ }).first().click()
  await page.getByRole("button", { name: /Review and update/ }).click()
  await expect(page.getByRole("tab", { name: "Squads", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("list", { name: "Choose squads" }).getByRole("checkbox", { name: /Short sprints/ })).toBeChecked()

  // An athlete added to the squad later is reached; the plan list follows the squad.
  await openSquads(page)
  await page.locator('[data-squad="Short sprints"]').getByRole("button").first().click()
  await page.getByRole("dialog").getByRole("checkbox", { name: /David Okafor/ }).check()
  await page.getByRole("dialog").getByRole("button", { name: "Save 4 athletes" }).click()
  await expect(page.locator('[data-squad="Short sprints"] [data-squad-count]')).toHaveText("4 athletes")
  await page.goto("/coach/training-plan")
  await expect(page.locator('li[data-plan-status="published"]', { hasText: "Speed block" })).toContainText("4 athletes")

  // Taken out, they are no longer reached.
  await openSquads(page)
  await page.locator('[data-squad="Short sprints"]').getByRole("button").first().click()
  await page.getByRole("dialog").getByRole("checkbox", { name: /David Okafor/ }).uncheck()
  await page.getByRole("dialog").getByRole("checkbox", { name: /Sophia Kim/ }).uncheck()
  await page.getByRole("dialog").getByRole("button", { name: "Save 2 athletes" }).click()
  await expect(page.locator('[data-squad="Short sprints"] [data-squad-count]')).toHaveText("2 athletes")
  await page.goto("/coach/training-plan")
  await expect(page.locator('li[data-plan-status="published"]', { hasText: "Speed block" })).toContainText("2 athletes")
})

test("a team with no squads says so in the publish step and links to the team page", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t4" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/coach/training-plan")
  await page.getByRole("button", { name: "New plan" }).click()
  await page.getByLabel("Plan name").fill("Throws block")
  await page.getByRole("button", { name: "Continue to build" }).click()
  await page.locator('[data-day-index="0"]').click()
  await page.getByLabel("Session title").fill("Throws")
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await page.getByRole("tab", { name: "Squads", exact: true }).click()
  await expect(page.locator("#main-content")).toContainText("This team has no squads yet")
  await expect(page.getByRole("link", { name: "Open the team page" })).toHaveAttribute("href", "/coach/teams/t4")
  await expect(page.getByRole("button", { name: /^Publish to/ })).toBeDisabled()
  await page.getByRole("tab", { name: "Whole team" }).click()
  await expect(page.getByRole("button", { name: "Publish to 2 athletes" })).toBeEnabled()
})

test("a test week can be for chosen squads", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/coach/test-week")
  const main = page.locator("#main-content")
  await page.getByRole("button", { name: "New test week" }).click()
  await page.getByLabel("Test week name").fill("Short sprint checks")
  await expect(main).toContainText("Goes to the whole team, 4 athletes.")

  const audience = page.locator("[data-test-week-audience]")
  await audience.getByRole("tab", { name: "Squads" }).click()
  await expect(main).toContainText("Pick the squads below.")
  await page.getByRole("button", { name: "Publish test week" }).click()
  await expect(main).toContainText("Pick at least one squad, or send it to the whole team.")
  await audience.getByRole("checkbox", { name: /Short sprints/ }).check()
  await expect(main).toContainText("Goes to Short sprints, 3 athletes.")
  await page.getByRole("button", { name: "Publish test week" }).click()

  await expect(main).toContainText("Test week published to 3 athletes.")
  await expect(page.getByRole("heading", { level: 1, name: "Short sprint checks" })).toBeVisible()
  await expect(main).toContainText("Sprint Group (Short sprints)")
  await expect(main).toContainText("Marcus Johnson")
  await expect(main).toContainText("Sophia Kim")
  await expect(main).not.toContainText("David Okafor")

  // The list says who it is for, and editing keeps the choice.
  await page.goto("/coach/test-week")
  const row = main.getByRole("row", { name: /Short sprint checks/ })
  await expect(row).toContainText("Short sprints")
  await expect(row).toContainText("0 of 3")
  await expect(main.getByRole("row", { name: /January Speed Testing/ })).toContainText("4 of 4")
})

test("attendance can be taken one squad at a time", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/coach/teams/t1/attendance")
  await expect(page.getByRole("heading", { level: 1, name: "Attendance" })).toBeVisible()
  await expect(page.locator("[data-attendance-row]")).toHaveCount(4)

  await page.getByRole("radiogroup", { name: "Squad" }).getByRole("radio", { name: /Short sprints/ }).click()
  await expect(page.locator("[data-attendance-row]")).toHaveCount(3)
  await expect(page.locator('[data-attendance-row="a3"]')).toHaveCount(0)
  await noSidewaysScroll(page)

  // Marking everyone only marks the squad that is showing.
  await page.getByRole("button", { name: "Mark Short sprints present" }).click()
  await expect(page.locator('[data-attendance-status="present"]')).toHaveCount(3)
  await page.getByRole("radiogroup", { name: "Squad" }).getByRole("radio", { name: "Whole team" }).click()
  await expect(page.locator("[data-attendance-row]")).toHaveCount(4)
  await expect(page.locator('[data-attendance-row="a3"]')).toHaveAttribute("data-attendance-status", "none")
})

test("the athlete sees the names of their squads on their profile, and nothing to change", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/athlete/profile")
  const line = page.locator("[data-my-squads]")
  await expect(line).toHaveText("Your squad: Short sprints")
  await expect(line.getByRole("button")).toHaveCount(0)
  await expect(line.getByRole("link")).toHaveCount(0)
  await noSidewaysScroll(page)

  // The coach adds them to a second squad.
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await openSquads(page)
  await page.locator('[data-squad="400m"]').getByRole("button").first().click()
  await page.getByRole("dialog").getByRole("checkbox", { name: /Marcus Johnson/ }).check()
  await page.getByRole("dialog").getByRole("button", { name: "Save 2 athletes" }).click()
  await expect(page.locator('[data-squad="400m"] [data-squad-count]')).toHaveText("2 athletes")

  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/profile")
  await expect(page.locator("[data-my-squads]")).toHaveText("Your squads: 400m and Short sprints")
})

test("the squads screens fit a phone", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/coach/teams/t1")
  await expect(page.getByRole("heading", { level: 1, name: "Sprint Group" })).toBeVisible()
  await expect(page.locator('[data-athlete-squads="a1"]')).toBeVisible()
  await noSidewaysScroll(page)
  await page.getByRole("tab", { name: /Squads/ }).click()
  await expect(page.locator("[data-squad]")).toHaveCount(2)
  await noSidewaysScroll(page)
  await page.getByRole("button", { name: "New squad" }).click()
  await expect(page.getByRole("dialog").getByLabel("Name")).toBeVisible()
  await noSidewaysScroll(page)
})
