import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

// The install prompt, in mock mode. A real phone cannot be driven from here, so the test sets up
// what the app looks at: the browser's name (user agent), the browser's own install event
// ("beforeinstallprompt", Android and desktop Chrome only) and whether the window is the installed app.

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const IPHONE_INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 336.0.0.26.90 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 612345678)"
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"

const PHONE = { width: 390, height: 844 }

/** The browser's one tap install: fired on every page load until the person accepts, as Chrome does. */
async function stubInstallEvent(page: Page, outcome: "accepted" | "dismissed" = "accepted") {
  await page.addInitScript((answer) => {
    const w = window as unknown as Record<string, unknown>
    w.__installPrompted = 0
    if (window.sessionStorage.getItem("test:installed") === "1") return
    window.addEventListener("DOMContentLoaded", () => {
      const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & Record<string, unknown>
      event.prompt = () => {
        w.__installPrompted = (w.__installPrompted as number) + 1
        return Promise.resolve()
      }
      event.userChoice = new Promise((resolve) => {
        w.__resolveInstall = () => {
          if (answer === "accepted") {
            window.sessionStorage.setItem("test:installed", "1")
            window.setTimeout(() => window.dispatchEvent(new Event("appinstalled")), 0)
          }
          resolve({ outcome: answer })
        }
      })
      const realPrompt = event.prompt as () => Promise<void>
      event.prompt = () => {
        const done = realPrompt()
        ;(w.__resolveInstall as () => void)()
        return done
      }
      window.dispatchEvent(event)
    })
  }, outcome)
}

/** Makes the window look like the installed app. */
async function stubStandalone(page: Page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      if (!query.includes("display-mode: standalone")) return real(query)
      const list = real(query)
      return new Proxy(list, { get: (target, key) => (key === "matches" ? true : typeof target[key as keyof MediaQueryList] === "function" ? (target[key as keyof MediaQueryList] as (...args: unknown[]) => unknown).bind(target) : target[key as keyof MediaQueryList]) })
    }
  })
}

async function open(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState("networkidle")
}

const banner = (page: Page) => page.locator("[data-install-banner]")

