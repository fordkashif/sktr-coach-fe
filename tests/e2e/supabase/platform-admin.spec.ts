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
  await expect(page.locator("body")).toContainText("System control, without tenant leakage.")

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
  await expect(page.locator("body")).toContainText("Request intake with real review control.")

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
  await expect(page.locator("body")).toContainText("Platform audit, not tenant guesswork.")

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
  await publicPage.getByLabel("Full name").fill("Platform E2E Requestor")
  await publicPage.getByLabel("Work email").fill(requestorEmail)
  await publicPage.getByLabel("Organization").fill(organizationName)
  await publicPage.getByLabel("Notes").fill("Created by Playwright to verify platform-admin request review flow.")
  await publicPage.getByRole("button", { name: "Submit request" }).click()

  await expect(publicPage.locator("body")).toContainText("We have your access request.")
  await expect(publicPage.locator("body")).toContainText("submitted for platform-admin review")
  await publicContext.close()

  const adminContext = await browser.newContext({ storageState: storageStatePath })
  const requestsPage = await adminContext.newPage()

  await requestsPage.goto("/platform-admin/requests")
  const requestCard = requestsPage.locator("article").filter({ hasText: organizationName }).first()
  await expect(requestCard).toContainText(requestorEmail)

  await requestCard.getByRole("button", { name: "Reject" }).click()
  await expect(requestCard).toContainText("rejected")
  await expect(requestsPage.locator("body")).toContainText(`Request rejected for ${requestorEmail}.`)

  const auditPage = await adminContext.newPage()
  await auditPage.goto("/platform-admin/audit")
  await auditPage.getByPlaceholder("Search audit trail").fill(organizationName)
  await expect(auditPage.locator("body")).toContainText("tenant provision request submitted")
  await expect(auditPage.locator("body")).toContainText("tenant provision request reviewed")
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
  await auditPage.getByPlaceholder("Search audit trail").fill("platform_audit_export_csv")
  await expect(auditPage.locator("body")).toContainText("platform audit export csv")
  await expect(auditPage.locator("body")).toContainText("request-queue")

  await adminContext.close()
})
