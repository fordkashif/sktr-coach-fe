import type { ReactNode } from "react"
import { LinkButton, Screen, ScreenHeader, ScreenSkeleton } from "@/components/sk"
import { useCoachPermissions, useCoachTeams } from "@/lib/coach-teams"

/** What a screen needs before an assistant coach may open it. */
export type AssistantGateNeed = "plans" | "club-content" | "athlete-records" | "reports" | "announcements" | "messages"

const COPY: Record<AssistantGateNeed, { title: string; body: string }> = {
  plans: {
    title: "Plans are with the lead coach",
    body: "As an assistant coach you can see what each athlete has to do, on their page, and log sessions for them. Building, editing and publishing plans is for the lead coach and coaches of the team.",
  },
  "club-content": {
    title: "This is with the lead coach",
    body: "Library exercises and plan templates are written by the lead coach and coaches. As an assistant coach you work from the sessions they publish.",
  },
  "athlete-records": {
    title: "This is with the lead coach",
    body: "As an assistant coach you can take attendance, log sessions for athletes and enter test results. Results, lift maxes and competitions are kept by the lead coach and coaches of the team.",
  },
  reports: {
    title: "Reports are with the lead coach",
    body: "Reports and exports are for the lead coach and coaches of the team. You can still open each athlete to see their training and results.",
  },
  announcements: {
    title: "Announcements are with the lead coach",
    body: "The lead coach and coaches post announcements to the team. You still receive the ones sent to it.",
  },
  messages: {
    title: "Messaging is off for assistant coaches",
    body: "On this team assistant coaches do not message athletes directly. The lead coach or a club admin can turn that on for the team.",
  },
}

/**
 * Wraps a coach screen an assistant coach may not use. Lead coaches, coaches and club admins pass
 * straight through. An assistant gets one plain screen saying whose job it is, with a way back:
 * no empty page and no buttons that would only fail. The database refuses the same things.
 */
export function AssistantGate({ need, children }: { need: AssistantGateNeed; children: ReactNode }) {
  const { isCoach, loading } = useCoachTeams()
  const permissions = useCoachPermissions()
  if (!isCoach) return <>{children}</>
  if (loading) return <ScreenSkeleton />

  const allowed =
    need === "plans"
      ? permissions.canEditPlans
      : need === "club-content"
        ? permissions.authorsClubContent && permissions.canEditPlans
        : need === "athlete-records"
          ? permissions.canEditAthleteRecords
          : need === "reports"
            ? permissions.canExportReports
            : need === "announcements"
              ? permissions.canPostAnnouncements
              : permissions.canMessageAthletes
  if (allowed) return <>{children}</>

  const copy = COPY[need]
  return (
    <Screen>
      <ScreenHeader title={copy.title} lede={copy.body} />
      <p className="text-sm text-sk-mute" data-assistant-gate={need}>
        You are an assistant coach{permissions.teamName ? ` on ${permissions.teamName}` : ""}.
      </p>
      <div>
        <LinkButton to="/coach/dashboard">Back to the dashboard</LinkButton>
      </div>
    </Screen>
  )
}
