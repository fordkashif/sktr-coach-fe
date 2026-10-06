import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { seedMockSession } from "./helpers/session"

// Mock mode. The calendar's demo data is dated from today, so every run has a session today,
// a club meeting in three days and a team camp in ten.

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 900 }

function localDay(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

/** The meeting is three days out: move to next month when that crosses the month end. */
async function showMonthOf(page: Page, day: string) {
  if (day.slice(0, 7) !== localDay().slice(0, 7)) await page.getByRole("button", { name: "Next month" }).click()
}

test("coach: the calendar is a tab of Plans, opens as an agenda on a phone and lists the team's dated things", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize(PHONE)
  await page.goto("/coach/training-plan")
  await page.getByRole("navigation", { name: "Plans" }).getByRole("link", { name: "Calendar" }).click()
  await expect(page).toHaveURL(/\/coach\/training-plan\/calendar/)
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Agenda" })).toHaveAttribute("aria-selected", "true")
  const agenda = page.getByRole("list", { name: /Sprint Group calendar/ })
  await expect(agenda.locator('[data-kind="session"]').first()).toBeVisible()
  await expect(agenda.locator('[data-kind="test-week"]').first()).toContainText("Speed and power testing")
  await noSidewaysScroll(page)

  await showMonthOf(page, localDay(3))
  await expect(page.locator('[data-kind="event"]', { hasText: "Parents' meeting" })).toBeVisible()
  // An event of another team is not on this team's calendar.
  await expect(page.getByText("Throws clinic")).toHaveCount(0)
})

test("coach: the month grid works at 390px with a day sheet, and a session goes to the plan", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize(PHONE)
  await page.goto("/coach/training-plan/calendar?show=month")
  const grid = page.getByRole("grid", { name: /Sprint Group calendar/ })
  await expect(grid).toBeVisible()
  await expect(grid.getByRole("gridcell")).toHaveCount(await grid.getByRole("row").count().then((rows) => (rows - 1) * 7))
  await noSidewaysScroll(page)
  const today = grid.locator(`[data-date="${localDay()}"]`)
  await expect(today).toHaveAttribute("aria-current", "date")
  expect((await today.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await today.click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByRole("list", { name: "On this day" }).locator('[data-kind="session"]')).toHaveCount(1)
  await sheet.locator('[data-kind="session"] a').click()
  await expect(page).toHaveURL(/\/coach\/training-plan(\?|$)/)
})

test("coach: athletes unavailable show as a count, names only after opening, never the reason", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.addInitScript(
    ({ from, to }) => {
      window.localStorage.setItem(
        "pacelab:athlete-availability:v1:elite-track-club",
        JSON.stringify([{ id: "av1", athleteId: "a3", kind: "injured", startsOn: from, endsOn: to, note: "hamstring strain", createdByRole: "coach", endedAt: null }]),
      )
    },
    { from: localDay(0), to: localDay(1) },
  )
  await page.setViewportSize(DESKTOP)
  await page.goto("/coach/training-plan/calendar?show=agenda")
  const row = page.locator('[data-kind="unavailable"]').first()
  await expect(row).toContainText("1 athlete unavailable")
  await expect(page.getByText("David Okafor")).toHaveCount(0)
  await expect(page.getByText(/hamstring/i)).toHaveCount(0)
  await row.getByRole("button").click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByText("David Okafor")).toBeVisible()
  await expect(sheet.getByText(/hamstring/i)).toHaveCount(0)
  await sheet.getByRole("link", { name: /Open attendance/ }).click()
  await expect(page).toHaveURL(new RegExp(`/coach/teams/t1/attendance\\?date=${localDay()}`))
})

