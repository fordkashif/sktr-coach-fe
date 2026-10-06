import type { AppRole } from "@/lib/supabase/actor"

/** The first screen for each role. */
export function homePathForRole(role: AppRole): string {
  if (role === "athlete") return "/athlete/home"
  if (role === "coach") return "/coach/dashboard"
  if (role === "guardian") return "/guardian/home"
  if (role === "platform-admin") return "/platform-admin/dashboard"
  return "/club-admin/dashboard"
}
