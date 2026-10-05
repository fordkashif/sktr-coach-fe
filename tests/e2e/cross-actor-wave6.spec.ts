import { expect, test, type Download } from "@playwright/test"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { seedMockSession } from "./helpers/session"

async function readDownloadText(download: Download) {
  const dir = await mkdtemp(join(tmpdir(), "pacelab-wave6-"))
  const filePath = join(dir, download.suggestedFilename())
  await download.saveAs(filePath)
  return readFile(filePath, "utf8")
}

test("wrong-role route access redirects back to login", async ({ page }) => {
  await seedMockSession(page, { role: "athlete", tenantId: "tenant-alpha" })
  await page.goto("/coach/dashboard")
  await expect(page).toHaveURL(/\/login$/)

  await seedMockSession(page, { role: "coach", tenantId: "tenant-alpha", coachTeamId: "t4" })
  await page.goto("/club-admin/dashboard")
  await expect(page).toHaveURL(/\/login$/)

  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.goto("/platform-admin/dashboard")
  await expect(page).toHaveURL(/\/login$/)

  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/club-admin/dashboard")
  await expect(page).toHaveURL(/\/login$/)
})

test("coach exports remain scoped to the assigned team", async ({ page }) => {
  await seedMockSession(page, { role: "coach", tenantId: "tenant-alpha", coachTeamId: "t4" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/coach/reports")

  const adherenceDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("button", { name: /^Adherence CSV$/ }).first().click()
  const adherenceCsv = await readDownloadText(await adherenceDownload)
  expect(adherenceCsv).toContain("Mia Anderson")
  expect(adherenceCsv).toContain("Liam Patel")
  expect(adherenceCsv).not.toContain("Marcus Johnson")

  const prDownload = page.waitForEvent("download")
  await page.locator("#main-content").getByRole("tab", { name: "PRs", exact: true }).click()
  await page.locator("#main-content").getByRole("button", { name: /^PR CSV$/ }).first().click()
  const prCsv = await readDownloadText(await prDownload)
  expect(prCsv).toContain("Shot Put")
  expect(prCsv).not.toContain("Marcus Johnson")
})

test("tenant audit and platform audit remain separated", async ({ page }) => {
  const nonce = Date.now()
  const organizationName = `Wave 6 Org ${nonce}`
  const requestorEmail = `platform-wave6-${nonce}@pacelab.local`

  await page.goto("/login?mode=request")
  await page.getByLabel("First name").fill("Platform")
  await page.getByLabel("Last name").fill("Wave Six")
  await page.getByLabel("Work email").fill(requestorEmail)
  await page.getByLabel("Job title").fill("Program Director")
  await page.getByPlaceholder("Elite Track Club").fill(organizationName)
  await page.getByRole("combobox", { name: "Organization type" }).click()
  await page.locator('[role="option"]').filter({ hasText: "Club" }).first().click()
  await page.getByLabel("Country or region").fill("Colombia")
  await page.locator("#request-package-starter").click()
  await page.getByLabel("Expected coaches").fill("3")
  await page.getByLabel("Expected athletes").fill("30")
  await page.getByRole("button", { name: "Submit request" }).click()
  await expect(page.locator("body")).toContainText("We have your access request.")

  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/platform-admin/requests")
  await page.getByPlaceholder("Search request queue").fill(organizationName)
  const requestCard = page.locator("article").filter({ hasText: organizationName }).first()
  await requestCard.getByRole("button", { name: "Review request" }).click()
  const reviewDialog = page.getByRole("dialog").filter({ hasText: "Review request" }).last()
  await reviewDialog.getByPlaceholder("Add the review note or provisioning instruction.").fill("Wave 6 provision.")
  await reviewDialog.getByRole("button", { name: "Approve and provision" }).click()
  await page.getByRole("dialog").filter({ hasText: "Approve request?" }).getByRole("button", { name: "Confirm approval" }).click()
  await expect(page.locator("body")).toContainText(`Tenant approved and initial billing/setup access invite sent to ${requestorEmail}.`)

  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.goto("/club-admin/billing")
  await expect(page).toHaveURL(/\/club-admin\/billing$/)
  await page.getByRole("button", { name: "Edit" }).click()
  await page.getByLabel("Billing contact name").fill("Club Treasurer")
  await page.getByLabel("Billing contact email").fill("treasurer@pacelab.local")
  await page.getByRole("button", { name: "Save billing contact" }).click()
  await expect(page.locator("body")).toContainText("Billing contact saved.")
  await expect(page.locator("body")).toContainText("treasurer@pacelab.local")
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("pacelab:audit-logs:tenant-alpha") ?? ""))
    .toContain("billing_update")

  await page.goto("/club-admin/audit")
  await page.getByLabel("Search activity").fill("billing_update")
  await expect(page.locator("body")).toContainText("Updated billing details")
  await page.getByLabel("Search activity").fill(organizationName)
  await expect(page.locator("body")).toContainText("No activity matches these filters")

  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/platform-admin/audit")
  await page.getByPlaceholder("Search audit trail").fill(requestorEmail)
  await expect(page.locator("body")).toContainText("tenant provision request submitted")
  await expect(page.locator("body")).toContainText("tenant provision request provisioned")
  await page.getByPlaceholder("Search audit trail").fill("billing_update")
  await expect(page.locator("body")).toContainText("No platform audit events matched the current filter.")
})