test("coach: adds an event for their own team only, then deletes it", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize(DESKTOP)
  await page.goto("/coach/training-plan/calendar?show=agenda")
  await page.getByRole("button", { name: "Add event" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Only a club admin can add an event for the whole club.")).toBeVisible()
  await expect(dialog.getByRole("radio", { name: "The whole club" })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Add event" }).click()
  await expect(dialog.getByRole("alert")).toContainText("Give the event a title")
  await dialog.getByLabel("Title").fill("Relay practice")
  await dialog.getByLabel("Place").fill("Track 2")
  await dialog.getByRole("button", { name: "Add event" }).click()
  await expect(dialog).toHaveCount(0)
  const row = page.locator('[data-kind="event"]', { hasText: "Relay practice" })
  await expect(row).toContainText("Track 2")
  await row.getByRole("button", { name: /Relay practice/ }).first().click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByText("Sprint Group")).toBeVisible()
  await sheet.getByRole("button", { name: "Delete" }).click()
  await sheet.getByRole("button", { name: "Delete event" }).click()
  await expect(page.locator('[data-kind="event"]', { hasText: "Relay practice" })).toHaveCount(0)

  // A whole club event can be read but not changed by a coach.
  await showMonthOf(page, localDay(3))
  await page.locator('[data-kind="event"]', { hasText: "Parents' meeting" }).getByRole("button").first().click()
  await expect(page.getByRole("dialog").getByRole("button", { name: "Add to my calendar" })).toBeVisible()
  await expect(page.getByRole("dialog").getByRole("button", { name: "Edit" })).toHaveCount(0)
  await expect(page.getByRole("dialog").getByRole("button", { name: "Delete" })).toHaveCount(0)
})

test("add to calendar downloads a correct .ics for a club event and a test week", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize(DESKTOP)
  await page.goto("/coach/training-plan/calendar?show=agenda")

  const weekRow = page.locator('[data-kind="test-week"]', { hasText: "Speed and power testing" })
  await weekRow.getByRole("button", { name: "More for Speed and power testing" }).click()
  const weekDownload = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "Add to my calendar" }).click()
  const weekFile = await weekDownload
  expect(weekFile.suggestedFilename()).toBe("speed-and-power-testing.ics")
  const weekIcs = await readFile((await weekFile.path())!, "utf8")
  expect(weekIcs).toContain("BEGIN:VCALENDAR\r\n")
  expect(weekIcs).toContain("SUMMARY:Test week: Speed and power testing\r\n")
  expect(weekIcs).toContain(`DTSTART;VALUE=DATE:${localDay(-1).replace(/-/g, "")}\r\n`)
  // The week ends tomorrow, so the all day end is the day after.
  expect(weekIcs).toContain(`DTEND;VALUE=DATE:${localDay(2).replace(/-/g, "")}\r\n`)
  expect(weekIcs).toContain("UID:test-week-fallback-week@sktr-coach\r\n")

  await showMonthOf(page, localDay(3))
  await page.locator('[data-kind="event"]', { hasText: "Parents' meeting" }).getByRole("button").first().click()
  const eventDownload = page.waitForEvent("download")
  await page.getByRole("dialog").getByRole("button", { name: "Add to my calendar" }).click()
  const eventFile = await eventDownload
  expect(eventFile.suggestedFilename()).toBe("parents-meeting.ics")
  const eventIcs = await readFile((await eventFile.path())!, "utf8")
  // 6:00 pm in Jamaica (the default club time zone, UTC-5) is 23:00 UTC.
  expect(eventIcs).toContain(`DTSTART:${localDay(3).replace(/-/g, "")}T230000Z\r\n`)
  expect(eventIcs).toContain("UID:event-mock-event-parents@sktr-coach\r\n")
  expect(eventIcs).toContain("LOCATION:Club house\r\n")
  expect(eventIcs).not.toMatch(/[^\r]\n/)
})

test("the calendar link: turn on shows a sample link with an explanation, then new link and turn off", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.setViewportSize(PHONE)
  await page.goto("/coach/training-plan/calendar")
  const section = page.locator("#calendar-link")
  await expect(section.getByText(/no athlete names/)).toBeVisible()
  await section.getByRole("button", { name: "Turn on my calendar link" }).click()
  await expect(section.getByText("Your calendar link is on", { exact: false })).toBeVisible()
  await expect(section.getByText(/This is a sample link/)).toBeVisible()
  await expect(section.getByLabel("Your private link")).toHaveValue(/calendar-feed\/.+\.ics$/)
  await noSidewaysScroll(page)

  // After a reload the link itself is not shown again.
  await page.reload()
  await expect(section.getByText("Your calendar link is on", { exact: false })).toBeVisible()
  await expect(section.getByLabel("Your private link")).toHaveCount(0)
  await section.getByRole("button", { name: "Make a new link" }).click()
  await expect(section.getByText(/The old link stops working/)).toBeVisible()
  await section.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Make a new link" }).click()
  await expect(section.getByLabel("Your private link")).toBeVisible()
  await section.getByRole("button", { name: "Turn off" }).click()
  await section.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Turn off" }).click()
  await expect(section.getByRole("button", { name: "Turn on my calendar link" })).toBeVisible()
})

