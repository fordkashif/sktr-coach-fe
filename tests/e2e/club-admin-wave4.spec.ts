import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("public club-admin request flow submits successfully", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: "Request account" }).click()

  await page.getByLabel("Full name").fill("Jordan Davis")
  await page.getByLabel("Work email").fill(`club-admin-${Date.now()}@pacelab.local`)
  await page.getByLabel("Job title").fill("Head coach")
  await page.getByPlaceholder("Elite Track Club").fill("Elite Track Club")
  await page.getByRole("combobox", { name: "Organization type" }).click()
  await page.locator('[role="option"]').filter({ hasText: "Club" }).first().click()
  await page.getByLabel("Country or region").fill("Jamaica")
  await page.getByLabel("Expected coaches").fill("4")
  await page.getByLabel("Expected athletes").fill("60")
  await page.getByLabel("Notes").fill("Wave 4 request flow validation.")
  await page.getByRole("button", { name: "Submit request" }).click()

  await expect(page.locator("body")).toContainText("We have your access request.")
})

test("club-admin can send coach invite and manage user access", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/club-admin/users")

  const inviteEmail = `coach-wave4-${Date.now()}@pacelab.local`
  await page.getByRole("button", { name: "New invite" }).click()
  await page.getByPlaceholder("coach@email.com").fill(inviteEmail)
  await page.getByRole("button", { name: "Send invite" }).click()
  await expect(page.locator("body")).toContainText(inviteEmail)

  const coachRow = page.locator("div.rounded-\\[18px\\]").filter({ hasText: "coach.rivera@pacelab.local" }).first()
  await coachRow.getByRole("button", { name: "Disable" }).click()
  await expect(coachRow).toContainText("disabled")
  await coachRow.getByRole("button", { name: "Enable" }).click()
  await expect(coachRow).toContainText("active")
})

test("club-admin can create, update, archive, restore, and invite athletes for teams", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/club-admin/teams")

  const teamName = `Wave 4 Team ${Date.now()}`
  const renamedTeam = `${teamName} Updated`

  await page.getByRole("button", { name: "Create team" }).click()
  await page.getByRole("dialog").getByPlaceholder("Sprint Group B").fill(teamName)
  await page.getByRole("button", { name: "Create team" }).last().click()
  await expect(page.locator("body")).toContainText(teamName)

  const teamCard = page.locator("article").filter({ hasText: teamName }).first()
  await teamCard.getByRole("button", { name: "Generate athlete invite" }).click()
  await expect(teamCard).toContainText("/athlete/claim/")

  await teamCard.getByRole("button", { name: "Edit team" }).click()
  await page.getByRole("dialog").locator("input").first().fill(renamedTeam)
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.locator("body")).toContainText(renamedTeam)

  const renamedCard = page.locator("article").filter({ hasText: renamedTeam }).first()
  await renamedCard.getByRole("button", { name: "Archive team" }).click()
  await expect(page.locator("body")).toContainText("Dormant groups")

  const archivedCard = page.locator("article").filter({ hasText: renamedTeam }).first()
  await archivedCard.getByRole("button", { name: "Restore team" }).click()
  await expect(page.locator("body")).toContainText("Current team structure")
})

test("club-admin reports, billing, and audit surfaces record operational actions", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto("/club-admin/reports")
  await expect(page).toHaveURL(/\/club-admin\/reports$/)

  const usersDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: /Users CSV/ }).click()
  expect((await usersDownload).suggestedFilename()).toBe("club-users.csv")

  const teamsDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: /Teams CSV/ }).click()
  expect((await teamsDownload).suggestedFilename()).toBe("club-teams.csv")

  const performanceDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: /Performance CSV/ }).click()
  expect((await performanceDownload).suggestedFilename()).toBe("club-performance.csv")

  await page.goto("/club-admin/billing")
  await page.locator("label:has-text('Seats')").locator("xpath=following::input[1]").fill("75")
  await page.getByRole("button", { name: "Save billing settings" }).click()
  await expect(page.locator("body")).toContainText("Saved.")

  const auditLogRaw = await page.evaluate(() => window.localStorage.getItem("pacelab:audit-logs:tenant-alpha") ?? "")
  expect(auditLogRaw).toContain("billing_update")
})
