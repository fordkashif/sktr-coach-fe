import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { SignOut } from "@phosphor-icons/react"
import { Button, Dialog } from "@/components/sk"
import { clearSessionCookies } from "@/lib/auth-session"
import { MOCK_COACH_TEAM_STORAGE_KEY, MOCK_ROLE_STORAGE_KEY } from "@/lib/mock-auth"
import { removePushOnSignOut } from "@/lib/push/push-client"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"

/** Signs this device out (other devices stay signed in) and goes to the sign-in page. */
async function signOutThisDevice() {
  // Stops push for this device first (needs the sign-in). Never throws, never blocks sign out.
  await removePushOnSignOut()
  if (getBackendMode() === "supabase") {
    const supabase = getBrowserSupabaseClient()
    if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined)
  } else {
    window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
    window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
  }
  clearSessionCookies()
}

/**
 * "Sign out?" asked before signing out, so a stray tap on a phone does not end the session.
 * Every sign out button in the app opens this (profile menu, Account, the athlete's profile).
 */
export function SignOutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    await signOutThisDevice()
    setBusy(false)
    onOpenChange(false)
    navigate("/login")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title="Sign out?"
      description="You will need your email and password to sign back in on this device. Your other devices stay signed in."
      className="sm:max-w-md"
      footer={
        <>
          <Button variant="quiet" onClick={() => onOpenChange(false)} disabled={busy}>
            Stay signed in
          </Button>
          <button type="button" className="sk-btn sk-btn-danger-solid" onClick={() => void confirm()} disabled={busy} data-confirm-sign-out>
            <SignOut className="size-5" weight="bold" aria-hidden />
            {busy ? "Signing out..." : "Sign out"}
          </button>
        </>
      }
    >
      {null}
    </Dialog>
  )
}
