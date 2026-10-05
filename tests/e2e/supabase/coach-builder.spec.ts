import { expect, test } from "@playwright/test"
import {
  getStorageStatePathForRole,
  hasSupabaseBaseSetupEnvVars,
  storageStateFileExists,
} from "../helpers/supabase-auth"

test.describe("coach supabase builders", () => {
  test("coach can open supabase training-plan builder surface", async ({ browser }) => {
    const storageStatePath = getStorageStatePathForRole("coach")
    test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
    test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

    const context = await browser.newContext({ storageState: storageStatePath })
    const page = await context.newPage()

    await page.goto("/coach/training-plan")
    await expect(page).toHaveURL(/\/coach\/training-plan$/)
    await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()
    await page.getByRole("button", { name: "New plan" }).click()
    await expect(page.getByRole("heading", { name: "New plan" })).toBeVisible()
    await expect(page.getByLabel("Plan name")).toBeVisible()

    await context.close()
  })

  test("coach can open supabase test-week builder surface", async ({ browser }) => {
    const storageStatePath = getStorageStatePathForRole("coach")
    test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
    test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

    const context = await browser.newContext({ storageState: storageStatePath })
    const page = await context.newPage()

    await page.goto("/coach/test-week")
    await expect(page).toHaveURL(/\/coach\/test-week$/)
    await expect(page.getByRole("heading", { name: "Test weeks" })).toBeVisible()
    await page.getByRole("button", { name: "New test week" }).click()
    await expect(page.getByRole("heading", { name: "New test week" })).toBeVisible()
    await expect(page.getByLabel("Test week name")).toBeVisible()

    await context.close()
  })
})
