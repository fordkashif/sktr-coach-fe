import { expect, test, type Browser, type Page } from "@playwright/test"
import {
  getStorageStatePathForRole,
  hasSupabaseBaseSetupEnvVars,
  storageStateFileExists,
} from "../helpers/supabase-auth"

async function withClubAdminPage(browser: Browser, fn: (page: Page) => Promise<void>) {
  const storageStatePath = getStorageStatePathForRole("clubAdmin")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath, acceptDownloads: true })
  const page = await context.newPage()

  try {
    await fn(page)
  } finally {
    await context.close()
  }
}

test.describe("club-admin supabase surfaces", () => {
  test("club admin session can access dashboard landing page", async ({ browser }) => {
    await withClubAdminPage(browser, async (page) => {
      await page.goto("/club-admin/dashboard")
      await expect(page).toHaveURL(/\/club-admin\/dashboard$/)
      await expect(page.locator("body")).toContainText("Command Center")
    })
  })

  test("club admin session can access reports page", async ({ browser }) => {
    await withClubAdminPage(browser, async (page) => {
      await page.goto("/club-admin/reports")
      await expect(page).toHaveURL(/\/club-admin\/reports$/)
      await expect(page.locator("body")).toContainText("Reports & Exports")
    })
  })

  test("club admin session can access audit page", async ({ browser }) => {
    await withClubAdminPage(browser, async (page) => {
      await page.goto("/club-admin/audit")
      await expect(page).toHaveURL(/\/club-admin\/audit$/)
      await expect(page.locator("body")).toContainText("Audit / Activity Logs")
    })
  })

  test("club admin reports export is recorded in audit", async ({ browser }) => {
    await withClubAdminPage(browser, async (page) => {
      await page.goto("/club-admin/reports")

      const downloadPromise = page.waitForEvent("download")
      await page.getByRole("button", { name: "Users CSV" }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe("club-users.csv")

      await page.goto("/club-admin/audit")
      await page.getByPlaceholder("Search logs...").fill("club-users.csv")
      await expect(page.locator("body")).toContainText("export_csv")
      await expect(page.locator("body")).toContainText("club-users.csv")
    })
  })
})
