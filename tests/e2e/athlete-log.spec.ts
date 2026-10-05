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

  test("shows what was done last time and repeats a set with one tap", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")

    // The demo athlete did this session a week ago (3 sets of 5 at 120kg).
    const squat = page.locator('[data-exercise="Back squat"]')
    await expect(squat).toContainText("Last time: 3 x 5 at 120kg")

    await squat.getByLabel("Back squat, set 1, reps").fill("4")
    await squat.getByLabel("Back squat, set 1, load in kilograms").fill("125")
    await squat.getByRole("button", { name: "Repeat set 1" }).click()
    await expect(squat.getByLabel("Back squat, set 2, reps")).toHaveValue("4")
    await expect(squat.getByLabel("Back squat, set 2, load in kilograms")).toHaveValue("125")
    await expect(squat.getByRole("button", { name: "Back squat, set 2, done" })).toHaveAttribute("aria-pressed", "true")

    // The log is a main tab: the tab bar stays, and the sticky bar sits above it.
    await page.setViewportSize({ width: 390, height: 844 })
    const tabBar = page.locator('[data-shell="tabbar"]')
    await expect(tabBar).toBeVisible()
    const bar = await page.locator("[data-sk-actionbar]").boundingBox()
    const tabs = await tabBar.boundingBox()
    expect(bar && tabs && bar.y + bar.height <= tabs.y + 1).toBeTruthy()
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

  test("skips a session with a reason, shows it in history, and undoes it", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()

    await page.getByRole("button", { name: /Can't do this one/ }).click()
    const dialog = page.getByRole("dialog", { name: "Can't do this one" })
    // A reason is required.
    await dialog.getByRole("button", { name: "Skip this session" }).click()
    await expect(dialog.getByText("Choose a reason.")).toBeVisible()
    await dialog.getByRole("radio", { name: "Sick" }).click()
    await dialog.getByLabel(/Note for your coach/).fill("Flu since last night")
    await dialog.getByRole("button", { name: "Skip this session" }).click()

    await expect(page.getByRole("heading", { name: "You skipped this one" })).toBeVisible()
    await expect(page.locator("#main-content")).toContainText("Skipped: sick")
    await expect(page.locator("#main-content")).toContainText("Flu since last night")
    // Nothing to log while it is skipped.
    await expect(page.getByRole("button", { name: "Finish session" })).toHaveCount(0)

    await page.goto("/athlete/log/history")
    await expect(page.getByRole("heading", { level: 1, name: "Session history" })).toBeVisible()
    await expect(page.locator('[data-history="Acceleration and weights"]').first()).toContainText("Skipped: sick")

    // The plan shows it as skipped, not missed.
    await page.goto("/athlete/training-plan")
    await expect(page.locator('[aria-current="date"]').first()).toContainText("Skipped")

    await page.goto("/athlete/log")
    await page.getByRole("button", { name: "Undo skip and log it" }).click()
    await expect(page.getByRole("button", { name: "Finish session" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "You skipped this one" })).toHaveCount(0)
  })

  test("marks the athlete unavailable, excuses sessions, and ends it with I'm back", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/training-plan")

    await page.getByRole("button", { name: /I can't train for a while/ }).click()
    const dialog = page.getByRole("dialog", { name: "I can't train for a while" })
    await dialog.getByRole("button", { name: "Mark me unavailable" }).click()
    await expect(dialog.getByText("Choose one.")).toBeVisible()
    await dialog.getByRole("radio", { name: "Injured" }).click()
    await dialog.getByLabel(/Note for your coach/).fill("Tight hamstring")
    await dialog.getByRole("button", { name: "Mark me unavailable" }).click()

    const notice = page.locator("#main-content").getByText(/You are marked as injured until further notice/)
    await expect(notice).toBeVisible()
    // Today's planned session is excused, not missed.
    await expect(page.locator('[aria-current="date"]').first()).toContainText("Excused")

    await page.goto("/athlete/home")
    await expect(page.locator("#main-content").getByText(/You are marked as injured/)).toBeVisible()

    await page.goto("/athlete/log")
    await expect(page.getByRole("heading", { name: "This session is excused" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Finish session" })).toHaveCount(0)
    await page.getByRole("button", { name: "Log anyway" }).click()
    await expect(page.getByRole("button", { name: "Finish session" })).toBeVisible()

    await page.getByRole("button", { name: "I'm back" }).click()
    await expect(page.locator("#main-content").getByText(/You are marked as injured/)).toHaveCount(0)
    await page.goto("/athlete/training-plan")
    await expect(page.locator('[aria-current="date"]').first()).toContainText("Today")
  })

  test("adds a session that was not planned and logs it", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    await page.getByRole("link", { name: /Add a session/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Add a session" })).toBeVisible()

    // Name and type are required.
    await page.getByRole("button", { name: "Start logging" }).click()
    await expect(page.getByText("Give the session a name.")).toBeVisible()
    await page.getByLabel("What was it").fill("Pool run")
    await page.getByRole("radio", { name: /^Run/ }).click()
    await page.getByRole("button", { name: "Start logging" }).click()

    await expect(page.getByRole("heading", { level: 1, name: "Pool run" })).toBeVisible()
    await expect(page.locator("#main-content")).toContainText("Added by you")

    await page.getByRole("button", { name: "Add exercise" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add an exercise" })
    await dialog.getByRole("textbox", { name: "Exercise" }).fill("200m reps")
    await dialog.getByRole("radio", { name: /^Time/ }).click()
    await dialog.getByRole("button", { name: "Add exercise" }).click()

    const reps = page.locator('[data-exercise="200m reps"]')
    await reps.getByLabel("200m reps, rep 1, time in seconds").fill("31.4")
    await reps.getByLabel("200m reps, rep 2, time in seconds").fill("31.9")
    await expect(page.locator('[data-sync="saved"]').first()).toBeVisible()
    await page.getByRole("radio", { name: "5, Moderate" }).click()
    await page.getByRole("button", { name: "Finish session" }).click()
    await expect(page.getByText("Nice work. That is logged.")).toBeVisible()
    await page.waitForURL(/\/athlete\/home/)

    // It is in the history, marked as added by the athlete, and the planned session is untouched.
    await page.goto("/athlete/log/history")
    const extra = page.locator('[data-history="Pool run"]')
    await expect(extra).toContainText("added by you")
    await expect(extra).toContainText("Done")
    await page.goto("/athlete/log")
    await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Finish session" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Also on this day" })).toBeVisible()

    // The coach sees it in the athlete's sessions, clearly marked.
    await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
    await page.goto("/coach/athletes/a1")
    await expect(page.locator("#main-content")).toContainText("Pool run")
    await expect(page.locator("#main-content")).toContainText("added by athlete")
  })
})

test.describe("athlete plan (mock mode)", () => {
  test("pages through weeks, opens a day, and keeps the tab bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/training-plan")

    await expect(page.getByRole("heading", { level: 1, name: "General performance block" })).toBeVisible()
    const main = page.locator("#main-content")
    await expect(main).toContainText("Week 2 of 4")
    // The plan is a main tab: the tab bar stays and there is no back button in the app bar.
    await expect(page.locator('[data-shell="tabbar"]')).toBeVisible()

    await page.getByRole("button", { name: "Previous week" }).click()
    await expect(main).toContainText("Week 1 of 4")
    await expect(main).toContainText("Missed")
    await expect(page.getByRole("button", { name: "Previous week" })).toBeDisabled()
    await page.getByRole("button", { name: "This week" }).click()
    await expect(main).toContainText("Week 2 of 4")

    // Today's session opens as its own screen with blocks, exercises, the coach note and the action.
    await page.locator('[aria-current="date"]').first().click()
    await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "From your coach" })).toBeVisible()
    await expect(main).toContainText("Back squat")
    await expect(main).toContainText("3 x 5 at 120kg")
    await expect(page.locator('[data-shell="tabbar"]')).toBeVisible()
    await expect(page.getByRole("link", { name: "Start session" })).toHaveAttribute("href", "/athlete/log")

    await page.getByRole("link", { name: "General performance block" }).click()
    await expect(main).toContainText("Week 2 of 4")
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(sideways).toBeLessThanOrEqual(0)
  })
})
