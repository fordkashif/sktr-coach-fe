import { NavTabs, type NavTabItem } from "@/components/sk"

/** Everything under the platform admin's Dashboard tab. The app shell keeps that tab lit on all of them. */
export const PLATFORM_HOME_PATHS = ["/platform-admin/dashboard", "/platform-admin/usage", "/platform-admin/notices", "/platform-admin/status", "/platform-admin/admins"]

const ITEMS: NavTabItem[] = [
  { to: "/platform-admin/dashboard", label: "Overview" },
  { to: "/platform-admin/usage", label: "Usage" },
  { to: "/platform-admin/notices", label: "Notices" },
  { to: "/platform-admin/status", label: "Status" },
  { to: "/platform-admin/admins", label: "Admins" },
]

/** The sections of the platform admin's home. Goes straight under the ScreenHeader of each of them. */
export function PlatformHomeTabs() {
  return <NavTabs label="Platform sections" items={ITEMS} />
}
