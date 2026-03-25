import type { ReactNode } from "react"
import { Outlet } from "react-router-dom"
import { AppShell } from "@/components/app-shell"
import { ClubAdminProvider } from "@/lib/club-admin-context"
import { RoleProvider } from "@/lib/role-context"

function AuthenticatedLayoutContent({ children }: { children: ReactNode }) {
  return (
    <RoleProvider>
      <ClubAdminProvider>
        <AppShell>{children}</AppShell>
      </ClubAdminProvider>
    </RoleProvider>
  )
}

export function AuthenticatedLayout() {
  return (
    <AuthenticatedLayoutContent>
      <Outlet />
    </AuthenticatedLayoutContent>
  )
}
