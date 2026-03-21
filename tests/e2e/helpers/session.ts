import type { Page } from "@playwright/test"

export type Role = "athlete" | "coach" | "club-admin"

const BASE_URL = "http://127.0.0.1:3007"

export async function seedMockSession(
  page: Page,
  params: {
    role: Role
    tenantId?: string
    userEmail?: string
    coachTeamId?: string
  },
) {
  const tenantId = params.tenantId ?? "elite-track-club"
  const userEmail =
    params.userEmail ??
    (params.role === "athlete"
      ? "athlete@pacelab.local"
      : params.role === "coach"
        ? "coach@pacelab.local"
        : "clubadmin@pacelab.local")

  await page.addInitScript(
    ({ roleValue, emailValue, coachTeamIdValue }) => {
      window.localStorage.setItem("pacelab:mock-role", roleValue)
      window.localStorage.setItem("pacelab:mock-user-email", emailValue)
      if (coachTeamIdValue) {
        window.localStorage.setItem("pacelab:mock-coach-team", coachTeamIdValue)
      } else {
        window.localStorage.removeItem("pacelab:mock-coach-team")
      }
    },
    { roleValue: params.role, emailValue: userEmail, coachTeamIdValue: params.coachTeamId },
  )

  await page.context().addCookies([
    { name: "pacelab_session", value: "1", url: BASE_URL },
    { name: "pacelab_role", value: params.role, url: BASE_URL },
    { name: "pacelab_tenant", value: tenantId, url: BASE_URL },
    { name: "pacelab_user", value: encodeURIComponent(userEmail), url: BASE_URL },
    {
      name: "pacelab_coach_team",
      value: params.coachTeamId ?? "",
      url: BASE_URL,
    },
  ])
}
