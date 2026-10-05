"use client"

import { CoachTeamsProvider } from "@/lib/coach-teams"
import { RoleProvider } from "@/lib/role-context"
import { AppShell } from "@/components/app-shell"

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <RoleProvider>
      <CoachTeamsProvider>
        <AppShell>{children}</AppShell>
      </CoachTeamsProvider>
    </RoleProvider>
  )
}
