import { expect, test, type Page } from "@playwright/test"
import { seedMockSession, type Role } from "./helpers/session"

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

async function signIn(page: Page, role: Role) {
  await seedMockSession(page, role === "coach" ? { role, coachTeamId: "t1" } : { role })
}

/** Chooses the units under Your account, the way a person does. */
async function chooseUnits(page: Page, units: { weight?: "kg" | "lb"; height?: "cm" | "ft_in" }) {
  await page.goto("/account")
  const section = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Units" }) })
  if (units.weight) {
    await section.getByLabel("Weights in").selectOption(units.weight)
    await expect(section.getByLabel("Weights in")).toHaveValue(units.weight)
    await expect(section.getByLabel("Weights in")).toBeEnabled()
  }
  if (units.height) {
    await section.getByLabel("Body height in").selectOption(units.height)
    await expect(section.getByLabel("Body height in")).toHaveValue(units.height)
    await expect(section.getByLabel("Body height in")).toBeEnabled()
  }
  return section
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`units of measure at ${viewport.width}px`, () => {
    test.use({ viewport })
    // Each test signs in as several people in turn, so it is long.
    test.beforeEach(() => test.setTimeout(150_000))

    test("an athlete switches to pounds, logs in pounds, and what is stored stays in kilograms", async ({ page }) => {
      await signIn(page, "athlete")

      // Kilograms until they choose.
      await page.goto("/account")
      const section = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Units" }) })
      await expect(section.getByLabel("Weights in")).toHaveValue("kg")
      await expect(section.getByLabel("Body height in")).toHaveValue("cm")
      await expect(section).toContainText("Throws, jumps and times always stay in metres and seconds")
      await expect(section).toContainText("These are your club's units.")

      await chooseUnits(page, { weight: "lb" })
      await expect(section).not.toContainText("These are your club's units.")
      await shot(page, "account-units")
      await noSidewaysScroll(page)

      // The choice is saved with the account, not with the page.
      await page.reload()
      await expect(section.getByLabel("Weights in")).toHaveValue("lb")

      await page.goto("/athlete/log")
      await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()
      const squat = page.locator('[data-exercise="Back squat"]')
      // The coach wrote 3 x 5 at 120kg.
      await expect(squat).toContainText("3 x 5 at 264.5lb")
      await expect(squat).not.toContainText("kg")
      await squat.getByLabel("Back squat, set 1, reps").fill("5")
      await squat.getByLabel("Back squat, set 1, load in pounds").fill("225")
      // Ticking an empty set fills it from the coach target (120 kg is 264.5 lb).
      await squat.getByRole("button", { name: "Back squat, set 2, mark as done" }).click()
      await expect(squat.getByLabel("Back squat, set 2, load in pounds")).toHaveValue("264.5")

      const clean = page.locator('[data-exercise="Power clean"]')
      await clean.getByRole("button", { name: "Same as target" }).click()
      await expect(clean.getByLabel("Power clean, set 4, load in pounds")).toHaveValue("209.5")

      // Times and distances are untouched.
      await page.locator('[data-exercise="30m from blocks"]').getByLabel("30m from blocks, rep 1, time in seconds").fill("4.21")
      await expect(page.locator('[data-sync="saved"]').first()).toBeVisible()
      await shot(page, "athlete-log-lb")
      await noSidewaysScroll(page)

      await page.getByRole("radio", { name: "7, Hard" }).click()
      await page.getByRole("button", { name: "Finish session" }).click()
      await page.waitForURL(/\/athlete\/home/)

      await page.goto("/athlete/log")
      await expect(page.getByRole("heading", { name: "What you logged" })).toBeVisible()
      await expect(page.locator('[data-logged="Back squat"]')).toContainText("5 x 225 lb, 5 x 264.5 lb")
      await expect(page.locator('[data-logged="Back squat"]')).toContainText("Target: 3 x 5 at 264.5lb")
      await expect(page.locator('[data-logged="Power clean"]')).toContainText("3 x 209.5 lb")
      await expect(page.locator('[data-logged="30m from blocks"]')).toContainText("4.21 s")
      await shot(page, "athlete-logged-lb")

      // Editing brings the pounds back as typed.
      await page.getByRole("button", { name: "Edit" }).click()
      await expect(page.getByLabel("Back squat, set 1, load in pounds")).toHaveValue("225")

      // Back on kilograms the same session reads in kilograms: 225 lb was stored as 102.06 kg.
      await chooseUnits(page, { weight: "kg" })
      await page.goto("/athlete/log")
      await expect(page.locator('[data-logged="Back squat"]')).toContainText("5 x 102.06 kg, 5 x 120 kg")
      await expect(page.locator('[data-logged="Power clean"]')).toContainText("3 x 95 kg")
    })

    test("body height in feet and inches and body weight in pounds on the athlete profile", async ({ page }) => {
      await signIn(page, "athlete")
      await chooseUnits(page, { weight: "lb", height: "ft_in" })

      await page.goto("/athlete/profile")
      await page.getByRole("button", { name: /Edit/ }).first().click()
      await page.getByLabel("Height, feet").fill("5")
      await page.getByLabel("Height, inches").fill("11")
      await page.getByLabel("Weight in lb").fill("165.5")
      await shot(page, "profile-edit-ft-lb")
      await noSidewaysScroll(page)
      await page.getByRole("button", { name: /^Save/ }).click()
      const body = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Body and health" }) })
      await expect(body).toContainText("5 ft 11 in")
      await expect(body).toContainText("165.5 lb")
      await shot(page, "profile-ft-lb")

      // An impossible height is refused in the units it was typed in.
      await page.getByRole("button", { name: /Edit/ }).first().click()
      await expect(page.getByLabel("Height, feet")).toHaveValue("5")
      await expect(page.getByLabel("Height, inches")).toHaveValue("11")
      await page.getByLabel("Height, inches").fill("14")
      await page.getByRole("button", { name: /^Save/ }).click()
      await expect(page.locator("#main-content")).toContainText("Enter your height in feet and inches")
      await page.getByLabel("Height, inches").fill("11")
      await page.getByRole("button", { name: /^Save/ }).click()
      await expect(body).toContainText("5 ft 11 in")

      // Stored metric: on centimetres and kilograms it reads 180.3 cm and 75.1 kg.
      await chooseUnits(page, { weight: "kg", height: "cm" })
      await page.goto("/athlete/profile")
      await expect(body).toContainText("180.3 cm")
      await expect(body).toContainText("75.1 kg")
    })

    test("a coach on pounds reads an athlete's kilogram log, and logs for an athlete in pounds", async ({ page }) => {
      // The athlete, on kilograms, logs a set at 122.5 kg.
      await signIn(page, "athlete")
      await page.goto("/athlete/log")
      const squat = page.locator('[data-exercise="Back squat"]')
      await squat.getByLabel("Back squat, set 1, reps").fill("5")
      await squat.getByLabel("Back squat, set 1, load in kilograms").fill("122.5")
      await expect(page.locator('[data-sync="saved"]').first()).toBeVisible()
      await page.getByRole("radio", { name: "7, Hard" }).click()
      await page.getByRole("button", { name: "Finish session" }).click()
      await page.waitForURL(/\/athlete\/home/)

      // The coach reads it in pounds.
      await signIn(page, "coach")
      await chooseUnits(page, { weight: "lb" })
      await page.goto("/coach/athletes/a1")
      const logged = page.locator("[data-session]").first()
      await expect(logged.locator("[data-session-results]")).toContainText("5 x 270 lb")
      await expect(logged.locator("[data-session-results]")).toContainText("target 3 x 5 at 264.5lb")
      await expect(logged.locator("[data-session-results]")).not.toContainText("kg")
      await shot(page, "coach-athlete-sessions-lb")
      await noSidewaysScroll(page)

      // Logging for another athlete: the coach types pounds.
      await page.goto("/coach/athletes/a2/log")
      await expect(page.locator("[data-logging-for]")).toContainText("Logging for Sarah Chen")
      const clean = page.locator('[data-exercise="Power clean"]')
      await expect(clean).toContainText("4 x 3 at 209.5lb")
      await clean.getByLabel("Power clean, set 1, reps").fill("3")
      await clean.getByLabel("Power clean, set 1, load in pounds").fill("205")
      await expect(page.locator('[data-coach-log-save="saved"]')).toBeVisible()
      await shot(page, "coach-log-for-athlete-lb")
      await page.getByRole("button", { name: "Finish session for Sarah" }).click()
      await page.goto("/coach/athletes/a2")
      await expect(page.locator("[data-session]").first()).toContainText("3 x 205 lb")

      // The athlete still reads their own log in kilograms: nothing stored changed.
      await signIn(page, "athlete")
      await page.goto("/athlete/log")
      await expect(page.locator('[data-logged="Back squat"]')).toContainText("5 x 122.5 kg")

      // The coach back on kilograms sees the 205 lb set as the kilograms that were stored.
      await signIn(page, "coach")
      await chooseUnits(page, { weight: "kg" })
      await page.goto("/coach/athletes/a2")
      await expect(page.locator("[data-session]").first()).toContainText("3 x 92.99 kg")
    })

    test("a coach on pounds writes a plan: a percentage resolves to pounds, a typed load is stored metric", async ({ page }) => {
      await signIn(page, "coach")
      await chooseUnits(page, { weight: "lb" })

      // Best lifts are read and typed in pounds (Marcus Johnson's best back squat is 185 kg).
      await page.goto("/coach/training-plan/maxes")
      await expect(page.getByRole("heading", { level: 1, name: "Best lifts" })).toBeVisible()
      await expect(page.locator("#main-content")).toContainText("in pounds")
      await expect(page.locator("#main-content")).toContainText("to the nearest 5 lb")
      await expect(page.getByLabel("Marcus Johnson, Back squat")).toHaveValue("408")
      await page.getByLabel("Add a lift").fill("Bench press")
      await page.getByRole("button", { name: "Add column" }).click()
      const bench = page.getByLabel("Marcus Johnson, Bench press")
      await bench.fill("315")
      await bench.press("Tab")
      await expect(page.getByLabel("Marcus Johnson, Bench press")).toHaveValue("315")
      await shot(page, "best-lifts-lb")
      await noSidewaysScroll(page)

      await page.goto("/coach/training-plan")
      await page.getByRole("button", { name: "New plan" }).click()
      await page.getByLabel("Plan name").fill("Plan in pounds")
      await page.getByRole("button", { name: "Continue to build" }).click()
      await expect(page.getByRole("heading", { name: "Plan in pounds" })).toBeVisible()
      await page.locator('[data-day-index="0"]').click()
      await page.getByLabel("Session title").fill("Gym day")
      await page.getByRole("button", { name: "Strength", exact: true }).click()
      await page.getByRole("button", { name: "Add exercise" }).click()

      // Row 1: a percentage. It has no unit; each reader gets the weight in theirs.
      await page.getByLabel("Block 1 exercise 1 name", { exact: true }).fill("Back squat")
      await page.getByLabel("Block 1 exercise 1 sets", { exact: true }).fill("4")
      await page.getByLabel("Block 1 exercise 1 reps", { exact: true }).fill("4")
      const load1 = page.getByLabel("Block 1 exercise 1 load", { exact: true })
      await expect(load1).toHaveAttribute("placeholder", "lb or %")
      await load1.fill("80%")
      await expect(load1).toHaveValue("80%")
      await page.getByRole("button", { name: "More for block 1 exercise 1" }).click()
      await page.getByRole("menuitem", { name: "Adjust for an athlete" }).click()
      await page.getByLabel("Block 1 exercise 1 change for which athlete").selectOption({ label: "David Okafor" })
      await page.getByLabel("Block 1 exercise 1 load for David Okafor").fill("70%")
      // 70% of David's best (175 kg, 385.8 lb) is 270 lb to the nearest 5 lb.
      await expect(page.locator("[data-override-summary]")).toHaveText("David Okafor gets 4 x 4 at 70%, 270 lb")

      // Row 2: a weight typed in pounds.
      await load1.press("Enter")
      await page.getByLabel("Block 1 exercise 2 name", { exact: true }).fill("Bench press")
      await page.getByLabel("Block 1 exercise 2 sets", { exact: true }).fill("3")
      await page.getByLabel("Block 1 exercise 2 reps", { exact: true }).fill("5")
      const load2 = page.getByLabel("Block 1 exercise 2 load", { exact: true })
      await load2.fill("225")
      await load2.blur()
      await expect(load2).toHaveValue("225 lb")
      await shot(page, "builder-lb")
      await noSidewaysScroll(page)

      await page.getByRole("button", { name: "Publish", exact: true }).click()
      await page.getByRole("button", { name: /^Publish to/ }).click()
      await expect(page.locator("body")).toContainText("Plan published to")

      // The athlete on kilograms: 80% of 185 kg to the nearest 2.5 kg, and the coach's 225 lb as kilograms.
      await signIn(page, "athlete")
      await page.goto("/athlete/log")
      const log = page.locator("#main-content")
      await expect(log).toContainText("Gym day")
      await expect(log).toContainText("4 x 4 at 80%, 147.5 kg")
      await expect(log).toContainText("3 x 5 at 102.06 kg")

      // The same athlete on pounds: 80% of 408 lb to the nearest 5 lb, and 225 lb as the coach typed it.
      await chooseUnits(page, { weight: "lb" })
      await page.goto("/athlete/log")
      await expect(log).toContainText("4 x 4 at 80%, 325 lb")
      await expect(log).toContainText("3 x 5 at 225 lb")
      // "Same as target" fills the pounds on the bar.
      const squat = page.locator('[data-exercise="Back squat"]')
      await squat.getByRole("button", { name: "Same as target" }).click()
      await expect(squat.getByLabel("Back squat, set 1, load in pounds")).toHaveValue("325")
      const benchRow = page.locator('[data-exercise="Bench press"]')
      await benchRow.getByRole("button", { name: "Same as target" }).click()
      await expect(benchRow.getByLabel("Bench press, set 1, load in pounds")).toHaveValue("225")
      await shot(page, "athlete-log-percent-lb")
      await noSidewaysScroll(page)

      // The coach on kilograms opens the plan: the load box shows what was stored.
      await signIn(page, "coach")
      await chooseUnits(page, { weight: "kg" })
      await page.goto("/coach/training-plan")
      await page.locator('li[data-plan-status="published"]', { hasText: "Plan in pounds" }).getByRole("button", { name: /Plan in pounds/ }).first().click()
      await page.locator('[data-day-index="0"]').click()
      await expect(page.getByLabel("Block 1 exercise 2 load", { exact: true })).toHaveValue("102.06 kg")
      await expect(page.getByLabel("Block 1 exercise 1 load", { exact: true })).toHaveValue("80%")
      await expect(page.locator("[data-override-summary]")).toHaveText("David Okafor gets 4 x 4 at 70%, 122.5 kg")
      await page.goto("/coach/training-plan/maxes")
      await expect(page.getByLabel("Marcus Johnson, Bench press")).toHaveValue("142.88")
      await expect(page.getByLabel("Marcus Johnson, Back squat")).toHaveValue("185")
    })

    test("a club admin sets the club default, members start from it, and a guardian has their own", async ({ page }) => {
      await signIn(page, "club-admin")
      await page.goto("/club-admin/profile")
      const clubUnits = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Units" }) })
      await expect(clubUnits.getByLabel("Weights in")).toHaveValue("kg")
      await clubUnits.getByLabel("Weights in").selectOption("lb")
      await expect(clubUnits.getByLabel("Weights in")).toBeEnabled()
      await expect(clubUnits.getByLabel("Weights in")).toHaveValue("lb")
      await expect(clubUnits).toContainText("Throws, jumps and times always stay in metres and seconds")
      await clubUnits.scrollIntoViewIfNeeded()
      await shot(page, "club-units")
      await noSidewaysScroll(page)

      // An athlete who never chose now reads pounds, and is told these are the club's units.
      await signIn(page, "athlete")
      await page.goto("/account")
      const own = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Units" }) })
      await expect(own.getByLabel("Weights in")).toHaveValue("lb")
      await expect(own).toContainText("These are your club's units.")
      await page.goto("/athlete/log")
      await expect(page.locator('[data-exercise="Back squat"]')).toContainText("3 x 5 at 264.5lb")

      // Their own choice wins over the club's.
      await chooseUnits(page, { weight: "kg" })
      await page.goto("/athlete/log")
      await expect(page.locator('[data-exercise="Back squat"]')).toContainText("3 x 5 at 120kg")

      // A guardian reads their child's results in the guardian's own units.
      await signIn(page, "guardian")
      await page.goto("/account")
      await expect(own.getByLabel("Weights in")).toHaveValue("lb")
      await page.goto("/guardian/results?child=a8")
      await expect(page.locator("#main-content")).toContainText("Back squat")
      await expect(page.locator("#main-content")).toContainText("198.5lb")
      await shot(page, "guardian-results-lb")
      await chooseUnits(page, { weight: "kg" })
      await page.goto("/guardian/results?child=a8")
      await expect(page.locator("#main-content")).toContainText("90kg")
    })
  })
}
