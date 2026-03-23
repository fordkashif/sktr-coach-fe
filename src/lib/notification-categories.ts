export type NotificationPreferenceCategory = {
  key: string
  title: string
  description: string
  eventTypes: string[]
}

export const NOTIFICATION_PREFERENCE_CATEGORIES: NotificationPreferenceCategory[] = [
  {
    key: "tenant-provisioning",
    title: "Tenant provisioning",
    description: "Request submitted, reviewed, and provisioned updates for new organizations.",
    eventTypes: [
      "tenant_provision_request_submitted",
      "tenant_provision_request_reviewed",
      "tenant_provision_request_provisioned",
    ],
  },
  {
    key: "coach-invites",
    title: "Coach invites",
    description: "Invite intake and acceptance updates for coaches and club-admin staff.",
    eventTypes: ["coach_invite_created", "coach_invite_accepted"],
  },
  {
    key: "athlete-invites",
    title: "Athlete invites",
    description: "Invite-link creation and acceptance updates for coaches and athletes.",
    eventTypes: ["athlete_invite_created", "athlete_invite_accepted"],
  },
  {
    key: "training-plans",
    title: "Training plans",
    description: "Notifications when a published training plan becomes immediately available to an athlete.",
    eventTypes: ["training_plan_published"],
  },
  {
    key: "test-weeks",
    title: "Test weeks",
    description: "Notifications when a published test week opens for an athlete's team.",
    eventTypes: ["test_week_published"],
  },
]
