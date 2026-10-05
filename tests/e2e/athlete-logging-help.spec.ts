import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

async function openLog(page: Page) {
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/log")
  // Mock mode always has this session planned for today, and the same one done a week ago.
  await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()
}

const saved = (page: Page) => expect(page.locator('[data-sync="saved"]').first()).toBeVisible()

test.describe("athlete log: last time, quick repeat, effort, notes, timer (mock mode)", () => {
  test("shows last time under an exercise and opens the full set list", async ({ page }) => {
    await openLog(page)
    const squat = page.locator('[data-exercise="Back squat"]')
    const line = squat.getByRole("button", { name: /Last time: 3 x 5 at 120kg/ })
    await expect(line).toContainText("effort 7 to 8")
    await expect(line).toHaveAttribute("aria-expanded", "false")

    await line.click()
    const sets = squat.getByRole("list", { name: "Back squat, sets last time" }).getByRole("listitem")
    await expect(sets).toHaveCount(3)
    await expect(sets.nth(2)).toContainText("Set 3")
    await expect(sets.nth(2)).toContainText("5 x 120 kg")
    await expect(sets.nth(2)).toContainText("Effort 8")
    await expect(squat).toContainText("Whole session: effort 7 out of 10.")
    await expect(squat).toContainText("Your note: Last set was slow out of the hole.")

    await line.click()
    await expect(squat.getByRole("list", { name: "Back squat, sets last time" })).toHaveCount(0)

    // A warm up that is only ticked has no last time line.
    await expect(page.locator('[data-exercise="Warm up"]').getByText(/Last time/)).toHaveCount(0)
  })

  test("same as last time fills the sets in one tap, and only what changed is edited", async ({ page }) => {
    await openLog(page)
    const squat = page.locator('[data-exercise="Back squat"]')
    await squat.getByRole("button", { name: "Same as last time" }).click()
    for (const set of [1, 2, 3]) {
      await expect(squat.getByLabel(`Back squat, set ${set}, reps`)).toHaveValue("5")
      await expect(squat.getByLabel(`Back squat, set ${set}, load in kilograms`)).toHaveValue("120")
      await expect(squat.getByRole("button", { name: `Back squat, set ${set}, done` })).toHaveAttribute("aria-pressed", "true")
    }
    // Today's effort is not copied from last time.
    await expect(squat.getByRole("button", { name: "Back squat, set 1, effort, not rated" })).toBeVisible()
    await squat.getByLabel("Back squat, set 3, load in kilograms").fill("125")

    // A set already done today is kept.
    const sprints = page.locator('[data-exercise="30m from blocks"]')
    await sprints.getByLabel("30m from blocks, rep 1, time in seconds").fill("4.11")
    await sprints.getByRole("button", { name: "Same as last time" }).click()
    await expect(sprints.getByLabel("30m from blocks, rep 1, time in seconds")).toHaveValue("4.11")
    await expect(sprints.getByLabel("30m from blocks, rep 2, time in seconds")).toHaveValue("4.23")
    await expect(sprints.getByLabel("30m from blocks, rep 4, time in seconds")).toHaveValue("4.29")

    await saved(page)
    await page.reload()
    await expect(page.getByLabel("Back squat, set 3, load in kilograms")).toHaveValue("125")
    await expect(page.getByLabel("30m from blocks, rep 2, time in seconds")).toHaveValue("4.23")
  })

  test("effort per set and a note per exercise are saved, reload, and show in the finished log", async ({ page }) => {
    await openLog(page)
    const squat = page.locator('[data-exercise="Back squat"]')
    await squat.getByLabel("Back squat, set 1, reps").fill("5")
    await squat.getByLabel("Back squat, set 1, load in kilograms").fill("122.5")
    await squat.getByRole("button", { name: "Back squat, set 1, effort, not rated" }).click()
    const sheet = page.getByRole("dialog", { name: "Effort, set 1" })
    await sheet.getByRole("radio", { name: "8, Hard" }).click()
    await expect(sheet).toBeHidden()
    await expect(squat.getByRole("button", { name: "Back squat, set 1, effort 8 out of 10" })).toHaveText("8")

    await squat.getByLabel("Back squat, set 2, reps").fill("5")
    await squat.getByLabel("Back squat, set 2, load in kilograms").fill("122.5")
    await squat.getByRole("button", { name: "Back squat, set 2, effort, not rated" }).click()
    await page.getByRole("dialog", { name: "Effort, set 2" }).getByRole("radio", { name: "9, Very hard" }).click()

    await squat.getByRole("button", { name: "Add note" }).click()
    await squat.getByLabel("Back squat, note").fill("Left knee felt fine today")
    await saved(page)

    await page.reload()
    await expect(page.getByRole("button", { name: "Back squat, set 1, effort 8 out of 10" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Back squat, set 2, effort 9 out of 10" })).toBeVisible()
    await expect(page.getByLabel("Back squat, note")).toHaveValue("Left knee felt fine today")

    await page.getByRole("button", { name: "Finish session" }).click()
    await expect(page.getByText("Nice work. That is logged.")).toBeVisible()
    await page.waitForURL(/\/athlete\/home/)

    // Reopening the past log shows both.
    await page.goto("/athlete/log")
    const logged = page.locator('[data-logged="Back squat"]')
    await expect(logged).toContainText("5 x 122.5 kg, 5 x 122.5 kg")
    await expect(logged).toContainText("Effort by set: 8, 9")
    await expect(logged).toContainText("Your note: Left knee felt fine today")

    // Clearing an effort: tap the chosen number again.
    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByRole("button", { name: "Back squat, set 2, effort 9 out of 10" }).click()
    await page.getByRole("dialog", { name: "Effort, set 2" }).getByRole("radio", { name: "9, Very hard" }).click()
    await expect(page.getByRole("button", { name: "Back squat, set 2, effort, not rated" })).toBeVisible()
  })

  test("effort and a note typed with no signal are kept and sent when the phone is back online", async ({ page, context }) => {
    await openLog(page)
    await context.setOffline(true)
    const clean = page.locator('[data-exercise="Power clean"]')
    await clean.getByLabel("Power clean, set 1, reps").fill("3")
    await clean.getByRole("button", { name: "Power clean, set 1, effort, not rated" }).click()
    await page.getByRole("dialog", { name: "Effort, set 1" }).getByRole("radio", { name: "6, Moderate" }).click()
    await clean.getByRole("button", { name: "Add note" }).click()
    await clean.getByLabel("Power clean, note").fill("Bar path drifted forward")
    await expect(page.locator('[data-sync="retrying"]').first()).toBeVisible({ timeout: 15_000 })
    // Still on the screen while unsent.
    await expect(clean.getByRole("button", { name: "Power clean, set 1, effort 6 out of 10" })).toBeVisible()

    await context.setOffline(false)
    await expect(page.locator('[data-sync="saved"]').first()).toBeVisible({ timeout: 30_000 })
    await page.reload()
    await expect(page.getByRole("button", { name: "Power clean, set 1, effort 6 out of 10" })).toBeVisible()
    await expect(page.getByLabel("Power clean, note")).toHaveValue("Bar path drifted forward")
  })

  test("rest timer: starts from the coach's rest, keeps time while the tab sleeps, cues the finish", async ({ page }) => {
    await page.addInitScript(() => {
      const buzz: unknown[] = []
      ;(window as unknown as { __buzz: unknown[] }).__buzz = buzz
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: (pattern: unknown) => (buzz.push(pattern), true) })
    })
    await page.clock.install()
    await page.setViewportSize({ width: 390, height: 844 })
    await openLog(page)

    const bar = page.locator("[data-sk-actionbar]")
    // Before any set: 60 seconds.
    await expect(bar.getByRole("button", { name: "Rest 1:00" })).toBeVisible()

    // The strength block says "Rest 2 min between sets", so ticking a squat set offers 2:00.
    await page.getByRole("button", { name: "Back squat, set 1, mark as done" }).click()
    await bar.getByRole("button", { name: "Rest 2:00" }).click()
    const timer = bar.getByRole("timer", { name: "Rest left" })
    await expect(timer).toHaveText(/^(2:00|1:5\d)$/)

    // The phone was locked for 75 seconds: timers fire once at most, the reading is still right.
    await page.clock.fastForward(75_000)
    await expect(timer).toHaveText(/^0:4[3-5]$/)
    expect(await page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz.length)).toBe(0)

    // It stays in view while the athlete scrolls, above the tab bar.
    await page.locator("#main-content").evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    const box = await bar.boundingBox()
    const tabs = await page.locator('[data-shell="tabbar"]').boundingBox()
    expect(box && tabs && box.y >= 0 && box.y + box.height <= tabs.y + 1).toBeTruthy()
    await expect(timer).toBeVisible()

    await bar.getByRole("button", { name: "+30 s" }).click()
    await expect(timer).toHaveText(/^1:1[2-5]$/)

    await page.clock.fastForward(80_000)
    await expect(bar.locator('[data-clock="rest-over"]')).toBeVisible()
    await expect(bar.getByText("Rest over", { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz.length)).toBe(1)

    await bar.getByRole("button", { name: "Done" }).click()
    await expect(bar.locator('[data-clock="idle"]')).toBeVisible()

    // The quick choices.
    await bar.getByRole("button", { name: "Choose another rest time" }).click()
    const sheet = page.getByRole("dialog", { name: "Rest timer" })
    for (const choice of ["30 s", "60 s", "90 s", "2 min", "3 min"]) await expect(sheet.getByRole("button", { name: `Rest ${choice}`, exact: true })).toBeVisible()
    await sheet.getByRole("button", { name: "Rest 90 s", exact: true }).click()
    await expect(bar.getByRole("timer", { name: "Rest left" })).toHaveText(/^(1:30|1:2\d)$/)

    // A reload does not lose the countdown.
    await page.clock.fastForward(30_000)
    await page.reload()
    await expect(page.locator("[data-sk-actionbar]").getByRole("timer", { name: "Rest left" })).toHaveText(/^0:5\d$/)
    await page.locator("[data-sk-actionbar]").getByRole("button", { name: "Stop" }).click()
    await expect(page.locator('[data-sk-actionbar] [data-clock="idle"]')).toBeVisible()

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy()
  })

  test("stopwatch: times a rep and drops the time into the next open rep", async ({ page }) => {
    await page.clock.install()
    await page.setViewportSize({ width: 390, height: 844 })
    await openLog(page)

    const sprints = page.locator('[data-exercise="30m from blocks"]')
    await sprints.getByRole("button", { name: "Stopwatch" }).click()
    const bar = page.locator("[data-sk-actionbar]")
    const watch = bar.getByRole("timer", { name: "Stopwatch" })
    await expect(watch).toHaveText("0:00.00")
    await expect(bar).toContainText("30m from blocks, rep 1")

    await bar.getByRole("button", { name: "Start" }).click()
    // Backgrounded for a while: the reading comes from the clock, not from counted ticks.
    await page.clock.fastForward(4_210)
    await bar.getByRole("button", { name: "Stop", exact: true }).click()
    const reading = (await watch.textContent()) ?? ""
    expect(reading).toMatch(/^0:04\.[2-9]\d$/)

    await bar.getByRole("button", { name: "Use for rep 1" }).click()
    // The stopped reading can settle one hundredth after it was read above, so check the shape, not the exact digits.
    await expect(sprints.getByLabel("30m from blocks, rep 1, time in seconds")).toHaveValue(/^4\.[2-9]\d?$/)
    await expect(sprints.getByRole("button", { name: "30m from blocks, rep 1, done" })).toHaveAttribute("aria-pressed", "true")

    // Ready for the next rep straight away.
    await expect(watch).toHaveText("0:00.00")
    await expect(bar).toContainText("30m from blocks, rep 2")
    await bar.getByRole("button", { name: "Start" }).click()
    await page.clock.fastForward(65_300)
    await bar.getByRole("button", { name: "Stop", exact: true }).click()
    await expect(watch).toHaveText(/^1:05\.\d\d$/)
    await bar.getByRole("button", { name: "Use for rep 2" }).click()
    await expect(sprints.getByLabel("30m from blocks, rep 2, time in seconds")).toHaveValue(/^1:05/)

    await bar.getByRole("button", { name: "Close stopwatch" }).click()
    await expect(bar.locator('[data-clock="idle"]')).toBeVisible()
    await saved(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy()
  })
})
