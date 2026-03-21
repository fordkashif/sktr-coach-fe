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

test("club admin session can access users page", async ({ browser }) => {
  const storageStatePath = "playwright/.auth/club-admin.json"
  test.skip(!(await fileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/club-admin/users")
  await expect(page).toHaveURL(/\/club-admin\/users$/)
  await expect(page.locator("body")).toContainText("Users & Roles")

  await context.close()
})

test("coach session can access teams page", async ({ browser }) => {
  const storageStatePath = "playwright/.auth/coach.json"
  test.skip(!(await fileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/coach/teams")
  await expect(page).toHaveURL(/\/coach\/teams$/)
  await expect(page.locator("body")).toContainText("Coach Teams")

  await context.close()
})

test("athlete session can access wellness page", async ({ browser }) => {
  const storageStatePath = "playwright/.auth/athlete.json"
  test.skip(!(await fileExists(storageStatePath)), `Missing storage state: ${storageStatePath}`)

  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  await page.goto("/athlete/wellness")
  await expect(page).toHaveURL(/\/athlete\/wellness$/)
  await expect(page.locator("body")).toContainText("Wellness")

  await context.close()
})
