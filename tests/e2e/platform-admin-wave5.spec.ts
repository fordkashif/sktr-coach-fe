import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("platform-admin can review, provision, invite, export, and audit a tenant request", async ({ page }) => {
  const nonce = Date.now()
  const organizationName = `Wave 5 Org ${nonce}`
  const requestorEmail = `platform-wave5-${nonce}@pacelab.local`

  await page.goto("/login?mode=request")
  await page.getByLabel("Full name").fill("Platform Wave Five")
  await page.getByLabel("Work email").fill(requestorEmail)
  await page.getByLabel("Job title").fill("Director of Performance")
  await page.getByPlaceholder("Elite Track Club").fill(organizationName)
  await page.getByRole("combobox", { name: "Organization type" }).click()
  await page.locator('[role="option"]').filter({ hasText: "Club" }).first().click()
  await page.getByLabel("Country or region").fill("Colombia")
  await page.getByLabel("Expected coaches").fill("5")
  await page.getByLabel("Expected athletes").fill("42")
  await page.getByLabel("Notes").fill("Wave 5 platform-admin flow validation.")
  await page.getByRole("button", { name: "Submit request" }).click()
  await expect(page.locator("body")).toContainText("We have your access request.")
  await expect(page.locator("body")).toContainText("platform-admin queue")

  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          ;(window as typeof window & { __PACELAB_CLIPBOARD__?: string }).__PACELAB_CLIPBOARD__ = value
        },
      },
    })
  })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto("/platform-admin/dashboard")
  await expect(page).toHaveURL(/\/platform-admin\/dashboard$/)
  await expect(page.locator("body")).toContainText("System control, without tenant leakage.")
  await expect(page.locator("body")).toContainText(organizationName)

  await page.goto("/platform-admin/requests")
  await expect(page).toHaveURL(/\/platform-admin\/requests$/)
  await page.getByPlaceholder("Search request queue").fill(organizationName)

  const requestCard = page.locator("article").filter({ hasText: organizationName }).first()
  await expect(requestCard).toContainText(requestorEmail)
  await requestCard.getByRole("button", { name: "Review request" }).click()
  await page.getByPlaceholder("Add the review note or provisioning instruction.").first().fill("Provision immediately for Wave 5.")
  await requestCard.getByRole("button", { name: "Approve and provision" }).click()

  await expect(page.locator("body")).toContainText(`Tenant provisioned and initial access invite sent to ${requestorEmail}.`)
  await expect(requestCard).toContainText("approved")
  await expect(requestCard).toContainText("Invite sent")

  await requestCard.getByRole("button", { name: "Resend initial access invite" }).click()
  await expect(page.locator("body")).toContainText(`Initial access invite re-sent to ${requestorEmail}.`)

  await requestCard.getByRole("button", { name: "Copy initial access link" }).click()
  await expect(page.locator("body")).toContainText(`Copied initial access link for ${requestorEmail}.`)
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __PACELAB_CLIPBOARD__?: string }).__PACELAB_CLIPBOARD__ ?? ""))
    .toContain("/club-admin/claim?mock_request=")

  await page.getByLabel("Dispatch pending notification emails").click()
  await expect(page.locator("body")).toContainText("Processed 0 pending email notification event(s).")

  const queueDownload = page.waitForEvent("download")
  await page.getByLabel("Export request queue as CSV").click()
  expect((await queueDownload).suggestedFilename()).toBe("platform-admin-request-queue.csv")

  await page.goto("/platform-admin/audit")
  await expect(page).toHaveURL(/\/platform-admin\/audit$/)
  await page.getByPlaceholder("Search audit trail").fill(requestorEmail)
  await expect(page.locator("body")).toContainText("tenant provision request submitted")
  await expect(page.locator("body")).toContainText("tenant provision request reviewed")
  await expect(page.locator("body")).toContainText("tenant provision request provisioned")

  await page.getByPlaceholder("Search audit trail").fill("platform_audit_export_csv")
  await expect(page.locator("body")).toContainText("platform audit export csv")
  await expect(page.locator("body")).toContainText("request-queue")
})
