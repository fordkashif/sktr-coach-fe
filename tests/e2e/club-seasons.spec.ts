import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Each test uses its own demo club, so a rollover in one test does not change the next.
async function signIn(page: Page, tenantId: string) {
  await seedMockSession(page, { role: "club-admin", tenantId })
  await page.setViewportSize({ width: 1280, height: 900 })
}

const stored = (page: Page, key: string, tenantId: string) => page.evaluate((fullKey) => window.localStorage.getItem(fullKey) ?? "", `${key}:${tenantId}`)

async function addSeason(page: Page, name: string, start: string, end: string) {
  await page.getByRole("button", { name: "Add a season" }).first().click()
  await page.getByLabel("Name").fill(name)
  await page.getByLabel("First day").fill(start)
  await page.getByLabel("Last day").fill(end)
  await page.getByRole("button", { name: "Add season", exact: true }).click()
}

test("the club profile shows the current season and leads to the seasons screen", async ({ page }) => {
  await signIn(page, "seasons-profile")
  await page.goto("/club-admin/profile")

  const season = page.getByRole("region", { name: "Season" }).or(page.locator("section").filter({ has: page.getByRole("heading", { name: "Season", exact: true }) })).first()
  await expect(season).toContainText("Current season")
  await expect(season).toContainText("2026")
  await season.getByRole("link", { name: "Manage seasons" }).click()

  await expect(page).toHaveURL(/\/club-admin\/profile\/seasons$/)
  await expect(page.getByRole("heading", { level: 1, name: "Seasons" })).toBeVisible()
  await expect(page.locator('[data-season-status="current"]')).toContainText("2026")
  await expect(page.locator('[data-season-status="past"]')).toContainText("2025")
  // The Club tab stays the active one: seasons are part of the Club area, not a new top bar item.
  await expect(page.getByRole("link", { name: "Club", exact: true }).first()).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("link", { name: "Seasons", exact: true })).toHaveCount(0)
})

