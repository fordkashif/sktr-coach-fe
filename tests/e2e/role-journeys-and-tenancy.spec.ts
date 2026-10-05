import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("club-admin, coach, and athlete core surfaces are reachable", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.goto("/club-admin/users")
  await expect(page).toHaveURL(/\/club-admin\/users$/)
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible()

  await seedMockSession(page, { role: "coach", tenantId: "tenant-alpha", coachTeamId: "t1" })
  await page.goto("/coach/teams")
  await expect(page).toHaveURL(/\/coach\/teams\/t1$/)
  await expect(page.locator("body")).toContainText(/Sprint Group|Team not found|Roster/)

  await seedMockSession(page, { role: "athlete", tenantId: "tenant-alpha" })
  await page.goto("/athlete/wellness")
  await expect(page).toHaveURL(/\/athlete\/wellness$/)
  await expect(page.locator("body")).toContainText("Wellness")
})

test("athlete wellness submission returns readiness output", async ({ page }) => {
  await seedMockSession(page, { role: "athlete", tenantId: "tenant-alpha" })
  await page.goto("/athlete/wellness")

  // Sleep starts at 8 hours; the four scales are tap to select.
  await page.getByRole("button", { name: "Half an hour less sleep" }).click()
  await page.getByRole("button", { name: "Half an hour more sleep" }).click()
  await page.getByRole("radio", { name: /^Soreness 2 of 5/ }).click()
  await page.getByRole("radio", { name: /^Fatigue 2 of 5/ }).click()
  await page.getByRole("radio", { name: /^Mood 4 of 5/ }).click()
  await page.getByRole("radio", { name: /^Stress 2 of 5/ }).click()
  await page.getByRole("button", { name: "Submit check-in" }).click()

  await expect(page.getByRole("heading", { name: "Today's readiness" })).toBeVisible()
  await expect(page.locator("main")).toContainText("You are ready to train")
  await expect(page.locator("main")).toContainText(/Ready|Watch|Review/)
})

test("tenant storage isolation: invite created in tenant A is not visible in tenant B", async ({ browser }) => {
  const email = `coach+${Date.now()}@pacelab.local`

  const tenantAContext = await browser.newContext()
  const tenantAPage = await tenantAContext.newPage()
  await seedMockSession(tenantAPage, { role: "club-admin", tenantId: "tenant-alpha" })
  await tenantAPage.goto("/club-admin/users")
  await tenantAPage.getByRole("button", { name: "Invite staff" }).first().click()
  await tenantAPage.getByPlaceholder("coach@email.com").fill(email)
  await tenantAPage.getByRole("button", { name: "Send invite" }).click()
  await tenantAPage.getByRole("dialog").getByRole("button", { name: "Close" }).click()
  await expect(tenantAPage.locator(`[data-invite="${email}"]`)).toBeVisible()
  await tenantAContext.close()

  const tenantBContext = await browser.newContext()
  const tenantBPage = await tenantBContext.newPage()
  await seedMockSession(tenantBPage, { role: "club-admin", tenantId: "tenant-beta" })
  await tenantBPage.goto("/club-admin/users")
  await tenantBPage.getByRole("tab", { name: /Invites/ }).click()
  await expect(tenantBPage.getByRole("heading", { name: "Staff invites" })).toBeVisible()
  await expect(tenantBPage.locator("body")).not.toContainText(email)
  await tenantBContext.close()
})
