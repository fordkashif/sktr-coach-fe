import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/** A small solid PNG (24 by 16). The app crops it square and resizes it before saving. */
const PHOTO = {
  name: "photo.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAHElEQVR42mP832PDQA3AxEAlMGrQqEGjBo1UgwBnLQHnvLPlYgAAAABJRU5ErkJggg==", "base64"),
}

const topbar = (page: Page) => page.locator("header[data-shell='topbar']")

test("coach changes their name and photo and both show in the top bar after a reload", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/account")

  await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible()
  // No photo yet: initials, and nothing to remove.
  await expect(topbar(page).getByRole("button", { name: "Open profile menu" }).locator("img")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0)

  // A file that is not a photo is refused with a reason.
  await page.getByTestId("avatar-file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") })
  await expect(page.getByRole("alert")).toContainText("not a photo we can use")

  await page.getByTestId("avatar-file-input").setInputFiles(PHOTO)
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(topbar(page).getByRole("button", { name: "Open profile menu" }).locator("img")).toHaveAttribute("src", /^data:image\/jpeg/)

  await page.getByLabel("Full name").fill("  ")
  await page.getByRole("button", { name: "Save name" }).click()
  await expect(page.getByText("Enter your name.")).toBeVisible()

  await page.getByLabel("Full name").fill("Jordan Blake-Coach")
  await page.getByRole("button", { name: "Save name" }).click()
  await expect(page.getByText("Name saved.")).toBeVisible()

  await page.reload()

  await expect(page.getByLabel("Full name")).toHaveValue("Jordan Blake-Coach")
  const menuButton = topbar(page).getByRole("button", { name: "Open profile menu" })
  await expect(menuButton.locator("img")).toHaveAttribute("src", /^data:image\/jpeg/)
  await menuButton.click()
  await expect(page.getByRole("menu")).toContainText("Jordan Blake-Coach")
  await expect(page.getByRole("menu")).toContainText("coach@pacelab.local")
  await page.keyboard.press("Escape")

  // Remove asks first, then the initials come back.
  await page.getByRole("button", { name: "Remove", exact: true }).click()
  await page.getByRole("button", { name: "Remove photo" }).click()
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible()
  await expect(menuButton.locator("img")).toHaveCount(0)
})

test("coach changes their password while signed in and can sign in with the new one", async ({ page }) => {
  const newPassword = `Changed${Date.now()}!`
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/account")

  await page.getByRole("button", { name: "Change password" }).click()
  await page.getByLabel("Current password").fill("not-the-password")
  await page.getByLabel("New password", { exact: true }).fill("short")
  await page.getByLabel("Confirm new password").fill("shorx")
  await page.getByRole("button", { name: "Change password" }).click()
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible()
  await expect(page.getByText("Passwords do not match.")).toBeVisible()

  await page.getByLabel("New password", { exact: true }).fill(newPassword)
  await page.getByLabel("Confirm new password").fill(newPassword)
  await page.getByRole("button", { name: "Change password" }).click()
  await expect(page.getByText("Your current password is not right.")).toBeVisible()

  await page.getByRole("button", { name: "Show passwords" }).click()
  await expect(page.getByLabel("Current password")).toHaveAttribute("type", "text")
  await page.getByLabel("Current password").fill("Password123!")
  await page.getByRole("button", { name: "Change password" }).click()
  await expect(page.getByText("Password changed.")).toBeVisible()

  // Sign out, then the old password fails and the new one works.
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel("Email").fill("coach@pacelab.local")
  await page.getByLabel("Password").fill("Password123!")
  await page.locator("form").getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert")).toBeVisible()
  await page.getByLabel("Password").fill(newPassword)
  await page.locator("form").getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/coach\/dashboard$/)
})

test("changing email explains the confirmation link and does not change the address", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin" })
  await page.goto("/account")

  await page.getByRole("button", { name: "Change email" }).click()
  await page.getByLabel("New email").fill("clubadmin@pacelab.local")
  await page.getByRole("button", { name: "Send confirmation link" }).click()
  await expect(page.getByText("That is already your email address.")).toBeVisible()

  await page.getByLabel("New email").fill("new.admin@club.test")
  await page.getByRole("button", { name: "Send confirmation link" }).click()
  await expect(page.getByRole("status").filter({ hasText: "new.admin@club.test" })).toContainText("Until then you sign in with clubadmin@pacelab.local")
})

test("a platform admin sets their own name on the account screen", async ({ page }) => {
  await seedMockSession(page, { role: "platform-admin", tenantId: "platform" })
  await page.goto("/account")
  await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible()
  await page.getByLabel("Full name").fill("Pat Platform")
  await page.getByRole("button", { name: "Save name" }).click()
  await expect(page.getByText("Name saved.")).toBeVisible()
  await expect(page.getByRole("link", { name: /Email support/ })).toHaveAttribute("href", "mailto:support@thesktr.com")
})
