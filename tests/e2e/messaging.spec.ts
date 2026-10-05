import { expect, test, type Page } from "@playwright/test"
import { seedMockSession, type Role } from "./helpers/session"

// Mock mode keeps messages in the browser, shared by the demo coach (Andre Campbell), the demo
// athlete (Marcus Johnson, on Sprint Group "t1") and the demo club admin. Switching role inside one
// test therefore shows the other side of the same conversation. The database rules themselves are
// checked against Postgres (see SUPABASE_RLS_POLICY_MATRIX.md, "Messaging").

const main = (page: Page) => page.locator("#main-content")
const badge = (page: Page) => page.locator("[data-shell-messages]:visible [data-testid='messages-count']")

async function signIn(page: Page, role: Role) {
  await seedMockSession(page, role === "coach" ? { role, coachTeamId: "t1" } : { role })
}

async function send(page: Page, to: string, text: string) {
  await page.getByRole("textbox", { name: `Message to ${to}` }).fill(text)
  await page.getByRole("button", { name: "Send" }).click()
  await expect(main(page).locator("[data-message-id]").filter({ hasText: text })).toBeVisible()
}

test("a coach posts an announcement, the athlete reads it and the unread badge clears", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const text = "Saturday starts at 8am, not 9. Meet at the 200m start."

  await signIn(page, "coach")
  await page.goto("/coach/messages?tab=announcements")
  await page.getByRole("link", { name: "New announcement" }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: "New announcement" })).toBeVisible()
  // Nothing to post yet.
  await expect(page.getByRole("button", { name: "Post announcement" })).toBeDisabled()
  await page.getByLabel("What do you want to say").fill(text)
  await page.getByRole("button", { name: "Post announcement" }).click()

  // The coach lands on it and sees who it went to: athletes with a login, nobody has read it yet.
  await expect(page).toHaveURL(/\/coach\/messages\/a\/[^/]+$/)
  await expect(main(page).locator("[data-announcement-body]")).toHaveText(text)
  const unreadPeople = main(page).getByRole("list", { name: "People who have not read it" })
  await expect(unreadPeople).toContainText("Marcus Johnson")
  await expect(unreadPeople).toContainText("Sarah Chen")
  // Sophia Kim has no login in the demo, so the announcement did not go to her.
  await expect(main(page)).not.toContainText("Sophia Kim")
  const announcementPath = new URL(page.url()).pathname.replace("/coach/", "/athlete/")

  // The athlete: a count on the Messages button, the announcement on the home screen and in the list.
  await signIn(page, "athlete")
  await page.goto("/athlete/home")
  await expect(badge(page)).toHaveText("3")
  await expect(main(page)).toContainText("new announcements")
  await page.locator("header[data-shell='appbar']").getByRole("link", { name: "Messages, 3 unread" }).click()
  await expect(page).toHaveURL(/\/athlete\/messages$/)
  const row = main(page).getByRole("link", { name: /Saturday starts at 8am/ })
  await expect(row).toContainText("(unread)")
  await row.click()
  await expect(page).toHaveURL(new RegExp(`${announcementPath}$`))
  await expect(main(page).locator("[data-announcement-body]")).toHaveText(text)
  // One way: no reply box, and an athlete does not see who else has read it.
  await expect(main(page).getByRole("textbox")).toHaveCount(0)
  await expect(main(page)).not.toContainText("Not read yet")
  await expect(badge(page)).toHaveText("2")

  // Reading the rest clears the badge.
  await page.goto("/athlete/messages")
  await main(page).getByRole("link", { name: /Training moved to 5pm/ }).click()
  await expect(badge(page)).toHaveText("1")
  await page.goto("/athlete/messages?tab=direct")
  await main(page).getByRole("link", { name: /Andre Campbell/ }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Andre Campbell" })).toBeVisible()
  await expect(badge(page)).toHaveCount(0)
  await expect(page.locator("header[data-shell='appbar']").getByRole("link", { name: "Messages", exact: true })).toBeVisible()
  await page.goto("/athlete/home")
  await expect(main(page)).not.toContainText("Saturday starts at 8am")

  // Back with the coach: Marcus has read it.
  await signIn(page, "coach")
  await page.goto(announcementPath.replace("/athlete/", "/coach/"))
  await expect(main(page).getByRole("list", { name: "People who have read it" })).toContainText("Marcus Johnson")
  await expect(main(page).getByRole("list", { name: "People who have not read it" })).not.toContainText("Marcus Johnson")
})

