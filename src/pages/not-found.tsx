import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, House, SignIn } from "@phosphor-icons/react"
import { AUTH_PHOTOS, AuthBrand } from "@/layouts/auth-layout"

export function NotFoundPage() {
  const navigate = useNavigate()
  const canGoBack = typeof window !== "undefined" && window.history.length > 1

  return (
    <div className="min-h-dvh bg-sk-canvas">
      <main className="mx-auto flex min-h-dvh w-full max-w-[1080px] flex-col px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
        <AuthBrand className="self-start" />
        <div className="flex flex-1 items-center py-8">
          <section className="grid w-full overflow-hidden rounded-[28px] border border-sk-line bg-white md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
            <div className="flex flex-col justify-center gap-6 p-6 sm:p-10">
              <div className="space-y-3">
                <p className="sk-num text-[5rem] text-sk-blue sm:text-[7rem]">404</p>
                <h1 className="sk-title">This lane is empty</h1>
                <p className="sk-lede">
                  There is no page at this address. The link may be old, or the page may have moved. Your account and your data are fine.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/" className="sk-btn sk-btn-primary">
                  <House className="size-5" weight="bold" aria-hidden />
                  Go to home
                </Link>
                <Link to="/login" className="sk-btn sk-btn-quiet">
                  <SignIn className="size-5" weight="bold" aria-hidden />
                  Go to login
                </Link>
                {canGoBack ? (
                  <button type="button" className="sk-btn sk-btn-ghost" onClick={() => navigate(-1)}>
                    <ArrowLeft className="size-5" weight="bold" aria-hidden />
                    Go back
                  </button>
                ) : null}
              </div>
            </div>
            <div className="relative order-first h-36 bg-sk-blue-tint md:order-none md:h-auto md:min-h-[440px]">
              <img
                src={AUTH_PHOTOS.markings.src}
                alt={AUTH_PHOTOS.markings.alt}
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
