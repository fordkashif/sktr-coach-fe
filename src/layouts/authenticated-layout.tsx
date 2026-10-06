import type { ReactNode } from "react"
import { Outlet } from "react-router-dom"
import { AppShell } from "@/components/app-shell"
import { ClubDayBoundary } from "@/components/club-day-boundary"
import { ClubAdminProvider } from "@/lib/club-admin-context"
import { CoachTeamsProvider } from "@/lib/coach-teams"
import { RoleProvider } from "@/lib/role-context"
import { UnitsScope } from "@/components/units-scope"

function AuthenticatedLayoutContent({ children }: { children: ReactNode }) {
  return (
    <RoleProvider>
      <ClubAdminProvider>
        <CoachTeamsProvider>
          <AppShell>
            <UnitsScope>{children}</UnitsScope>
          </AppShell>
        </CoachTeamsProvider>
      </ClubAdminProvider>
    </RoleProvider>
  )
}

export function AuthenticatedLayout() {
  return (
    <AuthenticatedLayoutContent>
      <ClubDayBoundary>
        <Outlet />
      </ClubDayBoundary>
    </AuthenticatedLayoutContent>
  )
}