test("a coach and an athlete exchange a direct message", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await signIn(page, "coach")
  await page.goto("/coach/messages")
  // Unread first: Sarah has written, Marcus has not.
  await expect(main(page).getByRole("list", { name: "Conversations" }).getByRole("link").first()).toContainText("Sarah Chen")

  // Start from the roster. An athlete with no login is listed and cannot be picked.
  await page.getByRole("button", { name: "Message an athlete" }).first().click()
  const picker = page.getByRole("dialog", { name: "Message an athlete" })
  await expect(picker.getByRole("radio", { name: /Sophia Kim/ })).toBeDisabled()
  await expect(picker).toContainText("No login")
  await picker.getByRole("radio", { name: /Marcus Johnson/ }).click()

  await expect(page).toHaveURL(/\/coach\/messages\/t\/mock-thread-marcus$/)
  await expect(page.getByRole("heading", { level: 1, name: "Marcus Johnson" })).toBeVisible()
  // Both people are told who else can read.
  await expect(main(page)).toContainText("Club admins can read messages between coaches and athletes.")
  await send(page, "Marcus Johnson", "Bring your spikes tomorrow, we are on the track.")
  // Sent messages cannot be changed or taken back.
  await expect(main(page).getByRole("button", { name: /edit|delete/i })).toHaveCount(0)
  // Not read by Marcus yet.
  await expect(main(page)).not.toContainText("Seen")

  // The athlete's side: an unread conversation, the same safeguarding line, and a reply.
  await signIn(page, "athlete")
  await page.goto("/athlete/messages?tab=direct")
  const row = main(page).getByRole("link", { name: /Andre Campbell/ })
  await expect(row).toContainText("2 new messages")
  await row.click()
  await expect(main(page)).toContainText("Club admins can read messages between coaches and athletes.")
  await expect(main(page)).toContainText("Bring your spikes tomorrow, we are on the track.")
  await send(page, "Andre Campbell", "Will do. Knee is fine today.")

  // The coach sees the reply, and "Seen" under their own last message only.
  await signIn(page, "coach")
  await page.goto("/coach/messages")
  await expect(main(page).getByRole("link", { name: /Marcus Johnson/ })).toContainText("Will do. Knee is fine today.")
  await main(page).getByRole("link", { name: /Marcus Johnson/ }).click()
  await expect(main(page).locator("[data-message-id]").last()).toContainText("Will do. Knee is fine today.")
  await expect(main(page).getByText("Seen", { exact: true })).toHaveCount(1)
  await expect(main(page).locator("[data-message-id]").filter({ hasText: "Bring your spikes tomorrow" })).toContainText("Seen")
})

test("the composer limits length, and a coach is told when a guardian contact is on file", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, "coach")
  await page.goto("/coach/messages/t/mock-thread-sarah")
  await expect(page.getByRole("heading", { level: 1, name: "Sarah Chen" })).toBeVisible()
  await expect(main(page)).toContainText("Sarah Chen is under 18 and a guardian contact is on file. Guardians are not copied in on messages.")

  const box = page.getByRole("textbox", { name: "Message to Sarah Chen" })
  const sendButton = page.getByRole("button", { name: "Send" })
  await expect(sendButton).toBeDisabled()
  await box.fill("a".repeat(960))
  await expect(main(page)).toContainText("40 left")
  await expect(sendButton).toBeEnabled()
  await box.fill("a".repeat(1001))
  await expect(main(page)).toContainText("1 over the limit")
  await expect(sendButton).toBeDisabled()

  // The composer sits above the tab bar, never under it, and the page does not scroll sideways.
  const layout = await page.evaluate(() => {
    const composer = document.querySelector("[data-sk-composer]")!.getBoundingClientRect()
    const tabBar = document.querySelector("nav[data-shell='tabbar']")!.getBoundingClientRect()
    return { above: composer.bottom <= tabBar.top + 1, sideways: document.documentElement.scrollWidth > window.innerWidth }
  })
  expect(layout).toEqual({ above: true, sideways: false })

  // No guardian line for an adult athlete.
  await page.goto("/coach/messages/t/mock-thread-marcus")
  await expect(page.getByRole("heading", { level: 1, name: "Marcus Johnson" })).toBeVisible()
  await expect(main(page)).not.toContainText("guardian contact")
})

