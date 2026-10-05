import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test("athlete edits their profile and the changes survive a reload", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/profile")

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Johnson")
  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Notification settings" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible()

  await page.getByRole("button", { name: "Edit profile" }).click()
  await page.getByLabel("First name").fill("Marcus")
  await page.getByLabel("Last name").fill("Johnson-Reid")
  await page.getByLabel("Primary event").fill("200m")
  await page.getByLabel("Event group").selectOption("Sprint")
  await page.getByLabel("Date of birth").fill("2003-04-12")
  await page.getByRole("button", { name: "Save profile" }).click()

  await expect(page.getByRole("status")).toContainText("Profile saved")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Johnson-Reid")

  await page.reload()

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Johnson-Reid")
  const about = page.locator("section", { has: page.getByRole("heading", { name: "About you" }) })
  await expect(about).toContainText("200m")
  await expect(about).toContainText("April 12, 2003")
})

test("athlete profile rejects an empty name and cancel discards edits", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/profile")

  await page.getByRole("button", { name: "Edit profile" }).click()
  await page.getByLabel("First name").fill("")
  await page.getByRole("button", { name: "Save profile" }).click()
  await expect(page.getByText("Enter your first name.")).toBeVisible()

  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Marcus Johnson")
})
