import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { EnvelopeSimple, SignOut } from "@phosphor-icons/react"
import { AUTH_PHOTOS, AuthBrand } from "@/layouts/auth-layout"
import type { AccessBlock } from "@/lib/access-control"
import { clearSessionCookies } from "@/lib/auth-session"
import { MOCK_COACH_TEAM_STORAGE_KEY, MOCK_ROLE_STORAGE_KEY } from "@/lib/mock-auth"
import { getBrowserSupabaseClient } from "@/lib/supabase/client"
import { getBackendMode } from "@/lib/supabase/config"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

/**
 * Shown by the route guard in place of the app when the database has closed the member's access:
 * the club is suspended or cancelled, or a club admin turned this member's access off.
 * Every tenant-scoped read returns nothing in those cases, so there is no app to show.
 */
function copyFor(block: AccessBlock, isClubAdmin: boolean) {
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
  const { title, body } = copyFor(block, isClubAdmin)

  const handleSignOut = async () => {
    setSigningOut(true)
    const backendMode = getBackendMode()
    if (backendMode === "supabase") {
      const supabase = getBrowserSupabaseClient()
      if (supabase) await supabase.auth.signOut().catch(() => undefined)
    }
    if (backendMode === "mock") {
      window.localStorage.removeItem(MOCK_ROLE_STORAGE_KEY)
      window.localStorage.removeItem(MOCK_COACH_TEAM_STORAGE_KEY)
    }
    clearSessionCookies()
    navigate("/login", { replace: true })
  }

  return (
    <div className="min-h-dvh bg-sk-canvas">
      <main className="mx-auto flex min-h-dvh w-full max-w-[1080px] flex-col px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
        <AuthBrand className="self-start" />
        <div className="flex flex-1 items-center py-8">
          <section className="grid w-full overflow-hidden rounded-[28px] border border-sk-line bg-white md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
            <div className="flex flex-col justify-center gap-6 p-6 sm:p-10">
              <div className="space-y-3" role="status">
                <h1 className="sk-title">{title}</h1>
                <p className="sk-lede">{body}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="sk-btn sk-btn-primary" disabled={signingOut} onClick={() => void handleSignOut()}>
                  <SignOut className="size-5" weight="bold" aria-hidden />
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
                {isClubAdmin && block !== "member-inactive" ? (
                  <a href={SUPPORT_MAILTO} className="sk-btn sk-btn-quiet">
                    <EnvelopeSimple className="size-5" weight="bold" aria-hidden />
                    Email support
                  </a>
                ) : null}
              </div>
            </div>
            <div className="relative order-first h-36 bg-sk-blue-tint md:order-none md:h-auto md:min-h-[440px]">
              <img
                src={AUTH_PHOTOS.lanes.src}
                alt={AUTH_PHOTOS.lanes.alt}
                decoding="async"
                className="absolute inset-0 size-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.visibility = "hidden"
                }}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
