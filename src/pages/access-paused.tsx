import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { EnvelopeSimple, SignOut } from "@phosphor-icons/react"
import { Button, ScreenHeader } from "@/components/sk"
import { PublicFrame } from "@/layouts/auth-layout"
import type { AccessBlock } from "@/lib/access-control"
import { clearSessionCookies } from "@/lib/auth-session"
import { getMyClubClosure, type ClubClosure } from "@/lib/data/club-admin/club-exit-data"
import { MOCK_COACH_TEAM_STORAGE_KEY, MOCK_ROLE_STORAGE_KEY } from "@/lib/mock-auth"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

/**
 * Shown by the route guard in place of the app when the database has closed the member's access:
 * the club is suspended, cancelled or closed by its owner, or a club admin turned this member's access off.
 * Every tenant-scoped read returns nothing in those cases, so there is no app to show.
 */
function closedDay(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
}

function copyFor(block: AccessBlock, isClubAdmin: boolean, closure: ClubClosure | null = null) {
  if (block === "club-closed") {
    const name = closure?.clubName ? closure.clubName : "This club"
    if (closure?.deleted) {
      return { title: "This club has been deleted", body: `${name} was closed and its data has been deleted for good. There is nothing left to sign in to.` }
    }
    const when = closure ? closedDay(closure.deleteAfter) : null
    return {
      title: "This club is closed",
      body: `${name} was closed by its owner, so nobody in the club can use SKTR Coach. ${
        when ? `Its data is kept until ${when} and is then deleted for good.` : "Its data is kept for 90 days after closing and is then deleted for good."
      } ${isClubAdmin ? `To reopen the club before then, email ${SUPPORT_EMAIL}.` : "If you think this is a mistake, contact your club admin."}`,
    }
  }
  if (block === "member-inactive") {
    return {
      title: "Your access is turned off",
      body: "A club admin turned off your access to this club. Your training data is kept. Contact your club admin to get back in.",
    }
  }

  const contact = isClubAdmin ? `Email ${SUPPORT_EMAIL} to get it back.` : "Contact your club admin."
  if (block === "club-cancelled") {
    return {
      title: "This club's access has ended",
      body: `This club's account was cancelled, so nobody in the club can use SKTR Coach right now. The club's data is kept. ${contact}`,
    }
  }

  return {
    title: "This club's access is paused",
    body: `Nobody in the club can use SKTR Coach while it is paused. The club's data is kept and comes back when access is restored. ${contact}`,
  }
}

export function AccessPausedPage({ block, isClubAdmin }: { block: AccessBlock; isClubAdmin: boolean }) {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [closure, setClosure] = useState<ClubClosure | null>(null)
  useEffect(() => {
    if (block !== "club-closed") return
    let cancelled = false
    void getMyClubClosure().then((result) => {
      if (!cancelled) setClosure(result)
    })
    return () => {
      cancelled = true
    }
  }, [block])
  const { title, body } = copyFor(block, isClubAdmin, closure)

  const handleSignOut = async () => {
    setSigningOut(true)
    const backendMode = getBackendMode()
    if (backendMode === "supabase") {
      const supabase = getBrowserSupabaseClient()
      if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined)
    }
    if (backendMode === "mock") {
      window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    }
    clearSessionCookies()
    navigate("/login", { replace: true })
  }

  return (
    <PublicFrame>
      <ScreenHeader title={title} lede={<span role="status">{body}</span>} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={signingOut} onClick={() => void handleSignOut()}>
          <SignOut className="size-5" weight="bold" aria-hidden />
          {signingOut ? "Signing out..." : "Sign out"}
        </Button>
        {isClubAdmin && block !== "member-inactive" ? (
          <a href={SUPPORT_MAILTO} className="sk-btn sk-btn-secondary">
            <EnvelopeSimple className="size-5" weight="bold" aria-hidden />
            Email support
          </a>
        ) : null}
      </div>
    </PublicFrame>
  )
}
