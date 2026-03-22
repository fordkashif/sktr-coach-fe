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
]
