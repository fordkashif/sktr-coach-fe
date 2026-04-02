import { Link } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, Home09Icon, Login03Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_right,rgba(31,140,255,0.18),transparent_28%),linear-gradient(145deg,#08101d_0%,#0b1324_22%,#f5f8fd_22.1%,#eef4fb_100%)]">
      <div className="mx-auto flex min-h-dvh w-full max-w-7xl items-center px-4 py-10 sm:px-6">
        <div className="grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-center">
          <div className="rounded-[32px] border border-white/10 bg-[#091223]/90 p-6 text-white shadow-[0_28px_80px_rgba(2,6,23,0.35)] backdrop-blur">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <img src="/app-icon.png" alt="PaceLab" className="h-8 w-8 rounded-xl object-cover" />
              <span className="text-sm font-semibold tracking-[0.18em] uppercase">PaceLab</span>
            </div>
            <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7ea6ff]">Route issue</p>
            <h1 className="mt-3 text-[3rem] font-semibold leading-[0.9] tracking-[-0.07em]">404</h1>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              This route is not available in the current PaceLab app state. On deployed mobile browsers this usually means the app was reopened on a deep link without an SPA rewrite.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white hover:opacity-95">
                <Link to="/">
                  <HugeiconsIcon icon={Home09Icon} className="size-4" />
                  Home
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-full border-white/15 bg-white/5 px-5 text-white hover:bg-white/10">
                <Link to="/login">
                  <HugeiconsIcon icon={Login03Icon} className="size-4" />
                  Login
                </Link>
              </Button>
            </div>
          </div>

          <div className="rounded-[34px] border border-[#d7e5f8] bg-[linear-gradient(135deg,#ffffff_0%,#f5f8fd_54%,#edf4ff_100%)] p-6 shadow-[0_24px_64px_rgba(15,23,42,0.08)] sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#1f5fd1]">Page not found</p>
            <h2 className="mt-3 max-w-[10ch] text-[clamp(2.4rem,6vw,5rem)] font-semibold leading-[0.92] tracking-[-0.06em] text-slate-950">
              The page you opened is not currently reachable.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600">
              The app session may still be valid. If you were returning from a paused mobile tab, use the login route or home route to let PaceLab restore your workspace cleanly.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.04)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Likely cause</p>
                <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-slate-950">Deep route reload</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Mobile browsers often discard app memory and reopen the last URL directly. Without an SPA rewrite, the host answers with a real 404 before the app can rehydrate.
                </p>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.04)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Next move</p>
                <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-slate-950">Re-enter safely</p>
                <div className="mt-3 space-y-3 text-sm text-slate-600">
                  <div className="flex items-start gap-3 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                    <HugeiconsIcon icon={ArrowLeft01Icon} className="mt-0.5 size-4 text-[#1f5fd1]" />
                    <span>Use <span className="font-medium text-slate-950">Login</span> or <span className="font-medium text-slate-950">Home</span>. If your Supabase session still exists, PaceLab will restore access without a fresh sign-in.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="h-11 rounded-full bg-[linear-gradient(135deg,#1f8cff_0%,#4759ff_100%)] px-5 text-white hover:opacity-95">
                <Link to="/login">
                  <HugeiconsIcon icon={Login03Icon} className="size-4" />
                  Go to login
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-full border-slate-200 px-5 text-slate-950 hover:border-[#1f8cff] hover:bg-[#eef5ff]">
                <Link to="/">
                  <HugeiconsIcon icon={Home09Icon} className="size-4" />
                  Go to home
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
