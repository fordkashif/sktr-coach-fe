import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test.describe("athlete history, test comparison and goals (mock mode)", () => {
  test("past sessions are listed by week, can be filtered and open their log", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/athlete/trends")
    await page.getByRole("link", { name: "Session history" }).click()
    await expect(page).toHaveURL(/\/athlete\/history$/)
    await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible()
    await expect(page.locator("nav[data-shell='tabbar']").getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page")

    const rows = page.locator("[data-outcome]")
    await expect(rows.first()).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "Last week" })).toBeVisible()
    const all = await rows.count()
    const done = await page.locator('[data-outcome="done"]').count()
    expect(done).toBeGreaterThan(0)
    await expect(page.locator('[data-outcome="done"]').first()).toContainText(/Effort \d+ of 10/)
    await expect(page.locator('[data-outcome="done"]').first()).toContainText(/\d+ exercises?, \d+ sets?:/)

    const show = page.getByRole("radiogroup", { name: "Show" })
    await show.getByRole("radio", { name: /Done/ }).click()
    await expect(rows).toHaveCount(done)
    await show.getByRole("radio", { name: /Missed/ }).click()
    for (const text of await rows.allTextContents()) expect(text).toContain("Missed")
    await show.getByRole("radio", { name: /All/ }).click()
    await expect(rows).toHaveCount(all)

    // Nothing scrolls sideways on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    await page.getByRole("button", { name: "Show earlier sessions" }).click()
    await expect(page.getByRole("button", { name: "Show earlier sessions" }).or(page.getByText(/That is everything/))).toBeVisible()

    await page.locator('[data-outcome="done"]').first().click()
    await expect(page).toHaveURL(/\/athlete\/log\?date=\d{4}-\d{2}-\d{2}/)
  })

  test("test week history compares each test with last time and the best ever", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/test-week")
    await page.getByRole("link", { name: "History and comparison" }).click()
    await expect(page).toHaveURL(/\/athlete\/test-week\/history/)

    const numbers = page.getByLabel("30m in numbers")
    await expect(numbers).toContainText("4.05s")
    await expect(numbers).toContainText("0.05s faster")
    await expect(numbers).toContainText("Better")
    await expect(page.getByRole("img", { name: /30m over 2 test weeks, from 4.10s/ }).or(page.getByLabel(/30m over 2 test weeks, from 4.10s/)).first()).toBeAttached()

    // CMJ got worse: higher is better for a jump, and the best ever is the older week.
    await page.getByLabel("Test", { exact: true }).selectOption({ label: "CMJ" })
    const cmj = page.getByLabel("CMJ in numbers")
    await expect(cmj).toContainText("2cm lower")
    await expect(cmj).toContainText("Worse")
    await expect(cmj).toContainText("Autumn test week")

    const spring = page.getByRole("table", { name: "Your results in Spring test week" })
    await expect(spring.getByRole("row", { name: /Flying 30m/ })).toContainText("This one")
    await expect(spring.getByRole("row", { name: /CMJ/ })).toContainText("72cm")
  })

  test("an event on the records screen shows its results over time and its goal", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/prs")
    await page.getByRole("link", { name: /^100m/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "100m" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: "Progression" })).toBeVisible()
    const table = page.getByRole("table", { name: "Every 100m result, newest first" })
    await expect(table.getByRole("row")).toHaveCount(9)
    await expect(table).toContainText("Personal best")
    await expect(table).toContainText("Season best")
    await expect(table).toContainText("Wind assisted")
    await expect(table).toContainText("Competition")
    await expect(page.locator('[data-goal="100m"]')).toContainText("On track")
  })

  test("an athlete sets a goal, sees progress, and a later result achieves it", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/athlete/trends")
    await page.getByRole("navigation", { name: "Progress sections" }).getByRole("link", { name: "Goals" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible()

    // The demo: one on track, one past its date (set by the coach), one achieved by a result.
    await expect(page.locator('[data-goal="100m"]')).toContainText("On track")
    await expect(page.locator('[data-goal="100m"]')).toContainText("Now 11.28s, 0.18s to go. 37% of the way from 11.39s.")
    await expect(page.locator('[data-goal="Squat 1RM"]')).toContainText("Past the date")
    await expect(page.locator('[data-goal="Squat 1RM"]')).toContainText("Set by your coach.")
    await expect(page.locator('[data-goal="Long jump"]')).toContainText("Achieved")

    // A target already reached is refused (lower is better for a time).
    await page.getByRole("button", { name: "Set a goal" }).click()
    const dialog = page.getByRole("dialog", { name: "Set a goal" })
    await dialog.getByLabel("Event").selectOption({ label: "200m" })
    await expect(dialog).toContainText("Your best is 22.96s. Lower is better.")
    await dialog.getByLabel(/^Target/).fill("23.10")
    await dialog.getByRole("button", { name: "Set goal" }).click()
    await expect(dialog).toContainText("This mark is already reached")
    await dialog.getByLabel(/^Target/).fill("22.50")
    await dialog.getByLabel(/^Note/).fill("For nationals")
    await dialog.getByRole("button", { name: "Set goal" }).click()
    await expect(dialog).toBeHidden()

    const goal = page.locator('[data-goal="200m"]')
    await expect(goal).toContainText("On track")
    await expect(goal).toContainText("Now 22.96s, 0.46s to go. 0% of the way from 22.96s.")
    await expect(goal).toContainText("Note: For nationals")

    // Change the target.
    await page.getByRole("button", { name: /More for the goal 200m/ }).click()
    await page.getByRole("menuitem", { name: "Change goal" }).click()
    const change = page.getByRole("dialog", { name: "Change goal" })
    await change.getByLabel(/^Target/).fill("22.80")
    await change.getByRole("button", { name: "Save goal" }).click()
    await expect(goal).toContainText("200m 22.80s")

    // A slower result leaves it open; a faster legal one achieves it.
    await page.goto("/athlete/prs/add?event=200m")
    await page.getByRole("textbox", { name: "Time" }).fill("22.75")
    await page.getByLabel(/^Wind/).fill("+0.5")
    await page.getByRole("button", { name: "Save result" }).click()
    await expect(page).toHaveURL(/\/athlete\/prs\/event\//)
    await page.goto("/athlete/goals")
    await expect(page.getByRole("list", { name: "Goals you have achieved" }).locator('[data-goal="200m"]')).toContainText("Reached on")

    // Mark by hand, open again, remove.
    await page.getByRole("button", { name: /More for the goal 100m/ }).click()
    await page.getByRole("menuitem", { name: "Mark achieved" }).click()
    await expect(page.locator('[data-goal="100m"]')).toContainText("Marked achieved on")
    await page.getByRole("button", { name: /More for the goal 100m/ }).click()
    await page.getByRole("menuitem", { name: "Open it again" }).click()
    await expect(page.locator('[data-goal="100m"]')).toContainText("On track")
    await page.getByRole("button", { name: /More for the goal 100m/ }).click()
    await page.getByRole("menuitem", { name: "Remove goal" }).click()
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Remove goal" }).click()
    await expect(page.locator('[data-goal="100m"]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test("a coach sees the athlete's goals and sets one", async ({ page }) => {
    await seedMockSession(page, { role: "coach" })
    await page.goto("/coach/athletes/a1?tab=results")
    await expect(page.getByRole("heading", { level: 2, name: "Goals" })).toBeVisible()
    await expect(page.locator('[data-goal="100m"]')).toContainText("Set by the athlete.")
    await page.getByRole("button", { name: "Set a goal" }).click()
    const dialog = page.getByRole("dialog", { name: "Set a goal" })
    await dialog.getByLabel("Event").selectOption({ label: "400m" })
    await dialog.getByLabel(/^Target/).fill("49.90")
    await dialog.getByRole("button", { name: "Set goal" }).click()
    await expect(page.locator('[data-goal="400m"]')).toContainText("Set by a coach.")
    await expect(page.locator('[data-goal="400m"]')).toContainText("No result in this event yet")
  })
})
