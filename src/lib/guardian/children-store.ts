import { useCallback, useEffect, useSyncExternalStore } from "react"
import { getCookieValue, ROLE_COOKIE, SESSION_UPDATED_EVENT, USER_COOKIE } from "@/lib/auth-session"
import { getGuardianChildren } from "@/lib/data/guardian/guardian-data"
import type { GuardianChild } from "@/lib/data/guardian/types"

/**
 * The athletes the signed-in parent or guardian follows, and which one the screens show.
 * A small module store (like account-store.ts), so the shell's switcher and every guardian screen
 * share one copy with no provider. The selection is remembered per person on this device, and a
 * link can carry it as ?child=<athlete id>.
 */

type State = {
  key: string | null
  children: GuardianChild[]
  selectedId: string | null
  loaded: boolean
  error: string | null
}

let state: State = { key: null, children: [], selectedId: null, loaded: false, error: null }
let loadToken = 0
const listeners = new Set<() => void>()

function setState(next: State) {
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

const STORAGE_PREFIX = "pacelab:guardian-child:"

function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`)
  } catch {
    return null
  }
}

function remember(key: string | null, athleteId: string) {
  if (!key) return
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, athleteId)
  } catch {
    // Storage can be blocked. The selection then lasts until the page is reloaded.
  }
}

function currentKey(): string | null {
  if (getCookieValue(ROLE_COOKIE) !== "guardian") return null
  return getCookieValue(USER_COOKIE)?.trim().toLowerCase() || "guardian"
}

/** Which child to show: the one asked for (a link), else the one already chosen, else the remembered one, else the first. */
export function pickGuardianChild(children: Array<{ athleteId: string }>, wanted: Array<string | null | undefined>): string | null {
  for (const id of wanted) {
    if (id && children.some((child) => child.athleteId === id)) return id
  }
  return children[0]?.athleteId ?? null
}

async function load(key: string) {
  const token = ++loadToken
  const result = await getGuardianChildren()
  if (token !== loadToken) return
  if (!result.ok) {
    setState({ key, children: [], selectedId: null, loaded: true, error: result.error.message })
    return
  }
  const fromLink = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("child") : null
  const selectedId = pickGuardianChild(result.data, [fromLink, state.key === key ? state.selectedId : null, remembered(key)])
  if (selectedId) remember(key, selectedId)
  setState({ key, children: result.data, selectedId, loaded: true, error: null })
}

function ensureLoaded(key: string | null) {
  if (!key) {
    if (state.key !== null) {
      loadToken += 1
      setState({ key: null, children: [], selectedId: null, loaded: false, error: null })
    }
    return
  }
  if (state.key === key) return
  setState({ key, children: [], selectedId: null, loaded: false, error: null })
  void load(key)
}

export function selectGuardianChild(athleteId: string) {
  if (!state.children.some((child) => child.athleteId === athleteId) || state.selectedId === athleteId) return
  remember(state.key, athleteId)
  setState({ ...state, selectedId: athleteId })
}

/** Reload the list: the club may have added or removed an athlete, or the athlete changed what they share. */
export async function refreshGuardianChildren() {
  if (state.key) await load(state.key)
}

export function useGuardianChildren() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    const sync = () => ensureLoaded(currentKey())
    sync()
    // Coming back to the tab: access may have been ended, or sharing changed, in the meantime.
    const onVisible = () => {
      if (document.visibilityState === "visible" && state.key && state.loaded) void load(state.key)
    }
    window.addEventListener(SESSION_UPDATED_EVENT, sync)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, sync)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const select = useCallback((athleteId: string) => selectGuardianChild(athleteId), [])
  const selected = snapshot.children.find((child) => child.athleteId === snapshot.selectedId) ?? null

  return {
    isGuardian: snapshot.key !== null,
    children: snapshot.children,
    selected,
    loading: snapshot.key !== null && !snapshot.loaded,
    error: snapshot.error,
    select,
  }
}
