import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Demo data: the coach is on Sprint Group ("t1": David Okafor 400m, Marcus Johnson 100m, Sarah Chen
// 200m, Sophia Kim 100m hurdles). Marcus is the demo athlete and has a 100m history with a personal
// best of 11.28. Competitions and results are kept in the browser in mock mode.

const main = (page: Page) => page.locator("#main-content")

function day(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

async function asCoach(page: Page) {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
}

async function addMeet(page: Page, name: string, offset: number) {
  await page.goto("/coach/competitions")
  await page.getByRole("link", { name: "Add competition" }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: "Add competition" })).toBeVisible()
  await page.getByLabel("Name").fill(name)
  await page.getByLabel("Date", { exact: true }).fill(day(offset))
  await page.getByLabel("Venue").fill("National Stadium")
  await page.getByRole("button", { name: "Add competition" }).click()
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
}

test("a coach adds a meet, enters two athletes, records results and sees the personal best", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await asCoach(page)

  // The calendar is the selected team's: upcoming and past, one main action.
  await page.goto("/coach/competitions")
  await expect(page.getByRole("heading", { level: 1, name: "Competitions" })).toBeVisible()
  await expect(main(page).getByRole("heading", { level: 2, name: "Coming up" })).toBeVisible()
  await expect(main(page)).toContainText("City Sprint Classic")
  await expect(main(page).locator(".sk-btn-primary")).toHaveCount(1)

  await addMeet(page, "Twilight Sprint Meet", -2)
  await expect(main(page)).toContainText("Competition added. Now enter your athletes.")

  // Enter two athletes in one go. Each starts on their primary event.
  await main(page).getByRole("link", { name: "Enter athletes" }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: "Enter athletes" })).toBeVisible()
  await page.getByRole("checkbox", { name: /Marcus Johnson/ }).check()
  await page.getByRole("checkbox", { name: /Sarah Chen/ }).check()
  await expect(page.getByRole("combobox", { name: "Event 1 for Marcus Johnson" })).toHaveValue("100m")
  await expect(page.getByRole("combobox", { name: "Event 1 for Sarah Chen" })).toHaveValue("200m")
  await page.getByRole("button", { name: "Add another event for Sarah Chen" }).click()
  await page.getByRole("combobox", { name: "Event 2 for Sarah Chen" }).selectOption("100m")
  await expect(main(page)).toContainText("2 athletes, 3 events")
  await page.getByRole("button", { name: "Enter 2 athletes" }).click()

  await expect(page.getByRole("heading", { level: 1, name: "Twilight Sprint Meet" })).toBeVisible()
  await expect(main(page)).toContainText("2 athletes entered in 3 events.")

  // The meet has happened, so the screen opens on the results grid. Type across with Tab.
  const cell = (name: string) => page.getByRole("textbox", { name })
  await cell("Marcus Johnson, 100m, Mark").click()
  await page.keyboard.type("11.20")
  await page.keyboard.press("Tab")
  await page.keyboard.type("+1.0")
  await page.keyboard.press("Tab")
  await page.keyboard.type("1")
  await page.keyboard.press("Tab")

  // The personal best is called out as it is saved, and the row keeps saying so.
  await expect(main(page).locator("[data-result-callout]")).toContainText("Personal best for Marcus Johnson in the 100m: 11.20s (+1.0), 0.08s faster than 11.28s.")
  const marcusRow = main(page).getByRole("row", { name: /Marcus Johnson/ })
  await expect(marcusRow).toContainText("Personal best")
  await expect(cell("Marcus Johnson, 100m, Wind")).toHaveValue("+1.0")
  await expect(cell("Marcus Johnson, 100m, Place")).toHaveValue("1")

  // Enter moves down the column. A mark that is not a time is refused where it was typed.
  await cell("Sarah Chen, 100m, Mark").click()
  await page.keyboard.type("12.1x")
  await page.keyboard.press("Enter")
  await expect(cell("Sarah Chen, 200m, Mark")).toBeFocused()
  await expect(cell("Sarah Chen, 100m, Mark")).toHaveAttribute("aria-invalid", "true")
  await cell("Sarah Chen, 100m, Mark").fill("12.10")
  await cell("Sarah Chen, 100m, Wind").fill("+2.6")
  await cell("Sarah Chen, 200m, Mark").fill("24.31")
  await cell("Sarah Chen, 200m, Place").fill("2")
  await cell("Marcus Johnson, 100m, Mark").focus()
  await expect(main(page)).toContainText("All results saved")
  // Wind over +2.0 is kept and marked, and is not a best.
  await expect(main(page).getByRole("row", { name: /Sarah Chen 100m/ })).toContainText("Wind assisted")
  await expect(main(page)).toContainText("3 of 3 in")

  // The results sheet downloads as a CSV.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export results (CSV)" }).click()])
  expect(download.suggestedFilename()).toMatch(/^twilight-sprint-meet-.*-results\.csv$/)

  // The entries view lists every entry with its result, and lets the coach scratch one.
  await page.getByRole("tab", { name: "Entries" }).click()
  const entries = main(page).getByRole("table", { name: "Entries for Twilight Sprint Meet" })
  await expect(entries.getByRole("row", { name: /Marcus Johnson/ })).toContainText("11.20")
  await expect(entries.getByRole("row", { name: /Marcus Johnson/ })).toContainText("Personal best")
  await page.getByRole("button", { name: "More for Sarah Chen, 200m" }).click()
  await page.getByRole("menuitem", { name: "Scratch from this event" }).click()
  await expect(entries.getByRole("row", { name: /Sarah Chen.*200m/ })).toContainText("Scratched")
  await expect(main(page)).toContainText("Sarah Chen is scratched from the 200m.")

  // The calendar counts it.
  await page.goto("/coach/competitions")
  await expect(main(page).getByRole("link", { name: /Twilight Sprint Meet/ })).toContainText("2 of 2 results in")

  // The athlete sees the coach's entry and result on their own side, and it is their personal best.
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/competitions")
  await main(page).getByRole("link", { name: /Twilight Sprint Meet/ }).click()
  await expect(main(page)).toContainText("11.20")
  await expect(main(page)).toContainText("Personal best")
})

