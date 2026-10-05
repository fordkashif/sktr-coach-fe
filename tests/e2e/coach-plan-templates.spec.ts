import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Set SHOT_DIR to keep screenshots of each screen (used when reviewing the layout by eye).
const SHOT_DIR = process.env.SHOT_DIR
async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return
  // Sheets and dialogs slide in. Wait for them to settle before the picture.
  await page.waitForTimeout(450)
  const size = page.viewportSize()
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${size?.width ?? 0}.png`, fullPage: true })
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

const SPRINT = "Sprint general prep, 4 weeks"
const THROWS = "Throws taper, 2 weeks"

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport })
    const phone = viewport.width < 640

    async function openFilters(page: Page) {
      if (phone) await page.getByRole("button", { name: /Filters/ }).click()
    }

    async function openTemplates(page: Page) {
      await page.goto("/coach/training-plan")
      await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()
      await page.getByRole("navigation", { name: "Plans" }).getByRole("link", { name: "Templates" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible()
    }

    test("coach finds, previews and looks after the club's templates", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await openTemplates(page)
      const tabs = page.getByRole("navigation", { name: "Plans" })
      await expect(tabs.getByRole("link", { name: "Templates" })).toHaveAttribute("aria-current", "page")
      await expect(tabs.getByRole("link", { name: "Plans", exact: true })).not.toHaveAttribute("aria-current", "page")

      const list = page.getByRole("list", { name: "Templates" })
      await expect(list.locator("> li")).toHaveCount(2)
      const sprint = list.locator("li", { hasText: SPRINT })
      await expect(sprint).toContainText("4 weeks, 4 sessions a week")
      await expect(sprint).toContainText("General prep, Sprints")
      await expect(sprint).toContainText("Made by you")
      const throws = list.locator("li", { hasText: THROWS })
      await expect(throws).toContainText("2 weeks, 3 sessions a week")
      await expect(throws).toContainText("Taper, Throws")
      await expect(throws).toContainText("Made by Dana Brooks")
      await expect(throws).toContainText("Not used yet")
      await shot(page, "templates")
      await noSidewaysScroll(page)

      // Search and tag filters.
      await page.getByLabel("Search templates").fill("taper")
      await expect(list.locator("> li")).toHaveCount(1)
      await expect(list).toContainText(THROWS)
      await page.getByLabel("Search templates").fill("nothing like this")
      await expect(page.getByText("No template matches")).toBeVisible()
      await page.getByLabel("Search templates").fill("")
      await openFilters(page)
      await page.getByRole("radiogroup", { name: "Phase" }).getByRole("radio", { name: "General prep" }).click()
      await expect(list.locator("> li")).toHaveCount(1)
      await expect(list).toContainText(SPRINT)
      await shot(page, "templates-filtered")
      await page.getByRole("radiogroup", { name: "Phase" }).getByRole("radio", { name: "All" }).click()
      await page.getByRole("radiogroup", { name: "Event group" }).getByRole("radio", { name: "Throws" }).click()
      await expect(list.locator("> li")).toHaveCount(1)
      await expect(list).toContainText(THROWS)
      await page.getByRole("radiogroup", { name: "Event group" }).getByRole("radio", { name: "All" }).click()
      await expect(list.locator("> li")).toHaveCount(2)

      // Preview: a read only outline, week by week.
      await list.getByRole("button", { name: new RegExp(`^${SPRINT}`) }).click()
      const preview = page.getByRole("dialog", { name: SPRINT })
      await expect(preview.getByRole("heading", { name: "Week 1" })).toBeVisible()
      await expect(preview.getByRole("heading", { name: "Week 4" })).toBeVisible()
      await expect(preview).toContainText("Build the base")
      await expect(preview.getByRole("list", { name: "Week 1 sessions" })).toContainText("Max strength")
      await expect(preview.getByRole("list", { name: "Week 1 sessions" })).toContainText("Back squat 4 x 4 @ 70%")
      await expect(preview.getByRole("list", { name: "Week 3 sessions" })).toContainText("Back squat 4 x 4 @ 80%")
      await expect(preview.getByRole("list", { name: "Week 1 sessions" }).locator("li").first()).toContainText("Mon")
      await expect(preview.locator("input, textarea, select")).toHaveCount(0)
      await shot(page, "template-preview")
      await preview.getByRole("button", { name: "Close", exact: true }).click()
      await expect(preview).toHaveCount(0)

      // A colleague's template can be used and copied, not changed or deleted.
      await page.getByRole("button", { name: `More for ${THROWS}` }).click()
      await expect(page.getByRole("menuitem", { name: "Start a plan from it" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Preview" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Rename and edit details" })).toHaveCount(0)
      await expect(page.getByRole("menuitem", { name: "Archive" })).toHaveCount(0)
      await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0)
      await page.getByRole("menuitem", { name: "Duplicate" }).click()
      const copy = list.locator("li", { hasText: `${THROWS} (copy)` })
      await expect(copy).toContainText("Made by you")
      await expect(page.getByRole("status")).toContainText("is yours to change")
      await expect(list.locator("> li")).toHaveCount(3)

      // Rename and tag the copy.
      await page.getByRole("button", { name: `More for ${THROWS} (copy)` }).click()
      await page.getByRole("menuitem", { name: "Rename and edit details" }).click()
      const edit = page.getByRole("dialog", { name: "Template details" })
      await edit.getByLabel("Template name").fill("   ")
      await edit.getByRole("button", { name: "Save details" }).click()
      await expect(edit).toContainText("Give the template a name.")
      await edit.getByLabel("Template name").fill("Discus taper")
      await edit.getByLabel(/Description/).fill("Two light weeks before the main meet")
      await edit.getByLabel(/Phase/).selectOption("competition")
      await shot(page, "template-edit")
      await edit.getByRole("button", { name: "Save details" }).click()
      await expect(edit).toHaveCount(0)
      const renamed = list.locator("li", { hasText: "Discus taper" })
      await expect(renamed).toContainText("Competition, Throws")
      // The original is untouched.
      await expect(list.locator("li", { hasText: THROWS })).toContainText("Taper, Throws")

      // Archive, then restore.
      await page.getByRole("button", { name: "More for Discus taper" }).click()
      await page.getByRole("menuitem", { name: "Archive" }).click()
      await expect(list.locator("li", { hasText: "Discus taper" })).toHaveCount(0)
      await page.getByRole("tab", { name: /Archived 1/ }).click()
      const archived = page.getByRole("list", { name: "Archived templates" })
      await expect(archived).toContainText("Discus taper")
      await page.getByRole("button", { name: "More for Discus taper" }).click()
      await expect(page.getByRole("menuitem", { name: "Start a plan from it" })).toHaveCount(0)
      await page.getByRole("menuitem", { name: "Restore" }).click()
      await page.getByRole("tab", { name: /In use 3/ }).click()
      await expect(list.locator("li", { hasText: "Discus taper" })).toBeVisible()

      // Delete asks first, in the row.
      await page.getByRole("button", { name: "More for Discus taper" }).click()
      await page.getByRole("menuitem", { name: "Delete" }).click()
      const confirm = page.getByRole("group", { name: "Confirm" })
      await expect(confirm).toContainText('Delete "Discus taper" for good?')
      await shot(page, "template-delete-confirm")
      await noSidewaysScroll(page)
      await confirm.getByRole("button", { name: "Keep it" }).click()
      await expect(list.locator("li", { hasText: "Discus taper" })).toBeVisible()
      await page.getByRole("button", { name: "More for Discus taper" }).click()
      await page.getByRole("menuitem", { name: "Delete" }).click()
      await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Yes, delete" }).click()
      await expect(list.locator("li", { hasText: "Discus taper" })).toHaveCount(0)
      await expect(list.locator("> li")).toHaveCount(2)

      // It all survives a reload.
      await page.reload()
      await expect(page.getByRole("list", { name: "Templates" }).locator("> li")).toHaveCount(2)
    })

    test("a plan is saved as a template without its squad, and a new plan starts from it", async ({ page }) => {
      test.setTimeout(120_000)
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/training-plan")
      await page.getByRole("button", { name: "New plan" }).click()
      await page.getByLabel("Plan name").fill("Autumn strength")
      await page.getByLabel("Weeks").fill("3")
      await page.getByRole("button", { name: "Continue to build" }).click()
      await expect(page.getByRole("heading", { name: "Autumn strength" })).toBeVisible()

      await page.locator('[data-day-index="0"]').click()
      await page.getByLabel("Session title").fill("Gym day")
      await page.getByRole("button", { name: "Strength", exact: true }).click()
      await page.getByRole("button", { name: "Add exercise" }).click()
      const name1 = page.getByLabel("Block 1 exercise 1 name", { exact: true })
      await name1.fill("back sq")
      await page.getByRole("listbox", { name: "Exercises in the library" }).getByRole("option", { name: /Back squat/ }).click()
      await page.getByLabel("Block 1 exercise 1 sets", { exact: true }).fill("4")
      await page.getByLabel("Block 1 exercise 1 reps", { exact: true }).fill("4")
      await page.getByLabel("Block 1 exercise 1 load", { exact: true }).fill("80%")
      await page.getByRole("button", { name: "More for block 1 exercise 1" }).click()
      await page.getByRole("menuitem", { name: "Adjust for an athlete" }).click()
      await page.getByLabel("Block 1 exercise 1 change for which athlete").selectOption({ label: "David Okafor" })
      await page.getByLabel("Block 1 exercise 1 load for David Okafor").fill("70%")
      await expect(page.locator("[data-exercise-row]").nth(0).locator("[data-override-summary]")).toContainText("David Okafor gets")

      // Save as template, from the plan's own menu.
      if (phone) await page.getByRole("button", { name: /Week 1/ }).first().click()
      await page.getByRole("button", { name: "More for this plan" }).click()
      await page.getByRole("menuitem", { name: "Save as template" }).click()
      const save = page.getByRole("dialog", { name: "Save as template" })
      await expect(save).toContainText("The team, dates, who it is sent to and changes for single athletes are left out.")
      await expect(save.getByLabel("Template name")).toHaveValue("Autumn strength")
      await expect(save.getByLabel(/Event group/)).toHaveValue("Sprint")
      await save.getByLabel("Template name").fill("Autumn strength block")
      await save.getByLabel(/Description/).fill("Three weeks of heavy squats")
      await save.getByLabel(/Phase/).selectOption("specific-prep")
      await shot(page, "save-as-template")
      await noSidewaysScroll(page)
      await save.getByRole("button", { name: "Save template" }).click()
      await expect(save).toHaveCount(0)
      await expect(page.getByText('Saved "Autumn strength block" as a template').first()).toBeVisible()
      await expect(page.getByText("1 change for a single athlete were left out").first()).toBeVisible()

      // What was stored has the exercise, its library link and the percentage, and nothing of the squad.
      const stored = await page.evaluate(() => window.localStorage.getItem("pacelab:plan-templates:v1:elite-track-club") ?? "")
      expect(stored).toContain("Back squat")
      expect(stored).toContain("seed-ex-back-squat")
      expect(stored).toContain("80%")
      expect(stored).not.toContain("overrides")
      expect(stored).not.toContain("70%")
      expect(stored).not.toContain('"a3"')
      expect(stored).not.toContain("assign")
      expect(stored).not.toContain("teamId")
      expect(stored).not.toContain("startDate")

      // The plan itself still has the change for David, and is saved as a draft.
      await page.getByRole("button", { name: "Save draft" }).click()
      await expect(page.locator("body")).toContainText("Draft saved at")
      await page.getByRole("button", { name: "All plans" }).click()
      await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()

      // The template is in the club's list.
      await page.getByRole("navigation", { name: "Plans" }).getByRole("link", { name: "Templates" }).click()
      const list = page.getByRole("list", { name: "Templates" })
      const mine = list.locator("li", { hasText: "Autumn strength block" })
      await expect(mine).toContainText("3 weeks")
      await expect(mine).toContainText("Specific prep, Sprints")
      await expect(mine).toContainText("Made by you")
      await expect(mine).toContainText("Not used yet")

      // Start a plan from it.
      await page.getByRole("button", { name: "More for Autumn strength block" }).click()
      await page.getByRole("menuitem", { name: "Start a plan from it" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "New plan" })).toBeVisible()
      await expect(page).toHaveURL(/\/coach\/training-plan$/)
      await expect(page.getByRole("tab", { name: "Template", exact: true })).toHaveAttribute("aria-selected", "true")
      const picker = page.getByRole("radiogroup", { name: "Template" })
      await expect(picker.getByRole("radio", { name: /Autumn strength block/ })).toBeChecked()
      await expect(page.getByLabel("Plan name")).toHaveValue("Autumn strength block")
      await expect(page.getByRole("spinbutton", { name: "Weeks" })).toHaveValue("3")
      await expect(page.locator("body")).toContainText("Changing your plan never changes the template.")

      // Picking another template follows with the name and the length; a start on another weekday is pointed out.
      await picker.getByRole("radio", { name: new RegExp(SPRINT) }).check()
      await expect(page.getByLabel("Plan name")).toHaveValue(SPRINT)
      await expect(page.getByRole("spinbutton", { name: "Weeks" })).toHaveValue("4")
      await page.getByLabel("Start date").fill("2026-11-04")
      await expect(page.locator("body")).toContainText("built to start on a Monday. Starting on a Wednesday moves its sessions to other weekdays.")
      await page.getByLabel("Start date").fill("2026-11-02")
      await expect(page.locator("body")).not.toContainText("built to start on a Monday")
      await shot(page, "setup-from-template")
      await noSidewaysScroll(page)

      await picker.getByRole("radio", { name: /Autumn strength block/ }).check()
      await page.getByLabel("Plan name").fill("Winter strength")
      await page.getByRole("button", { name: "Continue to build" }).click()

      // The builder opens on a draft, filled in and dated from the start date.
      await expect(page.getByRole("heading", { level: 1, name: "Winter strength" })).toBeVisible()
      const main = page.locator("#main-content")
      await expect(main).toContainText("Draft")
      await expect(main).toContainText("Sprint Group, 3 weeks, Nov 2 to Nov 22")
      await expect(page.getByRole("tab", { name: /^Week \d/ })).toHaveCount(3)
      await expect(page.locator('[data-day-index="0"]')).toContainText("Gym day")
      await shot(page, "builder-from-template")
      await page.locator('[data-day-index="0"]').click()
      await expect(page.getByLabel("Session title")).toHaveValue("Gym day")
      await expect(page.getByLabel("Block 1 exercise 1 name", { exact: true })).toHaveValue("Back squat")
      await expect(page.getByLabel("Block 1 exercise 1 sets", { exact: true })).toHaveValue("4")
      await expect(page.getByLabel("Block 1 exercise 1 load", { exact: true })).toHaveValue("80%")
      const row = page.locator("[data-exercise-row]").nth(0)
      await expect(row).toContainText("Cue for athletes: Brace before you go down.")
      // The change for David stayed with the old squad.
      await expect(row.locator("[data-override-summary]")).toHaveCount(0)
      await expect(row).not.toContainText("David Okafor gets")

      // Change the new plan and save it.
      await page.getByLabel("Session title").fill("Changed in my plan")
      await page.getByLabel("Block 1 exercise 1 load", { exact: true }).fill("90%")
      await page.getByRole("button", { name: "Save draft" }).click()
      await expect(page.locator("body")).toContainText("Draft saved at")
      if (phone) await page.getByRole("button", { name: /Week 1/ }).first().click()
      await page.getByRole("button", { name: "All plans" }).click()
      const plans = page.getByRole("list", { name: "Training plans" })
      await expect(plans.locator("li", { hasText: "Winter strength" })).toContainText("Draft")
      await expect(plans.locator("li", { hasText: "Winter strength" })).toContainText("Nov 2 to Nov 22")
      await expect(plans.locator("li", { hasText: "Autumn strength" })).toBeVisible()

      // The template is as it was, and now says it was used.
      await page.getByRole("navigation", { name: "Plans" }).getByRole("link", { name: "Templates" }).click()
      const used = page.getByRole("list", { name: "Templates" }).locator("li", { hasText: "Autumn strength block" })
      await expect(used).toContainText("Used today")
      await expect(page.getByRole("list", { name: "Templates" }).locator("> li").first()).toContainText("Autumn strength block")
      await used.getByRole("button", { name: /^Autumn strength block/ }).click()
      const preview = page.getByRole("dialog", { name: "Autumn strength block" })
      await expect(preview).toContainText("Three weeks of heavy squats")
      await expect(preview.getByRole("list", { name: "Week 1 sessions" })).toContainText("Gym day")
      await expect(preview.getByRole("list", { name: "Week 1 sessions" })).toContainText("Back squat 4 x 4 @ 80%")
      await expect(preview).not.toContainText("Changed in my plan")
      await expect(preview).not.toContainText("90%")
      await expect(preview).toContainText("No sessions this week.")
      await shot(page, "template-preview-own")

      // The preview starts a plan too.
      await preview.getByRole("button", { name: "Start a plan from it" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "New plan" })).toBeVisible()
      await expect(page.getByRole("radiogroup", { name: "Template" }).getByRole("radio", { name: /Autumn strength block/ })).toBeChecked()
    })

    test("save as template from the plan list, and the starter outline still works", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/training-plan")
      await page.getByRole("button", { name: "More for General preparation block" }).click()
      await page.getByRole("menuitem", { name: "Save as template" }).click()
      const save = page.getByRole("dialog", { name: "Save as template" })
      await expect(save.getByLabel("Template name")).toHaveValue("General preparation block")
      await save.getByRole("button", { name: "Save template" }).click()
      await expect(page.getByText('Saved "General preparation block" as a template').first()).toBeVisible()
      // The published plan is still published.
      await expect(page.getByRole("list", { name: "Training plans" }).locator("li", { hasText: "General preparation block" })).toContainText("Published")

      // New plan: blank weeks, a starter outline, or a template.
      await page.getByRole("button", { name: "New plan" }).click()
      await page.getByLabel("Plan name").fill("Outline plan")
      await page.getByRole("tab", { name: "Template", exact: true }).click()
      const picker = page.getByRole("radiogroup", { name: "Template" })
      await expect(picker.getByRole("radio")).toHaveCount(3)
      await expect(picker).toContainText("General preparation block")
      await page.getByRole("button", { name: "Continue to build" }).click()
      await expect(page.getByRole("alert")).toContainText("Choose a template, or start from blank weeks.")
      await page.getByRole("tab", { name: "Starter outline" }).click()
      await expect(page.getByLabel("Event group")).toBeVisible()
      await page.getByRole("button", { name: "Continue to build" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Outline plan" })).toBeVisible()
      await expect(page.locator('[data-day-index="0"]')).not.toContainText("Rest")
    })

    test("a club admin manages any template, an athlete gets none", async ({ page }) => {
      await seedMockSession(page, { role: "club-admin" })
      await page.goto("/coach/training-plan/templates")
      await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible()
      const list = page.getByRole("list", { name: "Templates" })
      await expect(list.locator("> li")).toHaveCount(2)
      await expect(list.locator("li", { hasText: SPRINT })).toContainText("Made by Demo Coach")
      await page.getByRole("button", { name: `More for ${THROWS}` }).click()
      await expect(page.getByRole("menuitem", { name: "Rename and edit details" })).toBeVisible()
      await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible()
      await page.getByRole("menuitem", { name: "Delete" }).click()
      await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Yes, delete" }).click()
      await expect(list.locator("> li")).toHaveCount(1)
      await expect(page.getByRole("status")).toContainText("Plans started from it are not changed.")

      await seedMockSession(page, { role: "athlete" })
      await page.goto("/coach/training-plan/templates")
      await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toHaveCount(0)
      await expect(page).not.toHaveURL(/\/coach\/training-plan/)
    })
  })
}
