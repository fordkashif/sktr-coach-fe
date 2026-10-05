import { expect, test } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

test.describe("athlete results, records and competitions (mock mode)", () => {
  test("Progress keeps its tab lit and its sections one tap away", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/athlete/trends")

    const tabBar = page.locator("nav[data-shell='tabbar']")
    const sections = page.getByRole("navigation", { name: "Progress sections" })
    for (const [label, heading, url] of [
      ["Records", "Records", /\/athlete\/prs$/],
      ["Competitions", "Competitions", /\/athlete\/competitions$/],
      ["Tests", "Test week", /\/athlete\/test-week$/],
      ["Overview", "Progress", /\/athlete\/trends$/],
    ] as const) {
      await sections.getByRole("link", { name: label }).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
      await expect(tabBar).toBeVisible()
      await expect(tabBar.getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page")
    }
  })

  test("a manual result that beats the best becomes the personal best", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/prs")

    // The demo athlete's 100m best is 11.28 (a faster 11.21 was wind assisted).
    const row = page.getByRole("link", { name: /^100m/ })
    await expect(row).toContainText("11.28")
    await expect(row).toContainText("Wind assisted 11.21s (+2.6)")

    await page.getByRole("link", { name: "Add a result" }).click()
    await page.getByLabel("Event").selectOption("100m")

    // A badly typed time is refused before anything is saved.
    await page.getByRole("textbox", { name: "Time" }).fill("11.123")
    await page.getByRole("button", { name: "Save result" }).click()
    await expect(page.getByText("Times go to hundredths, like 10.84.")).toBeVisible()

    // Faster, but with too much wind: kept, not a best.
    await page.getByRole("textbox", { name: "Time" }).fill("11.10")
    await page.getByLabel(/^Wind/).fill("+2.4")
    await page.getByRole("button", { name: "Save result" }).click()
    await expect(page).toHaveURL(/\/athlete\/prs\/event\//)
    await expect(page.getByText(/Saved as wind assisted/)).toBeVisible()
    await expect(page.getByText("11.28s", { exact: true }).first()).toBeVisible()

    // Legal wind: a personal best, and it says by how much.
    await page.getByRole("link", { name: "Add a result" }).click()
    await page.getByRole("textbox", { name: "Time" }).fill("11.19")
    await page.getByLabel(/^Wind/).fill("+1.4")
    await page.getByRole("button", { name: "Save result" }).click()
    await expect(page.getByText("New personal best in the 100m: 11.19s (+1.4), 0.09s faster than your 11.28s. Your coach will see it.")).toBeVisible()

    await page.goto("/athlete/prs")
    await expect(page.getByRole("link", { name: /^100m/ })).toContainText("11.19")
    await expect(page.getByRole("link", { name: /^100m/ })).toContainText("Wind assisted 11.10s (+2.4)")

    // It survives a reload and can be deleted again, which gives the old best back.
    await page.reload()
    await page.getByRole("link", { name: /^100m/ }).click()
    await page.getByRole("link", { name: /^Edit 11\.19s \(\+1\.4\)/ }).click()
    await page.getByRole("button", { name: "Delete result" }).click()
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Delete result" }).click()
    await expect(page.getByText(/Result deleted/)).toBeVisible()
    await page.goto("/athlete/prs")
    await expect(page.getByRole("link", { name: /^100m/ })).toContainText("11.28")
  })

  test("add a competition, enter a result, see it in records", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/competitions")
    await expect(page.getByRole("link", { name: /City Sprint Classic/ })).toContainText("100m, 200m")

    await page.getByRole("link", { name: "Add a competition" }).click()
    const yesterday = new Date(Date.now() - 86_400_000)
    const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`
    await page.getByLabel("Name").fill("Friday Night Jumps")
    await page.getByLabel("Date", { exact: true }).fill(day)
    await page.getByRole("button", { name: "Add competition" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Friday Night Jumps" })).toBeVisible()

    await page.getByRole("button", { name: "Add an event" }).click()
    await page.getByLabel("Event", { exact: true }).selectOption("triple_jump")
    await page.getByRole("button", { name: "Add event" }).click()
    await expect(page.getByText("You are entered in the Triple jump.")).toBeVisible()

    await page.getByRole("button", { name: "Triple jump, enter result" }).click()
    await page.getByLabel(/Distance/).fill("13.42")
    await page.getByLabel(/^Wind/).fill("+0.8")
    await page.getByLabel(/^Place/).fill("3")
    await page.getByRole("button", { name: "Save result" }).click()
    await expect(page.getByText(/13\.42m \(\+0\.8\) is your first Triple jump result/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Triple jump, change result" })).toContainText("3rd place")

    await page.goto("/athlete/prs")
    const record = page.getByRole("link", { name: /^Triple jump/ })
    await expect(record).toContainText("13.42")
    await expect(record).toContainText("Friday Night Jumps")

    await page.goto("/athlete/competitions")
    await expect(page.getByRole("link", { name: /Friday Night Jumps/ })).toContainText("Triple jump 13.42m (3rd)")
  })

  test("test week results feed records and the test week history", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/test-week")
    await page.getByLabel(/^30m/).fill("3.98")
    await page.getByRole("button", { name: "Submit results" }).click()
    await expect(page.getByText("1 result saved. Your coach can see it.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "New personal bests" })).toBeVisible()

    await page.goto("/athlete/test-week/history")
    await expect(page.getByRole("heading", { level: 2, name: "Speed and power testing" })).toBeVisible()
    await expect(page.getByText("0.07s faster").first()).toBeVisible()

    await page.goto("/athlete/prs")
    await expect(page.getByRole("link", { name: /^30m/ })).toContainText("3.98")
  })

  test("the home screen points at the next competition", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/home")
    const row = page.getByRole("link", { name: /City Sprint Classic/ })
    await expect(row).toContainText("100m, 200m")
    await row.click()
    await expect(page).toHaveURL(/\/athlete\/competitions\/mock-comp-classic$/)
  })
})