test("athlete: the Plan screen switches between week, agenda and month, with no new tab bar item", async ({ page }) => {
  await seedMockSession(page, { role: "athlete" })
  await page.setViewportSize(PHONE)
  await page.goto("/athlete/training-plan")
  await expect(page.getByRole("navigation").getByRole("link", { name: /Calendar/ })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("tab", { name: "Month" }).click()
  await expect(page).toHaveURL(/view=month/)
  await expect(page.getByRole("heading", { level: 1, name: "Your calendar" })).toBeVisible()
  const grid = page.getByRole("grid", { name: /Your calendar/ })
  await expect(grid).toBeVisible()
  await noSidewaysScroll(page)
  await grid.locator(`[data-date="${localDay()}"]`).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.locator('[data-kind="session"]')).toContainText("Today")
  // Athletes read events; they cannot add them.
  await expect(sheet.getByRole("button", { name: /Add event/ })).toHaveCount(0)
  await sheet.locator('[data-kind="session"] a').click()
  await expect(page).toHaveURL(new RegExp(`/athlete/training-plan\\?day=${localDay()}`))

  await page.goto("/athlete/training-plan?view=agenda")
  const agenda = page.getByRole("list", { name: /Your calendar/ })
  await expect(agenda.locator('[data-kind="session"]').first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Add event" })).toHaveCount(0)
  await expect(page.locator('[data-kind="unavailable"]')).toHaveCount(0)
  await expect(page.locator("#calendar-link").getByText(/Nothing about injuries/)).toBeVisible()
  await page.getByRole("tab", { name: "Week" }).click()
  await expect(page).not.toHaveURL(/view=/)
})

test("club admin: the club calendar counts sessions per team, filters by team and adds a whole club event", async ({ page }) => {
  await seedMockSession(page, { role: "club-admin" })
  await page.setViewportSize(DESKTOP)
  await page.goto("/club-admin/dashboard")
  await page.getByRole("link", { name: "Calendar", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Club calendar" })).toBeVisible()
  await expect(page.getByRole("grid", { name: /Club calendar/ })).toBeVisible()

  await page.getByRole("tab", { name: "Agenda" }).click()
  const counts = page.locator('[data-kind="session-count"]')
  await expect(counts.first()).toContainText("Sprint Group")
  await expect(counts.first()).toContainText(/1 session/)
  // Session lines themselves are not on the club calendar.
  await expect(page.locator('[data-kind="session"]')).toHaveCount(0)
  await expect(page.locator('[data-kind="unavailable"]')).toHaveCount(0)

  await page.getByRole("radio", { name: "Throws Group" }).click()
  await expect(page).toHaveURL(/team=t4/)
  await expect(page.locator('[data-kind="session-count"]')).toHaveCount(0)
  await page.getByRole("radio", { name: "All teams" }).click()

  await page.getByRole("button", { name: "Add event" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Title").fill("Club awards night")
  await dialog.getByLabel("Start time").fill("19:00")
  await expect(dialog.getByRole("radio", { name: "The whole club" })).toHaveAttribute("aria-checked", "true")
  await dialog.getByRole("button", { name: "Add event" }).click()
  await expect(page.locator('[data-kind="event"]', { hasText: "Club awards night" })).toContainText("7:00 pm")

  // The new whole club event is on the coach's and the athlete's calendar too (same browser storage).
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/training-plan/calendar?show=agenda")
  await expect(page.locator('[data-kind="event"]', { hasText: "Club awards night" })).toBeVisible()
})

test("the coach top bar still fits on one row at 1024px on the calendar", async ({ page }) => {
  await seedMockSession(page, { role: "coach", coachTeamIds: ["t1", "t4"], coachTeamId: "t1" })
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/coach/training-plan/calendar")
  await expect(page.getByRole("grid", { name: /Sprint Group calendar/ })).toBeVisible()
  await noSidewaysScroll(page)
  const links = page.locator("header nav a")
  const tops = await links.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBeLessThanOrEqual(1)
})