test("club admin adds an upcoming season, cannot overlap another, and changes its name and dates", async ({ page }) => {
  await signIn(page, "seasons-edit")
  await page.goto("/club-admin/profile/seasons")

  // Dates that share a day with the current season are refused, in words.
  await addSeason(page, "2026/27 outdoor", "2026-10-30", "2027-10-31")
  await expect(page.getByText(/These dates overlap 2026/)).toBeVisible()
  await page.getByLabel("First day").fill("2026-11-01")
  await page.getByRole("button", { name: "Add season", exact: true }).click()

  const upcoming = page.locator('[data-season-status="upcoming"]')
  await expect(upcoming).toHaveCount(1)
  await expect(upcoming).toContainText("2026/27 outdoor")
  await expect(upcoming).toContainText("Upcoming")
  await expect(upcoming.getByRole("link", { name: "Start this season" })).toBeVisible()
  // Still exactly one current season.
  await expect(page.locator('[data-season-status="current"]')).toHaveCount(1)

  // The same name twice is refused.
  await addSeason(page, "2026/27 OUTDOOR", "2027-11-01", "2028-10-31")
  await expect(page.getByText("Another season already has this name.")).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()

  await page.getByRole("button", { name: "More for 2026/27 outdoor" }).click()
  await page.getByRole("menuitem", { name: "Change name and dates" }).click()
  await page.getByLabel("Name").fill("2026/27")
  await page.getByLabel("Last day").fill("2027-09-30")
  await page.getByRole("button", { name: "Save season" }).click()
  await expect(upcoming).toContainText("2026/27")
  await expect(upcoming).toContainText("Sep 30, 2027")

  // An upcoming season can be removed; a current or past one has no Remove.
  await page.getByRole("button", { name: "More for 2026", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Remove" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "More for 2026/27" }).click()
  await page.getByRole("menuitem", { name: "Remove" }).click()
  await page.getByRole("button", { name: "Remove season" }).click()
  await expect(upcoming).toHaveCount(0)
  expect(await stored(page, "pacelab:audit-logs", "seasons-edit")).toContain("season_removed")
})

test("leaving the rollover before the last step changes nothing", async ({ page }) => {
  await signIn(page, "seasons-cancel")
  await page.goto("/club-admin/profile/seasons")
  await addSeason(page, "2026/27 outdoor", "2026-11-01", "2027-10-31")
  const before = await stored(page, "pacelab:club-seasons", "seasons-cancel")

  await page.getByRole("link", { name: "Start this season" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Start 2026/27 outdoor" })).toBeVisible()
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("checkbox", { name: /Throws Group/ }).check()
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("radio", { name: /Plans end with 2026/ }).check()
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("button", { name: "Start the season" })).toBeVisible()

  // Back keeps the choices; Seasons leaves without saving.
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await expect(page.getByRole("radio", { name: /Plans end with 2026/ })).toBeChecked()
  await page.getByRole("link", { name: "Seasons" }).first().click()

  await expect(page.locator('[data-season-status="current"]')).toContainText("2026")
  await expect(page.locator('[data-season-status="upcoming"]')).toContainText("2026/27 outdoor")
  expect(await stored(page, "pacelab:club-seasons", "seasons-cancel")).toBe(before)
  expect(await stored(page, "pacelab:club-teams", "seasons-cancel")).not.toContain("archived")
  expect(await stored(page, "pacelab:audit-logs", "seasons-cancel")).not.toContain("season_started")
})

test("the rollover starts the new season, archives only the chosen team, ends plans and deletes nothing", async ({ page }) => {
  const tenant = "seasons-rollover"
  await signIn(page, tenant)
  await page.goto("/club-admin/profile/seasons")
  await addSeason(page, "2026/27 outdoor", "2026-11-01", "2027-10-31")
  await page.getByRole("link", { name: "Start this season" }).click()

  // Step 1: name and dates. Starting before the old season's last day cuts the old season short.
  await expect(page.getByText("Step 1 of 4: Season")).toBeVisible()
  await page.getByLabel("First day").fill("2026-01-10")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByText(/has to start after the first day of 2026/)).toBeVisible()
  await page.getByLabel("First day").fill("2026-10-20")
  await expect(page.getByText(/makes it end on Oct 19, 2026 instead/)).toBeVisible()
  await page.getByRole("button", { name: "Continue" }).click()

  // Step 2: each team carries on unless archived.
  await expect(page.getByText("Step 2 of 4: Teams")).toBeVisible()
  await expect(page.getByRole("checkbox", { name: /Sprint Group/ })).not.toBeChecked()
  await expect(page.getByRole("list", { name: "Teams to archive" })).toContainText("Carries on")
  await page.getByRole("checkbox", { name: /Throws Group/ }).check()
  await expect(page.getByText("1 of 4 to archive")).toBeVisible()
  await page.getByRole("button", { name: "Continue" }).click()

  // Step 3: plans.
  await expect(page.getByText("Step 3 of 4: Plans")).toBeVisible()
  await page.getByRole("radio", { name: /Plans end with 2026/ }).check()
  await page.getByRole("button", { name: "Continue" }).click()

  // Step 4: exactly what will change.
  const summary = page.getByRole("list", { name: "What will change" }).or(page.locator('dl[aria-label="What will change"]')).first()
  await expect(summary).toContainText("2026/27 outdoor, Oct 20, 2026 to Oct 31, 2027")
  await expect(summary).toContainText("2026 becomes a past season and now ends on Oct 19, 2026")
  await expect(summary).toContainText("Throws Group")
  await expect(summary).toContainText("Sprint Group, Distance Group, Jumps Group")
  await expect(summary).toContainText("moved to archived")
  await expect(summary).toContainText("Nothing")
  const teamsBefore = JSON.parse((await stored(page, "pacelab:club-teams", tenant)) || "[]") as unknown[]
  expect(await stored(page, "pacelab:club-teams", tenant)).not.toContain("archived")

  await page.getByRole("button", { name: "Start the season" }).click()
  await expect(page).toHaveURL(/\/club-admin\/profile\/seasons$/)

  const current = page.locator('[data-season-status="current"]')
  await expect(current).toHaveCount(1)
  await expect(current).toContainText("2026/27 outdoor")
  await expect(current).toContainText("Oct 20, 2026 to Oct 31, 2027")
  await expect(page.locator('[data-season-status="past"]')).toHaveCount(2)
  await expect(page.locator('[data-season-status="past"]').first()).toContainText("Jan 10, 2026 to Oct 19, 2026")
  await expect(page.locator('[data-season-status="upcoming"]')).toHaveCount(0)

  // Only the chosen team is archived and no team is gone.
  const teams = JSON.parse(await stored(page, "pacelab:club-teams", tenant)) as Array<{ id: string; name: string; status: string }>
  expect(teams.length).toBe(teamsBefore.length || 4)
  expect(teams.filter((team) => team.status === "archived").map((team) => team.name)).toEqual(["Throws Group"])
  // Published plans are archived, not removed.
  const plans = JSON.parse(await stored(page, "pacelab:coach-training-plans:v1", tenant)) as { plans: Array<{ status: string }>; removedSeedIds: string[] }
  expect(plans.plans.length).toBeGreaterThan(0)
  expect(plans.plans.every((plan) => plan.status === "archived")).toBe(true)
  expect(plans.removedSeedIds).toEqual([])
  // One audit event, and the club profile follows the new season.
  const audit = await stored(page, "pacelab:audit-logs", tenant)
  expect(audit.match(/season_started/g)?.length).toBe(1)
  expect(audit).toContain("Teams archived: 1")
  expect(await stored(page, "pacelab:club-profile", tenant)).toContain("2026/27 outdoor")

  // The season that started cannot be started again.
  const seasons = JSON.parse(await stored(page, "pacelab:club-seasons", tenant)) as Array<{ id: string; status: string }>
  await page.goto(`/club-admin/profile/seasons/${seasons.find((season) => season.status === "current")!.id}/start`)
  await expect(page.getByText(/has already started/)).toBeVisible()

  // The teams screen and the club profile agree.
  await page.goto("/club-admin/profile")
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "Season", exact: true }) }).first()).toContainText("2026/27 outdoor")
})

test("club reports offer the current and past seasons as quick ranges", async ({ page }) => {
  await signIn(page, "seasons-reports")
  await page.goto("/club-admin/reports")
  await page.getByRole("button", { name: "2025 season" }).click()
  await expect(page.getByLabel("From")).toHaveValue("2025-01-10")
  await expect(page.getByLabel("To")).toHaveValue("2025-10-30")
  await page.getByRole("button", { name: "This season (2026)" }).click()
  await expect(page.getByLabel("From")).toHaveValue("2026-01-10")
})

test("an athlete can look at season bests for the current or a past season", async ({ page }) => {
  await seedMockSession(page, { role: "athlete", tenantId: "seasons-athlete" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/athlete/prs")

  const picker = page.getByLabel("Season bests for")
  await expect(picker).toBeVisible()
  await expect(picker.locator("option")).toHaveText(["2026 (current)", "2025"])
  await expect(page.locator("main")).toContainText("2026 season best")
  await picker.selectOption({ label: "2025" })
  await expect(page.locator("main")).toContainText("2025 season best")
  await expect(page.locator("main")).toContainText(/No mark in 2025|2025 best|Set in 2025/)
  // Nothing scrolls sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
