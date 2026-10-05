import { expect, test } from "@playwright/test"
import {
  getStorageStatePathForRole,
  hasRoleCredential,
  hasSupabaseBaseSetupEnvVars,
  storageStateFileExists,
} from "../helpers/supabase-auth"

test("platform admin session can access dashboard landing page", async ({ browser }) => {
  const storageStatePath = getStorageStatePathForRole("platformAdmin")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!hasRoleCredential("platformAdmin"), "Missing platform-admin Supabase credentials.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/platform-admin")
  await expect(page).toHaveURL(/\/platform-admin\/dashboard$/)
  await expect(page.getByRole("heading", { level: 1, name: "Platform" })).toBeVisible()

  await context.close()
})

test("platform admin session can access request queue", async ({ browser }) => {
  const storageStatePath = getStorageStatePathForRole("platformAdmin")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!hasRoleCredential("platformAdmin"), "Missing platform-admin Supabase credentials.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/platform-admin/requests")
  await expect(page).toHaveURL(/\/platform-admin\/requests$/)
  await expect(page.getByRole("heading", { level: 1, name: "Club requests" })).toBeVisible()

  await context.close()
})

test("platform admin session can access platform audit", async ({ browser }) => {
  const storageStatePath = getStorageStatePathForRole("platformAdmin")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!hasRoleCredential("platformAdmin"), "Missing platform-admin Supabase credentials.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/platform-admin/audit")
  await expect(page).toHaveURL(/\/platform-admin\/audit$/)
  await expect(page.locator("body")).toContainText("Platform activity")

  await context.close()
})

test("platform admin can review a newly submitted tenant request and see it in platform audit", async ({ browser }) => {
  const storageStatePath = getStorageStatePathForRole("platformAdmin")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!hasRoleCredential("platformAdmin"), "Missing platform-admin Supabase credentials.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const nonce = Date.now()
  const organizationName = `E2E Platform Org ${nonce}`
  const requestorEmail = `platform-e2e-${nonce}@pacelab.local`

  const publicContext = await browser.newContext()
  const publicPage = await publicContext.newPage()

  await publicPage.goto("/login?mode=request")
  await publicPage.getByLabel("First name").fill("Platform")
  await publicPage.getByLabel("Last name").fill("E2E Requestor")
  await publicPage.getByLabel("Work email").fill(requestorEmail)
  await publicPage.getByLabel("Job title").fill("Director of Performance")
  await publicPage.getByPlaceholder("Elite Track Club").fill(organizationName)
  await publicPage.getByRole("combobox", { name: "Organization type" }).selectOption("club")
  await publicPage.getByLabel("Country or region").fill("Jamaica")
  await publicPage.locator("#request-package-pro").click()
  await publicPage.getByLabel("Expected coaches").fill("5")
  await publicPage.getByLabel("Expected athletes").fill("42")
  await publicPage.getByLabel("Notes").fill("Created by Playwright to verify platform-admin request review flow.")
  await publicPage.getByRole("button", { name: "Submit request" }).click()

  await expect(publicPage.locator("body")).toContainText("We have your access request.")
  await expect(publicPage.locator("body")).toContainText("What happens next")
  await publicContext.close()

  const adminContext = await browser.newContext({ storageState: storageStatePath })
  const requestsPage = await adminContext.newPage()

  await requestsPage.goto("/platform-admin/requests")
  await requestsPage.getByLabel("Search requests").fill(organizationName)
  const requestRow = requestsPage.locator("[data-request-row]").filter({ hasText: organizationName }).first()
  await expect(requestRow).toContainText(requestorEmail)
  await requestRow.click()

  const detail = requestsPage.getByRole("dialog").filter({ hasText: organizationName })
  await detail.getByRole("button", { name: "Decline", exact: true }).click()
  await detail.getByLabel(/Why are you declining/).fill("Declined by Playwright to verify the review flow.")
  await detail.getByRole("button", { name: "Decline request" }).click()
  await expect(detail.getByRole("status")).toContainText(`${organizationName} was declined.`)
  await expect(requestRow).toContainText("Declined")

  const auditPage = await adminContext.newPage()
  await auditPage.goto("/platform-admin/audit")
  await auditPage.getByLabel("Search activity").fill(organizationName)
  await expect(auditPage.locator("body")).toContainText("Asked for a club workspace")
  await expect(auditPage.locator("body")).toContainText("Declined a club request")
  await expect(auditPage.locator("body")).toContainText(requestorEmail)

  await adminContext.close()
})

test("platform admin request queue export is logged in platform audit", async ({ browser }) => {
  const storageStatePath = getStorageStatePathForRole("platformAdmin")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!hasRoleCredential("platformAdmin"), "Missing platform-admin Supabase credentials.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const adminContext = await browser.newContext({ storageState: storageStatePath, acceptDownloads: true })
  const requestsPage = await adminContext.newPage()

  await requestsPage.goto("/platform-admin/requests")
  const downloadPromise = requestsPage.waitForEvent("download")
  await requestsPage.getByRole("button", { name: "Export CSV" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe("platform-admin-request-queue.csv")

  const auditPage = await adminContext.newPage()
  await auditPage.goto("/platform-admin/audit")
  await auditPage.getByLabel("Search activity").fill("platform_audit_export_csv")
  await expect(auditPage.locator("body")).toContainText("Downloaded a CSV")
  await expect(auditPage.locator("body")).toContainText("Club requests")

  await adminContext.close()
})
