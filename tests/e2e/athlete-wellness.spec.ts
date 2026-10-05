import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

async function answerCheckIn(page: import("@playwright/test").Page) {
  await page.getByRole("radio", { name: /^Soreness 2 of 5/ }).click()
  await page.getByRole("radio", { name: /^Fatigue 2 of 5/ }).click()
  await page.getByRole("radio", { name: /^Mood 4 of 5/ }).click()
  await page.getByRole("radio", { name: /^Stress 2 of 5/ }).click()
}

test("check-in asks for every answer, shows readiness and can be updated", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/wellness")

  await page.getByRole("button", { name: "Submit check-in" }).click()
  await expect(page.getByRole("alert")).toContainText("Still to answer: soreness, fatigue, mood, stress.")

  await answerCheckIn(page)
  await page.getByRole("button", { name: "Submit check-in" }).click()
  await expect(page.getByRole("heading", { name: "Today's readiness" })).toBeVisible()
  await expect(page.locator("main")).toContainText("You are ready to train")

  await page.getByRole("button", { name: "Update today's check-in" }).click()
  await page.getByRole("radio", { name: /^Soreness 5 of 5/ }).click()
  await page.getByRole("radio", { name: /^Fatigue 5 of 5/ }).click()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.locator("main")).not.toContainText("You are ready to train")

  await page.reload()
  await expect(page.getByRole("heading", { name: "Today's readiness" })).toBeVisible()
  await page.getByRole("link", { name: /Wellness history/ }).click()
  await expect(page).toHaveURL(/\/athlete\/wellness\/history$/)
  await expect(page.getByRole("img", { name: /Readiness over the last 4 weeks: 1 check-ins/ })).toBeVisible()
  await expect(page.getByRole("table")).toContainText("Today")
})

test("athlete reports pain from the check-in, sees it open, marks themselves unavailable and resolves it", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/wellness")

  await answerCheckIn(page)
  await page.getByRole("radio", { name: "Yes", exact: true }).click()
  await page.getByRole("button", { name: "Submit and report pain" }).click()

  await expect(page).toHaveURL(/\/athlete\/wellness\/pain$/)
  await expect(page.getByRole("heading", { level: 1, name: "Report pain or an injury" })).toBeVisible()
  // The form says who will see the report.
  await expect(page.locator("main")).toContainText("Only you, the coaches of your team and your club's admins can see this report. Other athletes cannot.")

  await page.getByRole("button", { name: "Send report" }).click()
  await expect(page.getByText("Pick at least one area.")).toBeVisible()
  await expect(page.getByText("Say whether it stops you training.")).toBeVisible()

  await page.getByRole("checkbox", { name: "Left hamstring" }).click()
  await page.getByRole("tab", { name: /Back and trunk/ }).click()
  await page.getByRole("checkbox", { name: "Lower back" }).click()
  await expect(page.locator("main")).toContainText("Picked: Left hamstring, lower back")
  await page.getByRole("radio", { name: /^Pain 3 of 5/ }).click()
  await page.getByRole("radio", { name: /^Yes/ }).click()
  await page.getByLabel("Anything else your coach should know?").fill("Pulled on the last rep.")
  await page.getByRole("button", { name: "Send report" }).click()

  await expect(page).toHaveURL(/\/athlete\/wellness$/)
  const open = page.getByRole("list", { name: "Open pain reports" })
  await expect(open).toContainText("Left hamstring, lower back")
  await expect(open).toContainText("Cannot train")

  await page.getByRole("button", { name: "Mark me unavailable" }).click()
  await expect(page.locator("main")).toContainText("you are marked unavailable from today")

  // Still there after a reload, and in the history.
  await page.reload()
  await expect(page.getByRole("list", { name: "Open pain reports" })).toContainText("Left hamstring, lower back")
  await page.goto("/athlete/wellness/history")
  const reports = page.locator("section", { has: page.getByRole("heading", { name: "Pain and injury reports" }) })
  await expect(reports).toContainText("Open")
  await expect(reports).toContainText("Pulled on the last rep.")

  await page.goto("/athlete/wellness")
  await page.getByRole("button", { name: "Mark resolved" }).click()
  await expect(page.getByRole("list", { name: "Open pain reports" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: /Report pain or an injury/ })).toBeVisible()
  await page.goto("/athlete/wellness/history")
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Pain and injury reports" }) })).toContainText("Resolved")
})

test("a pain report can be sent on its own and a report that does not affect training offers no unavailable step", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/wellness/pain")
  await page.getByRole("tab", { name: /Lower legs/ }).click()
  await page.getByRole("checkbox", { name: "Right ankle" }).click()
  await page.getByRole("radio", { name: /^Pain 1 of 5/ }).click()
  await page.getByRole("radio", { name: /^No/ }).click()
  await page.getByRole("button", { name: "Send report" }).click()

  await expect(page).toHaveURL(/\/athlete\/wellness$/)
  await expect(page.locator("main")).toContainText("Report saved. Your coaches can see it.")
  await expect(page.getByRole("button", { name: "Mark me unavailable" })).toHaveCount(0)
  await expect(page.getByRole("list", { name: "Open pain reports" })).toContainText("Right ankle")
})
