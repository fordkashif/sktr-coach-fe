import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Set SHOT_DIR to keep screenshots of each screen (used when reviewing the layout by eye).
const SHOT_DIR = process.env.SHOT_DIR
async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return
  const size = page.viewportSize()
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${size?.width ?? 0}.png`, fullPage: true })
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport })

    test("coach manages the club exercise library from the Plans area", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/training-plan")
      await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible()

      const tabs = page.getByRole("navigation", { name: "Plans" })
      await expect(tabs.getByRole("link", { name: "Plans", exact: true })).toHaveAttribute("aria-current", "page")
      await tabs.getByRole("link", { name: "Exercises" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Exercises" })).toBeVisible()
      await expect(tabs.getByRole("link", { name: "Exercises" })).toHaveAttribute("aria-current", "page")
      await expect(tabs.getByRole("link", { name: "Plans", exact: true })).not.toHaveAttribute("aria-current", "page")

      const list = page.getByRole("list", { name: "Exercises" })
      await expect(list.locator("li", { hasText: "Back squat" })).toContainText("Strength, reps and load")
      await expect(list.locator("li", { hasText: "Back squat" })).toContainText("Has a link")
      await expect(list.locator("li", { hasText: "Leg press" })).toHaveCount(0)
      await shot(page, "exercises")
      await noSidewaysScroll(page)

      // Search and filter.
      await page.getByLabel("Search exercises").fill("squat")
      await expect(list.locator("li")).toHaveCount(1)
      await page.getByLabel("Search exercises").fill("")
      if (viewport.width < 640) await page.getByRole("button", { name: /Filters/ }).click()
      await page.getByRole("radio", { name: "Plyometric" }).click()
      await expect(list.locator("li")).toHaveCount(2)
      await expect(list).toContainText("Alternate leg bounds")
      await page.getByRole("radio", { name: "All" }).click()

      // Add: a link that is not a web address is refused, then accepted once fixed.
      await page.getByRole("button", { name: "Add exercise" }).first().click()
      const dialog = page.getByRole("dialog", { name: "Add exercise" })
      await dialog.getByLabel("Name").fill("Nordic curl")
      await dialog.getByLabel("Category").selectOption("strength")
      await dialog.getByLabel(/Coaching cue/).fill("Slow on the way down")
      await dialog.getByLabel(/Video or reference link/).fill("javascript:alert(1)")
      await dialog.getByRole("button", { name: "Add to library" }).click()
      await expect(dialog).toContainText("The link must start with http:// or https://")
      await shot(page, "exercise-dialog")
      await dialog.getByLabel(/Video or reference link/).fill("https://example.com/nordic")
      await dialog.getByRole("button", { name: "Add to library" }).click()
      await expect(dialog).toHaveCount(0)
      await expect(list.locator("li", { hasText: "Nordic curl" })).toContainText("Slow on the way down")

      // The same name again is refused.
      await page.getByRole("button", { name: "Add exercise" }).first().click()
      await dialog.getByLabel("Name").fill("nordic  CURL")
      await dialog.getByRole("button", { name: "Add to library" }).click()
      await expect(dialog).toContainText("is in the library already")
      await dialog.getByRole("button", { name: "Cancel" }).click()

      // Edit.
      await list.getByRole("button", { name: /^Nordic curl/ }).click()
      const edit = page.getByRole("dialog", { name: "Edit exercise" })
      await edit.getByLabel("Name").fill("Nordic hamstring curl")
      await edit.getByRole("button", { name: "Save exercise" }).click()
      await expect(list.locator("li", { hasText: "Nordic hamstring curl" })).toBeVisible()

      // Archive, find it under Archived, restore.
      await page.getByRole("button", { name: "More for Nordic hamstring curl" }).click()
      await page.getByRole("menuitem", { name: "Archive" }).click()
      await expect(list.locator("li", { hasText: "Nordic hamstring curl" })).toHaveCount(0)
      await page.getByRole("tab", { name: /Archived/ }).click()
      const archived = page.getByRole("list", { name: "Archived exercises" })
      await expect(archived.locator("li", { hasText: "Nordic hamstring curl" })).toBeVisible()
      await expect(archived.locator("li", { hasText: "Leg press" })).toBeVisible()
      await page.getByRole("button", { name: "More for Nordic hamstring curl" }).click()
      await page.getByRole("menuitem", { name: "Restore" }).click()
      await expect(archived.locator("li", { hasText: "Nordic hamstring curl" })).toHaveCount(0)
      await page.getByRole("tab", { name: /In use/ }).click()
      await expect(list.locator("li", { hasText: "Nordic hamstring curl" })).toBeVisible()

      // It survives a reload.
      await page.reload()
      await expect(page.getByRole("list", { name: "Exercises" }).locator("li", { hasText: "Nordic hamstring curl" })).toBeVisible()
    })

    test("library pick, percent of best lift and a change for one athlete reach the athlete's session", async ({ page }) => {
      test.setTimeout(90_000)
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/training-plan")
      await page.getByRole("button", { name: "New plan" }).click()
      await page.getByLabel("Plan name").fill("Strength with percentages")
      await page.getByRole("button", { name: "Continue to build" }).click()
      await expect(page.getByRole("heading", { name: "Strength with percentages" })).toBeVisible()

      // The plan starts today, so day one is the session the athlete sees today.
      await page.locator('[data-day-index="0"]').click()
      await page.getByLabel("Session title").fill("Gym day")
      await page.getByRole("button", { name: "Strength", exact: true }).click()
      await page.getByRole("button", { name: "Add exercise" }).click()

      // Typing suggests library exercises. Picking one fills the name and brings its cue and link.
      const name1 = page.getByLabel("Block 1 exercise 1 name", { exact: true })
      await name1.fill("back sq")
      const suggestions = page.getByRole("listbox", { name: "Exercises in the library" })
      await expect(suggestions.getByRole("option", { name: /Back squat/ })).toBeVisible()
      await suggestions.getByRole("option", { name: /Back squat/ }).click()
      await expect(name1).toHaveValue("Back squat")
      const row1 = page.locator("[data-exercise-row]").nth(0)
      await expect(row1).toContainText("Cue for athletes: Brace before you go down.")
      await expect(row1.getByRole("link", { name: "Open the reference link" })).toHaveAttribute("href", /^https:\/\//)

      await page.getByLabel("Block 1 exercise 1 sets", { exact: true }).fill("4")
      await page.getByLabel("Block 1 exercise 1 reps", { exact: true }).fill("4")
      await page.getByLabel("Block 1 exercise 1 load", { exact: true }).fill("80%")
      await expect(row1).toContainText("Best Back squat saved for 4 of 4 athletes")

      // A different load for one athlete.
      await page.getByRole("button", { name: "More for block 1 exercise 1" }).click()
      await page.getByRole("menuitem", { name: "Adjust for an athlete" }).click()
      await page.getByLabel("Block 1 exercise 1 change for which athlete").selectOption({ label: "David Okafor" })
      await page.getByLabel("Block 1 exercise 1 load for David Okafor").fill("70%")
      await page.getByLabel("Block 1 exercise 1 note for David Okafor").fill("Knee is sore, stay light")
      await expect(row1.locator("[data-override-summary]")).toHaveText("David Okafor gets 4 x 4 at 70%, 122.5 kg. Knee is sore, stay light")

      // A row typed by hand still works, with a percentage nobody has a best lift for.
      await page.getByLabel("Block 1 exercise 1 load", { exact: true }).press("Enter")
      const name2 = page.getByLabel("Block 1 exercise 2 name", { exact: true })
      await expect(name2).toBeFocused()
      await name2.fill("Zercher carry")
      await page.getByLabel("Block 1 exercise 2 sets", { exact: true }).fill("3")
      await page.getByLabel("Block 1 exercise 2 reps", { exact: true }).fill("5")
      await page.getByLabel("Block 1 exercise 2 load", { exact: true }).fill("75%")
      const row2 = page.locator("[data-exercise-row]").nth(1)
      await expect(row2).toContainText("Best Zercher carry saved for 0 of 4 athletes")
      await expect(row2).toContainText("They see the percentage only.")

      // Save the hand typed row to the library.
      await page.getByRole("button", { name: "More for block 1 exercise 2" }).click()
      await page.getByRole("menuitem", { name: "Save to library" }).click()
      await expect(row2.getByRole("status")).toContainText("Zercher carry is in the library")
      await page.getByRole("button", { name: "More for block 1 exercise 2" }).click()
      await expect(page.getByRole("menuitem", { name: "Save to library" })).toHaveCount(0)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("menu")).toHaveCount(0)

      await shot(page, "builder")
      await noSidewaysScroll(page)

      // Publish.
      await page.getByRole("button", { name: "Publish", exact: true }).click()
      await page.getByRole("button", { name: /^Publish to/ }).click()
      await expect(page.locator("body")).toContainText("Plan published to")

      // The athlete (Marcus Johnson, best back squat 185 kg) sees the weight next to the percentage.
      await seedMockSession(page, { role: "athlete" })
      await page.goto("/athlete/log")
      const log = page.locator("#main-content")
      await expect(log).toContainText("Gym day")
      await expect(log).toContainText("4 x 4 at 80%, 147.5 kg")
      await expect(log).toContainText("Brace before you go down.")
      await expect(log).toContainText("3 x 5 at 75%")
      await expect(log).toContainText("No best Zercher carry saved yet")
      await expect(log).not.toContainText("Knee is sore")
      await shot(page, "athlete-log")

      // The coach corrects Marcus's best lift and adds the missing one.
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/training-plan")
      await page.getByRole("navigation", { name: "Plans" }).getByRole("link", { name: "Best lifts" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Best lifts" })).toBeVisible()
      const squat = page.getByLabel("Marcus Johnson, Back squat")
      await expect(squat).toHaveValue("185")
      await squat.fill("200")
      await squat.press("Tab")
      await expect(page.getByLabel("Marcus Johnson, Back squat")).toHaveValue("200")

      await page.getByLabel("Add a lift").fill("Zercher carry")
      await page.getByRole("button", { name: "Add column" }).click()
      const carry = page.getByLabel("Marcus Johnson, Zercher carry")
      await carry.fill("101")
      await carry.press("Tab")
      await expect(page.getByLabel("Marcus Johnson, Zercher carry")).toHaveValue("101")
      await shot(page, "best-lifts")
      await noSidewaysScroll(page)

      // The coach also gives Marcus his own load on the published plan and updates it.
      await page.getByRole("navigation", { name: "Plans" }).getByRole("link", { name: "Plans", exact: true }).click()
      await page.locator('li[data-plan-status="published"]', { hasText: "Strength with percentages" }).getByRole("button", { name: /Strength with percentages/ }).first().click()
      await expect(page.getByRole("heading", { name: "Strength with percentages" })).toBeVisible()
      await page.locator('[data-day-index="0"]').click()
      await expect(page.locator("[data-exercise-row]").nth(1)).toContainText("Best Zercher carry saved for 1 of 4 athletes")
      await page.getByRole("button", { name: "More for block 1 exercise 1" }).click()
      await page.getByRole("menuitem", { name: "Adjust for an athlete" }).click()
      await page.getByLabel("Block 1 exercise 1 change for which athlete").last().selectOption({ label: "Marcus Johnson" })
      await page.getByLabel("Block 1 exercise 1 reps for Marcus Johnson").fill("6")
      await page.getByLabel("Block 1 exercise 1 load for Marcus Johnson").fill("60%")
      await expect(page.locator("[data-override-summary]").last()).toHaveText("Marcus Johnson gets 4 x 6 at 60%, 120 kg")
      await page.getByRole("button", { name: "Review and update" }).click()
      await page.getByRole("button", { name: /^Save for/ }).click()
      await expect(page.locator("body")).toContainText("Plan updated for")

      // Back as the athlete: his own row, from the corrected best lift, and the new weight for the carry.
      await seedMockSession(page, { role: "athlete" })
      await page.goto("/athlete/log")
      await expect(log).toContainText("4 x 6 at 60%, 120 kg")
      await expect(log).not.toContainText("147.5 kg")
      // 75% of 101 is 75.75, shown to the nearest 2.5 kg.
      await expect(log).toContainText("3 x 5 at 75%, 75 kg")
      await expect(log).not.toContainText("No best Zercher carry saved yet")
      await noSidewaysScroll(page)
    })
  })
}
