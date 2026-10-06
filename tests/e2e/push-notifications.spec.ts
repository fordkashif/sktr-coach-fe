import { expect, test, type Page } from "@playwright/test"
import { seedMockSession, type Role } from "./helpers/session"

// "Push on this device" in notification settings, in mock mode. The browser's Notification and
// PushManager are replaced by stand-ins so every state can be reached: off, on, blocked, the
// question closed without an answer, not supported, iPhone before the Home Screen, and not set up.
// (Queueing, delivery and who may see which device are checked against Postgres and in the
// server function's tests, not here.)

type Permission = "default" | "granted" | "denied"

/**
 * Stand-ins for the browser's push pieces.
 *   permission   what the browser says before anyone taps
 *   answer       what the person picks when the browser asks
 * The permission is kept across reloads, as a real browser keeps it.
 */
async function stubPush(page: Page, options: { permission?: Permission; answer?: Permission; pushManager?: boolean; setup?: "off" } = {}) {
  await page.addInitScript(
    ({ permission, answer, pushManager, setup }) => {
      const w = window as unknown as Record<string, unknown>
      const stored = window.sessionStorage.getItem("test:push-permission") as string | null
      const asked = Number(window.sessionStorage.getItem("test:push-asked") ?? 0)
      w.__pushAsked = asked
      w.__pushShown = []
      class FakeNotification {
        static permission = stored ?? permission
        static requestPermission() {
          w.__pushAsked = (w.__pushAsked as number) + 1
          window.sessionStorage.setItem("test:push-asked", String(w.__pushAsked))
          FakeNotification.permission = answer
          window.sessionStorage.setItem("test:push-permission", answer)
          return Promise.resolve(answer)
        }
        constructor(title: string, init?: { body?: string; tag?: string }) {
          ;(w.__pushShown as unknown[]).push({ title, body: init?.body, tag: init?.tag })
        }
      }
      Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true, writable: true })
      if (pushManager) {
        if (!("PushManager" in window)) Object.defineProperty(window, "PushManager", { value: class {}, configurable: true })
      } else {
        delete w.PushManager
      }
      if (setup === "off") window.localStorage.setItem("sktr:mock-push-setup", "off")
    },
    { permission: options.permission ?? "default", answer: options.answer ?? "granted", pushManager: options.pushManager ?? true, setup: options.setup ?? null },
  )
}

async function openSettings(page: Page, role: Role) {
  await seedMockSession(page, { role })
  await page.goto("/settings/notifications")
  await expect(page.getByRole("heading", { level: 1, name: "Notification settings" })).toBeVisible({ timeout: 15_000 })
}

const section = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "Push on this device" }) })
const state = (page: Page) => page.getByTestId("push-state")
const asked = (page: Page) => page.evaluate(() => (window as unknown as { __pushAsked: number }).__pushAsked)
const devices = (page: Page) => page.getByTestId("push-device")

