import { Navigate } from "react-router-dom"

export function PlatformAdminRedirectPage() {
  return <Navigate to="/platform-admin/requests" replace />
}
