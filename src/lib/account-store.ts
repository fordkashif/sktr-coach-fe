import { useCallback, useEffect, useSyncExternalStore } from "react"
import { getCurrentAccount, getVisibleAvatars, type AvatarMap, type CurrentAccount } from "@/lib/data/account/account-data"
import { useRole } from "@/lib/role-context"

/**
 * One shared copy of the signed-in person's account (name, photo) and of the photos they may see,
 * so the shell, the account screen and every roster show the same thing and update together.
 * It is a tiny module store rather than a React context so no provider has to wrap the app.
 */

type AccountState = {
  /** role + email the data was loaded for. A different person signing in reloads it. */
  key: string | null
  account: CurrentAccount | null
  avatars: AvatarMap
  loaded: boolean
}

let state: AccountState = { key: null, account: null, avatars: {}, loaded: false }
let loadToken = 0
const listeners = new Set<() => void>()

function setState(next: AccountState) {
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
  const [account, avatars] = await Promise.all([getCurrentAccount(), getVisibleAvatars()])
  if (token !== loadToken) return
  setState({ key, account: account.ok ? account.data : null, avatars, loaded: true })
}

function ensureLoaded(key: string | null) {
  if (!key) {
    if (state.key !== null) {
      loadToken += 1
      setState({ key: null, account: null, avatars: {}, loaded: false })
    }
    return
  }
  if (state.key === key) return
  setState({ key, account: null, avatars: {}, loaded: false })
  void load(key)
}

/** Reload after the person changed their own name or photo. */
export async function refreshAccount() {
  if (state.key) await load(state.key)
}

function roleLabel(role: string) {
  if (role === "platform-admin") return "Platform admin"
  if (role === "club-admin") return "Club admin"
  if (role === "coach") return "Coach"
  if (role === "guardian") return "Guardian"
  return "Athlete"
}

/** Only for an account with no name yet: a readable guess from the email address. */
export function nameFromEmail(email: string | null, role: string) {
  const localPart = email?.split("@")[0] ?? ""
  const label = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
    .trim()
  return label || roleLabel(role)
}

function useAccountState() {
  const { role, userEmail } = useRole()
  const key = userEmail ? `${role}|${userEmail.toLowerCase()}` : null
  useEffect(() => {
    ensureLoaded(key)
  }, [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { snapshot: snapshot.key === key ? snapshot : null, role, userEmail }
}

/** The signed-in person: their real name when they have one, and their photo. */
export function useCurrentAccount() {
  const { snapshot, role, userEmail } = useAccountState()
  const account = snapshot?.account ?? null
  return {
    account,
    loaded: Boolean(snapshot?.loaded),
    hasName: Boolean(account?.displayName),
    displayName: account?.displayName || nameFromEmail(userEmail, role),
    avatarUrl: account?.avatarUrl ?? null,
  }
}

/** Looks up the photo of a person in a list. Returns null when there is none or the caller may not see it. */
export function useAvatarLookup() {
  const { snapshot } = useAccountState()
  const avatars = snapshot?.avatars
  return useCallback(
    (person: { athleteId?: string | null; userId?: string | null; email?: string | null }) => {
      if (!avatars) return null
      return (
        (person.athleteId ? avatars[`a:${person.athleteId}`] : undefined) ??
        (person.userId ? avatars[`u:${person.userId}`] : undefined) ??
        (person.email ? avatars[`e:${person.email.trim().toLowerCase()}`] : undefined) ??
        null
      )
    },
    [avatars],
  )
}
