import { expect, test } from "@playwright/test"
import {
  getStorageStatePathForRole,
  hasSupabaseBaseSetupEnvVars,
  storageStateFileExists,
} from "../helpers/supabase-auth"

test("club admin session can access users page", async ({ browser }) => {
  const storageStatePath = getStorageStatePathForRole("clubAdmin")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/club-admin/users")
  await expect(page).toHaveURL(/\/club-admin\/users$/)
  await expect(page.locator("body")).toContainText("Users & Roles")

  await context.close()
})

test("coach session can access teams page", async ({ browser }) => {
  const storageStatePath = getStorageStatePathForRole("coach")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/coach/teams")
  await expect(page).toHaveURL(/\/coach\/teams$/)
  await expect(page.locator("body")).toContainText("Coach Teams")

  await context.close()
})

test("athlete session can access wellness page", async ({ browser }) => {
  const storageStatePath = getStorageStatePathForRole("athlete")
  test.skip(!hasSupabaseBaseSetupEnvVars(), "Missing required Supabase e2e environment variables.")
  test.skip(!(await storageStateFileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/athlete/wellness")
  await expect(page).toHaveURL(/\/athlete\/wellness$/)
  await expect(page.locator("body")).toContainText("Wellness")

  await context.close()
})
