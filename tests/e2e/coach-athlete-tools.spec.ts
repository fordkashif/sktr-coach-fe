import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/** Coach notes, attendance and logging a session for an athlete, in mock mode. The demo coach has the Sprint Group (t1). */

async function asCoach(page: Page) {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
}

test.describe("coach tools for athletes (mock mode)", () => {
  test("private coach notes: add, edit, pin, delete, and the athlete side never holds them", async ({ page }) => {
    await asCoach(page)
    await page.goto("/coach/athletes/a2")
    const notes = page.locator("[data-coach-notes]")
    await expect(notes).toContainText("Only coaches and club admins can see these.")
    await expect(notes).toContainText("No notes yet")

    await notes.getByRole("button", { name: "Add note" }).click()
    await notes.getByRole("textbox", { name: "Note" }).fill("Secret note one about starts")
    await notes.getByRole("button", { name: "Save note" }).click()
    await expect(notes.locator("[data-coach-note]")).toHaveCount(1)
    await notes.getByRole("button", { name: "Add note" }).click()
    await notes.getByRole("textbox", { name: "Note" }).fill("Second note")
    await notes.getByLabel("Day").fill("2026-01-05")
    await notes.getByRole("button", { name: "Save note" }).click()
    await expect(notes.locator("[data-coach-note]")).toHaveCount(2)
    // Newest day first.
    await expect(notes.locator("[data-coach-note]").first()).toContainText("Secret note one")

    // Pinning the older note puts it on top.
    await notes.getByRole("button", { name: /^More for the note/ }).nth(1).click()
    await page.getByRole("menuitem", { name: "Pin to top" }).click()
    await expect(notes.locator("[data-coach-note]").first()).toContainText("Second note")
    await expect(notes.locator("[data-coach-note]").first()).toContainText("Pinned")

    await notes.getByRole("button", { name: /^More for the note/ }).first().click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    await notes.getByRole("textbox", { name: "Note" }).fill("Second note, changed")
    await notes.getByRole("button", { name: "Save changes" }).click()
    await expect(notes.locator("[data-coach-note]").first()).toContainText("Second note, changed")

    await page.reload()
    await expect(notes.locator("[data-coach-note]")).toHaveCount(2)
    await notes.getByRole("button", { name: /^More for the note/ }).nth(1).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await notes.getByRole("button", { name: "Delete note" }).click()
    await expect(notes.locator("[data-coach-note]")).toHaveCount(1)

    // Signed in as the athlete in the same browser: no athlete screen shows the note.
    await seedMockSession(page, { role: "athlete" })
    for (const path of ["/athlete/home", "/athlete/log", "/athlete/profile"]) {
      await page.goto(path)
      await expect(page.locator("#main-content")).not.toContainText("Second note")
      await expect(page.locator("#main-content")).not.toContainText("Coach notes")
    }
  })

  test("attendance: mark everyone, adjust, reasons, a past day, and it shows on the roster and the athlete", async ({ page }) => {
    await asCoach(page)
    // David is injured from today, so he starts as excused.
    await page.goto("/coach/athletes/a3")
    await page.getByRole("button", { name: "Set availability" }).first().click()
    await page.getByRole("button", { name: "Save availability" }).click()
    await expect(page.locator("[data-athlete-status]")).toContainText("Injured")

    await page.goto("/coach/dashboard")
    await page.getByRole("link", { name: "Take attendance" }).click()
    await expect(page).toHaveURL(/\/coach\/teams\/t1\/attendance$/)
    await expect(page.getByRole("heading", { level: 1, name: "Attendance" })).toBeVisible()
    const row = (id: string) => page.locator(`[data-attendance-row="${id}"]`)
    await expect(row("a3")).toContainText("Excused unless you change it")
    await expect(row("a3").getByRole("radio", { name: "Excused" })).toHaveAttribute("aria-checked", "true")
    await expect(row("a3")).toHaveAttribute("data-attendance-status", "none")

    await page.getByRole("button", { name: "Mark everyone present" }).click()
    await expect(row("a1")).toHaveAttribute("data-attendance-status", "present")
    await expect(row("a3")).toHaveAttribute("data-attendance-status", "excused")
    await expect(row("a3").getByLabel("Reason for David Okafor")).toHaveValue("Injured")
    await expect(page.getByRole("button", { name: "Mark everyone present" })).toHaveCount(0)

    await row("a2").getByRole("radio", { name: "Late" }).click()
    await row("a2").getByLabel("Reason for Sarah Chen").fill("Bus was late")
    await row("a2").getByLabel("Reason for Sarah Chen").blur()
    await row("a10").getByRole("radio", { name: "Absent" }).click()
    await expect(page.locator("[data-attendance-summary]")).toHaveText("Present 1, late 1, absent 1, excused 1.")

    // Saved as you go: a reload keeps it.
    await page.reload()
    await expect(row("a2")).toHaveAttribute("data-attendance-status", "late")
    await expect(row("a2").getByLabel("Reason for Sarah Chen")).toHaveValue("Bus was late")

    // A past day from the same screen.
    await page.getByRole("button", { name: "Day before" }).click()
    await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/)
    await expect(row("a2")).toHaveAttribute("data-attendance-status", "none")
    await row("a2").getByRole("radio", { name: "Present" }).click()
    await expect(row("a2")).toHaveAttribute("data-attendance-status", "present")

    // Roster: reachable from the team screen, with a count.
    await page.goto("/coach/teams/t1")
    await expect(page.getByRole("link", { name: "Take attendance" })).toBeVisible()
    await expect(page.locator('tr:has([data-athlete-row="a2"]) [data-attendance-count]')).toHaveText("2 of 2")
    await expect(page.locator('tr:has([data-athlete-row="a10"]) [data-attendance-count]')).toHaveText("0 of 1")

    // Athlete detail: rate and recent list.
    await page.goto("/coach/athletes/a10")
    const section = page.locator("[data-athlete-attendance]")
    await expect(section).toContainText("0%")
    await expect(section).toContainText("Absent")

    // The athlete sees their own mark and has nothing to change it with.
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    await expect(page.locator("[data-my-attendance]")).toContainText("Present")
    await expect(page.locator("[data-my-attendance] button, [data-my-attendance] input")).toHaveCount(0)
  })

  test("a coach logs a session for an athlete, sees what was logged, and the athlete sees who logged it", async ({ page }) => {
    await asCoach(page)
    await page.goto("/coach/athletes/a1")
    await page.getByRole("link", { name: "Log a session" }).click()
    await expect(page).toHaveURL(/\/coach\/athletes\/a1\/log$/)
    await expect(page.locator("[data-logging-for]")).toContainText("Logging for Marcus Johnson")
    await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()

    const squat = page.locator('[data-exercise="Back squat"]')
    await squat.getByRole("button", { name: "Same as target" }).click()
    await squat.getByLabel("Back squat, set 3, load in kilograms").fill("125")
    await squat.getByRole("button", { name: "Back squat, set 3, effort, not rated" }).click()
    await page.getByRole("radio", { name: /^9/ }).click()
    await squat.getByRole("button", { name: "Add note" }).click()
    await squat.getByLabel("Back squat, note").fill("Depth was good")
    await expect(page.locator('[data-coach-log-save="saved"]')).toBeVisible()
    await page.getByRole("button", { name: "Finish session for Marcus" }).click()
    await expect(page).toHaveURL(/\/coach\/athletes\/a1$/)

    // The coach's view of the logged session: sets, effort per set, the note, who entered it.
    const logged = page.locator("[data-session]").first()
    await expect(logged).toContainText("entered by a coach")
    await expect(logged).toContainText("5 x 125 kg")
    await expect(logged.locator("[data-set-efforts]")).toContainText("Effort by set: none, none, 9")
    await expect(logged.locator("[data-exercise-note]")).toContainText("Depth was good")

    // Dashboard: who did today's session.
    await page.goto("/coach/dashboard")
    const todays = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Today's session" }) })
    await expect(todays.locator("li", { hasText: "Done" })).toContainText("Marcus Johnson")
    await expect(todays).toContainText("Not yet")

    // An athlete other than the demo athlete, opened from the attendance row.
    await page.goto("/coach/teams/t1/attendance")
    await page.getByRole("link", { name: "Log the session for Sarah Chen" }).click()
    await expect(page.locator("[data-logging-for]")).toContainText("Logging for Sarah Chen")
    await page.locator('[data-exercise="Power clean"]').getByRole("button", { name: "Same as target" }).click()
    await expect(page.locator('[data-coach-log-save="saved"]')).toBeVisible()
    await page.getByRole("button", { name: "Finish session for Sarah" }).click()
    await expect(page).toHaveURL(/\/coach\/teams\/t1\/attendance$/)
    await expect(page.locator('[data-attendance-row="a2"]')).toContainText("Session logged")
    await page.goto("/coach/athletes/a2")
    await expect(page.locator("[data-session]").first()).toContainText("3 x 95 kg")

    // The athlete: "Logged by Coach ...", and they can still edit it.
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    await expect(page.locator("[data-logged-by]")).toContainText("Logged by Coach Andre Campbell")
    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Back squat, set 3, load in kilograms").fill("122.5")
    await expect(page.locator('[data-sync="saved"]').first()).toBeVisible()
    await page.getByRole("button", { name: "Save changes" }).click()
    await page.reload()
    await expect(page.locator("#main-content")).toContainText("122.5")
    await expect(page.locator("[data-logged-by]")).toContainText("Logged by Coach Andre Campbell")
  })
})