test("a meet an athlete added for themselves shows on their coach's calendar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/competitions/new")
  await page.getByLabel("Name").fill("Parish Open")
  await page.getByLabel("Date", { exact: true }).fill(day(-1))
  await page.getByRole("button", { name: "Add competition" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Parish Open" })).toBeVisible()
  await page.getByRole("button", { name: "Add an event" }).click()
  await page.getByRole("dialog").getByLabel("Event").selectOption("200m")
  await page.getByRole("dialog").getByRole("button", { name: "Add event" }).click()
  await expect(main(page)).toContainText("You are entered in the 200m.")

  await asCoach(page)
  await page.goto("/coach/competitions")
  const row = main(page).getByRole("link", { name: /Parish Open/ })
  await expect(row).toContainText("Added by Marcus Johnson")
  await row.click()
  // The coach cannot change the athlete's own meet, but can record the result.
  await expect(page.getByRole("heading", { level: 1, name: "Parish Open" })).toBeVisible()
  await expect(main(page).getByRole("link", { name: "Edit" })).toHaveCount(0)
  await page.getByRole("textbox", { name: "Marcus Johnson, 200m, Mark" }).fill("22.80")
  await page.getByRole("textbox", { name: "Marcus Johnson, 200m, Place" }).focus()
  await expect(main(page).locator("[data-result-callout]")).toContainText("Personal best for Marcus Johnson in the 200m: 22.80s")
  // On a phone the grid scrolls inside its own frame; the page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("entering an athlete who is unavailable on the day warns and does not block", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await asCoach(page)
  // Sarah Chen is marked injured until further notice (the availability demo store).
  await page.addInitScript((today) => {
    window.localStorage.setItem(
      "pacelab:athlete-availability:v1:elite-track-club",
      JSON.stringify([{ id: "availability-e2e", athleteId: "a2", kind: "injured", startsOn: today, endsOn: null, note: null, createdByRole: "athlete", endedAt: null }]),
    )
  }, day(0))

  await page.goto("/coach/competitions/mock-comp-classic/enter")
  await expect(page.getByRole("heading", { level: 1, name: "Enter athletes" })).toBeVisible()
  const sarah = page.getByRole("checkbox", { name: /Sarah Chen/ })
  await expect(main(page).locator("li", { has: sarah })).toContainText("Injured until further notice")
  await expect(main(page).locator("li", { has: page.getByRole("checkbox", { name: /David Okafor/ }) })).toContainText("Available")
  // Marcus is already in the 100m and 200m: his row says so and those events cannot be picked twice.
  await expect(main(page).locator("li", { has: page.getByRole("checkbox", { name: /Marcus Johnson/ }) })).toContainText("Already in: 100m, 200m")

  await sarah.check()
  await expect(main(page)).toContainText("Sarah Chen is marked injured until further notice. You can still enter them.")
  await page.getByRole("button", { name: "Enter athlete" }).click()

  await expect(page.getByRole("heading", { level: 1, name: "City Sprint Classic" })).toBeVisible()
  const entries = main(page).getByRole("table", { name: "Entries for City Sprint Classic" })
  const row = entries.getByRole("row", { name: /Sarah Chen/ })
  await expect(row).toContainText("200m")
  await expect(row).toContainText("Entered")
  await expect(row).toContainText("Injured until further notice")
  // Before the meet there is no results grid.
  await expect(main(page).getByRole("tab", { name: "Results" })).toHaveCount(0)
})
