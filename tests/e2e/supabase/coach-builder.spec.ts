import { expect, test } from "@playwright/test"
import { access, constants } from "node:fs/promises"

async function fileExists(path: string) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

test.describe("coach supabase builders", () => {
  test("coach can open supabase training-plan builder surface", async ({ browser }) => {
    const storageStatePath = "playwright/.auth/coach.json"
    test.skip(!(await fileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

    const context = await browser.newContext({ storageState: storageStatePath })
    const page = await context.newPage()

    await page.goto("/coach/training-plan")
    await expect(page).toHaveURL(/\/coach\/training-plan$/)
    await expect(page.getByRole("heading", { name: "Training Plans" })).toBeVisible()
    await expect(page.locator("body")).toContainText("Supabase mode")
    await expect(page.getByRole("heading", { name: "Create Plan" })).toBeVisible()

    await context.close()
  })

  test("coach can open supabase test-week builder surface", async ({ browser }) => {
    const storageStatePath = "playwright/.auth/coach.json"
    test.skip(!(await fileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

    const context = await browser.newContext({ storageState: storageStatePath })
    const page = await context.newPage()

    await page.goto("/coach/test-week")
    await expect(page).toHaveURL(/\/coach\/test-week$/)
    await expect(page.getByRole("heading", { name: "Test Weeks" })).toBeVisible()
    await expect(page.locator("body")).toContainText("Supabase mode")
    await expect(page.getByRole("heading", { name: "Create Test Week" })).toBeVisible()

    await context.close()
  })
})
