import { NavTabs } from "@/components/sk"

/** The two screens of the coach's Reports area. Sits straight under the header of each. */
export function ReportsNav() {
  return (
    <NavTabs
      label="Reports"
      className="print:hidden"
      items={[
        { to: "/coach/reports", label: "Reports", exact: true },
        { to: "/coach/reports/load", label: "Load" },
      ]}
    />
  )
}
