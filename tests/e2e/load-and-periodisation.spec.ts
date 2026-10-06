import { expect, test, type Locator, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Set SHOT_DIR to keep screenshots of each screen (used when reviewing the layout by eye).
const SHOT_DIR = process.env.SHOT_DIR
async function shot(page: Page, name: string, part?: Locator) {
  if (!SHOT_DIR) return
  // Charts draw after the data arrives and sheets slide in. Wait for them to settle.
  await page.waitForTimeout(700)
  const size = page.viewportSize()
  const path = `${SHOT_DIR}/${name}-${size?.width ?? 0}.png`
  // The shell scrolls inside main, so a section taller than the screen is pictured on its own.
  if (part) await part.screenshot({ path })
  else await page.screenshot({ path, fullPage: true })
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

const TENANT = "elite-track-club"

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport })
    const phone = viewport.width < 640

    test("athlete finishes with the planned time in one tap, and the load reaches their progress and their coach", async ({ page }) => {
      await seedMockSession(page, { role: "athlete" })
      await page.goto("/athlete/log")
      await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()

      // The time is prefilled from the plan: nothing to type when it is right.
      const minutes = page.getByLabel("How long did it take?")
      await expect(minutes).toHaveValue("75")
      await expect(page.locator("body")).toContainText("Your coach planned 75")
      await page.getByRole("radio", { name: "7, Hard" }).click()
      await shot(page, "log-finish-step")
      await noSidewaysScroll(page)
      await page.getByRole("button", { name: "Finish session" }).click()
      await expect(page.getByText("Nice work. That is logged.")).toBeVisible()
      await page.waitForURL(/\/athlete\/home/)

      await page.goto("/athlete/log")
      const summary = page.getByLabel("Session summary")
      await expect(summary).toContainText("Time")
      await expect(summary).toContainText("75")
      await shot(page, "log-finished")

      // Their own progress: bars and one calm line. 7 x 75 = 525 for today, plus the demo week.
      await page.goto("/athlete/trends")
      const load = page.getByRole("region", { name: "Training load" })
      await expect(load).toBeVisible()
      await expect(load.getByRole("img", { name: /Your training load per week over 12 weeks/ })).toBeVisible()
      await expect(load).toContainText(/Your last 7 days were .* your usual week\./)
      await expect(load).not.toContainText(/risk|injur|danger|warning/i)
      await load.getByRole("button", { name: "How this is worked out" }).click()
      await expect(load).toContainText("effort (1 to 10) times its minutes")
      await expect(load).toContainText("It does not predict injury.")
      await expect(load).toContainText("after 4 weeks of logged sessions")
      await shot(page, "athlete-progress-load", load)
      await noSidewaysScroll(page)

      // The coach sees the same session with its load.
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/athletes/a1")
      const coachLoad = page.getByRole("region", { name: "Training load" })
      await expect(coachLoad).toBeVisible()
      const sessions = coachLoad.getByRole("list", { name: "Sessions in the last 7 days" })
      const today = sessions.locator("li", { hasText: "Acceleration and weights" }).first()
      await expect(today).toContainText("Effort 7, 75 min")
      await expect(today).toContainText("525")
      await expect(coachLoad.getByRole("img", { name: /load per week over 12 weeks/ })).toBeVisible()
      await expect(coachLoad.getByRole("img", { name: /against the usual week/ })).toBeVisible()
      await expect(coachLoad).toContainText("Planned")
      await coachLoad.getByRole("button", { name: "How this is worked out" }).click()
      await expect(coachLoad).toContainText("Under 0.8 is well below usual, 0.8 to 1.3 is the usual range, over 1.3 and up to 1.5 is above usual, and over 1.5 is well above usual.")
      await shot(page, "coach-athlete-load", coachLoad)
      await noSidewaysScroll(page)
    })

    test("a session finished with no time has no load, and says so", async ({ page }) => {
      await seedMockSession(page, { role: "athlete" })
      await page.goto("/athlete/log")
      await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()
      await page.getByLabel("How long did it take?").fill("")
      await page.getByRole("radio", { name: /^8,/ }).click()
      await page.getByRole("button", { name: "Finish session" }).click()
      await expect(page.getByText("Nice work. That is logged.")).toBeVisible()
      await page.waitForURL(/\/athlete\/home/)

      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/athletes/a1")
      const sessions = page.getByRole("region", { name: "Training load" }).getByRole("list", { name: "Sessions in the last 7 days" })
      const today = sessions.locator("li", { hasText: "Acceleration and weights" }).first()
      await expect(today).toContainText("Effort 8, no time given")
      await expect(today).toContainText("No load recorded")

      // And on the team table it is counted as a session with no load, never as a guessed number.
      await page.goto("/coach/reports/load")
      await expect(page.locator('tr[data-athlete-id="a1"], li[data-athlete-id="a1"]').first()).toContainText("1 session with no load recorded")
    })

    test("coach reads the team's load: sorted, banded, squads, and injured athletes marked not flagged", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/reports")
      await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible()
      await page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Load" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Load" })).toBeVisible()
      await expect(page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Load" })).toHaveAttribute("aria-current", "page")

      const rows = page.locator("[data-athlete-id]")
      await expect(rows).toHaveCount(4)
      // Well above usual first.
      await expect(rows.nth(0)).toContainText("Sarah Chen")
      await expect(rows.nth(0).locator('[data-load-band="well-above"]')).toContainText("Well above usual")
      await expect(page.locator('[data-athlete-id="a3"] [data-load-band="well-below"]')).toContainText("Well below usual")
      await expect(page.locator('[data-athlete-id="a1"] [data-load-band="usual"]')).toContainText("In the usual range")
      // A new athlete has no ratio yet and is told why.
      await expect(page.locator('[data-athlete-id="a10"] [data-load-band="none"]')).toContainText(/Needs \d+ more days?/)
      const glance = page.getByLabel("This team's load at a glance")
      await expect(glance).toContainText("Well above usual")
      if (!phone) await expect(page.locator('[data-athlete-id="a2"]').getByRole("img", { name: /Load per week over the 8 full weeks before this one/ })).toBeVisible()

      await page.getByRole("button", { name: "How this is worked out" }).click()
      await expect(page.locator("body")).toContainText("It is a guide to how training is changing. It does not predict injury.")
      await shot(page, "coach-load")
      await shot(page, "coach-load-table", page.getByRole("region", { name: "Load per athlete" }))
      await noSidewaysScroll(page)

      // Squads of the team narrow the table.
      if (phone) await page.getByRole("button", { name: /Filters/ }).click()
      const squads = page.getByRole("radiogroup", { name: "Squad" })
      await expect(squads).toBeVisible()
      const firstSquad = squads.getByRole("radio").nth(1)
      await firstSquad.click()
      expect(await rows.count()).toBeLessThan(4)
      await squads.getByRole("radio", { name: "All" }).click()
      await expect(rows).toHaveCount(4)

      // Sarah is injured: she is marked, goes to the end and no longer counts as flagged.
      await page.evaluate((tenant) => {
        const today = new Date()
        const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
        window.localStorage.setItem(
          `pacelab:athlete-availability:v1:${tenant}`,
          JSON.stringify([{ id: "av-1", athleteId: "a2", kind: "injured", startsOn: day, endsOn: null, note: null, createdByRole: "coach", endedAt: null }]),
        )
      }, TENANT)
      await page.reload()
      await expect(rows).toHaveCount(4)
      await expect(rows.nth(3)).toContainText("Sarah Chen")
      const marked = rows.nth(3).locator('[data-load-band="unavailable"]')
      await expect(marked).toContainText("Injured until further notice")
      await expect(marked).toContainText("not flagged")
      await expect(page.locator('[data-load-band="well-above"]')).toHaveCount(0)
      await shot(page, "coach-load-injured", page.getByRole("region", { name: "Load per athlete" }))

      // A row leads to the athlete.
      await page.locator('[data-athlete-id="a3"]').getByRole("link", { name: /David Okafor/ }).click()
      await expect(page.getByRole("region", { name: "Training load" })).toBeVisible()
    })

    test("coach gives a plan phases, week types and planned load, and they survive drafts, templates and publishing", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/training-plan")
      await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()
      await page.getByRole("button", { name: "New plan" }).click()
      await page.getByLabel("Plan name").fill("Autumn phases")
      await page.getByRole("button", { name: "Continue to build" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Autumn phases" })).toBeVisible()

      const overview = page.getByRole("region", { name: "Plan overview" })
      await expect(overview.locator("[data-overview-week]")).toHaveCount(4)
      await expect(overview.locator("[data-phase]")).toHaveCount(0)

      // A session with minutes and an intended effort gives the week a planned load.
      await page.locator('[data-day-index="0"]').click()
      await page.getByLabel("Session title").fill("Speed and gym")
      await page.getByLabel("Minutes").fill("60")
      await page.getByLabel(/Intended effort/).selectOption("7")
      if (phone) await page.getByRole("button", { name: /Week 1/ }).first().click()
      await expect(page.locator("[data-week-planned-load]")).toContainText("Planned load 420, from 1 of 1 session.")

      // The kind of week and a target.
      await page.getByLabel(/Week type/).selectOption("deload")
      await page.getByLabel(/Target load/).fill("500")
      await expect(page.locator("[data-week-planned-load]")).toContainText("Planned load 420 of a target of 500")
      await expect(overview.locator('[data-overview-week="1"]')).toHaveAttribute("data-week-type", "deload")

      // Phases: pick a range in the strip and name it.
      await overview.getByRole("button", { name: "Add phases" }).click()
      const phases = overview.getByRole("group", { name: "Phases" })
      await overview.locator('[data-overview-week="1"]').click()
      await overview.locator('[data-overview-week="2"]').click()
      await expect(phases.getByLabel("From week")).toHaveValue("1")
      await expect(phases.getByLabel("To week")).toHaveValue("2")
      await phases.getByLabel("Phase name").fill("General prep")
      await phases.getByRole("button", { name: "Set phase for weeks 1 to 2" }).click()
      // A name of the coach's own, on the fields.
      await phases.getByLabel("From week").selectOption("3")
      await phases.getByLabel("To week").selectOption("4")
      await phases.getByLabel("Phase name").fill("Altitude camp")
      await phases.getByRole("button", { name: "Set phase for weeks 3 to 4" }).click()
      await expect(overview.locator('[data-overview-week="1"]')).toHaveAttribute("data-phase", "General prep")
      await expect(overview.locator('[data-overview-week="2"]')).toHaveAttribute("data-phase", "General prep")
      await expect(overview.locator('[data-overview-week="4"]')).toHaveAttribute("data-phase", "Altitude camp")
      const phaseList = phases.getByRole("list", { name: "Phases of this plan" })
      await expect(phaseList.locator("> li")).toHaveCount(2)
      await expect(phaseList).toContainText("Weeks 1 to 2")
      await shot(page, "builder-phases-open", overview)
      await noSidewaysScroll(page)

      // Painting week 2 with another phase shortens the first one.
      await phases.getByLabel("From week").selectOption("2")
      await phases.getByLabel("To week").selectOption("2")
      await phases.getByLabel("Phase name").fill("Specific prep")
      await phases.getByRole("button", { name: "Set phase for week 2" }).click()
      await expect(overview.locator('[data-overview-week="1"]')).toHaveAttribute("data-phase", "General prep")
      await expect(overview.locator('[data-overview-week="2"]')).toHaveAttribute("data-phase", "Specific prep")
      await expect(phaseList.locator("> li")).toHaveCount(3)
      await phases.getByRole("button", { name: "Done" }).click()
      await expect(overview.getByRole("group", { name: "Phases" })).toHaveCount(0)

      // Copy still works: week 2 takes week 1's sessions and its kind of week.
      await page.getByRole("tab", { name: "Week 2" }).click()
      await page.getByRole("button", { name: "Duplicate last week" }).click()
      await expect(page.locator('[data-has-session="true"]')).toHaveCount(1)
      await expect(page.getByLabel(/Week type/)).toHaveValue("deload")
      await expect(page.locator("[data-week-planned-load]")).toContainText("Planned load 420")
      await page.getByLabel(/Week type/).selectOption("build")
      await shot(page, "builder-overview")
      await shot(page, "builder-overview-strip", overview)
      await noSidewaysScroll(page)

      // Save, reload, reopen: all of it is still there.
      await page.getByRole("button", { name: "Save draft" }).click()
      await expect(page.locator("body")).toContainText("Draft saved at")
      await page.reload()
      await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()
      await page.locator('li[data-plan-status="draft"]', { hasText: "Autumn phases" }).getByRole("button", { name: /Autumn phases/ }).first().click()
      await expect(page.getByRole("heading", { level: 1, name: "Autumn phases" })).toBeVisible()
      await expect(overview.locator('[data-overview-week="1"]')).toHaveAttribute("data-phase", "General prep")
      await expect(overview.locator('[data-overview-week="1"]')).toHaveAttribute("data-week-type", "deload")
      await expect(overview.locator('[data-overview-week="2"]')).toHaveAttribute("data-week-type", "build")
      await expect(overview.locator('[data-overview-week="3"]')).toHaveAttribute("data-phase", "Altitude camp")
      await expect(page.getByLabel(/Target load/)).toHaveValue("500")

      // Into a template...
      await page.getByRole("button", { name: "More for this plan" }).click()
      await page.getByRole("menuitem", { name: "Save as template" }).click()
      const save = page.getByRole("dialog", { name: "Save as template" })
      await save.getByLabel("Template name").fill("Phased block")
      await save.getByRole("button", { name: "Save template" }).click()
      await expect(save).toHaveCount(0)
      const stored = await page.evaluate((tenant) => window.localStorage.getItem(`pacelab:plan-templates:v1:${tenant}`) ?? "", TENANT)
      expect(stored).toContain("Altitude camp")
      expect(stored).toContain('"weekTypes"')
      expect(stored).toContain('"weekTargetLoad"')
      expect(stored).toContain('"intendedEffort":"7"')

      // ...and published to the team: the athlete's plan says the phase and the kind of week in one line.
      await page.getByRole("button", { name: "Publish", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Publish plan" })).toBeVisible()
      await page.getByRole("button", { name: /^Publish to/ }).click()
      await expect(page.locator("body")).toContainText("Plan published to")
      await page.getByRole("button", { name: "Back to plans" }).click()

      // ...and out of the template into a new draft.
      await page.getByRole("navigation", { name: "Plans" }).getByRole("link", { name: "Templates" }).click()
      await page.getByRole("button", { name: "More for Phased block" }).click()
      await page.getByRole("menuitem", { name: "Start a plan from it" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "New plan" })).toBeVisible()
      await page.getByLabel("Plan name").fill("Winter phases")
      await page.getByRole("button", { name: "Continue to build" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Winter phases" })).toBeVisible()
      const fresh = page.getByRole("region", { name: "Plan overview" })
      await expect(fresh.locator('[data-overview-week="1"]')).toHaveAttribute("data-phase", "General prep")
      await expect(fresh.locator('[data-overview-week="2"]')).toHaveAttribute("data-phase", "Specific prep")
      await expect(fresh.locator('[data-overview-week="4"]')).toHaveAttribute("data-phase", "Altitude camp")
      await expect(fresh.locator('[data-overview-week="1"]')).toHaveAttribute("data-week-type", "deload")
      await expect(page.locator("[data-week-planned-load]")).toContainText("Planned load 420 of a target of 500")

      await seedMockSession(page, { role: "athlete" })
      await page.goto("/athlete/training-plan")
      await expect(page.locator("[data-week-line]")).toHaveText("General prep, deload week")
      await shot(page, "athlete-plan-week-line")
      await noSidewaysScroll(page)
    })

    test("a plan made before phases existed opens and works unchanged", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      // Exactly what the builder stored before this feature: no phases, no week types, no intended effort.
      await page.addInitScript((tenant) => {
        const key = `pacelab:coach-training-plans:v1:${tenant}`
        if (window.localStorage.getItem(key)) return
        const session = { id: "old-s1", week: 1, dayIndex: 0, title: "Old session", sessionType: "Track", location: "", durationMinutes: "60", notes: "", blocks: [] }
        const plan = { id: "old-plan", status: "draft", name: "Old plan", teamId: "t1", startDate: "2026-01-05", weeks: 3, notes: "", weekFocus: { "1": "Base" }, sessions: [session], assign: { target: "team", subgroup: null, athleteIds: [], squadIds: [], visibilityStart: "immediate", visibilityDate: null }, updatedAt: null }
        window.localStorage.setItem(key, JSON.stringify({ plans: [plan], removedSeedIds: [] }))
      }, TENANT)
      await page.goto("/coach/training-plan")
      await page.locator('li[data-plan-status="draft"]', { hasText: "Old plan" }).getByRole("button", { name: /Old plan/ }).first().click()
      await expect(page.getByRole("heading", { level: 1, name: "Old plan" })).toBeVisible()
      const overview = page.getByRole("region", { name: "Plan overview" })
      await expect(overview.locator("[data-overview-week]")).toHaveCount(3)
      await expect(overview.locator("[data-phase]")).toHaveCount(0)
      await expect(overview.getByRole("button", { name: "Add phases" })).toBeVisible()
      await expect(page.getByLabel(/Week focus/)).toHaveValue("Base")
      await expect(page.getByLabel(/Week type/)).toHaveValue("")
      await expect(page.locator('[data-has-session="true"]')).toHaveCount(1)
      await expect(page.locator("[data-week-planned-load]")).toContainText("Planned load shows once a session has minutes and an intended effort.")
      // Saving it again adds nothing it did not have.
      await page.getByLabel(/Week focus/).fill("Base two")
      await page.getByRole("button", { name: "Save draft" }).click()
      await expect(page.locator("body")).toContainText("Draft saved at")
      const stored = await page.evaluate((tenant) => window.localStorage.getItem(`pacelab:coach-training-plans:v1:${tenant}`) ?? "", TENANT)
      expect(stored).toContain("Base two")
      expect(stored).not.toContain('"phases"')
      await shot(page, "builder-old-plan")
    })
  })
}