test("an athlete starts a conversation with their own coach", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, "athlete")
  await page.goto("/athlete/messages")
  await page.getByRole("button", { name: "Message a coach" }).first().click()
  // One coach on the team: straight to the conversation with them.
  await expect(page).toHaveURL(/\/athlete\/messages\/t\/mock-thread-marcus$/)
  await expect(page.getByRole("heading", { level: 1, name: "Andre Campbell" })).toBeVisible()

  // A coach of another team, or another athlete, cannot be messaged: the screen says why.
  await page.goto("/athlete/messages/coach/mock-user-a2")
  await expect(main(page)).toContainText("You can only message the coaches of your own team.")
  await expect(main(page).getByRole("textbox")).toHaveCount(0)
})

test("a club admin reads a reported conversation, cannot write in it, and hides a message", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const reported = "How did the knee feel after yesterday's session?"

  // The athlete reports one of the coach's messages.
  await signIn(page, "athlete")
  await page.goto("/athlete/messages/t/mock-thread-marcus")
  const message = main(page).locator("[data-message-id]").filter({ hasText: reported })
  await message.getByRole("button", { name: "Report" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Report message" }).click()
  await expect(message).toContainText("You reported this")
  // Their own messages have no Report.
  await expect(main(page).locator("[data-message-id][data-mine='true']").getByRole("button", { name: "Report" })).toHaveCount(0)

  // The club admin: a count on Messages, the reported conversation first.
  await signIn(page, "club-admin")
  await page.goto("/club-admin/dashboard")
  await page.locator("header[data-shell='topbar']").getByRole("link", { name: /^Messages, 1 unread/ }).click()
  await expect(page).toHaveURL(/\/club-admin\/messages$/)
  await page.getByRole("tab", { name: /Message oversight/ }).click()
  await expect(main(page)).toContainText("Guardian copies are off for this club")
  const first = main(page).getByRole("list", { name: "Conversations in the club" }).getByRole("link").first()
  await expect(first).toContainText("Andre Campbell and Marcus Johnson")
  await expect(first).toContainText("1 reported message to review")
  await first.click()

  // Read only: every message, no composer.
  await expect(page.getByRole("heading", { level: 1, name: "Andre Campbell and Marcus Johnson" })).toBeVisible()
  await expect(main(page).getByRole("textbox")).toHaveCount(0)
  await expect(main(page).getByRole("button", { name: "Send" })).toHaveCount(0)
  await expect(main(page)).toContainText("Club admins read conversations and never write in them.")
  const flagged = main(page).locator("[data-message-id]").filter({ hasText: reported })
  await expect(flagged).toContainText("Reported")

  // Hide it.
  await flagged.getByRole("button", { name: "Hide message" }).click()
  await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Hide message" }).click()
  await expect(main(page)).toContainText("Message hidden by a club admin")
  await expect(main(page).getByText("Reported", { exact: true })).toHaveCount(0)
  await page.goto("/club-admin/messages?tab=oversight")
  await expect(main(page)).not.toContainText("reported message to review")
  await expect(main(page)).toContainText("1 hidden")

  // Both people now see the stub and not the text.
  await signIn(page, "athlete")
  await page.goto("/athlete/messages/t/mock-thread-marcus")
  await expect(main(page)).toContainText("Message hidden by a club admin")
  await expect(main(page)).not.toContainText(reported)
  await signIn(page, "coach")
  await page.goto("/coach/messages/t/mock-thread-marcus")
  await expect(main(page)).toContainText("Message hidden by a club admin")
  await expect(main(page)).not.toContainText(reported)
})

test("a club admin posts to the whole club and a coach receives it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, "club-admin")
  await page.goto("/club-admin/dashboard")
  // On a phone, Messages is behind More for a club admin.
  await page.locator("nav[data-shell='tabbar']").getByRole("button", { name: "More" }).click()
  await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: /Messages/ }).click()
  await expect(page).toHaveURL(/\/club-admin\/messages$/)
  await page.getByRole("link", { name: "New announcement" }).first().click()
  await expect(page.getByRole("radio", { name: "Whole club" })).toBeChecked()
  await page.getByLabel("What do you want to say").fill("The track is closed on Sunday for resurfacing.")
  await page.getByRole("button", { name: "Post announcement" }).click()
  await expect(main(page).locator("[data-announcement-body]")).toHaveText("The track is closed on Sunday for resurfacing.")
  await expect(main(page)).toContainText("To the whole club")

  await signIn(page, "coach")
  await page.goto("/coach/messages?tab=announcements")
  const row = main(page).getByRole("link", { name: /The track is closed on Sunday/ })
  await expect(row).toContainText("to the whole club")
  await row.click()
  // A coach who received a club announcement reads it; only its sender and club admins see who else has.
  await expect(main(page).locator("[data-announcement-body]")).toBeVisible()
  await expect(main(page)).not.toContainText("Not read yet")
})
