import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("club-admin, coach, and athlete core surfaces are reachable", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.goto("/club-admin/users")
  await expect(page).toHaveURL(/\/club-admin\/users$/)
  await expect(page.locator("body")).toContainText("Users & Roles")

  await seedMockSession(page, { role: "coach", tenantId: "tenant-alpha", coachTeamId: "t1" })
  await page.goto("/coach/teams")
  await expect(page).toHaveURL(/\/coach\/teams\/t1$/)
  await expect(page.locator("body")).toContainText(/Sprint Group|Team not found|Roster State/)

  await seedMockSession(page, { role: "athlete", tenantId: "tenant-alpha" })
  await page.goto("/athlete/wellness")
  await expect(page).toHaveURL(/\/athlete\/wellness$/)
  await expect(page.locator("body")).toContainText("Wellness")
})

test("athlete wellness submission returns readiness output", async ({ page }) => {
  await seedMockSession(page, { role: "athlete", tenantId: "tenant-alpha" })
  await page.goto("/athlete/wellness")

  await page.getByLabel("Sleep hours").fill("8")
  await page.getByRole("button", { name: "Save check-in" }).click()

  await expect(page.getByRole("heading", { name: "Readiness Output" })).toBeVisible()
  await expect(page.locator("body")).toContainText(/Ready|Watch|Review/)
})

test("tenant storage isolation: invite created in tenant A is not visible in tenant B", async ({ browser }) => {
  const email = `coach+${Date.now()}@pacelab.local`

  const tenantAContext = await browser.newContext()
  const tenantAPage = await tenantAContext.newPage()
  await seedMockSession(tenantAPage, { role: "club-admin", tenantId: "tenant-alpha" })
  await tenantAPage.goto("/club-admin/users")
  await tenantAPage.getByPlaceholder("coach@email.com").fill(email)
  await tenantAPage.getByRole("button", { name: "Send invite" }).click()
  await expect(tenantAPage.locator("body")).toContainText(email)
  await tenantAContext.close()

  const tenantBContext = await browser.newContext()
  const tenantBPage = await tenantBContext.newPage()
  await seedMockSession(tenantBPage, { role: "club-admin", tenantId: "tenant-beta" })
  await tenantBPage.goto("/club-admin/users")
  await expect(tenantBPage.locator("body")).not.toContainText(email)
  await tenantBContext.close()
})
