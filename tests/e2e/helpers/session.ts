import type { Page } from "@playwright/test"

export type Role = "athlete" | "coach" | "club-admin" | "platform-admin" | "guardian"

const BASE_URL = "http://127.0.0.1:3007"

export async function seedMockSession(
  page: Page,
  params: {
    role: Role
    tenantId?: string
    userEmail?: string
    coachTeamId?: string
    /**
     * Mock mode: assign the demo coach to several teams (for example ["t1", "t4"]), which turns the
     * team switcher on. Stored in localStorage "pacelab:mock-coach-teams". Leave out for the default
     * one-team coach.
     */
    coachTeamIds?: string[]
  },
) {
  const tenantId = params.tenantId ?? "elite-track-club"
  const userEmail =
    params.userEmail ??
    (params.role === "athlete"
      ? "athlete@pacelab.local"
      : params.role === "coach"
        ? "coach@pacelab.local"
        : params.role === "club-admin"
          ? "clubadmin@pacelab.local"
          : params.role === "guardian"
            ? "guardian@pacelab.local"
            : "platformadmin@pacelab.local")

  await page.addInitScript(
    ({ roleValue, emailValue, coachTeamIdValue, coachTeamIdsValue }) => {
      if (coachTeamIdsValue) {
        window.localStorage.setItem("pacelab:mock-coach-teams", coachTeamIdsValue)
      } else {
        window.localStorage.removeItem("pacelab:mock-coach-teams")
      }
      window.localStorage.setItem("pacelab:mock-role", roleValue)
      window.localStorage.setItem("pacelab:mock-user-email", emailValue)
      if (coachTeamIdValue) {
        window.localStorage.setItem("pacelab:mock-coach-team", coachTeamIdValue)
      } else {
        window.localStorage.removeItem("pacelab:mock-coach-team")
      }
    },
    {
      roleValue: params.role,
      emailValue: userEmail,
      coachTeamIdValue: params.coachTeamId,
      coachTeamIdsValue: params.coachTeamIds?.join(",") ?? null,
    },
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
