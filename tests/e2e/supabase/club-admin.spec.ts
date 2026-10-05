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
      await expect(page.locator("body")).toContainText("Team by team")
    })
  })

  test("club admin session can access reports page", async ({ browser }) => {
    await withClubAdminPage(browser, async (page) => {
      await page.goto("/club-admin/reports")
      await expect(page).toHaveURL(/\/club-admin\/reports$/)
      await expect(page.locator("body")).toContainText("Team summary")
    })
  })

  test("club admin session can access audit page", async ({ browser }) => {
    await withClubAdminPage(browser, async (page) => {
      await page.goto("/club-admin/audit")
      await expect(page).toHaveURL(/\/club-admin\/audit$/)
      await expect(page.locator("body")).toContainText("Activity log")
    })
  })

  test("club admin reports export is recorded in audit", async ({ browser }) => {
    await withClubAdminPage(browser, async (page) => {
      await page.goto("/club-admin/reports")

      const downloadPromise = page.waitForEvent("download")
      await page.getByRole("button", { name: "Teams CSV" }).click()
      const download = await downloadPromise
      // The file name carries the period the report covers.
      const filename = download.suggestedFilename()
      expect(filename).toMatch(/^club-teams-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/)

      await page.goto("/club-admin/audit")
      // The log is searched by the stored file name and shows the export as a plain sentence.
      await page.getByLabel("Search activity").fill(filename)
      await expect(page.locator("#main-content")).toContainText("Downloaded the team summary as a CSV file")
    })
  })
})
