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

// The form holds a request back until three seconds after it appeared (a script fills it in one), and
// a filled honeypot is answered with the same success page while nothing is stored. Demo mode applies
// the honeypot rule in the browser; in Supabase mode the database does (20261006181000).
test("public request form: a too-fast submit is held back, and a filled honeypot stores nothing", async ({ page }) => {
  const fill = async (organization: string) => {
    await page.goto("/login?mode=request")
    await page.getByLabel("First name").fill("Quick")
    await page.getByLabel("Last name").fill("Sender")
    await page.getByLabel("Work email").fill(`quick-${Date.now()}@pacelab.local`)
    await page.getByLabel("Job title").fill("Head coach")
    await page.getByPlaceholder("Elite Track Club").fill(organization)
    await page.getByRole("combobox", { name: "Organization type" }).click()
    await page.locator('[role="option"]').filter({ hasText: "Club" }).first().click()
    await page.getByLabel("Country or region").fill("Jamaica")
    await page.locator("#request-package-starter").click()
    await page.getByLabel("Expected coaches").fill("2")
    await page.getByLabel("Expected athletes").fill("20")
  }

  const realOrganization = `Honest Club ${Date.now()}`
  // The clock starts when the form appears, which is after this moment, so the whole thing can never
  // take less than the three seconds however fast the fields are filled.
  const startedAt = Date.now()
  await fill(realOrganization)
  await page.getByRole("button", { name: "Submit request" }).click()
  await expect(page.locator("body")).toContainText("We have your access request.")
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3000)

  // People cannot reach the honeypot: off screen, hidden from assistive technology, not a tab stop.
  const botOrganization = `Bot Club ${Date.now()}`
  await fill(botOrganization)
  const honeypot = page.locator("#request-reference-code")
  await expect(honeypot).toHaveAttribute("tabindex", "-1")
  await expect(honeypot).toHaveAttribute("autocomplete", "off")
  expect(await honeypot.evaluate((element) => element.closest('[aria-hidden="true"]') !== null)).toBe(true)
  expect(await honeypot.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThan(0)
  // A script fills it anyway.
  await honeypot.evaluate((element) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setValue?.call(element, "http://spam.example")
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await page.getByRole("button", { name: "Submit request" }).click()
  await expect(page.locator("body")).toContainText("We have your access request.")

  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/platform-admin/requests")
  await page.getByLabel("Search requests").fill(realOrganization)
  await expect(page.locator("[data-request-row]").filter({ hasText: realOrganization })).toHaveCount(1)
  await page.getByLabel("Search requests").fill(botOrganization)
  await expect(page.locator("[data-request-row]").filter({ hasText: botOrganization })).toHaveCount(0)
})

test("club-admin can send coach invite and manage user access", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/club-admin/users")

  const inviteEmail = `coach-wave4-${Date.now()}@pacelab.local`
  await page.getByRole("button", { name: "Invite coach" }).first().click()
  await page.getByPlaceholder("coach@email.com").fill(inviteEmail)
  await page.getByRole("button", { name: "Send invite" }).click()
  await expect(page.getByRole("dialog")).toContainText(`Invite emailed to ${inviteEmail}`)
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
  await page.getByRole("dialog").getByRole("button", { name: "Send invite" }).click()
  await expect(page.getByRole("dialog")).toContainText("Invite emailed to")
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
