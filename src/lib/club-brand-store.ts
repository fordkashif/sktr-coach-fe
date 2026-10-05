import { useEffect, useSyncExternalStore } from "react"
import { getCurrentClubBrand, type ClubBrand } from "@/lib/data/club-admin/club-profile-data"
import { useRole } from "@/lib/role-context"

/**
 * One shared copy of the signed-in member's club (name, logo, colour), so the app shell, the Club
 * screen and printed sheets show the same thing and update together when an admin changes it.
 * A tiny module store, like account-store, so no provider has to wrap the app.
 */

type BrandState = {
  /** role + email the brand was loaded for. A different person signing in reloads it. */
  key: string | null
  brand: ClubBrand | null
  loaded: boolean
}

let state: BrandState = { key: null, brand: null, loaded: false }
let loadToken = 0
const listeners = new Set<() => void>()

function setState(next: BrandState) {
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

async function load(key: string) {
  const token = ++loadToken
  const role = key.split("|")[0] ?? ""
  const brand = await getCurrentClubBrand(role)
  if (token !== loadToken) return
  setState({ key, brand, loaded: true })
}

function ensureLoaded(key: string | null) {
  if (!key) {
    if (state.key !== null) {
      loadToken += 1
      setState({ key: null, brand: null, loaded: false })
    }
    return
  }
  if (state.key === key) return
  setState({ key, brand: null, loaded: false })
  void load(key)
}

/** Reload after a club admin changed the club's name, colour or logo. */
export async function refreshClubBrand() {
  if (state.key) await load(state.key)
}

/** The club of the signed-in member, or null (no club, not loaded yet, or it could not be read). */
export function useClubBrand(): { brand: ClubBrand | null; loaded: boolean } {
  const { role, userEmail } = useRole()
  const key = userEmail && role !== "platform-admin" ? `${role}|${userEmail.toLowerCase()}` : null
  useEffect(() => {
    ensureLoaded(key)
  }, [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const current = snapshot.key === key ? snapshot : null
  return { brand: current?.brand ?? null, loaded: Boolean(current?.loaded) }
}
