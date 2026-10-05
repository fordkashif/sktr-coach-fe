import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("public club-admin request flow submits successfully", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: "Request access for your club" }).click()

  await page.getByLabel("First name").fill("Jordan")
  await page.getByLabel("Last name").fill("Davis")
  await page.getByLabel("Work email").fill(`club-admin-${Date.now()}@pacelab.local`)
  await page.getByLabel("Job title").fill("Head coach")
  await page.getByPlaceholder("Elite Track Club").fill("Elite Track Club")
  await page.getByRole("combobox", { name: "Organization type" }).click()
  await page.locator('[role="option"]').filter({ hasText: "Club" }).first().click()
  await page.getByLabel("Country or region").fill("Jamaica")
  await page.locator("#request-package-pro").click()
  await page.getByLabel("Expected coaches").fill("4")
  await page.getByLabel("Expected athletes").fill("60")
  await page.getByRole("button", { name: "Submit request" }).click()

  await expect(page.locator("body")).toContainText("We have your access request.")
})

test("club-admin can send coach invite and manage user access", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/club-admin/users")

  const inviteEmail = `coach-wave4-${Date.now()}@pacelab.local`
  await page.getByRole("button", { name: "Invite coach" }).first().click()
  await page.getByPlaceholder("coach@email.com").fill(inviteEmail)
  await page.getByRole("button", { name: "Create invite link" }).click()
  await expect(page.getByRole("dialog").getByLabel("Invite link")).toHaveValue(/\/invite\/coach\//)
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click()
  await expect(page.locator(`[data-invite="${inviteEmail}"]`)).toContainText("Waiting")

  await page.getByRole("tab", { name: /People/ }).click()
  const coachRow = page.locator('[data-person="coach.rivera@pacelab.local"]')
  await coachRow.getByRole("button", { name: "Deactivate" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Deactivate" }).click()
  await expect(coachRow).toContainText("Deactivated")
  await coachRow.getByRole("button", { name: "Reactivate" }).click()
  await expect(coachRow).toContainText("Active")
})

test("club-admin can create, update, archive, restore, and invite athletes for teams", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/club-admin/teams")

  const teamName = `Wave 4 Team ${Date.now()}`
  const renamedTeam = `${teamName} Updated`

  await page.getByRole("button", { name: "New team" }).click()
  await page.getByRole("dialog").getByPlaceholder("Sprint Group B").fill(teamName)
  await page.getByRole("dialog").getByRole("button", { name: "Create team" }).click()
  const teamRow = page.locator(`[data-team="${teamName}"]`)
  await expect(teamRow).toContainText("Active")

  await teamRow.getByRole("button", { name: "Invite athlete" }).click()
  await page.getByRole("dialog").getByPlaceholder("athlete@email.com").fill(`athlete-wave4-${Date.now()}@pacelab.local`)
  await page.getByRole("dialog").getByRole("button", { name: "Create invite link" }).click()
  await expect(page.getByRole("dialog").getByLabel("Invite link")).toHaveValue(/\/athlete\/claim\//)
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click()

  await teamRow.getByRole("button", { name: `Edit ${teamName}`, exact: true }).click()
  await page.getByRole("dialog").getByLabel("Team name").fill(renamedTeam)
  await page.getByRole("button", { name: "Save changes" }).click()
  const renamedRow = page.locator(`[data-team="${renamedTeam}"]`)
  await expect(renamedRow).toContainText("Active")

  await renamedRow.getByRole("button", { name: `Archive ${renamedTeam}`, exact: true }).click()
  await renamedRow.getByRole("button", { name: "Archive team", exact: true }).click()
  await expect(renamedRow).toHaveCount(0)
  await page.getByRole("tab", { name: /Archived/ }).click()
  await expect(renamedRow).toContainText("Archived")

  await renamedRow.getByRole("button", { name: "Restore team" }).click()
  await expect(renamedRow).toHaveCount(0)
  await page.getByRole("tab", { name: /Active/ }).click()
  await expect(renamedRow).toContainText("Active")
})

test("club-admin reports, billing, and audit surfaces record operational actions", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto("/club-admin/reports")
  await expect(page).toHaveURL(/\/club-admin\/reports$/)

  const teamsDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: /Teams CSV/ }).click()
  expect((await teamsDownload).suggestedFilename()).toBe("club-team-summary.csv")

  await page.getByRole("tab", { name: "Adherence" }).click()
  const adherenceDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: /Adherence CSV/ }).click()
  expect((await adherenceDownload).suggestedFilename()).toBe("club-adherence.csv")

  await page.getByRole("tab", { name: "PRs" }).click()
  const prDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: /PR CSV/ }).click()
  expect((await prDownload).suggestedFilename()).toBe("club-prs.csv")

  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("pacelab:audit-logs:tenant-alpha") ?? ""))
    .toContain("club-prs.csv")

  await page.goto("/club-admin/billing")
  await page.getByRole("button", { name: "Edit" }).click()
  await page.getByLabel("Billing contact name").fill("Club Treasurer")
  await page.getByLabel("Billing contact email").fill("treasurer@pacelab.local")
  await page.getByRole("button", { name: "Save billing contact" }).click()
  await expect(page.locator("body")).toContainText("Billing contact saved.")
  await expect(page.locator("body")).toContainText("treasurer@pacelab.local")

  const auditLogRaw = await page.evaluate(() => window.localStorage.getItem("pacelab:audit-logs:tenant-alpha") ?? "")
  expect(auditLogRaw).toContain("billing_update")
})
