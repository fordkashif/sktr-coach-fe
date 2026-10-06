import { useEffect, useMemo, useSyncExternalStore } from "react"
import { getUnitSettings, type UnitSettings } from "@/lib/data/account/unit-preferences-data"
import { useRole } from "@/lib/role-context"
import {
  DEFAULT_UNITS,
  formatBodyWeight,
  formatHeight,
  formatLoad,
  isHeightUnit,
  isWeightUnit,
  loadForViewer,
  loadToKg,
  localizeLoadText,
  localizeTargetText,
  weightUnitWord,
  type UnitPreferences,
} from "@/lib/units"

/**
 * One shared copy of the signed-in person's units (kilograms or pounds, centimetres or feet and
 * inches), so every screen converts the same way and changes together when the setting changes.
 * A tiny module store like account-store.ts, so no provider has to wrap the app.
 *
 * The last known choice is kept on the device too, only so a screen does not flash kilograms
 * before the saved preference arrives. The saved preference (per person, on every device) wins.
 */

type UnitsState = { key: string | null; settings: UnitSettings | null; units: UnitPreferences; loaded: boolean }

const CACHE_KEY = "pacelab:units-cache"
let state: UnitsState = { key: null, settings: null, units: DEFAULT_UNITS, loaded: false }
let loadToken = 0
const listeners = new Set<() => void>()

function setState(next: UnitsState) {
  state = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => state
const getServerSnapshot = () => state

function readCache(key: string): UnitPreferences {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, { weight?: unknown; height?: unknown }> | null
    const found = parsed?.[key]
    return { weight: isWeightUnit(found?.weight) ? found.weight : DEFAULT_UNITS.weight, height: isHeightUnit(found?.height) ? found.height : DEFAULT_UNITS.height }
  } catch {
    return DEFAULT_UNITS
  }
}

function writeCache(key: string, units: UnitPreferences) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ [key]: units }))
  } catch {
    // Only a convenience.
  }
}

async function load(key: string) {
  const token = ++loadToken
  const result = await getUnitSettings()
  if (token !== loadToken) return
  if (!result.ok) return setState({ ...state, loaded: true })
  writeCache(key, result.data.effective)
  setState({ key, settings: result.data, units: result.data.effective, loaded: true })
}

function ensureLoaded(key: string | null) {
  if (!key) {
    if (state.key !== null) {
      loadToken += 1
      setState({ key: null, settings: null, units: DEFAULT_UNITS, loaded: false })
    }
    return
  }
  if (state.key === key) return
  setState({ key, settings: null, units: readCache(key), loaded: false })
  void load(key)
}

/**
 * The units in force right now, for plain functions that write a line of text and cannot use a
 * hook (see units-view.ts). Screens are remounted when this changes (UnitsScope), so what they
 * wrote is never stale.
 */
export function viewerUnits(): UnitPreferences {
  return state.units
}

/** Reload after the person, or their club admin, changed the units. */
export async function refreshUnits() {
  if (state.key) await load(state.key)
}

function useUnitsState() {
  const { role, userEmail } = useRole()
  const key = userEmail ? `${role}|${userEmail.toLowerCase()}` : null
  useEffect(() => {
    ensureLoaded(key)
  }, [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return snapshot.key === key ? snapshot : null
}

/** The person's own choice, the club default and what applies, for the settings screens. */
export function useUnitSettings() {
  const snapshot = useUnitsState()
  return { settings: snapshot?.settings ?? null, loaded: Boolean(snapshot?.loaded) }
}

/**
 * The units of the person looking at the screen, with the conversions bound to them.
 * Stored values stay metric: use `load` and `text` to show, `toKg` to store what was typed.
 */
export function useUnits() {
  const snapshot = useUnitsState()
  const weight = snapshot?.units.weight ?? DEFAULT_UNITS.weight
  const height = snapshot?.units.height ?? DEFAULT_UNITS.height
  return useMemo(
    () => ({
      weight,
      height,
      /** "kg" or "lb". */
      weightLabel: weight,
      /** "kilograms" or "pounds". */
      weightWord: weightUnitWord(weight),
      /** The number to show for stored kilograms. */
      loadNumber: (kg: number) => loadForViewer(kg, weight),
      /** Kilograms to store for a number typed in the person's unit. */
      toKg: (value: number) => loadToKg(value, weight),
      /** "120 kg" or "264.5 lb". */
      load: (kg: number) => formatLoad(kg, weight),
      /** A line naming kilogram loads, rewritten in the person's unit. */
      text: <T extends string | null | undefined>(value: T): T => localizeLoadText(value, weight) as T,
      /** A prescription in words ("3 x 5 at 100"), rewritten in the person's unit. */
      target: <T extends string | null | undefined>(value: T): T => localizeTargetText(value, weight) as T,
      bodyWeight: (kg: number) => formatBodyWeight(kg, weight),
      bodyHeight: (cm: number) => formatHeight(cm, height),
    }),
    [weight, height],
  )
}

export type Units = ReturnType<typeof useUnits>
