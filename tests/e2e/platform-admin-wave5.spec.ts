import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("platform-admin can review, provision, invite, export, and audit a tenant request", async ({ page }) => {
  const nonce = Date.now()
  const organizationName = `Wave 5 Org ${nonce}`
  const requestorEmail = `platform-wave5-${nonce}@pacelab.local`

  await page.goto("/login?mode=request")
  await page.getByLabel("First name").fill("Platform")
  await page.getByLabel("Last name").fill("Wave Five")
  await page.getByLabel("Work email").fill(requestorEmail)
  await page.getByLabel("Job title").fill("Director of Performance")
  await page.getByPlaceholder("Elite Track Club").fill(organizationName)
  await page.getByRole("combobox", { name: "Organization type" }).click()
  await page.locator('[role="option"]').filter({ hasText: "Club" }).first().click()
  await page.getByLabel("Country or region").fill("Colombia")
  await page.locator("#request-package-pro").click()
  await page.getByLabel("Expected coaches").fill("5")
  await page.getByLabel("Expected athletes").fill("42")
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
  await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible()
  await expect(page.locator("body")).toContainText(organizationName)

  await page.goto("/platform-admin/requests")
  await expect(page).toHaveURL(/\/platform-admin\/requests$/)
  await expect(page.getByRole("heading", { level: 1, name: "Club requests" })).toBeVisible()
  await page.getByLabel("Search requests").fill(organizationName)

  // A new request lands in the "New" stage with everything the club submitted.
  const requestRow = page.locator("[data-request-row]").filter({ hasText: organizationName }).first()
  await expect(requestRow).toContainText(requestorEmail)
  await expect(requestRow).toContainText("New")
  await requestRow.click()

  const detail = page.getByRole("dialog").filter({ hasText: organizationName })
  await expect(detail).toContainText("Director of Performance")
  await expect(detail).toContainText("Colombia")
  await expect(detail).toContainText("Pro")
  await expect(detail).toContainText("Request received")

  // Declining needs a reason, and backing out leaves the request untouched.
  await detail.getByRole("button", { name: "Decline", exact: true }).click()
  await detail.getByRole("button", { name: "Decline request" }).click()
  await expect(detail).toContainText("Give a short reason.")
  await detail.getByRole("button", { name: "Keep request" }).click()

  await detail.getByRole("button", { name: "Approve and provision" }).click()
  await detail.getByLabel("Note for the record").fill("Provision immediately for Wave 5.")
  await detail.getByRole("button", { name: "Yes, approve and provision" }).click()

  // The approved request must stay reachable: the list follows it to its new stage and the detail stays open.
  await expect(detail.getByRole("status")).toContainText(
    `${organizationName} is approved and its workspace is ready. Access invite sent to ${requestorEmail}.`,
  )
  await expect(requestRow).toContainText("Waiting on billing")
  await expect(requestRow).toContainText("Invite sent")
  await expect(detail).toContainText("Club workspace created")
  await expect(detail).toContainText("Provision immediately for Wave 5.")

  // Close and open the request again from the list.
  await page.keyboard.press("Escape")
  await expect(detail).toBeHidden()
  await expect(page.getByRole("tab", { name: /Waiting on setup/ })).toHaveAttribute("aria-selected", "true")
  await requestRow.click()

  await detail.getByRole("button", { name: "Resend access invite" }).click()
  await expect(detail.getByRole("status")).toContainText(`Access invite sent again to ${requestorEmail}.`)

  await detail.getByRole("button", { name: "Copy access link" }).click()
  await expect(detail.getByRole("status")).toContainText(`Access link for ${requestorEmail} copied.`)
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __PACELAB_CLIPBOARD__?: string }).__PACELAB_CLIPBOARD__ ?? ""))
    .toContain("/club-admin/claim?mock_request=")

  await page.keyboard.press("Escape")
  await expect(detail).toBeHidden()

  await page.getByRole("button", { name: "Send queued emails" }).click()
  await expect(page.locator("body")).toContainText("No emails were waiting to go out.")

  const queueDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export CSV" }).click()
  expect((await queueDownload).suggestedFilename()).toBe("platform-admin-request-queue.csv")
  await expect(page.locator("body")).toContainText("Exported 1 request to CSV.")

  await page.goto("/platform-admin/audit")
  await expect(page).toHaveURL(/\/platform-admin\/audit$/)
  await page.getByLabel("Search activity").fill(requestorEmail)
  await expect(page.locator("body")).toContainText("Asked for a club workspace")
  await expect(page.locator("body")).toContainText("Approved a club request")
  await expect(page.locator("body")).toContainText("Created the club workspace")

  await page.getByLabel("Search activity").fill("platform_audit_export_csv")
  await expect(page.locator("body")).toContainText("Downloaded a CSV")
  await expect(page.locator("body")).toContainText("Club requests")
})