test.describe("install prompt", () => {
  test.describe("iPhone in Safari", () => {
    test.use({ userAgent: IPHONE_SAFARI, viewport: PHONE, hasTouch: true })

    test("the banner shows and Show me how lists the iPhone steps", async ({ page }) => {
      await seedMockSession(page, { role: "athlete" })
      await open(page, "/athlete/home")

      await expect(banner(page)).toHaveAttribute("data-install-banner", "ios-safari")
      await expect(banner(page).getByText("Get SKTR Coach on your phone")).toBeVisible()
      await expect(banner(page).getByText("Opens in one tap, works with weak signal at the track, and sends you notifications.")).toBeVisible()
      await expect(banner(page).getByRole("button", { name: "Install", exact: true })).toHaveCount(0)

      // Nothing scrolls sideways at phone width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const box = await banner(page).getByRole("button", { name: "Show me how" }).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)

      await banner(page).getByRole("button", { name: "Show me how" }).click()
      const sheet = page.getByRole("dialog", { name: "Add SKTR Coach to your Home Screen" })
      const steps = sheet.getByRole("listitem")
      await expect(steps).toHaveCount(3)
      await expect(steps.nth(0)).toContainText("Tap the Share button at the bottom of Safari.")
      await expect(steps.nth(1)).toContainText('Scroll down and tap "Add to Home Screen".')
      await expect(steps.nth(2)).toContainText('Tap "Add".')
      await expect(sheet.getByText("Open SKTR Coach from your Home Screen from now on. Notifications only work from there.")).toBeVisible()
      await expect(sheet.getByText("Open this page in Safari first")).toHaveCount(0)

      // Having seen the steps, the banner steps back.
      await sheet.getByRole("button", { name: "Done" }).click()
      await expect(sheet).toHaveCount(0)
      await expect(banner(page)).toHaveCount(0)
    })

    test("Not now hides the banner and it stays hidden after a reload, but Your account still has the steps", async ({ page }) => {
      await seedMockSession(page, { role: "coach" })
      await open(page, "/coach/dashboard")
      await expect(banner(page)).toBeVisible()

      await banner(page).getByRole("button", { name: "Not now" }).click()
      await expect(banner(page)).toHaveCount(0)

      await page.reload()
      await page.waitForLoadState("networkidle")
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(banner(page)).toHaveCount(0)

      await open(page, "/account")
      await expect(banner(page)).toHaveCount(0)
      const section = page.locator("section", { has: page.getByRole("heading", { name: "Get the app" }) })
      await section.getByRole("button", { name: "Show me how" }).click()
      await expect(page.getByRole("dialog", { name: "Add SKTR Coach to your Home Screen" }).getByRole("listitem")).toHaveCount(3)
    })

    test("the banner comes back 14 days after Not now, and after the third time only after 90 days", async ({ page }) => {
      const day = 24 * 60 * 60 * 1000
      const seed = (dismissals: number, daysAgo: number) =>
        page.evaluate(({ count, at }) => window.localStorage.setItem("sktr:install-prompt", JSON.stringify({ dismissals: count, lastDismissedAt: at, installed: false })), {
          count: dismissals,
          at: Date.now() - daysAgo * day,
        })
      await seedMockSession(page, { role: "athlete" })
      await open(page, "/athlete/home")

      await seed(1, 13)
      await open(page, "/athlete/home")
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(banner(page)).toHaveCount(0)

      await seed(1, 15)
      await open(page, "/athlete/home")
      await expect(banner(page)).toBeVisible()

      await seed(3, 15)
      await open(page, "/athlete/home")
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(banner(page)).toHaveCount(0)

      await seed(3, 91)
      await open(page, "/athlete/home")
      await expect(banner(page)).toBeVisible()
    })

    test("the sign-in screen has one quiet tip that opens the steps", async ({ page }) => {
      await open(page, "/login")
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Tip: install SKTR Coach on your phone" }).click()
      await expect(page.getByRole("dialog", { name: "Add SKTR Coach to your Home Screen" }).getByRole("listitem")).toHaveCount(3)
    })

    test("guardians and platform admins get the entry in Your account too", async ({ page }) => {
      for (const role of ["guardian", "platform-admin"] as const) {
        await seedMockSession(page, { role })
        await open(page, "/account")
        await expect(page.getByRole("heading", { name: "Get the app" })).toBeVisible()
        await expect(page.locator("[data-install-state='steps']").getByRole("button", { name: "Show me how" })).toBeVisible()
      }
    })
  })

  test.describe("iPhone inside another app", () => {
    test.use({ userAgent: IPHONE_INSTAGRAM, viewport: PHONE, hasTouch: true })

    test("the steps start with Open this page in Safari first and a Copy link button", async ({ page }) => {
      await seedMockSession(page, { role: "athlete" })
      await open(page, "/athlete/home")
      await expect(banner(page)).toHaveAttribute("data-install-banner", "ios-other")

      await banner(page).getByRole("button", { name: "Show me how" }).click()
      const sheet = page.getByRole("dialog", { name: "Add SKTR Coach to your Home Screen" })
      await expect(sheet.getByText("Open this page in Safari first")).toBeVisible()
      await expect(sheet.getByRole("listitem")).toHaveCount(3)

      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => ((w.__copied = text), Promise.resolve()) } })
      })
      await sheet.getByRole("button", { name: "Copy link" }).click()
      await expect(sheet.getByRole("button", { name: "Link copied" })).toBeVisible()
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__copied)).toBe(new URL(page.url()).origin)
    })
  })

  test.describe("Android Chrome", () => {
    test.use({ userAgent: ANDROID_CHROME, viewport: PHONE, hasTouch: true })

    test("one tap: Install asks the browser, the banner goes and a message confirms it", async ({ page }) => {
      await stubInstallEvent(page, "accepted")
      await seedMockSession(page, { role: "athlete" })
      await open(page, "/athlete/home")

      await expect(banner(page)).toHaveAttribute("data-install-banner", "android")
      await expect(banner(page).getByRole("button", { name: "Show me how" })).toHaveCount(0)
      await banner(page).getByRole("button", { name: "Install", exact: true }).click()

      await expect(banner(page)).toHaveCount(0)
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__installPrompted)).toBe(1)
      await expect(page.getByText("SKTR Coach is installed. Open it from your Home Screen.")).toHaveCount(1)

      // Still gone after a reload, and Your account says so.
      await open(page, "/account")
      await expect(banner(page)).toHaveCount(0)
      await expect(page.locator("[data-install-state='installed']")).toContainText("Installed on this device")
    })

    test("closing the browser's question counts as Not now", async ({ page }) => {
      await stubInstallEvent(page, "dismissed")
      await seedMockSession(page, { role: "athlete" })
      await open(page, "/athlete/home")
      await banner(page).getByRole("button", { name: "Install", exact: true }).click()
      await expect(banner(page)).toHaveCount(0)
      await expect(page.getByText("SKTR Coach is installed.")).toHaveCount(0)

      // Your account still offers the one tap.
      await open(page, "/account")
      await expect(page.locator("[data-install-state='one-tap']").getByRole("button", { name: "Install SKTR Coach" })).toBeVisible()
    })

    test("without the one tap prompt the steps use the browser menu", async ({ page }) => {
      await seedMockSession(page, { role: "athlete" })
      await open(page, "/athlete/home")
      await banner(page).getByRole("button", { name: "Show me how" }).click()
      const steps = page.getByRole("dialog", { name: "Add SKTR Coach to your Home Screen" }).getByRole("listitem")
      await expect(steps).toHaveCount(3)
      await expect(steps.nth(0)).toContainText("Tap the menu (three dots) at the top right.")
      await expect(steps.nth(1)).toContainText('Tap "Install app" or "Add to Home screen".')
      await expect(steps.nth(2)).toContainText('Tap "Install".')
    })
  })

  test.describe("already installed", () => {
    test.use({ userAgent: IPHONE_SAFARI, viewport: PHONE, hasTouch: true })

    test("no banner, no sign-in tip, and Your account says Installed on this device", async ({ page }) => {
      await stubStandalone(page)
      await seedMockSession(page, { role: "athlete" })
      await open(page, "/athlete/home")
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(banner(page)).toHaveCount(0)

      await open(page, "/account")
      await expect(page.locator("[data-install-state='installed']")).toContainText("Installed on this device")
      await expect(page.getByRole("button", { name: "Show me how" })).toHaveCount(0)

      await page.context().clearCookies()
      await page.addInitScript(() => window.localStorage.removeItem("pacelab:mock-role"))
      await open(page, "/login")
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible()
      await expect(page.locator("[data-install-tip]")).toHaveCount(0)
    })
  })

  test.describe("computer", () => {
    test("no banner and no sign-in tip without the browser's install event", async ({ page }) => {
      await seedMockSession(page, { role: "coach" })
      await open(page, "/coach/dashboard")
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(banner(page)).toHaveCount(0)
      await open(page, "/account")
      await expect(page.getByRole("heading", { name: "Get the app" })).toBeVisible()
    })

    test("with the install event the banner offers one tap", async ({ page }) => {
      await stubInstallEvent(page, "accepted")
      await page.setViewportSize({ width: 1280, height: 900 })
      await seedMockSession(page, { role: "coach" })
      await open(page, "/coach/dashboard")
      await expect(banner(page)).toHaveAttribute("data-install-banner", "desktop")
      await banner(page).getByRole("button", { name: "Install", exact: true }).click()
      await expect(banner(page)).toHaveCount(0)
    })
  })
})
