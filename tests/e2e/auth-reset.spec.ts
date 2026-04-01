import { expect, test } from "@playwright/test"

test("mock password reset lets a coach set a new password and sign in", async ({ page }) => {
  const resetEmail = "coach@pacelab.local"
  const newPassword = `Reset${Date.now()}!`

  await page.goto("/reset-password")
  await page.locator("#reset-request-email").fill(resetEmail)
  await page.getByRole("button", { name: "Send reset link" }).click()

  await expect(page).toHaveURL(/\/reset-password\?mock_token=/)
  await page.locator("#reset-new-password").fill(newPassword)
  await page.locator("#reset-confirm-password").fill(newPassword)
  await page.getByRole("button", { name: "Update password" }).click()

  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel("Email").fill(resetEmail)
  await page.getByLabel("Password").fill(newPassword)
  await page.locator("form").getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL(/\/coach\/dashboard$/)
})
