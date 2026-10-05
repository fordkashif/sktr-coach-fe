import { NavTabs } from "@/components/sk"

/** The three screens of the coach's Plans area. Sits straight under the header of each. */
export function PlansNav() {
  return (
    <NavTabs
      label="Plans"
      items={[
        { to: "/coach/training-plan", label: "Plans", exact: true },
        { to: "/coach/training-plan/exercises", label: "Exercises" },
        { to: "/coach/training-plan/maxes", label: "Best lifts" },
      ]}
    />
  )
}
