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

test("athlete adds a profile photo, keeps it after a reload, and their coach sees it on the roster", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/athlete/profile")

  const heading = page.getByRole("heading", { level: 1 })
  await expect(heading).toContainText("Marcus Johnson")
  await expect(heading.locator("img")).toHaveCount(0)

  await page.getByTestId("avatar-file-input").setInputFiles({
    name: "me.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAHElEQVR42mP832PDQA3AxEAlMGrQqEGjBo1UgwBnLQHnvLPlYgAAAABJRU5ErkJggg==", "base64"),
  })
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible()
  await expect(heading.locator("img")).toHaveAttribute("src", /^data:image\/jpeg/)

  await page.reload()
  await expect(heading.locator("img")).toHaveAttribute("src", /^data:image\/jpeg/)
  await expect(page.locator("header[data-shell='topbar']").getByRole("button", { name: "Open profile menu" }).locator("img")).toHaveCount(1)

  // The rest of the account lives one tap away.
  await page.getByRole("link", { name: "Account and security" }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole("heading", { level: 1, name: "Account and security" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible()

  // Same browser, now signed in as the coach of that team: the photo is on the roster.
  await page.evaluate(() => {
    window.localStorage.setItem("pacelab:mock-role", "coach")
    window.localStorage.setItem("pacelab:mock-user-email", "coach@pacelab.local")
    window.localStorage.setItem("pacelab:mock-coach-team", "t1")
  })
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/teams/t1")
  const row = page.getByRole("listitem").filter({ hasText: "Marcus Johnson" }).first()
  await expect(row.locator("img")).toHaveAttribute("src", /^data:image\/jpeg/)
  await expect(page.getByRole("listitem").filter({ hasText: "Sarah Chen" }).first().locator("img")).toHaveCount(0)
})
