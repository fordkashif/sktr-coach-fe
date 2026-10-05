import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test.describe("athlete session log (mock mode)", () => {
  test("logs results, finishes, and still shows them after a reload", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")

    // Mock mode always has a session planned for today.
    await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()

    const sprints = page.locator('[data-exercise="30m from blocks"]')
    await sprints.getByLabel("30m from blocks, rep 1, time in seconds").fill("4.21")
    await sprints.getByLabel("30m from blocks, rep 2, time in seconds").fill("4.18")

    const squat = page.locator('[data-exercise="Back squat"]')
    await squat.getByLabel("Back squat, set 1, reps").fill("5")
    await squat.getByLabel("Back squat, set 1, load in kilograms").fill("122.5")
    // Ticking an empty set fills it from the coach target (5 at 120kg).
    await squat.getByRole("button", { name: "Back squat, set 2, mark as done" }).click()
    await expect(squat.getByLabel("Back squat, set 2, load in kilograms")).toHaveValue("120")

    await page.locator('[data-exercise="Power clean"]').getByRole("button", { name: "Same as target" }).click()
    await expect(page.locator('[data-exercise="Power clean"]').getByLabel("Power clean, set 4, load in kilograms")).toHaveValue("95")

    await expect(page.locator('[data-sync="saved"]').first()).toBeVisible()

    await page.getByRole("radio", { name: "7, Hard" }).click()
    await page.getByLabel(/Anything your coach should know/).fill("Starts felt sharp.")
    await page.getByRole("button", { name: "Finish session" }).click()

    await expect(page.getByText("Nice work. That is logged.")).toBeVisible()
    // The existing behaviour: finishing takes the athlete back to home.
    await page.waitForURL(/\/athlete\/home/)

    await page.goto("/athlete/log")
    await expect(page.getByRole("heading", { name: "What you logged" })).toBeVisible()
    await expect(page.locator('[data-logged="30m from blocks"]')).toContainText("4.21 s, 4.18 s")
    await expect(page.locator('[data-logged="Back squat"]')).toContainText("5 x 122.5 kg, 5 x 120 kg")
    await expect(page.locator('[data-logged="Power clean"]')).toContainText("3 x 95 kg")
    await expect(page.getByText("Starts felt sharp.")).toBeVisible()
    await expect(page.getByText("Hard", { exact: true })).toBeVisible()

    // A finished session can still be edited, and the values come back in the form.
    await page.getByRole("button", { name: "Edit" }).click()
    await expect(page.getByLabel("Back squat, set 1, load in kilograms")).toHaveValue("122.5")
    await expect(page.getByRole("radio", { name: "7, Hard" })).toHaveAttribute("aria-checked", "true")
  })

  test("a rest day points at the next planned session", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const iso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`
    await page.goto(`/athlete/log?date=${iso}`)

    await expect(page.getByRole("heading", { level: 1, name: "Rest day" })).toBeVisible()
    await page.getByRole("button", { name: /See that session/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()
  })
})
