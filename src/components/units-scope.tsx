import { Fragment, useRef, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { useUnits } from "@/lib/units-store"

// Where the units are chosen. These screens show the new choice themselves, so they are left in place.
const SETTINGS_PATHS = ["/account", "/club-admin/profile"]

/**
 * Keeps every screen in step with the signed-in person's units (kilograms or pounds, centimetres
 * or feet and inches). It loads the preference once for the whole app and, when the units change
 * (the saved preference arrived on a new device), starts the open screen again so nothing on it is
 * left in the old unit.
 */
export function UnitsScope({ children }: { children: ReactNode }) {
  const units = useUnits()
  const { pathname } = useLocation()
  const key = `${units.weight}|${units.height}`
  const shown = useRef(key)
  if (!SETTINGS_PATHS.includes(pathname)) shown.current = key
  return <Fragment key={shown.current}>{children}</Fragment>
}