test.describe("push on this device, phone", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("nothing asks for permission until the tap; then on, a test, still on after a reload, and off again", async ({ page }) => {
    await stubPush(page)
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/home")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    expect(await asked(page)).toBe(0)

    await page.goto("/settings/notifications")
    await expect(state(page)).toHaveAttribute("data-push-state", "off")
    await expect(section(page).getByText("Get a notification on this phone or computer when something needs you, even when SKTR Coach is closed.")).toBeVisible()
    await expect(state(page).getByText("Off on this device")).toBeVisible()
    await expect(state(page).getByText("Your browser will ask if SKTR Coach may send notifications.")).toBeVisible()
    expect(await asked(page)).toBe(0)
    // A device from before is listed; this one is not.
    await expect(devices(page)).toHaveCount(1)
    await expect(devices(page).first()).toContainText("Chrome on Windows")
    await expect(devices(page).first()).toContainText("Last used: 3 days ago")

    await section(page).getByRole("button", { name: "Turn on push" }).click()
    await expect(state(page)).toHaveAttribute("data-push-state", "on")
    await expect(state(page).getByText("On for this device")).toBeVisible()
    await expect(section(page).getByRole("status").filter({ hasText: "Push is on for this device." })).toBeVisible()
    expect(await asked(page)).toBe(1)
    await expect(devices(page)).toHaveCount(2)
    await expect(devices(page).first()).toContainText("(this device)")
    await expect(devices(page).first()).toContainText("Last used: just now")
    await expect(section(page).getByRole("button", { name: "Turn on push" })).toHaveCount(0)

    await section(page).getByRole("button", { name: "Send a test" }).click()
    await expect(section(page).getByText("Test sent. It should show on that device in a few seconds.")).toBeVisible()
    const shown = await page.evaluate(() => (window as unknown as { __pushShown: Array<{ title: string; body: string }> }).__pushShown)
    expect(shown).toEqual([{ title: "Push is working", body: "This is a test from SKTR Coach. Notifications will reach this device.", tag: "push_test" }])

    await page.reload()
    await expect(state(page)).toHaveAttribute("data-push-state", "on")
    expect(await asked(page)).toBe(1) // not asked again

    await section(page).getByRole("button", { name: "Turn off" }).click()
    await expect(state(page)).toHaveAttribute("data-push-state", "off")
    await expect(section(page).getByText("Push is off for this device.")).toBeVisible()
    await expect(devices(page)).toHaveCount(1)
    await expect(section(page).getByText("(this device)")).toHaveCount(0)
    // Permission is still granted, so the browser will not ask again and the line about it is gone.
    await expect(state(page).getByText("Your browser will ask")).toHaveCount(0)
    await expect(section(page).getByRole("button", { name: "Turn on push" })).toBeVisible()

    // Nothing on the page is wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test("blocked: saying no shows how to unblock, with no button that would ask again", async ({ page }) => {
    await stubPush(page, { answer: "denied" })
    await openSettings(page, "athlete")
    await section(page).getByRole("button", { name: "Turn on push" }).click()
    await expect(state(page)).toHaveAttribute("data-push-state", "blocked")
    await expect(state(page).getByText("Blocked in your browser settings")).toBeVisible()
    await expect(state(page).getByText(/To unblock: tap the icon next to the address/)).toBeVisible()
    await expect(section(page).getByRole("button", { name: "Turn on push" })).toHaveCount(0)
    await expect(section(page).getByRole("button", { name: "Send a test" })).toHaveCount(0)
    await section(page).getByRole("button", { name: "Check again" }).click()
    await expect(state(page)).toHaveAttribute("data-push-state", "blocked")
    expect(await asked(page)).toBe(1)
    await expect(devices(page).filter({ hasText: "(this device)" })).toHaveCount(0)
  })

  test("blocked before the visit: said straight away, nothing asked", async ({ page }) => {
    await stubPush(page, { permission: "denied" })
    await openSettings(page, "coach")
    await expect(state(page)).toHaveAttribute("data-push-state", "blocked")
    expect(await asked(page)).toBe(0)
  })

  test("the browser's question closed without an answer: still off, with a way to try again", async ({ page }) => {
    await stubPush(page, { answer: "default" })
    await openSettings(page, "athlete")
    await section(page).getByRole("button", { name: "Turn on push" }).click()
    await expect(section(page).getByRole("alert")).toContainText("the browser's question was closed without an answer")
    await expect(state(page)).toHaveAttribute("data-push-state", "off")
    await expect(section(page).getByRole("button", { name: "Turn on push" })).toBeEnabled()
  })

  test("not supported on this browser: said plainly, no button", async ({ page }) => {
    await stubPush(page, { pushManager: false })
    await openSettings(page, "athlete")
    await expect(state(page)).toHaveAttribute("data-push-state", "unsupported")
    await expect(state(page).getByText("Not supported on this browser")).toBeVisible()
    await expect(state(page).getByText(/The bell in the app shows everything either way/)).toBeVisible()
    await expect(section(page).getByRole("button", { name: "Turn on push" })).toHaveCount(0)
    expect(await asked(page)).toBe(0)
  })

  test("signing out on this device turns its push off", async ({ page }) => {
    await stubPush(page, { permission: "granted" })
    await openSettings(page, "athlete")
    await section(page).getByRole("button", { name: "Turn on push" }).click()
    await expect(state(page)).toHaveAttribute("data-push-state", "on")

    await page.goto("/athlete/profile")
    await page.getByRole("button", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login/)

    await openSettings(page, "athlete")
    await expect(state(page)).toHaveAttribute("data-push-state", "off")
    await expect(devices(page).filter({ hasText: "(this device)" })).toHaveCount(0)
    await expect(devices(page)).toHaveCount(1) // the other device is still theirs
  })

  test("another device can be removed, after a confirm", async ({ page }) => {
    await stubPush(page)
    await openSettings(page, "athlete")
    const laptop = devices(page).filter({ hasText: "Chrome on Windows" })
    await laptop.getByRole("button", { name: "Remove Chrome on Windows" }).click()
    await expect(laptop.getByText("Stop notifications on Chrome on Windows?")).toBeVisible()
    await laptop.getByRole("button", { name: "Keep it" }).click()
    await expect(devices(page)).toHaveCount(1)
    await laptop.getByRole("button", { name: "Remove Chrome on Windows" }).click()
    await laptop.getByRole("button", { name: "Remove", exact: true }).click()
    await expect(devices(page)).toHaveCount(0)
    await expect(section(page).getByText("Chrome on Windows was removed. It will not get notifications any more.")).toBeVisible()
    await page.reload()
    await expect(state(page)).toBeVisible()
    await expect(devices(page)).toHaveCount(0)
  })

  test("which updates are pushed by default, and push follows the bell", async ({ page }) => {
    await stubPush(page)
    await openSettings(page, "athlete")
    const on = async (name: string) => expect(page.getByRole("switch", { name, exact: true })).toHaveAttribute("aria-checked", "true")
    const off = async (name: string) => expect(page.getByRole("switch", { name, exact: true })).toHaveAttribute("aria-checked", "false")
    await on("By push")
    await on("New training plans, push")
    await on("Test weeks, push")
    await on("Messages, push")
    await on("Announcements, push")
    await on("Reports from your coach, push")
    await on("Session today, push")
    await on("Check-in not done, push")
    await on("Test week closing, push")
    await off("Changes to your plan, push")
    await off("Your team, push")

    // A choice is kept.
    await page.getByRole("switch", { name: "Changes to your plan, push", exact: true }).click()
    await expect(page.getByText("Changes to your plan: push turned on.")).toBeVisible()
    await page.reload()
    await on("Changes to your plan, push")
    await off("Changes to your plan, email") // the other channels did not move

    // In app off for one kind of update: its push cannot be on.
    await page.getByRole("switch", { name: "Messages, in app", exact: true }).click()
    const messagesPush = page.getByRole("switch", { name: "Messages, push (needs in app on)" })
    await expect(messagesPush).toBeDisabled()
    await expect(messagesPush).toHaveAttribute("aria-checked", "false")
    await page.getByRole("switch", { name: "Messages, in app", exact: true }).click()
    await on("Messages, push")

    // The whole push channel off: every push switch is off and locked.
    await page.getByRole("switch", { name: "By push", exact: true }).click()
    await expect(page.getByText("Push notifications turned off.")).toBeVisible()
    const plansPush = page.getByRole("switch", { name: "New training plans, push (the whole channel is off)" })
    await expect(plansPush).toBeDisabled()
    await expect(plansPush).toHaveAttribute("aria-checked", "false")
    await on("New training plans, in app")
  })

  test("coach: pain reports are pushed, digests and roll-ups are not", async ({ page }) => {
    await stubPush(page)
    await openSettings(page, "coach")
    await expect(page.getByRole("switch", { name: "Pain and injury reports, push", exact: true })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("switch", { name: "Test week closing, push", exact: true })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("switch", { name: "Sessions not logged, push", exact: true })).toHaveAttribute("aria-checked", "false")
    await expect(page.getByRole("switch", { name: "Finished sessions, push", exact: true })).toHaveAttribute("aria-checked", "false")
    await expect(page.getByRole("switch", { name: "Low readiness, push", exact: true })).toHaveAttribute("aria-checked", "false")
    await expect(page.getByRole("group", { name: "Finished sessions" }).getByText("No email")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test("push not set up: nothing about push for an athlete or a coach", async ({ page }) => {
    await stubPush(page, { setup: "off", permission: "granted" })
    for (const role of ["athlete", "coach"] as const) {
      await openSettings(page, role)
      await expect(page.getByRole("heading", { level: 2, name: "What you hear about" })).toBeVisible()
      await expect(page.getByRole("switch", { name: "In the app", exact: true })).toBeVisible()
      await expect(page.getByRole("heading", { level: 2, name: "Push on this device" })).toHaveCount(0)
      await expect(page.getByRole("switch", { name: /push/i })).toHaveCount(0)
      await expect(page.getByText(/push/i)).toHaveCount(0)
    }
  })

  test("push not set up: admins are told in one line", async ({ page }) => {
    await stubPush(page, { setup: "off" })
    for (const role of ["club-admin", "platform-admin"] as const) {
      await openSettings(page, role)
      await expect(section(page).getByText("Push is not set up for this app yet. People cannot turn it on until it is.")).toBeVisible()
      await expect(section(page).getByRole("button")).toHaveCount(0)
      await expect(page.getByRole("switch", { name: /push/i })).toHaveCount(0)
    }
    expect(await asked(page)).toBe(0)
  })
})

test.describe("push on an iPhone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  })

  test("in Safari, before the Home Screen: the two steps, and no button that cannot work", async ({ page }) => {
    await stubPush(page, { pushManager: false })
    await openSettings(page, "athlete")
    await expect(state(page)).toHaveAttribute("data-push-state", "ios-install")
    await expect(state(page).getByText("Add SKTR Coach to your Home Screen first")).toBeVisible()
    const steps = section(page).getByRole("list", { name: "How to add SKTR Coach to your Home Screen" }).getByRole("listitem")
    await expect(steps).toHaveCount(2)
    await expect(steps.nth(0)).toContainText("In Safari, tap the Share button.")
    await expect(steps.nth(1)).toContainText("Tap Add to Home Screen, open SKTR Coach from the new icon, then come back to this screen.")
    await expect(section(page).getByRole("button", { name: "Turn on push" })).toHaveCount(0)
    expect(await asked(page)).toBe(0)
  })

  test("opened from the Home Screen: it can be turned on, and the device is named as the app", async ({ page }) => {
    await stubPush(page)
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }))
    await openSettings(page, "athlete")
    await expect(state(page)).toHaveAttribute("data-push-state", "off")
    await section(page).getByRole("button", { name: "Turn on push" }).click()
    await expect(state(page)).toHaveAttribute("data-push-state", "on")
    await expect(devices(page).first()).toContainText("SKTR Coach app on iPhone (this device)")
  })
})

test.describe("push on this device, desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test("coach: the same section, and three switches per update", async ({ page }) => {
    await stubPush(page)
    await openSettings(page, "coach")
    await section(page).getByRole("button", { name: "Turn on push" }).click()
    await expect(state(page)).toHaveAttribute("data-push-state", "on")
    await expect(devices(page).first()).toContainText("(this device)")
    await expect(page.getByRole("group", { name: "Messages" }).getByRole("switch")).toHaveCount(3)
    await expect(page.getByRole("group", { name: "Finished sessions" }).getByRole("switch")).toHaveCount(2)
  })
})
