import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/**
 * Small fixes from the audit, in mock mode: sign out of every device, undo for small deletes,
 * pinch zoom, two people editing the same thing, coming back after a sign-in ran out, the
 * Progress tab row on a phone, and "today" on the club's day.
 */

// Set SHOT_DIR to keep screenshots of each screen (used when reviewing the layout by eye).
const SHOT_DIR = process.env.SHOT_DIR
async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return
  // Sheets, dialogs and toasts slide in. Wait for them to settle before the picture.
  await page.waitForTimeout(450)
  const size = page.viewportSize()
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${size?.width ?? 0}.png`, fullPage: true })
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

const TENANT = "elite-track-club"
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 900 }

/** The toast with its "Undo" button. */
function undoToast(page: Page, text: string) {
  return page.locator("li", { hasText: text }).filter({ has: page.getByRole("button", { name: "Undo" }) })
}

/** Another person saved this record a moment ago (mock mode keeps who and when per club in the browser). */
async function someoneElseSaved(page: Page, kind: string, id: string, name: string | null, minutesAgo = 2) {
  await page.evaluate(
    ({ key, entry, at, by }) => {
      const stamps = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>
      stamps[entry] = { updatedAt: at, byName: by }
      window.localStorage.setItem(key, JSON.stringify(stamps))
    },
    { key: `pacelab:edit-stamps:v1:${TENANT}`, entry: `${kind}:${id}`, at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), by: name },
  )
}

const DRAFT_PLAN = {
  id: "plan-polish-draft",
  status: "draft",
  name: "Hurdles block",
  teamId: "t1",
  startDate: "2026-11-02",
  weeks: 2,
  notes: "",
  weekFocus: {},
  sessions: [],
  updatedAt: "2026-10-01T10:00:00.000Z",
}

async function seedDraftPlan(page: Page) {
  await page.addInitScript(
    ({ key, plan }) => {
      // Only the first time: later reloads must keep what the test did.
      if (window.sessionStorage.getItem("polish-seeded")) return
      window.sessionStorage.setItem("polish-seeded", "1")
      window.localStorage.setItem(key, JSON.stringify({ plans: [plan], removedSeedIds: [] }))
    },
    { key: `pacelab:coach-training-plans:v1:${TENANT}`, plan: DRAFT_PLAN },
  )
}

async function storedPlanNames(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) ?? '{"plans":[]}') as { plans: Array<{ name: string }> }
    return state.plans.map((plan) => plan.name)
  }, `pacelab:coach-training-plans:v1:${TENANT}`)
}

/* ---------------------------- 1. Sign out everywhere --------------------------- */

for (const viewport of [DESKTOP, PHONE]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport })

    test("your account: sign out of every device says what it does and asks first", async ({ page }) => {
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/account")
      const devices = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Devices" }) })
      await expect(devices).toContainText("Sign out here and everywhere else.")
      await expect(devices.getByRole("button", { name: "Sign out others" })).toBeVisible()
      await expect(devices.getByRole("button", { name: "Sign out", exact: true })).toBeVisible()

      await devices.getByRole("button", { name: "Sign out everywhere" }).click()
      const what = devices.locator("[data-sign-out-everywhere]")
      await expect(what.getByRole("listitem")).toHaveCount(4)
      await expect(what).toContainText("on every other phone, tablet and browser")
      await expect(what).toContainText("up to an hour")
      await expect(what).toContainText("Keeps your password and your data as they are")
      const confirm = what.getByRole("group", { name: "Confirm" })
      await expect(confirm).toContainText("Sign out of every device, including this one?")
      await shot(page, "sign-out-everywhere")
      await noSidewaysScroll(page)

      // Cancel changes nothing.
      await confirm.getByRole("button", { name: "Cancel" }).click()
      await expect(what).toHaveCount(0)
      await expect(page).toHaveURL(/\/account/)

      await devices.getByRole("button", { name: "Sign out everywhere" }).click()
      await devices.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Sign out everywhere" }).click()
      await expect(page).toHaveURL(/\/login$/)
      const cookies = await page.context().cookies()
      expect(cookies.find((cookie) => cookie.name === "pacelab_session")).toBeUndefined()
    })

    /* ------------------------------ 6. Progress tabs ----------------------------- */

    test("the Progress tabs hint that they scroll and keep the open tab in view", async ({ page }) => {
      await seedMockSession(page, { role: "athlete" })
      await page.goto("/athlete/trends")
      const tabs = page.getByRole("navigation", { name: "Progress sections" })
      await expect(tabs.getByRole("link")).toHaveCount(5)
      const row = tabs.locator("xpath=..")
      const phone = viewport.width < 640

      if (!phone) {
        await expect(row).toHaveAttribute("data-overflow-end", "false")
        await expect(row).toHaveAttribute("data-overflow-start", "false")
        await expect(row.locator('[data-tabs-fade="end"]')).toHaveCSS("opacity", "0")
        await shot(page, "progress-tabs")
        return
      }

      // More tabs to the right: the row fades there, and nowhere else.
      await expect(row).toHaveAttribute("data-overflow-end", "true")
      await expect(row).toHaveAttribute("data-overflow-start", "false")
      await expect(row.locator('[data-tabs-fade="end"]')).toHaveCSS("opacity", "1")
      await expect(row.locator('[data-tabs-fade="start"]')).toHaveCSS("opacity", "0")
      await expect(row.getByRole("button")).toHaveCount(0)
      await shot(page, "progress-tabs-start")
      await noSidewaysScroll(page)

      // Opening the last screen directly: its tab is fully in view, and the fade moves to the left.
      await page.goto("/athlete/test-week")
      const active = tabs.getByRole("link", { name: "Tests" })
      await expect(active).toHaveAttribute("aria-current", "page")
      await expect(row).toHaveAttribute("data-overflow-start", "true")
      await expect(row).toHaveAttribute("data-overflow-end", "false")
      const box = await active.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
      await shot(page, "progress-tabs-end")
      await noSidewaysScroll(page)

      // The fade never eats a tap: the first tab is reachable after scrolling back.
      await tabs.evaluate((nav) => {
        nav.scrollLeft = 0
      })
      await expect(row).toHaveAttribute("data-overflow-end", "true")
      await tabs.getByRole("link", { name: "Overview" }).click()
      await expect(page).toHaveURL(/\/athlete\/trends/)
    })

    /* ------------------------ 4. Two people, the same plan ----------------------- */

    test("plan builder: someone else's save is never overwritten silently", async ({ page }) => {
      await seedDraftPlan(page)
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/training-plan")
      await page.getByRole("list", { name: "Training plans" }).getByRole("button", { name: /Hurdles block/ }).first().click()
      await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible()

      // Andre saves the same draft from his own device, with another name.
      await page.evaluate((key) => {
        const state = JSON.parse(window.localStorage.getItem(key) ?? "{}") as { plans: Array<{ id: string; name: string }> }
        state.plans = state.plans.map((plan) => (plan.id === "plan-polish-draft" ? { ...plan, name: "Hurdles block (Andre)" } : plan))
        window.localStorage.setItem(key, JSON.stringify(state))
      }, `pacelab:coach-training-plans:v1:${TENANT}`)
      await someoneElseSaved(page, "plan", "plan-polish-draft", "Andre")

      await page.getByRole("button", { name: "Save draft" }).click()
      const dialog = page.getByRole("dialog", { name: "Andre changed this plan 2 minutes ago." })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText("Your changes were not saved over theirs.")
      await expect(dialog).toContainText("kept on this device")
      await expect(dialog.getByRole("button", { name: "See their version" })).toBeVisible()
      await expect(dialog.getByRole("button", { name: "Save mine anyway" })).toBeVisible()
      await shot(page, "plan-conflict")
      await noSidewaysScroll(page)
      // Nothing was written.
      expect(await storedPlanNames(page)).toEqual(["Hurdles block (Andre)"])

      // Closing the dialog keeps my work in the builder; saving again asks again.
      await dialog.getByRole("button", { name: "Close" }).click()
      await expect(dialog).toHaveCount(0)
      await page.getByRole("button", { name: "Save draft" }).click()
      await expect(dialog).toBeVisible()

      // See their version: the plan is read again, mine is kept as the copy on this device.
      await dialog.getByRole("button", { name: "See their version" }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator("#main-content")).toContainText("Hurdles block (Andre)")
      expect(await storedPlanNames(page)).toEqual(["Hurdles block (Andre)"])
      const kept = await page.evaluate((key) => window.localStorage.getItem(key), `pacelab:coach-plan-unsaved:v1:${TENANT}`)
      expect(kept).toContain('"name":"Hurdles block"')

      // Their version is now the one loaded, so saving it goes straight through.
      await page.getByRole("button", { name: "Save draft" }).click()
      await expect(page.locator("#main-content")).toContainText(/Draft saved at/)
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })

    test("plan builder: save mine anyway replaces the other version on purpose", async ({ page }) => {
      await seedDraftPlan(page)
      await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
      await page.goto("/coach/training-plan")
      await page.getByRole("list", { name: "Training plans" }).getByRole("button", { name: /Hurdles block/ }).first().click()
      await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible()
      // The same account, in another tab: no name is known, so the dialog says "You".
      await someoneElseSaved(page, "plan", "plan-polish-draft", null, 5)

      await page.getByRole("button", { name: "Save draft" }).click()
      const dialog = page.getByRole("dialog", { name: "You changed this plan 5 minutes ago, on another device or tab." })
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Save mine anyway" }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator("#main-content")).toContainText(/Draft saved at/)
      expect(await storedPlanNames(page)).toEqual(["Hurdles block"])

      // My own save moved the stamp on: the next save does not ask.
      await page.getByRole("button", { name: "Save draft" }).click()
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(page.locator("#main-content")).toContainText(/Draft saved at/)
    })
  })
}

/* ------------------- 4. Test week, team and club profile conflicts ------------------ */

test("test week setup: a change by another coach is shown before saving over it", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/test-week")
  await page.getByRole("button", { name: /January Speed Testing/ }).click()
  await expect(page.getByRole("heading", { level: 1, name: "January Speed Testing" })).toBeVisible()
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Edit test week" })).toBeVisible()
  await page.getByLabel("Test week name").fill("January Speed Testing (mine)")
  // The demo's sprint test week.
  await someoneElseSaved(page, "test-week", "mock-test-week-1", "Dana", 3)

  await page.getByRole("button", { name: "Save changes" }).click()
  const dialog = page.getByRole("dialog", { name: "Dana changed this test week 3 minutes ago." })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("What you changed here is not kept")
  await shot(page, "test-week-conflict")

  // See their version: back on the test week as it is stored, my rename is gone.
  await dialog.getByRole("button", { name: "See their version" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "January Speed Testing" })).toBeVisible()
  await expect(page.locator("#main-content")).toContainText("This is their version. Your own changes were not saved.")

  // Editing again starts from their version: no dialog this time.
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await page.getByLabel("Test week name").fill("January Speed Testing v2")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "January Speed Testing v2" })).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("team details: the second admin is told who changed the team and can still save theirs", async ({ page }) => {
  await page.setViewportSize(PHONE)
  await seedMockSession(page, { role: "club-admin" })
  await page.goto("/club-admin/teams")
  // The demo's Jumps Group.
  const teamName = "Jumps Group"
  const teamId = "t3"
  await expect(page.locator(`[data-team="${teamName}"]`)).toBeVisible()

  await page.locator(`[data-team="${teamName}"]`).getByRole("button", { name: `More for ${teamName}`, exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit team" }).click()
  const form = page.getByRole("dialog", { name: "Edit team" })
  await form.getByLabel("Team name").fill(`${teamName} One`)
  await someoneElseSaved(page, "team", teamId, "Andre", 1)
  await form.getByRole("button", { name: "Save changes" }).click()

  const dialog = page.getByRole("dialog", { name: "Andre changed this team 1 minute ago." })
  await expect(dialog).toBeVisible()
  await shot(page, "team-conflict")
  await noSidewaysScroll(page)
  await dialog.getByRole("button", { name: "Save mine anyway" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator(`[data-team="${teamName} One"]`)).toBeVisible()
})

test("club profile: a save over another admin's change asks first", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await seedMockSession(page, { role: "club-admin" })
  await page.goto("/club-admin/profile")
  await page.getByRole("button", { name: "Edit club name and colour" }).click()
  await page.getByLabel("Club name").fill("Elite Track and Field")
  await someoneElseSaved(page, "club-profile", "club", "Dana", 12)
  await page.getByRole("button", { name: "Save club details" }).click()

  const dialog = page.getByRole("dialog", { name: "Dana changed this club profile 12 minutes ago." })
  await expect(dialog).toBeVisible()
  await shot(page, "club-profile-conflict")
  await dialog.getByRole("button", { name: "See their version" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator("#main-content")).not.toContainText("Elite Track and Field")
  await expect(page.getByRole("button", { name: "Edit club name and colour" })).toBeVisible()

  // A fresh edit starts from the current profile and saves without asking.
  await page.getByRole("button", { name: "Edit club name and colour" }).click()
  await page.getByLabel("Club name").fill("Elite Track and Field")
  await page.getByRole("button", { name: "Save club details" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator("#main-content")).toContainText("Elite Track and Field")
})

/* ------------------------------- 2. Undo for deletes ------------------------------ */

test("undo: a deleted template comes back, and is gone for good once the time is up", async ({ page }) => {
  await page.setViewportSize(PHONE)
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/training-plan/templates")
  const list = page.getByRole("list", { name: "Templates" })
  await expect(list.locator("> li")).toHaveCount(2)

  const remove = async () => {
    await page.getByRole("button", { name: "More for Sprint general prep, 4 weeks" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Yes, delete" }).click()
  }

  await remove()
  // Gone from the list at once, with a way back.
  await expect(list.locator("> li")).toHaveCount(1)
  const toast = undoToast(page, "Template deleted")
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible()
  await shot(page, "undo-toast")
  await noSidewaysScroll(page)
  await toast.getByRole("button", { name: "Undo" }).click()
  await expect(list.locator("> li")).toHaveCount(2)
  await expect(toast).toHaveCount(0)
  // Nothing was deleted: it survives a reload.
  await page.reload()
  await expect(page.getByRole("list", { name: "Templates" }).locator("> li")).toHaveCount(2)

  // Not undone: after about six seconds the delete is real.
  await remove()
  await expect(page.getByRole("list", { name: "Templates" }).locator("> li")).toHaveCount(1)
  await expect(undoToast(page, "Template deleted")).toHaveCount(0, { timeout: 9000 })
  await page.reload()
  await expect(page.getByRole("list", { name: "Templates" }).locator("> li")).toHaveCount(1)
})

test("undo: a coach note, and leaving the screen makes the delete final", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/athletes/a2")
  const notes = page.locator("[data-coach-notes]")
  await notes.getByRole("button", { name: "Add note" }).click()
  await notes.getByRole("textbox", { name: "Note" }).fill("Keep an eye on the left hamstring")
  await notes.getByRole("button", { name: "Save note" }).click()
  await expect(notes.locator("[data-coach-note]")).toHaveCount(1)

  const remove = async () => {
    await notes.getByRole("button", { name: /^More for the note/ }).first().click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await notes.getByRole("button", { name: "Delete note" }).click()
  }

  await remove()
  await expect(notes.locator("[data-coach-note]")).toHaveCount(0)
  await shot(page, "undo-note")
  await undoToast(page, "Note deleted").getByRole("button", { name: "Undo" }).click()
  await expect(notes.locator("[data-coach-note]")).toHaveCount(1)
  await page.reload()
  await expect(notes.locator("[data-coach-note]")).toHaveCount(1)

  // Delete, then leave straight away: the delete is sent, it does not wait for the timer.
  await remove()
  await expect(notes.locator("[data-coach-note]")).toHaveCount(0)
  await page.getByRole("link", { name: /Back|Athletes|Roster|Sprint Group/ }).first().click()
  await page.goto("/coach/athletes/a2")
  await expect(notes).toContainText("No notes yet")
})

test("undo: a draft plan, and hiding the page sends the delete at once", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await seedDraftPlan(page)
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/training-plan")
  const list = page.getByRole("list", { name: "Training plans" })
  await expect(list).toContainText("Hurdles block")

  const remove = async () => {
    await page.getByRole("button", { name: "More for Hurdles block" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Yes, delete" }).click()
  }

  await remove()
  await expect(list).not.toContainText("Hurdles block")
  // Still stored while "Undo" is offered.
  expect(await storedPlanNames(page)).toEqual(["Hurdles block"])
  await undoToast(page, "Draft deleted").getByRole("button", { name: "Undo" }).click()
  await expect(list).toContainText("Hurdles block")

  await remove()
  await expect(list).not.toContainText("Hurdles block")
  expect(await storedPlanNames(page)).toEqual(["Hurdles block"])
  // The tab goes to the background (or closes): nothing waits for the timer.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect.poll(() => storedPlanNames(page)).toEqual([])
})

test("undo: a goal the athlete removed by mistake", async ({ page }) => {
  await page.setViewportSize(PHONE)
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/goals")
  await expect(page.locator('[data-goal="100m"]')).toBeVisible()
  await page.getByRole("button", { name: /More for the goal 100m/ }).click()
  await page.getByRole("menuitem", { name: "Remove goal" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Remove goal" }).click()
  await expect(page.locator('[data-goal="100m"]')).toHaveCount(0)
  await shot(page, "undo-goal")
  await noSidewaysScroll(page)
  await undoToast(page, "Goal removed").getByRole("button", { name: "Undo" }).click()
  await expect(page.locator('[data-goal="100m"]')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-goal="100m"]')).toBeVisible()
})

test("undo: a squad archived by mistake keeps its athletes", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/teams/t1")
  await page.getByRole("tab", { name: /Squads/ }).click()
  await expect(page.locator("[data-squad]")).toHaveCount(2)
  await page.getByRole("button", { name: "More for Short sprints" }).click()
  await page.getByRole("menuitem", { name: "Archive squad" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Archive squad" }).click()
  await expect(page.locator("[data-squad]")).toHaveCount(1)
  await undoToast(page, "Short sprints archived").getByRole("button", { name: "Undo" }).click()
  await expect(page.locator("[data-squad]")).toHaveCount(2)
  await expect(page.locator('[data-squad="Short sprints"] [data-squad-count]')).toHaveText("3 athletes")
  await page.reload()
  await page.getByRole("tab", { name: /Squads/ }).click()
  await expect(page.locator('[data-squad="Short sprints"] [data-squad-count]')).toHaveText("3 athletes")
})

test("undo: a club event deleted from the calendar", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/training-plan/calendar?show=agenda")
  await page.getByRole("button", { name: "Add event" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Title").fill("Relay practice")
  await dialog.getByRole("button", { name: "Add event" }).click()
  await expect(dialog).toHaveCount(0)
  const row = page.locator('[data-kind="event"]', { hasText: "Relay practice" })
  await row.getByRole("button", { name: /Relay practice/ }).first().click()
  const sheet = page.getByRole("dialog")
  await sheet.getByRole("button", { name: "Delete" }).click()
  await sheet.getByRole("button", { name: "Delete event" }).click()
  await expect(row).toHaveCount(0)
  await undoToast(page, "Event deleted").getByRole("button", { name: "Undo" }).click()
  await expect(row.first()).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-kind="event"]', { hasText: "Relay practice" }).first()).toBeVisible()
})

test("undo: an extra session the athlete removed", async ({ page }) => {
  await page.setViewportSize(PHONE)
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/log/new")
  await page.getByLabel("What was it").fill("Pool run")
  await page.getByRole("radio", { name: /^Run/ }).click()
  await page.getByRole("button", { name: "Start logging" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Pool run" })).toBeVisible()

  await page.getByRole("button", { name: /Remove this session/ }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Remove session" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Session removed" })).toBeVisible()
  await shot(page, "undo-extra-session")
  await noSidewaysScroll(page)
  await undoToast(page, "Session removed").getByRole("button", { name: "Undo" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Pool run" })).toBeVisible()

  // This time it is left alone: the session goes and the day's own log is shown.
  await page.getByRole("button", { name: /Remove this session/ }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Remove session" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Session removed" })).toBeVisible()
  await expect(page).not.toHaveURL(/session=/, { timeout: 10_000 })
  await expect(page.getByRole("heading", { level: 1, name: "Pool run" })).toHaveCount(0)
  await page.goto("/athlete/history")
  await expect(page.locator('[data-history="Pool run"]')).toHaveCount(0)
})

/* ---------------------------------- 3. Pinch zoom --------------------------------- */

test("zoom is allowed, and no field is small enough to make an iPhone zoom by itself", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true, baseURL })
  const page = await context.newPage()
  const smallestField = () =>
    page.evaluate(() => {
      const fields = [...document.querySelectorAll<HTMLElement>("input, select, textarea")].filter((field) => {
        const type = field.getAttribute("type") ?? ""
        return !["checkbox", "radio", "range", "file", "color", "hidden", "button", "submit"].includes(type) && field.offsetParent !== null
      })
      return { count: fields.length, smallest: Math.min(...fields.map((field) => Number.parseFloat(getComputedStyle(field).fontSize))) }
    })

  await page.goto("/login")
  const viewportTag = await page.locator('meta[name="viewport"]').getAttribute("content")
  expect(viewportTag).not.toMatch(/user-scalable\s*=\s*(no|0)/i)
  expect(viewportTag).not.toMatch(/maximum-scale/i)
  expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true)
  await expect(page.getByLabel("Email")).toBeVisible()
  const login = await smallestField()
  expect(login.count).toBeGreaterThan(1)
  expect(login.smallest).toBeGreaterThanOrEqual(16)

  // The densest forms in the app: the session log and the coach's result grid.
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/log")
  await expect(page.getByRole("button", { name: "Finish session" })).toBeVisible()
  const log = await smallestField()
  expect(log.count).toBeGreaterThan(0)
  expect(log.smallest).toBeGreaterThanOrEqual(16)
  await noSidewaysScroll(page)

  await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
  await page.goto("/coach/test-week")
  await page.getByRole("button", { name: /January Speed Testing/ }).click()
  await page.getByRole("tab", { name: "Enter results" }).click()
  await expect(page.getByLabel("Marcus Johnson, 30m")).toBeVisible()
  const grid = await smallestField()
  expect(grid.count).toBeGreaterThan(0)
  expect(grid.smallest).toBeGreaterThanOrEqual(16)
  await context.close()
})

/* --------------------------- 5. Back to where you were --------------------------- */

async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill("Password123!")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
}

test("a sign-in that ran out brings the person back to the screen they were on", async ({ page }) => {
  await page.setViewportSize(PHONE)
  await seedMockSession(page, { role: "athlete" })
  await page.goto("/athlete/history")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

  // The sign-in runs out while the app is open.
  await page.context().clearCookies()
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(page).toHaveURL(/\/login\?redirect=%2Fathlete%2Fhistory$/)
  await shot(page, "login-after-expiry")

  await signIn(page, "athlete@pacelab.local")
  await expect(page).toHaveURL(/\/athlete\/history$/)
})

test("the return path is only followed when it is inside the app and for that role", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  // A coach's screen, but an athlete signs in: they get their own home.
  await page.goto(`/login?redirect=${encodeURIComponent("/coach/dashboard")}`)
  await signIn(page, "athlete@pacelab.local")
  await expect(page).toHaveURL(/\/athlete\/home$/)

  // Another site, in the shapes that fool a naive check.
  for (const bad of ["//evil.example/athlete/home", "https://evil.example", "/\\evil.example", "/login?redirect=/athlete/home"]) {
    await page.context().clearCookies()
    await page.goto(`/login?redirect=${encodeURIComponent(bad)}`)
    await signIn(page, "athlete@pacelab.local")
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/athlete\/home$/)
  }

  // A deep link with its query survives for the right role.
  await page.context().clearCookies()
  await page.goto(`/login?redirect=${encodeURIComponent("/coach/training-plan/calendar?show=agenda")}`)
  await signIn(page, "coach@pacelab.local")
  await expect(page).toHaveURL(/\/coach\/training-plan\/calendar\?show=agenda$/)
})

/* ------------------------------ 8. The club's day ------------------------------- */

test.describe("a coach far from the club", () => {
  // Tokyo is a day ahead of Kingston for most of the Jamaican afternoon and evening.
  test.use({ timezoneId: "Asia/Tokyo", viewport: DESKTOP })

  test("attendance and the athlete's log open on the club's day, not the device's", async ({ page }) => {
    const days = () =>
      page.evaluate(() => {
        const day = (timeZone?: string) => {
          const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
          const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
          return `${read("year")}-${read("month")}-${read("day")}`
        }
        return { device: day(), club: day("America/Jamaica"), far: day("Pacific/Kiritimati"), behind: day("Pacific/Pago_Pago") }
      })

    await seedMockSession(page, { role: "club-admin" })
    await page.goto("/club-admin/profile")
    const now = await days()
    // A zone whose day differs from this device's right now, so the test proves something at any hour.
    const zone = now.club !== now.device ? "America/Jamaica" : now.behind !== now.device ? "Pacific/Pago_Pago" : "Pacific/Kiritimati"
    const clubDay = zone === "America/Jamaica" ? now.club : zone === "Pacific/Pago_Pago" ? now.behind : now.far
    expect(clubDay).not.toBe(now.device)
    await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), { key: `pacelab:club-timezone:${TENANT}`, value: zone })

    // The coach's attendance screen starts on the club's day.
    await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
    await page.goto("/coach/teams/t1/attendance")
    await expect(page.getByLabel("Day").first()).toHaveValue(clubDay)
    await shot(page, "attendance-club-day")

    // The athlete's log says "Today" for the club's day.
    await seedMockSession(page, { role: "athlete" })
    await page.goto(`/athlete/log?date=${clubDay}`)
    await expect(page.locator("#main-content header")).toContainText("Today,")
    await page.goto(`/athlete/log?date=${now.device}`)
    await expect(page.locator("#main-content header")).not.toContainText("Today,")
  })
})
