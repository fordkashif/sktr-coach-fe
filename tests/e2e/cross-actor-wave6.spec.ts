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
  await page.getByLabel("Full name").fill("Platform Wave Six")
  await page.getByLabel("Work email").fill(requestorEmail)
  await page.getByLabel("Job title").fill("Program Director")
  await page.getByPlaceholder("Elite Track Club").fill(organizationName)
  await page.getByRole("combobox", { name: "Organization type" }).click()
  await page.locator('[role="option"]').filter({ hasText: "Club" }).first().click()
  await page.getByLabel("Country or region").fill("Colombia")
  await page.getByRole("combobox", { name: "Package" }).click()
  await page.locator('[role="option"]').filter({ hasText: "Starter" }).first().click()
  await page.getByLabel("Expected coaches").fill("3")
  await page.getByLabel("Expected athletes").fill("30")
  await page.getByLabel("Notes").fill("Wave 6 audit separation validation.")
  await page.getByRole("button", { name: "Submit request" }).click()
  await expect(page.locator("body")).toContainText("We have your access request.")

  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/platform-admin/requests")
  await page.getByPlaceholder("Search request queue").fill(organizationName)
  const requestCard = page.locator("article").filter({ hasText: organizationName }).first()
  await requestCard.getByRole("button", { name: "Review request" }).click()
  await page.getByPlaceholder("Add the review note or provisioning instruction.").first().fill("Wave 6 provision.")
  await requestCard.getByRole("button", { name: "Approve and provision" }).click()
  await expect(page.locator("body")).toContainText(`Tenant approved and initial billing/setup access invite sent to ${requestorEmail}.`)

  await seedMockSession(page, { role: "club-admin", tenantId: "tenant-alpha" })
  await page.goto("/club-admin/billing")
  await expect(page).toHaveURL(/\/club-admin\/billing$/)
  await page.locator("label:has-text('Seats')").locator("xpath=following::input[1]").fill("81")
  await page.getByRole("button", { name: "Save billing settings" }).click()
  await expect(page.locator("body")).toContainText("Saved.")
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("pacelab:audit-logs:tenant-alpha") ?? ""))
    .toContain("billing_update")

  await page.goto("/club-admin/audit")
  await page.getByPlaceholder("Search logs...").fill("billing_update")
  await expect(page.locator("body")).toContainText("billing update")
  await page.getByPlaceholder("Search logs...").fill(organizationName)
  await expect(page.locator("body")).toContainText("No activity logs yet.")

  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/platform-admin/audit")
  await page.getByPlaceholder("Search audit trail").fill(requestorEmail)
  await expect(page.locator("body")).toContainText("tenant provision request submitted")
  await expect(page.locator("body")).toContainText("tenant provision request provisioned")
  await page.getByPlaceholder("Search audit trail").fill("billing_update")
  await expect(page.locator("body")).toContainText("No platform audit events matched the current filter.")
})
