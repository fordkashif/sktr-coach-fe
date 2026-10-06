import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// Demo data (mock mode, kept in the browser): Marcus Johnson is the demo athlete, on Sprint Group
// ("t1") with Sarah Chen, David Okafor and Sophia Kim. His bests: 100m 11.28, long jump 6.63.
// "Autumn Open" (mock-comp-relays) is a past meet where he ran the 100m (11.35) and the second
// leg of the 4x100m relay (42.86).

const main = (page: Page) => page.locator("#main-content")
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe("result detail: rounds, splits, attempts and relays (mock mode)", () => {
  test("a jump series: the best attempt is the mark, the best wind legal attempt counts for records", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/prs/add?event=long_jump")

    await page.getByRole("button", { name: "Enter every attempt" }).click()
    // The mark is not typed: it comes from the attempts.
    await expect(page.getByLabel(/Distance or height/)).toHaveCount(0)
    await page.getByLabel("Attempt 1", { exact: true }).fill("6.50")
    await page.getByLabel("Wind of attempt 1").fill("+1.1")
    await page.getByRole("button", { name: "Attempt 2 was a foul" }).click()
    await page.getByLabel("Attempt 3", { exact: true }).fill("6.80")
    await page.getByLabel("Wind of attempt 3").fill("+2.9")
    await expect(page.locator("[data-series-summary]")).toContainText("Mark: 6.80m (+2.9). Wind assisted, so 6.50m (+1.1) is the jump that counts for records.")

    // A gap in the series is refused in plain words.
    await page.getByRole("button", { name: "Attempts 4 to 6" }).click()
    await page.getByLabel("Attempt 5", { exact: true }).fill("6.70")
    await page.getByLabel("Wind of attempt 5").fill("+0.4")
    await page.getByRole("button", { name: "Save result" }).click()
    await expect(page.getByText("Attempt 4 is empty. Tap X for a foul or the dash for a pass.")).toBeVisible()
    await page.getByRole("button", { name: "Attempt 4 was a pass" }).click()
    expect(await noSidewaysScroll(page)).toBe(true)
    await page.getByRole("button", { name: "Save result" }).click()

    // 6.80 is kept as wind assisted; 6.70 is the personal best (it beats 6.63).
    await expect(page).toHaveURL(/\/athlete\/prs\/event\//)
    await expect(main(page)).toContainText("Your longest jump, 6.80m (+2.9), was wind assisted. New personal best in the Long jump: 6.70m (+0.4), 0.07m further than your 6.63m.")
    await expect(main(page)).toContainText("best wind legal jump of a series")

    await page.getByRole("button", { name: /Show the detail of 6\.80m/ }).click()
    const attempts = page.getByRole("table", { name: "Attempts in the Long jump" })
    await expect(attempts.getByRole("row", { name: /^2/ })).toContainText("X (foul)")
    await expect(attempts.getByRole("row", { name: /^3/ })).toContainText("Best, wind assisted")
    await expect(attempts.getByRole("row", { name: /^4/ })).toContainText("- (pass)")
    await expect(attempts.getByRole("row", { name: /^5/ })).toContainText("Best wind legal")
    expect(await noSidewaysScroll(page)).toBe(true)

    // Records: the personal best is the legal jump, the wind assisted one is listed apart.
    await page.goto("/athlete/prs")
    const record = page.getByRole("link", { name: /^Long jump/ })
    await expect(record).toContainText("6.70")
    await expect(record).toContainText("Wind assisted 6.80m (+2.9)")

    // Deleting the series takes its legal mark with it.
    await record.click()
    await page.getByRole("link", { name: /^Edit 6\.80m/ }).click()
    await expect(page.getByLabel("Attempt 3", { exact: true })).toHaveValue("6.80")
    await page.getByRole("button", { name: "Delete result" }).click()
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Delete result" }).click()
    await page.goto("/athlete/prs")
    await expect(page.getByRole("link", { name: /^Long jump/ })).toContainText("6.63")
  })

  test("a high jump: heights with O, X and the dash give the mark and the tie-break counts", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/prs/add?event=high_jump")
    await page.getByRole("button", { name: "Enter every height" }).click()
    await page.getByLabel("Height 1", { exact: true }).fill("1.80")
    await page.getByRole("button", { name: "Cleared 1.80" }).click()
    await page.getByLabel("Height 2", { exact: true }).fill("1.85")
    await page.getByRole("button", { name: "Failed at 1.85" }).click()
    await page.getByRole("button", { name: "Cleared 1.85" }).click()
    await expect(page.getByLabel("Attempts at 1.85")).toHaveValue("XO")
    await page.getByLabel("Height 3", { exact: true }).fill("1.90")
    await page.getByLabel("Attempts at 1.90").fill("xxx")
    await expect(page.locator("[data-series-summary]")).toContainText("Mark: 1.85m. Cleared on the 2nd attempt. For a tie: 1 failure at 1.85, 1 in all up to that height.")
    expect(await noSidewaysScroll(page)).toBe(true)
    await page.getByRole("button", { name: "Save result" }).click()

    await expect(main(page)).toContainText("1.85m is your first High jump result")
    await page.getByRole("button", { name: /Show the detail of 1\.85m/ }).click()
    const heights = page.getByRole("table", { name: "Heights in the High jump" })
    await expect(heights.getByRole("row", { name: /^1\.85m/ })).toContainText("XO")
    await expect(heights.getByRole("row", { name: /^1\.90m/ })).toContainText("Not cleared")
    await expect(main(page)).toContainText("1 failure at 1.85, 1 in all up to that height.")
  })

  test("splits: a split larger than the final time is refused, laps and running times are the same thing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/prs/add?event=800m")
    await page.getByRole("textbox", { name: "Time" }).fill("1:58.20")
    await page.getByRole("button", { name: "Add splits" }).click()
    await page.getByLabel(/^Split 1/).fill("57.90")
    await page.getByRole("button", { name: "Add a split" }).click()
    await page.getByLabel(/^Split 2/).fill("2:01.50")
    await page.getByRole("button", { name: "Save result" }).click()
    await expect(page.getByText("Split 2 (2:01.50) is larger than the final time (1:58.20). A split cannot be larger than the final time.")).toBeVisible()

    // Typed lap by lap instead: what is there is rewritten, nothing is typed twice.
    await page.getByRole("button", { name: "Remove split 2" }).click()
    await page.getByRole("tab", { name: "Each lap" }).click()
    await expect(page.getByLabel(/^Lap 1/)).toHaveValue("57.90")
    await expect(page.locator("[data-splits-summary]")).toContainText("Laps: 57.90, 1:00.30 (+2.40)")
    await page.getByLabel("Round", { exact: true }).selectOption("heat")
    await page.getByLabel(/^Heat/).fill("2")
    await page.getByLabel(/^Lane/).fill("4")
    await page.getByLabel(/^Went through/).selectOption("q")
    expect(await noSidewaysScroll(page)).toBe(true)
    await page.getByRole("button", { name: "Save result" }).click()

    await expect(page).toHaveURL(/\/athlete\/prs\/event\//)
    await page.getByRole("button", { name: /Show the detail of 1:58\.20/ }).click()
    await expect(main(page)).toContainText("Heat 2, lane 4, qualified on time (q).")
    const splits = page.getByRole("table", { name: /Splits of the 800m/ })
    await expect(splits.getByRole("row", { name: /^400m/ })).toContainText("57.90")
    await expect(splits.getByRole("row", { name: /^Finish/ })).toContainText("1:00.30")
    await expect(splits.getByRole("row", { name: /^Finish/ })).toContainText("+2.40s")
  })

  test("rounds: a heat and a final are two results of one entry, and the faster one is the best", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/competitions/mock-comp-relays")

    // The 100m already has one result (11.35). Say it was the final, then add the heat.
    await page.getByRole("button", { name: "100m, change result" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Round", { exact: true }).selectOption("final")
    await dialog.getByRole("button", { name: "Save result" }).click()
    await expect(main(page)).toContainText("100m result updated.")

    await page.getByRole("button", { name: "100m, change result" }).click()
    await dialog.getByRole("button", { name: "Add another round" }).click()
    await expect(dialog.getByRole("heading", { name: "100m, another round" })).toBeVisible()
    // The final is taken: it cannot be picked for a second result.
    await expect(dialog.getByLabel("Round", { exact: true }).locator("option", { hasText: /^Final \(recorded\)$/ })).toBeDisabled()
    await dialog.getByLabel("Round", { exact: true }).selectOption("heat")
    await dialog.getByLabel(/^Heat/).fill("3")
    await dialog.getByLabel(/^Time/).fill("11.20")
    await dialog.getByLabel(/^Wind/).fill("+1.0")
    await dialog.getByLabel(/^Place/).fill("1")
    await dialog.getByLabel(/^Went through/).selectOption("Q")
    await dialog.getByRole("button", { name: "Add a reaction time" }).click()
    await dialog.getByLabel(/^Reaction time/).fill("0.141")
    await dialog.getByRole("button", { name: "Save result" }).click()

    await expect(main(page)).toContainText("New personal best in the 100m: 11.20s (+1.0), 0.08s faster than your 11.28s.")
    const row = page.getByRole("button", { name: "100m, change result" })
    await expect(row).toContainText("Heat 3: 11.20s (+1.0), 1st place, Q")
    await expect(row).toContainText("Final: 11.35s (-1.2), 4th place")
    await expect(row).toContainText("Personal best")
    expect(await noSidewaysScroll(page)).toBe(true)

    // With two rounds the dialog lists them.
    await row.click()
    await expect(dialog.getByRole("heading", { name: "100m results" })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Heat, change result" })).toContainText("11.20")
    await expect(dialog.getByRole("button", { name: "Final, change result" })).toContainText("11.35")
    await page.keyboard.press("Escape")

    await page.goto("/athlete/prs")
    await expect(page.getByRole("link", { name: /^100m/ })).toContainText("11.20")
  })

  test("a relay shows for the athlete with their leg and is not one of their own records", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/competitions/mock-comp-relays")
    const relays = page.getByRole("list", { name: "Your relays at this competition" })
    await expect(relays).toContainText("Relay, leg 2 for Sprint Group A")
    await expect(relays).toContainText("42.86")
    await relays.getByRole("button", { name: /4x100m relay/ }).click()
    const legs = page.getByRole("table", { name: /Legs of the 4x100m relay/ })
    await expect(legs.getByRole("row", { name: /^2/ })).toContainText("Marcus Johnson (you)")
    await expect(legs.getByRole("row", { name: /^1/ })).toContainText("Sarah Chen")
    expect(await noSidewaysScroll(page)).toBe(true)

    // Records: listed under relay teams, never as an event with a personal best.
    await page.goto("/athlete/prs")
    await expect(page.getByRole("heading", { level: 2, name: "Relay teams" })).toBeVisible()
    await expect(page.getByRole("list", { name: "Relays you ran in" })).toContainText("Sep")
    await expect(page.getByRole("link", { name: /^4x100m/ })).toHaveCount(0)
    await expect(page.getByRole("link", { name: /^100m/ })).toContainText("11.28")
  })

  test("a coach enters a relay team with legs and splits, and it becomes the team's relay record", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
    await page.goto("/coach/competitions/mock-comp-summer")
    await expect(page.getByRole("heading", { level: 1, name: "Summer Open" })).toBeVisible()

    await page.getByRole("button", { name: "Add a relay team" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Name of the relay team").fill("Sprint Group A")
    for (const [leg, name, split] of [
      ["1", "Sophia Kim", "11.10"],
      ["2", "Marcus Johnson", "10.30"],
      ["3", "Sarah Chen", "10.70"],
      ["4", "David Okafor", "10.40"],
    ] as const) {
      await dialog.getByLabel(`Leg ${leg}`, { exact: true }).selectOption({ label: name })
      await dialog.getByLabel(`Split of leg ${leg}`).fill(split)
    }
    // An athlete already named cannot be picked for another leg.
    await expect(dialog.getByLabel("Leg 4", { exact: true }).locator("option", { hasText: "Sophia Kim" })).toBeDisabled()

    // A leg split larger than the relay's time is refused in plain words.
    await dialog.getByLabel(/^Time/).fill("9.90")
    await dialog.getByRole("button", { name: "Save relay" }).click()
    await expect(dialog).toContainText("The split of leg 1 (11.10) is larger than the relay's time (9.90).")
    await dialog.getByLabel(/^Time/).fill("42.50")
    await dialog.getByLabel(/^Place/).fill("1")
    await dialog.getByLabel("Round", { exact: true }).selectOption("final")
    await dialog.getByRole("button", { name: "Save relay" }).click()

    // Faster than the 42.86 of the Autumn Open: the team's record.
    await expect(main(page)).toContainText("Sprint Group A, 4x100m relay: 42.50s. That is the fastest 4x100m relay on record for Sprint Group.")
    const list = page.getByRole("list", { name: "Relay teams at Summer Open" })
    await expect(list).toContainText("Sophia Kim, Marcus Johnson, Sarah Chen, David Okafor")
    await expect(list).toContainText("Final, 1st place")

    // The results sheet keeps its old columns and adds the new ones at the end.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export results (CSV)" }).click()])
    const csv = readFileSync(await download.path(), "utf8")
    // Every cell is quoted in the file; compare without the quotes.
    const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/).map((line) => line.replace(/"/g, ""))
    expect(lines[0]).toBe("Athlete,Event,Status,Mark,Wind,Wind legal,Place,Best,Date,Note,Round,Heat,Lane,Qualifier,Reaction,Splits,Attempts or heights,Relay legs")
    expect(lines.find((line) => line.startsWith("Marcus Johnson,200m"))).toContain(",Final,,5,,0.162,11.58,,")
    expect(lines.find((line) => line.startsWith("Marcus Johnson,Long jump"))).toContain("X; 6.48 (+2.4); 6.71 (+2.9); X; 6.55 (+2.3); -")
    expect(lines.find((line) => line.startsWith("Sprint Group A (relay team)"))).toContain("1 Sophia Kim (11.10); 2 Marcus Johnson (10.30); 3 Sarah Chen (10.70); 4 David Okafor (10.40)")

    // The calendar lists the relay record.
    await page.goto("/coach/competitions")
    const records = page.getByRole("list", { name: "Relay records" })
    await expect(records).toContainText("4x100m relay, Sprint Group")
    await expect(records).toContainText("42.50")

    // The relay is nobody's individual result: Marcus's 100m best is what it was.
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/prs")
    await expect(page.getByRole("link", { name: /^100m/ })).toContainText("11.28")
    await expect(page.getByRole("list", { name: "Relays you ran in" })).toContainText("42.50")
  })

  test("a coach types heats in the grid and the attempts of a jump in the detail of a row", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
    await page.goto("/coach/competitions/mock-comp-summer")
    const cell = (name: string) => page.getByRole("textbox", { name })
    await expect(cell("Marcus Johnson, 100m, Mark")).toHaveValue("11.28")

    // Heats are their own round: the grid starts empty for it and the final stays.
    await page.getByLabel("Round to type").selectOption("heat")
    await expect(cell("Marcus Johnson, 100m, Mark")).toHaveValue("")
    await cell("Marcus Johnson, 100m, Mark").fill("11.40")
    await cell("Marcus Johnson, 200m, Mark").focus()
    await expect(main(page)).toContainText("All results saved")
    await page.getByLabel("Round to type").selectOption("final")
    await expect(cell("Marcus Johnson, 100m, Mark")).toHaveValue("11.28")
    await expect(main(page).getByRole("button", { name: "Rounds and detail for Marcus Johnson, 100m" })).toContainText("2 rounds")

    // The long jump has a series: its mark cannot be typed over in the grid.
    await cell("Marcus Johnson, Long jump, Mark").fill("7.00")
    await cell("Marcus Johnson, 200m, Mark").focus()
    await cell("Marcus Johnson, Long jump, Mark").focus()
    await expect(main(page)).toContainText("This mark comes from the attempts typed for this result. Open Rounds and detail to change them.")

    // In the detail the coach corrects the wind of the best jump, which makes it legal.
    await page.getByRole("button", { name: "Rounds and detail for Marcus Johnson, Long jump" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByLabel("Attempt 3", { exact: true })).toHaveValue("6.71")
    await dialog.getByLabel("Wind of attempt 3").fill("+1.9")
    expect(await noSidewaysScroll(page)).toBe(true)
    await dialog.getByRole("button", { name: "Save result" }).click()
    await expect(main(page)).toContainText("Saved. Personal best for Marcus Johnson in the Long jump: 6.71m (+1.9).")
    await expect(cell("Marcus Johnson, Long jump, Wind")).toHaveValue("+1.9")
    expect(await noSidewaysScroll(page)).toBe(true)
  })
})
